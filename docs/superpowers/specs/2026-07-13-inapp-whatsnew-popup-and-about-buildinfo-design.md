# Design — `ios-dev` reference skill: in-app What's New pop-up + About build-info

**Date:** 2026-07-13
**Status:** Approved (shape + scope), pending spec review
**Repo:** `claude-skills` (skill lands in `plugins/ios-dev/`)

---

## Problem

Across the user's iOS app repos, two user-facing features get rebuilt from
scratch each time by pointing at an existing app ("look at Paperix"):

1. **In-app "What's New" launch pop-up** — a sheet that auto-appears *once*
   after the user updates to a new version, listing new features and fixes.
2. **Settings/About "Build" screen** — shows marketing version, build number,
   git commit, branch, and build date for support/bug-report correlation.

There is no reusable, self-contained pattern for either. A new repo means
re-explaining the design every time.

## Goal

One lightweight **reference/pattern skill** in `ios-dev` that codifies both
features with paste-ready, known-good Swift + shell (lifted verbatim from
Paperix, with Cubby's data-invariant tests grafted on), so a new app repo can
be built from the SKILL.md alone — no "go read Paperix."

## Non-goals (explicit)

- **No release-metadata gating.** The `whatsnew_file`/`inapp_changelog_file`
  App-Store-Connect gating is already owned by `ios-dev:release` (preflight
  `whatsnew` + `inapp-whatsnew` gates) and reasoned about by
  `release-inapp-vs-asc-whatsnew-surfaces`. This skill cross-links to those,
  does not duplicate them.
- **No scaffolding / codegen.** It's a documentation skill with copy-paste
  blocks, not a file generator. (Scaffolding was considered and rejected: it
  would drift against evolving Paperix code and carry a sync burden.)
- **No `app.yml` schema changes**, no new preflight gate, no localization
  plumbing.

## Why this is not a duplicate (gap analysis)

Verified against `plugins/ios-dev/`:

| Concern | Already covered? | By what |
|---|---|---|
| ASC "What's New" metadata gating | ✅ | `ios-dev:release` preflight `whatsnew` gate |
| In-app changelog *file exists for next version* gating | ✅ | preflight `inapp-whatsnew` gate |
| In-app vs ASC two-source *reasoning* | ✅ | `release-inapp-vs-asc-whatsnew-surfaces` |
| **Launch pop-up SwiftUI implementation pattern** | ❌ | *nothing* (cited only as Paperix evidence) |
| **Settings/About build-info screen pattern** | ❌ | *nothing* |
| **Baking git commit into a Swift constant at build time** | ❌ | *nothing* |

The gap is the **in-app SwiftUI feature + its build-time data injection**. This
skill fills exactly that.

## Evidence base (what the two apps do)

- **Paperix** — the stronger, more complete reference (canonical base):
  external `Resources/WhatsNew.json`; pure unit-tested `WhatsNewGateDecider`
  (`present`/`seed`/`doNothing`); `.whatsNewGate()` root modifier;
  `WhatsNewSheet` → evergreen `FeaturesView` handoff; About "Build" card fed by
  auto-generated `Generated/BuildInfo.swift` from `scripts/generate-build-info.sh`.
- **Cubby** — deliberately minimal, settings-only: hardcoded Swift
  `Changelog.entries`; no launch pop-up (confirmed). Wins on **data-invariant
  tests** (`ChangelogTests`) and a pure `nonisolated` value type — those are the
  parts worth grafting into the pattern.

Verdict: base the skill on Paperix's pop-up + build-info pattern; graft Cubby's
invariant tests; document the JSON-vs-Swift data-source choice as a decision the
reader makes.

---

## Skill design

**Name:** `inapp-whatsnew-popup-and-about-buildinfo`
**Path:** `plugins/ios-dev/skills/inapp-whatsnew-popup-and-about-buildinfo/SKILL.md`
**Sibling:** `release-inapp-vs-asc-whatsnew-surfaces` (bidirectional cross-link).

**Frontmatter** (`name` + single-line `description` — the registry parser
rejects folded scalars, so `description` MUST be one physical line):

```yaml
---
name: inapp-whatsnew-popup-and-about-buildinfo
description: You're building or standardizing an iOS app's in-app "What's New" launch pop-up — the sheet that auto-appears once after a version upgrade listing new features/fixes — and/or the Settings/About "Build" screen showing version, build number, git commit, branch and build date. Use when adding a launch changelog gate, deciding whether What's-New content lives in an external JSON vs a hardcoded Swift array, wiring a build-time git-commit constant for in-app display, or when a new app repo needs the same What's-New + build-info feature that currently means "go look at Paperix". Covers the in-app SwiftUI implementation only — for release-time whatsnew_file / App Store Connect notes gating see release-inapp-vs-asc-whatsnew-surfaces.
---
```

### SKILL.md content outline

1. **When to use** (trigger, symptom-first — matches sibling style).
2. **Two surfaces, one skill.** Pop-up (Pattern A) vs Settings build-info
   (Pattern B). One-line pointer: release-time gating → sibling skill.
3. **Data-source decision table** (the one real choice the reader makes):

   | Data source | Pick when |
   |---|---|
   | External bundled `WhatsNew.json` (Paperix) | Release pipeline regenerates/prepends entries from git; larger/rich changelog; content editable without recompiling |
   | Hardcoded Swift `[ChangelogEntry]` (Cubby) | Minimal, often settings-only; want compile-time type safety + invariant tests; small changelog |

4. **Pattern A — launch What's New pop-up** (paste-ready, verbatim Paperix):
   - Data contract: `WhatsNew.json` schema (`currentVersion` + newest-first
     `entries[]`: `version`, `buildNumber`, `releasedAt`, `headline`,
     `highlights[]`, `fixes[]`).
   - `WhatsNew.swift` — Codable models + nil-safe cached `bundled` loader
     (feature treated as *absent*, never crashes, on missing/corrupt file).
   - **`WhatsNewGateDecider`** — the crown jewel: pure, testable
     `present`/`seed`/`doNothing` state machine + semver-ish compare.
   - `WhatsNewGateModifier` + `.whatsNewGate()` root modifier (single arm site).
   - Minimal `WhatsNewSheet` (headline, New/Fixed lists, optional "See all
     features" handoff).
   - Gate unit tests.
5. **Pattern B — Settings/About build-info** (paste-ready, verbatim Paperix):
   - `scripts/generate-build-info.sh` — idempotent, atomic-write, gitignored
     output, graceful non-repo fallback; run as an Xcode build phase / from
     `build.sh`.
   - `BuildInfo` enum (generated).
   - About "Build" card rows + marketing version / build number from
     `CFBundleShortVersionString` / `CFBundleVersion`.
6. **Invariant tests to copy** (Cubby's `ChangelogTests`): non-empty,
   strictly-descending version, every entry has content, numeric (not
   lexicographic) compare, rejects out-of-order list.
7. **Gotchas / rationale:**
   - `seed` on fresh install → new installers aren't nagged about an "upgrade"
     they never performed.
   - Downgrade must NOT overwrite `lastSeenVersion` → a later real upgrade past
     the downgraded version still fires.
   - Gate keys on **marketing version only** — a build bump on the same version
     does not retrigger.
   - `buildDate` makes `BuildInfo.swift` non-deterministic → **gitignore it**,
     regenerate every build, never hand-edit/commit.
   - `.whatsNewGate()` is attached once at the app root, decides on `onAppear`.
8. **Canonical references** — Paperix (`WhatsNewGate.swift`, `WhatsNew.swift`,
   `WhatsNewSheet.swift`, `AboutView.swift`, `scripts/generate-build-info.sh`)
   and Cubby (`Changelog.swift`, `ChangelogTests.swift`).
9. **Related** — `release-inapp-vs-asc-whatsnew-surfaces` (release gating),
   `ios-dev:release`.

### Canonical code blocks the SKILL.md carries

These are lifted verbatim from working Paperix/Cubby source (already verified in
this session), lightly de-themed (Paperix's `Theme`/`t.*` tokens → plain
SwiftUI) so they compile in a fresh project.

**`WhatsNewGateDecider`** (Paperix `WhatsNewGate.swift:1-42`) — the load-bearing
pure logic:

```swift
enum WhatsNewGateDecider {
    enum Decision: Equatable {
        case present(String)   // real upgrade → show sheet, then persist
        case seed(String)      // fresh install → persist silently, no sheet
        case doNothing         // missing payload, same version, or downgrade
    }

    static func decide(bundledCurrentVersion: String?, lastSeenVersion: String?) -> Decision {
        guard let bundled = bundledCurrentVersion else { return .doNothing }
        guard let lastSeen = lastSeenVersion else { return .seed(bundled) }
        if compareVersions(bundled, lastSeen) == .orderedDescending {
            return .present(bundled)
        }
        return .doNothing
    }

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

The SKILL.md also carries: the `WhatsNew`/`WhatsNewEntry` Codable + nil-safe
`bundled` loader; the `WhatsNewGateModifier`/`.whatsNewGate()` modifier;
`generate-build-info.sh`; the `BuildInfo` enum + About "Build" card; and the
Cubby-style invariant test suite. (Full blocks assembled at implementation time
from the session-verified sources.)

---

## Implementation footprint (in `claude-skills`)

1. **New** `plugins/ios-dev/skills/inapp-whatsnew-popup-and-about-buildinfo/SKILL.md`.
2. **Bump** `plugins/ios-dev/.claude-plugin/plugin.json` `version` `2.3.0` →
   `2.4.0` (CI requires a version bump for a changed plugin — see repo commit
   `2bd837a`).
3. **Atomic inventory-count sweep** — `ios-dev` skill count appears in
   `docs/architecture.md` (`ios-dev — 50 skills`), `docs/architecture.html`,
   `docs/catalog.html`, `docs/skills-catalog.md`, `site/*`, and plugin READMEs.
   The on-disk dir count is **51** while docs say **50** — a pre-existing drift.
   The sweep must **reconcile to the true post-add count** in one scripted pass,
   not hand-edit each site (per AGENTS.md cross-file-invariant rule).
4. **Bidirectional cross-link** — add a "Related" pointer to the new skill in
   `release-inapp-vs-asc-whatsnew-surfaces/SKILL.md`, and vice versa.
5. **No** release-gate wiring, **no** `app.yml` field, **no** scaffold script.

## Success criteria / verification

- SKILL.md exists; `description` is a single physical line; the plugin-manifest
  validation + registry parser accept it (covered by CI `bats`/`pytest`).
- `plugin.json` version bumped; CI version-bump check passes.
- `ios-dev` skill count is identical across every doc/site/README location and
  matches the true on-disk count.
- Cross-links resolve both directions.
- **Acceptance test:** a reader who has never seen Paperix can stand up both the
  launch pop-up and the About build-info screen from the SKILL.md alone.
- CI green (shellcheck, bats, pytest, manifest validation).

## Open questions

None blocking. Skill name and the exact de-theming of the sample SwiftUI are the
only soft spots — both resolvable during implementation.
