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

        self.scene(scene, openURLContexts: connectionOptions.urlContexts)
        for userActivity in connectionOptions.userActivities {
            self.scene(scene, continue: userActivity)
        }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        for context in URLContexts {
            var options: [UIApplication.OpenURLOptionsKey: Any] = [
                .openInPlace: context.options.openInPlace
            ]
            options[.sourceApplication] = context.options.sourceApplication
            options[.annotation] = context.options.annotation
            _ = ApplicationDelegateProxy.shared.application(
                UIApplication.shared, open: context.url, options: options
            )
        }
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        _ = ApplicationDelegateProxy.shared.application(
            UIApplication.shared, continue: userActivity, restorationHandler: { _ in }
        )
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
