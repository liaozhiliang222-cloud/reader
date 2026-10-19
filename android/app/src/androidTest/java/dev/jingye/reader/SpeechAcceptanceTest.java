package dev.jingye.reader;

import android.content.Context;
import android.os.SystemClock;
import android.speech.tts.TextToSpeech;
import android.speech.tts.Voice;
import android.util.AtomicFile;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.lang.reflect.Constructor;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Real framework/engine tests. No test hook or speech backend substitute in release. */
@RunWith(AndroidJUnit4.class)
public class SpeechAcceptanceTest {
    private Context context() { return InstrumentationRegistry.getInstrumentation().getTargetContext(); }
    private JSONObject identity() throws Exception {
        return new JSONObject().put("protocolVersion", 1).put("sessionId", UUID.randomUUID().toString())
            .put("bookId", "native-original-fixture").put("contentRevision", 0).put("generation", 0);
    }
    private JSONObject sentence(int chapter) throws Exception {
        JSONObject start = new JSONObject().put("chapterIndex", chapter).put("paragraphIndex", 0).put("charOffset", 0);
        JSONObject end = new JSONObject(start.toString()).put("charOffset", 3);
        return new JSONObject().put("id", "native-original-fixture:0:" + chapter + ":0:0-3").put("text", "你好。")
            .put("chapterTitle", "原创章节").put("start", start).put("end", end)
            .put("sourceRanges", new JSONArray().put(new JSONObject().put("start", start).put("end", end)));
    }
    private JSONObject request(SpeechRuntime runtime, String action, JSONObject args, MainActivity activity) throws Exception {
        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<JSONObject> result = new AtomicReference<>();
        AtomicReference<String> error = new AtomicReference<>();
        runtime.request(action, args, activity, true, new SpeechRuntime.Reply() {
            @Override public void success(JSONObject value) { result.set(value); done.countDown(); }
            @Override public void failure(String reason) { error.set(reason); done.countDown(); }
        });
        assertTrue("native callback must finish", done.await(20, TimeUnit.SECONDS));
        assertNull("native action " + action, error.get());
        return result.get();
    }
    @Test public void installedOfflineVoicePolicyRejectsEveryOnlineOrMissingVoice() {
        assertFalse(SpeechRuntime.usable(null));
        assertFalse(SpeechRuntime.usable(new Voice("online", Locale.CHINESE, Voice.QUALITY_NORMAL, Voice.LATENCY_NORMAL, true, Collections.emptySet())));
        assertFalse(SpeechRuntime.usable(new Voice("missing", Locale.CHINESE, Voice.QUALITY_NORMAL, Voice.LATENCY_NORMAL, false, Collections.singleton(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED))));
        assertTrue(SpeechRuntime.usable(new Voice("offline", Locale.CHINESE, Voice.QUALITY_NORMAL, Voice.LATENCY_NORMAL, false, Collections.emptySet())));
    }
    @Test public void privateQueueRoundTripAndCancellationUseRealAndroidJsonAndFiles() throws Exception {
        File root = new File(context().getNoBackupFilesDir(), "speech-test-" + UUID.randomUUID());
        JSONObject identity = identity();
        SpeechQueueStore store = SpeechQueueStore.prepare(root, identity);
        try {
            JSONObject batch = new JSONObject(identity.toString()).put("batchIndex", 0).put("firstSentenceIndex", 0)
                .put("sentences", new JSONArray().put(sentence(0)).put(sentence(1))).put("final", true);
            store.append(batch); store.append(new JSONObject(batch.toString())); store.commit(2);
            SpeechQueueStore reopened = SpeechQueueStore.open(root, identity);
            assertEquals(2, reopened.count());
            assertEquals(1, reopened.sentence(1).getJSONObject("start").getInt("chapterIndex"));
            assertTrue(root.getCanonicalPath().startsWith(context().getNoBackupFilesDir().getCanonicalPath() + File.separator));
        } finally { store.discard(); assertTrue(root.delete()); }
    }
    @Test public void realOfflineEngineStopsAtChapterEndAndRemovesTemporaryTextAndAudio() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            AtomicReference<MainActivity> activity = new AtomicReference<>(); scenario.onActivity(activity::set);
            SpeechRuntime runtime = SpeechRuntime.get(context());
            JSONObject identity = identity();
            try {
                assertNull("No user playback may be replaced by this fixture", runtime.service);
                JSONObject inventory = request(runtime, "voices", new JSONObject().put("engine", "com.hihonor.voiceengine"), activity.get());
                String voice = null;
                JSONArray voices = inventory.getJSONArray("voices");
                for (int i = 0; i < voices.length(); i++) if (voices.getJSONObject(i).getString("language").startsWith("zh")) voice = voices.getJSONObject(i).getString("id");
                assertNotNull("This device acceptance requires its installed offline Chinese voice", voice);
                request(runtime, "prepare", identity, activity.get());
                request(runtime, "append", new JSONObject(identity.toString()).put("batchIndex", 0).put("firstSentenceIndex", 0)
                    .put("sentences", new JSONArray().put(sentence(0)).put(sentence(1))).put("final", true), activity.get());
                request(runtime, "commit", new JSONObject(identity.toString()).put("count", 2), activity.get());
                request(runtime, "start", new JSONObject(identity.toString()).put("leaseId", UUID.randomUUID().toString())
                    .put("title", "原创原生验收").put("engine", inventory.getString("engine")).put("voice", voice).put("rate", 1).put("timer", "chapter"), activity.get());
                JSONObject snapshot = null;
                long until = SystemClock.elapsedRealtime() + 20000;
                while (SystemClock.elapsedRealtime() < until) {
                    JSONObject result = request(runtime, "state", new JSONObject(), activity.get());
                    if (!result.isNull("snapshot")) {
                        snapshot = result.getJSONObject("snapshot");
                        if (snapshot.getString("state").equals("stopped") || snapshot.getString("state").equals("error")) break;
                    }
                    SystemClock.sleep(100);
                }
                assertNotNull(snapshot);
                assertEquals("chapter_timer", snapshot.optString("stopReason"));
                assertEquals("stopped", snapshot.getString("state"));
                assertEquals(1, snapshot.getInt("currentSentence"));
                assertNull(runtime.service);
                assertFalse(new File(runtime.queues, identity.getString("sessionId")).exists());
                assertFalse(new File(context().getNoBackupFilesDir(), "speech-audio").exists());
                JSONObject persisted = new JSONObject(new String(new AtomicFile(new File(context().getNoBackupFilesDir(), "speech-position.json")).readFully(), StandardCharsets.UTF_8));
                assertFalse(persisted.getJSONObject("snapshot").has("text"));
                Constructor<SpeechRuntime> constructor = SpeechRuntime.class.getDeclaredConstructor(Context.class); constructor.setAccessible(true);
                SpeechRuntime cold = constructor.newInstance(context());
                try {
                    JSONObject restored = request(cold, "state", new JSONObject(), activity.get()).getJSONObject("snapshot");
                    assertEquals("stopped", restored.getString("state"));
                    assertEquals("chapter_timer", restored.getString("stopReason"));
                    assertNull(cold.service);
                    assertEquals(0, SpeechProtocol.compare(snapshot.getJSONObject("resumeLocator"), restored.getJSONObject("resumeLocator")));
                } finally { cold.handler.getLooper().quitSafely(); }
            } finally { request(runtime, "reset", new JSONObject(), activity.get()); }
        }
    }
}
