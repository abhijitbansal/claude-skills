# WS4 — Xcode Cloud CI Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `xcode-cloud-post-clone-contract` skill (mined skill #8) plus a per-app Xcode Cloud workflow recipe, so hosted build/release setup stops being re-derived per app.

**Architecture:** Knowledge skill + the shared template already placed by WS2 (`plugins/ios-dev/skills/ios-scaffold/templates/ci_post_clone.sh`). This WS documents the contract and the ASC-side workflow recipe; local checks remain WS1's preflight (spec §10 — no separate harness).

**Tech Stack:** Markdown skill, existing template, existing `xcode-cloud-validate` skill cross-reference.

## Global Constraints

- Spec §10 + §8 item 8. Depends on WS2 Task 3 (template exists) — if WS2 not yet executed, create the template file at that exact path as part of Task 1 here (same content as WS2 plan Task 3 shows) and WS2 will find it OK.
- No GitHub Actions app-build CI (spec non-goal). The only GH workflow is the site one (WS3).
- Source to port: `~/projects/floorprint/ci_scripts/ci_post_clone.sh` (working real-world instance) and floorprint's `.github/workflows/release.yml` for the tag-trigger recipe shape.
- Commit per task.

## File Structure

```
plugins/ios-dev/skills/xcode-cloud-post-clone-contract/
  SKILL.md                     # Task 1
  references/workflow-recipe.md # Task 2
```

---

### Task 1: xcode-cloud-post-clone-contract SKILL.md

**Files:**
- Create: `plugins/ios-dev/skills/xcode-cloud-post-clone-contract/SKILL.md`
- Verify exists (create if WS2 hasn't run): `plugins/ios-dev/skills/ios-scaffold/templates/ci_post_clone.sh`

**Content requirements** (source: mining report Theme "xcodecloud-ci-build"; floorprint's real script):
- Description: "Xcode Cloud build fails with 'project not found' / SPM resolves wrong versions / works locally but not in cloud…" symptom-first.
- The three contract rules, each with its failure story:
  1. **Materialize the gitignored `.xcodeproj`** — `ci_post_clone.sh` must run every local generation step (build-info, codegen, asset gen) in the same order, then `xcodegen generate`. Failure mode: build works locally (developer ran the steps by hand) but Xcode Cloud sees no project.
  2. **Mirror rule** — any new local generation step MUST land in `ci_post_clone.sh` in the same change; drift = cloud-only build breakage discovered at release time.
  3. **`Package.resolved` pinning** — commit `Package.resolved`; copy it into `<App>.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/` after generation (floorprint: `fix: commit Package.resolved pin for Xcode Cloud SPM resolution`). Failure mode: cloud resolves different SPM versions than local.
  4. **brew + stdlib only** — the script runs before any credential setup; no gems, no network beyond brew.
- Point to the canonical template (`ios-scaffold/templates/ci_post_clone.sh`, placed per-app by `/ios-scaffold`) and to `xcode-cloud-validate` for pre-push validation.

- [ ] **Step 1:** Read `~/projects/floorprint/ci_scripts/ci_post_clone.sh`; fold any real steps the WS2 template misses into both the template and the skill text.
- [ ] **Step 2:** Write SKILL.md per requirements.
- [ ] **Step 3:** `plugin-dev:skill-reviewer` pass; fix.
- [ ] **Step 4: Commit** — `git commit -m "feat(ios-dev): xcode-cloud-post-clone-contract skill (P1)"`

---

### Task 2: workflow recipe reference

**Files:**
- Create: `plugins/ios-dev/skills/xcode-cloud-post-clone-contract/references/workflow-recipe.md`

**Content requirements:**
- Two canonical Xcode Cloud workflows per app, as concrete ASC UI steps:
  1. **PR check** — trigger: pull request → any branch; actions: build + test (scheme from app.yml, iOS latest sim); no signing.
  2. **Release** — trigger: tag matching `v*`; actions: archive with App Store distribution profile → TestFlight internal group; post-action: notify.
- Environment: macOS latest, Xcode latest-release; clean checkout; `ci_scripts/ci_post_clone.sh` is the only custom script.
- The tag-trigger convention matching WS1 S7 (`v<version>-b<build>`), so a `/release` tag push kicks the hosted archive automatically — document that this makes the local S5/S6 (gym/pilot) optional per app: local = fast path, cloud = canonical path.
- Read `~/projects/floorprint/.github/workflows/release.yml` first — if it encodes a tag→release flow, mirror its trigger regex; note in the recipe that GH-Actions-side release automation is NOT part of the standard (Xcode Cloud owns hosted release).

- [ ] **Step 1:** Write the reference doc per requirements.
- [ ] **Step 2:** Cross-link it from the SKILL.md ("see references/workflow-recipe.md for the ASC setup").
- [ ] **Step 3:** `bats tests/bats` regression → green (no shell changes expected; guard anyway).
- [ ] **Step 4: Commit** — `git commit -m "docs(ios-dev): xcode cloud workflow recipe (PR check + tag release)"`

---

### Task 3: Acceptance — validate against floorprint

- [ ] **Step 1:** Diff `~/projects/floorprint/ci_scripts/ci_post_clone.sh` against the template: every floorprint-specific step either (a) generic and in template, or (b) app-specific and documented in the skill as a "mirror rule" example. No third category.
- [ ] **Step 2:** Run the existing `xcode-cloud-validate` skill's checks (read its SKILL.md; run whatever validation script it provides) against the rendered template in a fixture app dir.
- [ ] **Step 3: Commit** any template fixes — `git commit -m "fix(ios-dev): ci_post_clone template gaps found against floorprint"`
