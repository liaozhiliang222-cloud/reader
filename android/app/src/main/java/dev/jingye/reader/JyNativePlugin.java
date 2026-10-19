package dev.jingye.reader;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.view.KeyEvent;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * 微光阅读原生桥：文件保存/分享、沉浸模式、常亮、content:// 读取、外部文件导入。
 * 仅本地能力，不涉及网络。
 */
@CapacitorPlugin(name = "JyNative")
public class JyNativePlugin extends Plugin {

    private File shareFile;
    private boolean speechForeground;
    private String speechLaunchBook;
    private java.util.function.Consumer<org.json.JSONObject> speechListener;

    @Override public void load() {
        speechForeground = true;
        speechLaunchBook = getActivity().getIntent().getStringExtra("speechBookId");
        speechListener = value -> {
            try { notifyListeners("speechChanged", new JSObject(value.toString())); }
            catch (Exception ignored) { /* UI fetches the authoritative snapshot on resume. */ }
        };
        SpeechRuntime.get(getContext()).listener = speechListener;
    }
    @Override protected void handleOnResume() { speechForeground = true; }
    @Override protected void handleOnPause() {
        speechForeground = false;
        SpeechRuntime.get(getContext()).background();
    }
    @Override protected void handleOnDestroy() {
        SpeechRuntime runtime = SpeechRuntime.get(getContext());
        if (runtime.listener == speechListener) runtime.listener = null;
    }
    @PluginMethod public void speech(PluginCall call) {
        SpeechRuntime.get(getContext()).request(call.getString("action", ""), call.getObject("args", new JSObject()), getActivity(), speechForeground,
            new SpeechRuntime.Reply() {
                @Override public void success(org.json.JSONObject value) {
                    try { call.resolve(new JSObject(value.toString())); }
                    catch (Exception error) { call.reject("听书状态读取失败"); }
                }
                @Override public void failure(String reason) { call.reject(reason); }
            });
    }
    @PluginMethod public void speechSettings(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try { getActivity().startActivity(new Intent("com.android.settings.TTS_SETTINGS")); call.resolve(); }
            catch (Exception error) {
                try { getActivity().startActivity(new Intent(android.provider.Settings.ACTION_ACCESSIBILITY_SETTINGS)); call.resolve(); }
                catch (Exception failure) { call.reject("请手动打开系统设置中的文字转语音设置。"); }
            }
        });
    }
    @PluginMethod public void speechLaunch(PluginCall call) {
        JSObject result = new JSObject(); result.put("bookId", speechLaunchBook == null ? org.json.JSONObject.NULL : speechLaunchBook);
        speechLaunchBook = null; call.resolve(result);
    }

    // ---- 保存：SAF「另存为」+ 分块写入 ----

    @PluginMethod
    public void pickSaveTarget(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(call.getString("mime", "application/octet-stream"));
        intent.putExtra(Intent.EXTRA_TITLE, call.getString("name", "jingye-backup"));
        startActivityForResult(call, intent, "saveTargetResult");
    }

    @ActivityCallback
    private void saveTargetResult(PluginCall call, ActivityResult result) {
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.reject("cancelled", "cancelled");
            return;
        }
        JSObject ret = new JSObject();
        ret.put("uri", result.getData().getData().toString());
        call.resolve(ret);
    }

    @PluginMethod
    public void writeUri(PluginCall call) {
        Uri uri = Uri.parse(call.getString("uri"));
        String mode = call.getBoolean("append", false) ? "wa" : "w";
        try (OutputStream os = getContext().getContentResolver().openOutputStream(uri, mode)) {
            if (os == null) {
                call.reject("无法打开目标文件");
                return;
            }
            os.write(Base64.decode(call.getString("data", ""), Base64.DEFAULT));
            call.resolve();
        } catch (Exception e) {
            call.reject("写入失败: " + e.getMessage(), e);
        }
    }

    // ---- 分享：写缓存文件后走系统分享面板 ----

    @PluginMethod
    public void shareChunk(PluginCall call) {
        try {
            if (!call.getBoolean("append", false) || shareFile == null) {
                File directory = new File(getContext().getCacheDir(), "shared");
                if (!directory.isDirectory() && !directory.mkdirs()) throw new java.io.IOException("无法创建分享目录");
                String name = call.getString("name", "jingye-share");
                if (name.isEmpty() || name.equals(".") || name.equals("..") || name.contains("/") || name.contains("\\")) {
                    call.reject("分享文件名无效");
                    return;
                }
                shareFile = new File(directory, name);
            }
            try (FileOutputStream fos = new FileOutputStream(shareFile, call.getBoolean("append", false))) {
                fos.write(Base64.decode(call.getString("data", ""), Base64.DEFAULT));
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("暂存失败: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void shareCacheFile(PluginCall call) {
        try {
            if (shareFile == null || !shareFile.exists()) {
                call.reject("没有可分享的文件");
                return;
            }
            Uri uri = FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                shareFile
            );
            Intent intent = new Intent(Intent.ACTION_SEND);
            intent.setType(call.getString("mime", "application/octet-stream"));
            intent.putExtra(Intent.EXTRA_STREAM, uri);
            intent.putExtra(Intent.EXTRA_TITLE, call.getString("name", shareFile.getName()));
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(intent, null);
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(chooser);
            call.resolve();
        } catch (Exception e) {
            call.reject("分享失败: " + e.getMessage(), e);
        }
    }

    // ---- 外部链接：交给系统浏览器；WebView 不支持 target=_blank ----

    @PluginMethod
    public void openUrl(PluginCall call) {
        String uri = call.getString("uri");
        if (uri == null || uri.isEmpty()) {
            call.reject("缺少链接地址");
            return;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(uri));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("无法打开链接: " + e.getMessage(), e);
        }
    }

    // ---- 音量键翻页：开关在 JS 侧，按键由 MainActivity.dispatchKeyEvent 转入 ----

    private volatile boolean volumeKeys;

    @PluginMethod
    public void setVolumeKeys(PluginCall call) {
        volumeKeys = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        call.resolve();
    }

    public boolean wantsVolumeKeys() {
        return volumeKeys && SpeechRuntime.get(getContext()).service == null;
    }

    /** 返回 true 表示按键已消费；仅在 JS 开启时触发。 */
    public boolean onVolumeKey(int keyCode) {
        if (!volumeKeys) return false;
        JSObject data = new JSObject();
        data.put("direction", keyCode == KeyEvent.KEYCODE_VOLUME_UP ? "prev" : "next");
        notifyListeners("volumeKey", data);
        return true;
    }

    // ---- 阅读辅助 ----

    @PluginMethod
    public void setImmersive(PluginCall call) {
        boolean enabled = call.getBoolean("enabled", false);
        Activity activity = getActivity();
        activity.runOnUiThread(() -> {
            Window window = activity.getWindow();
            View decor = window.getDecorView();
            WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, decor);
            if (enabled) {
                controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                controller.hide(WindowInsetsCompat.Type.systemBars());
            } else {
                controller.show(WindowInsetsCompat.Type.systemBars());
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void keepAwake(PluginCall call) {
        boolean enabled = call.getBoolean("enabled", false);
        getActivity().runOnUiThread(() -> {
            if (enabled) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            call.resolve();
        });
    }

    /**
     * targetSdk 35+ 强制 edge-to-edge，Window.setStatusBarColor 已失效；
     * 状态栏区域显示的是 DecorView 背景，直接给 DecorView 上色并切换图标明暗。
     */
    @PluginMethod
    public void statusBar(PluginCall call) {
        String color = call.getString("color");
        boolean dark = call.getBoolean("dark", false);
        Activity activity = getActivity();
        activity.runOnUiThread(() -> {
            Window window = activity.getWindow();
            View decor = window.getDecorView();
            if (color != null) decor.setBackgroundColor(Color.parseColor(color));
            WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, decor);
            controller.setAppearanceLightStatusBars(!dark);
            controller.setAppearanceLightNavigationBars(!dark);
            call.resolve();
        });
    }

    // ---- 外部文件导入（打开方式 / 分享到） ----

    @PluginMethod
    public void consumeLaunchFile(PluginCall call) {
        Intent intent = getActivity().getIntent();
        JSObject payload = describeIntent(intent);
        if (payload == null) {
            call.resolve(new JSObject());
            return;
        }
        getActivity().setIntent(new Intent(Intent.ACTION_MAIN));
        call.resolve(payload);
    }

    public void onNewIntent(Intent intent) {
        String book = intent.getStringExtra("speechBookId");
        if (book != null) { JSObject data = new JSObject(); data.put("bookId", book); notifyListeners("speechOpen", data, true); }
        JSObject payload = describeIntent(intent);
        if (payload != null) notifyListeners("incomingFile", payload, true);
    }

    /** 解析 VIEW / SEND / SEND_MULTIPLE，产出 { items: [{uri,name}], text? } */
    private JSObject describeIntent(Intent intent) {
        if (intent == null) return null;
        String action = intent.getAction();
        java.util.ArrayList<Uri> uris = new java.util.ArrayList<>();
        if (Intent.ACTION_VIEW.equals(action)) {
            Uri uri = intent.getData();
            if (uri != null) uris.add(uri);
        } else if (Intent.ACTION_SEND.equals(action)) {
            Uri uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (uri != null) uris.add(uri);
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            java.util.ArrayList<Uri> list = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (list != null) uris.addAll(list);
        } else {
            return null;
        }
        JSObject ret = new JSObject();
        com.getcapacitor.JSArray items = new com.getcapacitor.JSArray();
        for (Uri uri : uris) {
            String type = null;
            try {
                type = getContext().getContentResolver().getType(uri);
            } catch (Exception ignored) {}
            JSObject item = new JSObject();
            item.put("uri", uri.toString());
            item.put("name", displayName(uri, type));
            items.put(item);
        }
        ret.put("items", items);
        String text = intent.getStringExtra(Intent.EXTRA_TEXT);
        if (text != null && !text.isEmpty()) ret.put("text", text);
        return uris.isEmpty() && text == null ? null : ret;
    }

    private String displayName(Uri uri, String mime) {
        String name = null;
        try (Cursor cursor = getContext().getContentResolver().query(uri, null, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (index >= 0) name = cursor.getString(index);
            }
        } catch (Exception ignored) {}
        if (name == null) {
            String last = uri.getLastPathSegment();
            name = last == null ? "导入文件" : last;
        }
        // 导入按扩展名分发解析器；名字缺扩展名时按 MIME 补上
        if (!name.contains(".") && mime != null) {
            if (mime.equals("application/epub+zip")) name += ".epub";
            else if (mime.equals("text/markdown") || mime.equals("text/x-markdown")) name += ".md";
            else if (mime.equals("text/plain")) name += ".txt";
            else if (mime.equals("application/zip")) name += ".md.zip";
        }
        return name;
    }

    @PluginMethod
    public void readUriChunk(PluginCall call) {
        try {
            Uri uri = Uri.parse(call.getString("uri"));
            long offset = readOffset(call);
            int length = call.getInt("length", 512 * 1024);
            if (offset < 0 || length <= 0 || length > 512 * 1024) {
                call.reject("读取范围无效");
                return;
            }
            try (InputStream in = getContext().getContentResolver().openInputStream(uri)) {
                if (in == null) {
                    call.reject("无法读取文件");
                    return;
                }
                skipFully(in, offset);
                byte[] buffer = new byte[length];
                int read = 0;
                while (read < length) {
                    int n = in.read(buffer, read, length - read);
                    if (n < 0) break;
                    read += n;
                }
                byte[] data = read == length ? buffer : java.util.Arrays.copyOf(buffer, read);
                JSObject ret = new JSObject();
                ret.put("data", Base64.encodeToString(data, Base64.DEFAULT));
                ret.put("eof", read < length);
                call.resolve(ret);
            }
        } catch (Exception e) {
            call.reject("读取失败: " + e.getMessage(), e);
        }
    }

    /** PluginCall.getLong 仅接受 Long；WebView JSON 中的小整数实际为 Integer，不能回退成 0。 */
    static long readOffset(PluginCall call) throws org.json.JSONException {
        return call.getData().getLong("offset");
    }

    /** 某些 content provider 的 skip 返回 0；到 EOF 时拒绝，避免插件线程死循环。 */
    static void skipFully(InputStream in, long offset) throws java.io.IOException {
        long skipped = 0;
        while (skipped < offset) {
            long count = in.skip(offset - skipped);
            if (count > 0) skipped += count;
            else if (in.read() < 0) throw new java.io.EOFException("文件在读取期间已变短");
            else skipped++;
        }
    }
}
