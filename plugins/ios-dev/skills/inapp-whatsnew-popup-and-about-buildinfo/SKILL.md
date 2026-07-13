---
name: inapp-whatsnew-popup-and-about-buildinfo
description: You're building or standardizing an iOS app's in-app "What's New" launch pop-up — the sheet that auto-appears once after a version upgrade listing new features and fixes — and/or the Settings/About "Build" screen showing version, build number, git commit, branch and build date. Use when adding a launch changelog gate, deciding whether What's-New content lives in an external JSON vs a hardcoded Swift array, wiring a build-time git-commit constant for in-app display, or when a new app repo needs the same What's-New + build-info feature that otherwise means "go look at Paperix". Covers the in-app SwiftUI implementation only — for release-time whatsnew_file / App Store Connect notes gating see release-inapp-vs-asc-whatsnew-surfaces.
---

# In-App What's New Pop-up + About Build-Info

Two small, reusable in-app features that every app rebuilds from scratch:

1. **What's New launch pop-up** — a sheet that auto-appears **once** after the
   user updates to a new marketing version, listing new features and fixes.
2. **Settings/About "Build" screen** — shows marketing version, build number,
   git commit, branch, and build date for support / bug-report correlation.

This skill is the paste-ready pattern for both, lifted from a known-good
implementation (Paperix) with a battle-tested data-invariant test suite (Cubby)
grafted on. Build both from this page alone — no need to read another app.

## When to use

- Adding a launch "What's New" sheet to a new or existing app.
- Deciding **where** What's-New content lives (external JSON vs hardcoded Swift).
- Showing version / build / git-commit inside the running app (About screen).
- Baking the git commit into the binary at build time.
- A new app repo needs "the Paperix What's New + build-info feature."

## Two surfaces, one skill

- **Pattern A — the launch pop-up.** Version-gated sheet, shown once per upgrade.
- **Pattern B — the About build-info screen.** Always-available, no gating.

> This skill is the **in-app SwiftUI implementation** only. The separate
> question of keeping the in-app changelog in sync with the **App Store Connect
> "What's New" metadata** (a manual paste, independent of the binary) and gating
> a release on both is owned by
> [`release-inapp-vs-asc-whatsnew-surfaces`](../release-inapp-vs-asc-whatsnew-surfaces/SKILL.md)
> and the `ios-dev:release` preflight. They are two independent surfaces — don't
> conflate them.

## Decision: where does the What's-New content live?

| Data source | Pick when |
|---|---|
| **External bundled `WhatsNew.json`** (worked example below) | You want a release pipeline to regenerate/prepend entries from git; a longer or frequently-edited changelog; content editable without recompiling. |
| **Hardcoded Swift `[ChangelogEntry]`** | Minimal, often settings-only; you want compile-time type-safety and invariant tests baked into the target; a short changelog. |

The gate logic, sheet, and build-info screen are identical either way — only the
data-loading step differs. The worked example uses JSON; a Swift-array sketch is
at the end.

---

## Pattern A — the launch What's New pop-up

### A1. Data contract — `WhatsNew.json`

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
      "highlights": ["Paperix is now a universal app with a two-column iPad layout."],
      "fixes": []
    }
  ]
}
```

### A2. Model + nil-safe loader — `WhatsNew.swift`

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

### A3. The gate decider — the load-bearing pure logic

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

### A4. The SwiftUI gate modifier

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

### A5. The sheet

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

**Optional — "See all features" handoff.** Paperix's sheet ends with a
`See all features →` button that dismisses and opens an evergreen feature index
(`FeatureCatalog`/`FeaturesView` — a hardcoded Swift list of *all* current
features, distinct from the versioned changelog). To add it, give `WhatsNewSheet`
an `onSeeAllFeatures: () -> Void` callback, call `dismiss(); onSeeAllFeatures()`
from the button, and present your catalog view from a second `.sheet` in the
modifier. That evergreen catalog is out of scope here — it's a separate pattern.

### A6. Gate unit tests

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

### A7. Data-invariant tests (grafted from Cubby)

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

---

## Pattern B — the Settings/About build-info screen

Show `Version`, `Build`, git `Commit`/`Branch`, and build date. Version + build
come from the `Info.plist` at runtime; the git fields must be **injected at build
time** because the running binary has no repo.

### B1. Generate the git constants at build time

`scripts/generate-build-info.sh` — idempotent, atomic write, gracefully degrades
outside a git repo. Wire it as an Xcode **Run Script build phase** (or call it
from your `build.sh` before the build). Adjust `OUT` to your source dir.

```bash
#!/usr/bin/env bash
# Writes <App>/Generated/BuildInfo.swift with git + build metadata.
# Idempotent — safe to re-run on every build. The output is gitignored.
set -euo pipefail
cd "$(dirname "$0")/.."

OUT="MyApp/Generated/BuildInfo.swift"       # <-- adjust to your source dir
mkdir -p "$(dirname "$OUT")"

if git rev-parse --git-dir >/dev/null 2>&1; then
  COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo unknown)
  BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)
  if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
    COMMIT="${COMMIT}-dirty"
  fi
else
  COMMIT="unknown"; BRANCH="unknown"
fi
BUILD_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

TMP=$(mktemp)
cat > "$TMP" <<EOF
// AUTO-GENERATED by scripts/generate-build-info.sh — do NOT edit, do NOT commit.
// Regenerated on every build.

import Foundation

enum BuildInfo {
    static let gitCommit = "$COMMIT"
    static let gitBranch = "$BRANCH"
    static let buildDate = "$BUILD_DATE"
}
EOF
mv "$TMP" "$OUT"
echo "wrote $OUT (commit=$COMMIT, branch=$BRANCH)"
```

**Gitignore the output** (`<App>/Generated/BuildInfo.swift`) — it changes every
build (the timestamp alone makes it non-deterministic), so committing it produces
endless spurious diffs. Ship a committed placeholder only if your project can't
tolerate a missing file on a clean checkout before the first build.

### B2. The About "Build" section

`BuildInfo` is the generated enum above; version/build read the `Info.plist`.

```swift
import SwiftUI
import UIKit

struct BuildInfoSection: View {
    private var appVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "—"
    }
    private var buildNumber: String {
        Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "—"
    }

    var body: some View {
        Section("Build") {
            LabeledContent("Version", value: appVersion)
            LabeledContent("Build", value: buildNumber)
            LabeledContent("Commit", value: BuildInfo.gitCommit)
            LabeledContent("Branch", value: BuildInfo.gitBranch)
            LabeledContent("Built", value: BuildInfo.buildDate)
            LabeledContent("iOS", value: UIDevice.current.systemVersion)
            LabeledContent("Locale", value: Locale.current.identifier)
        }
    }
}
```

Drop `BuildInfoSection()` into your Settings/About `Form`/`List`. The commit hash
shown here lets a bug report be tied to an exact build.

---

## Alternative data source — hardcoded Swift (Cubby style)

If you chose the Swift-array data source instead of JSON, replace §A1–A2 with a
compiled array; §A3–A6 are unchanged (the gate compares version strings either
way — feed it `Changelog.currentVersion`).

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

The §A7 data-invariant tests apply directly (assert `Changelog.entries`
non-empty, strictly newest-first, every entry has content). This variant has no
external file to bundle and gets compile-time type-safety, at the cost of a
recompile to edit copy and no easy release-pipeline regeneration.

---

## Gotchas / rationale

- **`seed` on fresh install** → new installers never see a "What's New" for a
  version they installed fresh; only real upgraders get the pop-up.
- **Downgrade must not clobber `lastSeenVersion`** → after a TestFlight rollback,
  a later real upgrade past the rolled-back version still fires the sheet.
- **Gate keys on marketing version only** — a build-number bump on the same
  `CFBundleShortVersionString` does not retrigger. (`buildNumber` is displayed,
  not part of the decision.)
- **`BuildInfo.swift` is non-deterministic** (embeds a timestamp) → gitignore it,
  regenerate every build, never hand-edit or commit it.
- **Attach `.whatsNewGate()` once**, at the app root; it evaluates on `onAppear`.
- **`WhatsNew.bundled` fails soft** — a missing/corrupt JSON makes the feature
  absent, never a crash. Keep it that way.
- **In-app ≠ App Store Connect.** The pop-up here is compiled into the binary.
  The ASC "What's New in This Version" text is a separate manual paste that can
  silently drift — gate a release on both. See
  [`release-inapp-vs-asc-whatsnew-surfaces`](../release-inapp-vs-asc-whatsnew-surfaces/SKILL.md).

## Canonical references

- **Paperix** (JSON variant + build-info): `Paperix/WhatsNew.swift`,
  `WhatsNewGate.swift` (decider + `.whatsNewGate()` modifier),
  `WhatsNewSheet.swift`, `WhatsNewHistoryView.swift`, `AboutView.swift`
  (`buildSection`), `scripts/generate-build-info.sh`, `Resources/WhatsNew.json`.
- **Cubby** (hardcoded-Swift variant, settings-only, strong invariant tests):
  `Cubby/Support/Changelog.swift`, `Views/Settings/WhatsNewView.swift`,
  `CubbyTests/ChangelogTests.swift`, `Support/BuildInfo.swift`.

## Related

- [`release-inapp-vs-asc-whatsnew-surfaces`](../release-inapp-vs-asc-whatsnew-surfaces/SKILL.md)
  — the two-independent-surfaces principle and release-preflight gating for the
  in-app changelog vs the App Store Connect metadata.
- `ios-dev:release` — the release pipeline whose preflight gates `whatsnew_file`
  and `inapp_changelog_file`.
