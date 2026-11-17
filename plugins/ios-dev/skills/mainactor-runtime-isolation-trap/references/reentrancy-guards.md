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
(a private floor-plan scanner app: `viewDidAppear` fired twice → restarted the capture session, reset
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

## Join the in-flight task (concurrent first calls, double-create, duplicate backfill)

When a second caller arrives while the first is still working, make it **await
the same task** instead of starting its own or silently returning. A run guard
(above) coalesces *fire-and-forget* passes; this is for callers that need the
result, such as a container load that two screens trigger on first launch:

```swift
/// Concurrent callers JOIN the one in-flight task instead of each starting their
/// own (double-create, duplicate backfill, concurrent first container load).
@MainActor
final class SingleFlight<Value: Sendable> {
    private var inFlight: Task<Value, Error>?

    func run(_ work: @escaping @Sendable () async throws -> Value) async throws -> Value {
        if let inFlight { return try await inFlight.value }   // join
        let task = Task { try await work() }                  // unstructured: a
        inFlight = task                                       // joiner's cancel
        defer { inFlight = nil }                              // can't kill it
        return try await task.value
    }
}
```

For owner- and generation-scoped tokens when the shared thing is a resource
someone else may stop, see `shared-resource-per-owner-scoping`; do not copy that
shape here.

## A second `.task` run must not overwrite newer state

SwiftUI re-runs `.task` when the view re-appears or its `id` changes, and the
first run may still be suspended. The older run then resumes last and applies
stale results, or wipes edits made in between (a second run once discarded
unsaved ink). Stamp each run with a generation and apply only the newest, and
never overwrite a dirty model:

```swift
/// A second `.task` run (view re-appeared, id changed) starts while the first is
/// suspended. Without a guard the OLDER run resumes last and overwrites newer
/// state, or wipes edits made in between. Stamp each run; only the newest applies.
@MainActor
final class EditorModel {
    private(set) var strokes: [String] = []
    private(set) var isDirty = false
    private var generation = 0

    func edit(_ stroke: String) { strokes.append(stroke); isDirty = true }

    func reload(_ load: @Sendable () async -> [String]) async {
        generation += 1
        let mine = generation
        let loaded = await load()               // suspension point
        guard mine == generation else { return } // a newer run owns the state
        guard !isDirty else { return }           // never wipe unsaved edits
        strokes = loaded
    }
}
```

Both patterns were run on macOS (Swift 6): five concurrent callers start the
work once and share its result; a slower older reload is dropped in favour of the
newer one; an edit made during a reload survives it.
