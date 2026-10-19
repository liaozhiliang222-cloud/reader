import XCTest
import Foundation
import StoreKit
import StoreKitTest
@testable import App

/// 本地 StoreKit 配置购买验证：商品加载、实际购买、权益授予、状态快照。
final class ProStoreTests: XCTestCase {
    private var session: SKTestSession!

    @MainActor
    override func setUp() async throws {
        try await super.setUp()
        guard #available(iOS 15.4, *) else { throw XCTSkip("SKTestSession 需要 iOS 15.4+") }
        session = try SKTestSession(configurationFileNamed: "JingyePro")
        session.disableDialogs = true
        session.clearTransactions()
    }

    override func tearDown() {
        session = nil
        super.tearDown()
    }

    /// 商品从本地配置加载，类型与商品 ID 符合买断设定。
    @MainActor
    func testProductLoadsFromLocalConfiguration() async throws {
        try await ProStore.shared.loadProduct()
        let snapshot = ProStore.shared.snapshot()
        XCTAssertEqual(snapshot["productId"] as? String, ProStore.productID)
        XCTAssertNotNil(snapshot["price"], "本地配置应给出显示价格")
    }

    /// 经 StoreKit 验证的购买授予权益：isPro 由交易验证驱动，而非本地开关。
    @MainActor
    func testPurchaseGrantsVerifiedEntitlement() async throws {
        try await ProStore.shared.loadProduct()
        try await ProStore.shared.purchase()
        XCTAssertTrue(ProStore.shared.hasVerifiedEntitlement)
        let snapshot = ProStore.shared.snapshot()
        XCTAssertEqual(snapshot["isPro"] as? Bool, true)
        XCTAssertEqual(snapshot["status"] as? String, "owned")
    }
}

/// Language/resource checks do not grant or change purchase entitlements.
final class ReaderLanguageTests: XCTestCase {
    func testSystemLanguageFallback() {
        XCTAssertEqual(ReaderLanguage.resolve(["en-GB", "zh-CN"]), "en")
        XCTAssertEqual(ReaderLanguage.resolve(["zh-Hans-CN"]), "zh-Hans")
        XCTAssertEqual(ReaderLanguage.resolve(["zh-Hant-TW"]), "zh-Hans")
        XCTAssertEqual(ReaderLanguage.resolve(["fr-FR"]), "en")
        XCTAssertEqual(ReaderLanguage.resolve([]), "en")
    }

    func testLocalizedDisplayNamesAreBundled() throws {
        for (language, expected) in [("en", "LumiRead"), ("zh-Hans", "微光阅读")] {
            let path = try XCTUnwrap(Bundle.main.path(forResource: "InfoPlist", ofType: "strings", inDirectory: nil, forLocalization: language))
            let data = try Data(contentsOf: URL(fileURLWithPath: path))
            let values = try PropertyListSerialization.propertyList(from: data, format: nil) as? [String: String]
            XCTAssertEqual(values?["CFBundleDisplayName"], expected)
        }
    }
}
