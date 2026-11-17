---
name: devicectl-crashlog-oslog-cli-diagnostics
description: A device-only crash or sync failure gets investigated by re-reading app code and guessing (wrong hypotheses, sometimes for a full session) instead of pulling the real crash log; or a CloudKit/CoreData failure surfaces only as a useless wrapper like "SwiftDataError error 1" whose localizedDescription and one-level NSUnderlyingErrorKey unwrap both dead-end; or `xcrun devicectl device process launch --console -com.apple.CoreData.CloudKitDebug 3` silently misparses the flags, or devicectl's console / idevicesyslog show nothing even though the app is clearly calling os_log. Use when a bug reproduces on a physical iPhone/iPad but not the simulator — CloudKit/CoreData sync failures, camera/NFC/background-task paths, or any framework-internal crash — before writing a second hypothesis-driven investigation session.
---

# Device-Only iOS Diagnostics Without the Xcode GUI: Crash Logs First, Then OS-Level Logs

## Symptom

Two recurring failure modes when a bug only reproduces on a physical device:

1. **Crash hypothesized instead of read.** A device-only hang-then-crash gets
   investigated purely by reading app code, producing plausible, well-argued
   hypotheses — and both are wrong, because the real crash is inside a
   framework (e.g. SwiftUI) that no amount of app-code reading can reach.
2. **Generic error wrappers hide the real diagnosis.** A CloudKit sync
   failure surfaces only `SwiftDataError error 1`;
   `error.localizedDescription` and a one-level `NSUnderlyingErrorKey` unwrap
   both dead-end. The real error requires OS-level CoreData/CloudKit
   framework logs — but the two obvious CLI paths to get them both have
   sharp edges (below).

## Root cause

- Xcode's Organizer crash-log sync from App Store Connect can lag ~a day, so
  waiting on it (or not knowing the cable-free alternative) delays diagnosis
  by a full day for no reason.
- `xcrun devicectl device process launch --console` runs its argument
  parsing through Swift ArgumentParser. Passing framework debug flags like
  `-com.apple.CoreData.CloudKitDebug 3` **without** a `--` separator between
  devicectl's own options and the launched process's arguments makes
  ArgumentParser misparse them as devicectl options — the flags silently
  don't reach the launched process, and CoreData/CloudKit debug logging never
  turns on.
- `devicectl device process launch --console` and `idevicesyslog` both
  capture stdout/stderr of the launched process, but **neither carries
  `os_log`/`Logger` output at all** — os_log is written through the unified
  logging subsystem, not through the process's stdio streams these tools
  attach to. Watching either tool for `Logger.debug(...)` calls is a dead
  end regardless of how the process was launched.

## Fix

**Crash first, hypotheses second.** For any device-only crash, pull the
actual crash log before theorizing — the top stack frames discriminate
between hypotheses in seconds, and often point somewhere no hypothesis would
have reached (a framework-internal assertion, not app code):

- Xcode → Window → Organizer → Crashes — auto-syncs from App Store Connect
  for TestFlight builds, with dSYMs already available from CI/fastlane, but
  can lag ~a day.
- Cable-free, no lag: on-device Settings → Privacy & Security → Analytics &
  Improvements → Analytics Data → find `<AppName>-*.ips` → AirDrop it off.

**CLI crash retrieval (no GUI).** Preflight first: the device is unlocked,
trusted and plugged in. A `lockdownd` error `-21` means retry once after
unlocking (seen twice, then success, in one app's crash pull).

- `xcrun devicectl device copy from --device <UDID> --domain-type systemCrashLogs
  --source . --destination ./crashes` — the subcommand and flags exist (checked
  against `devicectl device copy from --help`). **Unverified:** whether it returns
  third-party app `.ips` files; confirm with one device run before relying on it.
- `idevicecrashreport -e -k -f <AppName> ./crashes` — from libimobiledevice
  (`brew install libimobiledevice`, optional). Pulls `.ips` files over USB; `-k`
  keeps them on the device. One app's pull of five reports gave one identical
  faulting stack. Reported by that session, not re-run here.
- Reading an `.ips`: recent files are a one-line JSON header (`bug_type`,
  `app_name`, `os_version`) followed by the JSON report (`exception`, `threads`,
  `usedImages`; frames map to a binary through `usedImages`). A `bug_type` of
  `248` on an `Applaunch` file is a KPerf sample, not a crash. A `SIGABRT` with
  `objc_exception_throw` on the stack is an Objective-C exception, which a Swift
  `catch` cannot see: install `NSSetUncaughtExceptionHandler` to log it.
- App data (a diagnostic log the app writes): `xcrun devicectl device copy from
  --device <UDID> --domain-type appDataContainer --domain-identifier <bundle-id>
  --source Documents/diag.log --destination ./diag.log`. Only works for a
  dev-signed build; a TestFlight build's container is locked. Reported working in
  one app, not re-run here.

**OS-level log capture, once a crash log alone isn't enough:**

- CoreData/CloudKit diagnosis — always put `--` before the debug flags:

  ```
  xcrun devicectl device process launch --device <UDID> --console <bundle-id> -- \
    -com.apple.CoreData.CloudKitDebug 3 \
    -com.apple.CoreData.Logging.stderr 1
  ```

  `--device <UDID>` and the `<bundle-id>` positional are required (usage:
  `devicectl device process launch [<options>] --device <device>
  <bundle-identifier-or-path> [<command-line-arguments> ...]`); list devices
  with `xcrun devicectl list devices`. Omitting `--` is the failure mode
  described above — the flags vanish silently, no error. With `--` in place,
  this is what surfaced the real underlying error (`NSCocoaErrorDomain
  134060`, "CloudKit integration requires that all relationships be
  optional") behind a wrapper that only said `SwiftDataError error 1`.
- General `os_log`/`Logger` capture — do **not** reach for `devicectl
  --console` or `idevicesyslog`; launch with the `OS_ACTIVITY_DT_MODE`
  environment variable set instead, or use Console.app (GUI, but reliably
  shows unified-logging output devicectl and idevicesyslog both miss).
  devicectl forwards environment variables to the launched process in two
  ways, either of which sets `OS_ACTIVITY_DT_MODE`. Status: **reported working
  in a past session (see Evidence), not re-verified here**; `os_log` output
  should appear mirrored on the `--console` stream, so confirm on a device
  before relying on it.

  ```
  # caller-environment form: set in the calling environment with a
  # DEVICECTL_CHILD_ prefix (per devicectl help)
  DEVICECTL_CHILD_OS_ACTIVITY_DT_MODE=YES \
    xcrun devicectl device process launch --device <UDID> --console <bundle-id>

  # explicit form: JSON dictionary (overrides DEVICECTL_CHILD_ variables)
  xcrun devicectl device process launch --device <UDID> --console \
    -e '{"OS_ACTIVITY_DT_MODE": "YES"}' <bundle-id>
  ```
- Once diagnosed, don't leave the next occurrence dependent on repeating a
  device-console capture: mirror the framework's error-unwrap logic to
  bounded depth (walk `NSUnderlyingErrorKey` up to ~10 levels, guarding
  circular chains) into an in-app diagnostic surface, so the real
  `NSCocoaErrorDomain` code and message show up in-app next time instead of
  a bare `SwiftDataError error 1`.

## Evidence

- Session 0021: "Real stack: `_assertionFailure` ← `swift_unexpectedError` ←
  `SwiftUI.NavigationColumnState.boundPathChange`… Both prior session
  hypotheses (Production-schema rename, multi-device CloudKit import race)
  were wrong." — the crash log was a SwiftUI-internal `NavigationSplitView`
  assertion, unreachable from app-code reading.
- Session 0017: the `CloudKitDebug` devicectl invocation (with the `--`
  separator) revealed `NSCocoaErrorDomain 134060` after
  `localizedDescription` and a one-level `NSUnderlyingErrorKey` unwrap both
  dead-ended.
- Session 0018: "devicectl console does NOT carry os_log (idevicesyslog
  neither) — `OS_ACTIVITY_DT_MODE` env-var launch does." The first half is the
  session's observation; the env-var launch is the session's report and has not
  been re-run by this skill (same status as in the Fix section).

## Related skills

- `swiftdata-cloudkit-model-rules` — the CloudKit model-validity rules whose
  violation this skill's example error (`NSCocoaErrorDomain 134060`,
  non-optional relationships) actually diagnoses.
- `scan-crash-recovery-store` — in-app crash recovery; a natural home for the
  bounded-depth error-unwrap surface described in the Fix section.
