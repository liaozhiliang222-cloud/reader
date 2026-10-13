import AVFAudio
import Foundation

/// 音频会话管理：播放类配置、中断与输出路由变化。
/// 全部在 SpeechController 串行队列上调用；回调投递到 controller。
final class SpeechAudioSession: NSObject {

    enum Event {
        /// 来电/Siri 等中断开始：暂停并保存，结束后不自动出声。
        case interruptionBegan
        /// 耳机拔出或输出设备断开：暂停避免突然外放。
        case routeLost
    }

    private let session = AVAudioSession.sharedInstance()
    private var observing = false
    var onEvent: ((Event) -> Void)?

    /// 只在用户播放时激活；失败留给调用方进入错误态。
    func activate() throws {
        try session.setCategory(.playback, mode: .spokenAudio, options: [])
        try session.setActive(true, options: [])
        startObserving()
    }

    /// 停止后释放，并通知其他音频恢复。
    func deactivate() {
        try? session.setActive(false, options: [.notifyOthersOnDeactivation])
        stopObserving()
    }

    private func startObserving() {
        guard !observing else { return }
        observing = true
        let center = NotificationCenter.default
        center.addObserver(
            self,
            selector: #selector(interrupted(_:)),
            name: AVAudioSession.interruptionNotification,
            object: session
        )
        center.addObserver(
            self,
            selector: #selector(routeChanged(_:)),
            name: AVAudioSession.routeChangeNotification,
            object: session
        )
    }

    private func stopObserving() {
        guard observing else { return }
        observing = false
        NotificationCenter.default.removeObserver(self)
    }

    @objc private func interrupted(_ note: Notification) {
        guard
            let value = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
            let type = AVAudioSession.InterruptionType(rawValue: value)
        else { return }
        if type == .began { onEvent?(.interruptionBegan) }
        // 中断结束不自动恢复：保留用户之前的暂停意图。
    }

    @objc private func routeChanged(_ note: Notification) {
        guard
            let value = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
            let reason = AVAudioSession.RouteChangeReason(rawValue: value)
        else { return }
        if reason == .oldDeviceUnavailable { onEvent?(.routeLost) }
    }
}
