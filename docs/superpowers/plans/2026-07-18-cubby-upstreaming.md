# Cubby Upstreaming (TASK-023 + skills backup) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upstream two ios-dev release-skill fixes (binary-plist preflight grep, `release.testflight_bump` schema key) and adopt 8 mined skills from `~/.claude/skills/` into the repo catalog, on one branch, one PR.

**Architecture:** Shell-script fix + app.yml schema-v2 extension in ios-dev's `_lib`/release skill, verified by bats; skill adoption is directory copies plus cross-link edits; catalog/counts updated in one scripted sweep; per-plugin version bumps satisfy CI's plugin-version-guard.

**Tech Stack:** bash, bats (tests/bats), pytest (registry), plutil (macOS), gh CLI.

## Global Constraints

- Branch: `feat/cubby-upstream-task023-skills` (already created off main). Never commit to main.
- Repo root: `/Users/abhijitbansal/projects/claude-skills`. Global skills source: `/Users/abhijitbansal/.claude/skills/` — READ ONLY, never modify.
- SKILL.md frontmatter descriptions MUST be single-line (registry parser truncates `>-` folded scalars).
- Preserve `promotion_target:` frontmatter keys on copied skills; do NOT fold any skill into its promotion target.
- Copied skill content: as-is, no rewrites; only the cross-link additions specified below.
- Conventional commits; every commit ends with trailer lines exactly:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_018Wi9YNUKMGvsaYUPKcNPi1`
- Each commit leaves tree green: run `bats tests/bats` and `python3 -m pytest tests/pytest -q` bare (a PreToolUse hook wraps noisy output — never pipe through head/tail/grep).
- `shellcheck` any changed .sh file before committing it.
- A GateGuard hook may block the FIRST Write/Edit to each file with a "state 4 facts" message — restate the facts it asks for, then retry the identical Write/Edit verbatim.

---

### Task 1: Preflight binary-plist fix (A1)

**Files:**
- Modify: `plugins/ios-dev/skills/release/scripts/preflight.sh:69-115` (plist block)
- Test: `tests/bats/release_preflight.bats` (append new case)

**Interfaces:**
- Consumes: existing fixture from `make_fixture_app` (helpers.bash), env `PREFLIGHT_PLIST`.
- Produces: nothing later tasks rely on.

- [ ] **Step 1: Write the failing test** — append to `tests/bats/release_preflight.bats`:

```bash
@test "binary Info.plist still PASSes usage-strings and encryption-flag" {
  command -v plutil >/dev/null 2>&1 || skip "plutil not available (Linux CI)"
  cd "${TMP}/app"
  plutil -convert binary1 "${PREFLIGHT_PLIST}"
  git add -A && git -c user.email=t@t -c user.name=t commit -qm binplist
  run bash "${PREFLIGHT}" --mode testflight
  [ "$status" -eq 0 ]
  [[ "$output" == *"PASS: usage-strings"* ]]
  [[ "$output" == *"PASS: encryption-flag"* ]]
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `bats tests/bats/release_preflight.bats`
Expected: new case FAILs (binary plist greps miss → `FAIL: usage-strings`, exit 1); all pre-existing cases PASS.

- [ ] **Step 3: Apply the cache patch verbatim** to `plugins/ios-dev/skills/release/scripts/preflight.sh`. Three hunks, exactly:

Inside the `if [[ -n "${PLIST}" && -f "${PLIST}" ]]; then` block, immediately after that line insert:

```bash
  # Xcode's generated Info.plist is binary by default — <key> tags never
  # appear as literal text there, so grep against a plutil-converted XML
  # copy instead of the raw (possibly binary) PLIST.
  PLIST_XML="$(mktemp)"
  if ! plutil -convert xml1 -o "${PLIST_XML}" "${PLIST}" 2>/dev/null; then
    cp "${PLIST}" "${PLIST_XML}"
  fi

```

Change the usage-strings loop grep target from `"${PLIST}"` to `"${PLIST_XML}"`:

```bash
    if ! grep -q "<key>${key}</key>" "${PLIST_XML}"; then
```

Change the encryption check grep target likewise:

```bash
  if grep -q "ITSAppUsesNonExemptEncryption" "${PLIST_XML}"; then
```

After the capabilities check's closing `fi` (directly before the block's `else … no generated plist found` branch), insert:

```bash
  rm -f "${PLIST_XML}"
```

(Reference diff: `diff -u plugins/ios-dev/skills/release/scripts/preflight.sh ~/.claude/plugins/cache/claude-skills/ios-dev/2.4.0/skills/release/scripts/preflight.sh` — the result must make that diff empty for this block.)

- [ ] **Step 4: Verify green + lint**

Run: `bats tests/bats/release_preflight.bats` → all PASS, including new case.
Run: `shellcheck plugins/ios-dev/skills/release/scripts/preflight.sh` → no new findings.
Run: `bats tests/bats` → all PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/ios-dev/skills/release/scripts/preflight.sh tests/bats/release_preflight.bats
git commit -m "fix(ios-dev): preflight greps plutil-converted XML copy of generated plist

Xcode's generated Info.plist is binary; grepping it for <key> tags was an
always-false-positive gate. Convert via plutil -convert xml1 to a mktemp
copy (cp fallback), grep the XML copy in both the usage-strings loop and
the ITSAppUsesNonExemptEncryption check, clean up after capabilities.
Upstreams the local plugin-cache patch (Cubby TASK-023)."
```

(with the two trailer lines from Global Constraints)

---

### Task 2: `release.testflight_bump` app.yml key (A2)

**Files:**
- Modify: `plugins/ios-dev/skills/_lib/validate_app_config.sh:62-76` (typed fields block)
- Modify: `plugins/ios-dev/skills/_lib/init_app_config.sh:52-65` (`section_release`)
- Modify: `plugins/ios-dev/skills/release/SKILL.md:91` (Stage 2 "Ask which bump" line)
- Modify: `plugins/ios-dev/commands/ios-init.md` (propose list, after the `release.asc_app_id` bullet)
- Test: `tests/bats/validate_app_config.bats`, `tests/bats/init_app_config.bats`

**Interfaces:**
- Consumes: `get` helper in validate_app_config.sh (`get release.testflight_bump`), `err` helper.
- Produces: optional app.yml key `release.testflight_bump` with values `build|patch` (absent = `build`).

- [ ] **Step 1: Write failing validate tests** — append to `tests/bats/validate_app_config.bats`:

```bash
@test "release.testflight_bump build and patch are valid" {
  good_yml "${TMP}/app.yml"
  printf '  testflight_bump: patch\n' >> "${TMP}/app.yml"
  run bash "${VALIDATE}" "${TMP}/app.yml"
  [ "$status" -eq 0 ]
  [[ "$output" != *"ERROR"* ]]
}

@test "release.testflight_bump rejects values other than build|patch" {
  good_yml "${TMP}/app.yml"
  printf '  testflight_bump: minor\n' >> "${TMP}/app.yml"
  run bash "${VALIDATE}" "${TMP}/app.yml"
  [ "$status" -eq 1 ]
  [[ "$output" == *"ERROR: release.testflight_bump"* ]]
}
```

- [ ] **Step 2: Write failing scaffold test** — append to `tests/bats/init_app_config.bats` (mirror the existing fresh-scaffold test's setup: same `project.yml` heredoc as the first test in that file, then):

```bash
@test "fresh scaffold includes release.testflight_bump comment line" {
  cd "${TMP}"
  cat > project.yml <<'YML'
name: Demo
targets:
  Demo:
    type: application
    platform: iOS
    settings:
      base:
        PRODUCT_BUNDLE_IDENTIFIER: com.example.demo
        DEVELOPMENT_TEAM: ABCDE12345
YML
  run bash "${INIT}"
  [ "$status" -eq 0 ]
  grep -q 'testflight_bump:' .claude/app.yml
}
```

- [ ] **Step 3: Run to verify both fail**

Run: `bats tests/bats/validate_app_config.bats tests/bats/init_app_config.bats`
Expected: "rejects values other than" FAILs (no validation exists yet → exit 0); scaffold test FAILs (`grep` finds nothing). The build/patch-valid test may already pass — fine.

- [ ] **Step 4: Implement.** In `validate_app_config.sh`, after the `release.encryption_exempt` check (line ~70), insert:

```bash
tf_bump="$(get release.testflight_bump)"
if [[ -n "${tf_bump}" && "${tf_bump}" != "build" && "${tf_bump}" != "patch" ]]; then
  err "release.testflight_bump must be build or patch (got '${tf_bump}')"
fi
```

In `init_app_config.sh` `section_release`, after the `asc_app_id:` line, insert:

```
  testflight_bump: build                # default bump per TestFlight release: build|patch
```

In `plugins/ios-dev/skills/release/SKILL.md` replace line 91:

```
Ask which bump (`patch`/`minor`/`major` for appstore; `build` for testflight), then:
```

with:

```
Ask which bump. For appstore: `patch`/`minor`/`major`. For testflight: offer
`release.testflight_bump` from `.claude/app.yml` as the default (`build` when the
key is unset — some repos bump `patch` per TestFlight release instead). Then:
```

In `plugins/ios-dev/commands/ios-init.md`, after the `release.asc_app_id` bullet, add:

```
   - `release.testflight_bump` — `build` (default) or `patch`: which version-bump kind a TestFlight release offers by default in the release skill's Stage 2.
```

- [ ] **Step 5: Verify green + lint**

Run: `bats tests/bats/validate_app_config.bats tests/bats/init_app_config.bats` → all PASS.
Run: `shellcheck plugins/ios-dev/skills/_lib/validate_app_config.sh plugins/ios-dev/skills/_lib/init_app_config.sh` → clean.
Run: `bats tests/bats` → all PASS.

- [ ] **Step 6: Commit**

```bash
git add plugins/ios-dev/skills/_lib/validate_app_config.sh plugins/ios-dev/skills/_lib/init_app_config.sh plugins/ios-dev/skills/release/SKILL.md plugins/ios-dev/commands/ios-init.md tests/bats/validate_app_config.bats tests/bats/init_app_config.bats
git commit -m "feat(ios-dev): release.testflight_bump app.yml key drives Stage 2 default

Optional schema-v2 key release.testflight_bump (build|patch, default build)
lets a repo whose convention is a patch bump per TestFlight release (e.g.
Cubby) get the right default offer in the release skill's Stage 2 instead
of the hardcoded build-only assumption. Validated in validate_app_config,
scaffolded by ios-init."
```

(with trailers)

---

### Task 3: Adopt 7 mined skills into ios-dev + cross-links + version 2.5.0

**Files:**
- Create (copy whole dirs): `plugins/ios-dev/skills/{swiftdata-cloudkit-production-schema,background-assets-apple-hosted-packs,ios-photo-sidecar-store,siri-app-intents-ios26-reliability,sheet-in-sheet-present-bridge-generalization,fastlane-archive-multi-target-signing,realitykit-windowed-view-ios-gotchas}/`
- Modify: `plugins/ios-dev/skills/swiftui-sheet-in-sheet-uikit-present-bridge/SKILL.md` (Related skills section)
- Modify: `plugins/ios-dev/skills/realityview-fullscreencover-black-defer-mount/SKILL.md` (Related skills section)
- Modify: `plugins/ios-dev/skills/realitykit-windowed-view-ios-gotchas/SKILL.md` (the copied one — append Related section)
- Modify: `plugins/ios-dev/.claude-plugin/plugin.json` (version)

**Interfaces:**
- Consumes: source dirs under `/Users/abhijitbansal/.claude/skills/` (each contains only SKILL.md).
- Produces: skill dir names above, referenced by Task 5's catalog rows.

- [ ] **Step 1: Copy the 7 dirs** (sources read-only — use `cp -R`, never `mv`):

```bash
cd /Users/abhijitbansal/projects/claude-skills
for s in swiftdata-cloudkit-production-schema background-assets-apple-hosted-packs ios-photo-sidecar-store siri-app-intents-ios26-reliability sheet-in-sheet-present-bridge-generalization fastlane-archive-multi-target-signing realitykit-windowed-view-ios-gotchas; do
  cp -R "/Users/abhijitbansal/.claude/skills/${s}" "plugins/ios-dev/skills/${s}"
done
```

- [ ] **Step 2: Conformance check (no rewrites).** Verify every copied SKILL.md frontmatter description is one physical line and `name:` matches its dir:

```bash
for s in swiftdata-cloudkit-production-schema background-assets-apple-hosted-packs ios-photo-sidecar-store siri-app-intents-ios26-reliability sheet-in-sheet-present-bridge-generalization fastlane-archive-multi-target-signing realitykit-windowed-view-ios-gotchas; do
  awk '/^description:/{print FILENAME": "length($0)}' "plugins/ios-dev/skills/${s}/SKILL.md"
  grep -c '^name: '"${s}"'$' "plugins/ios-dev/skills/${s}/SKILL.md"
done
```

Expected: each prints a length and `1`. If a description spans multiple lines or uses `>-`, join it to one line (content unchanged). Keep every `promotion_target:` key exactly as-is.

- [ ] **Step 3: Cross-links.** In `swiftui-sheet-in-sheet-uikit-present-bridge/SKILL.md`, append to its `## Related skills` list:

```markdown
- `sheet-in-sheet-present-bridge-generalization` — the generalization note for
  this skill: the same root cause recurred across camera picker, QuickLook,
  and mail composer; read it when the presented flow isn't a share sheet or
  document picker.
```

In `realityview-fullscreencover-black-defer-mount/SKILL.md`, append to its `## Related skills` list:

```markdown
- `realitykit-windowed-view-ios-gotchas` — the umbrella skill for windowed
  RealityKit on iOS (camera framing per presentation context,
  scene-rebuild-on-drift, tiered fidelity); this skill is its deep-dive on
  the fullScreenCover black-render mount bug.
```

In the copied `realitykit-windowed-view-ios-gotchas/SKILL.md`, append at end of file:

```markdown

## Related skills

- `realityview-fullscreencover-black-defer-mount` — the focused deep-dive on
  the fullScreenCover black-feed bug this skill summarizes; read it for the
  defer-the-mount fix mechanics and its evidence trail.
```

- [ ] **Step 4: Bump version.** In `plugins/ios-dev/.claude-plugin/plugin.json` change `"version": "2.4.0"` → `"version": "2.5.0"`.

- [ ] **Step 5: Verify**

Run: `bats tests/bats` → PASS (marketplace/manifest tests see valid JSON).
Run: `python3 -m pytest tests/pytest -q` → PASS (registry parses new frontmatter, incl. `promotion_target`). If a registry/lint test rejects `promotion_target`, move that key's text into the skill body as a `## Promotion target` section, delete the frontmatter key, and note it for the final report.

- [ ] **Step 6: Commit**

```bash
git add plugins/ios-dev/skills plugins/ios-dev/.claude-plugin/plugin.json
git commit -m "feat(ios-dev): adopt 7 mined skills from Cubby (v2.5.0)

swiftdata-cloudkit-production-schema, background-assets-apple-hosted-packs,
ios-photo-sidecar-store, siri-app-intents-ios26-reliability,
sheet-in-sheet-present-bridge-generalization (cross-linked with
swiftui-sheet-in-sheet-uikit-present-bridge),
fastlane-archive-multi-target-signing, realitykit-windowed-view-ios-gotchas
(cross-linked with realityview-fullscreencover-black-defer-mount).
promotion_target frontmatter preserved; no skills folded."
```

(with trailers)

---

### Task 4: Adopt dev-tracker-portable into core-workflow + version 1.4.0

**Files:**
- Create: `plugins/core-workflow/skills/dev-tracker-portable/` (copy dir)
- Modify: `plugins/core-workflow/.claude-plugin/plugin.json` (version)

**Interfaces:**
- Produces: skill dir name used by Task 5's catalog row.

- [ ] **Step 1: Copy + conformance**

```bash
cp -R /Users/abhijitbansal/.claude/skills/dev-tracker-portable plugins/core-workflow/skills/dev-tracker-portable
grep -c '^name: dev-tracker-portable$' plugins/core-workflow/skills/dev-tracker-portable/SKILL.md   # expect 1
awk '/^description:/{print length($0)}' plugins/core-workflow/skills/dev-tracker-portable/SKILL.md   # one line
```

- [ ] **Step 2: Bump version.** `plugins/core-workflow/.claude-plugin/plugin.json`: `"1.3.0"` → `"1.4.0"`.

- [ ] **Step 3: Verify.** Run `bats tests/bats` and `python3 -m pytest tests/pytest -q` → PASS.

- [ ] **Step 4: Commit**

```bash
git add plugins/core-workflow/skills/dev-tracker-portable plugins/core-workflow/.claude-plugin/plugin.json
git commit -m "feat(core-workflow): adopt dev-tracker-portable skill (v1.4.0)

Cubby's in-repo dev tracker (ledger + archive + capture/list/fix/learn),
genericized; platform-agnostic so it lives in core-workflow."
```

(with trailers)

---

### Task 5: Catalog + counts sweep (one scripted pass)

**Files:**
- Modify: `docs/architecture.md` (ios-dev/core-workflow skill counts), `docs/architecture.html` (same, if counts present), `site/index.html` (plugin tag counts), `docs/skills-catalog.md` (new rows), `docs/catalog.html` (new entries)

**Interfaces:**
- Consumes: skill dir names from Tasks 3–4.

- [ ] **Step 1: Compute true counts** (don't trust prior claims):

```bash
ls -d plugins/ios-dev/skills/*/ | grep -v '/_lib/' | wc -l          # ios-dev skill count
ls -d plugins/core-workflow/skills/*/ | wc -l                        # core-workflow skill count
grep -rn -E '[0-9]+ skills' docs/architecture.md docs/architecture.html site/index.html docs/skills-catalog.md docs/catalog.html plugins/ios-dev/README.md plugins/core-workflow/README.md 2>/dev/null
```

- [ ] **Step 2: Update every count found in Step 1's grep** to the computed values via one `sed`/scripted pass (e.g. old ios-dev claim "51 skills" → new computed count; adjust core-workflow claims likewise). No hand-editing files one by one; write a tiny loop covering all hits.

- [ ] **Step 3: Add catalog rows.** In `docs/skills-catalog.md`: locate the ios-dev learned-lesson skill table (rows like `` `swiftdata-cloudkit-model-rules` ``) and append rows for the 7 new skills; locate the core-workflow table and append `dev-tracker-portable`. Row text — first sentence of each skill's description, e.g.:

```markdown
| `swiftdata-cloudkit-production-schema` | skill | CloudKit schema-lifecycle sharp edges (Production deploys, CD_-prefixed mystery fields, rename safety) — delta on `swiftdata-cloudkit-model-rules`. |
| `background-assets-apple-hosted-packs` | skill | Apple-hosted Background Assets delivery/extraction failures (ProcessingPipelineError, TestFlight-only faults) — delta on `background-assets-manifest-drift-blind-redownload`. |
| `ios-photo-sidecar-store` | skill | Photo/attachment sidecar-store pattern for DB-backed iOS apps: bytes on disk, thumbnails, trash, iCloud sync, cover photos. |
| `siri-app-intents-ios26-reliability` | skill | Siri App Shortcuts reliability on iOS 26: phrase quota, parameterized-phrase matching, donated vocabulary. |
| `sheet-in-sheet-present-bridge-generalization` | skill | The sheet-in-sheet UIKit-present bug as a CLASS (camera, QuickLook, mail, share, doc picker) — generalization of `swiftui-sheet-in-sheet-uikit-present-bridge`. |
| `fastlane-archive-multi-target-signing` | skill | Fastlane archive/export must map a provisioning profile for EVERY signed embedded target, not just the main app. |
| `realitykit-windowed-view-ios-gotchas` | skill | Windowed RealityKit on iOS (not visionOS): black-feed bug, camera framing per presentation context, rebuild-on-drift, tiered fidelity. |
```

core-workflow row:

```markdown
| `dev-tracker-portable` | skill | In-repo dev tracker starter kit (one markdown ledger + archives + capture/list/fix/learn modes), the proven Cubby system genericized. |
```

In `docs/catalog.html`: read the existing entry markup for `swiftdata-cloudkit-model-rules`, clone its exact structure for each of the 8 skills (name, plugin, one-line description), keeping the page's copy-button contract (no new command samples → no copy-button work expected).

- [ ] **Step 4: Verify rendered pages.** Serve locally (`python3 -m http.server` from repo root), Chrome-MCP navigate to `docs/catalog.html` and `site/index.html`, confirm new entries/counts render, screenshot as evidence.

- [ ] **Step 5: Full green run.** `bats tests/bats` and `python3 -m pytest tests/pytest -q` → PASS.

- [ ] **Step 6: Commit**

```bash
git add docs/architecture.md docs/architecture.html site/index.html docs/skills-catalog.md docs/catalog.html
git commit -m "docs: catalog + counts sweep for 8 adopted skills"
```

(with trailers; include READMEs in the add list if Step 1 found count hits there)

---

### Task 6: Push, PR, report

- [ ] **Step 1: Final full verification.** `bats tests/bats`, `python3 -m pytest tests/pytest -q`, `git status` clean.

- [ ] **Step 2: Push + PR**

```bash
git push -u origin feat/cubby-upstream-task023-skills
gh pr create --title "feat: upstream Cubby release-skill fixes (TASK-023) + adopt 8 mined skills" --body "$(cat <<'EOF'
## Summary
- **A1** `preflight.sh` greps a `plutil -convert xml1` temp copy of the generated Info.plist (cp fallback) — the raw plist is binary, so the old `<key>` greps were an always-false-positive gate. Regression-tested with a binary-plist bats fixture (skips where plutil is absent).
- **A2** New optional app.yml (schema v2) key `release.testflight_bump: build|patch` (default `build`) drives the release skill's Stage 2 default bump offer for TestFlight; validated by `validate_app_config.sh`, scaffolded by `/ios-init`.
- **Adopted 8 mined skills** from `~/.claude/skills/` (their durable home is now this repo): 7 into ios-dev (`swiftdata-cloudkit-production-schema`, `background-assets-apple-hosted-packs`, `ios-photo-sidecar-store`, `siri-app-intents-ios26-reliability`, `sheet-in-sheet-present-bridge-generalization`, `fastlane-archive-multi-target-signing`, `realitykit-windowed-view-ios-gotchas`) and 1 into core-workflow (`dev-tracker-portable`). `promotion_target` frontmatter preserved; nothing folded; generalization/umbrella skills cross-linked with their existing siblings instead of merged.
- Versions: ios-dev 2.4.0 → 2.5.0, core-workflow 1.3.0 → 1.4.0 (CI plugin-version-guard).
- Catalog/counts swept: skills-catalog.md, catalog.html, architecture, site index.

## Notes
- On the next plugin update the local plugin-cache patches (TASK A) become redundant, and the author's global `~/.claude/skills/` copies may be superseded by plugin-served ones if the marketplace serves them. Global copies were left untouched.
- No manual-test checklist: branch has zero manual/device surface (scripts, markdown, docs only).

## Test plan
- [x] `bats tests/bats` green locally (incl. new binary-plist, testflight_bump cases)
- [x] `python3 -m pytest tests/pytest -q` green (registry parses adopted skills)
- [x] shellcheck clean on changed scripts
- [ ] CI green (macOS + Ubuntu; Ubuntu exercises the plutil-absent cp fallback)

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_018Wi9YNUKMGvsaYUPKcNPi1
EOF
)"
```

- [ ] **Step 3: Final report to user.** Files added/changed, version bumps, any conformance deviations found in the adopted skills (e.g. promotion_target fallback, description joins), PR URL.
