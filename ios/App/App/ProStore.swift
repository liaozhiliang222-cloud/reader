import Capacitor
import StoreKit
import Foundation

/// No boolean in JS/UserDefaults is an entitlement. StoreKit verifies local signed transactions.
final class ProStore {
    static let shared = ProStore()
    static let productID = "dev.jingye.reader.pro"
    private let lock = NSLock()
    private var verified = false
    var hasVerifiedEntitlement: Bool { lock.lock(); defer { lock.unlock() }; return verified }
    private func setVerified(_ value: Bool) { lock.lock(); verified = value; lock.unlock() }
    @MainActor private var product: Product?
    @MainActor private var status = "unknown"
    @MainActor private var message = ""
    @MainActor var changed: (() -> Void)?
    private var updates: Task<Void, Never>?

    private init() {
        updates = Task { @MainActor [weak self] in
            guard let self else { return }
            await self.refresh()
            for await result in Transaction.updates {
                guard case .verified(let transaction) = result, transaction.productID == Self.productID else { continue }
                await self.refresh()
                await transaction.finish()
                self.changed?()
            }
        }
    }
    @MainActor func refresh() async {
        var owned = false
        var failedVerification = false
        for await result in Transaction.currentEntitlements {
            switch result {
            case .verified(let transaction):
                if transaction.productID == Self.productID, transaction.productType == .nonConsumable, transaction.revocationDate == nil {
                    owned = true
                }
            case .unverified(let transaction, _):
                if transaction.productID == Self.productID { failedVerification = true }
            }
        }
        if failedVerification && !owned {
            status = hasVerifiedEntitlement ? "owned" : "unverified"
            message = "购买凭据暂时无法验证，请稍后重试。"
            return
        }
        setVerified(owned); status = owned ? "owned" : "free"; message = ""
    }
    @MainActor func loadProduct() async throws {
        product = try await Product.products(for: [Self.productID]).first
        guard product?.type == .nonConsumable else {
            product = nil
            throw NSError(domain: "JyPro", code: 1, userInfo: [NSLocalizedDescriptionKey: "Pro 商品尚未配置或暂不可用。免费阅读与已有笔记仍可使用。"])
        }
    }
    @MainActor func purchase() async throws {
        if product == nil { try await loadProduct() }
        guard let product else { return }
        status = "purchasing"; changed?()
        do {
            switch try await product.purchase() {
            case .success(let result):
                guard case .verified(let transaction) = result,
                      transaction.productID == Self.productID, transaction.productType == .nonConsumable,
                      transaction.revocationDate == nil else {
                    status = hasVerifiedEntitlement ? "owned" : "unverified"
                    message = "购买凭据未通过验证。"; return
                }
                setVerified(true); status = "owned"; message = ""
                await transaction.finish()
            case .pending: status = "pending"; message = "购买正在等待批准，批准后将自动更新。"
            case .userCancelled: status = hasVerifiedEntitlement ? "owned" : "free"; message = "已取消购买。"
            @unknown default: status = "unknown"; message = "购买状态暂时无法确认。"
            }
        } catch {
            status = hasVerifiedEntitlement ? "owned" : "free"; throw error
        }
        changed?()
    }
    @MainActor func restore() async throws {
        // Only an explicit Restore tap calls sync (which can display system authentication).
        try await AppStore.sync()
        await refresh(); changed?()
    }
    @MainActor func snapshot() -> [String: Any] {
        var result: [String: Any] = ["protocolVersion": 1, "productId": Self.productID,
                                     "status": status, "isPro": hasVerifiedEntitlement, "message": message]
        if let product { result["price"] = product.displayPrice }
        return result
    }
}

@objc(JyProPlugin)
public class JyProPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "JyProPlugin"
    public let jsName = "JyPro"
    public let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "request", returnType: CAPPluginReturnPromise)]
    public override func load() {
        Task { @MainActor in
            ProStore.shared.changed = { [weak self] in self?.notifyListeners("proChanged", data: [:]) }
        }
    }
    @objc func request(_ call: CAPPluginCall) {
        let action = call.getString("action") ?? "state"
        Task { @MainActor in
            do {
                switch action {
                case "state": await ProStore.shared.refresh()
                case "product": try await ProStore.shared.loadProduct()
                case "purchase": try await ProStore.shared.purchase()
                case "restore": try await ProStore.shared.restore()
                default: call.reject("购买请求无效"); return
                }
                call.resolve(ProStore.shared.snapshot())
            } catch { call.reject(error.localizedDescription) }
        }
    }
}
