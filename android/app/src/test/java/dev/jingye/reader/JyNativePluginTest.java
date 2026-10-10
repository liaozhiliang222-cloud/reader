package dev.jingye.reader;

import java.io.ByteArrayInputStream;
import java.io.EOFException;
import java.io.InputStream;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import org.junit.Test;
import static org.junit.Assert.assertEquals;

public class JyNativePluginTest {
    @Test public void webViewIntegerOffsetDoesNotFallBackToZero() throws Exception {
        JSObject data = new JSObject("{\"offset\":524288}");
        PluginCall call = new PluginCall(null, "JyNative", "fixture", "readUriChunk", data);
        assertEquals(Integer.class, data.opt("offset").getClass());
        assertEquals(0L, call.getLong("offset", 0L).longValue());
        assertEquals(524288L, JyNativePlugin.readOffset(call));
    }

    @Test public void longJsonOffsetAndNegativeIntegerRemainExact() throws Exception {
        for (long offset : new long[]{-1L, 0L, 524288L, 4433334L, 4294967296L}) {
            PluginCall call = new PluginCall(null, "JyNative", "fixture", "readUriChunk",
                new JSObject("{\"offset\":" + offset + "}"));
            assertEquals(offset, JyNativePlugin.readOffset(call));
        }
    }

    @Test(expected = org.json.JSONException.class)
    public void missingOffsetFailsInsteadOfSilentlyRewinding() throws Exception {
        JyNativePlugin.readOffset(new PluginCall(null, "JyNative", "fixture", "readUriChunk", new JSObject()));
    }

    private InputStream noSkip(byte[] bytes) {
        return new ByteArrayInputStream(bytes) {
            @Override public synchronized long skip(long count) { return 0; }
        };
    }

    @Test public void providerWithoutSkipStillReadsAtOffset() throws Exception {
        InputStream in = noSkip(new byte[]{11, 22, 33, 44});
        JyNativePlugin.skipFully(in, 2);
        assertEquals(33, in.read());
    }

    @Test(expected = EOFException.class)
    public void shortenedProviderFailsInsteadOfLooping() throws Exception {
        JyNativePlugin.skipFully(noSkip(new byte[]{11}), 3);
    }

    @Test public void exactEndAllowsEmptyFinalChunk() throws Exception {
        InputStream in = new ByteArrayInputStream(new byte[]{11, 22});
        JyNativePlugin.skipFully(in, 2);
        assertEquals(-1, in.read());
    }
}
