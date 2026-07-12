# Device-Only iOS Diagnostics Without the Xcode GUI: Crash Logs First, Then OS-Level Logs

**Extracted:** 2026-07-12
**Context:** Mined from Cubby iOS session logs (0017, 0018, 0021); adversarially verified. Merges two findings: real-crash-log retrieval and devicectl/os_log capture quirks.

## Problem
Two recurring failure modes when a bug only reproduces on a physical device:

1. **Crash hypothesized instead of read.** An iPad-only hang-then-crash was investigated for a full session via static code reading — two plausible, well-argued hypotheses (CloudKit Production-schema rename; first-multi-device-sync race). Both were wrong: the real crash was a SwiftUI-internal `NavigationSplitView` assertion, a framework internal no amount of app-code reading could reach.
2. **Generic error wrappers hide the real diagnosis.** A CloudKit sync failure surfaced only `SwiftDataError error 1`; `error.localizedDescription` and a one-level `NSUnderlyingErrorKey` unwrap both dead-ended. The real error required OS-level CoreData/CloudKit framework logs. Two toolchain traps compounded it: (a) `devicectl` swallows `-`-prefixed app-launch args without a `--` separator; (b) `devicectl … --console` and `idevicesyslog` do **not** carry `os_log` output at all.

## Solution
**Crash first, hypotheses second.** For any device-only crash, pull the actual crash log before theorizing:
- Xcode → Window → Organizer → Crashes (auto-syncs from ASC for TestFlight builds; dSYMs from CI/fastlane; can lag ~a day), or
- Cable-free: on-device Settings → Privacy & Security → Analytics & Improvements → Analytics Data → find `<AppName>-*.ips` → AirDrop it off. Top stack frames discriminate between hypotheses in seconds.

**OS-level log capture:**
- CoreData/CloudKit diagnosis: `xcrun devicectl device process launch --console -- -com.apple.CoreData.CloudKitDebug 3 -com.apple.CoreData.Logging.stderr 1` — the `--` separator is mandatory or devicectl's ArgumentParser misparses the flags. This surfaced the real error (`NSCocoaErrorDomain 134060`, "CloudKit integration requires that all relationships be optional") vs the useless SwiftData wrapper.
- General `os_log`/`Logger` capture: devicectl console and `idevicesyslog` are dead ends — use an `OS_ACTIVITY_DT_MODE` env-var launch, or Console.app.
- Once diagnosed, mirror the framework's error-unwrap logic to bounded depth (walk `NSUnderlyingErrorKey` up to ~10 levels, guarding circular chains) into an in-app diagnostic surface so future occurrences don't need a repeat device-console capture.

## Evidence
Session 0021: "Real stack: _assertionFailure ← swift_unexpectedError ← SwiftUI.NavigationColumnState.boundPathChange… Both prior session hypotheses (Production-schema rename, multi-device CloudKit import race) were wrong."
Session 0017: the CloudKitDebug devicectl invocation revealed `NSCocoaErrorDomain 134060` after localizedDescription dead-ended. Session 0018: "devicectl console does NOT carry os_log (idevicesyslog neither) — OS_ACTIVITY_DT_MODE env-var launch does."

## When to Use
Any iOS/macOS bug or crash that reproduces on a real device but not the simulator — CloudKit/CoreData sync failures, camera/NFC/background-task paths, framework-internal crashes. The crash-log retrieval path and the devicectl/os_log traps are pure Apple-toolchain knowledge, portable to any project.
