---
name: ml-actor-lazy-load-graded-eviction
description: A heavy on-device model (Core ML, MLX VLM, or any large-buffer resource) hangs or crashes at actor/type init before first use, or a low-memory warning triggers evict() which cancels its own in-flight generation with a CancellationError ~0.4s in, which then cascades into a downstream consumer (e.g. a refiner) timing out because its timeout budget assumed the primary path never self-interrupts. Use when designing or debugging an actor that wraps a heavy on-device ML/large-buffer resource and must load it lazily, cache load failures, and respond correctly to both app-backgrounding and iOS memory-pressure notifications — two semantically different eviction triggers that are easy to treat identically by mistake.
---

# On-device ML actor: lazy load, cached failure, and graded eviction

## Symptom

- App hangs or crashes on launch/object creation, before the heavy model is
  ever used — traced back to eager model loading in the actor's/type's
  `init`. (Paperix `DocEnhanceModel.swift`, fixed by commit `1f3040c`.)
- A low-memory warning fires, the app's memory handler calls
  `vlmEngine.evict()`, and the *in-flight generation the user was actively
  waiting on* aborts with `CancellationError` after ~0.4s — even though the
  actual memory-pressure notification had nothing to do with that specific
  request.
- Immediately after that cancellation, a downstream consumer (a refiner
  stage, a retry path) times out, because its timeout budget was sized
  assuming the primary path completes or fails cleanly — not that it gets
  yanked out from under it mid-flight.
- Root cause was only confirmed by decoding a real device diagnostic log: the
  memory-pressure timestamp lined up exactly with the cancellation timestamp.

## Root cause

Two compounding actor-lifecycle mistakes:

1. **Eager load at init.** Loading a heavy Core ML/MLX model synchronously (or
   even as an unawaited side effect) inside `init` blocks the caller — on the
   main thread this hangs or crashes the app before the model is ever needed.
2. **Undifferentiated eviction.** Treating every eviction trigger the same
   way conflates two semantically different events:
   - **Backgrounding** — the resource (e.g. Metal) genuinely cannot keep
     running once the app is backgrounded. Cancelling in-flight work now is
     correct and necessary.
   - **Memory pressure** — the app is still foreground and the user is still
     waiting on the in-flight result. Cancelling it mid-flight is a
     self-inflicted failure: the system asked to free memory *eventually*,
     not to abort the active request. Naive code calls the same
     `evict()`/cancel path for both, so a memory-pressure notification
     silently kills a live generation and any downstream timeout budget
     built on "the primary path only fails via its own errors" now breaks.

## Fix

**1. Lazy load, gated behind first use, with cached failure and a shared
in-flight load task.**

- Never load the model at `init`. Gate loading behind the actor's first-use
  entry point.
- Cache a load failure so repeat calls don't retry a load that's already
  known to be doomed.
- Make concurrent callers share one in-flight load `Task` (reentrancy-safe)
  instead of racing multiple independent loads.

**2. Grade eviction by reason; only `.backgrounded` may cancel.**

```swift
enum EvictionReason {
    case backgrounded     // Metal etc. genuinely cannot run in background
    case memoryPressure   // app is foreground; user is still waiting
}

func evict(reason: EvictionReason) async {
    switch reason {
    case .backgrounded:
        // cancel ALL in-flight callers now, then unload immediately.
        for task in inFlightGenerations.values { task.cancel() }
        inFlightGenerations.removeAll()
        await unload()
    case .memoryPressure:
        // never cancel active generation/load. Defer the unload until
        // in-flight work resolves on its own.
        pendingEvict = true
        if inFlightGenerations.isEmpty { await unload() }
        // last caller to finish checks `pendingEvict` and unloads then.
    }
}
```

- Track in-flight work per-caller (e.g. UUID-keyed dictionary of `Task`s) so
  a deferred (`.memoryPressure`) unload can wait for the *last* active caller
  to finish, while a `.backgrounded` unload cancels *all* of them
  immediately.
- Loosen any downstream timeout that implicitly assumed the primary path
  never self-interrupts — in the source incident, `refinerTimeoutSeconds`
  went from 4 to 8 once the primary path could legitimately still be
  in-flight longer under `.memoryPressure` (since it's no longer cancelled
  out from under the refiner).

## Evidence

- Session 0018: "Learn model-loading lessons from the Paperix repo branch ...
  its Core ML model initially hung/crashed on load; fix commit `1f3040c` =
  lazy-load off init." "MLXVLMEngine actor implements the Paperix contract
  (lazy load, cached failure, evict) + reentrancy-safe shared load task."
- Session 0019: "model load spiked memory → iOS low-memory warning →
  `CubbyApp.swift:325-334` handler called `vlmEngine.evict()` → evict
  cancelled its own in-flight generation (`CancellationError` 0.4s in);
  refiner then `timedOut`... Fix: `evict(reason:)` — `.backgrounded` = cancel
  + unload now (Metal); `.memoryPressure` = defer unload until in-flight
  generation/load resolves, never cancel; `refinerTimeoutSeconds` 4→8...
  UUID-keyed inFlightGenerations dict (deferred unload waits for LAST,
  backgrounded cancels ALL)."
- Root cause confirmed by lining up a real device diagnostic log's
  memory-pressure timestamp exactly against the cancellation timestamp.
- Mined from Cubby iOS session logs (0018, 0019); adversarially verified.
  Generalizes beyond MLX VLM to any Core ML/large-buffer resource wrapped in
  an actor — not Cubby- or MLX-specific.

## Related skills

- `mainactor-runtime-isolation-trap` — related actor-isolation footguns under
  `SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor`.
- `swift6-mainactor-compile-fixes` — broader Swift 6 concurrency migration
  context for actor-wrapped resources like this one.
