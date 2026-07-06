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

Invariants the implementation must hold:

- **IDs are stable model IDs, never absolute URLs**; thumbnail paths stay
  relative to the App Group container — absolute paths break after
  reinstall/restore because the container path changes per install.
- **Invariant A (writer): never clobber a good snapshot with a
  transient-empty one.** On an iCloud-sync launch the local store is briefly
  empty — if `documents` is empty but a snapshot with entries already exists
  on disk, skip the write and let the post-settle backfill publish real state.
- **Invariant B (writer + reader share one flag): the App-Lock redaction
  decision has exactly one source of truth.** The writer mirrors App-Lock
  state into the shared UserDefaults suite; the reader re-checks that SAME
  flag on every load regardless of what's on disk, so a stale pre-redaction
  snapshot can never render. Neither side invents its own redaction signal —
  that's what causes double-redaction bugs.
- Writes are atomic (`.atomic, .completeFileProtectionUnlessOpen`) so the
  widget process never reads a half-written file.

**Read `references/snapshot-bridge.md` before implementing** — the full
`WidgetBridge` shared DTO, `WidgetSnapshotWriter` (app-side, the only writer),
and `WidgetSnapshotReader` (widget-side, pure reader) implementing the
invariants above.

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
- `swift6-mainactor-compile-fixes` — the shared DTO must decode off-main in the
  widget process; mark the bridge/reader types `nonisolated` honestly instead of
  `@unchecked Sendable` band-aids.
- `swiftdata-inmemory-test-harness` — drive the writer from an in-memory store
  to test the never-clobber and backfill paths.
