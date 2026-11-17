---
paths:
  - "**/*.swift"
---

# {{APP_NAME}} — Swift lessons by symptom

Loaded whenever a `.swift` file is in play. When one of these symptoms shows
up, read the named ios-dev skill before changing code; each encodes a failure
that already cost a debugging session.

| Symptom | Skill |
|---|---|
| App killed on launch / watchdog, slow first frame | `mainactor-launch-watchdog-audit` |
| Swift 6 `@MainActor` compile errors, or a runtime isolation trap in a UIKit-stored closure | `swift6-mainactor-compile-fixes`, `mainactor-runtime-isolation-trap` |
| SwiftData + CloudKit model rejected, sync fails, schema change breaks production | `swiftdata-cloudkit-model-rules`, `swiftdata-cloudkit-production-schema` |
| `#Predicate` crashes on an optional (`??`, `.contains`) | `swiftdata-predicate-optional-coalesce-contains-trap` |
| SwiftData unit tests need an in-memory container | `swiftdata-inmemory-test-harness` |
| Edited model attribute comes back after `rollback()` | `swiftdata-rollback-attribute-restore` |
| Sheet presented from inside a sheet misbehaves | `swiftui-sheet-in-sheet-uikit-present-bridge` |
| Widget shows stale data or cannot read app data | `widget-appgroup-snapshot-bridge` |
| `NavigationSplitView` pushes on the wrong stack | `navigationsplitview-single-stack-per-detail-column` |
| Pushed list scrolls under the tab bar | `swiftui-pushed-list-tabbar-scroll-clearance` |
| iOS 26 toolbar title truncates | `ios26-toolbar-leading-title-truncation` |
| Siri / App Intents unreliable on iOS 26 | `siri-app-intents-ios26-reliability` |

Per-subsystem design pointers live in `docs/ARCHITECTURE_CHECKLIST.md`.
