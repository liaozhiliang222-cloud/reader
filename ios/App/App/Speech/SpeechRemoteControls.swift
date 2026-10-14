import Foundation
import MediaPlayer

/// 系统媒体控制：Now Playing 信息与控制中心/锁屏/耳机命令。
/// 注册和注销幂等；不提供虚构的时间轴或拖动进度。
final class SpeechRemoteControls {

    enum Command {
        case play, pause, stop, previous, next
    }

    var title = "静页听书"
    private var tokens: [(MPRemoteCommand, Any)] = []
    private var registered = false
    var onCommand: ((Command) -> Void)?

    /// 注册远程命令；重复调用只注册一次。
    func register() {
        guard !registered else { return }
        registered = true
        let center = MPRemoteCommandCenter.shared()
        tokens.append((center.playCommand, center.playCommand.addTarget { [weak self] _ in
            self?.onCommand?(.play)
            return .success
        }))
        tokens.append((center.pauseCommand, center.pauseCommand.addTarget { [weak self] _ in
            self?.onCommand?(.pause)
            return .success
        }))
        tokens.append((center.stopCommand, center.stopCommand.addTarget { [weak self] _ in
            self?.onCommand?(.stop)
            return .success
        }))
        tokens.append((center.nextTrackCommand, center.nextTrackCommand.addTarget { [weak self] _ in
            self?.onCommand?(.next)
            return .success
        }))
        tokens.append((center.previousTrackCommand, center.previousTrackCommand.addTarget { [weak self] _ in
            self?.onCommand?(.previous)
            return .success
        }))
    }

    /// 发布媒体信息：标题用「静页听书」，详细书名只在 App 内显示。
    /// 不虚构全书秒数，也不把句序当时间。
    func publish(playing: Bool, chapterTitle: String?) {
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: title,
            MPNowPlayingInfoPropertyPlaybackRate: playing ? 1.0 : 0.0,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: 0.0,
        ]
        if let chapterTitle, !chapterTitle.isEmpty {
            info[MPMediaItemPropertyArtist] = chapterTitle
        }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    /// 停止后清除 Now Playing 信息，旧事件不重新出声。
    func clear() {
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    }

    func unregister() {
        guard registered else { return }
        registered = false
        for (command, token) in tokens { command.removeTarget(token) }
        tokens = []
        clear()
    }
}
