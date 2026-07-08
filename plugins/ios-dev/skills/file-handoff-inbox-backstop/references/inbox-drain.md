# Share-inbox write side, host drain loop, and injectable root

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
