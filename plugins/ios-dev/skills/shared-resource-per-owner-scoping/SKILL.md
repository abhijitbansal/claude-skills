---
name: shared-resource-per-owner-scoping
description: One screen's teardown kills a resource another screen is still using, or one path's failure permanently disables a feature for every other caller — a shared singleton (speech transcriber, camera session, model session, circuit breaker, token budget) is stopped/tripped by whoever finishes first, because the stop path checks a bare Bool like isListening instead of "am I still the owner". Symptoms: voice input returns nothing after the second use, a suggestion feature silently dies for the rest of the launch, a capture session tears down mid-handoff, cancelling one request cancels an unrelated one. Use whenever a stateful service is shared across screens or requests and any caller can stop, cancel, reset or trip it — before writing the stop/teardown path, not after the bug.
---

# Shared Resources Need Per-Owner Scoping, Not a Boolean

## Symptom

A stateful service is created once and shared: a speech transcriber, an
`AVCaptureSession`, an on-device model session, a circuit breaker, a rate
limiter. Two screens (or two requests) use it in overlapping windows. Then:

- Screen B's `stop()` tears down the session Screen A is still using — A hangs
  or returns nothing, with no error anywhere.
- One path trips a shared circuit breaker after a failure, and an unrelated
  read-only consumer of the same breaker is dead for the rest of the launch.
- A cancel intended for request 1 lands on request 2, because by the time the
  cancel ran, the shared handle had been rebound.

The tell is that the *first* use always works and the failure needs two
overlapping users, so it survives every single-screen test.

## Root cause

The stop path asks **"is it running?"** when it must ask **"am I still the one
who started it?"**

```swift
// WRONG — any caller can stop anyone's session
func stop() {
    guard isListening else { return }
    engine.stop()
    isListening = false
}
```

`isListening` is true regardless of *who* made it true. A bare `Bool` cannot
express ownership, so every teardown is a global teardown.

## The fix: record identity at start, compare it at every exit

```swift
private var currentOwner: ObjectIdentifier?   // or a monotonic generation token

func start(owner: AnyObject) {
    currentOwner = ObjectIdentifier(owner)
    engine.start()
}

func stop(owner: AnyObject) {
    // Not "is it running" — "is it still MINE"
    guard currentOwner == ObjectIdentifier(owner) else { return }
    engine.stop()
    currentOwner = nil
}
```

A **monotonic generation token** works equally well when only one owner is ever
live, and survives object reuse:

```swift
private var generation = 0

func start() -> Int { generation += 1; engine.start(); return generation }
func stop(token: Int) { guard token == generation else { return }; engine.stop() }
```

Pick the shape by how many owners can be live at the same time — the three are
not interchangeable:

| Shape | Use when | Why |
|---|---|---|
| Monotonic generation token | Exactly one owner is live at a time | A stale token compares unequal, so a late `stop` no-ops |
| Per-owner registry (`Set<ObjectIdentifier>`) | Several owners can be live concurrently | Each `stop` releases only its own entry; the resource stays up while anyone holds it |
| A reference **count** | Never | A count cannot *attribute* a stop — a stop from an earlier teardown decrements to zero and releases a resource a later owner is still using |

The count row is the trap, because a count looks like a generation token and
compiles the same. "Is anyone using it?" is not the question; "is this caller
the one I owe a teardown to?" is.

## The three rules that make it actually hold

**1. "At start" means before the first suspension point.** This is the rule
people get wrong after fixing everything else. If ownership is recorded *after*
an `await`, there is a window where the resource is live and unowned:

```swift
// WRONG — the authorize() await is an ownership hole. A stop() arriving
// during it finds currentOwner == nil and no-ops, so the session it was
// meant to stop keeps running.
func start(owner: AnyObject) async throws {
    try await requestAuthorization()          // <-- suspension point
    currentOwner = ObjectIdentifier(owner)    // too late
    engine.start()
}

// RIGHT — claim first, release on failure.
func start(owner: AnyObject) async throws {
    currentOwner = ObjectIdentifier(owner)
    do { try await requestAuthorization() }
    catch { currentOwner = nil; throw error }
    engine.start()
}
```

**2. Every teardown path compares identity — not just the obvious one.**
`stop()`, `deinit`, `onDisappear`, a backgrounding notification, a timeout
handler, and an error path are all teardowns. One unguarded path reintroduces
the whole bug.

**3. Blast radius runs in the availability direction too.** A shared
*circuit breaker* is the same defect wearing different clothes: one path's
failures trip it, and a read-only consumer that never failed inherits the trip.
If the breaker is shared, its state must be keyed per consumer — or the
consumers must not share it. A one-way trip with no reset is strictly worse: the
feature is dead until the app relaunches, and nothing logs why.

## Fixing the async-callback version reopens the race

A common "fix" moves ownership assignment into a completion callback so it
reflects the real session. That reintroduces the hole from rule 1 — the callback
runs after suspension. Claim synchronously; correct or release in the callback.

## How to test it

The single-owner test always passes and proves nothing. The tests that catch it:

- **Interleaved owners:** A starts, B starts, A stops → assert B's session is
  still live. This is the one that fails before the fix.
- **Stale stop:** A starts, A stops, B starts, A's late timeout fires → assert
  B survives.
- **Suspension-window stop:** stop arrives while `start` is awaiting
  authorization → assert the eventual session does not leak.
- For a breaker: consumer X fails enough to trip → assert consumer Y still works.

Make the decision a pure function (`shouldStop(current:requesting:) -> Bool`)
and these become plain unit tests with no hardware.

## Checklist

- [ ] Ownership is an identity (`ObjectIdentifier` / generation token), never a `Bool`
- [ ] Recorded **before the first `await`** in the start path, released on failure
- [ ] Every teardown path — including `deinit`, backgrounding and timeouts — compares it
- [ ] Shared breakers/limiters are keyed per consumer, or not shared
- [ ] A tripped breaker has a reset path and logs the trip
- [ ] An interleaved-owner test exists and fails against the pre-fix code

## Evidence

Cubby iOS, four separate reports of one defect across two sessions — the reason
this is a skill and not a bug note.

- **Session 0066 (2026-07-25), BUG-044** — "one transcriber is shared app-wide
  and every host fires `.onDisappear { voice?.stop() }` — including hosts that
  never started anything." First scoped to `phase != .idle`, then corrected on
  review to a real ownership flag, because `.preparing` also spans a vocabulary
  fetch during which the model owns no session: "the coarse guard still allowed
  a cross-host kill from that window." That is rule 1 — the claim has to bracket
  the suspension, not follow it.
- **Session 0066, BUG-045** — the count row of the table above, found the hard
  way: "Handoff is a live-session registry, not a stop counter. A counter cannot
  attribute a stop, so a stop from an earlier teardown could release a later
  switch while the outgoing session was still draining — reintroducing the very
  contention the window exists to prevent."
- **Session 0068 (2026-07-26), findings #4 and #5** — rule 2, twice. The guard
  shipped for BUG-044 "reached `handleRecognition` but not `stop()`", re-opening
  the original symptom; and a camera handoff "is a process-wide unkeyed `Bool`"
  while its own sibling in the same file had already moved to a per-owner
  `Set<ObjectIdentifier>`. Fixed with a session token handed out by an
  `onStarted` callback fired "right after the generation bump — deliberately
  **before** hardware setup, so a dismiss racing setup still holds a token", and
  a `stop(sessionToken:)` gated on a pure `ownsLiveSession` predicate.
- **Session 0068, finding #2** — rule 3, the availability direction: one circuit
  breaker served both an output refiner and a label suggester, so the suggester
  inherited every trip the refiner earned. Fixed with a second breaker instance
  at the composition root.

The pure-predicate shape in "How to test it" is not hypothetical: making
ownership a free function is what let these land as plain unit tests on a
codebase whose camera and microphone paths are otherwise device-only.

## Related skills

- `avfoundation-capture-delivery-watchdog` — the sibling failures on the same
  hardware. Three root causes, one symptom: the delegate **never came** (its Fix
  1), two sessions **overlapped during a swap** (its Fix 2), or someone else's
  `stop()` **killed a session you own** (here). Route to all three before
  concluding a capture bug is fixed.
- `shared-action-overload-callsite-audit` — the same blast-radius error in the
  behavioural direction: widening one shared action to satisfy one caller
  silently changes every other call site that reuses it.
- `nonsendable-hardware-handle-inline-io` — a sibling constraint on the same
  shared handles: the handle itself cannot cross an isolation boundary, so the
  ownership check has to live where the handle does.
- `field-log-duration-clustering-race-diagnosis` — how to confirm this class
  from the field when the interleaving only happens on a real device.
