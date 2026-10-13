package dev.jingye.reader;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.IOException;

/** Pure protocol validation. Not registered with the bridge until T0 is accepted. */
public final class SpeechProtocol {
    public static final int VERSION = 1;
    public static final int MAX_BATCH_BYTES = 128 * 1024;
    public static final int MAX_SENTENCES = 256;
    public static final int MAX_SENTENCE_UNITS = 120;
    public static final long MAX_QUEUE_BYTES = 64L * 1024 * 1024;
    private SpeechProtocol() {}

    public static long integer(JSONObject object, String key, long maximum) throws IOException {
        Object value = object.opt(key);
        if (!(value instanceof Number)) throw new IOException("invalid_" + key);
        double number = ((Number) value).doubleValue();
        if (!Double.isFinite(number) || number < 0 || number > maximum || number != Math.floor(number))
            throw new IOException("invalid_" + key);
        return ((Number) value).longValue();
    }
    public static String string(JSONObject object, String key, int max) throws IOException {
        Object value = object.opt(key);
        if (!(value instanceof String) || ((String) value).isEmpty() || ((String) value).length() > max)
            throw new IOException("invalid_" + key);
        String text = (String) value;
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (Character.isHighSurrogate(c)) {
                if (++i >= text.length() || !Character.isLowSurrogate(text.charAt(i))) throw new IOException("invalid_unicode");
            } else if (Character.isLowSurrogate(c)) throw new IOException("invalid_unicode");
        }
        return text;
    }
    public static JSONObject identity(JSONObject input) throws Exception {
        if (integer(input, "protocolVersion", VERSION) != VERSION) throw new IOException("unsupported_protocol");
        String session = string(input, "sessionId", 96);
        if (!session.matches("[a-zA-Z0-9_-]+")) throw new IOException("invalid_session");
        JSONObject identity = new JSONObject();
        identity.put("protocolVersion", VERSION);
        identity.put("sessionId", session);
        identity.put("bookId", string(input, "bookId", 256));
        identity.put("contentRevision", integer(input, "contentRevision", 9007199254740991L));
        identity.put("generation", integer(input, "generation", 9007199254740991L));
        return identity;
    }
    public static void sameIdentity(JSONObject expected, JSONObject value) throws Exception {
        JSONObject actual = identity(value);
        for (String key : new String[]{"protocolVersion", "sessionId", "bookId", "contentRevision", "generation"})
            if (!expected.get(key).toString().equals(actual.get(key).toString())) throw new IOException("stale_session");
    }
    public static void locator(JSONObject value) throws IOException {
        integer(value, "chapterIndex", Integer.MAX_VALUE);
        integer(value, "paragraphIndex", Integer.MAX_VALUE);
        integer(value, "charOffset", Integer.MAX_VALUE);
    }
    public static int compare(JSONObject a, JSONObject b) throws Exception {
        locator(a); locator(b);
        for (String key : new String[]{"chapterIndex", "paragraphIndex", "charOffset"}) {
            int diff = Integer.compare(a.getInt(key), b.getInt(key));
            if (diff != 0) return diff;
        }
        return 0;
    }
    public static void sentence(JSONObject sentence, JSONObject identity) throws Exception {
        String text = string(sentence, "text", MAX_SENTENCE_UNITS);
        if (text.trim().isEmpty()) throw new IOException("empty_sentence");
        string(sentence, "chapterTitle", 4096);
        JSONObject start = sentence.getJSONObject("start"), end = sentence.getJSONObject("end");
        locator(start); locator(end);
        if (start.getInt("chapterIndex") != end.getInt("chapterIndex")
            || start.getInt("paragraphIndex") != end.getInt("paragraphIndex") || compare(start, end) >= 0)
            throw new IOException("invalid_sentence_range");
        JSONArray ranges = sentence.getJSONArray("sourceRanges");
        if (ranges.length() == 0 || ranges.length() > MAX_SENTENCE_UNITS) throw new IOException("invalid_source_ranges");
        JSONObject previousEnd = null;
        StringBuilder id = new StringBuilder(identity.getString("bookId"));
        id.append(':').append(identity.getLong("contentRevision")).append(':')
            .append(start.getInt("chapterIndex")).append(':').append(start.getInt("paragraphIndex")).append(':');
        for (int i = 0; i < ranges.length(); i++) {
            JSONObject range = ranges.getJSONObject(i), from = range.getJSONObject("start"), to = range.getJSONObject("end");
            locator(from); locator(to);
            if (from.getInt("chapterIndex") != start.getInt("chapterIndex") || to.getInt("chapterIndex") != start.getInt("chapterIndex")
                || from.getInt("paragraphIndex") != start.getInt("paragraphIndex") || to.getInt("paragraphIndex") != start.getInt("paragraphIndex")
                || compare(from, to) >= 0 || (previousEnd != null && compare(previousEnd, from) > 0)) throw new IOException("invalid_source_ranges");
            if (i == 0 && compare(start, from) != 0 || i == ranges.length() - 1 && compare(end, to) != 0)
                throw new IOException("invalid_sentence_endpoints");
            if (i > 0) id.append(',');
            id.append(from.getInt("charOffset")).append('-').append(to.getInt("charOffset"));
            previousEnd = to;
        }
        if (!id.toString().equals(string(sentence, "id", 8192))) throw new IOException("invalid_sentence_id");
    }
}
