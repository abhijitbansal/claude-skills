---
name: biometric-applock
description: Implementing or reviewing a SwiftUI Face ID / passcode (LAContext) app lock. Covers four real bypass/exposure pitfalls — lock in init not onAppear (app-switcher snapshot leak), fullScreenCover not overlay (UIKit presentation layers render above overlays), require auth to disable the toggle, and lock on .background only while gating App Intents / deep links / notification handlers that arrive before auth resolves. Trigger when adding an app lock, porting one between codebases, or security-scanning a diff touching LAContext / scenePhase / lock UI.
---

# SwiftUI Biometric App Lock — Four Bypass Pitfalls

## Why this skill exists

The obvious SwiftUI Face ID lock (a `isLocked` flag + `.overlay` + an
`onAppear` bootstrap) has four real bypass/exposure windows that all pass
casual manual testing. Each one looks fine until an attacker — or a
reviewer — hits the exact timing.

## When to use

- Implementing or reviewing any biometric app lock in SwiftUI
- Porting a lock from another codebase — the donor may share these bugs
- Security-scanning a diff that touches `LAContext` / `scenePhase` / lock UI

## The four pitfalls (and the fix for each)

1. **Lock in `init`, not `onAppear` / bootstrap.** `onAppear` fires *after*
   the first layout pass; iOS can snapshot unlocked content for the app
   switcher inside that window. Set `isLocked = isEnabled` when the lock
   controller is constructed; `onAppear` should only *prompt*, never decide
   the initial locked state.

2. **Present the lock as `.fullScreenCover`, never `.overlay`.** Overlays
   draw at the attached view's z-level; any UIKit presentation layer (a
   sheet or `fullScreenCover` left open underneath) renders *above* the
   overlay and leaks content. A cover joins the same presentation stack and
   sits on top. Add `.interactiveDismissDisabled()` and a setter-ignoring
   `Binding` (`set: { _ in }`) so only successful auth dismisses it.

3. **Require auth to DISABLE the toggle.** A direct `$lock.isEnabled`
   binding lets anyone holding the unlocked phone turn the lock off. Route
   the *false* transition through an `evaluatePolicy` gate — with a fallback
   that allows disabling when biometrics/passcode were removed at the OS
   level, so you don't brick the setting.

4. **Lock on `.background` only, and gate external triggers.** `.inactive`
   fires on notification banners / Control Center, where `LAContext` prompts
   from a non-key window can fail silently. App Intents, deep links, and
   notification handlers arrive *before* auth resolves — gate them on
   `isLocked`, or an action (e.g. a scan) can start behind the lock screen.

## Example wiring

```swift
ContentView()
    .environment(appLock)
    .fullScreenCover(isPresented: Binding(
        get: { appLock.isLocked }, set: { _ in })) {
        AppLockOverlayView().interactiveDismissDisabled()
    }
    .onAppear { appLock.bootstrap() }   // prompt only; lock set in init
```

## Hard rules — do NOT regress

- `isLocked` is set in the lock controller's `init`, never first in `onAppear`.
- The lock view is a `.fullScreenCover`, never an `.overlay`.
- Disabling the lock passes through an auth gate.
- Background (not inactive) drives locking; every external entry point checks
  `isLocked` before acting.
