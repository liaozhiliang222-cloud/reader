import XCTest
import PDFKit
import UIKit
@testable import App

final class PdfDocumentStoreTests: XCTestCase {
    private func store() -> PdfDocumentStore {
        PdfDocumentStore(root: FileManager.default.temporaryDirectory.appendingPathComponent("PdfTest-" + UUID().uuidString))
    }
    private func fixture() throws -> Data {
        let renderer = UIGraphicsPDFRenderer(bounds: CGRect(x: 0, y: 0, width: 300, height: 500))
        let data = renderer.pdfData { context in
            for (index, color) in [UIColor.red, UIColor.blue, UIColor.green].enumerated() {
                context.beginPage()
                if index == 2 {
                    let scan = UIGraphicsImageRenderer(size: CGSize(width: 300, height: 500)).image { image in
                        image.cgContext.setFillColor(color.cgColor)
                        image.cgContext.fill(CGRect(x: 20, y: 30, width: 140, height: 180))
                    }
                    scan.draw(in: CGRect(x: 0, y: 0, width: 300, height: 500))
                    continue
                }
                context.cgContext.setFillColor(color.cgColor)
                context.cgContext.fill(CGRect(x: 20, y: 30, width: 140, height: 180))
                ("Original PDF fixture" as NSString).draw(at: CGPoint(x: 20, y: 240), withAttributes: [.font: UIFont.systemFont(ofSize: 18)])
            }
        }
        let document = try XCTUnwrap(PDFDocument(data: data))
        document.page(at: 1)?.rotation = 90
        document.page(at: 1)?.setBounds(CGRect(x: 10, y: 20, width: 250, height: 400), for: .cropBox)
        return try XCTUnwrap(document.dataRepresentation())
    }
    private func upload(_ data: Data, to store: PdfDocumentStore) throws -> String {
        let handle = try store.begin()
        for offset in stride(from: 0, to: data.count, by: 512 * 1024) {
            try store.append(handle: handle, data: data.subdata(in: offset..<min(offset + 512 * 1024, data.count)), offset: offset)
        }
        return handle
    }
    func testOriginalRotatedCroppedPagesRenderWithinBudget() throws {
        let store = store(); defer { store.teardown() }
        let handle = try upload(fixture(), to: store)
        XCTAssertEqual(try store.open(handle: handle), 3)
        let first = try store.render(handle: handle, pageIndex: 0, requestedWidth: 4096)
        let rotated = try store.render(handle: handle, pageIndex: 1, requestedWidth: 4096)
        let scanned = try store.render(handle: handle, pageIndex: 2, requestedWidth: 400)
        XCTAssertLessThan(first.width, first.height)
        XCTAssertGreaterThan(rotated.width, rotated.height)
        for page in [first, rotated, scanned] {
            XCTAssertLessThanOrEqual(page.width * page.height, 4_000_000)
            XCTAssertLessThanOrEqual(page.height, 4096)
            let image = try XCTUnwrap(UIImage(data: page.data)?.cgImage)
            XCTAssertEqual(image.width, page.width)
            XCTAssertEqual(image.height, page.height)
        }
        XCTAssertNotEqual(first.data, rotated.data)
        XCTAssertThrowsError(try store.render(handle: handle, pageIndex: 3, requestedWidth: 400))
        try store.close(handle: handle)
        XCTAssertThrowsError(try store.render(handle: handle, pageIndex: 0, requestedWidth: 400))
    }
    func testChunkOrderLimitsAndClosedHandles() throws {
        let store = store(); defer { store.teardown() }
        let data = try fixture(), handle = try store.begin()
        let middle = data.count / 2
        try store.append(handle: handle, data: data.prefix(middle), offset: 0)
        XCTAssertThrowsError(try store.append(handle: handle, data: data.suffix(data.count - middle), offset: 0))
        XCTAssertThrowsError(try store.append(handle: handle, data: Data(count: 512 * 1024 + 1), offset: middle))
        try store.append(handle: handle, data: data.suffix(data.count - middle), offset: middle)
        XCTAssertEqual(try store.open(handle: handle), 3)
        XCTAssertThrowsError(try store.append(handle: handle, data: Data([0]), offset: data.count))
        try store.close(handle: handle)
        try store.close(handle: handle)
        XCTAssertThrowsError(try store.append(handle: "../outside", data: data, offset: 0))
    }
    func testDamagedAndEncryptedDocumentsAreRejected() throws {
        let store = store(); defer { store.teardown() }
        let bad = try upload(Data("%PDF-invalid".utf8), to: store)
        XCTAssertThrowsError(try store.open(handle: bad))
        try store.close(handle: bad)
        let document = try XCTUnwrap(PDFDocument(data: fixture()))
        let encrypted = try XCTUnwrap(document.dataRepresentation(options: [PDFDocumentWriteOption.userPasswordOption: "test-only", PDFDocumentWriteOption.ownerPasswordOption: "owner-only"]))
        let handle = try upload(encrypted, to: store)
        XCTAssertThrowsError(try store.open(handle: handle))
    }
}
