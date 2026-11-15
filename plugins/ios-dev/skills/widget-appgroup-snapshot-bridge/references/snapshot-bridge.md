# Widget↔App snapshot bridge: shared DTO, atomic writer, pure reader

Typechecked with `swiftc -typecheck -swift-version 6 -default-isolation MainActor`
against the iOS simulator SDK, and the tests at the bottom run green on macOS
under the same isolation. `Document` and `Logger.widgetBridge` are the host
app's own types.

```swift
// Shared/WidgetBridge.swift — compiled into BOTH app and widget targets
nonisolated struct WidgetSnapshot: Codable, Equatable, Sendable {
    struct Entry: Codable, Equatable, Sendable {
        let id: String                       // stable model id — NEVER an absolute URL
        let title: String
        let thumbnailRelativePath: String?   // relative to the App Group container
        let updatedAt: Date
    }
    let entries: [Entry]
    let generatedAt: Date
}

nonisolated enum WidgetBridge {
    static let appGroupID = "group.com.example.myapp"
    static let snapshotFilename = "widget-snapshot-v1.json"
    static let thumbnailsDirectory = "widget-thumbs"
    static let appLockKey = "appLockEnabled"

    // Optional on purpose: Personal-Team provisioning has no App Group → nil.
    static var containerURL: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupID)
    }
    static var snapshotURL: URL? { containerURL?.appendingPathComponent(snapshotFilename) }
    static var sharedDefaults: UserDefaults? { UserDefaults(suiteName: appGroupID) }
}
```

```swift
// App target — the ONLY writer
nonisolated enum WidgetSnapshotWriter {
    // One serial queue: a redacted (locked) write can never be overtaken by an
    // older unlocked write that is still in flight.
    private static let writeQueue = DispatchQueue(label: "widget-snapshot-writer")

    /// `isAppLocked` must come from the persisted App-Lock state, loaded at
    /// bootstrap — never from a default. Call `publish` only after that load:
    /// a cold-launch snapshot scheduled ahead of the lock bootstrap leaks titles.
    /// `storeSettled` is true once the store has finished its first load (post
    /// iCloud first-sync); an empty `documents` is then real, not transient.
    @MainActor
    static func publish(
        documents: [Document],
        isAppLocked: Bool,
        storeSettled: Bool,
        url: URL? = WidgetBridge.snapshotURL,
        defaults: UserDefaults? = WidgetBridge.sharedDefaults
    ) {
        // INVARIANT B, write half — FIRST and unconditionally, before any early
        // return, so the widget redacts even when no content write happens. The
        // flag is the ONE source of truth for the redaction decision.
        defaults?.set(isAppLocked, forKey: WidgetBridge.appLockKey)
        guard let url else { return }  // no entitlement → no-op

        // No thumbnails while locked: drop the paths here, delete the files below.
        let entries = documents.prefix(4).map {
            WidgetSnapshot.Entry(
                id: $0.stableID, title: $0.title,
                thumbnailRelativePath: isAppLocked ? nil : $0.thumbnailRelativePath,
                updatedAt: $0.updatedAt)
        }
        // Build the Sendable DTO on the caller's side; only values cross to the queue.
        writeQueue.async {
            write(entries: entries, isAppLocked: isAppLocked,
                  storeSettled: storeSettled, to: url)
        }
    }

    /// Test hook: returns once every queued write has finished.
    static func flush() { writeQueue.sync {} }

    private static func write(
        entries: [WidgetSnapshot.Entry], isAppLocked: Bool,
        storeSettled: Bool, to url: URL
    ) {
        // Reload even on a skipped write: the flag may have changed.
        defer { WidgetCenter.shared.reloadAllTimelines() }

        // Locked: delete the thumbnail files BEFORE Invariant A's early return,
        // so a locked + transient-empty publish still removes them.
        if isAppLocked { removeThumbnails(beside: url) }

        // INVARIANT A: never clobber a good snapshot with a TRANSIENT-empty one.
        // Before the store settles (iCloud-sync launch) empty is not real — skip
        // and let the post-settle backfill publish. After it settles, empty IS
        // real (user deleted everything): fall through and write the empty
        // snapshot, or the widget shows deleted titles forever.
        if entries.isEmpty, !storeSettled, snapshotHasEntries(at: url) {
            // The kept snapshot's entries still carry thumbnail paths whose files
            // are now gone; strip the paths when locked (titles stay, per A).
            if isAppLocked { stripThumbnailPaths(at: url) }
            return
        }

        let snapshot = WidgetSnapshot(entries: entries, generatedAt: .now)
        do {
            let data = try JSONEncoder().encode(snapshot)
            // UntilFirstUserAuthentication, not UnlessOpen: a Lock Screen/StandBy
            // widget can't open the file while the device is locked (blank widget).
            // Trade-off: readable after first unlock until reboot. Titles are real
            // on disk; redaction happens at render time (invariant B).
            try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        } catch {
            Logger.widgetBridge.error("snapshot write failed: \(error.localizedDescription)")
        }
    }

    private static func removeThumbnails(beside url: URL) {
        let dir = url.deletingLastPathComponent()
            .appendingPathComponent(WidgetBridge.thumbnailsDirectory)
        guard FileManager.default.fileExists(atPath: dir.path) else { return }
        do { try FileManager.default.removeItem(at: dir) } catch {
            Logger.widgetBridge.error("thumbnail cleanup failed: \(error.localizedDescription)")
        }
    }

    /// Rewrite the kept snapshot with every `thumbnailRelativePath` set to nil.
    private static func stripThumbnailPaths(at url: URL) {
        guard let data = try? Data(contentsOf: url),
              let existing = try? JSONDecoder().decode(WidgetSnapshot.self, from: data)
        else { return }
        let stripped = WidgetSnapshot(
            entries: existing.entries.map {
                WidgetSnapshot.Entry(id: $0.id, title: $0.title,
                                     thumbnailRelativePath: nil, updatedAt: $0.updatedAt)
            },
            generatedAt: existing.generatedAt)
        guard let out = try? JSONEncoder().encode(stripped) else { return }
        try? out.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    private static func snapshotHasEntries(at url: URL) -> Bool {
        guard let data = try? Data(contentsOf: url),
              let existing = try? JSONDecoder().decode(WidgetSnapshot.self, from: data)
        else { return false }
        return !existing.entries.isEmpty
    }
}
```

```swift
// Widget target — pure read, never writes
nonisolated enum WidgetSnapshotReader {
    static func load() -> WidgetSnapshot? {
        guard let url = WidgetBridge.snapshotURL,
              let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(WidgetSnapshot.self, from: data)
    }

    // INVARIANT B, read half: re-check the flag regardless of what's on disk —
    // a stale pre-redaction snapshot must never render. Both halves consult the
    // SAME flag; neither side invents its own redaction signal (no double-redaction).
    static var isRedacted: Bool {
        WidgetBridge.sharedDefaults?.bool(forKey: WidgetBridge.appLockKey) ?? false
    }
}
```

## Tests to carry into the app

The `url:` and `defaults:` parameters default to the App Group values; tests
pass a temp file and a throwaway suite, so no entitlement is needed. Swift
Testing, `@MainActor` suite.

```swift
@Test func deleteAllWritesEmptySnapshotOnceStoreSettled() throws {
    let box = try makeSandbox()   // temp dir + UUID-named UserDefaults suite
    WidgetSnapshotWriter.publish(documents: [doc("a")], isAppLocked: false,
                                 storeSettled: true, url: box.url, defaults: box.defaults)
    WidgetSnapshotWriter.publish(documents: [], isAppLocked: false,
                                 storeSettled: true, url: box.url, defaults: box.defaults)
    WidgetSnapshotWriter.flush()
    #expect(try readSnapshot(box.url).entries.isEmpty)
}

@Test func lockFlagIsMirroredEvenWhenContentWriteIsSkipped() throws {
    let box = try makeSandbox()
    WidgetSnapshotWriter.publish(documents: [doc("a")], isAppLocked: false,
                                 storeSettled: true, url: box.url, defaults: box.defaults)
    WidgetSnapshotWriter.flush()
    // Locked + transient-empty: content write skipped, flag is not.
    WidgetSnapshotWriter.publish(documents: [], isAppLocked: true,
                                 storeSettled: false, url: box.url, defaults: box.defaults)
    // Read BEFORE the queue drains: the flag precedes any content write.
    #expect(box.defaults.bool(forKey: WidgetBridge.appLockKey) == true)
    WidgetSnapshotWriter.flush()
    let kept = try readSnapshot(box.url)
    #expect(kept.entries.count == 1)
    // The locked skip still removes thumbnails and strips their paths.
    #expect(kept.entries.allSatisfy { $0.thumbnailRelativePath == nil })
}
```

Also cover: transient-empty before settle keeps the good snapshot; a locked
write strips `thumbnailRelativePath` and deletes the thumbnails directory;
unlock-then-lock in quick succession ends redacted.

## Thumbnail contract

- Widget thumbnails MUST live under `WidgetBridge.thumbnailsDirectory`
  (`widget-thumbs/`) in the App Group container, and every
  `thumbnailRelativePath` must be rooted there (e.g. `widget-thumbs/<id>.jpg`).
  A thumbnail stored anywhere else is not removed by the locked write.
- The app's thumbnail generator is the only writer into that folder. The writer
  here never creates thumbnails, so after unlock the app must regenerate them
  and republish; until then unlocked entries point at missing files and the
  widget must render a placeholder when the file is absent.
