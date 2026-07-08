# AVCapturePhotoCaptureDelegate delivery watchdog — wrong vs. correct implementation

```swift
// WRONG — re-arm lives only in the delegate callback; if it never fires,
// the shutter stays disabled forever with no error surfaced.
func shutterTapped() {
    isCapturing = true
    let settings = AVCapturePhotoSettings()
    sessionQueue.async {
        self.photoOutput.capturePhoto(with: settings, delegate: self)
    }
}

func photoOutput(_ output: AVCapturePhotoOutput,
                  didFinishProcessingPhoto photo: AVCapturePhoto,
                  error: Error?) {
    Task { @MainActor in
        isCapturing = false   // never runs if this delegate call never fires
        handle(photo)
    }
}
```

```swift
// CORRECT — uniqueID-keyed, exactly-once watchdog
@MainActor
final class CaptureController {
    private var pendingCaptureID: Int64?
    private var watchdog: Task<Void, Never>?

    func shutterTapped() {
        isCapturing = true
        let settings = AVCapturePhotoSettings()
        let id = settings.uniqueID
        pendingCaptureID = id                 // set SYNCHRONOUSLY, before dispatch
        startWatchdog(for: id)

        let boxed = SendableSettings(settings) // @unchecked Sendable box to cross queues
        sessionQueue.async {
            self.photoOutput.capturePhoto(with: boxed.value, delegate: self)
        }
    }

    private func startWatchdog(for id: Int64, timeout: Duration = .seconds(5)) {
        watchdog = Task { @MainActor in
            try? await Task.sleep(for: timeout)
            resolveCapture(id) { self.handleTimeout() }
        }
    }

    /// Exactly-once: whichever of {delegate callback, watchdog} arrives
    /// first for THIS id wins; the other is a no-op. A stale id (old
    /// capture, already resolved or superseded) is dropped.
    private func resolveCapture(_ id: Int64, _ body: @MainActor () -> Void) {
        guard pendingCaptureID == id else { return }
        pendingCaptureID = nil
        watchdog?.cancel()
        watchdog = nil
        body()
    }

    private func handleTimeout() {
        isCapturing = false
        showError("Capture timed out — please try again.")
    }

    func photoOutput(_ output: AVCapturePhotoOutput,
                      didFinishProcessingPhoto photo: AVCapturePhoto,
                      error: Error?) {
        let id = photo.resolvedSettings.uniqueID
        Task { @MainActor in
            resolveCapture(id) {
                self.isCapturing = false
                self.finishCapture(photo, error: error)
            }
        }
    }
}
```
