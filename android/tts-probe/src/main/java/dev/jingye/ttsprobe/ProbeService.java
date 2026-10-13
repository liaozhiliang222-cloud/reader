package dev.jingye.ttsprobe;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
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
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.SystemClock;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.json.JSONObject;

/** T0 framework-only media service. All state/TTS callbacks use one serial Handler. */
public class ProbeService extends Service {
    static volatile ProbeService current;
    static volatile String summary = "";
    private HandlerThread thread;
    private Handler handler;
    private TextToSpeech tts;
    private AudioManager audio;
    private AudioFocusRequest focus;
    private PowerManager.WakeLock wake;
    private MediaSession media;
    private ProbeQueue queue;
    private ProbeState state;
    private final String session = UUID.randomUUID().toString();
    private boolean initialized;
    private boolean ending;
    private boolean heldFocus;
    private boolean appPlayback;
    private MediaPlayer player;
    private File audioFile;
    private long synthesizedBytes;
    private static final long MAX_AUDIO_BYTES = 16 * 1024 * 1024;
    private float rate = 1f;
    private String voiceId;
    private long requestedAt;
    private long lastDone;
    private int retries;
    private Runnable watchdog;
    private final Runnable timer = () -> finish("timer");
    private final Runnable pauseTimeout = () -> finish("pause_timeout");
    private final AudioAttributes attributes = new AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build();
    private final AudioManager.OnAudioFocusChangeListener focusListener = value -> {
        if (value < 0 && handler != null) handler.post(() -> pause("focus_loss_" + value));
        // GAIN never resumes without a new user action.
    };
    private final BroadcastReceiver noisy = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) { command("noisy"); }
    };
    private final AudioDeviceCallback devices = new AudioDeviceCallback() {
        @Override public void onAudioDevicesRemoved(AudioDeviceInfo[] removed) {
            for (AudioDeviceInfo device : removed) {
                int type = device.getType();
                if (device.isSink() && (type == AudioDeviceInfo.TYPE_WIRED_HEADPHONES
                    || type == AudioDeviceInfo.TYPE_WIRED_HEADSET || type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP
                    || type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO || type == AudioDeviceInfo.TYPE_USB_HEADSET
                    || type == AudioDeviceInfo.TYPE_USB_DEVICE || type == 26 || type == 27)) {
                    pause("output_removed");
                    break;
                }
            }
        }
    };

    @Override public void onCreate() {
        super.onCreate();
        current = this;
        thread = new HandlerThread("tts-probe-state");
        thread.start();
        handler = new Handler(thread.getLooper());
        audio = (AudioManager) getSystemService(AUDIO_SERVICE);
        PowerManager power = (PowerManager) getSystemService(POWER_SERVICE);
        wake = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "jingye:tts-probe");
        wake.setReferenceCounted(false);
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel("speech", "听书测试", NotificationManager.IMPORTANCE_LOW);
            channel.setSound(null, null);
            channel.enableVibration(false);
            channel.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
            getSystemService(NotificationManager.class).createNotificationChannel(channel);
            focus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(attributes).setWillPauseWhenDucked(true)
                .setOnAudioFocusChangeListener(focusListener, handler).build();
        }
        media = new MediaSession(this, "JingyeTtsProbe");
        media.setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS | MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS);
        media.setPlaybackToLocal(attributes);
        media.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { command("resume"); }
            @Override public void onPause() { command("pause"); }
            @Override public void onStop() { command("stop"); }
            @Override public void onSkipToNext() { command("next"); }
            @Override public void onSkipToPrevious() { command("previous"); }
        }, handler);
        media.setActive(true);
        // Foreground immediately, before engine initialization or requesting focus (target 35+).
        startForeground(71, notification("初始化语音"));
        IntentFilter filter = new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(noisy, filter, Context.RECEIVER_NOT_EXPORTED);
        else registerReceiver(noisy, filter);
        audio.registerAudioDeviceCallback(devices, handler);
    }

    @Override public int onStartCommand(Intent intent, int flags, int id) {
        if (intent == null) { stopSelf(); return START_NOT_STICKY; }
        String action = intent.getAction();
        if ("start".equals(action)) handler.post(() -> begin(intent));
        else if (session.equals(intent.getStringExtra("session"))) command(action);
        else if (state == null) stopSelf();
        return START_NOT_STICKY;
    }
    @Override public IBinder onBind(Intent intent) { return null; }

    private void begin(Intent intent) {
        if (tts != null || ending) return;
        try {
            queue = ProbeQueue.open(new File(getNoBackupFilesDir(), "queue"));
            state = new ProbeState(queue.count);
            appPlayback = intent.getBooleanExtra("appPlayback", false);
            ProbeQueue.clear(new File(getNoBackupFilesDir(), "speech-audio"));
            voiceId = intent.getStringExtra("voice");
            String engine = intent.getStringExtra("engine");
            if (engine == null || voiceId == null) throw new IllegalArgumentException("voice_missing");
            requestedAt = SystemClock.elapsedRealtime();
            event("service_start");
            tts = new TextToSpeech(this, result -> handler.post(() -> {
                if (ending) return;
                if (result != TextToSpeech.SUCCESS) { fail("engine_init"); return; }
                Voice selected = null;
                for (Voice voice : ProbeVoices.offline(tts)) if (voice.getName().equals(voiceId)) selected = voice;
                if (selected == null || tts.setVoice(selected) != TextToSpeech.SUCCESS
                    || tts.getVoice() == null || !voiceId.equals(tts.getVoice().getName())
                    || !ProbeVoices.usable(tts.getVoice())) { fail("offline_voice_unavailable"); return; }
                if (tts.setAudioAttributes(attributes) != TextToSpeech.SUCCESS || tts.setSpeechRate(rate) != TextToSpeech.SUCCESS) {
                    fail("engine_configuration"); return;
                }
                initialized = true;
                tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                    @Override public void onStart(String token) { handler.post(() -> {
                        if (appPlayback) { if (valid(token)) event("synthesis_start"); }
                        else started(token);
                    }); }
                    @Override public void onDone(String token) { handler.post(() -> {
                        if (appPlayback) playSynthesized(token); else completed(token);
                    }); }
                    @Override public void onAudioAvailable(String token, byte[] bytes) {
                        int size = bytes.length;
                        handler.post(() -> {
                            if (!appPlayback || !valid(token)) return;
                            synthesizedBytes += size;
                            if (synthesizedBytes > MAX_AUDIO_BYTES) fail("audio_limit");
                        });
                    }
                    @Override public void onError(String token) { onError(token, TextToSpeech.ERROR); }
                    @Override public void onError(String token, int code) { handler.post(() -> {
                        if (valid(token)) fail("tts_error_" + code);
                    }); }
                    @Override public void onStop(String token, boolean interrupted) { handler.post(() -> {
                        if (valid(token)) pause("unexpected_engine_stop");
                    }); }
                });
                // Only the initial user start permits playback. A pause during init cancels it.
                if (state.status == ProbeState.Status.READY) resume();
                else publish("已暂停");
            }), engine);
            handler.postDelayed(() -> { if (!initialized && !ending) fail("engine_init_timeout"); }, 15000);
        } catch (Exception error) { fail("queue_open_" + error.getClass().getSimpleName()); }
    }
    void command(String action) {
        if (handler == null) return;
        handler.post(() -> {
            if (ending || state == null || action == null) return;
            switch (action) {
                case "pause": case "noisy": pause(action); break;
                case "resume": resume(); break;
                case "stop": finish("user_stop"); break;
                case "previous": case "next": {
                    boolean wasPlaying = state.status == ProbeState.Status.SPEAKING;
                    pause("skip");
                    state.skip(action.equals("next") ? 1 : -1);
                    retries = 0;
                    if (state.status == ProbeState.Status.ENDED) finish("completed");
                    else { event("skip"); if (wasPlaying) resume(); else publish("已暂停"); }
                    break;
                }
                case "rate075": case "rate100": case "rate200": {
                    boolean wasPlaying = state.status == ProbeState.Status.SPEAKING;
                    pause("rate");
                    rate = action.equals("rate075") ? .75f : action.equals("rate200") ? 2f : 1f;
                    if (!initialized || tts.setSpeechRate(rate) != TextToSpeech.SUCCESS) { fail("rate_rejected"); return; }
                    if (wasPlaying) resume();
                    break;
                }
                case "timer15":
                    state.deadline = SystemClock.elapsedRealtime() + 15 * 60_000;
                    state.chapterEnd = -1;
                    scheduleTimer(); event("timer_set"); break;
                case "chapter":
                    state.deadline = 0;
                    state.chapterEnd = Math.min(state.count, (state.index / 64 + 1) * 64);
                    scheduleTimer(); event("chapter_timer_set"); break;
                case "timerOff":
                    state.deadline = 0; state.chapterEnd = -1; scheduleTimer(); event("timer_off"); break;
                case "focusProbe": testFocus(); break;
                default: break;
            }
        });
    }
    private boolean requestFocus() {
        int result = Build.VERSION.SDK_INT >= 26 ? audio.requestAudioFocus(focus)
            : audio.requestAudioFocus(focusListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN);
        heldFocus = result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
        return heldFocus;
    }
    private void resume() {
        if (!initialized || ending || state.status == ProbeState.Status.SPEAKING) return;
        if (state.deadline > 0 && SystemClock.elapsedRealtime() >= state.deadline) { finish("timer"); return; }
        handler.removeCallbacks(pauseTimeout);
        if (!requestFocus()) { pause("focus_denied"); return; }
        String token = state.play(SystemClock.elapsedRealtime(), true);
        if (token == null) { finish("not_playable"); return; }
        scheduleTimer();
        speak();
    }
    private void speak() {
        if (ending || state.status != ProbeState.Status.SPEAKING) return;
        try {
            if (!ProbeVoices.usable(tts.getVoice()) || !voiceId.equals(tts.getVoice().getName())) {
                fail("voice_changed"); return;
            }
            JSONObject row = queue.sentence(state.index);
            String text = row.getString("text");
            if (text.length() > TextToSpeech.getMaxSpeechInputLength()) { fail("sentence_too_long"); return; }
            wake.acquire(10 * 60_000L);
            String token = state.token();
            if (!event("submit")) return;
            int result;
            if (appPlayback) {
                clearAudio();
                File directory = new File(getNoBackupFilesDir(), "speech-audio");
                if (!directory.exists() && !directory.mkdirs()) throw new java.io.IOException("audio_storage");
                audioFile = new File(directory, "sentence-" + token.replace(':', '_') + ".wav");
                synthesizedBytes = 0;
                result = tts.synthesizeToFile(text, null, audioFile, token);
            } else result = tts.speak(text, TextToSpeech.QUEUE_ADD, null, token);
            if (result != TextToSpeech.SUCCESS) { fail("speak_rejected"); return; }
            cancelWatchdog();
            watchdog = () -> {
                if (!valid(token)) return;
                boolean retry = retries++ == 0;
                pause("sentence_timeout");
                if (retry) resume(); else publish("单句超时，已暂停");
            };
            handler.postDelayed(watchdog, Math.max(60_000, Math.min(240_000, (long) (text.length() * 2000 / rate))));
            publish("朗读中");
        } catch (Exception error) { fail("queue_read_" + error.getClass().getSimpleName()); }
    }
    private boolean valid(String token) {
        return !ending && state != null && state.status == ProbeState.Status.SPEAKING && token != null && token.equals(state.token());
    }
    private void playSynthesized(String token) {
        if (!valid(token)) return;
        try {
            if (audioFile == null || audioFile.length() < 44 || audioFile.length() > MAX_AUDIO_BYTES)
                throw new java.io.IOException("invalid_audio_size");
            event("synthesis_done");
            MediaPlayer created = new MediaPlayer();
            player = created;
            created.setAudioAttributes(attributes);
            created.setDataSource(audioFile.getAbsolutePath());
            created.setOnPreparedListener(ready -> {
                if (!valid(token) || player != created) return;
                started(token);
                if (valid(token)) ready.start();
            });
            created.setOnCompletionListener(done -> {
                if (!valid(token) || player != created) return;
                try { clearAudio(); completed(token); }
                catch (Exception error) { fail("audio_cleanup"); }
            });
            created.setOnErrorListener((failed, what, extra) -> {
                if (valid(token) && player == created) fail("audio_playback_" + what);
                return true;
            });
            created.prepareAsync();
        } catch (Exception error) { fail("audio_prepare_" + error.getClass().getSimpleName()); }
    }
    private void clearAudio() throws java.io.IOException {
        if (player != null) { player.release(); player = null; }
        if (audioFile != null) {
            if (audioFile.exists() && !audioFile.delete()) throw new java.io.IOException("audio_cleanup");
            audioFile = null;
        }
    }
    private void started(String token) {
        if (!ending && state.start(token)) { event("on_start"); publish("朗读中"); }
    }
    private void completed(String token) {
        if (ending || !state.done(token)) return;
        cancelWatchdog();
        retries = 0;
        lastDone = SystemClock.elapsedRealtime();
        if (!event("on_done")) return;
        if (state.status == ProbeState.Status.ENDED) finish("completed");
        else if (state.status == ProbeState.Status.STOPPED) finish("chapter_timer");
        else speak();
    }
    private void pause(String reason) {
        if (ending || state == null) return;
        state.pause(); // Invalidate callback first, then call stop.
        cancelWatchdog();
        handler.removeCallbacks(timer);
        if (tts != null) tts.stop();
        try { clearAudio(); } catch (Exception error) { fail("audio_cleanup"); return; }
        releaseAudio();
        event(reason);
        publish("已暂停 · " + reason);
        handler.removeCallbacks(pauseTimeout);
        handler.postDelayed(pauseTimeout, 10 * 60_000);
        scheduleTimer();
    }
    private void cancelWatchdog() { if (watchdog != null) handler.removeCallbacks(watchdog); }
    private void releaseAudio() {
        if (wake.isHeld()) wake.release();
        if (heldFocus) {
            heldFocus = false;
            if (Build.VERSION.SDK_INT >= 26) audio.abandonAudioFocusRequest(focus);
            else audio.abandonAudioFocus(focusListener);
        }
    }
    private void scheduleTimer() {
        handler.removeCallbacks(timer);
        if ((state.status == ProbeState.Status.SPEAKING || state.status == ProbeState.Status.PAUSED) && state.deadline > 0)
            handler.postDelayed(timer, Math.max(0, state.deadline - SystemClock.elapsedRealtime()));
    }
    private void fail(String reason) { if (state != null) state.fail(); finish(reason); }
    private void finish(String reason) {
        if (ending) return;
        ending = true;
        if (state != null && state.status != ProbeState.Status.ERROR && state.status != ProbeState.Status.ENDED) state.stop();
        handler.removeCallbacksAndMessages(null);
        if (tts != null) { tts.stop(); tts.shutdown(); tts = null; }
        try { clearAudio(); ProbeQueue.clear(new File(getNoBackupFilesDir(), "speech-audio")); }
        catch (Exception error) { event("audio_cleanup_failed"); }
        releaseAudio();
        event(reason);
        try { ProbeQueue.clear(new File(getNoBackupFilesDir(), "queue")); }
        catch (Exception error) { event("queue_cleanup_failed"); }
        summary = "已停止 · " + reason + "\n续读句：" + (state == null ? "无" : state.index);
        stopForeground(STOP_FOREGROUND_REMOVE);
        media.setActive(false);
        stopSelf();
    }
    private boolean event(String name) {
        try {
            JSONObject row = new JSONObject();
            row.put("session", session);
            row.put("event", name);
            row.put("wallMs", System.currentTimeMillis());
            row.put("elapsedMs", SystemClock.elapsedRealtime());
            row.put("sinceStartMs", SystemClock.elapsedRealtime() - requestedAt);
            row.put("sinceDoneMs", lastDone == 0 ? JSONObject.NULL : SystemClock.elapsedRealtime() - lastDone);
            row.put("playbackMode", appPlayback ? "synthesize_file_media_player" : "tts_speak");
            row.put("audioBytes", audioFile == null ? 0 : audioFile.length());
            if (state != null) {
                row.put("index", state.index);
                row.put("chapter", state.index / 64);
                row.put("batch", state.index / ProbeQueue.WINDOW);
                row.put("generation", state.generation);
                row.put("sequence", state.sequence);
                row.put("state", state.status.name());
                row.put("deadline", state.deadline);
            }
            row.put("wakeHeld", wake.isHeld());
            row.put("screenInteractive", ((PowerManager) getSystemService(POWER_SERVICE)).isInteractive());
            byte[] bytes = (row.toString() + "\n").getBytes(StandardCharsets.UTF_8);
            // Synthetic fixture identifiers only, never book text. Durable checkpoint before continuing.
            try (FileOutputStream out = new FileOutputStream(new File(getFilesDir(), "events.jsonl"), true)) {
                out.write(bytes); out.getFD().sync();
            }
            ProbeQueue.write(new File(getFilesDir(), "checkpoint.json"), row.toString().getBytes(StandardCharsets.UTF_8));
            return true;
        } catch (Exception error) {
            if (!ending) { if (state != null) state.fail(); finish("checkpoint_io_failure"); }
            return false;
        }
    }
    // Valid MediaSession transport notifications are exempt from Android 13's runtime
    // permission: developer.android.com/develop/ui/views/notifications/notification-permission#exemptions
    @android.annotation.SuppressLint("NotificationPermission")
    private void publish(String label) {
        if (ending) return;
        summary = label + "\n句 " + state.index + "/" + state.count + " · 章 " + (state.index / 64 + 1)
            + " · 批 " + state.index / ProbeQueue.WINDOW + "\n" + voiceId + " · " + rate + "×";
        boolean playing = state.status == ProbeState.Status.SPEAKING;
        media.setMetadata(new MediaMetadata.Builder().putString(MediaMetadata.METADATA_KEY_TITLE, "静页原创听书测试")
            .putString(MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE, "第 " + (state.index / 64 + 1) + " 章").build());
        media.setPlaybackState(new PlaybackState.Builder().setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED,
            PlaybackState.PLAYBACK_POSITION_UNKNOWN, playing ? rate : 0)
            .setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE
                | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS | PlaybackState.ACTION_STOP).build());
        getSystemService(NotificationManager.class).notify(71, notification(label));
    }
    private PendingIntent action(String action, int code) {
        return PendingIntent.getService(this, code, new Intent(this, ProbeService.class).setAction(action)
            .putExtra("session", session), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
    private Notification notification(String label) {
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, ProbeActivity.class),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, "speech") : new Notification.Builder(this);
        Notification.Builder hidden = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, "speech") : new Notification.Builder(this);
        boolean playing = state != null && state.status == ProbeState.Status.SPEAKING;
        return builder.setSmallIcon(android.R.drawable.ic_media_play).setContentTitle("静页原创听书测试")
            .setContentText(label).setContentIntent(open).setOnlyAlertOnce(true).setShowWhen(false)
            .setCategory(Notification.CATEGORY_TRANSPORT).setVisibility(Notification.VISIBILITY_PRIVATE)
            .setPublicVersion(hidden.setSmallIcon(android.R.drawable.ic_media_play).setContentTitle("听书测试").build())
            .setOngoing(playing).setPriority(Notification.PRIORITY_LOW)
            .addAction(new Notification.Action.Builder(android.R.drawable.ic_media_previous, "上一句", action("previous", 1)).build())
            .addAction(new Notification.Action.Builder(playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
                playing ? "暂停" : "继续", action(playing ? "pause" : "resume", 2)).build())
            .addAction(new Notification.Action.Builder(android.R.drawable.ic_media_next, "下一句", action("next", 3)).build())
            .addAction(new Notification.Action.Builder(android.R.drawable.ic_menu_close_clear_cancel, "停止", action("stop", 4)).build())
            .setStyle(new Notification.MediaStyle().setMediaSession(media.getSessionToken()).setShowActionsInCompactView(0, 1, 2)).build();
    }
    private void testFocus() {
        if (Build.VERSION.SDK_INT >= 26) {
            AudioFocusRequest competing = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                .setAudioAttributes(attributes).setOnAudioFocusChangeListener(value -> {}, handler).build();
            int result = audio.requestAudioFocus(competing);
            event("test_focus_request_" + result);
            handler.postDelayed(() -> audio.abandonAudioFocusRequest(competing), 2000);
        } else {
            AudioManager.OnAudioFocusChangeListener competing = value -> {};
            int result = audio.requestAudioFocus(competing, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT);
            event("test_focus_request_" + result);
            handler.postDelayed(() -> audio.abandonAudioFocus(competing), 2000);
        }
    }
    @Override public void onDestroy() {
        current = null;
        audio.unregisterAudioDeviceCallback(devices);
        unregisterReceiver(noisy);
        handler.post(() -> {
            if (!ending) finish("service_destroyed");
            media.release();
            thread.quitSafely();
        });
        super.onDestroy();
    }
}
