import Capacitor
import UIKit

/// 桥控制器：在桥初始化时注册本地插件（听书）。
/// 插件实例由应用级持有，不随页面或桥监听器销毁。
class ReaderBridgeViewController: CAPBridgeViewController {
    var immersive = false
    var darkStatus = false
    override var prefersStatusBarHidden: Bool { immersive }
    override var preferredStatusBarStyle: UIStatusBarStyle { darkStatus ? .lightContent : .darkContent }
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(JySpeechPlugin())
        bridge?.registerPluginInstance(JyReaderPlugin())
        bridge?.registerPluginInstance(JyProPlugin())
    }
}
