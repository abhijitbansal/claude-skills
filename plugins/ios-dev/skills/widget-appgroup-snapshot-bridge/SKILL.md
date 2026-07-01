---
name: widget-appgroup-snapshot-bridge
description: Home-screen widget goes blank or stale — recents blanked after an iCloud-sync launch ("No recent documents" while the app has plenty), pre-lock titles/thumbnails still visible on the widget while App-Lock is engaged, thumbnails broken after reinstall or device restore, or the widget silently shows nothing because containerURL(forSecurityApplicationGroupIdentifier:) returned nil. Use when building or debugging a WidgetKit extension that shares state with its host app via an App Group (snapshot file, reloadAllTimelines, shared UserDefaults suite).
---

# Widget ↔ App Bridge: One Codable Snapshot Over the App Group

## Symptom

- Widget shows "No recent documents" after a launch even though the app has
  documents — classically the first launch after iCloud sync, when the local
  store is transiently empty and the app overwrites the snapshot with nothing.
- Widget still renders pre-lock content (titles, thumbnails) while App-Lock is
  engaged — a stale pre-redaction snapshot on disk.
- Thumbnails break after reinstall/restore — absolute file URLs were baked into
  the snapshot and the container path changed.
- Widget silently empty on one target: missing App Group entitlement makes
  `containerURL(forSecurityApplicationGroupIdentifier:)` return `nil` with no
  error (surfaces only at altool validate).

## Root cause

A widget runs in a **separate process**. Its only channels to the app are the
shared App Group container and `WidgetCenter.shared.reloadAllTimelines()`.
Naive bridges fail in four repeatable ways: writing the snapshot on every model
change (so a transient-empty launch pass clobbers last-known-good); baking
absolute URLs (container paths differ per process/install); non-atomic writes
(widget reads a half-written file); and redaction decided ad hoc in two places
(so a stale pre-redaction snapshot leaks). Every app re-derives this
architecture — this skill is the canonical shape.

## Fix

One `Codable` DTO compiled into **both** targets; app-side atomic writer;
widget-side pure reader; relative paths only; backfill on launch.

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

Completing the shape:

- **Backfill on launch**: after the store settles (post iCloud first-sync),
  call `publish` once — heals missing, stale, or version-bumped snapshots:
  `await store.awaitInitialLoad(); WidgetSnapshotWriter.publish(...)`.
- **Resolve relative paths at read time**:
  `WidgetBridge.containerURL?.appendingPathComponent(entry.thumbnailRelativePath)`.
- **Version the filename** (`-v1`) so a DTO change reads as "no snapshot" (then
  backfill heals it) instead of a decode crash in the widget process.
- **Entitlement parity**: every target that compiles `WidgetBridge` must carry
  the App Group entitlement, and targets that don't reference it must not —
  assert this in release pre-flight; the failure mode is silent `nil`.

## Evidence

- **doc-scan (Paperix)** — `WidgetBridge` / `WidgetSnapshotReader` commit
  series, incl. `stop iCloud-sync launch from blanking widget recents`
  (invariant A) and the App-Lock redaction mirroring fixes (invariant B).
- **folix** — independently re-derived the same App-Group snapshot
  architecture, motivating this canonical skill.

## Related skills

- `file-handoff-inbox-backstop` — widget timeline launches re-trigger app cold
  starts; a poison share-inbox batch turns that into a boot loop.
- `deep-link-resolver-applock-pathtraversal` — widget entry taps deep-link into
  the app; route them through the single resolver (dropped, not deferred, while
  locked).
- `nonisolated-struct-codable-mainactor` — the shared DTO must decode off-main
  in the widget process under default-MainActor isolation.
- `swift6-mainactor-migration` — marking the bridge/reader types `nonisolated`
  honestly instead of `@unchecked Sendable` band-aids.
- `swiftdata-inmemory-test-harness` — drive the writer from an in-memory store
  to test the never-clobber and backfill paths.
