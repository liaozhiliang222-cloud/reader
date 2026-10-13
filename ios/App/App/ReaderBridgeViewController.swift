import Capacitor
import UIKit

/// 桥控制器：在桥初始化时注册本地插件（听书）。
/// 插件实例由应用级持有，不随页面或桥监听器销毁。
class ReaderBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(JySpeechPlugin())
    }
}
