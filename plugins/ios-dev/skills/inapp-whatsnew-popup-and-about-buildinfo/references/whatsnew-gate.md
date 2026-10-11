# Pattern A — the launch What's New pop-up (A1–A7)

Full copy-paste implementation for the version-gated sheet. The rules these
snippets implement (seed on fresh install, downgrade never clobbers
`lastSeenVersion`, gate on marketing version only, fail-soft loader) live in
`SKILL.md`; the code below is the shape that satisfies them.

Contents:

- A1. Data contract — `WhatsNew.json`
- A2. Model + nil-safe loader — `WhatsNew.swift`
- A3. Gate decider with numeric version compare
- A4. `.whatsNewGate()` modifier + app-root arming
- A5. The What's New sheet (plus optional "See all features" handoff)
- A6. Gate unit tests
- A7. Data-invariant tests

## A1. Data contract — `WhatsNew.json`

Bundle this as a resource (`Resources/WhatsNew.json`). `entries` is newest-first;
`currentVersion` always equals `entries.first.version`.

```json
{
  "currentVersion": "1.5.0",
  "entries": [
    {
      "version": "1.5.0",
      "buildNumber": 20,
      "releasedAt": "2026-07-12",
      "headline": "Combine, split, and export pages",
      "highlights": [
        "Merge two or more scans into one new PDF, choosing which pages from each source.",
        "Pull selected pages out into a new, independent document without disturbing the original."
      ],
      "fixes": [
        "Fixed a spurious calendar event when scanning a document with no date on it."
      ]
    },
    {
      "version": "1.4.0",
      "buildNumber": 18,
      "releasedAt": "2026-06-07",
      "headline": "iPad support",
      "highlights": ["The app is now a universal app with a two-column iPad layout."],
      "fixes": []
    }
  ]
}
```

## A2. Model + nil-safe loader — `WhatsNew.swift`

A missing or corrupt payload makes the feature simply **absent** — it never
crashes.

```swift
import Foundation

/// One release's user-facing notes. Mirrors a single entry in `WhatsNew.json`.
struct WhatsNewEntry: Codable, Equatable, Hashable, Identifiable {
    let version: String
    let buildNumber: Int
    let releasedAt: String
    let headline: String
    let highlights: [String]
    let fixes: [String]

    var id: String { "\(version)-\(buildNumber)" }
}

/// The full bundled payload. `entries` is newest-first; `currentVersion`
/// always equals `entries.first?.version`.
struct WhatsNew: Codable, Equatable {
    let currentVersion: String
    let entries: [WhatsNewEntry]

    /// Bundled copy of `WhatsNew.json`, cached after first read. Returns nil
    /// (feature treated as absent) on a missing/corrupt file — never crashes.
    static let bundled: WhatsNew? = {
        guard let url = Bundle.main.url(forResource: "WhatsNew", withExtension: "json") else {
            return nil
        }
        return load(from: url)
    }()

    static func load(from url: URL) -> WhatsNew? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(WhatsNew.self, from: data)
    }
}
```

## A3. The gate decider — the load-bearing pure logic

Keep the decision out of the SwiftUI modifier so it is trivially unit-testable
with no `UserDefaults` plumbing. This is the part that matters.

```swift
import Foundation

/// Pure decision logic for the "What's New" sheet.
enum WhatsNewGateDecider {
    enum Decision: Equatable {
        /// Show the sheet for this version, then persist it as last-seen.
        case present(String)
        /// Persist this version as last-seen WITHOUT showing the sheet
        /// (fresh install — the user never performed the "upgrade", so don't nag).
        case seed(String)
        /// Do nothing. Missing payload, same version, or a downgrade.
        case doNothing
    }

    static func decide(bundledCurrentVersion: String?, lastSeenVersion: String?) -> Decision {
        guard let bundled = bundledCurrentVersion else { return .doNothing }
        guard let lastSeen = lastSeenVersion else { return .seed(bundled) }
        if compareVersions(bundled, lastSeen) == .orderedDescending {
            return .present(bundled)
        }
        return .doNothing
    }

    /// Compares semver-ish strings ("0.3.0" > "0.2.1"). Component-wise numeric
    /// compare, falling back to string comparison when either side isn't
    /// fully dotted-numeric.
    private static func compareVersions(_ lhs: String, _ rhs: String) -> ComparisonResult {
        let lhsParts = lhs.split(separator: ".").compactMap { Int($0) }
        let rhsParts = rhs.split(separator: ".").compactMap { Int($0) }
        let isNumeric = lhsParts.count == lhs.split(separator: ".").count
            && rhsParts.count == rhs.split(separator: ".").count
            && !lhsParts.isEmpty && !rhsParts.isEmpty
        guard isNumeric else { return lhs.compare(rhs) }
        for (l, r) in zip(lhsParts, rhsParts) {
            if l < r { return .orderedAscending }
            if l > r { return .orderedDescending }
        }
        if lhsParts.count < rhsParts.count { return .orderedAscending }
        if lhsParts.count > rhsParts.count { return .orderedDescending }
        return .orderedSame
    }
}
```

## A4. The SwiftUI gate modifier

Attach `.whatsNewGate()` **once** at the app root. It reads/writes a single
`@AppStorage` key and presents the sheet on `onAppear`.

```swift
import SwiftUI

struct WhatsNewGateModifier: ViewModifier {
    @AppStorage("lastSeenWhatsNewVersion") private var lastSeenVersion: String = ""
    @State private var presentingVersion: String?
    @State private var didEvaluate = false

    func body(content: Content) -> some View {
        content
            .onAppear {
                guard !didEvaluate else { return }   // evaluate exactly once per launch
                didEvaluate = true
                evaluate()
            }
            .sheet(item: Binding(
                get: { presentingVersion.map(VersionKey.init) },
                set: { presentingVersion = $0?.value }
            )) { key in
                if let entry = WhatsNew.bundled?.entries.first(where: { $0.version == key.value }) {
                    WhatsNewSheet(entry: entry)
                        .onDisappear { lastSeenVersion = key.value }   // mark seen only after they've seen it
                }
            }
    }

    private func evaluate() {
        let bundled = WhatsNew.bundled?.currentVersion
        let lastSeen = lastSeenVersion.isEmpty ? nil : lastSeenVersion
        switch WhatsNewGateDecider.decide(bundledCurrentVersion: bundled, lastSeenVersion: lastSeen) {
        case .present(let version): presentingVersion = version
        case .seed(let version):    lastSeenVersion = version
        case .doNothing:            break
        }
    }

    private struct VersionKey: Identifiable, Hashable {
        let value: String
        var id: String { value }
    }
}

extension View {
    /// Presents the "What's New" sheet once per marketing-version upgrade.
    /// Attach once to the app root; decides from bundled `WhatsNew.json` + UserDefaults.
    func whatsNewGate() -> some View { modifier(WhatsNewGateModifier()) }
}
```

Arm it at the root:

```swift
@main
struct MyApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
                .whatsNewGate()
        }
    }
}
```

## A5. The sheet

Minimal, plain-SwiftUI presentation (style to taste).

```swift
import SwiftUI

struct WhatsNewSheet: View {
    @Environment(\.dismiss) private var dismiss
    let entry: WhatsNewEntry

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("What's new in v\(entry.version)")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        Text(entry.headline)
                            .font(.largeTitle.bold())
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if !entry.highlights.isEmpty { section("New", entry.highlights) }
                    if !entry.fixes.isEmpty { section("Fixed", entry.fixes) }
                }
                .padding(24)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func section(_ title: String, _ items: [String]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title.uppercased())
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Text("•").foregroundStyle(.secondary)
                    Text(item).fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }
}
```

**Optional — "See all features" handoff.** The scanner app's sheet ends with a
`See all features →` button that dismisses and opens an evergreen feature index
(`FeatureCatalog`/`FeaturesView` — a hardcoded Swift list of *all* current
features, distinct from the versioned changelog). To add it, give `WhatsNewSheet`
an `onSeeAllFeatures: () -> Void` callback, call `dismiss(); onSeeAllFeatures()`
from the button, and present your catalog view from a second `.sheet` in the
modifier. That evergreen catalog is out of scope here — it's a separate pattern.

## A6. Gate unit tests

The whole reason the decider is a pure enum: test every branch with no UI.

```swift
import Testing
@testable import MyApp

struct WhatsNewGateTests {
    @Test func freshInstallSeedsWithoutPresenting() {
        #expect(WhatsNewGateDecider.decide(bundledCurrentVersion: "1.5.0", lastSeenVersion: nil)
                == .seed("1.5.0"))
    }
    @Test func realUpgradePresents() {
        #expect(WhatsNewGateDecider.decide(bundledCurrentVersion: "1.5.0", lastSeenVersion: "1.4.0")
                == .present("1.5.0"))
    }
    @Test func sameVersionDoesNothing() {
        #expect(WhatsNewGateDecider.decide(bundledCurrentVersion: "1.5.0", lastSeenVersion: "1.5.0")
                == .doNothing)
    }
    @Test func downgradeDoesNothingAndKeepsLastSeen() {
        // A TestFlight rollback must NOT clobber last-seen, so a later real
        // upgrade past the rolled-back version still fires.
        #expect(WhatsNewGateDecider.decide(bundledCurrentVersion: "1.4.0", lastSeenVersion: "1.5.0")
                == .doNothing)
    }
    @Test func missingPayloadDoesNothing() {
        #expect(WhatsNewGateDecider.decide(bundledCurrentVersion: nil, lastSeenVersion: "1.4.0")
                == .doNothing)
    }
    @Test func comparesNumericallyNotLexicographically() {
        // 0.1.10 > 0.1.2 even though "10" < "2" lexically.
        #expect(WhatsNewGateDecider.decide(bundledCurrentVersion: "0.1.10", lastSeenVersion: "0.1.2")
                == .present("0.1.10"))
    }
}
```

## A7. Data-invariant tests (grafted from Cubby)

Guard the payload itself so a bad edit can't silently ship an empty or
out-of-order changelog.

```swift
import Testing
@testable import MyApp

struct WhatsNewDataTests {
    @Test func bundledPayloadDecodes() {
        #expect(WhatsNew.bundled != nil)
    }
    @Test func entriesAreNonEmpty() throws {
        let wn = try #require(WhatsNew.bundled)
        #expect(!wn.entries.isEmpty)
    }
    @Test func currentVersionIsTheNewestEntry() throws {
        let wn = try #require(WhatsNew.bundled)
        #expect(wn.currentVersion == wn.entries.first?.version)
    }
    @Test func entriesAreStrictlyNewestFirst() throws {
        let wn = try #require(WhatsNew.bundled)
        let v = wn.entries.map(\.version)
        for (a, b) in zip(v, v.dropFirst()) {
            #expect(isDescending(a, b), "\(a) must sort strictly newer than \(b)")
        }
    }
    @Test func everyEntryHasContent() throws {
        let wn = try #require(WhatsNew.bundled)
        for e in wn.entries {
            #expect(!e.version.trimmingCharacters(in: .whitespaces).isEmpty)
            #expect(!e.headline.trimmingCharacters(in: .whitespaces).isEmpty)
            #expect(!e.highlights.isEmpty)
        }
    }

    /// Numeric, not lexicographic: 0.1.10 is newer than 0.1.2.
    private func isDescending(_ lhs: String, _ rhs: String) -> Bool {
        let l = lhs.split(separator: ".").compactMap { Int($0) }
        let r = rhs.split(separator: ".").compactMap { Int($0) }
        for (a, b) in zip(l, r) where a != b { return a > b }
        return l.count > r.count
    }
}
```
