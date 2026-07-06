# Re-entrancy guards: PhotoSyncRunGuard + idempotent lifecycle checks

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
