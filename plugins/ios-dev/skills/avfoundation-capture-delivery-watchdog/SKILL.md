---
name: avfoundation-capture-delivery-watchdog
description: Camera capture "gets stuck" with no error — shutter button stays disabled, capturing spinner/overlay never clears, no crash, no thrown error — especially after navigating back and recapturing, or in a continuous-add loop that tears down and recreates the AVCaptureSession. The AVCapturePhotoCaptureDelegate callback (photoOutput(_:didFinishProcessingPhoto:) / didFinishCaptureFor) simply never fires because capturePhoto ran against a session mid-teardown/re-mount race, and there is no timeout to notice. This is NOT the 0x8BADF00D launch-time watchdog SIGKILL (see mainactor-launch-watchdog-audit) — it is a silent runtime stall with the app fully alive. Use when triaging a frozen capture flow, when adding a shutter handler on top of AVCapturePhotoOutput, or when any one-shot async hardware delegate callback re-arms UI state only in its callback with no timeout.
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

## Fix

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

## Evidence

- **cubby** — continuous-add capture loop ("scan another item") intermittently
  froze the shutter with no error after a few captures; traced to the
  `AVCapturePhotoCaptureDelegate` callback never firing on a session
  re-mount race, fixed with a `uniqueID`-keyed watchdog + exactly-once
  resolver.

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
