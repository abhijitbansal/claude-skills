# Recovery store, elapsed clock, and async-signal-safe crash marker

**`ScanRecoveryStore`** — atomic writes, tolerate unreadable/partial files, clear on decode-mismatch:

```swift
nonisolated enum ScanRecoveryStore {
    private static var fileURL: URL {
        URL.applicationSupportDirectory.appending(path: "recovery/capturedRoom.json")
    }

    static func save(_ room: CapturedRoom) throws {
        try FileManager.default.createDirectory(
            at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        let data = try JSONEncoder().encode(room)
        try data.write(to: fileURL, options: .atomic)      // never a partial file
    }

    static func load() -> CapturedRoom? {
        guard let data = try? Data(contentsOf: fileURL) else { return nil }
        guard let room = try? JSONDecoder().decode(CapturedRoom.self, from: data) else {
            clear()   // stale schema (e.g. CapturedStructure) → delete, don't re-crash
            return nil
        }
        return room
    }

    static func clear() { try? FileManager.default.removeItem(at: fileURL) }

    // --- attempt cap (see RecoveryGate below) ---
    private static var counterURL: URL {
        URL.applicationSupportDirectory.appending(path: "recovery/attempts.txt")
    }

    /// Call at launch INSTEAD of `load()` whenever you would rebuild automatically.
    static func loadForProcessing() -> (room: CapturedRoom?, quarantined: URL?) {
        switch RecoveryGate.claim(file: fileURL, counter: counterURL) {
        case .nothingToRecover: return (nil, nil)
        case .quarantined(let url): return (nil, url)   // offer export
        case .process: return (load(), nil)
        }
    }

    /// After the final commit (step ④): clear the file AND the counter.
    static func clearAfterCommit() {
        clear()
        RecoveryGate.reset(counter: counterURL)
    }
}
```

**`timeBox`** — a time-box that works on a worker that ignores cancellation.
`withThrowingTaskGroup` cannot do this: the group awaits every child before
returning. This races an unstructured `Task` through a resume-once continuation
(NSLock-guarded, resumed outside the lock) and abandons the worker; the worker
keeps running until it finishes, so it must also check `Task.isCancelled` at its
own checkpoints:

```swift
nonisolated struct ScanProcessingTimeout: Error {}

/// Resumes the caller exactly once: whichever of {worker finished, timer fired}
/// arrives first wins; the other is a no-op.
private nonisolated final class ResumeOnce<T: Sendable>: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<T, Error>?
    init(_ continuation: CheckedContinuation<T, Error>) { self.continuation = continuation }

    func resume(with result: Result<T, Error>) {
        lock.lock(); let c = continuation; continuation = nil; lock.unlock()
        c?.resume(with: result)      // resume OUTSIDE the lock
    }
}

nonisolated func timeBox<T: Sendable>(
    _ limit: Duration,
    work: @escaping @Sendable () async throws -> T
) async throws -> T {
    try await withCheckedThrowingContinuation { continuation in
        let once = ResumeOnce<T>(continuation)
        let worker = Task {
            do { once.resume(with: .success(try await work())) }
            catch { once.resume(with: .failure(error)) }
        }
        Task {
            try? await Task.sleep(for: limit)
            once.resume(with: .failure(ScanProcessingTimeout()))
            worker.cancel()          // cooperative: a no-op unless `work` checks cancellation
        }
    }
}
```

**`RecoveryGate`** — persist the attempt counter *before* reprocessing; after N
failures move the file aside and offer export, never delete. Same design as
`file-handoff-inbox-backstop`:

```swift
/// Persist an attempt counter BEFORE reprocessing a recovery file. A file that
/// decodes but crashes the rebuild is otherwise retried on every launch, forever.
/// After `limit` attempts the file is moved aside (never deleted) so the user
/// can export it.
nonisolated enum RecoveryGate {
    enum Claim: Equatable {
        case nothingToRecover
        case process
        case quarantined(URL)
    }

    static func claim(file: URL, counter: URL, limit: Int = 2) -> Claim {
        let fm = FileManager.default
        guard fm.fileExists(atPath: file.path) else { return .nothingToRecover }

        let attempts = (Int((try? String(contentsOf: counter, encoding: .utf8)) ?? "") ?? 0) + 1
        // Written BEFORE the heavy step, atomically: it survives a SIGKILL.
        try? String(attempts).write(to: counter, atomically: true, encoding: .utf8)
        if attempts <= limit { return .process }

        let aside = file.deletingPathExtension()
            .appendingPathExtension("quarantined-\(Int(Date().timeIntervalSince1970)).json")
        do {
            try fm.moveItem(at: file, to: aside)
            try? fm.removeItem(at: counter)
            return .quarantined(aside)    // offer export; never auto-delete
        } catch {
            return .nothingToRecover      // cannot move it: do not loop on it either
        }
    }

    static func reset(counter: URL) { try? FileManager.default.removeItem(at: counter) }
}
```

Verified on macOS (compiled `RecoveryGate` and `timeBox`, drove them with a test
main): a worker that blocks a thread for 2 s and ignores cancellation times out
in 0.21 s through `timeBox` but held the old task-group version for 2.0 s; a
poisoned recovery file is processed on launches 1 and 2, quarantined on launch 3
with the file kept, and launch 4 has nothing to recover. `ScanRecoveryStore`
(needs RoomPlan) is typechecked on the iOS simulator SDK only.

**`ScanClock`** — freezes across interruptions by accumulating active time
instead of computing `Date().timeIntervalSince(startedAt)` at render time.
Call `pause()` on session interruption / when `scenePhase` leaves `.active`,
and `resume()` when it returns:

```swift
struct ScanClock {
    private(set) var accumulated: TimeInterval = 0
    private(set) var resumedAt: Date?

    mutating func pause() {          // session interruption / scenePhase != .active
        if let resumedAt { accumulated += Date().timeIntervalSince(resumedAt) }
        resumedAt = nil
    }
    mutating func resume() { resumedAt = Date() }
    var elapsed: TimeInterval {
        accumulated + (resumedAt.map { Date().timeIntervalSince($0) } ?? 0)
    }
}
```

**`CrashSentinel`** — async-signal-safe crash marker, armed before
`ModelContainer` init. The path below is a placeholder; resolve it under the
real Application Support directory, not literally `/tmp`:

```swift
nonisolated enum CrashSentinel {
    static let path = "/tmp-replaced-at-runtime/crash.marker"  // resolve under App Support

    static func arm()    { let fd = open(path, O_CREAT | O_WRONLY, 0o644); if fd >= 0 { close(fd) } }
    static func disarm() { unlink(path) }
    static var crashedLastLaunch: Bool { access(path, F_OK) == 0 }
}

// App start:
let crashed = CrashSentinel.crashedLastLaunch
CrashSentinel.arm()
let container = try makeModelContainer(safeMode: crashed)   // hang/crash window
CrashSentinel.disarm()
```
