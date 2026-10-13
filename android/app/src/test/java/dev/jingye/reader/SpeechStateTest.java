package dev.jingye.reader;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class SpeechStateTest {
    private JSONObject identity() throws Exception { return new JSONObject("{\"protocolVersion\":1,\"sessionId\":\"test\",\"bookId\":\"book\",\"contentRevision\":0,\"generation\":0}"); }
    private JSONObject sentence(int chapter, int paragraph) throws Exception {
        JSONObject start = new JSONObject().put("chapterIndex", chapter).put("paragraphIndex", paragraph).put("charOffset", 0);
        JSONObject end = new JSONObject(start.toString()).put("charOffset", 3);
        return new JSONObject().put("id", "book:0:" + chapter + ":" + paragraph + ":0-3").put("text", "正文。")
            .put("chapterTitle", "章").put("start", start).put("end", end)
            .put("sourceRanges", new JSONArray().put(new JSONObject().put("start", start).put("end", end)));
    }
    private SpeechState state() throws Exception { return new SpeechState(identity(), 3, sentence(0, 0)); }
    @Test public void stopThenResumeRereadsCurrentSentenceAndDiscardsEveryLateCallback() throws Exception {
        SpeechState state = state();
        String old = state.play(0, true); assertTrue(state.started(old));
        state.pause("user");
        assertFalse(state.done(old, sentence(0, 1), 10));
        String next = state.play(20, true);
        assertNotEquals(old, next);
        assertFalse(state.started(old));
        assertTrue(state.started(next));
        assertFalse(state.started(next));
        assertTrue(state.done(next, sentence(0, 1), 30));
        assertFalse(state.done(next, sentence(0, 1), 30));
        assertEquals(1, state.index());
    }
    @Test public void repeatedCommandCannotSkipTwiceEvenAfterManyCallbacks() throws Exception {
        SpeechState state = state();
        JSONObject cmd = identity().put("commandId", "skip-1");
        assertTrue(state.accept(cmd));
        state.move(1, sentence(0, 1));
        assertFalse(state.accept(cmd));
        assertFalse(state.accept(new JSONObject(cmd.toString()).put("generation", state.generation())));
        assertEquals(1, state.index());
        assertThrows(Exception.class, () -> state.accept(new JSONObject(cmd.toString()).put("sessionId", "other")));
    }
    @Test public void timerChangesDoNotInvalidateAudioTokenAndUseElapsedTime() throws Exception {
        SpeechState state = state();
        String token = state.play(500, true); state.started(token);
        assertTrue(state.accept(identity().put("commandId", "timer")));
        state.setTimer("15m", 1000);
        assertEquals(token, state.token());
        assertEquals(901000, state.deadline());
        state.pause("focus_loss");
        assertFalse(state.expired(900999));
        assertTrue(state.expired(901000));
        assertNull(state.play(901000, true));
        assertEquals("timer", state.reason());
        assertEquals(0, state.index());
    }
    @Test public void thirtyAndSixtyMinuteTimersAndChapterBoundary() throws Exception {
        SpeechState state = state();
        state.setTimer("30m", 0); assertEquals(1800000, state.deadline());
        state.setTimer("60m", 0); assertEquals(3600000, state.deadline());
        state.setTimer("chapter", 0); assertEquals(0, state.deadline());
        String token = state.play(0, true); state.started(token);
        state.done(token, sentence(1, 0), 100);
        assertEquals(SpeechState.Status.STOPPED, state.status());
        assertEquals("chapter_timer", state.reason());
        assertNull(state.token());
    }
    @Test public void skipOutOfChapterCancelsChapterTimerAndRateIsStrict() throws Exception {
        SpeechState state = state(); state.setTimer("chapter", 0);
        state.move(1, sentence(1, 0));
        assertEquals("off", state.snapshot().getString("timer"));
        assertEquals("chapter_timer_cancelled", state.reason());
        for (double rate : new double[]{Double.NaN, Double.POSITIVE_INFINITY, .7, 2.1, 1.023})
            assertThrows(Exception.class, () -> state.setRate(rate));
        for (double rate : new double[]{.75, 1, 1.05, 2}) { state.setRate(rate); assertEquals(rate, state.rate(), 0); }
    }
    @Test public void timeoutRetriesOnceAndFocusDenialCannotPlay() throws Exception {
        SpeechState state = state();
        assertNull(state.play(0, false));
        assertEquals(SpeechState.Status.PAUSED, state.status());
        String old = state.play(1, true);
        assertTrue(state.timedOut(old));
        assertFalse(state.timedOut(old));
        String retry = state.play(2, true);
        assertFalse(state.timedOut(retry));
        assertEquals(SpeechState.Status.ERROR, state.status());
        assertNull(state.play(3, true));
        assertFalse(state.snapshot().has("text"));
        assertFalse(state.snapshot().toString().contains("正文"));
    }
    @Test public void missingNextSentenceIsNotSuccessfulCompletion() throws Exception {
        SpeechState state = state(); String token = state.play(0, true); state.started(token);
        assertThrows(Exception.class, () -> state.done(token, null, 100));
        assertEquals(0, state.index());
        SpeechState last = new SpeechState(identity(), 1, sentence(0, 0));
        String lastToken = last.play(0, true); last.started(lastToken); last.done(lastToken, null, 100);
        assertEquals(SpeechState.Status.ENDED, last.status());
        assertNull(last.play(200, true));
        String ended = last.snapshot().toString();
        last.setRate(2); last.setTimer("15m", 1000); last.pause("late"); last.stop("late");
        assertEquals(ended, last.snapshot().toString());
    }
    @Test public void explicitSkipPastLastSentenceCompletesAndRejectsLateAudio() throws Exception {
        SpeechState state = new SpeechState(identity(), 1, sentence(0, 0));
        String token = state.play(0, true); state.started(token);
        state.completeBySkip();
        assertEquals(SpeechState.Status.ENDED, state.status());
        assertEquals("completed_skip", state.reason());
        assertFalse(state.done(token, null, 10));
        assertNull(state.play(20, true));
    }
}
