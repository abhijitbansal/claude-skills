# Widget↔App snapshot bridge: shared DTO, atomic writer, pure reader

```swift
// Shared/WidgetBridge.swift — compiled into BOTH app and widget targets
struct WidgetSnapshot: Codable, Equatable {
    struct Entry: Codable, Equatable {
        let id: String                       // stable model id — NEVER an absolute URL
        let title: String
        let thumbnailRelativePath: String?   // relative to the App Group container
        let updatedAt: Date
    }
    let entries: [Entry]
    let generatedAt: Date
}

enum WidgetBridge {
    static let appGroupID = "group.com.example.myapp"
    static let snapshotFilename = "widget-snapshot-v1.json"
    static let appLockKey = "appLockEnabled"

    // Optional on purpose: Personal-Team provisioning has no App Group → nil.
    static var containerURL: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupID)
    }
    static var snapshotURL: URL? { containerURL?.appendingPathComponent(snapshotFilename) }
}
```

```swift
// App target — the ONLY writer
enum WidgetSnapshotWriter {
    static func publish(documents: [Document], isAppLocked: Bool) {
        guard let url = WidgetBridge.snapshotURL else { return }  // no entitlement → no-op

        // INVARIANT A: never clobber a good snapshot with a transient-empty one.
        // On an iCloud-sync launch the local store is briefly empty — skip and
        // let the post-settle backfill publish real state.
        if documents.isEmpty, snapshotHasEntries(at: url) { return }

        let snapshot = WidgetSnapshot(
            entries: documents.prefix(4).map {
                .init(id: $0.stableID, title: $0.title,
                      thumbnailRelativePath: $0.thumbnailRelativePath,
                      updatedAt: $0.updatedAt)
            },
            generatedAt: .now)
        do {
            let data = try JSONEncoder().encode(snapshot)
            try data.write(to: url, options: [.atomic, .completeFileProtectionUnlessOpen])
            // INVARIANT B, write half: mirror the App-Lock flag into the shared
            // suite — the ONE source of truth for the redaction decision.
            UserDefaults(suiteName: WidgetBridge.appGroupID)?
                .set(isAppLocked, forKey: WidgetBridge.appLockKey)
            WidgetCenter.shared.reloadAllTimelines()
        } catch {
            Logger.widgetBridge.error("snapshot write failed: \(error.localizedDescription)")
        }
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
enum WidgetSnapshotReader {
    static func load() -> WidgetSnapshot? {
        guard let url = WidgetBridge.snapshotURL,
              let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(WidgetSnapshot.self, from: data)
    }

    // INVARIANT B, read half: re-check the flag regardless of what's on disk —
    // a stale pre-redaction snapshot must never render. Both halves consult the
    // SAME flag; neither side invents its own redaction signal (no double-redaction).
    static var isRedacted: Bool {
        UserDefaults(suiteName: WidgetBridge.appGroupID)?
            .bool(forKey: WidgetBridge.appLockKey) ?? false
    }
}
```
