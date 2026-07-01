---
name: file-handoff-inbox-backstop
description: App boot-loops after receiving a share — every cold launch is jetsam-killed mid-import (a 24MP EXIF-rotated image decodes to a ~880MB bitmap), and widget-timeline launches keep re-triggering the same crash; or shared items import twice / silently vanish because the host drained a half-written batch. Use when a share/action extension hands files to its host app through an App Group inbox — the drain needs a manifest ready-marker, a per-batch attempt cap persisted BEFORE heavy work, quarantine for poison batches, a launch re-entrancy guard, and an injectable inbox root for tests/CI.
---

# Share-Extension Inbox: Backstop the Drain Against Poison Batches

## Symptom

- App crashes on launch, **every** launch, after a user shares a large item.
  doc-scan's case: a 24MP EXIF-rotated shared image decoded to a ~880MB bitmap
  → jetsam during the inbox drain → drain died before clearing the batch →
  cold-launch boot-loop. Widget timeline launches re-triggered it too.
- Shared items imported twice (drain ran concurrently) or never appeared
  (host drained a batch the extension was still writing).

## Root cause

The naive inbox — extension writes files into the App Group container, host
imports-then-deletes on launch — has no failure story. A crash *during* import
leaves the batch in place, so the very work that crashed runs again on the next
launch, unconditionally. And launch has multiple triggers (`onAppear`,
`scenePhase .active`, widget timeline reloads), so drains overlap.

## Fix

**Layout** — batch dir per share; `manifest.json` written LAST is the ready marker:

```
<AppGroup>/ShareInbox/<batchID>/item-0.jpg … manifest.json
<AppGroup>/ShareInboxFailed/          # quarantined poison batches
```

**Extension write side** — a batch without a manifest is invisible to the drain:

```swift
struct InboxManifest: Codable {
    let batchID: String
    let files: [String]      // relative paths inside the batch dir — never absolute URLs
    let createdAt: Date
}

func writeBatch(_ payloads: [(name: String, data: Data)], into inboxRoot: URL) throws {
    let batchDir = inboxRoot.appendingPathComponent(UUID().uuidString, isDirectory: true)
    try FileManager.default.createDirectory(at: batchDir, withIntermediateDirectories: true)
    for p in payloads {
        try p.data.write(to: batchDir.appendingPathComponent(p.name), options: .atomic)
    }
    let manifest = InboxManifest(batchID: batchDir.lastPathComponent,
                                 files: payloads.map(\.name), createdAt: .now)
    try JSONEncoder().encode(manifest)
        .write(to: batchDir.appendingPathComponent("manifest.json"), options: .atomic)
}
```

**Host drain side** — attempt cap + quarantine + re-entrancy guard:

```swift
@MainActor
final class ShareInboxDrainer {
    static let maxDrainAttempts = 3
    private let inbox: ShareInbox          // injectable root — see below
    private let defaults: UserDefaults     // shared App Group suite
    private var isDraining = false

    // onAppear AND scenePhase .active both fire on cold launch — guard, don't dedupe callers.
    func drainIfNeeded() async {
        guard !isDraining else { return }
        isDraining = true
        defer { isDraining = false }

        for batch in inbox.readyBatches() {              // dirs containing manifest.json
            let attempts = bumpAttemptCount(for: batch)  // persisted BEFORE heavy work:
            guard attempts <= Self.maxDrainAttempts else {  // a crash still burns an attempt
                try? inbox.quarantine(batch)             // move to ShareInboxFailed/ — never delete user data
                clearAttemptCount(for: batch)
                continue
            }
            do {
                try await importBatch(batch)             // heavy decode work off-main inside
                try FileManager.default.removeItem(at: batch)
                clearAttemptCount(for: batch)
            } catch { /* leave batch in place; the burned attempt is the backstop */ }
        }
    }

    private func bumpAttemptCount(for batch: URL) -> Int {
        let key = "inbox.attempts.\(batch.lastPathComponent)"
        let n = defaults.integer(forKey: key) + 1
        defaults.set(n, forKey: key)
        return n
    }
}
```

**Image normalization** — the actual jetsam trigger. `UIGraphicsImageRenderer`
defaults to device scale, so a 24MP image renders at 3× pixels:

```swift
let format = UIGraphicsImageRendererFormat()
format.scale = 1   // NOT device scale — 24MP @3x ≈ 880 MB bitmap → jetsam
let out = UIGraphicsImageRenderer(size: targetSize, format: format).image { _ in
    image.draw(in: CGRect(origin: .zero, size: targetSize))  // also bakes in EXIF rotation
}
```

**Injectable root** — the drain and the extension take the inbox root as a
value, so tests/CI run against a temp dir with no App Group entitlement:

```swift
struct ShareInbox {
    let root: URL   // <root>/ShareInbox, <root>/ShareInboxFailed derived from this

    static func appGroup(id: String) -> ShareInbox? {
        // nil == missing App Group entitlement on THIS target — it fails silently, check per target
        guard let c = FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: id) else { return nil }
        return ShareInbox(root: c)
    }
}
// Tests: ShareInbox(root: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString))
```

## Invariants

1. Manifest written last; no manifest ⇒ batch does not exist to the drain.
2. Attempt counter hits disk **before** decode work — a crash burns an attempt.
3. After `maxDrainAttempts` (3): quarantine to `ShareInboxFailed/`, never delete.
4. One drain at a time; every launch path (view appear, scene activation,
   widget-triggered launch) funnels through the same guarded entry point.
5. Renderer `scale = 1` when normalizing shared images.
6. Inbox root is injected, never read from the entitlement inside the logic.

## Evidence

- doc-scan (Paperix, 5 targets incl. share extension + `ShareExtensionInbox`
  helper): `stop launch boot-loop on large rotated shared images`,
  `cap drain attempts and quarantine poison batches`.

## Related skills

- `widget-appgroup-snapshot-bridge` — the read-only sibling over the same App
  Group; its timeline reloads are one of the launch paths that re-trigger drains.
- `deep-link-resolver-applock-pathtraversal` — hardening the other cold-launch
  entry point (URLs) with the same one-guarded-funnel discipline.
- `mainactor-launch-watchdog-audit` — the general launch rule this instantiates:
  record progress before the loop body, and keep heavy launch work off-main.
- `swiftdata-inmemory-test-harness` — same injectable-root discipline applied to
  the persistence layer.
- `swift6-mainactor-migration` — if moving `importBatch` decode work off-main
  trips "main actor-isolated X" errors.
