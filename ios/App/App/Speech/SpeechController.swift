import AVFAudio
import Foundation

/// 应用级单会话听书控制器：合成器、状态机、定时与回调。
/// 所有业务状态都在 `queue` 串行队列上处理；事件统一经 onSnapshot 投递。
final class SpeechController: NSObject {

    enum SpeechError: Error, LocalizedError {
        case noSession
        case notReady
        case voiceUnavailable
        case badIndex
        case duplicateCommand

        var errorDescription: String? {
            switch self {
            case .noSession: return ReaderLanguage.text("听书会话不存在", "The listening session does not exist")
            case .notReady: return ReaderLanguage.text("听书文本尚未准备完成", "Listening text is not ready")
            case .voiceUnavailable: return ReaderLanguage.text("所选语音不可用，请重新选择", "The selected voice is unavailable. Choose another voice")
            case .badIndex: return ReaderLanguage.text("听书位置超出范围", "Listening position is out of range")
            case .duplicateCommand: return ReaderLanguage.text("重复的听书命令", "Duplicate listening command")
            }
        }
    }

    private let queue = DispatchQueue.main
    private let store = SpeechQueueStore()
    private let audio = SpeechAudioSession()
    private let remote = SpeechRemoteControls()
    private let synthesizer = AVSpeechSynthesizer()

    /// 状态变更通知；参数即 TS 侧 SpeechSnapshot 字段。
    var onSnapshot: (([String: Any]) -> Void)?

    // MARK: - 会话状态

    private var state = "idle"
    private var sessionId = ""
    private var bookId = ""
    private var contentRevision = 0
    private var generation = 0
    private var sequence = 0
    private var total = 0

    // MARK: - 播放位置

    private var currentIndex = -1
    private var currentSentence: [String: Any]?
    private var resumeLocator: [String: Any]?
    /// 句子缓存窗口：预读少量，淘汰已读部分。
    private var buffer: [Int: [String: Any]] = [:]
    private var bufferAnchor = 0

    // MARK: - 语音与定时

    private var rate = 1.0
    private var voiceId: String?
    private var timerMode = "off"
    private var timerDeadline: TimeInterval?
    private var timerChapter = 0
    private var timerSource: DispatchSourceTimer?

    private var pauseRequested = false
    private var recentCommands = [String: TimeInterval]()
    private var utteranceTags: [ObjectIdentifier: (index: Int, generation: Int)] = [:]

    override init() {
        super.init()
        synthesizer.delegate = self
        audio.onEvent = { [weak self] event in
            self?.queue.async {
                switch event {
                case .interruptionBegan: self?.pauseNow(reason: "interruption")
                case .routeLost: self?.pauseNow(reason: "routeChange")
                }
            }
        }
        remote.onCommand = { [weak self] command in
            self?.queue.async {
                guard let self else { return }
                switch command {
                case .play: self.resumeNow()
                case .pause: self.pauseNow(reason: nil)
                case .stop: self.finish(reason: "user", ended: false)
                case .previous: self.skip(to: self.currentIndex - 1)
                case .next: self.skip(to: self.currentIndex + 1)
                }
            }
        }
    }

    /// 串行执行入口：插件方法都经此进入。
    func run(_ work: @escaping () throws -> Void, reply: @escaping (Error?) -> Void) {
        queue.async {
            do {
                try work()
                reply(nil)
            } catch {
                reply(error)
            }
        }
    }

    // MARK: - 语音

    func voiceList() -> [[String: Any]] {
        AVSpeechSynthesisVoice.speechVoices().map { voice in
            [
                "id": voice.identifier,
                "name": voice.name,
                "language": voice.language,
                "quality": String(describing: voice.quality),
            ]
        }
    }

    func setTitle(_ title: String) { remote.title = title }

    private func resolveVoice() -> AVSpeechSynthesisVoice? {
        if let voiceId, let voice = AVSpeechSynthesisVoice(identifier: voiceId) {
            return voice
        }
        return nil
    }

    // MARK: - 会话与准备

    func begin(session: [String: Any]) throws {
        generation += 1
        synthesizer.stopSpeaking(at: .immediate)
        remote.unregister()
        audio.deactivate()
        stopTimer()
        SpeechQueueStore.cleanupOrphans()
        try store.begin(session: session)
        sessionId = session["sessionId"] as? String ?? ""
        bookId = session["bookId"] as? String ?? ""
        contentRevision = session["contentRevision"] as? Int ?? 0
        state = "preparing"
        generation += 1
        sequence = 0
        total = 0
        currentIndex = -1
        currentSentence = nil
        resumeLocator = nil
        buffer = [:]
        pauseRequested = false
        utteranceTags = [:]
        timerMode = "off"
        timerDeadline = nil
        timerChapter = 0
        emit()
    }

    func append(batch: [String: Any]) throws {
        try store.append(batch: batch)
    }

    func commit(totalCount: Int) throws {
        try store.commit(totalCount: totalCount)
        total = totalCount
        guard totalCount > 0 else { throw SpeechError.notReady }
        currentIndex = 0
        currentSentence = try loadSentence(0)
        resumeLocator = currentSentence?["start"] as? [String: Any]
        state = "ready"
        emit()
    }

    func cancelPrepare() {
        generation += 1
        synthesizer.stopSpeaking(at: .immediate)
        remote.unregister()
        audio.deactivate()
        stopTimer()
        store.teardown()
        state = "idle"
        emit()
    }

    // MARK: - 控制命令

    func command(commandId: String, kind: String, at: Int?) throws {
        // 同一命令重试幂等；命令 id 保留 10 分钟窗口。
        let now = ProcessInfo.processInfo.systemUptime
        recentCommands = recentCommands.filter { now - $0.value < 600 }
        if recentCommands[commandId] != nil { return }

        switch kind {
        case "play": try play(at: at ?? max(0, resumeIndex()))
        case "pause": pauseNow(reason: "user")
        case "resume": resumeNow()
        case "stop": finish(reason: "user", ended: false)
        case "previous": skip(to: currentIndex - 1)
        case "next": skip(to: currentIndex + 1)
        default: throw SpeechError.badIndex
        }
        recentCommands[commandId] = now
    }

    private func resumeIndex() -> Int {
        // 续读点对应的句子：从检查点记下的 index 开始。
        currentIndex >= 0 ? currentIndex : 0
    }

    private func play(at index: Int) throws {
        guard state == "ready" || state == "paused" || state == "speaking" else {
            throw SpeechError.notReady
        }
        guard index >= 0, index < total else { throw SpeechError.badIndex }
        try audio.activate()
        remote.register()
        pauseRequested = false
        speak(index)
    }

    private func pauseNow(reason: String?) {
        guard state == "speaking" else { return }
        pauseRequested = true
        saveCheckpoint()
        remote.publish(playing: false, chapterTitle: currentChapterTitle())
        if synthesizer.isSpeaking || synthesizer.isPaused {
            // 暂停恰逢句间延迟时不一定有 didPause：按真实状态收口。
            if !synthesizer.pauseSpeaking(at: .immediate) {
                markPaused()
            }
        } else {
            markPaused()
        }
    }

    private func markPaused() {
        guard pauseRequested else { return }
        state = "paused"
        emit()
    }

    private func resumeNow() {
        guard state == "paused" else { return }
        if let deadline = timerDeadline, ProcessInfo.processInfo.systemUptime >= deadline { finish(reason: "timer", ended: false); return }
        pauseRequested = false
        remote.publish(playing: true, chapterTitle: currentChapterTitle())
        if synthesizer.isPaused {
            if synthesizer.continueSpeaking() {
                state = "speaking"
                emit()
            } else {
                // 续播失败：从当前句首重排，允许重读一句。
                generation += 1
                speak(currentIndex)
            }
        } else {
            generation += 1
            speak(currentIndex)
        }
    }

    private func skip(to index: Int) {
        guard state == "speaking" || state == "paused" else { return }
        guard index >= 0, index < total else { return }
        pauseRequested = false
        generation += 1
        synthesizer.stopSpeaking(at: .immediate)
        if state == "paused" {
            // 暂停中跳句只移动位置，不出声。
            currentIndex = index
            currentSentence = try? loadSentence(index)
            resumeLocator = currentSentence?["start"] as? [String: Any]
            saveCheckpoint()
            emit()
        } else {
            speak(index)
        }
    }

    // MARK: - 合成与队列

    private func currentChapterTitle() -> String? {
        currentSentence?["chapterTitle"] as? String
    }

    /// 按小窗口从队列文件取句子；越界抛错。
    private func loadSentence(_ index: Int) throws -> [String: Any] {
        if let cached = buffer[index] { return cached }
        // 向前后各留窗口：重读上一句不需要重读文件。
        let from = max(0, index - 2)
        let list = try store.sentences(from: from, count: 40)
        for sentence in list {
            if let i = sentence["index"] as? Int { buffer[i] = sentence }
        }
        bufferAnchor = from
        // 淘汰窗口前的旧句子。
        buffer = buffer.filter { $0.key >= max(0, index - 4) }
        guard let sentence = buffer[index] else { throw SpeechError.badIndex }
        return sentence
    }

    private func speak(_ index: Int) {
        do {
            if let deadline = timerDeadline, ProcessInfo.processInfo.systemUptime >= deadline { finish(reason: "timer", ended: false); return }
            guard !pauseRequested else {
                currentIndex = index
                markPaused()
                return
            }
            guard let voice = resolveVoice() else { throw SpeechError.voiceUnavailable }
            let sentence = try loadSentence(index)
            let text = sentence["text"] as? String ?? ""
            if text.isEmpty {
                advance(from: index)
                return
            }
            currentIndex = index
            currentSentence = sentence
            resumeLocator = sentence["start"] as? [String: Any]

            let utterance = AVSpeechUtterance(string: text)
            utterance.voice = voice
            utterance.rate = mappedRate()
            utteranceTags[ObjectIdentifier(utterance)] = (index, generation)
            if utteranceTags.count > 32 {
                utteranceTags = utteranceTags.filter { $0.value.generation == generation }
            }
            state = "speaking"
            remote.publish(playing: true, chapterTitle: currentChapterTitle())
            saveCheckpoint()
            emit()
            synthesizer.speak(utterance)
        } catch {
            fail("queueError", message: error.localizedDescription)
        }
    }

    /// 产品相对档位 → utterance.rate 合法区间（默认速率线性缩放并夹取）。
    private func mappedRate() -> Float {
        let scaled = AVSpeechUtteranceDefaultSpeechRate * Float(rate)
        return min(
            AVSpeechUtteranceMaximumSpeechRate,
            max(AVSpeechUtteranceMinimumSpeechRate, scaled)
        )
    }

    private func advance(from index: Int) {
        let next = index + 1
        if next >= total || chapterEnded(next) {
            finish(reason: next >= total ? "finished" : "chapterEnd", ended: true)
            return
        }
        speak(next)
    }

    private func chapterEnded(_ nextIndex: Int) -> Bool {
        guard timerMode == "chapter" else { return false }
        guard let sentence = try? loadSentence(nextIndex) else { return false }
        return (sentence["chapterIndex"] as? Int ?? timerChapter) != timerChapter
    }

    // MARK: - 定时

    func setTimer(mode: String) throws {
        guard ["off", "15m", "30m", "60m", "chapter"].contains(mode) else { throw SpeechError.badIndex }
        stopTimer()
        timerMode = mode
        timerDeadline = nil
        switch mode {
        case "15m", "30m", "60m":
            let minutes: TimeInterval = mode == "15m" ? 15 : mode == "30m" ? 30 : 60
            // 单调时钟含暂停与挂起；暂停时间计入分钟定时。
            timerDeadline = ProcessInfo.processInfo.systemUptime + minutes * 60
            armTimer()
        case "chapter":
            timerChapter = currentSentence?["chapterIndex"] as? Int ?? timerChapter
        default:
            timerMode = "off"
            stopTimer()
        }
        emit()
    }

    private func armTimer() {
        timerSource?.cancel()
        let source = DispatchSource.makeTimerSource(queue: queue)
        source.schedule(deadline: .now() + 2, repeating: 2)
        source.setEventHandler { [weak self] in
            guard let self else { return }
            guard let deadline = self.timerDeadline else { return }
            // 系统挂起期间也到期：恢复执行时立即检查。
            if ProcessInfo.processInfo.systemUptime >= deadline {
                self.timerDeadline = nil
                self.stopTimer()
                self.finish(reason: "timer", ended: false)
            }
        }
        source.resume()
        timerSource = source
    }

    private func stopTimer() {
        timerSource?.cancel()
        timerSource = nil
    }

    // MARK: - 语速与语音

    func setRate(_ value: Double) throws {
        guard value.isFinite, value >= 0.75, value <= 2.0 else { throw SpeechError.badIndex }
        rate = value
        emit()
        // 播放中改语速：新值只影响后续句，当前句不中断重读。
    }

    func setVoice(_ id: String) throws {
        guard AVSpeechSynthesisVoice(identifier: id) != nil else { throw SpeechError.voiceUnavailable }
        voiceId = id
        emit()
        if state == "speaking" {
            // 换语音从当前句首重排，允许重读一句。
            generation += 1
            synthesizer.stopSpeaking(at: .immediate)
            speak(currentIndex)
        }
    }

    // MARK: - 结束与错误

    private func finish(reason: String, ended: Bool) {
        pauseRequested = false
        generation += 1
        synthesizer.stopSpeaking(at: .immediate)
        saveCheckpoint()
        remote.unregister()
        audio.deactivate()
        stopTimer()
        if ended {
            state = "ended"
            emit(stopReason: reason)
            store.teardown()
        } else {
            state = "stopped"
            emit(stopReason: reason)
            store.teardown()
        }
    }

    private func fail(_ reason: String, message: String) {
        generation += 1
        synthesizer.stopSpeaking(at: .immediate)
        remote.unregister()
        audio.deactivate()
        stopTimer()
        state = "error"
        emit(stopReason: reason, error: message)
    }

    private func pauseNowAndEmit() {
        markPaused()
    }

    private func saveCheckpoint() {
        guard !sessionId.isEmpty, currentIndex >= 0 else { return }
        try? store.saveCheckpoint([
            "sessionId": sessionId,
            "bookId": bookId,
            "contentRevision": contentRevision,
            "generation": generation,
            "sequence": sequence,
            "currentIndex": currentIndex,
            "resumeLocator": resumeLocator ?? NSNull(),
        ])
    }

    // MARK: - 快照

    private func emit(stopReason: String? = nil, error: String? = nil) {
        sequence += 1
        onSnapshot?(snapshot(stopReason: stopReason, error: error))
    }

    func snapshot(
        stopReason: String? = nil,
        error: String? = nil
    ) -> [String: Any] {
        var snapshot: [String: Any] = [
            "sessionId": sessionId,
            "bookId": bookId,
            "contentRevision": contentRevision,
            "generation": generation,
            "sequence": sequence,
            "state": state,
            "rate": rate,
            "total": total,
            "capabilities": [
                "background": true,
                "mediaControls": true,
                "offlineVoices": false,
            ],
        ]
        if currentIndex >= 0 { snapshot["currentIndex"] = currentIndex }
        if let voiceId { snapshot["voiceId"] = voiceId }
        if let sentence = currentSentence {
            snapshot["currentSentence"] = [
                "index": currentIndex,
                "chapterIndex": sentence["chapterIndex"] ?? 0,
                "chapterTitle": sentence["chapterTitle"] ?? "",
                "start": sentence["start"] ?? NSNull(),
                "end": sentence["end"] ?? NSNull(),
                "sourceRanges": sentence["sourceRanges"] ?? [],
            ]
        }
        if let resumeLocator { snapshot["resumeLocator"] = resumeLocator }
        if let stopReason { snapshot["stopReason"] = stopReason }
        if let error { snapshot["error"] = error }
        if timerMode != "off" {
            var timer: [String: Any] = ["mode": timerMode]
            if let timerDeadline {
                let remain = timerDeadline - ProcessInfo.processInfo.systemUptime
                timer["remainingMs"] = max(0, remain) * 1000
            }
            snapshot["timer"] = timer
        }
        return snapshot
    }
}

// MARK: - AVSpeechSynthesizerDelegate

extension SpeechController: AVSpeechSynthesizerDelegate {

    private func tag(_ utterance: AVSpeechUtterance) -> (index: Int, generation: Int)? {
        utteranceTags[ObjectIdentifier(utterance)]
    }

    /// 迟到回调全部按代次丢弃，避免取消/跳句后旧回调继续排队。
    private func alive(_ utterance: AVSpeechUtterance) -> (index: Int, generation: Int)? {
        guard let tag = tag(utterance), tag.generation == generation else { return nil }
        return tag
    }

    func speechSynthesizer(
        _ synthesizer: AVSpeechSynthesizer,
        didStart utterance: AVSpeechUtterance
    ) {
        queue.async { [weak self] in
            guard let self, self.alive(utterance) != nil else { return }
            self.state = "speaking"
            self.emit()
        }
    }

    func speechSynthesizer(
        _ synthesizer: AVSpeechSynthesizer,
        didFinish utterance: AVSpeechUtterance
    ) {
        queue.async { [weak self] in
            guard let self, let tag = self.alive(utterance) else { return }
            self.utteranceTags.removeValue(forKey: ObjectIdentifier(utterance))
            if self.pauseRequested {
                self.markPaused()
            } else {
                self.advance(from: tag.index)
            }
        }
    }

    func speechSynthesizer(
        _ synthesizer: AVSpeechSynthesizer,
        didCancel utterance: AVSpeechUtterance
    ) {
        queue.async { [weak self] in
            guard let self, self.alive(utterance) != nil else { return }
            self.utteranceTags.removeValue(forKey: ObjectIdentifier(utterance))
            if self.pauseRequested { self.markPaused() }
        }
    }

    func speechSynthesizer(
        _ synthesizer: AVSpeechSynthesizer,
        didPause utterance: AVSpeechUtterance
    ) {
        queue.async { [weak self] in
            guard let self, self.alive(utterance) != nil else { return }
            self.pauseNowAndEmit()
        }
    }

    func speechSynthesizer(
        _ synthesizer: AVSpeechSynthesizer,
        didContinue utterance: AVSpeechUtterance
    ) {
        queue.async { [weak self] in
            guard let self, self.alive(utterance) != nil else { return }
            if self.state == "paused" {
                self.state = "speaking"
                self.emit()
            }
        }
    }
}
