package dev.jingye.reader;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.provider.Settings;
import android.speech.tts.TextToSpeech;
import android.speech.tts.Voice;
import android.util.AtomicFile;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Set;
import java.util.function.Consumer;
import org.json.JSONArray;
import org.json.JSONObject;

/** App-scoped serial owner. Preparation never creates a foreground service. */
public final class SpeechRuntime {
    public interface Reply { void success(JSONObject value); void failure(String reason); }
    private static SpeechRuntime instance;
    final Context context;
    final Handler handler;
    final File queues;
    volatile SpeechService service;
    private SpeechQueueStore pending;
    private boolean committed;
    private JSONObject latest;
    private String leaseId;
    private long ackedSequence = -1;
    volatile Consumer<JSONObject> listener;
    private final AtomicFile checkpoint;
    private TextToSpeech inventory;
    private int inventoryGeneration;

    public static synchronized SpeechRuntime get(Context context) {
        if (instance == null) instance = new SpeechRuntime(context.getApplicationContext());
        return instance;
    }
    private SpeechRuntime(Context context) {
        this.context = context;
        HandlerThread thread = new HandlerThread("jingye-speech");
        thread.start(); handler = new Handler(thread.getLooper());
        queues = new File(context.getNoBackupFilesDir(), "speech-queues");
        checkpoint = new AtomicFile(new File(context.getNoBackupFilesDir(), "speech-position.json"));
        handler.post(() -> {
            try {
                JSONObject saved = new JSONObject(new String(checkpoint.readFully(), StandardCharsets.UTF_8));
                latest = saved.getJSONObject("snapshot");
                leaseId = saved.getString("leaseId");
                ackedSequence = saved.optLong("ackedSequence", -1);
                if (java.util.Arrays.asList("ready", "speaking", "paused").contains(latest.optString("state"))) {
                    latest.put("state", "stopped").put("stopReason", "process_ended");
                    latest.put("generation", latest.getLong("generation") + 1);
                    latest.put("sequence", latest.getLong("sequence") + 1);
                }
            } catch (Exception ignored) { latest = null; }
            try { SpeechQueueStore.cleanupOrphans(queues, null); clearAudioDirectory(); }
            catch (Exception ignored) { /* Preparation retries cleanup and reports a failure. */ }
        });
    }
    static boolean usable(Voice voice) {
        return voice != null && !voice.isNetworkConnectionRequired() && voice.getFeatures() != null
            && !voice.getFeatures().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED);
    }
    void save(JSONObject snapshot, String lease) throws Exception { save(snapshot, lease, true); }
    private void save(JSONObject snapshot, String lease, boolean notify) throws Exception {
        JSONObject value = new JSONObject(snapshot.toString());
        value.put("leaseId", lease);
        JSONObject record = new JSONObject().put("snapshot", value).put("leaseId", lease).put("ackedSequence", ackedSequence);
        FileOutputStream output = null;
        try {
            output = checkpoint.startWrite();
            output.write(record.toString().getBytes(StandardCharsets.UTF_8));
            checkpoint.finishWrite(output);
        } catch (Exception error) { if (output != null) checkpoint.failWrite(output); throw error; }
        latest = value; leaseId = lease;
        Consumer<JSONObject> target = listener;
        if (notify && target != null) target.accept(new JSONObject().put("sessionId", value.getString("sessionId")).put("sequence", value.getLong("sequence")));
    }
    JSONObject snapshot() throws Exception {
        return new JSONObject().put("active", service != null).put("snapshot", latest == null ? JSONObject.NULL : new JSONObject(latest.toString()));
    }
    SpeechQueueStore takeQueue(JSONObject identity) throws Exception {
        if (pending == null || !committed) throw new Exception("queue_not_ready");
        SpeechProtocol.sameIdentity(pending.identity(), identity);
        SpeechQueueStore result = pending; pending = null; committed = false; ackedSequence = -1;
        return result;
    }
    void background() { handler.post(() -> { try { cancelPending(); } catch (Exception ignored) { /* next prepare retries */ } }); }
    private void cancelPending() throws Exception { if (pending != null) { pending.discard(); pending = null; } committed = false; }
    void clearAudioDirectory() throws Exception {
        File directory = new File(context.getNoBackupFilesDir(), "speech-audio");
        if (!directory.exists()) return;
        File[] files = directory.listFiles();
        if (files == null) throw new Exception("audio_cleanup_failed");
        for (File file : files) if (!file.isFile() || !file.delete()) throw new Exception("audio_cleanup_failed");
        if (!directory.delete()) throw new Exception("audio_cleanup_failed");
    }
    public void request(String action, JSONObject args, Activity activity, boolean foreground, Reply reply) {
        handler.post(() -> {
            try {
                switch (action) {
                    case "voices": voices(args.optString("engine", ""), reply); return;
                    case "state": reply.success(snapshot()); return;
                    case "prepare":
                        if (!foreground) throw new Exception("preparation_background");
                        if (service != null) throw new Exception("session_active");
                        cancelPending(); SpeechQueueStore.cleanupOrphans(queues, null); clearAudioDirectory();
                        pending = SpeechQueueStore.prepare(queues, args); reply.success(new JSONObject()); return;
                    case "append":
                        if (!foreground || pending == null) throw new Exception("preparation_cancelled");
                        pending.append(args); reply.success(new JSONObject()); return;
                    case "commit":
                        if (!foreground || pending == null) throw new Exception("preparation_cancelled");
                        SpeechProtocol.sameIdentity(pending.identity(), args);
                        pending.commit((int) SpeechProtocol.integer(args, "count", Integer.MAX_VALUE)); committed = true;
                        reply.success(new JSONObject()); return;
                    case "cancel":
                        if (pending != null) SpeechProtocol.sameIdentity(pending.identity(), args);
                        cancelPending(); reply.success(new JSONObject()); return;
                    case "start":
                        if (!foreground || activity == null || activity.isFinishing()) throw new Exception("start_background");
                        if (service != null || pending == null || !committed) throw new Exception("queue_not_ready");
                        SpeechProtocol.sameIdentity(pending.identity(), args);
                        SpeechProtocol.string(args, "leaseId", 96);
                        SpeechProtocol.string(args, "engine", 256); SpeechProtocol.string(args, "voice", 512);
                        SpeechProtocol.string(args, "title", 200);
                        Intent intent = new Intent(context, SpeechService.class).setAction("start").putExtra("config", args.toString());
                        activity.runOnUiThread(() -> {
                            try {
                                if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent); else context.startService(intent);
                                reply.success(new JSONObject());
                            } catch (Exception error) { reply.failure("foreground_service_unavailable"); }
                        }); return;
                    case "control":
                        if (service == null) throw new Exception("session_ended");
                        service.control(args); reply.success(snapshot()); return;
                    case "ack":
                        if (latest == null || !args.optString("leaseId").equals(leaseId)) throw new Exception("stale_session");
                        JSONObject expected = SpeechProtocol.identity(latest), actual = SpeechProtocol.identity(args);
                        for (String key : new String[]{"sessionId", "bookId", "contentRevision"})
                            if (!expected.get(key).toString().equals(actual.get(key).toString())) throw new Exception("stale_session");
                        long sequence = SpeechProtocol.integer(args, "sequence", 9007199254740991L);
                        if (sequence > latest.getLong("sequence")) throw new Exception("invalid_ack");
                        if (sequence > ackedSequence) { ackedSequence = sequence; save(latest, leaseId, false); }
                        reply.success(new JSONObject()); return;
                    case "reset":
                        if (service != null) service.finish("content_changed");
                        cancelPending(); SpeechQueueStore.cleanupOrphans(queues, null); clearAudioDirectory();
                        latest = null; checkpoint.delete();
                        if (args.optBoolean("clearPreferences", false) && !context.getSharedPreferences("speech-device", 0).edit().clear().commit())
                            throw new Exception("device_preferences_cleanup_failed");
                        reply.success(new JSONObject()); return;
                    default: throw new Exception("unknown_speech_action");
                }
            } catch (Exception error) { reply.failure(error.getMessage() == null ? "speech_failure" : error.getMessage()); }
        });
    }
    private void voices(String requested, Reply reply) throws Exception {
        if (inventory != null) { reply.failure("voices_busy"); return; }
        JSONArray engines = new JSONArray();
        String first = "";
        for (ResolveInfo info : context.getPackageManager().queryIntentServices(new Intent(TextToSpeech.Engine.INTENT_ACTION_TTS_SERVICE), 0)) {
            String id = info.serviceInfo.packageName;
            engines.put(new JSONObject().put("id", id).put("label", info.loadLabel(context.getPackageManager()).toString()));
            if (first.isEmpty()) first = id;
        }
        String selected = requested.isEmpty() ? context.getSharedPreferences("speech-device", 0).getString("engine", "") : requested;
        if (selected.isEmpty()) {
            selected = Settings.Secure.getString(context.getContentResolver(), Settings.Secure.TTS_DEFAULT_SYNTH);
            if (selected == null || selected.isEmpty()) selected = first;
        }
        if (selected.isEmpty()) { reply.success(new JSONObject().put("engines", engines).put("voices", new JSONArray()).put("engine", "")); return; }
        final String engine = selected;
        boolean installed = false;
        for (int i = 0; i < engines.length(); i++) installed |= engines.getJSONObject(i).getString("id").equals(engine);
        if (!installed) { reply.failure("engine_unavailable"); return; }
        int generation = ++inventoryGeneration;
        inventory = new TextToSpeech(context, result -> handler.post(() -> {
            if (generation != inventoryGeneration) return;
            TextToSpeech tts = inventory;
            inventory = null; inventoryGeneration++;
            try {
                if (result != TextToSpeech.SUCCESS) throw new Exception("engine_unavailable");
                JSONArray rows = new JSONArray(); Set<String> seen = new HashSet<>();
                if (tts.getVoices() != null) for (Voice voice : tts.getVoices())
                    if (usable(voice) && seen.add(voice.getName()))
                        rows.put(new JSONObject().put("id", voice.getName()).put("language", voice.getLocale().toLanguageTag()));
                JSONObject report = new JSONObject().put("engines", engines).put("engine", engine).put("voices", rows)
                    .put("savedVoice", context.getSharedPreferences("speech-device", 0).getString("voice", ""))
                    .put("engineInternetPermission", context.getPackageManager().checkPermission("android.permission.INTERNET", engine) == PackageManager.PERMISSION_GRANTED);
                reply.success(report);
            } catch (Exception error) { reply.failure("engine_unavailable"); }
            finally { tts.shutdown(); }
        }), engine);
        handler.postDelayed(() -> {
            if (generation != inventoryGeneration) return;
            inventoryGeneration++; inventory.shutdown(); inventory = null; reply.failure("engine_timeout");
        }, 15000);
    }
}
