package dev.jingye.reader;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import static org.junit.Assert.*;

public class SpeechQueueStoreTest {
    @Rule public TemporaryFolder temp = new TemporaryFolder();
    private JSONObject identity() throws Exception {
        return new JSONObject("{\"protocolVersion\":1,\"sessionId\":\"test\",\"bookId\":\"book\",\"contentRevision\":0,\"generation\":0}");
    }
    private JSONObject locator(int index, int offset) throws Exception {
        return new JSONObject().put("chapterIndex", index / 300).put("paragraphIndex", index % 300).put("charOffset", offset);
    }
    private JSONObject sentence(int index) throws Exception {
        return new JSONObject().put("id", "book:0:" + index / 300 + ":" + index % 300 + ":0-3")
            .put("text", "你好。").put("chapterTitle", "原创章节")
            .put("start", locator(index, 0)).put("end", locator(index, 3))
            .put("sourceRanges", new JSONArray().put(new JSONObject().put("start", locator(index, 0)).put("end", locator(index, 3))));
    }
    private JSONObject batch(int index, int first, int count, boolean last) throws Exception {
        JSONObject batch = identity();
        JSONArray sentences = new JSONArray();
        for (int i = first; i < first + count; i++) sentences.put(sentence(i));
        return batch.put("batchIndex", index).put("firstSentenceIndex", first).put("sentences", sentences).put("final", last);
    }
    @Test public void completeQueueCrossesWindowsAndChaptersAndReopensWithoutWebView() throws Exception {
        SpeechQueueStore store = SpeechQueueStore.prepare(temp.getRoot(), identity());
        store.append(batch(0, 0, 256, false)); store.append(batch(1, 256, 256, false)); store.append(batch(2, 512, 1, true));
        assertThrows(Exception.class, () -> store.sentence(0));
        store.commit(513);
        store.commit(513);
        SpeechQueueStore reopened = SpeechQueueStore.open(temp.getRoot(), identity());
        for (int i : new int[]{0, 255, 256, 299, 300, 511, 512, 3}) {
            JSONObject sentence = reopened.sentence(i);
            assertEquals(i / 300, sentence.getJSONObject("start").getInt("chapterIndex"));
            assertEquals(i % 300, sentence.getJSONObject("start").getInt("paragraphIndex"));
            sentence.put("text", "altered clone");
            assertEquals("你好。", reopened.sentence(i).getString("text"));
        }
        assertThrows(Exception.class, () -> reopened.sentence(513));
        assertTrue(reopened.bytes() > 0);
    }
    @Test public void retriesAreIdempotentButConflictsAndGapsFail() throws Exception {
        SpeechQueueStore store = SpeechQueueStore.prepare(temp.getRoot(), identity());
        JSONObject first = batch(0, 0, 2, false);
        store.append(first); long bytes = store.bytes();
        store.append(new JSONObject(first.toString()));
        assertEquals(2, store.count()); assertEquals(bytes, store.bytes());
        JSONObject conflict = batch(0, 0, 2, true);
        assertThrows(Exception.class, () -> store.append(conflict));
        assertThrows(Exception.class, () -> store.append(batch(2, 2, 1, true)));
        assertThrows(Exception.class, () -> store.append(batch(1, 3, 1, true)));
        store.append(batch(1, 2, 1, true)); store.commit(3);
        store.append(first);
        assertThrows(Exception.class, () -> store.append(batch(2, 3, 1, true)));
    }
    @Test public void missingFinalWrongCountAndUnknownProtocolCannotCommit() throws Exception {
        SpeechQueueStore store = SpeechQueueStore.prepare(temp.getRoot(), identity());
        store.append(batch(0, 0, 1, false));
        assertThrows(Exception.class, () -> store.commit(1));
        assertThrows(Exception.class, () -> SpeechQueueStore.open(temp.getRoot(), identity()));
        store.append(batch(1, 1, 1, true));
        assertThrows(Exception.class, () -> store.commit(1));
        assertThrows(Exception.class, () -> SpeechQueueStore.prepare(temp.getRoot(), identity().put("protocolVersion", 2)));
        assertThrows(Exception.class, () -> store.append(batch(0, 0, 1, false).put("generation", 1)));
    }
    @Test public void malformedOffsetsIdsCountsAndUnicodeAreRejected() throws Exception {
        for (String field : new String[]{"batchIndex", "firstSentenceIndex", "generation"}) {
            SpeechQueueStore store = SpeechQueueStore.prepare(temp.getRoot(), identity());
            assertThrows(Exception.class, () -> store.append(batch(0, 0, 1, true).put(field, 0.5)));
            store.discard();
        }
        SpeechQueueStore store = SpeechQueueStore.prepare(temp.getRoot(), identity());
        assertThrows(Exception.class, () -> store.append(batch(0, 0, 257, true)));
        assertThrows(Exception.class, () -> store.append(batch(0, 0, 0, true)));
        JSONObject bad = batch(0, 0, 1, true);
        bad.getJSONArray("sentences").getJSONObject(0).getJSONObject("end").put("charOffset", -1);
        assertThrows(Exception.class, () -> store.append(bad));
        JSONObject badId = batch(0, 0, 1, true);
        badId.getJSONArray("sentences").getJSONObject(0).put("id", "same-for-every-sentence");
        assertThrows(Exception.class, () -> store.append(badId));
        JSONObject surrogate = batch(0, 0, 1, true);
        surrogate.getJSONArray("sentences").getJSONObject(0).put("text", "\ud83d");
        assertThrows(Exception.class, () -> store.append(surrogate));
    }
    @Test public void corruptedBatchAndMissingFileAreErrorsNotNormalCompletion() throws Exception {
        SpeechQueueStore store = SpeechQueueStore.prepare(temp.getRoot(), identity());
        store.append(batch(0, 0, 1, false)); store.append(batch(1, 1, 1, true)); store.commit(2);
        File file = new File(temp.getRoot(), "test/batch-00001.json");
        Files.write(file.toPath(), "{}".getBytes(StandardCharsets.UTF_8));
        SpeechQueueStore opened = SpeechQueueStore.open(temp.getRoot(), identity());
        assertEquals("你好。", opened.sentence(0).getString("text"));
        assertThrows(Exception.class, () -> opened.sentence(1));
        assertThrows(Exception.class, () -> opened.sentence(0));
        assertTrue(file.delete());
        SpeechQueueStore missing = SpeechQueueStore.open(temp.getRoot(), identity());
        assertThrows(Exception.class, () -> missing.sentence(1));
    }
    @Test public void storageFailureCancelsCommitAndCleanupDoesNotTouchOtherData() throws Exception {
        File unrelated = temp.newFile("user-data.txt");
        File root = temp.newFolder("speech-queues");
        SpeechQueueStore store = SpeechQueueStore.prepare(root, identity());
        File obstruct = new File(root, "test/batch-00000.json.pending");
        assertTrue(obstruct.mkdir());
        assertThrows(Exception.class, () -> store.append(batch(0, 0, 1, true)));
        assertThrows(Exception.class, () -> store.commit(1));
        assertTrue(obstruct.delete());
        store.discard();
        assertTrue(unrelated.exists());
        assertThrows(Exception.class, () -> SpeechQueueStore.prepare(root, identity().put("sessionId", "../user-data.txt")));
        assertTrue(unrelated.exists());
    }
    @Test public void orphanCleanupPreservesOnlyActiveSession() throws Exception {
        File root = temp.newFolder("speech-queues");
        SpeechQueueStore.prepare(root, identity()).append(batch(0, 0, 1, false));
        SpeechQueueStore.prepare(root, identity().put("sessionId", "active"));
        SpeechQueueStore.cleanupOrphans(root, "active");
        assertFalse(new File(root, "test").exists());
        assertTrue(new File(root, "active").exists());
        SpeechQueueStore.cleanupOrphans(root, null);
        assertEquals(0, root.listFiles().length);
    }
}
