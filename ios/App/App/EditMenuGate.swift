import UIKit

/// WKWebView keeps showing the system Copy/Look Up menu on text selection even
/// when the page disables the callout, stacking a second menu under the app's
/// own annotation menu. This gates the suppression hooks on WKContentView: the
/// system menu is hidden only while the reader asks for it, and left untouched
/// while a DOM text field is focused so paste/cut/copy keep working in inputs.
final class EditMenuGate: NSObject {
    static var suppressSelectionMenu = false
    static var editableFocused = false

    private static var installed = false

    private static var isSuppressed: Bool {
        suppressSelectionMenu && !editableFocused
    }

    static func install() {
        guard !installed else { return }
        installed = true
        guard let viewClass = NSClassFromString("WKContentView") else { return }
        #if DEBUG
        dumpMenuSelectors(viewClass)
        #endif
        // iOS consults `shouldSuppressEditMenu` before presenting the
        // text-selection callout; canPerformAction only filters items.
        gate(
            viewClass,
            original: NSSelectorFromString("shouldSuppressEditMenu"),
            gate: #selector(EditMenuGate.gatedShouldSuppressEditMenu)
        )
        // Fallbacks for versions where the predicate is not consulted.
        gate(
            viewClass,
            original: NSSelectorFromString("willPresentEditMenuWithAnimator:"),
            gate: #selector(EditMenuGate.gatedWillPresentEditMenu(_:))
        )
        gate(
            viewClass,
            original: NSSelectorFromString("systemWillPresentEditMenuWithAnimator:"),
            gate: #selector(EditMenuGate.gatedSystemWillPresentEditMenu(_:))
        )
        gate(
            viewClass,
            original: #selector(UIResponder.canPerformAction(_:withSender:)),
            gate: #selector(EditMenuGate.gatedCanPerformAction(_:withSender:))
        )
        gate(
            viewClass,
            original: NSSelectorFromString("editMenuForTextInRect:suggestedActions:"),
            gate: #selector(EditMenuGate.gatedEditMenu(forTextIn:suggestedActions:))
        )
        // The menu iOS auto-presents after selection-handle drags; this path
        // skips the willPresent predicates entirely.
        gate(
            viewClass,
            original: NSSelectorFromString("automaticallyPresentEditMenu"),
            gate: #selector(EditMenuGate.gatedAutomaticallyPresentEditMenu)
        )
        // Last-resort: with the gate on, build an empty menu so nothing can
        // appear even through an unlisted presentation path.
        gate(
            viewClass,
            original: NSSelectorFromString("buildMenuForWebViewWithBuilder:"),
            gate: #selector(EditMenuGate.gatedBuildMenu(forWebViewWith:))
        )
    }

    /// Installs `gate` on `viewClass` pointing at the original implementation
    /// of `original`, so the gate can call the original through the same
    /// selector after the exchange. No-op when the selector does not exist.
    private static func gate(
        _ viewClass: AnyClass,
        original originalSelector: Selector,
        gate gateSelector: Selector
    ) {
        guard let original = class_getInstanceMethod(viewClass, originalSelector),
              let gate = class_getInstanceMethod(EditMenuGate.self, gateSelector)
        else { return }
        // Give the class its own copy of the original selector so the exchange
        // never touches a superclass implementation other views rely on.
        _ = class_addMethod(
            viewClass,
            originalSelector,
            method_getImplementation(original),
            method_getTypeEncoding(original)
        )
        guard let ownOriginal = class_getInstanceMethod(viewClass, originalSelector),
              class_addMethod(
                  viewClass,
                  gateSelector,
                  method_getImplementation(gate),
                  method_getTypeEncoding(gate)
              ),
              let added = class_getInstanceMethod(viewClass, gateSelector)
        else { return }
        method_exchangeImplementations(ownOriginal, added)
    }

    #if DEBUG
    /// Logs WKContentView methods whose name mentions the edit/menu selection
    /// surface, so the gate's selector list can be matched to this OS release.
    private static func dumpMenuSelectors(_ viewClass: AnyClass) {
        var count: UInt32 = 0
        guard let methods = class_copyMethodList(viewClass, &count) else { return }
        defer { free(methods) }
        var names: [String] = []
        for i in 0 ..< Int(count) {
            let name = NSStringFromSelector(method_getName(methods[i]))
            let lower = name.lowercased()
            if lower.contains("menu") || lower.contains("edit") || lower.contains("callout") || lower.contains("selection") {
                names.append(name)
            }
        }
        for name in names.sorted() {
            NSLog("EditMenuGate sel: %@", name)
        }
    }
    #endif

    // These run on WKContentView instances after the exchange; each same-named
    // selector then resolves to the original implementation.

    @objc dynamic func gatedShouldSuppressEditMenu() -> Bool {
        if EditMenuGate.isSuppressed { return true }
        return gatedShouldSuppressEditMenu()
    }

    @objc dynamic func gatedWillPresentEditMenu(_ animator: AnyObject?) {
        if EditMenuGate.isSuppressed { return }
        gatedWillPresentEditMenu(animator)
    }

    @objc dynamic func gatedSystemWillPresentEditMenu(_ animator: AnyObject?) {
        if EditMenuGate.isSuppressed { return }
        gatedSystemWillPresentEditMenu(animator)
    }

    @objc dynamic func gatedCanPerformAction(_ action: Selector, withSender sender: Any?) -> Bool {
        if EditMenuGate.isSuppressed { return false }
        return gatedCanPerformAction(action, withSender: sender)
    }

    @objc dynamic func gatedEditMenu(forTextIn rect: CGRect, suggestedActions: [UIMenuElement]) -> UIMenu {
        if EditMenuGate.isSuppressed { return UIMenu(children: []) }
        return gatedEditMenu(forTextIn: rect, suggestedActions: suggestedActions)
    }

    @objc dynamic func gatedAutomaticallyPresentEditMenu() -> Bool {
        if EditMenuGate.isSuppressed { return false }
        return gatedAutomaticallyPresentEditMenu()
    }

    @objc dynamic func gatedBuildMenu(forWebViewWith builder: AnyObject?) {
        if EditMenuGate.isSuppressed { return }
        gatedBuildMenu(forWebViewWith: builder)
    }
}
