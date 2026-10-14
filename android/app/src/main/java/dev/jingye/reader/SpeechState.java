package dev.jingye.reader;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.IOException;
import java.util.LinkedHashSet;

/** Pure single-thread state machine. Generation guards controls; utterance tokens
 * independently guard audio callbacks, so changing a timer does not replay audio. */
public final class SpeechState {
    public enum Status { READY, SPEAKING, PAUSED, ENDED, STOPPED, ERROR }
    private final JSONObject identity;
    private final int total;
    private Status status = Status.READY;
    private long generation;
    private long sequence;
    private long utteranceSerial;
    private String utterance;
    private boolean started;
    private int index;
    private JSONObject current;
    private String reason;
    private double rate = 1;
    private String timer = "off";
    private long deadline;
    private int timerChapter = -1;
    private int timeoutRetries;
    private final LinkedHashSet<String> recentCommands = new LinkedHashSet<>();

    public SpeechState(JSONObject input, int total, JSONObject first) throws Exception {
        identity = SpeechProtocol.identity(input);
        generation = identity.getLong("generation");
        if (total <= 0) throw new IOException("empty_queue");
        this.total = total;
        setCurrent(first);
    }
    public Status status() { return status; }
    public int index() { return index; }
    public long generation() { return generation; }
    public long deadline() { return deadline; }
    public double rate() { return rate; }
    public String token() { return utterance; }
    public String reason() { return reason; }
    public boolean terminal() { return status == Status.ENDED || status == Status.STOPPED || status == Status.ERROR; }

    /** Accept each control generation at most once. A retry/late UI command is
     * acknowledged with the current snapshot but cannot execute a second skip. */
    public boolean accept(JSONObject command) throws Exception {
        JSONObject expected = new JSONObject(identity.toString()).put("generation", generation);
        JSONObject commandIdentity = SpeechProtocol.identity(command);
        for (String field : new String[]{"sessionId", "bookId", "contentRevision", "protocolVersion"})
            if (!expected.get(field).toString().equals(commandIdentity.get(field).toString())) throw new IOException("stale_session");
        String commandId = SpeechProtocol.string(command, "commandId", 128);
        if (terminal() || recentCommands.contains(commandId) || commandIdentity.getLong("generation") != generation) return false;
        recentCommands.add(commandId);
        if (recentCommands.size() > 128) recentCommands.remove(recentCommands.iterator().next());
        generation++;
        sequence++;
        return true;
    }
    public String play(long elapsed, boolean focusGranted) {
        if (terminal()) return null;
        if (expired(elapsed)) { stop("timer"); return null; }
        if (!focusGranted) { pause("focus_denied"); return null; }
        if (status == Status.SPEAKING) return utterance;
        status = Status.SPEAKING; reason = null; sequence++;
        return issue();
    }
    private String issue() {
        started = false;
        utterance = identity.optString("sessionId") + ":" + (++utteranceSerial) + ":" + index;
        return utterance;
    }
    public boolean valid(String token) { return status == Status.SPEAKING && utterance != null && utterance.equals(token); }
    public boolean started(String token) {
        if (!valid(token) || started) return false;
        started = true; sequence++; return true;
    }
    /** The adapter loads at most the next sentence before calling done. null means
     * verified end of the committed queue, never a swallowed I/O exception. */
    public boolean done(String token, JSONObject next, long elapsed) throws Exception {
        if (!valid(token) || !started) return false;
        if (expired(elapsed)) { stop("timer"); return true; }
        if (index + 1 == total) {
            if (next != null) throw new IOException("queue_length_mismatch");
            utterance = null; started = false; status = Status.ENDED; reason = "completed"; sequence++; return true;
        }
        if (next == null) throw new IOException("queue_truncated");
        SpeechProtocol.sentence(next, identity);
        if (SpeechProtocol.compare(current.getJSONObject("end"), next.getJSONObject("start")) > 0) throw new IOException("queue_order");
        boolean chapterEnd = timerChapter >= 0 && next.getJSONObject("start").getInt("chapterIndex") != timerChapter;
        setCurrent(next); index++; timeoutRetries = 0; sequence++;
        if (chapterEnd) stop("chapter_timer"); else issue();
        return true;
    }
    private void setCurrent(JSONObject sentence) throws Exception {
        SpeechProtocol.sentence(sentence, identity);
        current = new JSONObject(sentence.toString());
    }
    public void pause(String why) {
        if (terminal()) return;
        utterance = null; started = false;
        status = Status.PAUSED; reason = why; generation++; sequence++;
    }
    public void stop(String why) {
        if (terminal()) return;
        pause(why); status = Status.STOPPED;
    }
    public void fail(String why) {
        if (terminal()) return;
        pause(why); status = Status.ERROR;
    }
    public void completeBySkip() {
        if (terminal()) return;
        utterance = null; started = false; generation++; sequence++;
        status = Status.ENDED; reason = "completed_skip";
    }
    public void move(int target, JSONObject sentence) throws Exception {
        if (terminal()) return;
        if (target < 0 || target >= total) throw new IOException("sentence_out_of_range");
        setCurrent(sentence);
        pause("skip"); index = target; timeoutRetries = 0;
        if (timerChapter >= 0 && sentence.getJSONObject("start").getInt("chapterIndex") != timerChapter) {
            timer = "off"; timerChapter = -1; reason = "chapter_timer_cancelled";
        }
    }
    public void setRate(double next) throws IOException {
        if (!Double.isFinite(next) || next < .75 || next > 2 || Math.abs(next * 20 - Math.rint(next * 20)) > .000001)
            throw new IOException("invalid_rate");
        if (terminal()) return;
        pause("rate"); rate = next;
    }
    public void setTimer(String next, long elapsed) throws Exception {
        if (terminal()) return;
        long minutes;
        switch (next) {
            case "off": case "chapter": minutes = 0; break;
            case "15m": minutes = 15; break;
            case "30m": minutes = 30; break;
            case "60m": minutes = 60; break;
            default: throw new IOException("invalid_timer");
        }
        timer = next;
        deadline = minutes == 0 ? 0 : Math.addExact(elapsed, minutes * 60000);
        timerChapter = "chapter".equals(next) ? current.getJSONObject("start").getInt("chapterIndex") : -1;
        sequence++;
    }
    public boolean expired(long elapsed) { return deadline != 0 && elapsed >= deadline; }
    /** Caller cancels actual synthesis before retrying. Maximum one automatic retry. */
    public boolean timedOut(String token) {
        if (!valid(token)) return false;
        if (timeoutRetries++ == 0) { pause("sentence_timeout_retry"); return true; }
        fail("sentence_timeout"); return false;
    }
    public JSONObject snapshot() throws Exception {
        JSONObject result = new JSONObject(identity.toString());
        result.put("generation", generation); result.put("sequence", sequence);
        result.put("state", status.name().toLowerCase(java.util.Locale.ROOT));
        result.put("currentSentence", index);
        result.put("resumeLocator", new JSONObject(current.getJSONObject("start").toString()));
        result.put("sourceRanges", new JSONArray(current.getJSONArray("sourceRanges").toString()));
        result.put("stopReason", reason == null ? JSONObject.NULL : reason);
        result.put("rate", rate); result.put("timer", timer);
        return result;
    }
}
