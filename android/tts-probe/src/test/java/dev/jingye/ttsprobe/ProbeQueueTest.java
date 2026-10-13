package dev.jingye.ttsprobe;

import java.io.File;
import java.nio.file.Files;
import java.util.concurrent.CancellationException;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import static org.junit.Assert.*;

public class ProbeQueueTest {
    @Rule public TemporaryFolder temp = new TemporaryFolder();
    private File root() { return new File(temp.getRoot(), "queue"); }
    @Test public void committedQueueReadsAllTextAcrossWindowsAndChapters() throws Exception {
        ProbeQueue prepared = ProbeQueue.prepare(root(), 100_000, false, () -> false);
        ProbeQueue queue = ProbeQueue.open(root());
        int characters = 0;
        for (int i = 0; i < queue.count; i++) {
            assertEquals(i / 64, queue.sentence(i).getInt("chapter"));
            characters += queue.sentence(i).getString("text").length();
        }
        assertEquals(100_000, characters);
        assertEquals(prepared.bytes, queue.bytes);
        assertTrue(queue.count > 2 * ProbeQueue.WINDOW);
        ProbeQueue.clear(root());
        assertFalse(root().exists());
    }
    @Test public void twoMillionCharactersStayWithinLimit() throws Exception {
        ProbeQueue queue = ProbeQueue.prepare(root(), 2_000_000, false, () -> false);
        assertTrue(queue.bytes < ProbeQueue.MAX_BYTES);
        assertFalse(queue.sentence(queue.count - 1).getString("text").isEmpty());
        assertThrows(Exception.class, () -> queue.sentence(queue.count));
    }
    @Test public void cancellationRemovesPartialQueueAndCannotCommit() {
        AtomicInteger checks = new AtomicInteger();
        assertThrows(CancellationException.class, () -> ProbeQueue.prepare(root(), 100_000, false, () -> checks.incrementAndGet() > 2));
        assertFalse(root().exists());
        assertThrows(Exception.class, () -> ProbeQueue.open(root()));
    }
    @Test public void corruptedOrMissingBatchDoesNotLookLikeEndOfBook() throws Exception {
        ProbeQueue.prepare(root(), 100_000, false, () -> false);
        File batch = new File(root(), "batch-00001.json");
        Files.write(batch.toPath(), "[]".getBytes());
        ProbeQueue queue = ProbeQueue.open(root());
        assertThrows(Exception.class, () -> queue.sentence(128));
        assertTrue(batch.delete());
        assertThrows(Exception.class, () -> queue.sentence(128));
        assertEquals(0, queue.sentence(0).getInt("index"));
    }
    @Test public void outOfBudgetFixtureIsRejectedBeforeReplacingQueue() throws Exception {
        ProbeQueue old = ProbeQueue.prepare(root(), 1000, true, () -> false);
        assertThrows(Exception.class, () -> ProbeQueue.prepare(root(), 2_000_001, false, () -> false));
        assertEquals(old.count, ProbeQueue.open(root()).count);
    }
}
