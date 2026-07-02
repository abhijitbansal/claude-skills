# WS2 — /ios-scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One idempotent command that standardizes an iOS app repo: marketing copy home, Fastlane files, ci_post_clone, release-hooks dir, architecture checklist — creating what's missing, reporting drift on what exists, never clobbering.

**Architecture:** `scaffold.sh` renders templates from `app.yml` values; templates live in the skill's `templates/` dir. Two modes: default (create missing + report drift) and `--check` (report only, exit 1 on drift — usable as a CI gate later). AGENTS.md/CLAUDE.md skeletons only for repos that lack them.

**Tech Stack:** bash 3.2-compatible, envsubst-style rendering via sed (no new deps), bats.

## Global Constraints

- Spec §7. Depends on WS0 (app.yml v2) and WS4's template (`ci_post_clone.sh` — this plan consumes the template file WS4 creates; if executing before WS4, Task 3 creates the file at the shared path and WS4 references it).
- Idempotency is the acceptance bar: second run on an untouched repo produces zero changes and says so.
- Never scaffold Swift source (spec non-goal).
- Templates use `{{APP_NAME}}`-style tokens; render = `sed -e "s/{{APP_NAME}}/${APP_NAME}/g" …` for the token set: APP_NAME, APP_BUNDLE_ID, APP_SCHEME, APP_TEAM_ID, RELEASE_ASC_APP_ID, SITE_DOMAIN.
- Commit per task.

## File Structure

```
plugins/ios-dev/skills/ios-scaffold/
  SKILL.md                          # Task 4
  scripts/scaffold.sh               # Tasks 1–3
  templates/
    marketing-app-store-listing.md  # Task 2
    Fastfile                        # Task 2
    Gemfile                         # Task 2
    ci_post_clone.sh                # Task 3 (shared with WS4)
    ARCHITECTURE_CHECKLIST.md       # Task 3
    AGENTS-skeleton.md              # Task 3
    CLAUDE-pointer.md               # Task 3
plugins/ios-dev/commands/ios-scaffold.md   # Task 4
tests/bats/ios_scaffold.bats        # Tasks 1–4
```

---

### Task 1: scaffold.sh framework — plan/create/drift engine

**Files:**
- Create: `plugins/ios-dev/skills/ios-scaffold/scripts/scaffold.sh`
- Test: `tests/bats/ios_scaffold.bats`

**Interfaces:**
- Consumes: WS0 loader env vars.
- Produces: `scaffold.sh [--check]` from app repo root. Output lines: `CREATE: <path>`, `OK: <path>`, `DRIFT: <path>: <reason>`, `SKIP: <path>: <reason>`. Default mode exit 0 unless errors; `--check` exits 1 if any CREATE-needed or DRIFT.
- Internal helper later tasks use: `ensure_file <relpath> <template> [render]` — creates from template if missing (CREATE), else compares: byte-identical → OK; differs → DRIFT (never overwrites). `ensure_dir <relpath>`.

- [ ] **Step 1: Failing tests** (`make_fixture_app` from WS1 helpers provides the base fixture):

```bash
#!/usr/bin/env bats

load helpers

setup() {
  TMP="$(mktemp -d)"
  SCAFFOLD="${BATS_TEST_DIRNAME}/../../plugins/ios-dev/skills/ios-scaffold/scripts/scaffold.sh"
  make_fixture_app "${TMP}/app"
}
teardown() { rm -rf "${TMP}"; }

@test "fresh repo: creates all managed files, exit 0" {
  cd "${TMP}/app"
  run bash "${SCAFFOLD}"
  [ "$status" -eq 0 ]
  [[ "$output" == *"CREATE: marketing/app-store-listing.md"* ]]
  [[ "$output" == *"CREATE: fastlane/Fastfile"* ]]
  [[ "$output" == *"CREATE: Gemfile"* ]]
  [[ "$output" == *"CREATE: ci_scripts/ci_post_clone.sh"* ]]
  [[ "$output" == *"CREATE: scripts/release-hooks"* ]]
  [ -f marketing/app-store-listing.md ]
  [ -x ci_scripts/ci_post_clone.sh ]
}

@test "second run: zero changes, all OK" {
  cd "${TMP}/app"
  bash "${SCAFFOLD}" >/dev/null
  before="$(git status --porcelain | git hash-object --stdin)"
  run bash "${SCAFFOLD}"
  [ "$status" -eq 0 ]
  [[ "$output" != *"CREATE:"* ]]
  [[ "$output" != *"DRIFT:"* ]]
  after="$(git status --porcelain | git hash-object --stdin)"
  [ "${before}" = "${after}" ]
}

@test "user-modified managed file reports DRIFT, is not overwritten" {
  cd "${TMP}/app"
  bash "${SCAFFOLD}" >/dev/null
  echo "user edit" >> fastlane/Fastfile
  cp fastlane/Fastfile "${TMP}/edited"
  run bash "${SCAFFOLD}"
  [[ "$output" == *"DRIFT: fastlane/Fastfile"* ]]
  cmp -s "${TMP}/edited" fastlane/Fastfile
}

@test "--check exits 1 when work is needed" {
  cd "${TMP}/app"
  run bash "${SCAFFOLD}" --check
  [ "$status" -eq 1 ]
}
```

- [ ] **Step 2:** Run → FAIL (script missing).
- [ ] **Step 3: Implement** the engine:

```bash
#!/usr/bin/env bash
# Idempotent iOS repo standardizer. CREATE missing, report DRIFT, never clobber.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TPL="${SCRIPT_DIR}/../templates"
# shellcheck source=../../_lib/load_app_config.sh
source "${SCRIPT_DIR}/../../_lib/load_app_config.sh"

CHECK=0
[[ "${1:-}" == "--check" ]] && CHECK=1
work=0

render() {  # $1 template file -> stdout with tokens substituted
  sed -e "s|{{APP_NAME}}|${APP_NAME}|g" \
      -e "s|{{APP_BUNDLE_ID}}|${APP_BUNDLE_ID}|g" \
      -e "s|{{APP_SCHEME}}|${APP_SCHEME}|g" \
      -e "s|{{APP_TEAM_ID}}|${APP_TEAM_ID}|g" \
      -e "s|{{RELEASE_ASC_APP_ID}}|${RELEASE_ASC_APP_ID}|g" \
      -e "s|{{SITE_DOMAIN}}|${SITE_DOMAIN}|g" \
      "$1"
}

ensure_file() {  # $1 relpath, $2 template
  local rel="$1" tpl="$2" tmp
  tmp="$(mktemp)"
  render "${tpl}" > "${tmp}"
  if [[ ! -f "${rel}" ]]; then
    work=1
    if [[ ${CHECK} -eq 0 ]]; then
      mkdir -p "$(dirname "${rel}")"
      cp "${tmp}" "${rel}"
      echo "CREATE: ${rel}"
    else
      echo "CREATE: ${rel} (needed)"
    fi
  elif cmp -s "${tmp}" "${rel}"; then
    echo "OK: ${rel}"
  else
    echo "DRIFT: ${rel}: differs from template (kept as-is)"
    work=1
  fi
  rm -f "${tmp}"
}

ensure_dir() {
  local rel="$1"
  if [[ ! -d "${rel}" ]]; then
    work=1
    if [[ ${CHECK} -eq 0 ]]; then mkdir -p "${rel}"; echo "CREATE: ${rel}"; else echo "CREATE: ${rel} (needed)"; fi
  else
    echo "OK: ${rel}"
  fi
}

# managed set (extended by later tasks)
ensure_file "marketing/app-store-listing.md" "${TPL}/marketing-app-store-listing.md"
ensure_file "fastlane/Fastfile" "${TPL}/Fastfile"
ensure_file "Gemfile" "${TPL}/Gemfile"
ensure_file "ci_scripts/ci_post_clone.sh" "${TPL}/ci_post_clone.sh"
[[ -f ci_scripts/ci_post_clone.sh && ${CHECK} -eq 0 ]] && chmod +x ci_scripts/ci_post_clone.sh
ensure_dir "scripts/release-hooks"
ensure_file "docs/ARCHITECTURE_CHECKLIST.md" "${TPL}/ARCHITECTURE_CHECKLIST.md"
if [[ ! -f AGENTS.md ]]; then
  ensure_file "AGENTS.md" "${TPL}/AGENTS-skeleton.md"
  ensure_file "CLAUDE.md" "${TPL}/CLAUDE-pointer.md"
else
  echo "SKIP: AGENTS.md: exists (app-specific, not managed)"
fi

if [[ ${CHECK} -eq 1 && ${work} -eq 1 ]]; then exit 1; fi
exit 0
```

  Create placeholder (one-line) template files so the engine tests pass; real content lands in Tasks 2–3. DRIFT semantics note: managed files are compared against the *rendered template*; a template upgrade in the plugin will therefore surface as DRIFT in every app — that's intended (the report tells the user to diff and adopt).

- [ ] **Step 4:** bats → PASS; shellcheck. **Step 5: Commit** `"feat(ios-dev): ios-scaffold engine — create/drift/check"`

---

### Task 2: Fastlane + marketing templates

**Files:**
- Create (real content): `templates/Fastfile`, `templates/Gemfile`, `templates/marketing-app-store-listing.md`
- Test: extend `tests/bats/ios_scaffold.bats`

- [ ] **Step 1: Failing test:** rendered Fastfile contains the fixture scheme + bundle id and no `{{` tokens:

```bash
@test "rendered Fastfile carries app values, no unrendered tokens" {
  cd "${TMP}/app"
  bash "${SCAFFOLD}" >/dev/null
  grep -q 'scheme: "Demo"' fastlane/Fastfile
  grep -q 'com.example.demo' fastlane/Fastfile
  ! grep -q '{{' fastlane/Fastfile
  ! grep -q '{{' marketing/app-store-listing.md
}
```

- [ ] **Step 2:** Run → FAIL. **Step 3: Implement templates:**

`templates/Fastfile`:

```ruby
# Rendered by ios-scaffold from .claude/app.yml — edit app.yml + re-scaffold
# for value changes; edit this file directly for lane logic (drift is reported,
# not overwritten).
default_platform(:ios)

APP_IDENTIFIER = "{{APP_BUNDLE_ID}}"
TEAM_ID = "{{APP_TEAM_ID}}"

platform :ios do
  desc "Archive and export a signed .ipa"
  lane :archive do
    gym(
      scheme: "{{APP_SCHEME}}",
      export_method: "app-store",
      export_team_id: TEAM_ID,
      output_directory: "build",
      output_name: "{{APP_NAME}}"
    )
  end

  desc "Upload the built .ipa to TestFlight"
  lane :beta do
    pilot(
      ipa: "build/{{APP_NAME}}.ipa",
      app_identifier: APP_IDENTIFIER,
      skip_waiting_for_build_processing: true
    )
  end

  desc "Upload binary + metadata to App Store Connect (no auto-submit)"
  lane :release do
    deliver(
      ipa: "build/{{APP_NAME}}.ipa",
      app_identifier: APP_IDENTIFIER,
      submit_for_review: false,
      force: true
    )
  end
end
```

`templates/Gemfile`:

```ruby
source "https://rubygems.org"
gem "fastlane", "~> 2.220"
```

`templates/marketing-app-store-listing.md`:

```markdown
# {{APP_NAME}} — App Store listing (canonical copy)

Single source of truth for store metadata. ASC fields, the site, and any
in-app about text are derived FROM this file — edit here first.

## Name
{{APP_NAME}}

## Subtitle (30 chars max)
TODO

## Description
TODO

## Keywords (100 chars, comma-separated)
TODO

## What's New template
See release notes pipeline (`Release-Note:` commit trailers).

## Privacy policy URL
https://{{SITE_DOMAIN}}/privacy

## Support URL
https://{{SITE_DOMAIN}}/support
```

- [ ] **Step 4:** bats → PASS. **Step 5: Commit** `"feat(ios-dev): fastlane + marketing scaffold templates"`

---

### Task 3: ci_post_clone + checklist + AGENTS skeleton templates

**Files:**
- Create (real content): `templates/ci_post_clone.sh`, `templates/ARCHITECTURE_CHECKLIST.md`, `templates/AGENTS-skeleton.md`, `templates/CLAUDE-pointer.md`
- Test: extend `tests/bats/ios_scaffold.bats`

- [ ] **Step 1: Failing test:**

```bash
@test "ci_post_clone is executable and xcodegen-generating" {
  cd "${TMP}/app"
  bash "${SCAFFOLD}" >/dev/null
  [ -x ci_scripts/ci_post_clone.sh ]
  grep -q 'xcodegen generate' ci_scripts/ci_post_clone.sh
  grep -q 'Package.resolved' ci_scripts/ci_post_clone.sh
}

@test "repo with existing AGENTS.md is not touched" {
  cd "${TMP}/app"
  echo "# my conventions" > AGENTS.md
  bash "${SCAFFOLD}" >/dev/null
  [ "$(cat AGENTS.md)" = "# my conventions" ]
  [ ! -f CLAUDE.md ] || ! grep -q "pointer" CLAUDE.md
}
```

- [ ] **Step 2:** Run → FAIL. **Step 3: Implement templates.**

`templates/ci_post_clone.sh` — port floorprint's `ci_scripts/ci_post_clone.sh` (read it first: `~/projects/floorprint/ci_scripts/ci_post_clone.sh`), genericized:

```bash
#!/usr/bin/env bash
# Xcode Cloud post-clone: materialize the gitignored .xcodeproj.
# Contract (see skill xcode-cloud-post-clone-contract):
#   1. every local generation step is mirrored here, in the same order
#   2. Package.resolved committed in the repo is copied into the generated
#      project so Xcode Cloud resolves pinned SPM versions
#   3. brew + stdlib only — nothing that needs credentials
set -euo pipefail

brew install xcodegen

cd "${CI_PRIMARY_REPOSITORY_PATH}"

# mirror local generation steps here (build-info, codegen, assets), THEN:
xcodegen generate

# pin SPM: copy the committed Package.resolved into the generated workspace
RESOLVED="Package.resolved"
if [[ -f "${RESOLVED}" ]]; then
  dest="{{APP_NAME}}.xcodeproj/project.xcworkspace/xcshareddata/swiftpm"
  mkdir -p "${dest}"
  cp "${RESOLVED}" "${dest}/Package.resolved"
fi
```

`templates/ARCHITECTURE_CHECKLIST.md` — the knowledge-skill pointer list (one line per seed decision):

```markdown
# {{APP_NAME}} — architecture checklist (generated by ios-scaffold)

Before building each subsystem, read the matching ios-dev skill — these
encode portfolio-wide lessons (see claude-skills mining report 2026-07-01):

- [ ] Launch path: no heavy work on MainActor — skill `mainactor-launch-watchdog-audit`
- [ ] UIKit-stored closures (color/image providers, UIAction): nonisolated — skill `mainactor-runtime-isolation-trap`
- [ ] SwiftData + CloudKit: container factory + model rules — skill `swiftdata-cloudkit-model-rules`
- [ ] Widget/extension data sharing: snapshot bridge invariants — skill `widget-appgroup-snapshot-bridge`
- [ ] Share/action extension handoff: inbox backstop — skill `file-handoff-inbox-backstop`
- [ ] Deep links: single resolver, App-Lock drop, path validation — skill `deep-link-resolver-applock-pathtraversal`
- [ ] OCR/AI grounding: Vision-layout text only — skill `vision-layout-ocr-grounding`
- [ ] Long captures: crash-recovery store — skill `scan-crash-recovery-store`
```

`templates/AGENTS-skeleton.md` — thin app-specific skeleton (name/stack/build/test sections + a "Lessons" section that POINTS at plugin skills instead of inlining rules). `templates/CLAUDE-pointer.md` — the two-line pointer file matching the convention in cubby/doc-scan/floorprint.

- [ ] **Step 4:** bats → PASS; shellcheck the sh template. **Step 5: Commit** `"feat(ios-dev): ci_post_clone, checklist, AGENTS skeleton templates"`

---

### Task 4: SKILL.md + /ios-scaffold command + acceptance

**Files:**
- Create: `plugins/ios-dev/skills/ios-scaffold/SKILL.md`
- Create: `plugins/ios-dev/commands/ios-scaffold.md`

- [ ] **Step 1:** SKILL.md: when to use (new repo, drift audit), what's managed vs never-touched (AGENTS.md exists ⇒ SKIP; Swift source never), how DRIFT should be resolved (diff template vs file, adopt or ignore consciously), `--check` as CI gate. Command doc: run scaffold, interpret output, walk user through DRIFT items one by one.
- [ ] **Step 2:** `plugin-dev:plugin-validator` on ios-dev → fix findings.
- [ ] **Step 3: Acceptance:** run `scaffold.sh --check` against `~/projects/cubby` (expect CREATEs listed, exit 1, nothing written); then real run on cubby on a branch, verify `git status` shows only expected files, second run zero-diff. Same spot-check on doc-scan (expect SKIP: AGENTS.md).
- [ ] **Step 4:** Full `bats tests/bats` → green. **Step 5: Commit** `"feat(ios-dev): /ios-scaffold skill + command"`
