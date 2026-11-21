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
nonisolated struct SendableSettings: @unchecked Sendable {
    let value: AVCapturePhotoSettings
    init(_ value: AVCapturePhotoSettings) { self.value = value }
}

// CORRECT — uniqueID-keyed, exactly-once watchdog
@MainActor
final class CaptureController: NSObject, AVCapturePhotoCaptureDelegate {
    // The capture session and output are owned here and touched ONLY on
    // sessionQueue, so they are safe to mark nonisolated(unsafe).
    nonisolated(unsafe) private let session = AVCaptureSession()
    nonisolated(unsafe) private let photoOutput = AVCapturePhotoOutput()
    nonisolated private let sessionQueue = DispatchQueue(label: "capture.session")

    private(set) var isCapturing = false
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

    /// Exactly-once: whichever of {delegate callback, watchdog, endSession}
    /// arrives first for THIS id wins; the others are no-ops. A stale id (old
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

    /// Tear-down: resolve any pending capture through the SAME resolve path
    /// before stopping. Otherwise `pendingCaptureID` stays latched, the
    /// shutter stays disabled, and only the watchdog would ever clear it.
    func endSession() {
        if let id = pendingCaptureID {
            resolveCapture(id) {
                self.isCapturing = false
                self.showError("Capture cancelled.")
            }
        }
        sessionQueue.async { self.session.stopRunning() }
    }

    // `nonisolated`: AVFoundation calls this on its own queue, not the main
    // actor. A main-isolated delegate method called there trips
    // dispatch_assert_queue at runtime. Pull Sendable values out HERE; the
    // non-Sendable AVCapturePhoto never crosses into the Task.
    nonisolated func photoOutput(_ output: AVCapturePhotoOutput,
                                 didFinishProcessingPhoto photo: AVCapturePhoto,
                                 error: Error?) {
        let id = photo.resolvedSettings.uniqueID
        let data = photo.fileDataRepresentation()      // Data? is Sendable
        Task { @MainActor in
            resolveCapture(id) {
                self.isCapturing = false
                self.finishCapture(data, error: error)
            }
        }
    }

    // app-specific: show the error, hand `data` to the save pipeline
    private func showError(_ message: String) { /* … */ }
    private func finishCapture(_ data: Data?, error: Error?) { /* … */ }
}
```

Typechecked with `swiftc -typecheck -swift-version 6 -default-isolation MainActor`
against the iOS 27.2 simulator SDK. Not run on a device: the mid-capture teardown
case (`endSession` while a capture is in flight resolves within the timeout) is
a device check.
