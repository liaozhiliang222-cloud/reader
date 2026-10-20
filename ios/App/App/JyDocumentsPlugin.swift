import Capacitor
import CoreGraphics
import UIKit

/// All methods run on the plugin's serial queue. Only opaque handles cross the bridge.
final class PdfDocumentStore {
    private struct Entry {
        let url: URL
        var size = 0
        var document: CGPDFDocument?
    }
    private let root: URL
    private var prepared = false
    private var entries: [String: Entry] = [:]
    private let fileLimit = 50 * 1024 * 1024

    init(root: URL = FileManager.default.temporaryDirectory.appendingPathComponent("JyPdfDocuments", isDirectory: true)) {
        self.root = root
    }
    private func failure(_ message: String) -> NSError {
        NSError(domain: "JyPdf", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }
    func begin() throws -> String {
        if !prepared {
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
            for old in try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil) {
                try FileManager.default.removeItem(at: old)
            }
            var url = root; var values = URLResourceValues(); values.isExcludedFromBackup = true
            try url.setResourceValues(values)
            prepared = true
        }
        guard entries.count < 4 else { throw failure("打开的 PDF 过多，请先关闭其他文件。") }
        let handle = UUID().uuidString, url = root.appendingPathComponent(UUID().uuidString)
        guard FileManager.default.createFile(atPath: url.path, contents: nil) else { throw failure("无法暂存 PDF。") }
        do {
            try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: url.path)
        } catch {
            try? FileManager.default.removeItem(at: url)
            throw error
        }
        entries[handle] = Entry(url: url)
        return handle
    }
    func append(handle: String, data: Data, offset: Int) throws {
        guard var entry = entries[handle], entry.document == nil,
              offset == entry.size, !data.isEmpty, data.count <= 512 * 1024,
              entry.size + data.count <= fileLimit,
              entries.values.reduce(0, { $0 + $1.size }) + data.count <= 100 * 1024 * 1024 else {
            throw failure("PDF 数据顺序、大小或句柄无效。")
        }
        let file = try FileHandle(forWritingTo: entry.url); defer { try? file.close() }
        guard try file.seekToEnd() == UInt64(offset) else { throw failure("PDF 临时文件大小不一致。") }
        try file.write(contentsOf: data)
        entry.size += data.count
        entries[handle] = entry
    }
    func open(handle: String) throws -> Int {
        guard var entry = entries[handle], entry.size > 0 else { throw failure("PDF 文件句柄无效。") }
        if let document = entry.document { return document.numberOfPages }
        guard let document = CGPDFDocument(entry.url as CFURL) else { throw failure("PDF 已损坏或无法读取。") }
        guard !document.isEncrypted else { throw failure("暂不支持加密或需要密码的 PDF。") }
        guard document.numberOfPages > 0, document.numberOfPages <= 10000 else { throw failure("PDF 页数无效或超过 10000 页。") }
        entry.document = document
        entries[handle] = entry
        return document.numberOfPages
    }
    func render(handle: String, pageIndex: Int, requestedWidth: Int) throws -> (data: Data, width: Int, height: Int) {
        guard let document = entries[handle]?.document,
              pageIndex >= 0, pageIndex < document.numberOfPages,
              requestedWidth > 0, requestedWidth <= 4096,
              let page = document.page(at: pageIndex + 1) else { throw failure("PDF 页码、尺寸或句柄无效。") }
        let box = page.getBoxRect(.cropBox).intersection(page.getBoxRect(.mediaBox))
        guard box.width.isFinite, box.height.isFinite, box.width > 0, box.height > 0,
              box.width <= 144000, box.height <= 144000 else { throw failure("PDF 页面尺寸无效。") }
        let rotated = abs(page.rotationAngle % 180) == 90
        let pageWidth = rotated ? box.height : box.width, pageHeight = rotated ? box.width : box.height
        let scale = min(CGFloat(requestedWidth) / pageWidth, 4096 / pageHeight, sqrt(4_000_000 / (pageWidth * pageHeight)))
        let width = max(1, Int(floor(pageWidth * scale))), height = max(1, Int(floor(pageHeight * scale)))
        guard width <= 4096, height <= 4096, width * height <= 4_000_000,
              let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8,
                                      bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(),
                                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { throw failure("PDF 页面过大或内存不足。") }
        let bounds = CGRect(x: 0, y: 0, width: CGFloat(width), height: CGFloat(height))
        context.setFillColor(UIColor.white.cgColor); context.fill(bounds)
        // getDrawingTransform never scales up, so scale explicitly and let it only rotate/translate the crop box.
        context.scaleBy(x: CGFloat(width) / pageWidth, y: CGFloat(height) / pageHeight)
        context.concatenate(page.getDrawingTransform(.cropBox, rect: CGRect(x: 0, y: 0, width: pageWidth, height: pageHeight), rotate: 0, preserveAspectRatio: true))
        context.drawPDFPage(page)
        guard let image = context.makeImage(), let data = UIImage(cgImage: image).pngData() else { throw failure("无法绘制 PDF 页面。") }
        return (data, width, height)
    }
    func close(handle: String) throws {
        guard let entry = entries.removeValue(forKey: handle) else { return }
        try FileManager.default.removeItem(at: entry.url)
    }
    func teardown() {
        entries.removeAll()
        try? FileManager.default.removeItem(at: root)
        prepared = false
    }
}

@objc(JyDocumentsPlugin)
public class JyDocumentsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "JyDocumentsPlugin"
    public let jsName = "JyDocuments"
    public let pluginMethods: [CAPPluginMethod] = ["begin", "append", "openPdf", "renderPdf", "close"].map { CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise) }
    private let queue = DispatchQueue(label: "dev.weiguang.reader.pdf")
    private let documents = PdfDocumentStore()
    private func run(_ call: CAPPluginCall, _ work: @escaping () throws -> [String: Any]) {
        queue.async {
            autoreleasepool {
                do { call.resolve(try work()) }
                catch { call.reject(error.localizedDescription) }
            }
        }
    }
    @objc func begin(_ call: CAPPluginCall) {
        guard call.getString("kind") == "pdf" else { call.reject("iOS 此接口仅支持 PDF。"); return }
        run(call) { ["handle": try self.documents.begin()] }
    }
    @objc func append(_ call: CAPPluginCall) {
        guard let handle = call.getString("handle"), let offset = call.getInt("offset"),
              let encoded = call.getString("data"), encoded.count <= 710000,
              let data = Data(base64Encoded: encoded) else { call.reject("PDF 数据无效。"); return }
        run(call) { try self.documents.append(handle: handle, data: data, offset: offset); return [:] }
    }
    @objc func openPdf(_ call: CAPPluginCall) {
        guard let handle = call.getString("handle") else { call.reject("PDF 句柄无效。"); return }
        run(call) { ["pageCount": try self.documents.open(handle: handle)] }
    }
    @objc func renderPdf(_ call: CAPPluginCall) {
        guard let handle = call.getString("handle"), let page = call.getInt("pageIndex"),
              let width = call.getInt("width") else { call.reject("PDF 渲染参数无效。"); return }
        run(call) {
            let image = try self.documents.render(handle: handle, pageIndex: page, requestedWidth: width)
            return ["data": image.data.base64EncodedString(), "width": image.width, "height": image.height]
        }
    }
    @objc func close(_ call: CAPPluginCall) {
        guard let handle = call.getString("handle") else { call.reject("PDF 句柄无效。"); return }
        run(call) { try self.documents.close(handle: handle); return [:] }
    }
}
