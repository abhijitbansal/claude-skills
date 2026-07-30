---
name: avfoundation-capture-delivery-watchdog
description: Camera capture "gets stuck" with no error — shutter button stays disabled, capturing spinner/overlay never clears, no crash, no thrown error — especially after navigating back and recapturing, or in a continuous-add loop that tears down and recreates the AVCaptureSession. The AVCapturePhotoCaptureDelegate callback (photoOutput(_:didFinishProcessingPhoto:) / didFinishCaptureFor) simply never fires because capturePhoto ran against a session mid-teardown/re-mount race, and there is no timeout to notice. The same session race has a second, more visible face: a stall, a reload, or a fully black preview on every switch between capture modes or lenses, because a SwiftUI `.id(mode)` re-host constructs the incoming session before the outgoing one has finished stopRunning — device-only, so the simulator and CI never see it. This is NOT the 0x8BADF00D launch-time watchdog SIGKILL (see mainactor-launch-watchdog-audit) — it is a silent runtime stall with the app fully alive. Use when triaging a frozen capture flow, when adding a shutter handler on top of AVCapturePhotoOutput, when any one-shot async hardware delegate callback re-arms UI state only in its callback with no timeout, or when a capture screen switches modes/lenses by changing SwiftUI view identity.
---

# AVFoundation Capture Delivery Watchdog

## Symptom

A still-photo capture flow built on `AVCapturePhotoOutput.capturePhoto(with:delegate:)`
freezes: the shutter handler disables the button and shows a "capturing"
overlay, and it **never clears**. No crash, no error, no log line — just a
stuck UI. It reproduces most reliably when the capture view (and its
`AVCaptureSession`) is torn down and recreated in a loop: continuous-add
("scan another item"), or navigate-back-and-recapture. Reads to the user as
"added N items then it just froze."

Do not confuse this with the launch-time `0x8BADF00D` watchdog SIGKILL
(`mainactor-launch-watchdog-audit`) — that one kills the app at launch with a
crash report; this one is a live, running app whose capture path simply
stops progressing, with nothing to point at in the console.

## Root cause

Re-arming the shutter (`isCapturing = false`, re-enable button, hide overlay)
happens **only inside the `AVCapturePhotoCaptureDelegate` callbacks**. There is
no timeout anywhere in the path. If `capturePhoto` is called against a session
that isn't fully running — the classic hazard on a re-mount: the previous
controller's session on the same physical camera hasn't fully released while
the new controller's `startRunning()` is still pending on its `sessionQueue`
— the delegate callback can simply never fire. Nothing re-arms the UI because
nothing was ever waiting for a timeout; it was only waiting for a callback
that isn't coming.

Before blaming this, adversarially rule out downstream gates that look
similar but aren't silent: a blur/sharpness gate typically re-arms *before*
its guard and shows a banner (not silent); a save/persistence step with zero
`await` suspension points structurally cannot hang or swallow an error. Check
for actual suspension points / error propagation before assuming a downstream
stage ate the failure — the real culprit is usually further upstream, in the
one-shot hardware callback that never arrives.

## Fix 1 — a `uniqueID`-keyed delivery watchdog

Add a **delivery watchdog keyed by the capture's `uniqueID`**, armed
*synchronously* before the capture is dispatched, with an exactly-once
resolver so neither a late delegate callback nor the watchdog itself can
double-resolve — or resolve a *stale* capture from a previous, abandoned
attempt. Because `capturePhoto` is dispatched onto `sessionQueue`, the
capture settings must cross an actor boundary — box them in an
`@unchecked Sendable` wrapper rather than widening isolation.

The core decision rule is a guarded exactly-once resolver keyed by capture id:

```swift
private func resolveCapture(_ id: Int64, _ body: @MainActor () -> Void) {
    guard pendingCaptureID == id else { return }  // stale id: drop, no-op
    pendingCaptureID = nil
    watchdog?.cancel()
    body()
}
```

**Read `references/watchdog.md` before implementing** — has the full wrong-vs-correct
pair: the naive callback-only re-arm that hangs forever, and the complete
`CaptureController` with the `uniqueID`-keyed watchdog, the exactly-once
`resolveCapture`, and the `@unchecked Sendable` settings box.

Because `pendingCaptureID` is set synchronously on the main actor before the
capture is dispatched, the delegate can never race ahead of it. After a
timeout + retap, the stale old callback's `uniqueID` no longer matches the
current `pendingCaptureID`, so it's silently dropped instead of corrupting
the next capture.

The watchdog is the safety net, not the cure — the deeper fix is to **reuse
one `AVCaptureSession` across the loop** instead of tearing it down and
recreating it per capture, which removes the re-mount race at the source.
That fix is harder to validate without a physical device; ship the watchdog
first so the failure mode becomes a recoverable error instead of a silent
freeze.

## Fix 2 — `.id(mode)` re-hosting does not serialize teardown

A common way to switch capture modes in SwiftUI is to force a fresh view
identity:

```swift
CameraView(mode: mode)
    .id(mode)          // new identity per mode -> SwiftUI rebuilds the view
```

This reliably creates the *new* view. It does **not** wait for the old one's
`AVCaptureSession` to finish tearing down. SwiftUI's teardown of the outgoing
identity and construction of the incoming one overlap, so two sessions briefly
contend for the same hardware. Symptoms: a visible stall or reload on every mode
switch, a black preview, or a capture that never delivers because the delegate
belongs to the session that just died.

The failure is **device-only** — the simulator has no camera, so every
simulator run and every unit test passes. It reaches users through the one path
CI cannot see.

**Fix: gate on an explicit teardown-complete signal, not on view identity.**

```swift
// 1. Show a placeholder while the previous session unwinds.
if isSwitching {
    CapturePlaceholder()
} else {
    CameraView(mode: mode)
}

// 2. Drive the switch through the controller, which signals completion
//    out-of-band once the old session is genuinely stopped.
func switchMode(to newMode: Mode) {
    isSwitching = true
    controller.teardown { [weak self] in      // called after stopRunning() returns
        self?.controller.configure(for: newMode)
        self?.isSwitching = false
    }
}
```

The placeholder is not cosmetic — it is what prevents a second session from
being constructed during the window.

A fixed sleep is the tempting shortcut and it is a **mitigation, not a fix** —
the duration is a guess about hardware you do not control. If you ship one as a
stopgap, say so in the code, and when the real idle signal arrives keep the old
duration as a **ceiling** rather than deleting it: the switch can then only get
faster, and the serialization the window bought you is preserved.

Pair this with the `uniqueID`-keyed delivery watchdog above: the watchdog
catches a delegate that never fires, and this catches the re-mount that causes
it. They address the same user-visible symptom (a permanent spinner) from
opposite ends, and shipping only one leaves the other half of the class open.

**Verification is a device checklist item by construction.** Switch modes
rapidly, several times, and confirm no stall and no black preview. Do not claim
this fixed from a simulator run.

## Evidence

- **cubby** — continuous-add capture loop ("scan another item") intermittently
  froze the shutter with no error after a few captures; traced to the
  `AVCapturePhotoCaptureDelegate` callback never firing on a session
  re-mount race, fixed with a `uniqueID`-keyed watchdog + exactly-once
  resolver.
- **cubby, session 0063 (2026-07-23)** — Fix 2's origin. A unified capture
  screen hosted three flows behind a mode pill and re-hosted them with
  `.id(mode)`; the review found the resulting `AVCaptureSession` contention as a
  device-only hazard. The first fix (`e224b25`) rendered a neutral placeholder
  instead of the flow "so the outgoing flow unmounts (`viewWillDisappear` →
  `stopRunning`) before the incoming flow can mount + `startRunning`" — but was
  logged explicitly as "a MITIGATION, not a proven fix … the 350ms window is a
  heuristic, not a teardown-complete signal."
- **cubby, session 0066 (2026-07-25), BUG-045** — the real fix, two sessions
  later: "replaced the blind 350ms sleep with a real camera-idle signal
  (`CameraSessionHandoff`), keeping 350ms as a **ceiling** so the switch can only
  get faster and the s63 contention serialization is preserved." The structural
  cure — one long-lived session hoisted above the mode switch — was scoped out
  as its own task, which is why the gate is the shipped answer and not a
  placeholder for one.

## Related skills

- `mainactor-launch-watchdog-audit` — a different watchdog entirely: the OS
  `0x8BADF00D` launch-time SIGKILL from blocking the first frame, not a
  runtime capture stall in an already-running app.
- `scan-capture-quality-gates` — covers frames that *arrive* blurry or
  mis-named; this skill covers frames that never arrive at all. Gate quality
  there, watch delivery here.
- `mainactor-runtime-isolation-trap` — variant B (re-entrancy across
  `await`) covers a *different* capture bug: a session restarted mid-flight
  from a double-fired lifecycle callback, not a delegate that never fires.
- `field-log-duration-clustering-race-diagnosis` — a related timeout/race
  pattern (a timer arming before its guarded async task exists) diagnosed via
  field-log duration clustering rather than a repro.
- `nonsendable-hardware-handle-inline-io` — another AVFoundation/hardware
  session-lifetime hazard: a non-Sendable session handle that must do I/O
  inline rather than cross into a helper.
- `shared-resource-per-owner-scoping` — the third member of this family. Three
  distinct root causes wear one symptom: the delegate **never came** (Fix 1
  here), two sessions **overlapped during a swap** (Fix 2 here), or someone
  else's `stop()` **killed a session you still own** (that skill). Fixing one
  leaves the other two open.
