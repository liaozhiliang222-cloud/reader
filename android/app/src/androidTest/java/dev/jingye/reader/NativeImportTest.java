package dev.jingye.reader;

import android.content.Context;
import android.net.Uri;
import android.util.Base64;
import androidx.core.content.FileProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.io.File;
import java.io.FileOutputStream;
import java.util.Arrays;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** 真实 Android JSONObject + FileProvider，覆盖 JS mock 无法发现的 Integer/Long 类型差异。 */
@RunWith(AndroidJUnit4.class)
public class NativeImportTest {
    private static final int CHUNK = 512 * 1024;

    private static class CapturedCall extends PluginCall {
        JSObject result;
        String error;

        CapturedCall(JSObject data) {
            super(null, "JyNative", "fixture", "readUriChunk", data);
        }

        @Override public void resolve(JSObject data) { result = data; }
        @Override public void reject(String message, String code, Exception cause, JSObject data) {
            error = message;
        }
    }

    private void readAll(int size) throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File directory = new File(context.getCacheDir(), "shared");
        assertTrue(directory.isDirectory() || directory.mkdirs());
        File file = File.createTempFile("native-import-regression-", ".bin", directory);
        try {
            byte[] original = new byte[size];
            for (int i = 0; i < size; i++) original[i] = (byte) (i % 251);
            try (FileOutputStream out = new FileOutputStream(file)) { out.write(original); }
            Uri uri = FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", file);
            JyNativePlugin plugin = new JyNativePlugin() {
                @Override public Context getContext() { return context; }
            };
            int offset = 0;
            boolean eof = false;
            while (!eof) {
                // 与 WebView 桥相同：JSON 字符串解析后的普通偏移量是 Integer。
                JSObject data = new JSObject("{\"offset\":" + offset + ",\"length\":" + CHUNK + "}");
                assertTrue(data.opt("offset") instanceof Integer);
                data.put("uri", uri.toString());
                CapturedCall call = new CapturedCall(data);
                plugin.readUriChunk(call);
                assertNull(call.error);
                assertNotNull(call.result);
                byte[] bytes = Base64.decode(call.result.getString("data"), Base64.DEFAULT);
                assertArrayEquals("偏移 " + offset + " 必须返回对应原字节",
                    Arrays.copyOfRange(original, offset, Math.min(size, offset + CHUNK)), bytes);
                eof = call.result.getBoolean("eof");
                assertEquals(offset + CHUNK > size, eof);
                offset += bytes.length;
                assertTrue("非 EOF 读取必须前进", eof || bytes.length > 0);
            }
            assertEquals(size, offset);
        } finally {
            assertTrue("仅清理本测试生成的缓存文件", file.delete());
        }
    }

    @Test public void fourMegabytesReadAtEveryIntegerOffset() throws Exception { readAll(4433334); }
    @Test public void exactChunkBoundaryEndsWithEmptyEof() throws Exception { readAll(2 * CHUNK); }

    @Test public void negativeIntegerOffsetIsRejected() throws Exception {
        CapturedCall call = new CapturedCall(new JSObject("{\"uri\":\"content://fixture/unused\",\"offset\":-1,\"length\":1}"));
        new JyNativePlugin().readUriChunk(call);
        assertEquals("读取范围无效", call.error);
        assertNull(call.result);
    }
}
