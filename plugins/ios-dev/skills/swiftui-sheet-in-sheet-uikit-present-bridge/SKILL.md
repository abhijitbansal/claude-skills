---
name: swiftui-sheet-in-sheet-uikit-present-bridge
description: UIActivityViewController (or any other UIKit present-based flow like UIDocumentPickerViewController) presented via .sheet(item:) from a SwiftUI view that is itself already presented as a sheet flashes on screen and self-dismisses within a single frame with zero user interaction — confirmed by a user who "didn't tap anything." Use when triggering a system share sheet, document picker, or any UIKit present(_:animated:) flow from a screen that can itself be presented as a sheet (a very common architecture: Settings-as-sheet, detail-as-sheet).
---

# SwiftUI Sheet-in-Sheet: UIKit Present Flashes and Self-Dismisses

## Symptom

Export (CSV/JSON), label printing, and share flows all trigger
`UIActivityViewController` via a SwiftUI `.sheet(item:)` binding from a view
that is itself already presented as a sheet (Settings, a tag-editor sheet, a
link-existing-item sheet). The share sheet **flashes and tears itself down
within a single frame, with zero user interaction** — confirmed by the user
("I didn't tap anything"). The bug only reveals itself by tracing the actual
runtime presentation hierarchy (which root view presents which screen as a
sheet), not from reading the call site in isolation.

## Root cause

SwiftUI's `.sheet(item:)` driving a UIKit-hosted `UIActivityViewController`
from a **second, nested** sheet layer is fundamentally unreliable — SwiftUI's
own sheet-presentation state machine fights the second nested presentation.
The moment the presenting view is already inside one `.sheet`, adding another
`.sheet(item:)` on top of it for a UIKit-bridged controller (rather than a
pure-SwiftUI view) races against SwiftUI's internal bookkeeping for the first
sheet, and the second presentation tears itself down before the user can
interact with it.

## Fix

Replace the `.sheet(item:)`-driven share flow with an **imperative present**:
walk `UIApplication.shared.connectedScenes` → key window → follow
`.presentedViewController` to the actual top-most UIKit view controller, and
call `present(_:animated:)` on it directly, with iPad popover-source
anchoring handled explicitly. This sidesteps SwiftUI's declarative sheet
stack entirely for the one case (system share sheet, document picker) that
needs guaranteed top-of-hierarchy presentation regardless of how many
SwiftUI sheets are already stacked:

```swift
enum ActivitySharePresenter {
    static func present(items: [Any], sourceView: UIView? = nil) {
        guard let windowScene = UIApplication.shared.connectedScenes
                .first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene,
              let keyWindow = windowScene.windows.first(where: { $0.isKeyWindow }),
              var topController = keyWindow.rootViewController
        else { return }

        // Walk to the actual top-most presented controller, however deep.
        while let presented = topController.presentedViewController {
            topController = presented
        }

        let activityVC = UIActivityViewController(activityItems: items, applicationActivities: nil)
        if let popover = activityVC.popoverPresentationController {
            popover.sourceView = sourceView ?? topController.view
            popover.sourceRect = sourceView?.bounds ?? CGRect(x: topController.view.bounds.midX,
                                                                y: topController.view.bounds.midY,
                                                                width: 0, height: 0)
        }
        topController.present(activityVC, animated: true)
    }
}

// Call site — no .sheet(item:) binding needed:
Button("Export") {
    ActivitySharePresenter.present(items: [csvURL])
}
```

## Evidence

Session 0017: "The nested sheet flashed and tore itself down within a frame —
zero user interaction... Fixed by replacing `ShareableFile`/
`ActivityShareSheet` (`.sheet(item:)`-driven) with
`ActivitySharePresenter.present(items:)` — an imperative present on the
actual top-most UIKit view controller, walking
`UIApplication.shared.connectedScenes` → key window →
`.presentedViewController` chain, with iPad popover anchoring. 4 call sites
migrated." Root cause confirmed by tracing the actual runtime presentation
hierarchy (`RootTabView.swift:42` presents Settings as a sheet), not from the
call site in isolation.

## Related skills

- `navigationsplitview-single-stack-per-detail-column` and
  `realityview-fullscreencover-black-defer-mount` are unrelated root causes
  but share the same debugging shape: a SwiftUI presentation/render bug that
  only reveals itself by tracing the actual runtime hierarchy, not by reading
  the call site in isolation.
- `sheet-in-sheet-present-bridge-generalization` — the generalization note for
  this skill: the same root cause recurred across camera picker, QuickLook,
  and mail composer; read it when the presented flow isn't a share sheet or
  document picker.
