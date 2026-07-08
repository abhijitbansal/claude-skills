---
name: mainactor-runtime-isolation-trap
description: Intermittent EXC_BREAKPOINT / "brk 1" crash on thread com.apple.SwiftUI.AsyncRenderer with a UIColor/UIImage dynamic-provider closure as the top frame, reached via _swift_task_checkIsolatedSwift → dispatch_assert_queue — or, the sibling trap, duplicated/interleaved work because a @MainActor method re-entered across an await (leaked second timer, restarted capture session, overlapping sync passes). Both compile clean under SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor and only fail at runtime. Use when triaging an .ips crash log with those frames, when a closure handed to a UIKit/Obj-C API (dynamic color/image provider, UIAction handler, CADisplayLink/timer target) crashes off-main, or when @MainActor code shows re-entrancy symptoms.
---

# MainActor Runtime Isolation Traps (compiles clean, crashes at runtime)

Two runtime failure modes of `SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor` that no
compile gate or simulator smoke build catches. For the third (launch-watchdog
SIGKILL), see `mainactor-launch-watchdog-audit`.

## Symptom

**Variant A — executor-isolation trap.** Intermittent `EXC_BREAKPOINT` /
`brk 1`; the `.ips` shows thread `com.apple.SwiftUI.AsyncRenderer`, top frame a
dynamic-color/image closure (cubby: the `Theme.Palette` dynamic-color closure),
reached via `_swift_task_checkIsolatedSwift` → `dispatch_assert_queue`.

**Diagnosis reflex:** `.ips` thread == AsyncRenderer + `brk 1` +
`_swift_task_checkIsolatedSwift` → `dispatch_assert_queue` ⇒ executor-isolation
trap, **NOT** persistence. cubby initially misblamed SwiftData; the `.ips`
exonerated it.

**Variant B — re-entrancy across await.** Doubled timers, a capture session
restarted mid-scan, an elapsed clock reset, overlapping sync passes, a tap
handled by a screen that should be locked. No crash — just interleaved state.

## Root cause

**A:** A closure literal formed in `@MainActor` context *inherits* `@MainActor`
isolation. UIKit caches it and resolves it later OFF main → isolation
assertion. Applies to ANY closure a UIKit/Obj-C API stores and later invokes:
`UIColor { traits in … }` / `UIImage` dynamic providers, `UIAction` handlers,
`CADisplayLink`/timer targets. Compiles clean.

**B:** `@MainActor` serializes *threads*, not *logical passes*. Across an
`await` suspension point, a second entry (second `viewDidAppear`, second sync
trigger, second tap) begins before the first Task finishes.

## Fix — variant A: nonisolated-clean providers

Store the resolved provider as `nonisolated static let`; mark the closure
`@Sendable` so inherited isolation becomes a compile error instead of a
runtime trap; everything it calls must itself be `nonisolated` (pure compute,
no main-actor state):

```swift
nonisolated static let card = UIColor { @Sendable traits in
    resolvedCard(for: traits.userInterfaceStyle)
}
nonisolated static func resolvedCard(for style: UIUserInterfaceStyle) -> UIColor { … }
```

**Read `references/dynamic-provider.md` before implementing** — the WRONG
version (closure formed in `@MainActor` context, crashes on AsyncRenderer)
next to the full CORRECT pattern, plus the off-main regression test that
exercises the `nonisolated` seam.

Audit every closure handed to a UIKit/Obj-C API that stores it: color/image
providers, `UIAction` handlers, `CADisplayLink`/timer targets.

## Fix — variant B: run guards + idempotent lifecycle

Coalescing run guard (cubby's `PhotoSyncRunGuard`): one pass in flight, a
re-trigger schedules exactly one follow-up instead of interleaving. Pair it
with idempotent lifecycle guards at every entry point: a no-op guard so a
double-fired `viewDidAppear` doesn't restart work, `timer?.invalidate()`
before scheduling a new one so a second timer is never leaked, and a busy
guard so a tap mid-processing is dropped instead of misrouted.

**Read `references/reentrancy-guards.md` before implementing** — the full
`PhotoSyncRunGuard` class plus the `viewDidAppear`/timer/`overlayTapped`
guard examples (floorprint: a double-fire restarted the capture session,
reset the elapsed clock, and leaked a second timer).

This is distinct from the exactly-once `CheckedContinuation` idiom — that
guards a *callback resuming twice*; this guards a *pass starting twice*.

## Evidence

- **cubby** — `brk 1` on AsyncRenderer in the `Theme.Palette` dynamic-color
  closure; initially misblamed SwiftData, `.ips` exonerated it; fixed b67f6b6.
  Also "coalesce re-entrant photo-sync passes via PhotoSyncRunGuard".
- **floorprint** — "guard re-entrant viewDidAppear" (double fire → restarted
  capture session, reset elapsed clock, leaked second timer); "lock overlay
  actions while a room is processing" (tap misrouted the next `didEndWith` /
  resurrected a stopped session).

## Related skills

- `mainactor-launch-watchdog-audit` — the launch-time trap: 0x8BADF00D
  watchdog SIGKILL + boot-loop from heavy work on main.
- `swift6-mainactor-compile-fixes` — compile-time isolation errors: the honest
  `nonisolated` cascade for pure-compute types, incl. off-main Codable synthesis.
