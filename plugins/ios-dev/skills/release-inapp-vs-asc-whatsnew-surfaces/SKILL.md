---
name: release-inapp-vs-asc-whatsnew-surfaces
description: An app has BOTH an in-app "What's New"/changelog screen (compiled into the binary from Swift/code data) AND App Store Connect's "What's New"/"What to Test" metadata fields (pasted manually, independent of the binary) — these are two separate surfaces that can silently drift out of sync. Use this whenever adding a ChangelogEntry/FeatureCatalog-style in-app data file, preparing release notes for an app that has one, or when a tester reports "the new build doesn't show the new features in What's New" despite the binary clearly containing the feature. Not relevant for apps with no in-app changelog/feature-list screen — they only have the ASC-metadata surface.
---

# Two Independent "What's New" Surfaces — In-App Binary Data vs. App Store Connect Metadata

## Symptom

A release ships (binary uploaded, build processes successfully), but testers
on that build don't see the new features reflected in the app's own "What's
New" or feature-list screen — even though the marketing copy and the App
Store Connect "What's New" field were updated correctly. Or the reverse: the
in-app changelog was updated in code, but nobody remembered to also paste the
release notes into App Store Connect, so the public-facing metadata still
describes the previous version.

## Root cause

These are **two unrelated surfaces** that happen to have overlapping names
and easy-to-conflate purposes:

1. **In-app "What's New"** — a `ChangelogEntry`/`FeatureCatalog`-style Swift
   data structure compiled directly into the app binary. It only changes when
   a **new build** ships; re-uploading an identical binary under a new build
   number will never show updated in-app copy, because the copy lives in that
   binary, not anywhere server-side.
2. **App Store Connect "What's New" / "What to Test"** — metadata fields
   attached to a version/build record in App Store Connect, edited through
   the web UI (or a metadata-upload tool). These are **completely
   independent of the binary** — a `fastlane pilot`/`fastlane deliver` upload
   with `skip_waiting_for_build_processing` cannot push this text; it always
   requires a separate, usually manual, paste step once the build finishes
   processing.

A preflight gate that only checks "does the release-notes file have an entry
for this version" (the ASC-metadata side) gives false confidence — it says
nothing about whether the **in-app** data was actually updated to match, and
nothing forces the ASC-side paste to actually happen after upload.

**The concrete trap:** a wave of work adds real functionality *and* an in-app
changelog entry describing it, ships as build N. Someone then asks "did
testers see the new What's New?" and the honest answer is "only if they're on
build N specifically" — build N-1, even if functionally equivalent in every
other way, will never show it. Adding in-app changelog/feature-catalog
content is, by itself, sufficient justification for a fresh build bump,
separate from whether any other user-facing code changed.

## Fix

Treat the two surfaces as genuinely separate checklist items, not one
"release notes" task:

1. **Distinguish them explicitly in the release process docs/skill** — see
   `release/SKILL.md`'s Stage 3 callout for the wording this repo uses.
2. **Gate on both, not just one.** `plugins/ios-dev/skills/release/scripts/preflight.sh`
   already does this: the `whatsnew` gate checks `release.whatsnew_file` (ASC
   metadata) for an entry matching the next version; the sibling
   `inapp-whatsnew` gate checks `release.inapp_changelog_file` (in-app data)
   the same way — both optional, both FAIL in appstore mode / WARN in
   testflight when configured, both skip cleanly when the app has no such
   file. Config plumbing: `_lib/load_app_config.sh` (`RELEASE_INAPP_CHANGELOG_FILE`),
   `_lib/validate_app_config.sh` (advisory path check), `_lib/init_app_config.sh`
   (scaffolds the commented key).
3. **Keep the manual ASC-paste step in the post-upload checklist**, worded so
   it's clearly a separate action from "upload succeeded" — see `release/SKILL.md`
   Stage 9, item 2.
4. **When someone asks "why does this need a whole new build, nothing else
   changed?"** — if in-app changelog/feature-catalog data changed, that alone
   is the answer: the previous build's binary literally cannot show the new
   copy, regardless of how small the change looks.

## Evidence

- **Paperix** (`WhatsNewGate.swift`) — `WhatsNewGateModifier` presents the
  sheet by comparing `WhatsNew.bundled?.currentVersion` (the compiled-in
  payload, backed by `FeatureCatalog.swift`/`WhatsNew.swift`) against
  `lastSeenWhatsNewVersion` in `UserDefaults`. `WhatsNew.bundled` only
  changes when a new build ships — the concrete mechanism behind "in-app data
  is binary."
- **Cubby** — commit `e63c8b7` ("feat: in-app v0.2.0 changelog + feature-index
  entries") and commit `76bd409` ("docs: v0.2.0 release notes (What to Test +
  What's New) + release-runbook rules") are two separate commits for the two
  separate surfaces, motivating this split.
- **This repo** — `plugins/ios-dev/skills/release/scripts/preflight.sh`'s
  `inapp-whatsnew` gate, covered by `tests/bats/release_preflight.bats`, is
  the direct implementation of Fix item 2.

## Related skills

- `release` — the `release` skill's Stage 1 gates on both surfaces
  (`whatsnew` / `inapp-whatsnew`) and its Stage 3/Stage 9 notes name this
  skill for the reasoning.
- `swiftdata-inmemory-test-harness` — if the in-app changelog/feature-catalog
  is plain data (an array of entries), a small unit-test suite pinning basic
  invariants (entries non-empty, newest version's entry exists, no duplicate
  version keys) is cheap insurance — this data has no compiler-checked
  connection to the actual shipped version the way, say, an enum-driven URL
  router does.
