---
name: sheet-in-sheet-present-bridge-generalization
description: A camera picker, QuickLook preview, mail composer, share sheet, or document picker flashes and self-dismisses, dismisses its PARENT sheet, or never appears when launched from a SwiftUI view that is itself (or can be) presented as a sheet. Applies to any UIKit present(_:animated:)-based system flow — UIImagePickerController, QLPreviewController, MFMailComposeViewController, UIActivityViewController, UIDocumentPickerViewController. Use alongside ios-dev:swiftui-sheet-in-sheet-uikit-present-bridge (which documents the share-sheet/doc-picker case and the ActivitySharePresenter fix): this note generalizes the rule to EVERY UIKit-presented system flow after the same bug class recurred four times.
promotion_target: Fold into ios-dev:swiftui-sheet-in-sheet-uikit-present-bridge — widen its description + add this generalization section; delete this file on promotion.
---

# The sheet-in-sheet UIKit-present bug is a CLASS, not a share-sheet quirk

Four recurrences of the same root cause in one app (each initially treated as a new
bug): share sheet (fixed with `ActivitySharePresenter`), QuickLook preview (BUG-018,
`AttachmentQuickLookPresenter`), camera capture — flash then parent-sheet dismissal
(BUG-022, `CameraPresenter`; a prior incomplete fix, BUG-008, had only removed an
imperative dismiss call and left the underlying declarative race), and the mail
composer (`MailComposePresenter`).

**Rule:** ANY UIKit `present(_:animated:)`-based system flow launched from a SwiftUI
view that is — or can ever be — inside a `.sheet`/`.fullScreenCover` must go through
an imperative top-most-view-controller presenter (walk connectedScenes → key window →
`.presentedViewController` chain; see the ios-dev skill for the canonical code).
Never drive it with a nested `.sheet(item:)`, `.fullScreenCover`, or a
`UIViewControllerRepresentable` mounted inside the second sheet layer — SwiftUI's
sheet state machine races the nested presentation and tears down one side.

**Review heuristic:** when a diff adds a `UIViewControllerRepresentable` or a
`.sheet`-presented UIKit controller, ask "can the presenting view itself be a sheet
anywhere in the app?" — if yes, flag it; the bug only reproduces from the nested
context, so the call site looks innocent in isolation and unit tests can't see it.
