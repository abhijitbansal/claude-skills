---
name: xcodegen-test-targets
description: Adding Swift Testing unit tests and XCUITest targets to an XcodeGen (project.yml) iOS app that has none. Covers the exact TEST_HOST / BUNDLE_LOADER shape for hosted unit tests, wiring the scheme's test action (tests silently don't run if the target isn't listed), regenerating before every xcodebuild test (sources are globbed at generate time), matching SWIFT_DEFAULT_ACTOR_ISOLATION so @testable import doesn't break, and overriding @AppStorage per-launch via NSArgumentDomain in UI tests. Trigger on "add tests" to an XcodeGen iOS app, or when xcodebuild test reports fewer suites than test files exist.
---

# Adding Test Targets to an XcodeGen (project.yml) iOS Project

## Why this skill exists

XcodeGen ships no test-target template. Hosted unit tests fail to link or run
without the exact `TEST_HOST` / `BUNDLE_LOADER` shape; tests silently don't run
if the scheme's test action omits the target; and freshly created test files
aren't compiled until the project is regenerated (so the suite count quietly
fails to grow).

## When to use

- "Add tests" to any XcodeGen-managed iOS app
- `xcodebuild test` reports fewer suites than test files exist (stale generate)
- `@testable import` fails with actor-isolation errors in a fresh test target

## Unit test target (Swift Testing, hosted in the app)

```yaml
  AppTests:
    type: bundle.unit-test
    platform: iOS
    sources: [AppTests]
    dependencies:
      - target: App
    settings:
      base:
        BUNDLE_LOADER: "$(TEST_HOST)"
        TEST_HOST: "$(BUILT_PRODUCTS_DIR)/App.app/App"   # .app/<executable>, iOS shape
        GENERATE_INFOPLIST_FILE: YES
        # Match the app target's isolation or @testable import breaks:
        SWIFT_DEFAULT_ACTOR_ISOLATION: MainActor
        SWIFT_APPROACHABLE_CONCURRENCY: YES
```

## UI test target

`type: bundle.ui-testing`, a dependency on the app target, and
`TEST_TARGET_NAME: App` (no `TEST_HOST`).

## Scheme — tests DO NOT run unless listed

```yaml
schemes:
  App:
    test:
      config: Debug
      targets: [AppTests, AppUITests]
```

Run:

```bash
xcodegen generate && \
xcodebuild test -project App.xcodeproj -scheme App \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro'
```

## Traps

- **Regenerate before every `xcodebuild test`** after adding test files —
  sources are globbed at generate time; stale projects skip new files and the
  suite count won't grow (you'll see `TEST SUCCEEDED` running 0 tests).
- Use `import Testing` + `#expect` (Swift Testing) for unit tests; XCUITest
  still requires `import XCTest`.
- `@MainActor struct MyTests` works fine under Swift Testing when the app
  target defaults to MainActor isolation.
- UI tests: override `@AppStorage` per-launch *without* touching persisted
  defaults via the NSArgumentDomain — `app.launchArguments = ["-hasSeenOnboarding", "YES"]`;
  `UserDefaults` reads the argument domain first.
- SwiftUI `List` rows render as `staticTexts`, not `buttons`, and bottom
  sections need `app.swipeUp()` before querying.
