package dev.jingye.reader;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.KeyguardManager;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.media.AudioAttributes;
import android.media.AudioDeviceCallback;
import android.media.AudioDeviceInfo;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaMetadata;
import android.media.MediaPlayer;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.SystemClock;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import java.io.File;
import java.util.UUID;
import org.json.JSONObject;

/** Offline synthesis and real local media playback; no WebView work while locked. */
public class SpeechService extends Service {
    private SpeechRuntime runtime;
    private Handler handler;
    private SpeechQueueStore queue;
    private SpeechState state;
    private TextToSpeech tts;
    private MediaPlayer player;
    private MediaSession media;
    private AudioManager audio;
    private AudioFocusRequest focus;
    private PowerManager.WakeLock wake;
    private File audioFile;
    private boolean ending, initialized, heldFocus;
    private String title = "听书", voiceId, leaseId;
    private long audioBytes, pauseDeadline;
    private static final long MAX_AUDIO = 16 * 1024 * 1024;
    private final AudioAttributes attributes = new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build();
    private Runnable watchdog;
    private final Runnable timer = () -> finish("timer");
    private final Runnable pauseTimeout = () -> finish("pause_timeout");
    private final AudioManager.OnAudioFocusChangeListener focusListener = value -> {
        if (value < 0 && handler != null) handler.post(() -> pause("focus_loss"));
    };
    private final BroadcastReceiver noisy = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) { handler.post(() -> pause("output_removed")); }
    };
    private final BroadcastReceiver visibility = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) { handler.post(() -> { if (!ending) publish(); }); }
    };
    private final AudioDeviceCallback devices = new AudioDeviceCallback() {
        @Override public void onAudioDevicesRemoved(AudioDeviceInfo[] removed) {
            for (AudioDeviceInfo device : removed) {
                int type = device.getType();
                if (device.isSink() && (type == 3 || type == 4 || type == 7 || type == 8 || type == 11 || type == 22 || type == 26 || type == 27)) {
                    pause("output_removed"); break;
                }
            }
        }
    };
    @Override public void onCreate() {
        super.onCreate(); runtime = SpeechRuntime.get(this); handler = runtime.handler; runtime.service = this;
        audio = (AudioManager) getSystemService(AUDIO_SERVICE);
        wake = ((PowerManager) getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "jingye:speech");
        wake.setReferenceCounted(false);
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel("speech", "听书", NotificationManager.IMPORTANCE_LOW);
            channel.setSound(null, null); channel.enableVibration(false); channel.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
            getSystemService(NotificationManager.class).createNotificationChannel(channel);
            focus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN).setAudioAttributes(attributes)
                .setWillPauseWhenDucked(true).setOnAudioFocusChangeListener(focusListener, handler).build();
        }
        media = new MediaSession(this, "JingyeSpeech");
        media.setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS | MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS);
        media.setPlaybackToLocal(attributes);
        media.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { mediaControl("resume"); }
            @Override public void onPause() { mediaControl("pause"); }
            @Override public void onStop() { mediaControl("stop"); }
            @Override public void onSkipToNext() { mediaControl("next"); }
            @Override public void onSkipToPrevious() { mediaControl("previous"); }
        }, handler);
        media.setActive(true);
        startForeground(72, notification());
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(noisy, new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY), Context.RECEIVER_NOT_EXPORTED);
        else registerReceiver(noisy, new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY));
        IntentFilter screen = new IntentFilter(Intent.ACTION_SCREEN_OFF); screen.addAction(Intent.ACTION_USER_PRESENT);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(visibility, screen, Context.RECEIVER_NOT_EXPORTED); else registerReceiver(visibility, screen);
        audio.registerAudioDeviceCallback(devices, handler);
    }
    @Override public int onStartCommand(Intent intent, int flags, int id) {
        if (intent == null) { stopSelf(); return START_NOT_STICKY; }
        if ("start".equals(intent.getAction())) handler.post(() -> begin(intent.getStringExtra("config")));
        else handler.post(() -> {
            if (state == null || ending) { stopSelf(); return; }
            try {
                if (!state.snapshot().getString("sessionId").equals(intent.getStringExtra("sessionId"))) return;
                mediaControl(intent.getAction());
            } catch (Exception error) { finish("command_failure"); }
        });
        return START_NOT_STICKY;
    }
    @Override public IBinder onBind(Intent intent) { return null; }
    private void begin(String raw) {
        if (state != null || ending) return;
        try {
            JSONObject config = new JSONObject(raw);
            queue = runtime.takeQueue(config);
            leaseId = config.getString("leaseId"); title = config.getString("title"); voiceId = config.getString("voice");
            state = new SpeechState(config, queue.count(), queue.sentence(0));
            state.setRate(config.optDouble("rate", 1));
            state.setTimer(config.optString("timer", "off"), SystemClock.elapsedRealtime());
            // Configuration sets PAUSED; the explicit start intent permits this first play.
            boolean[] playOnReady = {true};
            initialPlay = playOnReady;
            publish();
            tts = new TextToSpeech(this, result -> handler.post(() -> {
                if (ending) return;
                try {
                    if (result != TextToSpeech.SUCCESS) throw new Exception("engine_unavailable");
                    Voice selected = null;
                    if (tts.getVoices() != null) for (Voice voice : tts.getVoices())
                        if (SpeechRuntime.usable(voice) && voiceId.equals(voice.getName())) selected = voice;
                    if (selected == null || tts.setVoice(selected) != TextToSpeech.SUCCESS || !SpeechRuntime.usable(tts.getVoice())
                        || !voiceId.equals(tts.getVoice().getName())) throw new Exception("offline_voice_unavailable");
                    if (tts.setSpeechRate((float) state.rate()) != TextToSpeech.SUCCESS) throw new Exception("rate_rejected");
                    tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                        @Override public void onStart(String token) {}
                        @Override public void onDone(String token) { handler.post(() -> synthesized(token)); }
                        @Override public void onError(String token) { onError(token, TextToSpeech.ERROR); }
                        @Override public void onError(String token, int code) { handler.post(() -> { if (valid(token)) fail("synthesis_failed"); }); }
                        @Override public void onAudioAvailable(String token, byte[] bytes) {
                            int size = bytes.length;
                            handler.post(() -> { if (valid(token)) { audioBytes += size; if (audioBytes > MAX_AUDIO) fail("audio_limit"); } });
                        }
                    });
                    initialized = true;
                    getSharedPreferences("speech-device", 0).edit().putString("engine", config.getString("engine")).putString("voice", voiceId).apply();
                    if (playOnReady[0]) resume();
                } catch (Exception error) { fail(error.getMessage()); }
            }), config.getString("engine"));
            handler.postDelayed(() -> { if (!initialized && !ending) fail("engine_timeout"); }, 15000);
        } catch (Exception error) { fail("queue_unavailable"); }
    }
    private boolean[] initialPlay;
    private boolean valid(String token) { return !ending && state != null && state.valid(token); }
    private void mediaControl(String action) {
        if (state == null || ending) return;
        try { control(state.snapshot().put("commandId", UUID.randomUUID().toString()).put("action", action)); }
        catch (Exception error) { fail("command_failure"); }
    }
    void control(JSONObject command) throws Exception {
        String action = command.getString("action");
        if (!java.util.Arrays.asList("play", "resume", "pause", "stop", "previous", "next", "rate", "timer").contains(action)) throw new Exception("invalid_command");
        if ((action.equals("resume") || action.equals("play")) && !initialized) throw new Exception("engine_initializing");
        double rate = command.optDouble("rate", state.rate());
        if (action.equals("rate") && (!Double.isFinite(rate) || rate < .75 || rate > 2 || Math.abs(rate * 20 - Math.rint(rate * 20)) > .000001)) throw new Exception("invalid_rate");
        String selectedTimer = command.optString("timer", "off");
        if (action.equals("timer") && !java.util.Arrays.asList("off", "15m", "30m", "60m", "chapter").contains(selectedTimer)) throw new Exception("invalid_timer");
        if (!state.accept(command)) return;
        if (command.has("leaseId")) {
            String requestedLease = SpeechProtocol.string(command, "leaseId", 96);
            if ((action.equals("resume") || action.equals("play")) && !requestedLease.equals(leaseId)) leaseId = requestedLease;
        }
        boolean playing = state.status() == SpeechState.Status.SPEAKING;
        switch (action) {
            case "play": case "resume": resume(); break;
            case "pause": pause("user"); break;
            case "stop": finish("user"); break;
            case "previous": case "next":
                int target = state.index() + (action.equals("next") ? 1 : -1);
                if (target >= queue.count()) { state.completeBySkip(); finish("completed_skip"); break; }
                pause("skip"); state.move(Math.max(0, target), queue.sentence(Math.max(0, target)));
                publish(); if (playing) resume(); break;
            case "rate":
                pause("rate"); state.setRate(rate);
                if (initialized && tts.setSpeechRate((float) rate) != TextToSpeech.SUCCESS) { fail("rate_rejected"); break; }
                publish(); if (playing) resume(); break;
            case "timer": state.setTimer(selectedTimer, SystemClock.elapsedRealtime()); scheduleTimer(); publish(); break;
        }
    }
    private void resume() {
        if (ending || !initialized) return;
        if (state.status() == SpeechState.Status.SPEAKING) { publish(); return; }
        if (state.expired(SystemClock.elapsedRealtime())) { finish("timer"); return; }
        if (pauseDeadline != 0 && SystemClock.elapsedRealtime() >= pauseDeadline) { finish("pause_timeout"); return; }
        handler.removeCallbacks(pauseTimeout); pauseDeadline = 0;
        int result = Build.VERSION.SDK_INT >= 26 ? audio.requestAudioFocus(focus)
            : audio.requestAudioFocus(focusListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN);
        heldFocus = result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
        if (state.play(SystemClock.elapsedRealtime(), heldFocus) == null) { releaseAudio(); publish(); return; }
        scheduleTimer(); speak();
    }
    private void speak() {
        try {
            String token = state.token(); if (!valid(token)) return;
            if (!SpeechRuntime.usable(tts.getVoice()) || !voiceId.equals(tts.getVoice().getName())) throw new Exception("offline_voice_unavailable");
            JSONObject sentence = queue.sentence(state.index());
            String text = sentence.getString("text");
            if (text.length() > TextToSpeech.getMaxSpeechInputLength()) throw new Exception("sentence_limit");
            clearPlayer();
            File directory = new File(getNoBackupFilesDir(), "speech-audio");
            if (!directory.exists() && !directory.mkdirs()) throw new Exception("audio_storage");
            audioFile = new File(directory, "sentence-" + token.replace(':', '_') + ".wav"); audioBytes = 0;
            wake.acquire(10 * 60000L);
            publish();
            if (tts.synthesizeToFile(text, null, audioFile, token) != TextToSpeech.SUCCESS) throw new Exception("synthesis_rejected");
            cancelWatchdog();
            watchdog = () -> {
                if (!valid(token)) return;
                boolean retry = state.timedOut(token);
                try { stopAudio(); releaseAudio(); publish(); if (retry) resume(); else finish("sentence_timeout"); }
                catch (Exception error) { fail("audio_cleanup"); }
            };
            handler.postDelayed(watchdog, Math.max(60000, Math.min(240000, (long) (text.length() * 2000 / state.rate()))));
        } catch (Exception error) { fail(error.getMessage()); }
    }
    private void synthesized(String token) {
        if (!valid(token)) return;
        try {
            if (audioFile == null || audioFile.length() < 44 || audioFile.length() > MAX_AUDIO) throw new Exception("invalid_audio");
            MediaPlayer created = new MediaPlayer(); player = created;
            created.setAudioAttributes(attributes); created.setDataSource(audioFile.getAbsolutePath());
            created.setOnPreparedListener(ready -> {
                if (!valid(token) || player != created) return;
                try { if (state.started(token) && publish()) ready.start(); }
                catch (Exception error) { fail("audio_playback_failed"); }
            });
            created.setOnCompletionListener(done -> {
                if (!valid(token) || player != created) return;
                try {
                    clearPlayer(); cancelWatchdog();
                    JSONObject next = state.index() + 1 < queue.count() ? queue.sentence(state.index() + 1) : null;
                    if (!state.done(token, next, SystemClock.elapsedRealtime())) return;
                    if (state.terminal()) finish(state.reason()); else { publish(); speak(); }
                } catch (Exception error) { fail("queue_read_failed"); }
            });
            created.setOnErrorListener((failed, what, extra) -> { if (valid(token) && player == created) fail("audio_playback_failed"); return true; });
            created.prepareAsync();
        } catch (Exception error) { fail("audio_playback_failed"); }
    }
    private void pause(String why) {
        if (ending || state == null || state.terminal()) return;
        if (initialPlay != null) initialPlay[0] = false;
        state.pause(why);
        try { stopAudio(); } catch (Exception error) { fail("audio_cleanup"); return; }
        releaseAudio(); publish();
        pauseDeadline = SystemClock.elapsedRealtime() + 10 * 60000;
        handler.removeCallbacks(pauseTimeout); handler.postDelayed(pauseTimeout, 10 * 60000); scheduleTimer();
    }
    private void stopAudio() throws Exception { cancelWatchdog(); if (tts != null) tts.stop(); clearPlayer(); }
    private void clearPlayer() throws Exception {
        if (player != null) { player.release(); player = null; }
        if (audioFile != null) { if (audioFile.exists() && !audioFile.delete()) throw new Exception("audio_cleanup"); audioFile = null; }
    }
    private void releaseAudio() {
        if (wake.isHeld()) wake.release();
        if (heldFocus) {
            heldFocus = false;
            if (Build.VERSION.SDK_INT >= 26) audio.abandonAudioFocusRequest(focus); else audio.abandonAudioFocus(focusListener);
        }
    }
    private void cancelWatchdog() { if (watchdog != null) handler.removeCallbacks(watchdog); }
    private void scheduleTimer() {
        handler.removeCallbacks(timer);
        if (state.deadline() > 0 && !state.terminal()) handler.postDelayed(timer, Math.max(0, state.deadline() - SystemClock.elapsedRealtime()));
    }
    private void fail(String why) { if (state != null) state.fail(why == null ? "speech_failure" : why); finish(why); }
    void finish(String why) {
        if (ending) return; ending = true;
        if (state != null && !state.terminal()) state.stop(why);
        cancelWatchdog(); handler.removeCallbacks(timer); handler.removeCallbacks(pauseTimeout);
        try { stopAudio(); } catch (Exception ignored) { /* retry directory cleanup below */ }
        if (tts != null) { tts.shutdown(); tts = null; }
        releaseAudio(); publish();
        try { if (queue != null) queue.discard(); runtime.clearAudioDirectory(); }
        catch (Exception error) { if (state != null) { state.fail("cleanup_failed"); publish(); } }
        media.setActive(false); stopForeground(STOP_FOREGROUND_REMOVE); runtime.service = null; stopSelf();
    }
    private boolean publish() {
        if (state == null) return true;
        try {
            runtime.save(state.snapshot(), leaseId);
            if (ending) return true;
            boolean playing = state.status() == SpeechState.Status.SPEAKING;
            String chapter = queue.sentence(state.index()).getString("chapterTitle");
            media.setMetadata(new MediaMetadata.Builder().putString(MediaMetadata.METADATA_KEY_TITLE, privateMetadata() ? "听书" : title)
                .putString(MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE, privateMetadata() ? (playing ? "正在听书" : "听书已暂停") : chapter).build());
            media.setPlaybackState(new PlaybackState.Builder().setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED,
                PlaybackState.PLAYBACK_POSITION_UNKNOWN, playing ? (float) state.rate() : 0)
                .setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS | PlaybackState.ACTION_STOP).build());
            updateNotification(); return true;
        } catch (Exception error) { if (!ending) fail("position_save_failed"); return false; }
    }
    // Framework MediaStyle notifications with a valid MediaSession are exempt from POST_NOTIFICATIONS.
    @android.annotation.SuppressLint("NotificationPermission")
    private void updateNotification() { getSystemService(NotificationManager.class).notify(72, notification()); }
    private PendingIntent action(String action, int id) {
        String session = state == null ? "" : state.token();
        try { if (state != null) session = state.snapshot().getString("sessionId"); } catch (Exception ignored) {}
        return PendingIntent.getService(this, id ^ session.hashCode(), new Intent(this, SpeechService.class).setAction(action).putExtra("sessionId", session), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
    private Notification notification() {
        boolean playing = state != null && state.status() == SpeechState.Status.SPEAKING;
        Intent openIntent = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        try { if (state != null) openIntent.putExtra("speechBookId", state.snapshot().getString("bookId")); } catch (Exception ignored) {}
        PendingIntent open = PendingIntent.getActivity(this, 72, openIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        media.setSessionActivity(open);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, "speech") : new Notification.Builder(this);
        Notification.Builder hidden = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, "speech") : new Notification.Builder(this);
        return b.setSmallIcon(android.R.drawable.ic_media_play).setContentTitle(privateMetadata() ? "听书" : title).setContentText(playing ? "正在听书" : "听书已暂停")
            .setContentIntent(open).setOnlyAlertOnce(true).setShowWhen(false).setPriority(Notification.PRIORITY_LOW).setCategory(Notification.CATEGORY_TRANSPORT)
            .setVisibility(Notification.VISIBILITY_PRIVATE).setPublicVersion(hidden.setSmallIcon(android.R.drawable.ic_media_play).setContentTitle("听书").build())
            .setOngoing(playing)
            .addAction(new Notification.Action.Builder(android.R.drawable.ic_media_previous, "上一句", action("previous", 73)).build())
            .addAction(new Notification.Action.Builder(playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play, playing ? "暂停" : "继续", action(playing ? "pause" : "resume", 74)).build())
            .addAction(new Notification.Action.Builder(android.R.drawable.ic_media_next, "下一句", action("next", 75)).build())
            .addAction(new Notification.Action.Builder(android.R.drawable.ic_menu_close_clear_cancel, "停止", action("stop", 76)).build())
            .setStyle(new Notification.MediaStyle().setMediaSession(media.getSessionToken()).setShowActionsInCompactView(0, 1, 2)).build();
    }
    private boolean privateMetadata() {
        return ((KeyguardManager) getSystemService(KEYGUARD_SERVICE)).isKeyguardLocked()
            || !((PowerManager) getSystemService(POWER_SERVICE)).isInteractive();
    }
    @Override public void onDestroy() {
        audio.unregisterAudioDeviceCallback(devices); unregisterReceiver(noisy); unregisterReceiver(visibility);
        handler.post(() -> { if (!ending) finish("service_ended"); media.release(); if (runtime.service == this) runtime.service = null; });
        super.onDestroy();
    }
}
