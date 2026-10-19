package dev.jingye.ttsprobe;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.os.Bundle;
import android.os.SystemClock;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import dev.jingye.reader.SpeechQueueStore;
import java.io.File;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONObject;

/** Local-only original-text throughput measurement, separate from playback. */
public class ProbeWebActivity extends Activity {
    private final AtomicBoolean cancelled = new AtomicBoolean();
    private Bridge bridge;
    private WebView web;
    private TextView status;
    private volatile long cancelRequested;
    private volatile boolean resumed;

    @Override @SuppressLint("SetJavaScriptEnabled") public void onCreate(Bundle state) {
        super.onCreate(state);
        bridge = new Bridge();
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (16 * getResources().getDisplayMetrics().density);
        layout.setPadding(pad, pad * 3, pad, pad);
        status = new TextView(this);
        status.setText("WebView → 原生完整队列；不会出声");
        layout.addView(status);
        button(layout, "桥接 10 万字单章", () -> run(100000, 1));
        button(layout, "桥接 200 万字千章", () -> run(2000000, 1000));
        button(layout, "桥接 200 万字单章", () -> run(2000000, 1));
        button(layout, "取消桥接准备", this::cancel);
        web = new WebView(this);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(false);
        web.getSettings().setBlockNetworkLoads(true);
        web.getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return true; }
        });
        web.addJavascriptInterface(bridge, "JyProbe");
        WebView.setWebContentsDebuggingEnabled(true); // This application has no release variant.
        layout.addView(web, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(layout);
        try (InputStream input = getAssets().open("prepare.html")) {
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            web.loadDataWithBaseURL("https://tts-probe.invalid/", output.toString("UTF-8"), "text/html", "UTF-8", null);
        } catch (Exception error) { status.setText("缺少探针网页：先执行 node scripts/build-tts-probe-web.mjs 再构建。"); }
    }
    private void button(LinearLayout layout, String label, Runnable action) {
        Button button = new Button(this);
        button.setText(label);
        button.setMinHeight((int) (48 * getResources().getDisplayMetrics().density));
        button.setOnClickListener(view -> action.run());
        layout.addView(button);
    }
    private void run(int size, int chapters) {
        web.evaluateJavascript("TtsPrepareProbe.run(" + size + "," + chapters + ")", null);
    }
    private void cancel() {
        cancelRequested = SystemClock.elapsedRealtime();
        cancelled.set(true);
        status.setText("已取消，正在清理部分队列。");
    }
    @Override public void onResume() { super.onResume(); resumed = true; }
    @Override public void onPause() { resumed = false; cancel(); super.onPause(); }
    @Override public void onDestroy() {
        web.removeJavascriptInterface("JyProbe");
        web.destroy();
        new Thread(bridge::cleanup, "tts-probe-cleanup").start();
        super.onDestroy();
    }

    public final class Bridge {
        private SpeechQueueStore queue;
        private long heapInitial, heapPeak;
        private final File root = new File(getNoBackupFilesDir(), "bridge-queues");
        private void sample() {
            heapPeak = Math.max(heapPeak, Runtime.getRuntime().totalMemory() - Runtime.getRuntime().freeMemory());
        }
        private void check() throws Exception { if (cancelled.get()) throw new Exception("cancelled"); }
        private String error(Exception error) {
            return "{\"error\":" + JSONObject.quote(error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage()) + "}";
        }
        @JavascriptInterface public synchronized String begin(String raw) {
            try {
                cleanup();
                cancelled.set(false); cancelRequested = 0;
                if (!resumed) throw new Exception("background");
                SpeechQueueStore.cleanupOrphans(root, null);
                heapInitial = Runtime.getRuntime().totalMemory() - Runtime.getRuntime().freeMemory();
                heapPeak = heapInitial;
                queue = SpeechQueueStore.prepare(root, new JSONObject(raw));
                return "{}";
            } catch (Exception error) { return error(error); }
        }
        @JavascriptInterface public synchronized String append(String raw) {
            try {
                check();
                if (queue == null) throw new Exception("queue_missing");
                JSONObject batch = new JSONObject(raw);
                sample();
                queue.append(batch);
                sample();
                check();
                return "{}";
            } catch (Exception error) { return error(error); }
        }
        @JavascriptInterface public synchronized String commit(int count) {
            try { check(); queue.commit(count); sample(); return "{}"; }
            catch (Exception error) { return error(error); }
        }
        @JavascriptInterface public synchronized void finish(String raw) {
            try {
                JSONObject report = new JSONObject(raw);
                report.put("javaInitialHeapBytes", heapInitial);
                report.put("javaSampledPeakHeapBytes", heapPeak);
                report.put("wallMs", System.currentTimeMillis());
                cleanup();
                report.put("cancelCleanupMs", cancelRequested == 0 ? JSONObject.NULL : SystemClock.elapsedRealtime() - cancelRequested);
                report.put("queueRemoved", !root.exists() || root.list() != null && root.list().length == 0);
                String name = "bridge-" + report.getInt("characters") + "-" + report.getInt("chapters")
                    + (cancelRequested == 0 ? "" : "-cancel") + ".json";
                ProbeQueue.write(new File(getFilesDir(), name), report.toString(2).getBytes(StandardCharsets.UTF_8));
                boolean removed = report.getBoolean("queueRemoved");
                runOnUiThread(() -> status.setText(removed ? "测量完成，报告已保存；临时正文已清理。" : "报告已保存，但临时队列清理失败。"));
            } catch (Exception error) { runOnUiThread(() -> status.setText("报告保存失败：" + error.getClass().getSimpleName())); }
        }
        synchronized void cleanup() {
            if (queue == null) return;
            try { queue.discard(); queue = null; }
            catch (Exception error) { runOnUiThread(() -> status.setText("临时队列清理失败。")); }
        }
    }
}
