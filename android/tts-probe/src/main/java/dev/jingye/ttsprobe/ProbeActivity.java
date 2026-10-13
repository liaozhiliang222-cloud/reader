package dev.jingye.ttsprobe;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.speech.tts.TextToSpeech;
import android.speech.tts.Voice;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONObject;

/** Physically separate diagnostic UI; contains only original synthetic fixtures. */
public class ProbeActivity extends Activity {
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final AtomicBoolean cancelled = new AtomicBoolean();
    private TextToSpeech tts;
    private TextView status;
    private LinearLayout layout;
    private Spinner voices;
    private List<Voice> available = new ArrayList<>();
    private String engine;
    private boolean resumed;
    private boolean preparing;
    private boolean ready;
    private boolean engineInitialized;
    private int initialization;
    private final Runnable refresh = new Runnable() {
        @Override public void run() {
            if (ProbeService.current != null) status.setText(ProbeService.summary);
            main.postDelayed(this, 1000);
        }
    };

    @Override public void onCreate(Bundle bundle) {
        super.onCreate(bundle);
        setVolumeControlStream(android.media.AudioManager.STREAM_MUSIC);
        ScrollView scroll = new ScrollView(this);
        layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        int padding = (int) (20 * getResources().getDisplayMetrics().density);
        layout.setPadding(padding, padding * 2, padding, padding * 2);
        scroll.addView(layout);
        setContentView(scroll);
        TextView intro = new TextView(this);
        intro.setText("静页听书探针 · T0\n独立测试 App，仅朗读原创测试文本。系统语音引擎为独立 App；只选择标记为已安装、无需联网的语音。测试结果不等于正式阅读器已验收。");
        intro.setTextSize(17);
        layout.addView(intro);
        status = new TextView(this);
        status.setTextSize(16);
        layout.addView(status);
        voices = new Spinner(this);
        voices.setMinimumHeight((int) (48 * getResources().getDisplayMetrics().density));
        layout.addView(voices);
        button("检查荣耀引擎", () -> initialize("com.hihonor.voiceengine"));
        button("检查 Google 引擎", () -> initialize("com.google.android.tts"));
        button("桥接准备性能", () -> {
            if (preparing || ProbeService.current != null) { status.setText("请先停止当前播放测试。"); return; }
            startActivity(new Intent(this, ProbeWebActivity.class));
        });
        button("准备 10 万字", () -> prepare(100_000));
        button("准备 200 万字", () -> prepare(2_000_000));
        button("取消准备", () -> cancelled.set(true));
        button("开始播放测试文本", () -> start(false));
        button("开始播放（应用出声）", () -> start(true));
        button("暂停", () -> command("pause"));
        button("继续", () -> command("resume"));
        button("上一句", () -> command("previous"));
        button("下一句", () -> command("next"));
        button("语速 0.75", () -> command("rate075"));
        button("语速 1.0", () -> command("rate100"));
        button("语速 2.0", () -> command("rate200"));
        button("15 分钟后停止", () -> command("timer15"));
        button("读完本章", () -> command("chapter"));
        button("取消定时", () -> command("timerOff"));
        button("测试音频焦点打断", () -> command("focusProbe"));
        button("停止并清理队列", () -> command("stop"));
        button("系统语音设置", () -> {
            try { startActivity(new Intent("com.android.settings.TTS_SETTINGS")); }
            catch (Exception error) { status.setText("请手动打开系统设置 → 辅助功能 → 文字转语音。"); }
        });
        initialize(getIntent().getStringExtra("engine"));
    }

    private void button(String title, Runnable action) {
        Button button = new Button(this);
        button.setText(title);
        button.setMinHeight((int) (48 * getResources().getDisplayMetrics().density));
        button.setOnClickListener(view -> action.run());
        layout.addView(button);
    }
    private void initialize(String selectedEngine) {
        if (preparing || ProbeService.current != null) { status.setText("请先停止当前测试。"); return; }
        ready = false;
        engineInitialized = false;
        available.clear();
        voices.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, new String[]{"检查语音中…"}));
        if (tts != null) tts.shutdown();
        int version = ++initialization;
        status.setText("正在初始化系统语音…");
        tts = new TextToSpeech(this, result -> main.post(() -> {
            if (version != initialization) return;
            if (result != TextToSpeech.SUCCESS) { status.setText("引擎初始化失败；可切换引擎或打开系统设置。"); return; }
            engineInitialized = true;
            engine = selectedEngine == null ? tts.getDefaultEngine() : selectedEngine;
            try {
                JSONObject report = ProbeVoices.inventory(this, tts, engine);
                ProbeQueue.write(new File(getFilesDir(), "voices-" + engine + ".json"), report.toString(2).getBytes(StandardCharsets.UTF_8));
                available = ProbeVoices.offline(tts);
                List<String> names = new ArrayList<>();
                int chinese = -1;
                for (int i = 0; i < available.size(); i++) {
                    Voice voice = available.get(i);
                    names.add(voice.getLocale().toLanguageTag() + " · " + voice.getName());
                    if (chinese < 0 && voice.getLocale().getLanguage().equals("zh")) chinese = i;
                }
                voices.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, names));
                if (chinese >= 0) voices.setSelection(chinese);
                status.setText("引擎：" + engine + "\n可选离线语音：" + names.size() + "；中文：" + (chinese >= 0 ? "有，尚待真实出声" : "无")
                    + "\n引擎拥有联网权限：" + report.getBoolean("engineInternetPermission"));
            } catch (Exception error) { status.setText("读取语音清单失败：" + error.getClass().getSimpleName()); }
        }), selectedEngine);
        main.postDelayed(() -> {
            if (version == initialization && !engineInitialized) {
                initialization++;
                tts.shutdown();
                status.setText("语音初始化超时，请重试。");
            }
        }, 15000);
    }
    private void prepare(int size) {
        if (preparing || ProbeService.current != null) { status.setText("请先停止当前测试。"); return; }
        Voice voice = selected();
        if (voice == null) return;
        ready = false;
        preparing = true;
        cancelled.set(false);
        status.setText("正在准备 " + size + " 字原创测试队列，可取消；切后台会取消。");
        io.execute(() -> {
            long begin = SystemClock.elapsedRealtime();
            try {
                ProbeQueue queue = ProbeQueue.prepare(new File(getNoBackupFilesDir(), "queue"), size,
                    voice.getLocale().getLanguage().equals("en"), cancelled::get);
                JSONObject report = new JSONObject();
                report.put("characters", size);
                report.put("sentences", queue.count);
                report.put("bytes", queue.bytes);
                report.put("prepareMs", SystemClock.elapsedRealtime() - begin);
                report.put("javaHeapAfterBytes", Runtime.getRuntime().totalMemory() - Runtime.getRuntime().freeMemory());
                report.put("note", "native fixture generation, not TS bridge throughput or measured peak memory");
                ProbeQueue.write(new File(getFilesDir(), "prepare-" + size + ".json"), report.toString(2).getBytes(StandardCharsets.UTF_8));
                main.post(() -> {
                    preparing = false;
                    ready = resumed && !cancelled.get();
                    status.setText(ready ? "已准备 " + queue.count + " 句。耗时 " + (SystemClock.elapsedRealtime() - begin) + "ms。点击开始才出声。" : "准备已取消，请重新准备。");
                    if (!ready) io.execute(() -> { try { ProbeQueue.clear(queue.directory); } catch (Exception ignored) { /* next preparation retries cleanup */ } });
                });
            } catch (Exception error) {
                main.post(() -> { preparing = false; status.setText("准备未完成：" + error.getClass().getSimpleName()); });
            }
        });
    }
    private Voice selected() {
        int index = voices.getSelectedItemPosition();
        if (index < 0 || index >= available.size()) { status.setText("没有已安装的离线语音。请先在系统中安装语音数据。"); return null; }
        return available.get(index);
    }
    private void start(boolean appPlayback) {
        Voice voice = selected();
        if (voice == null || !resumed) return;
        if (!ready) { status.setText("请先准备完整测试队列。"); return; }
        if (ProbeService.current != null) return;
        Intent intent = new Intent(this, ProbeService.class).setAction("start")
            .putExtra("engine", engine).putExtra("voice", voice.getName()).putExtra("appPlayback", appPlayback);
        try {
            if (android.os.Build.VERSION.SDK_INT >= 26) startForegroundService(intent); else startService(intent);
            ready = false;
        } catch (Exception error) { status.setText("无法启动前台服务：" + error.getClass().getSimpleName()); }
    }
    private void command(String action) {
        ProbeService service = ProbeService.current;
        if (service != null) service.command(action);
        else status.setText("当前没有活动播放服务，请重新准备。");
    }
    @Override public void onResume() { super.onResume(); resumed = true; main.post(refresh); }
    @Override public void onPause() {
        resumed = false;
        if (preparing) cancelled.set(true);
        main.removeCallbacks(refresh);
        super.onPause();
    }
    @Override public void onDestroy() {
        initialization++;
        main.removeCallbacksAndMessages(null);
        if (tts != null) tts.shutdown();
        cancelled.set(true);
        io.shutdown();
        super.onDestroy();
    }
}
