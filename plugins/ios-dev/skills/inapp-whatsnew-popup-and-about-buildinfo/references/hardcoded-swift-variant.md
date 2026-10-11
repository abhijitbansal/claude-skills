# Alternative data source — hardcoded Swift (Cubby style)

If you chose the Swift-array data source instead of JSON, replace §A1–A2 of
`whatsnew-gate.md` with a compiled array. §A3 and §A6 are unchanged (the gate
compares version strings either way — feed it `Changelog.currentVersion`).
§A4 and §A5 must swap `WhatsNew.bundled` / `WhatsNewEntry` for
`Changelog.currentVersion` / `Changelog.entries` / `ChangelogEntry`, and drop
the fixes section (`ChangelogEntry` has no `fixes`).

```swift
struct ChangelogEntry: Equatable, Identifiable {
    let version: String
    let date: String
    let headline: String
    let highlights: [String]
    var id: String { version }
}

enum Changelog {
    /// Newest-first. Prepend a new entry at each release (guarded by tests).
    static let entries: [ChangelogEntry] = [
        ChangelogEntry(version: "0.3.0", date: "2026-06-01", headline: "…", highlights: ["…"]),
        ChangelogEntry(version: "0.2.0", date: "2026-05-01", headline: "…", highlights: ["…"]),
    ]
    static var currentVersion: String { entries.first?.version ?? "" }
}
```

The data-invariant tests in §A7 of `whatsnew-gate.md` apply directly (assert `Changelog.entries`
non-empty, strictly newest-first, every entry has content). This variant has no
external file to bundle and gets compile-time type-safety, at the cost of a
recompile to edit copy and no easy release-pipeline regeneration.
