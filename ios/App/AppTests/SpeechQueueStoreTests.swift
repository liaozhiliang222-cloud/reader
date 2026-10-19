import XCTest
@testable import App

final class SpeechQueueStoreTests: XCTestCase {
    private func session() -> [String: Any] {
        ["protocolVersion": 1, "sessionId": UUID().uuidString, "bookId": "original-test", "contentRevision": 0, "generation": 0]
    }
    private func batch(_ index: Int, final: Bool, text: String = "原创测试。") -> [String: Any] {
        let start: [String: Any] = ["chapterIndex": index / 2, "paragraphIndex": 0, "charOffset": 0]
        let end: [String: Any] = ["chapterIndex": index / 2, "paragraphIndex": 0, "charOffset": text.utf16.count]
        return ["batchIndex": index, "firstSentenceIndex": index, "sentences": [["id": "sentence-\(index)", "text": text, "chapterTitle": "原创章节", "start": start, "end": end, "sourceRanges": [["start": start, "end": end]]]], "final": final]
    }
    func testNativeReadsAcrossBatchesWithoutJavaScript() throws {
        let store = SpeechQueueStore(); defer { store.teardown() }
        try store.begin(session: session())
        for index in 0..<6 { try store.append(batch: batch(index, final: index == 5)) }
        try store.commit(totalCount: 6)
        let sentences = try store.sentences(from: 1, count: 4)
        XCTAssertEqual(sentences.compactMap { $0["index"] as? Int }, [1, 2, 3, 4])
        XCTAssertEqual(sentences.last?["chapterIndex"] as? Int, 2)
    }
    func testIdenticalRetryAcceptedChangedTextRejected() throws {
        let store = SpeechQueueStore(); defer { store.teardown() }
        try store.begin(session: session())
        let original = batch(0, final: true)
        try store.append(batch: original); try store.append(batch: original)
        XCTAssertThrowsError(try store.append(batch: batch(0, final: true, text: "替换内容。")))
        try store.commit(totalCount: 1)
        XCTAssertEqual(try store.sentences(from: 0, count: 1).first?["text"] as? String, "原创测试。")
    }
    func testIncompleteOversizedAndUnsafeSessionRejected() throws {
        let store = SpeechQueueStore(); defer { store.teardown() }
        var unsafe = session(); unsafe["sessionId"] = "../outside"
        XCTAssertThrowsError(try store.begin(session: unsafe))
        try store.begin(session: session())
        XCTAssertThrowsError(try store.append(batch: batch(1, final: true)))
        XCTAssertThrowsError(try store.append(batch: batch(0, final: true, text: String(repeating: "字", count: 121))))
        try store.append(batch: batch(0, final: false))
        XCTAssertThrowsError(try store.commit(totalCount: 1))
    }
    func testLargeWireQueueFitsActualCompressedDiskBudget() throws {
        let store = SpeechQueueStore(); defer { store.teardown() }
        let identity = session(); try store.begin(session: identity)
        var wireBytes = 0
        let batches = 900, count = 128
        for index in 0..<batches {
            var value = batch(index, final: index == batches - 1, text: String(repeating: "原创", count: 60))
            var sentences: [[String: Any]] = []
            for offset in 0..<count {
                var sentence = (value["sentences"] as! [[String: Any]])[0]
                sentence["id"] = "r0-c\(index)-p\(offset)-" + String(repeating: "range-", count: 40)
                sentences.append(sentence)
            }
            value["firstSentenceIndex"] = index * count; value["sentences"] = sentences
            wireBytes += try JSONSerialization.data(withJSONObject: value).count
            try store.append(batch: value)
        }
        XCTAssertGreaterThan(wireBytes, SpeechQueueStore.sessionBytes)
        try store.commit(totalCount: batches * count)
        XCTAssertEqual(try store.sentences(from: batches * count - 1, count: 1).count, 1)
        let root = try SpeechQueueStore.prepareRoot().appendingPathComponent(identity["sessionId"] as! String)
        let disk = try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: [.fileSizeKey]).reduce(0) { total, url in total + ((try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0) }
        XCTAssertLessThan(disk, SpeechQueueStore.sessionBytes)
    }
}
