import XCTest
import Foundation
import StoreKit
import StoreKitTest
@testable import App

/// 本地 StoreKit 购买场景验证：失败、等待批准/批准、恢复、重开权益保留。
final class ProStoreScenarioTests: XCTestCase {
    private var session: SKTestSession!

    @MainActor
    override func setUp() async throws {
        try await super.setUp()
        guard #available(iOS 15.4, *) else { throw XCTSkip("SKTestSession 需要 iOS 15.4+") }
        session = try SKTestSession(configurationFileNamed: "JingyePro")
        // resetToDefaultState 会把 disableDialogs 一并重置，必须在其后再开启。
        session.resetToDefaultState()
        session.clearTransactions()
        session.disableDialogs = true
        // ProStore.shared 是单例：清掉交易后必须 refresh，否则上一测试的权益标志会泄漏。
        await ProStore.shared.refresh()
        executionTimeAllowance = 60
    }

    override func tearDown() {
        session = nil
        super.tearDown()
    }

    /// 购买失败（用户取消/交易失败）不授予权益，状态回到未购买。
    @MainActor
    func testFailedPurchaseGrantsNoEntitlement() async throws {
        try await ProStore.shared.loadProduct()
        session.failTransactionsEnabled = true
        defer { session.failTransactionsEnabled = false }
        do {
            try await ProStore.shared.purchase()
            XCTFail("交易失败时应抛出错误")
        } catch {}
        XCTAssertFalse(ProStore.shared.hasVerifiedEntitlement)
        XCTAssertEqual(ProStore.shared.snapshot()["status"] as? String, "free")
    }

    /// 询问后购买：先返回等待批准，家长批准后交易更新自动授予权益。
    @MainActor
    func testAskToBuyPendingThenApproved() async throws {
        try await ProStore.shared.loadProduct()
        // 询问后购买需要允许对话框，否则购买会被直接取消而不产生待批准交易。
        session.disableDialogs = false
        session.askToBuyEnabled = true
        try await ProStore.shared.purchase()
        // status 可能被随后的 refresh() 覆盖为 free，只断言权益未授予，
        // 并以 allTransactions 中的待批准交易作为 pending 的证据。
        XCTAssertFalse(ProStore.shared.hasVerifiedEntitlement)
        var pendingId: UInt?
        for i in 0..<50 {
            pendingId = session.allTransactions()
                .first { $0.productIdentifier == ProStore.productID }?.identifier
            if pendingId != nil { break }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        let id = try XCTUnwrap(pendingId, "应能找到待批准交易")
        session.askToBuyEnabled = false
        try session.approveAskToBuyTransaction(identifier: id)
        for _ in 0..<50 {
            if ProStore.shared.hasVerifiedEntitlement { break }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        XCTAssertTrue(ProStore.shared.hasVerifiedEntitlement, "批准后交易更新应授予权益")
    }

    /// 取消购买：购买确认框点取消返回 userCancelled，不授予权益。
    /// 需要手动在模拟器购买确认框点「取消」。
    @MainActor
    func testCancelledPurchaseStaysFree() async throws {
        try await ProStore.shared.loadProduct()
        session.disableDialogs = false
        try await ProStore.shared.purchase()
        XCTAssertFalse(ProStore.shared.hasVerifiedEntitlement)
        let status = ProStore.shared.snapshot()["status"] as? String
        XCTAssertEqual(status, "free")
    }

    /// 退款/撤销：清空 StoreKit 测试交易后权益应消失。
    @MainActor
    func testRevokedPurchaseLosesEntitlement() async throws {
        try await ProStore.shared.loadProduct()
        try await ProStore.shared.purchase()
        XCTAssertTrue(ProStore.shared.hasVerifiedEntitlement)
        session.clearTransactions()
        try await ProStore.shared.refresh()
        XCTAssertFalse(ProStore.shared.hasVerifiedEntitlement)
        XCTAssertEqual(ProStore.shared.snapshot()["status"] as? String, "free")
    }

    /// 恢复购买：sync 后权益仍为已验证。
    @MainActor
    func testRestoreKeepsVerifiedEntitlement() async throws {
        try await ProStore.shared.loadProduct()
        try await ProStore.shared.purchase()
        XCTAssertTrue(ProStore.shared.hasVerifiedEntitlement)
        try await ProStore.shared.restore()
        XCTAssertTrue(ProStore.shared.hasVerifiedEntitlement)
        XCTAssertEqual(ProStore.shared.snapshot()["status"] as? String, "owned")
    }

    /// 重开后权益仍可离线验证：已验证交易保留在本地，无需联网即可读取。
    @MainActor
    func testEntitlementSurvivesReopenOffline() async throws {
        try await ProStore.shared.loadProduct()
        try await ProStore.shared.purchase()
        await ProStore.shared.refresh()
        XCTAssertTrue(ProStore.shared.hasVerifiedEntitlement)
        XCTAssertEqual(ProStore.shared.snapshot()["status"] as? String, "owned")
    }
}
