import UIKit
import Capacitor

/// Bridge view controller that registers the app's local (non-npm) plugins.
class HounsfieldViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(MedGemmaMLXPlugin())
        bridge?.registerPluginInstance(BiometricVaultPlugin())
    }
}
