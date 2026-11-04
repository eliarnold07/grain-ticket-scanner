import UIKit
import Capacitor
import StoreKit

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = BinFlowBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

class BinFlowBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(BinFlowStorefrontPlugin())
    }
}

@objc(BinFlowStorefrontPlugin)
public class BinFlowStorefrontPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BinFlowStorefrontPlugin"
    public let jsName = "BinFlowStorefront"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getStorefront", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openCheckout", returnType: CAPPluginReturnPromise)
    ]

    @objc func getStorefront(_ call: CAPPluginCall) {
        Task { @MainActor in
            let storefront = await Storefront.current
            call.resolve(["countryCode": storefront?.countryCode ?? ""])
        }
    }

    @objc func openCheckout(_ call: CAPPluginCall) {
        Task { @MainActor in
            let storefront = await Storefront.current
            guard storefront?.countryCode == "USA",
                  let raw = call.getString("url"),
                  let parts = URLComponents(string: raw),
                  parts.scheme == "https", parts.port == nil, parts.user == nil, parts.password == nil,
                  let host = parts.host, ["getbinflow.com", "binflow-staging.pages.dev"].contains(host),
                  parts.percentEncodedPath == "/app/", parts.percentEncodedQuery == "billing=ios-handoff",
                  let code = parts.percentEncodedFragment,
                  code.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil,
                  let url = parts.url else {
                call.reject("Checkout is not available for this storefront.")
                return
            }
            if await UIApplication.shared.open(url) { call.resolve() }
            else { call.reject("Could not open the external browser.") }
        }
    }
}
