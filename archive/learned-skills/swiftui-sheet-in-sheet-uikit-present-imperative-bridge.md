# UIActivityViewController presented via .sheet(item:) from inside another SwiftUI sheet flashes and self-dismisses instantly — present imperatively on the real top view controller instead

**Extracted:** 2026-07-12
**Context:** Mined from Cubby iOS session logs (0017); adversarially verified.

## Problem
Export CSV/JSON, label printing, and shopping-list share all triggered `UIActivityViewController` via a SwiftUI `.sheet(item:)` binding from a view that was itself already presented as a sheet (Settings, TagNowView, LinkExistingTagView). The share sheet flashed and tore itself down within a single frame with zero user interaction — confirmed by the user ('I didn't tap anything'). The bug only revealed itself by tracing the actual runtime presentation hierarchy (`RootTabView.swift:42` presents Settings as a sheet), not from the call site in isolation — SwiftUI's `.sheet(item:)` driving a UIKit-hosted `UIActivityViewController` from a second, nested sheet layer is fundamentally unreliable (SwiftUI's own sheet-presentation state machine fights the second nested presentation).

## Solution
Replace the `.sheet(item:)`-driven share flow with an imperative present: walk `UIApplication.shared.connectedScenes` → key window → follow `.presentedViewController` to the actual top-most UIKit view controller, and call `present(_:animated:)` on it directly, with iPad popover-source anchoring handled explicitly. This sidesteps SwiftUI's declarative sheet stack entirely for the one case (system share sheet) that needs guaranteed top-of-hierarchy presentation regardless of how many SwiftUI sheets are already stacked.

## Evidence
Session 0017: 'The nested sheet flashed and tore itself down within a frame — zero user interaction... Fixed by replacing `ShareableFile`/`ActivityShareSheet` (`.sheet(item:)`-driven) with `ActivitySharePresenter.present(items:)` — an imperative present on the actual top-most UIKit view controller, walking `UIApplication.shared.connectedScenes` → key window → `.presentedViewController` chain, with iPad popover anchoring. 4 call sites migrated.'

## When to Use
Any SwiftUI app that triggers `UIActivityViewController` (or any other UIKit `present`-based flow like `UIDocumentPickerViewController`) from a screen that can itself be presented as a sheet (a very common architecture: Settings-as-sheet, detail-as-sheet) will hit this exact silent-dismiss bug. The fix pattern — bridge to UIKit's real presentation chain instead of nesting `.sheet(item:)` — generalizes to any UIKit presentation triggered from SwiftUI sheet-in-sheet contexts.
