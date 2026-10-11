---
name: inapp-whatsnew-popup-and-about-buildinfo
description: You're building or standardizing an iOS app's in-app "What's New" launch pop-up — the sheet that auto-appears once after a version upgrade listing new features and fixes — and/or the Settings/About "Build" screen showing version, build number, git commit, branch and build date. Use when adding a launch changelog gate, deciding whether What's-New content lives in an external JSON vs a hardcoded Swift array, wiring a build-time git-commit constant for in-app display, or when a new app repo needs the same What's-New + build-info feature. Covers the in-app SwiftUI implementation only — for release-time whatsnew_file / App Store Connect notes gating see release-inapp-vs-asc-whatsnew-surfaces.
---

# In-App What's New Pop-up + About Build-Info

Two small, reusable in-app features that every app rebuilds from scratch:

1. **What's New launch pop-up** — a sheet that auto-appears **once** after the
   user updates to a new marketing version, listing new features and fixes.
2. **Settings/About "Build" screen** — shows marketing version, build number,
   git commit, branch, and build date for support / bug-report correlation.

This skill is the paste-ready pattern for both, lifted from a known-good
implementation (a private document-scanner app) with a battle-tested data-invariant test suite (Cubby)
grafted on. The rules and decisions are on this page; the full code is in
`references/`.

## When to use

- Adding a launch "What's New" sheet to a new or existing app.
- Deciding **where** What's-New content lives (external JSON vs hardcoded Swift).
- Showing version / build / git-commit inside the running app (About screen).
- Baking the git commit into the binary at build time.
- A new app repo needs the same What's New + build-info feature.

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
| **External bundled `WhatsNew.json`** (default in `references/whatsnew-gate.md`) | You want a release pipeline to regenerate/prepend entries from git; a longer or frequently-edited changelog; content editable without recompiling. |
| **Hardcoded Swift `[ChangelogEntry]`** | Minimal, often settings-only; you want compile-time type-safety and invariant tests baked into the target; a short changelog. |

The gate logic, sheet, and build-info screen are identical either way — only the
data-loading step differs. **Read `references/hardcoded-swift-variant.md` before
implementing the hardcoded-Swift option** (it replaces A1–A2; A3 and A6 are
unchanged, feeding the gate `Changelog.currentVersion`; A4 and A5 must swap
`WhatsNew.bundled` / `WhatsNewEntry` for `Changelog.currentVersion` /
`Changelog.entries` / `ChangelogEntry` and drop the fixes section).

---

## Pattern A — the launch What's New pop-up

### Gate rules (the load-bearing part)

- **Seed on fresh install.** No `lastSeenVersion` stored → persist the bundled
  version *without* presenting. A new installer never performed an upgrade, so
  they get no "What's New" for the version they installed fresh; only real
  upgraders get the pop-up.
- **A downgrade never clobbers `lastSeenVersion`.** Bundled older than last-seen
  → do nothing, write nothing. After a TestFlight rollback, a later real upgrade
  past the rolled-back version must still fire the sheet.
- **Gate on the marketing version only** (`CFBundleShortVersionString`). A
  build-number bump on the same marketing version does not retrigger;
  `buildNumber` is displayed, never part of the decision.
- **Compare versions numerically, component-wise** — `0.1.10` is newer than
  `0.1.2` even though `"10" < "2"` lexically. Fall back to string comparison
  only when either side isn't fully dotted-numeric.
- **Keep the decision in a pure enum**, outside the SwiftUI modifier, so every
  branch is unit-testable with no `UserDefaults` or UI plumbing.
- **Mark seen only after the sheet disappears** (`onDisappear`), not when it
  presents, so a crash or interrupted presentation re-shows it.
- **Evaluate exactly once per launch** (guard with a `didEvaluate` flag in
  `onAppear`) and attach `.whatsNewGate()` **once**, at the app root.
- **The loader fails soft.** `WhatsNew.bundled` returns `nil` on a missing or
  corrupt JSON, which makes the feature absent — never a crash. Keep it that way.
- **Payload invariants:** `entries` is newest-first, `currentVersion` equals
  `entries.first.version`, every entry has a non-empty version, headline and
  highlights. Guard them with tests so a bad edit can't ship an empty or
  out-of-order changelog.

Decider signature (everything else is in the reference):

```swift
enum WhatsNewGateDecider {
    enum Decision: Equatable { case present(String), seed(String), doNothing }
    // signature only — full body in references/whatsnew-gate.md A3
    static func decide(bundledCurrentVersion: String?, lastSeenVersion: String?) -> Decision
    // nil bundled -> .doNothing; nil lastSeen -> .seed; bundled > lastSeen -> .present; else .doNothing
}
```

**Read `references/whatsnew-gate.md` before implementing** — A1 `WhatsNew.json`
data contract, A2 model + nil-safe loader, A3 full decider with version compare,
A4 `.whatsNewGate()` modifier + app-root arming, A5 the sheet (plus the optional
"See all features" handoff), A6 gate unit tests, A7 data-invariant tests.

---

## Pattern B — the Settings/About build-info screen

Version + build come from the `Info.plist` at runtime; the git fields must be
**injected at build time** because the running binary has no repo.

- **Generate `BuildInfo.swift` from a script** (`scripts/generate-build-info.sh`)
  wired as an Xcode Run Script build phase or called from `build.sh`. It must be
  idempotent, write atomically (temp file then `mv`), and degrade to
  `unknown` outside a git repo; a dirty tree gets a `-dirty` commit suffix.
- **`BuildInfo.swift` is gitignored.** It embeds a timestamp, so it is
  non-deterministic: regenerate every build, never hand-edit or commit it.
  Commit a placeholder only if a clean checkout must compile before the first
  build.
- The About section shows Version, Build, Commit, Branch, Built (and optionally
  iOS / Locale); the commit hash ties a bug report to an exact build.

**Read `references/about-buildinfo.md` before implementing** — B1 the full
generator script, B2 the `BuildInfoSection` SwiftUI view.

---

## Gotchas / rationale

- **In-app ≠ App Store Connect.** The pop-up here is compiled into the binary.
  The ASC "What's New in This Version" text is a separate manual paste that can
  silently drift — gate a release on both. See
  [`release-inapp-vs-asc-whatsnew-surfaces`](../release-inapp-vs-asc-whatsnew-surfaces/SKILL.md).

## Canonical references

Generic shape of the two known-good implementations (no repo access needed — the
code in `references/` is self-contained):

- **JSON variant + build-info:** a model/loader file, a gate file (decider +
  `.whatsNewGate()` modifier), a sheet, a history view, an About view with a
  build section, `scripts/generate-build-info.sh`, and `Resources/WhatsNew.json`.
- **Hardcoded-Swift variant (Cubby, settings-only, strong invariant tests):** a
  `Changelog` array, a Settings what's-new view, a changelog test suite, and a
  `BuildInfo` support file.

## Related skills

- [`release-inapp-vs-asc-whatsnew-surfaces`](../release-inapp-vs-asc-whatsnew-surfaces/SKILL.md)
  — the two-independent-surfaces principle and release-preflight gating for the
  in-app changelog vs the App Store Connect metadata.
- `ios-dev:release` — the release pipeline whose preflight gates `whatsnew_file`
  and `inapp_changelog_file`.
