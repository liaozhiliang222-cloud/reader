package dev.jingye.ttsprobe;

/** Serial reducer: interrupted synthesis never advances the resume sentence. */
final class ProbeState {
    enum Status { READY, SPEAKING, PAUSED, ENDED, STOPPED, ERROR }
    Status status = Status.READY;
    int index;
    int generation;
    long sequence;
    final int count;
    long deadline;
    int chapterEnd = -1;
    private boolean started;
    private String pending;
    ProbeState(int count) {
        if (count <= 0) throw new IllegalArgumentException("empty_queue");
        this.count = count;
    }
    String play(long now, boolean focusGranted) {
        if (status == Status.ENDED || status == Status.STOPPED || status == Status.ERROR) return null;
        if (deadline != 0 && now >= deadline) { stop(); return null; }
        if (!focusGranted) { pause(); return null; }
        if (status == Status.SPEAKING) return pending;
        status = Status.SPEAKING;
        generation++;
        sequence++;
        return nextToken();
    }
    private String nextToken() {
        started = false;
        pending = generation + ":" + index + ":" + sequence;
        return pending;
    }
    boolean start(String token) {
        if (status != Status.SPEAKING || pending == null || !pending.equals(token) || started) return false;
        started = true;
        sequence++;
        return true;
    }
    boolean done(String token) {
        if (status != Status.SPEAKING || !started || !pending.equals(token)) return false;
        pending = null;
        started = false;
        index++;
        sequence++;
        if (index >= count) status = Status.ENDED;
        else if (chapterEnd >= 0 && index >= chapterEnd) status = Status.STOPPED;
        else nextToken();
        return true;
    }
    String token() { return pending; }
    void pause() {
        if (status == Status.ENDED || status == Status.STOPPED || status == Status.ERROR) return;
        generation++;
        sequence++;
        pending = null;
        started = false;
        status = Status.PAUSED;
    }
    void skip(int delta) {
        pause();
        if (status != Status.PAUSED) return;
        index = Math.max(0, Math.min(count, index + delta));
        if (index == count) status = Status.ENDED;
        if (chapterEnd >= 0 && index / 64 != (chapterEnd - 1) / 64) chapterEnd = -1;
    }
    void stop() { pause(); status = Status.STOPPED; sequence++; }
    void fail() { pause(); status = Status.ERROR; sequence++; }
}
