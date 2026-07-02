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

```swift
// WRONG — formed in @MainActor context, closure inherits @MainActor;
// UIKit caches it and resolves it on com.apple.SwiftUI.AsyncRenderer → brk 1
enum Palette {
    static let card = UIColor { traits in
        traits.userInterfaceStyle == .dark ? darkCard : lightCard
    }
}
```

```swift
// CORRECT
enum Palette {
    // 1. Store the resolved provider as `nonisolated static let`.
    // 2. Mark the closure @Sendable so inherited isolation is a compile error.
    nonisolated static let card = UIColor { @Sendable traits in
        resolvedCard(for: traits.userInterfaceStyle)   // 3. everything it calls…
    }

    // …must itself be nonisolated (pure compute, no main-actor state).
    nonisolated static func resolvedCard(for style: UIUserInterfaceStyle) -> UIColor {
        style == .dark ? darkCard : lightCard
    }
}
```

The `nonisolated` seam (`resolvedCard`) doubles as the off-main regression test
hook:

```swift
func testDynamicColorResolvesOffMain() async {
    await Task.detached {
        _ = Palette.card.resolvedColor(
            with: UITraitCollection(userInterfaceStyle: .dark))
    }.value
}
```

Audit every closure handed to a UIKit/Obj-C API that stores it: color/image
providers, `UIAction` handlers, `CADisplayLink`/timer targets.

## Fix — variant B: run guards + idempotent lifecycle

Coalescing run guard (cubby's `PhotoSyncRunGuard`): one pass in flight, a
re-trigger schedules exactly one follow-up instead of interleaving.

```swift
@MainActor
final class PhotoSyncRunGuard {
    private var activeTask: Task<Void, Never>?
    private var isRerunRequested = false

    func run(_ pass: @escaping @MainActor () async -> Void) {
        guard activeTask == nil else { isRerunRequested = true; return }
        activeTask = Task {
            repeat {
                isRerunRequested = false
                await pass()
            } while isRerunRequested
            activeTask = nil
        }
    }
}
```

`isProcessing` no-op guard for UI actions, and idempotent lifecycle
(floorprint: `viewDidAppear` fired twice → restarted the capture session, reset
the elapsed clock, leaked a second timer):

```swift
override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    guard !hasStartedCapture else { return }   // UIKit can fire this twice
    hasStartedCapture = true
    startCaptureSession()
}

func startTimer() {
    timer?.invalidate()                        // never leak a second timer
    timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { … }
}

func overlayTapped(_ action: OverlayAction) {
    guard !isProcessing else { return }        // lock actions mid-processing
    handle(action)
}
```

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
- `swift6-mainactor-migration` — compile-time isolation errors and the
  honest `nonisolated` cascade for pure-compute types.
- `nonisolated-struct-codable-mainactor` — Codable synthesis under
  MainActor-default isolation.
