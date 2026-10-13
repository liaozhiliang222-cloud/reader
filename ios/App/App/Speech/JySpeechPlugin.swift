import Capacitor
import Foundation

/// 听书插件桥：参数校验、命令转发、快照查询与状态事件通知。
/// 业务逻辑全在 SpeechController 的串行队列；这里只做薄封装。
@objc(JySpeechPlugin)
public class JySpeechPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "JySpeechPlugin"
    public let jsName = "JySpeech"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "voices", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "begin", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "append", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "commit", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelPrepare", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "command", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setRate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setVoice", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setTimer", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "snapshot", returnType: CAPPluginReturnPromise),
    ]

    private let controller = SpeechController()

    public override func load() {
        controller.onSnapshot = { [weak self] snapshot in
            self?.notifyListeners("speechState", data: [
                "type": "state",
                "snapshot": snapshot,
            ])
        }
        // 冷启动清孤立会话（进程终止即会话作废）。
        SpeechQueueStore.cleanupOrphans()
    }

    private func reply(_ call: CAPPluginCall) -> (Error?) -> Void {
        { error in
            if let error {
                call.reject(error.localizedDescription)
            } else {
                call.resolve()
            }
        }
    }

    @objc func voices(_ call: CAPPluginCall) {
        call.resolve(["voices": controller.voiceList()])
    }

    @objc func begin(_ call: CAPPluginCall) {
        guard
            let sessionId = call.getString("sessionId"),
            let bookId = call.getString("bookId"),
            let revision = call.getInt("contentRevision")
        else {
            call.reject("听书会话参数无效")
            return
        }
        let session: [String: Any] = [
            "protocolVersion": call.getInt("protocolVersion") ?? 1,
            "sessionId": sessionId,
            "bookId": bookId,
            "contentRevision": revision,
            "title": call.getString("title") ?? "",
        ]
        controller.run({ try self.controller.begin(session: session) }, reply: reply(call))
    }

    @objc func append(_ call: CAPPluginCall) {
        guard
            let batchIndex = call.getInt("batchIndex"),
            let firstIndex = call.getInt("firstSentenceIndex"),
            let sentences = call.getArray("sentences") as? [[String: Any]]
        else {
            call.reject("听书批次参数无效")
            return
        }
        let batch: [String: Any] = [
            "batchIndex": batchIndex,
            "firstSentenceIndex": firstIndex,
            "sentences": sentences,
            "final": call.getBool("final") ?? false,
        ]
        controller.run({ try self.controller.append(batch: batch) }, reply: reply(call))
    }

    @objc func commit(_ call: CAPPluginCall) {
        guard let total = call.getInt("total") else {
            call.reject("听书提交参数无效")
            return
        }
        controller.run({ try self.controller.commit(totalCount: total) }, reply: reply(call))
    }

    @objc func cancelPrepare(_ call: CAPPluginCall) {
        controller.run({ self.controller.cancelPrepare() }, reply: reply(call))
    }

    @objc func command(_ call: CAPPluginCall) {
        guard
            let commandId = call.getString("commandId"),
            let kind = call.getString("kind")
        else {
            call.reject("听书命令参数无效")
            return
        }
        controller.run(
            { try self.controller.command(commandId: commandId, kind: kind, at: call.getInt("at")) },
            reply: reply(call)
        )
    }

    @objc func setRate(_ call: CAPPluginCall) {
        guard let rate = call.getDouble("rate") else {
            call.reject("听书语速参数无效")
            return
        }
        controller.run({ try self.controller.setRate(rate) }, reply: reply(call))
    }

    @objc func setVoice(_ call: CAPPluginCall) {
        guard let voiceId = call.getString("voiceId") else {
            call.reject("听书语音参数无效")
            return
        }
        controller.run({ try self.controller.setVoice(voiceId) }, reply: reply(call))
    }

    @objc func setTimer(_ call: CAPPluginCall) {
        guard let mode = call.getString("mode") else {
            call.reject("听书定时参数无效")
            return
        }
        controller.run({ try self.controller.setTimer(mode: mode) }, reply: reply(call))
    }

    @objc func snapshot(_ call: CAPPluginCall) {
        controller.run({}) { [weak self] error in
            guard let self else { return }
            if let error {
                call.reject(error.localizedDescription)
            } else {
                // 快照必须在串行队列生成，避免读到半更新状态。
                call.resolve(self.controller.snapshot())
            }
        }
    }
}
