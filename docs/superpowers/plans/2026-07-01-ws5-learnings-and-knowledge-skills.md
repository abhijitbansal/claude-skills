# WS5 — Learnings Loop + Knowledge Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `/learn` capture loop (core-workflow) and the 10 pure-knowledge skills mined from the app portfolio (P0 1–3, P1 4–7, P2 10–12 from the spec §8), so lessons propagate to every app via plugin updates instead of hand-copied AGENTS.md text.

**Architecture:** Knowledge skills are markdown-only (SKILL.md + references/), living in `plugins/ios-dev/skills/`. `/learn` is a core-workflow command+skill that drafts a lesson, dedupes against the catalog, and hands off to the existing `contribute` skill for the PR. No shell scripts in this WS except none — validation is via plugin-dev validators, not bats.

**Tech Stack:** Markdown skills (Claude Code plugin conventions), existing `core-workflow` contribute flow.

## Global Constraints

- Spec §5 + §8. Content source of truth: `docs/superpowers/specs/2026-07-01-ios-mining-report.md` (committed) and `.scratch/ios-release-brainstorm/mining-catalog.json` (per-skill one-liners/priorities; if absent, the spec §8 list is sufficient).
- Skill naming: kebab-case dirs matching spec §8 names exactly.
- SKILL.md frontmatter: `name`, `description` — description must be **symptom-first** (what the user sees: error string, crash signature, behavior), then "use when". This is the trigger surface; a vague description is a defect.
- Skills 8 (`xcode-cloud-post-clone-contract`), 9 (`site-pages-deploy-kit`), 13 (`site-og-favicon-verify`) are NOT in this plan — they carry scripts and land inside WS4/WS3 plans.
- Cross-reference, never duplicate, the 6 existing distilled micro-skills (ios26-toolbar-leading-title-truncation, avfoundation-capture-delivery-watchdog, parallel-ios-agent-fixes-single-sim, nonisolated-struct-codable-mainactor, vision-barcode-cidetector-fallback, swiftdata-inmemory-test-harness) and the existing `swift6-mainactor-migration` skill.
- Each skill ≤ ~150 lines of SKILL.md; deeper idioms go to `references/*.md`.
- Commit per task.

## File Structure

```
plugins/ios-dev/skills/
  mainactor-launch-watchdog-audit/SKILL.md            # Task 2
  mainactor-runtime-isolation-trap/SKILL.md           # Task 3
  swiftdata-cloudkit-model-rules/SKILL.md (+references/container-factory.md)  # Task 4
  widget-appgroup-snapshot-bridge/SKILL.md            # Task 5
  file-handoff-inbox-backstop/SKILL.md                # Task 5
  deep-link-resolver-applock-pathtraversal/SKILL.md   # Task 5
  vision-layout-ocr-grounding/SKILL.md                # Task 6
  ondevice-generable-anti-hallucination/SKILL.md      # Task 6
  scan-crash-recovery-store/SKILL.md                  # Task 6
  scan-capture-quality-gates/SKILL.md                 # Task 6
plugins/core-workflow/
  commands/learn.md                                   # Task 1
  skills/learn-lesson/SKILL.md                        # Task 1
```

---

### Task 1: /learn capture loop (core-workflow)

**Files:**
- Create: `plugins/core-workflow/commands/learn.md`
- Create: `plugins/core-workflow/skills/learn-lesson/SKILL.md`

**Interfaces:**
- Consumes: existing `plugins/core-workflow/skills/contribute` (branch/PR into claude-skills) — read its SKILL.md first and hand off exactly the way `contribute-skill.md` does.
- Produces: `/learn [topic]` usable from any repo.

- [ ] **Step 1:** Read `plugins/core-workflow/skills/contribute/SKILL.md` and `plugins/core-workflow/commands/contribute-skill.md` to mirror their handoff conventions.
- [ ] **Step 2:** Write `skills/learn-lesson/SKILL.md` implementing this flow:
  1. **Distill** the lesson from the current session: symptom (verbatim error/crash strings) → root cause → fix that worked → evidence (files/commits). If the session lacks a concrete fixed bug, ask the user what the lesson is.
  2. **Dedupe:** search the catalog before creating: `grep -ril "<key symptom terms>" ~/projects/claude-skills/plugins/*/skills/*/SKILL.md` plus a read of candidate descriptions. Decision rule: same root cause ⇒ EXTEND the existing skill (add a references/ file or a new symptom variant to its description); new root cause ⇒ NEW skill.
  3. **Draft:** SKILL.md with symptom-first description (template inline in the skill: frontmatter, Symptom, Root cause, Fix, Evidence, Related skills sections).
  4. **Hand off** to the `contribute` skill to branch/commit/PR into claude-skills (`--plugin ios-dev` for iOS lessons, else ask).
  5. **Optionally** leave a one-line pointer in the host repo's AGENTS.md lessons section — only if the user asks.
- [ ] **Step 3:** Write `commands/learn.md` (frontmatter `description:` + `argument-hint: [topic]`) that invokes the skill with `$ARGUMENTS` as the topic hint.
- [ ] **Step 4:** Validate: dispatch `plugin-dev:plugin-validator` agent on `plugins/core-workflow`; fix findings.
- [ ] **Step 5: Commit** — `git commit -m "feat(core-workflow): /learn — capture a session lesson into a skill PR"`

---

### Task 2: P0 skill — mainactor-launch-watchdog-audit

**Files:**
- Create: `plugins/ios-dev/skills/mainactor-launch-watchdog-audit/SKILL.md`

**Content requirements** (source: mining report Theme 1.1/1.4 — quote its concrete evidence):
- Description: "App killed at launch with 0x8BADF00D / freezes on first frame / boot-loops after a crash…" symptom-first.
- Symptom: watchdog SIGKILL at ~10s scene-update; boot-loop when the failed work retries unconditionally on every launch.
- Root cause: MainActor-default isolation puts unannotated heavy work (ML embedding, floor-plan build, PDF render, photo preload) on main when invoked from `App.init`/`.task`/`onAppear`.
- Fix idioms (complete Swift snippets in the SKILL.md):
  - audit checklist: grep entry points for heavy calls (`Vision`, `MLModel`, `pdfData`, `Data(contentsOf:)`, JPEG decode, embedding/index calls);
  - offload pattern: `nonisolated` worker + `Task.detached(priority: .utility)`/`TaskGroup`, return `Sendable` DTOs / `PersistentIdentifier`s, single hop back to `@MainActor`;
  - idempotency rule: record progress BEFORE the loop body (doc-scan's index.upsert-after-loop boot-loop), so a retried launch skips completed work.
- Apps/evidence: doc-scan (`fix(ai): run embedding backfill off the main actor…`), floorprint (`build floor plan + quality report off the main actor`, `prewarm furniture templates off-main`), cubby (`pre-load report photos off-main`).
- Related: `swift6-mainactor-migration`, `nonisolated-struct-codable-mainactor`, `mainactor-runtime-isolation-trap`.

- [ ] **Step 1:** Write the SKILL.md per the content requirements.
- [ ] **Step 2:** Dispatch `plugin-dev:skill-reviewer` on it; apply findings.
- [ ] **Step 3: Commit** — `git commit -m "feat(ios-dev): mainactor-launch-watchdog-audit skill (P0)"`

---

### Task 3: P0 skill — mainactor-runtime-isolation-trap

**Files:**
- Create: `plugins/ios-dev/skills/mainactor-runtime-isolation-trap/SKILL.md`

**Content requirements** (source: mining report Theme 1.2/1.3):
- Description: "intermittent EXC_BREAKPOINT/brk 1 on com.apple.SwiftUI.AsyncRenderer, top frame a UIColor/UIImage dynamic provider…"
- Diagnosis reflex (verbatim from mining): `.ips` thread == AsyncRenderer + `brk 1` + `_swift_task_checkIsolatedSwift` → `dispatch_assert_queue` ⇒ executor-isolation trap, NOT persistence/SwiftData (cubby initially misblamed SwiftData).
- Root cause: closure literal formed in `@MainActor` context inherits isolation; UIKit caches it and resolves OFF main (dynamic color/image providers, `UIAction` handlers, `CADisplayLink`/timer targets). Compiles clean.
- Fix (Swift snippets): make provider `@Sendable`/nonisolated-clean; everything it calls `nonisolated`; store resolved provider as `nonisolated static let`; nonisolated seam for an off-main regression test.
- Include the **re-entrancy across await** variant (Theme 1.3): `@MainActor` serializes threads, not logical passes — run/coalescing guard (`PhotoSyncRunGuard`), `isProcessing` no-op guard, idempotent lifecycle (invalidate timer before start). Evidence: cubby photo-sync, floorprint `guard re-entrant viewDidAppear`.
- Related: `mainactor-launch-watchdog-audit`, `swift6-mainactor-migration`.

- [ ] Steps 1–3 as Task 2 (write → skill-reviewer → commit `"feat(ios-dev): mainactor-runtime-isolation-trap skill (P0)"`).

---

### Task 4: P0 skill — swiftdata-cloudkit-model-rules

**Files:**
- Create: `plugins/ios-dev/skills/swiftdata-cloudkit-model-rules/SKILL.md`
- Create: `plugins/ios-dev/skills/swiftdata-cloudkit-model-rules/references/container-factory.md`

**Content requirements** (source: mining report Theme 2, all four findings):
- SKILL.md: the four rule groups —
  1. explicit `cloudKitDatabase`: `.none` for local-only/in-memory/preview stores (`.automatic` silently syncs the moment the iCloud entitlement exists; `.automatic`+`isStoredInMemoryOnly` is invalid);
  2. @Model CloudKit-mirror rules: every stored property optional or defaulted; `@Relationship(inverse:)` on exactly ONE side; never NSManagedObject-reserved names (`isDeleted` → use `isTrashed`);
  3. externalStorage ↔ CKAsset bridge: idempotent bidirectional reconcile gated on sync-ON; batch save + `Task.yield()` every N items;
  4. centralize the `Schema` in one `nonisolated` type — production container, in-memory tests, and any coexisting `NSPersistentCloudKitContainer` must agree exactly.
- references/container-factory.md: the full throwing-factory Swift idiom — `CloudSyncMode` enum (`Sendable`, `Equatable`) mapping to `.none` vs `.private(id)`; composition-root catch → local-only fallback + OSLog + Settings warning; relaunch prompt (backing store fixed at launch).
- Evidence: cubby commits (`in-memory ModelConfiguration must pass cloudKitDatabase: .none`, `centralize 10-type SwiftData schema in CubbyModelSchema`, photo-sync series).
- Related: `swiftdata-inmemory-test-harness`.

- [ ] Steps 1–3 as Task 2 (commit `"feat(ios-dev): swiftdata-cloudkit-model-rules skill (P0)"`).

---

### Task 5: P1 architecture skills (3)

**Files:**
- Create: `plugins/ios-dev/skills/widget-appgroup-snapshot-bridge/SKILL.md`
- Create: `plugins/ios-dev/skills/file-handoff-inbox-backstop/SKILL.md`
- Create: `plugins/ios-dev/skills/deep-link-resolver-applock-pathtraversal/SKILL.md`

**Content requirements** (source: mining report Theme 5; spec §8 items 4–6):
- `widget-appgroup-snapshot-bridge`: one Codable snapshot DTO over the App Group; app-side write path (atomic, file-protection-aware), widget-side pure read; relative-path ids; backfill-on-launch; **invariants:** never clobber a good snapshot with a transient-empty one (doc-scan `stop iCloud-sync launch from blanking widget recents`), App-Lock redaction decided in ONE place (no double-redaction). Evidence: doc-scan WidgetBridge/WidgetSnapshotReader commit series.
- `file-handoff-inbox-backstop`: App-Group inbox for share/action extensions; manifest ready-marker; per-batch attempt-cap + quarantine so a poison item can't boot-loop the host app (doc-scan `stop launch boot-loop on large rotated shared images`, `cap drain attempts and quarantine poison batches`); injectable inbox root for tests/CI.
- `deep-link-resolver-applock-pathtraversal`: all URL entries route through one pure `nonisolated` resolver returning an enum action; links DROPPED (not deferred) while App-Lock engaged; path validation — reject `..`, canonical-descendant check, known-id whitelist. Evidence: doc-scan `paperix://doc` deep links + applock fixes.
- Each: symptom-first description, Swift interface sketches, invariants list, evidence, related skills.

- [ ] **Step 1:** Write all three SKILL.md files.
- [ ] **Step 2:** skill-reviewer pass on each; fix.
- [ ] **Step 3: Commit** — `git commit -m "feat(ios-dev): widget bridge, share-inbox backstop, deep-link resolver skills (P1)"`

---

### Task 6: Vision/AI + capture skills (1 P1 + 3 P2)

**Files:**
- Create: `plugins/ios-dev/skills/vision-layout-ocr-grounding/SKILL.md`
- Create: `plugins/ios-dev/skills/ondevice-generable-anti-hallucination/SKILL.md`
- Create: `plugins/ios-dev/skills/scan-crash-recovery-store/SKILL.md`
- Create: `plugins/ios-dev/skills/scan-capture-quality-gates/SKILL.md`

**Content requirements** (source: mining report Themes 3–4; spec §8 items 7, 10–12):
- `vision-layout-ocr-grounding` (P1): never ground AI on `PDFDocument.string` (linear order collapses multi-column layouts → confabulation); pure `nonisolated` Vision-layout formatter (Y-band rows, X-gap column split, `\n`/`\t`/`\n\n` encoding); ONE entry point (`aiInputText`) with versioned sidecar (`.aitext.v2.txt`) + `searchableText` fallback; **verify on the cold path** (bug hides behind in-memory cache on fresh scans — kill + relaunch to test). Evidence: doc-scan `ground Analyze + Ask on Vision-layout text`, cubby OCR fixes.
- `ondevice-generable-anti-hallucination` (P2): flat `@Generable` schemas only (nested hangs generation on iOS 26); verbatim-quote pinning + top-N SOURCES fallback; clip grounding text ~4000 chars (multi-script tokenizes 2–3× heavier). Evidence: doc-scan abh-9 commit series.
- `scan-crash-recovery-store` (P2): persist `CapturedRoom` JSON immediately after `RoomBuilder` succeeds, BEFORE the hang-prone plan/scene build; harden against unreadable/partial files; clear on decode-mismatch (no restart loop); time-box processing with graceful fallback; freeze elapsed clock across interruptions; async-signal-safe crash marker before ModelContainer init. Evidence: floorprint scan-recovery series, cubby CrashSentinel.
- `scan-capture-quality-gates` (P2): variance-of-Laplacian sharpness as a SOFT gate (`.deliver`/`.warnAllowOverride`/`.autoAccept`), threshold ~50 not 80, auto-accept after retry budget; auto-naming discipline: single creation entry point, `minNameConfidence` floor, sentence-like reject-list, OCR-name confidence cap 0.69. Evidence: cubby P4/P6 fixes.
- Related links: `vision-barcode-cidetector-fallback`, `avfoundation-capture-delivery-watchdog`.

- [ ] **Step 1:** Write all four SKILL.md files.
- [ ] **Step 2:** skill-reviewer pass; fix.
- [ ] **Step 3: Commit** — `git commit -m "feat(ios-dev): vision grounding, generable, scan recovery, quality-gate skills"`

---

### Task 7: Catalog integration + validation gate

- [ ] **Step 1:** Bump `plugins/ios-dev/.claude-plugin/plugin.json` version to `2.0.0` and extend its `description` to mention the knowledge-skill catalog. Bump `core-workflow` plugin version (minor).
- [ ] **Step 2:** Dispatch `plugin-dev:plugin-validator` on both plugins → fix all findings.
- [ ] **Step 3:** If the repo has a skills-catalog doc page (`docs/skills-catalog.md`), regenerate/extend it with the new skills (follow whatever generation convention the file header states; if hand-maintained, add rows by hand matching format).
- [ ] **Step 4:** `bats tests/bats` (regression only — no new bats here) → green.
- [ ] **Step 5: Commit** — `git commit -m "chore(plugins): version bumps + catalog sync for knowledge skills"`
