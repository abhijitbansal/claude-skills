# iOS Release Automation & Portfolio Knowledge Flow — Design

**Date:** 2026-07-01
**Status:** Approved pending user spec review
**Evidence base:** [2026-07-01-ios-mining-report.md](./2026-07-01-ios-mining-report.md) — 40 verified findings mined from fix-commits + convention docs across 7 apps (Paperix/doc-scan, Cubby, Floorprint, floorplan_scanner, Sift, MemeKit, Folix) by a 17-agent adversarially-verified workflow.

## 1. Problem

Five recurring pains across the iOS app portfolio:

1. **Release friction** — every session that pushes to TestFlight/App Store starts with a big hand-written prompt. The existing `ios-dev/release` skill is mature (12 stages) but Paperix-hardcoded (font count "Expected: 7", App-Group id, 5-target list, encryption flag) and wired into **zero** apps — no app repo has `.claude/app.yml`.
2. **No repo standardization** — marketing assets, ExportOptions, CI, site: each app re-derives them. Mining meta-finding: *"every app re-derives it"* (deploy-site.sh ported 4×, version-bump rule documented 3×, signing ladder 3×, Release-Note trailers missing in the newest app).
3. **Learnings don't propagate** — AGENTS.md conventions are hand-copied between apps; bugs fixed in one app recur in the next (MainActor launch-watchdog crash shipped to TestFlight from three different apps).
4. **No standard CI/tagging** — zero `.github/workflows` in any app repo; Xcode Cloud contract (ci_post_clone, Package.resolved) re-derived per app.
5. **Site repos unmanaged** — three different shapes (cubby-site evolved, paperix-site stale, floorprint has none as a standalone repo pattern is embedded in-app).

## 2. Decisions (locked with user)

| Decision | Choice |
|---|---|
| Sequencing | Mining first → evidence-based order: **WS0 → WS5-seed → WS1 → WS2 → WS4 ∥ WS1 → WS3** |
| Upload mechanism | **Fastlane** (local automation standard) |
| Hosted build/release | **Xcode Cloud**; all builds/checks also run locally |
| Packaging | **Extend `ios-dev` + `core-workflow`** — no new plugins (first-principles call: cohesion with the existing `app.yml` layer; release already deploys the site; `core-workflow` already owns `contribute`) |
| Mined skills scope | **All 13 now** (3 P0, 6 P1, 4 P2) |
| Learnings inheritance | **Skills-only, thin AGENTS.md** — learnings live as versioned plugin skills; AGENTS.md stays app-specific; no text merging |
| Site standard | **Floorprint model** — split-repo GitHub Pages, `deploy-site.sh` subtree push, SSH-deploy-key CI, self-hosted fonts + CSP, og:image kit |

## 3. Architecture

Two plugin homes, one config foundation:

```
plugins/ios-dev/                     # everything app-lifecycle
  skills/_lib/                       #   app.yml v2 loader + validators
  skills/release/                    #   WS1: Fastlane + Xcode Cloud release
  skills/<13 mined knowledge skills>/
  skills/site-pages-deploy-kit/      #   WS3
  skills/xcode-cloud-post-clone-contract/  # WS4
  commands/ios-init.md               #   WS0: app.yml v2 scaffolder
  commands/ios-scaffold.md           #   WS2: repo standardizer
  commands/release.md                #   /release testflight|appstore
  commands/site.md                   #   /site deploy|verify|create

plugins/core-workflow/               # knowledge flow (language-agnostic)
  skills/learn-lesson/               #   WS5: capture a lesson → skill PR
  skills/contribute/                 #   existing, extended
  commands/learn.md                  #   /learn — capture from current session
```

**Data flow:** every ios-dev skill reads `.claude/app.yml` (walk-up discovery via existing `load_app_config.sh`). Per-app divergence lives in app.yml values + optional per-app hook scripts (`scripts/release-hooks/*.sh`), never in skill text.

## 4. WS0 — `app.yml` v2 (foundation, blocking)

Extend the current schema (`app: name/bundle_id/scheme/team_id/url_scheme/build_script/preview_root`, `linear:`) with the fields mining proved are needed. All new fields optional with safe defaults so existing behavior is unchanged.

```yaml
app:
  name: Floorprint
  bundle_id: com.abhijitbansal.floorprint
  scheme: Floorprint
  team_id: XDTAU7RN57
  url_scheme: floorprint
  build_script: build.sh
  preview_root: ~/FloorprintPreviews
  platforms: [ios]                  # ios | macos — folix/floorprint build both
  min_os: "26.0"                    # single source; kills the 26-vs-16 doc drift

targets:                            # replaces the hardcoded 5-target list
  extensions: [FloorprintWidget]    # widget/share/action targets to validate
  app_group:                        # App Group id, if any (entitlement parity check)

release:
  encryption_exempt: true           # ITSAppUsesNonExemptEncryption
  export_method: app-store-connect
  fonts_expected: 0                 # 7 for Paperix; 0 = skip check
  required_capabilities: []         # UIRequiredDeviceCapabilities allow-list
  usage_strings: [NSCameraUsageDescription]   # asserted in the GENERATED plist
  whatsnew_file: Sources/WhatsNew.json        # entry-per-version assert
  asc_app_id:                       # App Store Connect app Apple ID
  hooks_dir: scripts/release-hooks  # optional per-app pre/post stage scripts

site:
  repo:                             # e.g. abhijitbansal/floorprint-site (split-repo Pages)
  dir: site                         # source dir inside app repo
  domain: floorprint.app
  deploy: subtree-ssh               # floorprint model

ci:
  provider: xcode-cloud
  post_clone: ci_scripts/ci_post_clone.sh

linear:
  team_key:
  agent_user_id:
```

`/ios-init` v2: detects what it can (existing scaffolder), then interviews for the rest; `--migrate` upgrades a v1 file in place. A `validate_app_config.sh` in `_lib` schema-checks the file and is stage 0 of every consumer skill.

**Verify:** bats tests for the scaffolder/validator; run `/ios-init` against all three app repos and commit their `app.yml`s.

## 5. WS5-seed — Learnings library + capture loop

**Model:** a learning = a skill (or a reference file inside a themed skill). Inheritance = plugin update. No AGENTS.md merging.

- **Seed content:** the 12 mined shared-learnings + the 13 knowledge skills (§8). Existing 6 distilled micro-skills stay as-is; the catalog cross-references them.
- **`/learn` (core-workflow):** invoked in any app repo at the end of a debugging/fix session. Flow: summarize the lesson (symptom → root cause → fix → evidence) → check the claude-skills catalog for an existing skill to *extend* vs create → draft SKILL.md (or a reference addition) → hand off to the existing `contribute` skill to branch/PR into claude-skills. The app repo keeps only a one-line pointer in its AGENTS.md "lessons" section if the author wants one.
- **Dedupe rule:** `/learn` must grep `plugins/*/skills/*/SKILL.md` descriptions before creating; extending an existing skill's references/ beats a near-duplicate skill.
- **Contribution direction 2 (pull):** apps get updates via normal plugin version bump — no bespoke sync tooling (YAGNI).

**Verify:** dry-run `/learn` on a known already-covered lesson (must propose *extend*, not create); on a novel lesson (must produce a valid SKILL.md passing `plugin-dev` validation).

## 6. WS1 — Release v2 (`/release testflight|appstore`)

Rebuild the 12-stage skill on Fastlane + app.yml v2. Stages, with mining-driven additions marked ★:

1. **Pre-flight** — clean tree, branch, xcodegen fresh, signing identity, fonts (if `fonts_expected > 0`).
   ★ **Runtime-trap gate:** grep-audit `App.init`/`.task`/`onAppear` call graph for known heavy-work patterns (embedding/ML/PDF/photo preload) lacking off-main dispatch; warn with file:line (references the P0 skills as remediation).
   ★ **Compliance gate:** assert `usage_strings` present in the *generated* plist; `required_capabilities` allow-list; `encryption_exempt` flag present.
   ★ **Entitlement parity gate:** App Group id identical across app + `targets.extensions` (mining: mismatch only surfaced at altool validate, wasting a build number).
2. **Version bump** — MARKETING_VERSION/CURRENT_PROJECT_VERSION via project.yml only (never agvtool, never hand-edit — the 3×-documented rule becomes executable).
3. ★ **Release notes** — assert `whatsnew_file` has an entry matching the new MARKETING_VERSION; generate draft ASC notes from Release-Note: trailers since last tag; finalize via `release-notes-finalize.sh` pattern (from floorprint).
4. **Build + test locally** (all checks local per decision).
5. **Archive + export** — `fastlane gym` (replaces raw xcodebuild archive/export; ExportOptions generated from app.yml).
6. **Validate + upload** — `fastlane pilot` (TestFlight) / `fastlane deliver` (App Store metadata + binary). Fastfile is a *template rendered from app.yml*, one per app repo, created by `/ios-scaffold`.
7. **Tag + push** — `v<version>-b<build>`, annotated with the release notes.
8. **Site deploy** (appstore mode, if `site.repo` set) — delegates to the site kit (§9).
9. **ASC checklist** — remaining web-UI steps, mode-aware.

Per-app escape hatch: optional `scripts/release-hooks/<stage>-{pre,post}.sh`.

**Xcode Cloud path:** the same pre-flight gates run locally; archive/upload can alternatively be delegated to an Xcode Cloud workflow (release branch/tag trigger). `xcode-cloud-validate` skill (existing) + `xcode-cloud-post-clone-contract` skill (new, §8) cover the hosted side.

**Verify:** dry-run mode (`--dry-run` stops before upload) green on all three apps; a real TestFlight push of one app (user drives the final confirm).

## 7. WS2 — `/ios-scaffold` (repo standardizer)

Idempotent; reports drift instead of clobbering. Creates/verifies:

- `.claude/app.yml` (delegates to `/ios-init` if absent)
- `marketing/app-store-listing.md` (canonical copy: name, subtitle, description, keywords, notes — the single source ASC/site/in-app pull from)
- `fastlane/Fastfile` + `Gemfile` rendered from app.yml
- `ci_scripts/ci_post_clone.sh` (from the contract skill)
- `scripts/release-hooks/` (empty, documented)
- screenshots dir layout + icon-generation script reference
- AGENTS.md skeleton (thin, app-specific; pointer-style CLAUDE.md) for *new* repos only
- tagging convention note + `.gitignore` entries (xcodeproj, DerivedData…)

Architecture seeds (WidgetBridge, share-inbox backstop, deep-link resolver, CloudSync factory) are **not scaffolded as code** — they're knowledge skills (§8) the scaffold references in a generated `docs/ARCHITECTURE_CHECKLIST.md`. Scaffolding Swift source unsolicited violates surgical-change principles.

**Verify:** run against cubby (most modern) — zero diff noise on re-run; against a fresh temp repo — full creation.

## 8. Mined knowledge skills (all 13)

P0 — crash classes that shipped to TestFlight; referenced by the WS1 pre-flight:
1. `mainactor-launch-watchdog-audit` — heavy work on main at launch → 0x8BADF00D + boot-loop; off-main idioms + idempotent-retry rule.
2. `mainactor-runtime-isolation-trap` — @MainActor closures stored by UIKit invoked off-main (UIColor/UIImage providers, UIAction, CADisplayLink); `.ips` diagnosis reflex (AsyncRenderer + brk 1 ⇒ isolation, not persistence).
3. `swiftdata-cloudkit-model-rules` — explicit `cloudKitDatabase` (.none for local/in-memory), throwing container factory + fallback, single-side inverse, reserved names, centralized nonisolated schema.

P1:
4. `widget-appgroup-snapshot-bridge` — Codable DTO over App Group, atomic writes, backfill-on-launch, transient-empty-clobber + App-Lock double-redaction invariants.
5. `file-handoff-inbox-backstop` — share/action-extension inbox with attempt-cap + quarantine (poison item can't boot-loop the app).
6. `deep-link-resolver-applock-pathtraversal` — one pure resolver returning enum actions; drop links under App-Lock; path-traversal validation.
7. `vision-layout-ocr-grounding` — Vision-layout text (never `PDFDocument.string`), one AI-text entry point, versioned sidecar, cold-path verification.
8. `xcode-cloud-post-clone-contract` — ci_post_clone.sh materializes gitignored .xcodeproj; mirrors local generation; copies committed Package.resolved.
9. `site-pages-deploy-kit` — floorprint model templatized (§9).

P2:
10. `ondevice-generable-anti-hallucination` — flat @Generable (nested hangs iOS 26), verbatim-quote pinning, ~4K clip.
11. `scan-crash-recovery-store` — persist CapturedRoom JSON before the hang-prone build; decode-mismatch clearing; time-boxing; crash marker.
12. `scan-capture-quality-gates` — soft variance-of-Laplacian gate + auto-naming discipline (confidence floor, sentence reject-list).
13. `site-og-favicon-verify` — og:image dims lint, CSP/self-hosted-font check, idempotent icon/og generator (folded into `/site verify`).

Each: SKILL.md (symptom-first description for triggering) + references/ with the concrete code idioms mined from the apps. Existing 6 micro-skills cross-referenced, not duplicated.

## 9. WS3 — Site standard + `/site`

Floorprint model, templatized in `site-pages-deploy-kit`:

- **Layout:** `site/` dir in the app repo (source of truth) → split-repo public Pages repo. index/privacy/support pages, `.well-known/apple-app-site-association`, self-hosted woff2 + strict CSP, full favicon set, absolute og:image with width/height, retina device-frame captures.
- **`/site create`** — scaffold `site/` + public repo + SSH deploy key runbook.
- **`/site deploy`** — `deploy-site.sh` (subtree split + push, uncommitted guard, userinfo redaction) or the hardened Actions workflow (SSH deploy key, host-key pinning, loud-fail).
- **`/site verify`** — the og/favicon/CSP lint (skill 13).
- **Migration:** cubby-site + paperix-site adopt the template; floorprint-site extracted to standalone repo.

## 10. WS4 — CI

- **Local:** pre-release checks are WS1 stages 1–4 (no separate harness — DRY).
- **Xcode Cloud:** per-app setup = ci_post_clone contract (skill 8) + `xcode-cloud-validate` (existing) + a documented workflow recipe (PR: build+test; release tag: archive+TestFlight).
- **GitHub Actions:** only the site-deploy workflow (§9). App build CI on GH-hosted macOS runners is deferred — Xcode Cloud covers hosted builds (user decision), and duplicating it is YAGNI.

## 11. Testing strategy

- **bats** (repo convention, `tests/bats/`) for every shell artifact: app.yml validator, scaffolder idempotency, deploy-site guards, release pre-flight gates (fixture app.ymls: paperix-like, cubby-like, minimal).
- **Skill validation:** `plugin-dev:plugin-validator` + `skill-reviewer` on every new/changed skill.
- **Integration:** `/release --dry-run` against all three real app repos is the acceptance gate for WS1; `/ios-scaffold` re-run zero-diff for WS2.
- **Docs sync:** site catalog pages regenerate (existing repo convention).

## 12. Rollout

1. WS0 lands → run `/ios-init` in doc-scan, cubby, floorprint (commit app.yml to each).
2. WS5-seed + P0 skills land → available immediately in all repos via plugin.
3. WS1 lands → `/release --dry-run` in all three; first real TestFlight push (user confirms upload).
4. WS2/WS4/WS3 land → scaffold run per app; Xcode Cloud wired per app as needed; sites migrated one at a time.

## 13. Non-goals

- No Android/multiplatform release support (iOS/macOS only).
- No auto-merging PRs from `/learn` — human review stays in the loop.
- No AGENTS.md content merging/sync tooling (superseded by skills-only decision).
- No GH-Actions macOS build farm (Xcode Cloud covers hosted builds).
- No scaffolding of Swift source into app repos.

## 14. Risks

| Risk | Mitigation |
|---|---|
| Fastlane toolchain drift (Ruby) | Pin via per-app `Gemfile.lock`; `bundle exec` everywhere; keep raw-xcodebuild path documented as fallback |
| app.yml v2 schema churn | Validator versioned (`schema_version: 2`); `--migrate` path; all new fields optional |
| Release pre-flight false positives (runtime-trap grep) | Gates warn (block only on hard compliance failures); per-app suppress list in app.yml |
| 13 skills = triggering noise | Symptom-first descriptions; skill-reviewer pass on each; catalog cross-links instead of duplicates |
| Site migration breaks live pages | Migrate one site at a time; `/site verify` before DNS/Pages cutover; old repo kept until verified |
