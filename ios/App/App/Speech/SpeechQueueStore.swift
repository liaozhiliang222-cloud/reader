import Foundation
import Compression
import CryptoKit

/// Complete remaining queue is committed before playback; native reads one bounded batch.
final class SpeechQueueStore {
    struct BatchInfo {
        let batchIndex: Int
        let firstSentenceIndex: Int
        let count: Int
        let final: Bool
        let url: URL
        let digest: String
    }
    enum StoreError: Error, LocalizedError {
        case sessionMissing, batchConflict, batchOversized, sessionOversized, notCommitted, malformed
        case batchOutOfOrder(expected: Int, got: Int)
        var errorDescription: String? {
            switch self {
            case .sessionOversized: return "queue_too_large"
            case .batchOversized: return ReaderLanguage.text("听书批次超出大小限制", "The listening batch exceeds the size limit")
            case .batchConflict: return ReaderLanguage.text("听书批次内容冲突", "Conflicting listening batch content")
            case .notCommitted: return ReaderLanguage.text("听书文本尚未准备完成", "Listening text is not ready")
            case .sessionMissing: return ReaderLanguage.text("听书会话不存在", "The listening session does not exist")
            default: return ReaderLanguage.text("听书队列不完整或格式无效", "The listening queue is incomplete or invalid")
            }
        }
    }
    static let batchBytes = 128 * 1024
    static let batchSentences = 256
    static let sessionBytes = 64 * 1024 * 1024
    private(set) var session: [String: Any]?
    private var directory: URL?
    private var batches: [BatchInfo] = []
    private var compressedBytes = 0
    private var metaBytes = 0
    private var manifestBytes = 0
    private var committed = false
    private var total = 0
    private var decoded: (Int, [[String: Any]])?
    private(set) var checkpoint: [String: Any]?

    static func prepareRoot(fileManager: FileManager = .default) throws -> URL {
        let support = try fileManager.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        let dir = support.appendingPathComponent("JySpeech", isDirectory: true)
        try fileManager.createDirectory(at: dir, withIntermediateDirectories: true)
        var values = URLResourceValues(); values.isExcludedFromBackup = true
        var target = dir; try target.setResourceValues(values)
        try fileManager.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: dir.path)
        return dir
    }
    static func cleanupOrphans() {
        guard let root = try? prepareRoot() else { return }
        for entry in (try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: [.isDirectoryKey])) ?? [] {
            if (try? entry.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true {
                try? FileManager.default.removeItem(at: entry)
            }
        }
    }
    func begin(session: [String: Any]) throws {
        guard let id = session["sessionId"] as? String,
              id.range(of: "^[a-zA-Z0-9_-]{1,96}$", options: .regularExpression) != nil,
              session["protocolVersion"] as? Int == 1 else { throw StoreError.malformed }
        teardown()
        let dir = try Self.prepareRoot().appendingPathComponent(id, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        directory = dir; self.session = session
        let data = try json(session); metaBytes = data.count
        try write(data, to: dir.appendingPathComponent("meta.json"))
    }
    func teardown() {
        if let directory { try? FileManager.default.removeItem(at: directory) }
        directory = nil; session = nil; batches = []; compressedBytes = 0; metaBytes = 0; manifestBytes = 0
        committed = false; total = 0; decoded = nil; checkpoint = nil
    }
    func append(batch: [String: Any]) throws {
        guard let dir = directory else { throw StoreError.sessionMissing }
        guard !committed, let index = batch["batchIndex"] as? Int,
              let first = batch["firstSentenceIndex"] as? Int,
              let sentences = batch["sentences"] as? [[String: Any]],
              let final = batch["final"] as? Bool else { throw StoreError.malformed }
        let data = try json(batch)
        guard data.count <= Self.batchBytes, sentences.count <= Self.batchSentences else { throw StoreError.batchOversized }
        let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        if index >= 0, index < batches.count {
            guard batches[index].digest == digest else { throw StoreError.batchConflict }; return
        }
        guard index == batches.count, index < 10000, batches.last?.final != true else { throw StoreError.batchConflict }
        let expected = batches.last.map { $0.firstSentenceIndex + $0.count } ?? 0
        guard first == expected, !sentences.isEmpty else { throw StoreError.malformed }
        for (offset, sentence) in sentences.enumerated() {
            _ = offset
            guard let text = sentence["text"] as? String, !text.isEmpty, text.utf16.count <= 120,
                  let start = sentence["start"] as? [String: Any], validLocator(start),
                  let end = sentence["end"] as? [String: Any], validLocator(end),
                  let ranges = sentence["sourceRanges"] as? [[String: Any]], !ranges.isEmpty, ranges.count <= 120 else { throw StoreError.malformed }
            for range in ranges {
                guard let a = range["start"] as? [String: Any], let b = range["end"] as? [String: Any],
                      validLocator(a), validLocator(b) else { throw StoreError.malformed }
            }
        }
        let compressed = try (data as NSData).compressed(using: .lzfse) as Data
        let url = dir.appendingPathComponent(String(format: "batch-%06d.lzfse", index))
        let info = BatchInfo(batchIndex: index, firstSentenceIndex: first, count: sentences.count, final: final, url: url, digest: digest)
        var manifest = try manifestData([info]); manifest.append(0x0a)
        // Include metadata, actual manifest, and reserved bounded checkpoint space.
        guard compressedBytes + compressed.count + metaBytes + manifestBytes + manifest.count + 16384 <= Self.sessionBytes else { throw StoreError.sessionOversized }
        try write(compressed, to: url)
        do {
            let path = dir.appendingPathComponent("manifest.ndjson")
            if !FileManager.default.fileExists(atPath: path.path) { try write(Data(), to: path) }
            let handle = try FileHandle(forWritingTo: path); defer { try? handle.close() }
            try handle.seekToEnd(); try handle.write(contentsOf: manifest)
        }
        catch { try? FileManager.default.removeItem(at: url); throw error }
        compressedBytes += compressed.count; manifestBytes += manifest.count; batches.append(info)
    }
    func commit(totalCount: Int) throws {
        guard directory != nil, batches.last?.final == true, totalCount > 0,
              totalCount == batches.reduce(0, { $0 + $1.count }) else { throw StoreError.malformed }
        total = totalCount; committed = true
    }
    var committedTotal: Int { committed ? total : 0 }
    func sentenceCount() -> Int { batches.reduce(0) { $0 + $1.count } }
    func sentences(from fromIndex: Int, count: Int) throws -> [[String: Any]] {
        guard committed, fromIndex >= 0, count > 0, count <= 256 else { throw StoreError.notCommitted }
        var result: [[String: Any]] = []
        for info in batches where info.firstSentenceIndex < fromIndex + count && info.firstSentenceIndex + info.count > fromIndex {
            let list = try decode(info)
            result += list.filter { item in
                guard let index = item["index"] as? Int else { return false }
                return index >= fromIndex && index < fromIndex + count
            }
        }
        return result
    }
    private func decode(_ info: BatchInfo) throws -> [[String: Any]] {
        if let decoded, decoded.0 == info.batchIndex { return decoded.1 }
        let size = try info.url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
        guard size > 0, size <= Self.batchBytes + 1024 else { throw StoreError.malformed }
        let source = try Data(contentsOf: info.url)
        var bytes = [UInt8](repeating: 0, count: Self.batchBytes + 1)
        let decodedSize = bytes.withUnsafeMutableBufferPointer { destination in
            source.withUnsafeBytes { raw in
                compression_decode_buffer(destination.baseAddress!, destination.count, raw.bindMemory(to: UInt8.self).baseAddress!, source.count, nil, COMPRESSION_LZFSE)
            }
        }
        guard decodedSize > 0, decodedSize <= Self.batchBytes else { throw StoreError.malformed }
        let data = Data(bytes.prefix(decodedSize))
        let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        guard digest == info.digest,
              let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let sentences = object["sentences"] as? [[String: Any]], sentences.count == info.count else { throw StoreError.malformed }
        let indexed = sentences.enumerated().map { offset, original in
            var item = original; item["index"] = info.firstSentenceIndex + offset
            item["chapterIndex"] = (item["start"] as? [String: Any])?["chapterIndex"]
            return item
        }
        decoded = (info.batchIndex, indexed); return indexed
    }
    func saveCheckpoint(_ value: [String: Any]) throws {
        guard let directory else { throw StoreError.sessionMissing }
        let data = try json(value)
        guard data.count <= 16384 else { throw StoreError.malformed }
        try write(data, to: directory.appendingPathComponent("checkpoint.json")); checkpoint = value
    }
    private func validLocator(_ value: [String: Any]) -> Bool {
        ["chapterIndex", "paragraphIndex", "charOffset"].allSatisfy { key in
            guard let n = value[key] as? Int else { return false }; return n >= 0 && n <= Int(Int32.max)
        }
    }
    private func json(_ value: Any) throws -> Data { try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys, .withoutEscapingSlashes]) }
    private func manifestData(_ list: [BatchInfo]) throws -> Data {
        try json(list.map { ["batchIndex": $0.batchIndex, "firstSentenceIndex": $0.firstSentenceIndex, "count": $0.count, "final": $0.final, "sha256": $0.digest] as [String: Any] })
    }
    private func write(_ data: Data, to url: URL) throws {
        try data.write(to: url, options: [.atomic])
        try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: url.path)
        var target = url; var values = URLResourceValues(); values.isExcludedFromBackup = true
        try target.setResourceValues(values)
    }
}
