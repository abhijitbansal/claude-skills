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
}
```

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
