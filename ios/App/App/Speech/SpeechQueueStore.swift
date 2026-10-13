import Foundation

/// 听书会话队列存储：分块落盘、连续提交、检查点与清理。
/// 所有方法在 SpeechController 的串行队列上调用。
final class SpeechQueueStore {

    struct BatchInfo {
        let batchIndex: Int
        let firstSentenceIndex: Int
        let count: Int
        let final: Bool
        let url: URL
    }

    enum StoreError: Error, LocalizedError {
        case sessionMissing
        case batchOutOfOrder(expected: Int, got: Int)
        case batchConflict
        case batchOversized
        case sessionOversized
        case notCommitted
        case malformed

        var errorDescription: String? {
            switch self {
            case .sessionMissing: return "听书会话不存在或已被清理"
            case .batchOutOfOrder(let e, let g): return "听书批次顺序错误：期望 \(e)，收到 \(g)"
            case .batchConflict: return "听书批次内容冲突"
            case .batchOversized: return "听书批次超出大小限制"
            case .sessionOversized: return "听书会话超出大小限制"
            case .notCommitted: return "听书文本尚未准备完成"
            case .malformed: return "听书数据格式无效"
            }
        }
    }

    static let batchBytes = 128 * 1024
    static let batchSentences = 256
    static let sessionBytes = 64 * 1024 * 1024

    private let fm = FileManager.default
    private var rootDir: URL?
    private var sessionDir: URL?
    private(set) var session: [String: Any]?
    private var batches: [BatchInfo] = []
    private var totalBytes = 0
    private var committed = false
    private var total = 0
    /// 最近一次解码的批次缓存：按小窗口顺序读取，不全量入内存。
    private var decoded: (index: Int, sentences: [[String: Any]])?
    private(set) var checkpoint: [String: Any]?

    /// 应用私有 Application Support 子目录；锁屏可读、排除系统备份。
    static func prepareRoot(fileManager: FileManager = .default) throws -> URL {
        let support = try fileManager.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        let dir = support.appendingPathComponent("JySpeech", isDirectory: true)
        try fileManager.createDirectory(at: dir, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        var target = dir
        try target.setResourceValues(values)
        try fileManager.setAttributes(
            [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
            ofItemAtPath: dir.path
        )
        return dir
    }

    /// 冷启动清理孤立会话目录（进程终止即会话作废，不自动复活）。
    static func cleanupOrphans() {
        guard let dir = try? prepareRoot() else { return }
        for entry in (try? FileManager.default.contentsOfDirectory(
            at: dir,
            includingPropertiesForKeys: nil
        )) ?? [] {
            try? FileManager.default.removeItem(at: entry)
        }
    }

    // MARK: - 会话生命周期

    func begin(session: [String: Any]) throws {
        guard
            let sessionId = session["sessionId"] as? String,
            !sessionId.isEmpty,
            let bookId = session["bookId"] as? String,
            !bookId.isEmpty
        else { throw StoreError.malformed }
        teardown()
        let root = try Self.prepareRoot(fileManager: fm)
        rootDir = root
        let dir = root.appendingPathComponent(sessionId, isDirectory: true)
        try fm.createDirectory(at: dir, withIntermediateDirectories: true)
        sessionDir = dir
        self.session = session
        batches = []
        totalBytes = 0
        committed = false
        total = 0
        decoded = nil
        checkpoint = nil
        try writeJson(session, to: dir.appendingPathComponent("meta.json"))
    }

    func teardown() {
        if let dir = sessionDir {
            try? fm.removeItem(at: dir)
        }
        sessionDir = nil
        session = nil
        batches = []
        totalBytes = 0
        committed = false
        total = 0
        decoded = nil
        checkpoint = nil
    }

    // MARK: - 准备：分块 / 提交 / 取消

    func append(batch: [String: Any]) throws {
        guard let dir = sessionDir else { throw StoreError.sessionMissing }
        guard !committed else { throw StoreError.batchConflict }
        guard
            let batchIndex = batch["batchIndex"] as? Int,
            let firstIndex = batch["firstSentenceIndex"] as? Int,
            let sentences = batch["sentences"] as? [[String: Any]],
            let isFinal = batch["final"] as? Bool
        else { throw StoreError.malformed }

        // 重试幂等：相同序号的批次内容必须一致，否则拒绝。
        if let existing = batches.first(where: { $0.batchIndex == batchIndex }) {
            guard
                existing.firstSentenceIndex == firstIndex,
                existing.count == sentences.count,
                existing.final == isFinal
            else { throw StoreError.batchConflict }
            return
        }
        guard batchIndex == batches.count else {
            throw StoreError.batchOutOfOrder(expected: batches.count, got: batchIndex)
        }
        guard sentences.count <= Self.batchSentences else {
            throw StoreError.batchOversized
        }
        let expectedFirst = batches.last.map { $0.firstSentenceIndex + $0.count } ?? 0
        guard sentences.isEmpty || firstIndex == expectedFirst else {
            throw StoreError.batchOutOfOrder(expected: expectedFirst, got: firstIndex)
        }

        let data = try JSONSerialization.data(withJSONObject: batch)
        guard data.count <= Self.batchBytes + 4096 else {
            throw StoreError.batchOversized
        }
        if totalBytes + data.count > Self.sessionBytes {
            throw StoreError.sessionOversized
        }
        let url = dir.appendingPathComponent(String(format: "batch-%06d.json", batchIndex))
        try writeAtomically(data, to: url)
        batches.append(BatchInfo(
            batchIndex: batchIndex,
            firstSentenceIndex: firstIndex,
            count: sentences.count,
            final: isFinal,
            url: url
        ))
        totalBytes += data.count
    }

    /// 校验序列连续完整后才允许播放。
    func commit(totalCount: Int) throws {
        guard sessionDir != nil else { throw StoreError.sessionMissing }
        guard let last = batches.last, last.final else { throw StoreError.malformed }
        var expected = 0
        for info in batches {
            guard info.firstSentenceIndex == expected else { throw StoreError.malformed }
            expected += info.count
        }
        guard expected == totalCount else { throw StoreError.malformed }
        committed = true
        total = totalCount
    }

    // MARK: - 读取

    var committedTotal: Int { committed ? total : 0 }

    /// 返回 [fromIndex, fromIndex+count) 的句子，按小窗口从批次文件解码。
    func sentences(from fromIndex: Int, count: Int) throws -> [[String: Any]] {
        guard committed else { throw StoreError.notCommitted }
        var result: [[String: Any]] = []
        for info in batches {
            guard info.count > 0 else { continue }
            let range = info.firstSentenceIndex..<(info.firstSentenceIndex + info.count)
            let want = fromIndex..<(fromIndex + count)
            guard range.lowerBound < want.upperBound, want.lowerBound < range.upperBound else { continue }
            let file = try decode(info)
            for sentence in file {
                guard let index = sentence["index"] as? Int else { throw StoreError.malformed }
                if index >= fromIndex && index < fromIndex + count {
                    result.append(sentence)
                }
            }
        }
        return result
    }

    func sentenceCount() -> Int {
        batches.reduce(0) { $0 + $1.count }
    }

    private func decode(_ info: BatchInfo) throws -> [[String: Any]] {
        if let cached = decoded, cached.index == info.batchIndex {
            return cached.sentences
        }
        let data = try Data(contentsOf: info.url)
        guard
            let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            let sentences = object["sentences"] as? [[String: Any]]
        else { throw StoreError.malformed }
        decoded = (info.batchIndex, sentences)
        return sentences
    }

    // MARK: - 检查点

    func saveCheckpoint(_ value: [String: Any]) throws {
        guard let dir = sessionDir else { throw StoreError.sessionMissing }
        checkpoint = value
        try writeJson(value, to: dir.appendingPathComponent("checkpoint.json"))
    }

    // MARK: - 文件写入

    private func writeJson(_ object: [String: Any], to url: URL) throws {
        let data = try JSONSerialization.data(withJSONObject: object)
        try writeAtomically(data, to: url)
    }

    /// 原子替换写入后重新核对文件保护与备份属性。
    private func writeAtomically(_ data: Data, to url: URL) throws {
        try data.write(to: url, options: [.atomic])
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        var target = url
        try target.setResourceValues(values)
        try fm.setAttributes(
            [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
            ofItemAtPath: url.path
        )
    }
}
