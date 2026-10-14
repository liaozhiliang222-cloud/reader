import Capacitor
import Foundation

@objc(JySpeechPlugin)
public class JySpeechPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "JySpeechPlugin"
    public let jsName = "JySpeech"
    public let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "speech", returnType: CAPPluginReturnPromise)]
    private let controller = SpeechController()
    private var identity: [String: Any] = [:]
    private var leaseId = ""
    private var pending: [String: Any]?
    private var active = false
    private var snapshotURL: URL? { try? SpeechQueueStore.prepareRoot().appendingPathComponent("last-snapshot.json") }

    public override func load() {
        if let url = snapshotURL, let data = try? Data(contentsOf: url) {
            pending = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            if pending != nil {
                pending?["state"] = "stopped"
                pending?["stopReason"] = "processTerminated"
                pending?["sequence"] = (pending?["sequence"] as? Int ?? 0) + 1
            }
        }
        SpeechQueueStore.cleanupOrphans()
        controller.onSnapshot = { [weak self] value in
            guard let self else { return }
            if let snapshot = self.normalized(value) {
                self.pending = snapshot
                if let url = self.snapshotURL, let data = try? JSONSerialization.data(withJSONObject: snapshot) {
                    try? data.write(to: url, options: [.atomic])
                    try? FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: url.path)
                }
            }
            if ["ended", "stopped", "error", "idle"].contains(value["state"] as? String ?? "") { self.active = false }
            self.notifyListeners("speechChanged", data: [:])
        }
    }

    private func normalized(_ value: [String: Any]) -> [String: Any]? {
        guard !leaseId.isEmpty,
              let sentence = value["currentSentence"] as? [String: Any],
              let start = sentence["start"] as? [String: Any],
              let ranges = sentence["sourceRanges"] as? [[String: Any]], !ranges.isEmpty else { return nil }
        var result = identity
        result["leaseId"] = leaseId
        result["generation"] = value["generation"] ?? 0
        result["sequence"] = value["sequence"] ?? 0
        result["state"] = value["stopReason"] as? String == "chapterEnd" ? "stopped" : value["state"]
        result["currentSentence"] = sentence["index"] ?? 0
        result["resumeLocator"] = value["resumeLocator"] ?? start
        result["sourceRanges"] = ranges
        result["rate"] = value["rate"] ?? 1.0
        result["timer"] = (value["timer"] as? [String: Any])?["mode"] ?? "off"
        result["stopReason"] = value["stopReason"] ?? NSNull()
        return result
    }

    private func matches(_ args: [String: Any]) -> Bool {
        ["sessionId", "bookId"].allSatisfy { (args[$0] as? String) == (identity[$0] as? String) }
            && (args["contentRevision"] as? Int) == (identity["contentRevision"] as? Int)
    }

    @objc func speech(_ call: CAPPluginCall) {
        guard let action = call.getString("action"), let args = call.getObject("args") else {
            call.reject("听书参数无效"); return
        }
        if ["start", "control"].contains(action), (action == "start" || args["action"] as? String == "resume"), !ProStore.shared.hasVerifiedEntitlement {
            call.reject("请先解锁 Pro 本地听书。"); return
        }
        if ["voices", "state"].contains(action) {
            controller.run({
                if action == "voices" {
                    call.resolve(["engine": "ios", "engines": [["id": "ios", "label": "iOS 系统语音"]],
                                  "voices": self.controller.voiceList(), "engineInternetPermission": false])
                } else { call.resolve(["snapshot": (self.pending as Any?) ?? NSNull(), "active": self.active]) }
            }, reply: { error in if let error { call.reject(error.localizedDescription) } })
            return
        }
        controller.run({
            switch action {
            case "prepare":
                guard args["protocolVersion"] as? Int == 1,
                      let id = args["sessionId"] as? String, id.range(of: "^[a-zA-Z0-9_-]{1,96}$", options: .regularExpression) != nil,
                      let book = args["bookId"] as? String, !book.isEmpty, book.count <= 256,
                      let revision = args["contentRevision"] as? Int, revision >= 0 else { throw SpeechQueueStore.StoreError.malformed }
                self.identity = args; self.leaseId = ""; self.pending = nil; self.active = true
                try self.controller.begin(session: args)
            case "append":
                guard self.matches(args), let first = args["firstSentenceIndex"] as? Int,
                      let sentences = args["sentences"] as? [[String: Any]] else { throw SpeechQueueStore.StoreError.malformed }
                _ = first; _ = sentences
                try self.controller.append(batch: args)
            case "commit":
                guard self.matches(args), let count = args["count"] as? Int else { throw SpeechQueueStore.StoreError.malformed }
                try self.controller.commit(totalCount: count)
            case "start":
                guard self.matches(args), let lease = args["leaseId"] as? String,
                      lease.range(of: "^[a-zA-Z0-9_-]{1,96}$", options: .regularExpression) != nil,
                      let voice = args["voice"] as? String else { throw SpeechQueueStore.StoreError.malformed }
                self.leaseId = lease
                self.controller.setTitle(args["title"] as? String ?? "静页")
                try self.controller.setVoice(voice)
                try self.controller.setRate(args["rate"] as? Double ?? 1)
                try self.controller.setTimer(mode: args["timer"] as? String ?? "off")
                try self.controller.command(commandId: UUID().uuidString, kind: "play", at: 0)
            case "control":
                guard self.matches(args), let command = args["commandId"] as? String,
                      let kind = args["action"] as? String else { throw SpeechQueueStore.StoreError.malformed }
                if kind == "resume" {
                    guard let lease = args["leaseId"] as? String, lease.range(of: "^[a-zA-Z0-9_-]{1,96}$", options: .regularExpression) != nil else { throw SpeechQueueStore.StoreError.malformed }
                    self.leaseId = lease
                } else if args["leaseId"] as? String != self.leaseId { throw SpeechQueueStore.StoreError.malformed }
                if kind == "rate" { try self.controller.setRate(args["rate"] as? Double ?? 1) }
                else if kind == "timer" { try self.controller.setTimer(mode: args["timer"] as? String ?? "off") }
                else { try self.controller.command(commandId: command, kind: kind, at: nil) }
            case "cancel":
                if self.matches(args) { self.controller.cancelPrepare(); self.active = false }
            case "ack": break
            case "reset":
                self.controller.cancelPrepare(); self.pending = nil; self.active = false
                if let url = self.snapshotURL { try? FileManager.default.removeItem(at: url) }
            default: throw SpeechQueueStore.StoreError.malformed
            }
        }, reply: { error in
            if let error { call.reject(error.localizedDescription) }
            else { call.resolve() }
        })
    }
}
