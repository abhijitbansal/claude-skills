# Cubby upstreaming: release-skill fixes + 8 mined skills — design

Date: 2026-07-18 · Branch: `feat/cubby-upstream-task023-skills` · Source: Cubby TASK-023 + skills backup

## Goal

Upstream two ios-dev release-skill fixes living only in the local plugin cache, and adopt
eight battle-tested mined skills from `~/.claude/skills/` into this repo (their durable
home). One PR, commit per logical change, CI plugin-version-guard satisfied.

## Scope decisions (user-confirmed)

- Adopt the six requested skills **plus** `fastlane-archive-multi-target-signing`
  (standalone, keep promotion_target) and `realitykit-windowed-view-ios-gotchas`
  (adjacent + cross-link with `realityview-fullscreencover-black-defer-mount`, no merge).
- All other `~/.claude/skills/` dirs are third-party/community — excluded.
- `swiftui-pushed-list-tabbar-scroll-clearance` and `subagent-buildverify-tool-grant-check`
  already live in the repo as newer/superset copies — no upstream needed.
- Global `~/.claude/skills/` copies stay untouched.

## TASK A1 — preflight binary-plist fix

Xcode's generated Info.plist is binary; grepping it for `<key>…</key>` is an
always-false-positive gate. Apply the cache diff verbatim to
`plugins/ios-dev/skills/release/scripts/preflight.sh`:

- `PLIST_XML="$(mktemp)"`; `plutil -convert xml1 -o "$PLIST_XML" "$PLIST"` with `cp` fallback.
- Both grep sites (usage-strings loop, `ITSAppUsesNonExemptEncryption`) read `$PLIST_XML`.
- `rm -f "$PLIST_XML"` after the capabilities check.

Test (TDD, RED first): new case in `tests/bats/release_preflight.bats` with a **binary**
plist fixture (`plutil -convert binary1`), gated by `command -v plutil || skip` so Ubuntu
CI (no plutil; cp fallback preserves old behavior there) stays green. Existing XML-fixture
cases must stay green.

## TASK A2 — `release.testflight_bump` (app.yml schema v2, optional key)

Cubby's convention is a PATCH bump per TestFlight release; the skill hardcodes `build`.
Add optional key `release.testflight_bump: build|patch`, default `build` (absent = current
behavior):

- `plugins/ios-dev/skills/_lib/init_app_config.sh` `section_release`: commented key line.
- `plugins/ios-dev/skills/_lib/validate_app_config.sh`: if set and not `build`/`patch` → ERROR.
- `plugins/ios-dev/skills/release/SKILL.md` Stage 2 ("Ask which bump" line): for
  testflight, the default offer comes from the key when set; absent → `build` as today.
  appstore flow unchanged.
- `plugins/ios-dev/commands/ios-init.md`: add the key to the propose list.
- Tests first: cases in `init_app_config.bats` (scaffold contains the key comment) and
  `validate_app_config.bats` (valid values pass; junk value errors; absent passes).

## TASK B — adopt 8 skills

Into `plugins/ios-dev/skills/` (7): swiftdata-cloudkit-production-schema,
background-assets-apple-hosted-packs, ios-photo-sidecar-store,
siri-app-intents-ios26-reliability, sheet-in-sheet-present-bridge-generalization,
fastlane-archive-multi-target-signing, realitykit-windowed-view-ios-gotchas.

Into `plugins/core-workflow/skills/` (1): dev-tracker-portable.

Rules:

- Copy content as-is; light frontmatter conformance edits only, no rewrites.
- **Preserve `promotion_target` frontmatter** on the four skills that carry it
  (swiftdata-cloudkit-production-schema, background-assets-apple-hosted-packs,
  sheet-in-sheet-present-bridge-generalization, fastlane-archive-multi-target-signing) —
  deliberate override of a1179b1's strip-precedent. Fallback if registry/pytest lint
  rejects the key: move the note into the body under `## Promotion target` and report it.
- Do NOT fold any delta-skill into its promotion target now.
- Keep prerequisite cross-references verbatim (swiftdata → swiftdata-cloudkit-model-rules,
  background-assets → background-assets-manifest-drift-blind-redownload).
- Mutual cross-links, added as Related-skill bullets:
  - `swiftui-sheet-in-sheet-uikit-present-bridge` → sheet-in-sheet-present-bridge-generalization
    (reverse direction already in the generalization skill's text).
  - `realityview-fullscreencover-black-defer-mount` ↔ `realitykit-windowed-view-ios-gotchas`
    (both directions).
- Descriptions must stay single-line (registry parser truncates folded scalars).

## Catalog + counts (one scripted sweep)

- `docs/architecture.md`: ios-dev 51 → 58 skills; core-workflow count +1 if shown.
- `site/index.html`: ios-dev "51 skills" tag → 58; core-workflow tag if shown.
- `docs/skills-catalog.md`: new table rows (ios-dev section + core-workflow section).
- `docs/catalog.html`: new entries matching its existing structure.
- Plugin READMEs: update if they enumerate skills/counts.
- Verify both HTML pages locally via Chrome MCP before committing.

## Version bumps

- `plugins/ios-dev/.claude-plugin/plugin.json`: 2.4.0 → **2.5.0** (one bump covers A1+A2+7 skills).
- `plugins/core-workflow/.claude-plugin/plugin.json`: 1.3.0 → **1.4.0**.
- `.claude-plugin/marketplace.json` carries no version fields — nothing to sync.

## Commit sequence (each leaves tree green: bats + pytest + shellcheck)

1. `docs: spec + plan for Cubby upstreaming` (this doc + plan doc)
2. `fix(ios-dev): preflight greps plutil-converted XML copy of generated plist` (+ bats)
3. `feat(ios-dev): release.testflight_bump app.yml key drives Stage 2 default` (+ bats)
4. `feat(ios-dev): adopt 7 mined skills from Cubby` (+ cross-links + version 2.5.0)
5. `feat(core-workflow): adopt dev-tracker-portable skill` (+ version 1.4.0)
6. `docs: catalog + counts sweep for 8 adopted skills`

## PR

One PR to main. Body notes: on the next plugin update the TASK A cache patches become
redundant, and the global skill copies may be superseded by plugin-served ones if the
marketplace serves them. Report: files added/changed, version bumps, any lint
nonconformance found in the adopted skills.

Manual-test checklist: skipped — branch has zero manual/device surface (scripts,
markdown, docs only); stated in PR instead.

## Error handling / risks

- Ubuntu CI lacks plutil → script falls back to `cp` (old behavior); binary-fixture test
  skips there. macOS CI exercises the real conversion path.
- Registry parser: adopted descriptions are already single-line; pytest
  (`test_build_registry*`, `test_registry_lib`) is the gate.
- `promotion_target` frontmatter unknown to lint → fallback documented above.
