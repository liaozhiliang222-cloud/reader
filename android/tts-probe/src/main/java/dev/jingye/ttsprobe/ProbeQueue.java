package dev.jingye.ttsprobe;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.CancellationException;
import java.util.function.BooleanSupplier;

/** Bounded private fixture queue. No WebView or runtime text supply. */
final class ProbeQueue {
    static final int WINDOW = 128;
    static final int MAX_BATCH_BYTES = 128 * 1024;
    static final long MAX_BYTES = 64L * 1024 * 1024;
    static final String ZH = "清晨，窗外的树叶轻轻摇动。我们沿着河边慢慢向前走，看看天空，也听听风的声音。这段文字专为静页听书测试编写，只用于检查离线播放、暂停恢复和跨章续读。";
    static final String EN = "The morning light falls across the quiet room. This original passage tests offline reading and pauses.";
    final File directory;
    final int count;
    final long bytes;
    private final JSONArray hashes;
    private int cachedBatch = -1;
    private JSONArray cached;

    private ProbeQueue(File directory, JSONObject manifest) throws Exception {
        this.directory = directory;
        count = manifest.getInt("count");
        bytes = manifest.getLong("bytes");
        hashes = manifest.getJSONArray("hashes");
        if (count <= 0 || count > 100000 || bytes < 0 || bytes > MAX_BYTES
            || hashes.length() != (count + WINDOW - 1) / WINDOW) throw new IOException("queue_manifest");
    }
    static ProbeQueue prepare(File root, int characters, boolean english, BooleanSupplier cancelled) throws Exception {
        if (characters < 1 || characters > 2_000_000) throw new IOException("fixture_size");
        clear(root);
        if (!root.mkdirs()) throw new IOException("queue_directory");
        String text = english ? EN : ZH;
        int count = (characters + text.length() - 1) / text.length();
        long total = 0;
        JSONArray hashes = new JSONArray();
        try {
            for (int first = 0; first < count; first += WINDOW) {
                if (cancelled.getAsBoolean()) throw new CancellationException();
                JSONArray batch = new JSONArray();
                for (int i = first; i < Math.min(count, first + WINDOW); i++) {
                    JSONObject row = new JSONObject();
                    row.put("index", i);
                    row.put("chapter", i / 64);
                    row.put("text", text.substring(0, Math.min(text.length(), characters - i * text.length())));
                    batch.put(row);
                }
                byte[] data = batch.toString().getBytes(StandardCharsets.UTF_8);
                if (data.length > MAX_BATCH_BYTES || total + data.length > MAX_BYTES) throw new IOException("queue_limit");
                write(batchFile(root, first / WINDOW), data);
                total += data.length;
                hashes.put(digest(data));
            }
            if (cancelled.getAsBoolean()) throw new CancellationException();
            JSONObject manifest = new JSONObject();
            manifest.put("count", count);
            manifest.put("characters", characters);
            manifest.put("bytes", total);
            manifest.put("hashes", hashes);
            write(new File(root, "committed.json"), manifest.toString().getBytes(StandardCharsets.UTF_8));
            return new ProbeQueue(root, manifest);
        } catch (Exception error) { clear(root); throw error; }
    }
    static ProbeQueue open(File root) throws Exception {
        return new ProbeQueue(root, new JSONObject(new String(read(new File(root, "committed.json")), StandardCharsets.UTF_8)));
    }
    JSONObject sentence(int index) throws Exception {
        if (index < 0 || index >= count) throw new IOException("queue_index");
        int batch = index / WINDOW;
        if (batch != cachedBatch) {
            byte[] data = read(batchFile(directory, batch));
            if (!hashes.getString(batch).equals(digest(data))) throw new IOException("queue_checksum");
            JSONArray rows = new JSONArray(new String(data, StandardCharsets.UTF_8));
            if (rows.length() != Math.min(WINDOW, count - batch * WINDOW)) throw new IOException("queue_count");
            cached = rows;
            cachedBatch = batch;
        }
        JSONObject row = cached.getJSONObject(index % WINDOW);
        if (row.getInt("index") != index || row.getInt("chapter") != index / 64
            || row.getString("text").length() > 120 || row.getString("text").isEmpty()) throw new IOException("queue_sentence");
        return row;
    }
    private static File batchFile(File root, int index) { return new File(root, String.format(Locale.ROOT, "batch-%05d.json", index)); }
    private static String digest(byte[] data) throws Exception {
        StringBuilder result = new StringBuilder();
        for (byte b : MessageDigest.getInstance("SHA-256").digest(data)) result.append(String.format(Locale.ROOT, "%02x", b & 255));
        return result.toString();
    }
    static void write(File file, byte[] data) throws IOException {
        try (FileOutputStream out = new FileOutputStream(file)) { out.write(data); out.getFD().sync(); }
    }
    private static byte[] read(File file) throws IOException {
        if (file.length() > MAX_BATCH_BYTES) throw new IOException("queue_limit");
        try (FileInputStream in = new FileInputStream(file)) {
            byte[] data = new byte[(int) file.length()];
            int offset = 0;
            while (offset < data.length) {
                int read = in.read(data, offset, data.length - offset);
                if (read < 0) throw new IOException("queue_truncated");
                offset += read;
            }
            if (in.read() != -1) throw new IOException("queue_changed");
            return data;
        }
    }
    /** Only the fixed private fixture directory is supplied; no external paths. */
    static void clear(File root) throws IOException {
        if (!root.exists()) return;
        File[] files = root.listFiles();
        if (files == null) throw new IOException("queue_list");
        for (File file : files) if (!file.isFile() || !file.delete()) throw new IOException("queue_cleanup");
        if (!root.delete()) throw new IOException("queue_cleanup");
    }
}
