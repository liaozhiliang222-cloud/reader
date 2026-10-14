import Capacitor
import UIKit
import UniformTypeIdentifiers

@objc(JyReaderPlugin)
public class JyReaderPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    public let identifier = "JyReaderPlugin"
    public let jsName = "JyReader"
    public let pluginMethods = ["pickFiles", "consumeLaunchFile", "readUriChunk", "releaseImport", "shareChunk", "shareCacheFile", "setImmersive", "keepAwake", "statusBar", "openUrl"].map { CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise) }
    private static let queue = DispatchQueue(label: "dev.jingye.reader.files")
    private static weak var current: JyReaderPlugin?
    private static var pending: [[String: String]] = []
    private static var rootPrepared = false
    private static var imports: [String: URL] = [:]
    private var pickerCall: CAPPluginCall?
    private var shareNames: [String: URL] = [:]
    private static func root() throws -> URL {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("JyTransfers", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        if !rootPrepared {
            for old in (try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)) ?? [] { try? FileManager.default.removeItem(at: old) }
            rootPrepared = true
        }
        var target = root; var values = URLResourceValues(); values.isExcludedFromBackup = true
        try target.setResourceValues(values)
        return root
    }
    public override func load() { Self.current = self }
    static func accept(urls: [URL]) {
        queue.async {
            for url in urls {
                do { pending.append(try stage(url)) }
                catch { pending.append(["uri": "unavailable", "name": url.lastPathComponent]) }
            }
            DispatchQueue.main.async { current?.notifyListeners("incomingFile", data: [:]) }
        }
    }
    private static func stage(_ url: URL) throws -> [String: String] {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        if (try? url.resourceValues(forKeys: [.isUbiquitousItemKey]).isUbiquitousItem) == true {
            try FileManager.default.startDownloadingUbiquitousItem(at: url)
        }
        let handle = UUID().uuidString
        let destination = try root().appendingPathComponent(handle)
        var coordinationError: NSError?
        var failure: Error?
        let coordinator = NSFileCoordinator()
        coordinator.coordinate(readingItemAt: url, options: .withoutChanges, error: &coordinationError) { source in
            do {
                let attributes = try FileManager.default.attributesOfItem(atPath: source.path)
                guard (attributes[.type] as? FileAttributeType) == .typeRegular,
                      let size = attributes[.size] as? NSNumber, size.int64Value <= 50 * 1024 * 1024 else {
                    throw NSError(domain: "JyFiles", code: 1, userInfo: [NSLocalizedDescriptionKey: "文件超过 50 MB 或尚未下载。"])
                }
                let used = try FileManager.default.contentsOfDirectory(at: try root(), includingPropertiesForKeys: [.fileSizeKey]).reduce(0) { total, file in total + ((try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0) }
                guard used + size.intValue <= 120 * 1024 * 1024 else {
                    throw NSError(domain: "JyFiles", code: 2, userInfo: [NSLocalizedDescriptionKey: "临时导入空间不足，请完成当前导入后重试。"])
                }
                try FileManager.default.copyItem(at: source, to: destination)
                try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: destination.path)
            } catch { failure = error }
        }
        if let error = coordinationError { throw error }
        if let failure { throw failure }
        imports[handle] = destination
        return ["uri": handle, "name": url.lastPathComponent]
    }
    @objc func pickFiles(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.pickerCall == nil else { call.reject("已有文件选择窗口"); return }
            self.pickerCall = call
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.item], asCopy: false)
            picker.allowsMultipleSelection = true; picker.delegate = self
            self.bridge?.viewController?.present(picker, animated: true)
        }
    }
    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        pickerCall?.resolve(["items": []]); pickerCall = nil
    }
    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        let call = pickerCall; pickerCall = nil
        Self.queue.async {
            var items: [[String: String]] = []
            for url in urls {
                do { items.append(try Self.stage(url)) }
                catch { items.append(["uri": "unavailable", "name": url.lastPathComponent]) }
            }
            call?.resolve(["items": items])
        }
    }
    @objc func consumeLaunchFile(_ call: CAPPluginCall) {
        Self.queue.async { let items = Self.pending; Self.pending = []; call.resolve(["items": items]) }
    }
    @objc func readUriChunk(_ call: CAPPluginCall) {
        Self.queue.async {
            guard let id = call.getString("uri"), let url = Self.imports[id],
                  let offset = call.getInt("offset"), offset >= 0,
                  let length = call.getInt("length"), length > 0, length <= 512 * 1024 else { call.reject("导入文件句柄无效"); return }
            do {
                let file = try FileHandle(forReadingFrom: url); defer { try? file.close() }
                let size = try file.seekToEnd(); guard UInt64(offset) <= size else { call.reject("读取位置无效"); return }
                try file.seek(toOffset: UInt64(offset))
                let data = try file.read(upToCount: length) ?? Data()
                call.resolve(["data": data.base64EncodedString(), "eof": UInt64(offset + data.count) >= size])
            } catch { call.reject("读取失败，请等待文件下载完成后重试。") }
        }
    }
    @objc func releaseImport(_ call: CAPPluginCall) {
        Self.queue.async {
            if let id = call.getString("uri"), let url = Self.imports.removeValue(forKey: id) { try? FileManager.default.removeItem(at: url) }
            call.resolve()
        }
    }
    @objc func shareChunk(_ call: CAPPluginCall) {
        Self.queue.async {
            guard let name = call.getString("name"), name == (name as NSString).lastPathComponent,
                  let encoded = call.getString("data"), encoded.count <= 710000,
                  let data = Data(base64Encoded: encoded), data.count <= 512 * 1024 else { call.reject("分享文件无效"); return }
            do {
                let url: URL
                if call.getBool("append") == true, let old = self.shareNames[name] { url = old }
                else {
                    if let old = self.shareNames[name] { try? FileManager.default.removeItem(at: old.deletingLastPathComponent()) }
                    let dir = try Self.root().appendingPathComponent(UUID().uuidString, isDirectory: true)
                    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
                    url = dir.appendingPathComponent(name); self.shareNames[name] = url
                    FileManager.default.createFile(atPath: url.path, contents: nil)
                }
                let file = try FileHandle(forWritingTo: url); defer { try? file.close() }
                let length = try file.seekToEnd()
                guard length + UInt64(data.count) <= 512 * 1024 * 1024 else { call.reject("分享文件超过 512 MB"); return }
                try file.write(contentsOf: data); call.resolve()
            } catch { call.reject("无法暂存分享文件。") }
        }
    }
    @objc func shareCacheFile(_ call: CAPPluginCall) {
        Self.queue.async {
            guard let name = call.getString("name"), let url = self.shareNames[name] else { call.reject("分享文件不存在"); return }
            DispatchQueue.main.async {
                let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
                sheet.popoverPresentationController?.sourceView = self.bridge?.viewController?.view
                sheet.popoverPresentationController?.sourceRect = CGRect(x: 20, y: 20, width: 1, height: 1)
                sheet.completionWithItemsHandler = { _, completed, _, error in
                    Self.queue.async { self.shareNames.removeValue(forKey: name); try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
                    if let error { call.reject(error.localizedDescription) }
                    else if completed { call.resolve() }
                    else { call.reject("已取消保存或分享。") }
                }
                self.bridge?.viewController?.present(sheet, animated: true)
            }
        }
    }
    @objc func keepAwake(_ call: CAPPluginCall) {
        DispatchQueue.main.async { UIApplication.shared.isIdleTimerDisabled = call.getBool("enabled") ?? false; call.resolve() }
    }
    @objc func setImmersive(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            (self.bridge?.viewController as? ReaderBridgeViewController)?.immersive = call.getBool("enabled") ?? false
            self.bridge?.viewController?.setNeedsStatusBarAppearanceUpdate(); call.resolve()
        }
    }
    @objc func statusBar(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            (self.bridge?.viewController as? ReaderBridgeViewController)?.darkStatus = call.getBool("dark") ?? false
            self.bridge?.viewController?.setNeedsStatusBarAppearanceUpdate(); call.resolve()
        }
    }
    @objc func openUrl(_ call: CAPPluginCall) {
        guard let value = call.getString("uri"), let url = URL(string: value),
              ["https", "http", "mailto"].contains(url.scheme?.lowercased() ?? "") else { call.reject("链接协议不支持"); return }
        DispatchQueue.main.async { UIApplication.shared.open(url, options: [:]) { ok in if ok { call.resolve() } else { call.reject("无法打开链接") } } }
    }
}
