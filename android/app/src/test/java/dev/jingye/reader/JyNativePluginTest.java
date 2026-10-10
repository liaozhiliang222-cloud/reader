package dev.jingye.reader;

import java.io.ByteArrayInputStream;
import java.io.EOFException;
import java.io.InputStream;
import org.junit.Test;
import static org.junit.Assert.assertEquals;

public class JyNativePluginTest {
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
