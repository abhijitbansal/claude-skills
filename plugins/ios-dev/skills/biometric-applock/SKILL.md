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
   from a non-key window can fail silently. Locking on `.background` leaves the
   app-switcher snapshot, which iOS takes as the scene goes inactive: put a
   blank **privacy cover** (never a prompt, never the lock) up while
   `scenePhase != .active` — see "Privacy cover" below. App Intents, deep links, and
   notification handlers arrive *before* auth resolves — gate them on
   `isLocked`, or an action (e.g. a scan) can start behind the lock screen.
   The gate is **drop, never defer**: a link queued for after unlock fires
   the moment the user authenticates and navigates somewhere they never
   chose. See `deep-link-resolver-applock-pathtraversal`.

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

## Privacy cover for the app-switcher snapshot

```swift
struct PrivacyCover: View {
    var body: some View { Color(.systemBackground).ignoresSafeArea() }
}

struct Root: View {
    @Environment(\.scenePhase) private var scenePhase
    var lockIfEnabled: () -> Void

    var body: some View {
        Text("content")
            // Blank cover for the app-switcher snapshot while the scene is not
            // active. It is a PRIVACY cover, not the lock: it never prompts.
            .overlay { if scenePhase != .active { PrivacyCover() } }
            // The lock itself still engages on .background only (pitfall 4).
            .onChange(of: scenePhase) { _, phase in
                if phase == .background { lockIfEnabled() }
            }
    }
}
```

Not yet verified on a device: whether this overlay also blanks a `sheet` or
`fullScreenCover` that was already open when the app left the foreground (a
UIKit presentation layer can render above an overlay — the reason for pitfall 2).
Check it with a sheet open: background the app, open the app switcher, look at
the snapshot. If the sheet shows, the cover has to live in a separate window.

## Authentication outcomes

- **Plist:** `NSFaceIDUsageDescription` must be in Info.plist, or Face ID
  evaluation fails on a device that has it.
- **Policy:** use `.deviceOwnerAuthentication` (biometrics, then the device
  passcode). `.deviceOwnerAuthenticationWithBiometrics` has no passcode
  fallback, so a biometric lockout strands the user.
- **Outcomes:** map `LAError` codes to states instead of treating every failure
  as "locked, try again". A cancelled prompt stays locked and allows a retry; a
  lockout needs the passcode; no passcode set means the lock cannot work.

```swift
enum AuthOutcome: Equatable {
    case success
    case cancelled          // user/system dismissed the prompt: stay locked, allow retry
    case lockedOut          // too many biometric failures: passcode is now required
    case unavailable        // no passcode set / biometry not available
    case failed             // anything else: stay locked, allow retry
}

@MainActor
func authenticate(reason: String) async -> AuthOutcome {
    let context = LAContext()
    // .deviceOwnerAuthentication = biometrics, then the device passcode as the
    // fallback. .deviceOwnerAuthenticationWithBiometrics has NO passcode
    // fallback: a lockout then strands the user.
    var policyError: NSError?
    guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &policyError) else {
        return .unavailable
    }
    do {
        let ok = try await context.evaluatePolicy(.deviceOwnerAuthentication,
                                                  localizedReason: reason)
        return ok ? .success : .failed
    } catch let error as LAError {
        switch error.code {
        case .userCancel, .systemCancel, .appCancel: return .cancelled
        case .biometryLockout: return .lockedOut
        case .passcodeNotSet, .biometryNotAvailable, .biometryNotEnrolled: return .unavailable
        default: return .failed
        }
    } catch {
        return .failed
    }
}
```

## Hard rules — do NOT regress

- `isLocked` is set in the lock controller's `init`, never first in `onAppear`.
- The lock view is a `.fullScreenCover`, never an `.overlay`.
- Disabling the lock passes through an auth gate.
- Background (not inactive) drives locking; every external entry point checks
  `isLocked` before acting.

## Evidence

This skill records no commit or session behind its four pitfalls, and says so
rather than inventing one. What was checked on 2026-11-15: the two snippets above
typecheck in Swift 6 against the iOS 27.2 simulator SDK. Not verified: the
sheet-open presentation case in pitfall 2 and the privacy cover over an open
sheet (both need a device). Do not rewrite pitfall 2 until that device test is
done.

## Related skills

- `deep-link-resolver-applock-pathtraversal` — the one-pure-resolver pattern
  for deep links: drops (never defers) links while locked and validates paths.
- `widget-appgroup-snapshot-bridge` — widgets render from an App Group
  snapshot outside the app process, so the lock does not cover them; the
  snapshot writer mirrors the lock flag into the shared suite and the widget
  reader redacts at render time while it is set.
