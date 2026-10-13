package dev.jingye.reader;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Iterator;
import java.util.Locale;
import java.util.zip.GZIPInputStream;
import java.util.zip.GZIPOutputStream;

/** Bounded append/commit store. Call exclusively on one serial I/O executor.
 * Root must be the app's private noBackupFilesDir/speech-queues, never a bridge path. */
public final class SpeechQueueStore {
    private static final int MAX_STORED_BATCH_BYTES = SpeechProtocol.MAX_BATCH_BYTES + 1024;
    private final File directory;
    private final JSONObject identity;
    private final boolean gzip;
    private final JSONArray entries = new JSONArray();
    private long bytes;
    private int count;
    private JSONObject lastEnd;
    private boolean finalReceived;
    private boolean committed;
    private boolean failed;
    private int cachedIndex = -1;
    private JSONArray cachedSentences;

    private SpeechQueueStore(File directory, JSONObject identity, boolean gzip) { this.directory = directory; this.identity = identity; this.gzip = gzip; }
    public static SpeechQueueStore prepare(File parent, JSONObject input) throws Exception {
        JSONObject identity = SpeechProtocol.identity(input);
        File directory = child(parent, identity.getString("sessionId"));
        if (directory.exists()) throw new IOException("session_exists");
        if (!directory.mkdirs()) throw new IOException("queue_storage_unavailable");
        return new SpeechQueueStore(directory, identity, true);
    }
    private static File child(File parent, String session) throws IOException {
        if (!session.matches("[a-zA-Z0-9_-]{1,96}")) throw new IOException("invalid_session");
        File file = new File(parent, session);
        if (!file.getCanonicalFile().getParentFile().equals(parent.getCanonicalFile())) throw new IOException("invalid_queue_path");
        return file;
    }
    public int count() { return count; }
    public long bytes() { return bytes; }
    public JSONObject identity() throws Exception { return new JSONObject(identity.toString()); }

    public void append(JSONObject batch) throws Exception {
        if (failed) throw new IOException("queue_failed");
        SpeechProtocol.sameIdentity(identity, batch);
        byte[] data = batch.toString().getBytes(StandardCharsets.UTF_8);
        if (data.length > SpeechProtocol.MAX_BATCH_BYTES) throw new IOException("batch_too_large");
        int index = (int) SpeechProtocol.integer(batch, "batchIndex", 10000);
        if (index < entries.length()) {
            // Retry only an identical accepted message, including identity/final/ranges.
            JSONObject accepted = readBatch(index);
            if (!sameJson(accepted, batch)) throw new IOException("batch_conflict");
            return;
        }
        if (committed || finalReceived) throw new IOException("queue_already_final");
        if (index != entries.length() || index >= 10000) throw new IOException("batch_out_of_order");
        if (SpeechProtocol.integer(batch, "firstSentenceIndex", Integer.MAX_VALUE) != count) throw new IOException("sentence_out_of_order");
        if (!(batch.opt("final") instanceof Boolean)) throw new IOException("invalid_final");
        JSONArray sentences = batch.getJSONArray("sentences");
        if (sentences.length() == 0 || sentences.length() > SpeechProtocol.MAX_SENTENCES) throw new IOException("invalid_batch_count");
        JSONObject end = lastEnd;
        for (int i = 0; i < sentences.length(); i++) {
            JSONObject sentence = sentences.getJSONObject(i);
            SpeechProtocol.sentence(sentence, identity);
            if (end != null && SpeechProtocol.compare(end, sentence.getJSONObject("start")) > 0) throw new IOException("overlapping_sentences");
            end = sentence.getJSONObject("end");
        }
        JSONObject entry = new JSONObject();
        // Keep the bridge contract and sentence locations unchanged; only the
        // private on-disk representation removes repeated JSON metadata.
        data = gzip ? compress(data) : data;
        if (data.length > MAX_STORED_BATCH_BYTES) throw new IOException("batch_too_large");
        entry.put("first", count); entry.put("count", sentences.length()); entry.put("bytes", data.length); entry.put("sha256", digest(data));
        // Reserve each compact manifest entry (plus bounded identity/header); no hidden overflow at commit.
        long metadataReserve = 2048L + (entries.length() + 1L) * 160;
        if (bytes + data.length + metadataReserve > SpeechProtocol.MAX_QUEUE_BYTES) throw new IOException("queue_too_large");
        try { writeAtomic(batchFile(index), data); }
        catch (Exception error) { failed = true; throw error; }
        entries.put(entry);
        bytes += data.length;
        count += sentences.length();
        lastEnd = end;
        finalReceived = batch.getBoolean("final");
    }
    public void commit(int expectedCount) throws Exception {
        if (failed || !finalReceived || count == 0 || expectedCount != count) throw new IOException("queue_incomplete");
        if (committed) return;
        JSONObject manifest = new JSONObject();
        manifest.put("identity", identity); manifest.put("entries", entries);
        manifest.put("count", count); manifest.put("bytes", bytes);
        manifest.put("encoding", gzip ? "gzip" : "json");
        byte[] data = manifest.toString().getBytes(StandardCharsets.UTF_8);
        if (bytes + data.length > SpeechProtocol.MAX_QUEUE_BYTES) throw new IOException("queue_too_large");
        try { writeAtomic(new File(directory, "committed.json"), data); }
        catch (Exception error) { failed = true; throw error; }
        committed = true;
    }
    public static SpeechQueueStore open(File parent, JSONObject expectedIdentity) throws Exception {
        JSONObject expected = SpeechProtocol.identity(expectedIdentity);
        File dir = child(parent, expected.getString("sessionId"));
        JSONObject manifest = new JSONObject(new String(read(new File(dir, "committed.json"), 2 * 1024 * 1024), StandardCharsets.UTF_8));
        SpeechProtocol.sameIdentity(expected, manifest.getJSONObject("identity"));
        String encoding = manifest.optString("encoding", "json");
        if (!encoding.equals("gzip") && !encoding.equals("json")) throw new IOException("invalid_queue_encoding");
        // Legacy uncompressed private queues can still be read after an upgrade.
        SpeechQueueStore store = new SpeechQueueStore(dir, expected, encoding.equals("gzip"));
        JSONArray entries = manifest.getJSONArray("entries");
        if (entries.length() == 0 || entries.length() > 10000) throw new IOException("invalid_queue_manifest");
        for (int i = 0; i < entries.length(); i++) {
            JSONObject entry = entries.getJSONObject(i);
            if (SpeechProtocol.integer(entry, "first", Integer.MAX_VALUE) != store.count) throw new IOException("invalid_queue_manifest");
            long count = SpeechProtocol.integer(entry, "count", SpeechProtocol.MAX_SENTENCES);
            if (count == 0 || !SpeechProtocol.string(entry, "sha256", 64).matches("[a-f0-9]{64}")) throw new IOException("invalid_queue_manifest");
            store.count += (int) count;
            store.bytes += SpeechProtocol.integer(entry, "bytes", store.gzip ? MAX_STORED_BATCH_BYTES : SpeechProtocol.MAX_BATCH_BYTES);
            store.entries.put(entry);
        }
        if (store.bytes + new File(dir, "committed.json").length() > SpeechProtocol.MAX_QUEUE_BYTES
            || store.count != SpeechProtocol.integer(manifest, "count", Integer.MAX_VALUE)
            || store.bytes != SpeechProtocol.integer(manifest, "bytes", SpeechProtocol.MAX_QUEUE_BYTES)) throw new IOException("invalid_queue_manifest");
        store.committed = true; store.finalReceived = true;
        return store;
    }
    public JSONObject sentence(int index) throws Exception {
        if (!committed || failed) throw new IOException("queue_not_ready");
        if (index < 0 || index >= count) throw new IOException("sentence_out_of_range");
        int low = 0, high = entries.length() - 1;
        while (low < high) {
            int mid = (low + high + 1) / 2;
            if (entries.getJSONObject(mid).getInt("first") <= index) low = mid; else high = mid - 1;
        }
        JSONObject entry = entries.getJSONObject(low);
        if (cachedIndex != low) {
            try {
                JSONObject batch = readBatch(low);
                SpeechProtocol.sameIdentity(identity, batch);
                JSONArray sentences = batch.getJSONArray("sentences");
                if (batch.getInt("batchIndex") != low || batch.getInt("firstSentenceIndex") != entry.getInt("first")
                    || sentences.length() != entry.getInt("count")) throw new IOException("queue_corrupt");
                cachedSentences = sentences; cachedIndex = low;
            } catch (Exception error) { failed = true; throw error; }
        }
        return new JSONObject(cachedSentences.getJSONObject(index - entry.getInt("first")).toString());
    }
    public void discard() throws IOException {
        failed = true; committed = false; cachedSentences = null;
        clearDirectory(directory);
    }
    public static void cleanupOrphans(File parent, String keepSession) throws IOException {
        if (!parent.exists()) return;
        File[] dirs = parent.listFiles();
        if (dirs == null) throw new IOException("queue_cleanup_failed");
        for (File dir : dirs) {
            if (dir.getName().equals(keepSession)) continue;
            File validated = child(parent, dir.getName());
            clearDirectory(validated);
        }
    }
    private static void clearDirectory(File dir) throws IOException {
        if (!dir.exists()) return;
        File[] files = dir.listFiles();
        if (files == null) throw new IOException("queue_cleanup_failed");
        for (File file : files) {
            if (!file.getCanonicalFile().getParentFile().equals(dir.getCanonicalFile()) || !file.isFile() || !file.delete())
                throw new IOException("queue_cleanup_failed");
        }
        if (!dir.delete()) throw new IOException("queue_cleanup_failed");
    }
    private File batchFile(int index) { return new File(directory, String.format(Locale.ROOT, gzip ? "batch-%05d.json.gz" : "batch-%05d.json", index)); }
    private JSONObject readBatch(int index) throws Exception {
        JSONObject entry = entries.getJSONObject(index);
        byte[] data = read(batchFile(index), gzip ? MAX_STORED_BATCH_BYTES : SpeechProtocol.MAX_BATCH_BYTES);
        if (data.length != entry.getInt("bytes") || !digest(data).equals(entry.getString("sha256"))) throw new IOException("queue_corrupt");
        if (gzip) data = decompress(data);
        return new JSONObject(new String(data, StandardCharsets.UTF_8));
    }
    private static byte[] compress(byte[] data) throws IOException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (GZIPOutputStream output = new GZIPOutputStream(bytes)) { output.write(data); }
        return bytes.toByteArray();
    }
    private static byte[] decompress(byte[] data) throws IOException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (GZIPInputStream input = new GZIPInputStream(new ByteArrayInputStream(data))) {
            byte[] buffer = new byte[8192];
            int length;
            while ((length = input.read(buffer)) != -1) {
                if (bytes.size() + length > SpeechProtocol.MAX_BATCH_BYTES) throw new IOException("queue_batch_expands_too_large");
                bytes.write(buffer, 0, length);
            }
        }
        return bytes.toByteArray();
    }
    private static boolean sameJson(Object a, Object b) throws Exception {
        if (a instanceof JSONObject && b instanceof JSONObject) {
            JSONObject left = (JSONObject) a, right = (JSONObject) b;
            if (left.length() != right.length()) return false;
            for (Iterator<String> keys = left.keys(); keys.hasNext();) {
                String key = keys.next();
                if (!right.has(key) || !sameJson(left.get(key), right.get(key))) return false;
            }
            return true;
        }
        if (a instanceof JSONArray && b instanceof JSONArray) {
            JSONArray left = (JSONArray) a, right = (JSONArray) b;
            if (left.length() != right.length()) return false;
            for (int i = 0; i < left.length(); i++) if (!sameJson(left.get(i), right.get(i))) return false;
            return true;
        }
        if (a instanceof Number && b instanceof Number) return a.toString().equals(b.toString());
        return a.equals(b);
    }
    private static String digest(byte[] bytes) throws Exception {
        StringBuilder result = new StringBuilder();
        for (byte b : MessageDigest.getInstance("SHA-256").digest(bytes)) result.append(String.format(Locale.ROOT, "%02x", b & 255));
        return result.toString();
    }
    private static void writeAtomic(File target, byte[] data) throws IOException {
        File temporary = new File(target.getParentFile(), target.getName() + ".pending");
        try (FileOutputStream out = new FileOutputStream(temporary)) { out.write(data); out.getFD().sync(); }
        if (target.exists() || !temporary.renameTo(target)) throw new IOException("queue_commit_failed");
    }
    private static byte[] read(File file, int limit) throws IOException {
        long size = file.length();
        if (size > limit) throw new IOException("queue_file_too_large");
        try (FileInputStream in = new FileInputStream(file)) {
            byte[] data = new byte[(int) size];
            int offset = 0;
            while (offset < data.length) {
                int n = in.read(data, offset, data.length - offset);
                if (n < 0) throw new IOException("queue_file_truncated");
                offset += n;
            }
            if (in.read() != -1) throw new IOException("queue_file_changed");
            return data;
        }
    }
}
