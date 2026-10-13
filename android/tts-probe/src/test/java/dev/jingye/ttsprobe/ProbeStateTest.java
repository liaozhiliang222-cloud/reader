package dev.jingye.ttsprobe;

import org.junit.Test;
import static org.junit.Assert.*;

public class ProbeStateTest {
    @Test public void pauseAndLateDoneCannotSkipUnheardSentence() {
        ProbeState state = new ProbeState(10);
        String old = state.play(100, true);
        assertTrue(state.start(old));
        state.pause();
        assertFalse(state.done(old));
        assertEquals(0, state.index);
        String current = state.play(200, true);
        assertNotEquals(old, current);
        assertFalse(state.start(old));
        assertFalse(state.done(current));
        assertTrue(state.start(current));
        assertFalse(state.start(current));
        assertTrue(state.done(current));
        assertFalse(state.done(current));
        assertEquals(1, state.index);
    }
    @Test public void focusFailureAndExpiredTimerNeverPlay() {
        ProbeState state = new ProbeState(2);
        assertNull(state.play(100, false));
        assertEquals(ProbeState.Status.PAUSED, state.status);
        state.deadline = 200;
        assertNull(state.play(201, true));
        assertEquals(ProbeState.Status.STOPPED, state.status);
        assertEquals(0, state.index);
    }
    @Test public void chapterBoundaryCannotQueueNextChapter() {
        ProbeState state = new ProbeState(130);
        state.index = 63;
        state.chapterEnd = 64;
        String token = state.play(0, true);
        state.start(token);
        state.done(token);
        assertEquals(64, state.index);
        assertEquals(ProbeState.Status.STOPPED, state.status);
        assertNull(state.token());
    }
    @Test public void rapidSkipAndRateStyleRestartInvalidateCallbacks() {
        ProbeState state = new ProbeState(3);
        String first = state.play(0, true);
        state.start(first);
        state.skip(1);
        String second = state.play(1, true);
        state.start(second);
        state.pause();
        String changedRate = state.play(2, true);
        assertFalse(state.done(second));
        assertFalse(state.done(first));
        assertTrue(state.start(changedRate));
        assertEquals(1, state.index);
        state.skip(-1);
        state.skip(-1);
        assertEquals(0, state.index);
        state.skip(1); state.skip(1); state.skip(1);
        assertEquals(ProbeState.Status.ENDED, state.status);
    }
    @Test public void completedQueueAndErrorsAreTerminal() {
        ProbeState state = new ProbeState(1);
        String token = state.play(0, true);
        state.start(token); state.done(token);
        assertNull(state.play(10, true));
        assertEquals(ProbeState.Status.ENDED, state.status);
        ProbeState failed = new ProbeState(1);
        token = failed.play(0, true);
        failed.start(token); failed.fail();
        assertFalse(failed.done(token));
        assertNull(failed.play(10, true));
    }
}
