# Migrating personal learned-lesson files into claude-skills — plan of action

**Status:** **Proposed — not yet executed, awaiting repo-owner approval.** This document only *proposes* file additions/edits; nothing in it has been run, no skill has been written, no PR opened, and no machine-local `~/.claude/skills` file has been touched. Counts below reflect the tree at planning time.

**Scope:** a 28-candidate batch review that mined this machine's `~/.claude/skills` — 24 personal learned-lesson files plus 4 standalone `SKILL.md` directories — each independently categorized (Fable) then adversarially re-checked (Fable) against this repo's live 48-skill catalog. Candidates 1–27 ran through a Workflow (81 agents, 0 errors); candidate 28 (`on-device-model-eval-harness-precommitted-kill-criteria`) was mined and adversarially verified separately, in response to an owner request to confirm coverage of an "on-demand AI implementation" pattern before this plan executes — see the Correction log. Primary landing target: `ios-dev`; also `core-workflow` and `prompt-craft`.

**Goal (as set):** promote reusable, stranger-portable lessons out of one machine's private skill folder into the versioned catalog as proper plugin skills (or extensions of existing ones), following the `learn-lesson` per-skill shape, so every repo inherits them via plugin update — while leaving the machine-local originals in place and adding a durable in-repo backup.

---

## Baseline & where the numbers land

**Correction applied after the workflow synthesis, verified against the live tree before this doc was saved:** the repo has **48 real skills** — `ios-dev` 34, `core-workflow` 6, `prompt-craft` 6, `linear-pm` 1, `second-wind` 1 — matching `docs/skills-catalog.md` exactly. (The workflow's synthesis stage initially miscounted `plugins/ios-dev/skills/_lib/` — a shared shell-script helper directory holding `init_app_config.sh` / `load_app_config.sh` / `validate_app_config.sh`, no `SKILL.md`, not a skill — as a 35th ios-dev skill, and concluded the catalog docs were one behind. They are not; there is no pre-existing count drift to reconcile.)

This batch adds **22 new skill directories** (ios-dev +16, core-workflow +5, prompt-craft +1). The 4 EXTEND, 1 MERGE, and 1 SKIP candidates add **zero** new directories.

| | Skills before (true) | + new | after |
|---|--:|--:|--:|
| ios-dev | 34 | 16 | **50** |
| core-workflow | 6 | 5 | **11** |
| prompt-craft | 6 | 1 | **7** |
| linear-pm | 1 | 0 | 1 |
| second-wind | 1 | 0 | 1 |
| **total** | **48** | **22** | **70** |

Commands (17), agents (2), hooks (7), CLI (1) are unchanged.

### Scope — explicitly out of scope for this review

Not part of the 28-candidate list above, and untouched by this plan:

- **`graphify`** — a separately versioned/maintained personal tool referenced directly in the global `CLAUDE.md`, not a mined lesson.
- **Symlinked `~/.claude/skills` entries that point to `~/.agents/skills`** — `find-skills`, `remotion-best-practices`, `swift-concurrency`, `swiftui-expert-skill`, `xcodegen-cli`: pre-existing third-party / installed skill content, not authored via this machine's learning pipeline.
- **Deduping against other installed marketplace plugins** (`ecc`, `superpowers`, `caveman`, …) — "claude skills" here means *this repo's* catalog only, never other installed plugins.

### Reconciliation notes (verify pass + asymmetric merge)

- **Verify pass:** no candidate's `verify` record returned `agrees=false`; every `correctedVerdict`/`correctedPlugin` is empty. So every categorize verdict stands unchanged. (A few `verify.id` echoes suggest alternate names, e.g. `corenfc-nonsendable-inline-io` for the NFC skill; `proposedSkillName` is authoritative since no verify formally corrected it, so those are listed as owner decision-points below, not overrides.)
- **Asymmetric MERGE:** `repair-agent-privileged-fix-stage-review-gate` votes MERGE into `xcodebuild-plugin-macro-validation-flags-per-invocation`; the xcodebuild candidate votes NEW_SKILL and would only *cross-reference* repair-agent as a separate skill. **Resolution: fold repair-agent into the new xcodebuild skill as a bounded subsection — do not mint a standalone repair-agent skill.** Rationale: repair-agent's own verdict concludes that, stripped of the Xcode specifics, the governance lesson ("review auto-fix commits") is *too generic for this repo's symptom-anchored mined-skill style*, and its verify agreed — so honoring xcodebuild's "separate skill" framing would create a skill that fails the repo's own bar. Name uses the anchoring skill's form, **`xcodebuild-plugin-macro-validation-per-invocation`** (not repair-agent's `-flags-per-invocation` variant). The "one lesson per skill" rule is respected: the trigger spine stays the per-invocation flags fix; the review-gate governance point is a subsection/reference, not a co-equal second lesson.

---

## Summary table — one row per candidate

| # | Candidate id | Verdict | Target plugin | Proposed name / target skill |
|--:|---|---|---|---|
| 1 | actor-model-lifecycle-lazy-load-cached-failure-graded-eviction | NEW_SKILL | ios-dev | `ml-actor-lazy-load-graded-eviction` |
| 2 | anthropic-structured-output-thinking-cost | NEW_SKILL | prompt-craft | `structured-output-adaptive-thinking-token-bloat` |
| 3 | apple-background-assets-pack-publish | NEW_SKILL | ios-dev | `background-assets-manifest-drift-blind-redownload` |
| 4 | async-ai-result-visible-outcome-states | NEW_SKILL | ios-dev | `async-enrichment-silent-loss-outcome-states` |
| 5 | audit-shared-action-callsites-before-overload | NEW_SKILL | ios-dev | `shared-action-overload-callsite-audit` |
| 6 | claude-code-hook-diff-range-and-command-regex-pitfalls | NEW_SKILL | core-workflow | `hook-merge-base-diff-command-regex-anchoring` |
| 7 | claude-transcript-mining-accreting-archive | NEW_SKILL | core-workflow | `claude-transcript-purge-accreting-stats-archive` |
| 8 | cloudkit-swiftdata-ckshare-single-mirror-rule | EXTEND_EXISTING | ios-dev | → `swiftdata-cloudkit-model-rules` |
| 9 | field-log-duration-clustering-confirms-race-hypothesis | NEW_SKILL | ios-dev | `field-log-duration-clustering-race-diagnosis` |
| 10 | ingest-x-via-rss-bridge | **SKIP_TOO_NARROW** | — | not migrating (see Skipped) |
| 11 | ios-device-diagnostics-without-xcode-gui | NEW_SKILL | ios-dev | `devicectl-crashlog-oslog-cli-diagnostics` |
| 12 | launchd-git-automation-self-heal | NEW_SKILL | core-workflow | `launchd-git-automation-self-heal` |
| 13 | navigationsplitview-single-stack-per-detail-column | NEW_SKILL | ios-dev | `navigationsplitview-single-stack-per-detail-column` |
| 14 | nonsendable-hardware-session-handle-inline-io | NEW_SKILL | ios-dev | `nonsendable-hardware-handle-inline-io` |
| 15 | redact-errors-at-shareable-export-boundary | NEW_SKILL | ios-dev | `diagnostic-export-error-redaction-boundary` |
| 16 | repair-agent-privileged-fix-stage-review-gate | **MERGE_WITH_SIBLING** | ios-dev | → folded into `xcodebuild-plugin-macro-validation-per-invocation` (row 23) |
| 17 | static-site-subpage-nav-ssr-default-drift | NEW_SKILL | ios-dev | `subpage-nav-anchor-baseurl-ssr-label-drift` |
| 18 | swiftdata-predicate-optional-lhs-contains-trap | NEW_SKILL | ios-dev | `swiftdata-predicate-optional-coalesce-contains-trap` |
| 19 | swiftui-sheet-in-sheet-uikit-present-imperative-bridge | NEW_SKILL | ios-dev | `swiftui-sheet-in-sheet-uikit-present-bridge` |
| 20 | verify-dispatcher-before-declarative-hook-rules | NEW_SKILL | core-workflow | `declarative-hook-rules-inert-without-dispatcher` |
| 21 | widgetkit-timelineprovider-nonisolated-mainactor | EXTEND_EXISTING | ios-dev | → `swift6-mainactor-compile-fixes` |
| 22 | xcode-cloud-tag-push-double-build-trap | EXTEND_EXISTING | ios-dev | → `xcode-cloud-post-clone-contract` (+ `release` S6/S7) |
| 23 | xcodebuild-plugin-macro-validation-flags-per-invocation | NEW_SKILL | ios-dev | `xcodebuild-plugin-macro-validation-per-invocation` (absorbs row 16) |
| 24 | fastlane-archive-multi-target-signing | EXTEND_EXISTING | ios-dev | → `release` (Stage 5) |
| 25 | realitykit-windowed-view-ios-gotchas | NEW_SKILL | ios-dev | `realityview-fullscreencover-black-defer-mount` (dir migrated **and renamed**) |
| 26 | subagent-buildverify-tool-grant-check | NEW_SKILL | core-workflow | `subagent-buildverify-tool-grant-check` |
| 27 | swiftui-pushed-list-tabbar-scroll-clearance | NEW_SKILL | ios-dev | `swiftui-pushed-list-tabbar-scroll-clearance` |
| 28 | on-device-model-eval-harness-precommitted-kill-criteria | NEW_SKILL | ios-dev | `ondevice-model-eval-harness-kill-criteria` |

Tally: **22 NEW · 4 EXTEND · 1 MERGE · 1 SKIP = 28.**

---

## ios-dev — new skills (16)

Each is a lesson/gotcha skill in the `Symptom / Root cause / Fix / Evidence / Related skills` shape, ≤ ~150 lines, long copy-paste code demoted to `references/*.md`, symptom-first description. Evidence column is the concrete dedupe finding from the batch, not generic text.

| Proposed skill | Root-cause one-liner | Dedupe evidence (why NEW, from payload) |
|---|---|---|
| `ml-actor-lazy-load-graded-eviction` | Eager model load in actor init blocks main thread; naive eviction cancels in-flight work identically for backgrounded (cancel-now) vs `memoryPressure` (defer-until-idle), cascading `CancellationError` into a refiner timeout | Grep hit only `vision-barcode-cidetector-fallback` (its "memory pressure" is CIContext-init failure, unrelated). Nearest `mainactor-launch-watchdog-audit` is launch-watchdog SIGKILL, distinct. `swift6-concurrency.md` covers isolation, not load timing/eviction |
| `background-assets-manifest-drift-blind-redownload` | `Manifest.json` schema drifts by Xcode version; no sha256 cache check before multi-GB re-download; asset-pack versions treated as mutable when they should be immutable generational IDs | No catalog skill touches Background Assets/`ba-package`. Grep hits false-positive: `file-handoff-inbox-backstop` Manifest.json is an App-Group inbox marker; `release`/`xcode-cloud-validate` altool/sha256 are `.ipa` validate/upload, not asset-packs |
| `async-enrichment-silent-loss-outcome-states` | Correct confidence-merge (OCR > VLM) silently drops the losing async result; not-ready and ran-and-lost paths are unlogged and visually identical, so it looks broken | Grep hits incidental "silently dropped" in `avfoundation-capture-delivery-watchdog` (stale-callback fix) and `legal-pages-css-scoping-bleed`. `vision-layout-ocr-grounding` / `ondevice-generable-anti-hallucination` cover grounding/schema, not the outcome-state UX gap |
| `shared-action-overload-callsite-audit` | Shared identifiers (deep-links, widget enum cases, routing keys) reused across surfaces with different intents; widening behavior for one caller silently changes all reuse sites; tests cover only the new caller | Read `deep-link-resolver-applock-pathtraversal` (App-Lock/path-traversal routing) and `widget-appgroup-snapshot-bridge` (snapshot channel) in full — neither covers the shared-action-widening regression |
| `field-log-duration-clustering-race-diagnosis` | Timeout timer arms before its guarded async task exists, racing startup/warm-up latency into false timeouts; cluster logged durations near the threshold to confirm the race quantitatively | Zero grep hits. Nearest `avfoundation-capture-delivery-watchdog` is the inverse (callback never fires, no timeout). `ios-device-diagnostics` is log *retrieval*, not statistical analysis |
| `devicectl-crashlog-oslog-cli-diagnostics` | Organizer crash-log sync lags ~24h; `devicectl` ArgumentParser misparses framework debug flags without `--`; console tools skip `os_log` without `OS_ACTIVITY_DT_MODE`/Console.app; `SwiftDataError` masks a CloudKit relationship-constraint error | Grep hits false-positive: `ios-build` devicectl is install-only; `mainactor-runtime-isolation-trap` "crash log" is `.ips` AsyncRenderer. `os_log`/`SwiftDataError`/`OS_ACTIVITY_DT_MODE`/Organizer = zero repo-wide hits |
| `navigationsplitview-single-stack-per-detail-column` | `NavigationSplitView` corrupts internal column-path state when multiple `NavigationStack`s stay mounted in one detail column; only one per column is supported — conditionally mount the active stack | Zero grep hits. Nearest `swiftui-tabbar-swipe-nav-tradeoff` is TabView paging vs deep-link, different mechanism; broader "column" grep hit only `vision-layout-ocr-grounding` (OCR reading order) |
| `nonsendable-hardware-handle-inline-io` | `NFCTag` is non-Sendable and session-scoped; it legally cannot cross into a `@concurrent` helper, so perform I/O inline in the delegate callback and extract only pure classification logic | Grep hits false-positive: `release` NFCTag is the iOS 26 entitlement gate; `swift6-mainactor-compile-fixes` teaches the *opposite* move (extract to `nonisolated`). `swift6-concurrency.md` has no row for the non-Sendable-parameter-can't-hop case. **Owner decision-point:** verify echoed the more specific name `corenfc-nonsendable-inline-io` |
| `diagnostic-export-error-redaction-boundary` | ML/Vision `Error` descriptions embed absolute container paths and OCR'd user content; `String(describing: error)` serialized into share-diagnostics sinks leaks private data into files users believe are anonymized | Grep hits incidental: `widget-appgroup-snapshot-bridge` redaction is snapshot-DTO App-Group flags; `site-pages-deploy-kit` redaction is tokened git URLs. No catalog entry covers an Error-description redaction boundary at an export sink |
| `subpage-nav-anchor-baseurl-ssr-label-drift` | Shared nav uses bare `#anchor` hrefs without `BASE_URL` prefixing so they break on subpages; SSR-hardcoded labels drift from client defaults; conditional-id rendering makes anchor targets missing in empty states | Zero grep hits. Inverse of `legal-pages-css-scoping-bleed` Bug 2 (hand-duplicated nav) — cross-link, don't compete. `github-pages-flat-deploy-subdir-404` is deploy-time globs, not in-page anchor/SSR. **Placement note:** general-dev-tooling domain, but ios-dev owns the marketing-site mined family, so it lands there beside `legal-pages-css-scoping-bleed`, `github-pages-flat-deploy-subdir-404`, `site-pages-deploy-kit` |
| `swiftdata-predicate-optional-coalesce-contains-trap` | Coalescing (`??`) an optional column on a `#Predicate` `contains()` LHS compiles but throws `NSInvalidArgumentException` ("unimplemented SQL generation") at fetch time; bare column works because nil never matches | Zero grep hits; broader "predicate"/"coalesc" hits are run-guard coalescing in `mainactor-runtime-isolation-trap`/`swiftdata-cloudkit-model-rules`, unrelated. The two SwiftData skills cover CloudKit rules and test harness, not this SQL-translator limit |
| `swiftui-sheet-in-sheet-uikit-present-bridge` | `UIActivityViewController` via `.sheet(item:)` from inside another SwiftUI sheet flashes and self-dismisses; SwiftUI's sheet state machine tears down the nested UIKit presentation — walk `connectedScenes→keyWindow→presentedViewController` to present imperatively from the top controller | Zero grep hits. `navigationsplitview-single-stack…` (column-path) and `realitykit…` (render timing) share no root cause |
| `xcodebuild-plugin-macro-validation-per-invocation` | SPM build-tool plugins/macros need `-skipPackagePluginValidation -skipMacroValidation` **per xcodebuild invocation** (they don't propagate across gym/build.sh/CI); the machine-wide `IDESkipMacroFingerprintValidation` default is a security-degrading trap. **Absorbs repair-agent (row 16)** as a "review-gate / never-silence-with-machine-wide-defaults" subsection | Zero grep hits for the flags or "Plugin must be enabled". The sole `release` "fastlane gym" hit is export_options/provisioning, not plugin/macro validation. See merge reconciliation above |
| `realityview-fullscreencover-black-defer-mount` | A `.virtual`-camera `RealityView` created as a `fullScreenCover` root *during* the presentation animation never establishes its render surface (Apple FB22536529); fix is deferring the mount past the animation, not layout wrapping. **Standalone dir migrated and renamed** from `realitykit-windowed-view-ios-gotchas` (dropping the generic `-gotchas` suffix for the repo's symptom-mechanism style) | Grep hit only `biometric-applock` (`fullScreenCover` above UIKit layers — unrelated). No RealityKit/RealityView/black-render skill exists; `swiftui-sheet-in-sheet…` is imperative-presentation, not a render-surface failure |
| `swiftui-pushed-list-tabbar-scroll-clearance` | Custom bottom bar attached via `safeAreaInset` on the pager (not the `NavigationStack`), so pushed screens get only device safe-area; `List` clips its last row behind the bar while the already-patched `ScrollView` clears it | Grep hit `swiftui-tabbar-swipe-nav-tradeoff` on "tab bar" — read in full; it covers labeled-bar-vs-swipe + tab-select/path-push render race, a different root cause. Sibling with cross-reference, not extension. Zero hits for `safeAreaInset`/`contentMargins` |
| `ondevice-model-eval-harness-kill-criteria` | Model picked from paper/vendor benchmarks; no pre-committed kill bar, so sunk cost drags a "pretty good" candidate into integration; strong-on-paper candidates die to broken tooling (instant-EOS inference, unloadable quant, incompatible processor) mid-engine-build instead of in a cheap offline harness; harness-machine numbers treated as deployment-target numbers | Zero grep hits for eval-harness/benchmark/scorecard/model-selection/kill-criteria across all 48 SKILL.md; broader `eval\|harness\|empirical` hits are `evaluatePolicy` (LocalAuthentication API), "retrieval" substrings, and `swiftdata-inmemory-test-harness` cross-links (unit-test fixture, unrelated — verified in full). Read `ondevice-generable-anti-hallucination` + `vision-layout-ocr-grounding` in full — both are integration-time lessons for an already-*chosen* model; neither touches selection methodology. Upstream of rows 1/3/4 (load / ship / surface the picked model) — cross-link, don't merge. **Placement note:** the lesson's own When-to-Use claims it generalizes beyond iOS/MLX, but per the row-17 precedent, family ownership beats domain purity — ios-dev owns the whole on-device-AI mined family (rows 1/3/4 + `ondevice-generable-anti-hallucination`, `vision-layout-ocr-grounding`), so it lands there beside them |

## ios-dev — extend existing skills (4)

| Candidate | Target skill (file) | What to add | Evidence anchor (from payload) |
|---|---|---|---|
| cloudkit-swiftdata-ckshare-single-mirror-rule | `plugins/ios-dev/skills/swiftdata-cloudkit-model-rules/SKILL.md` | A fifth rule group: **never run SwiftData native sync and `NSPersistentCloudKitContainer` as two simultaneous mirroring engines on one store; when `CKShare` forces `NSPersistentCloudKitContainer`, set the SwiftData side to `cloudKitDatabase: .none`.** Add CKShare/dual-mirror phrasing to the description | Its root-cause section already names a coexisting `NSPersistentCloudKitContainer` as a corruption vector (rule 4 mandates schema parity); this is the missing sharper corollary of the same failure family, competing for identical trigger keywords — so extend, don't fork |
| widgetkit-timelineprovider-nonisolated-mainactor | `plugins/ios-dev/skills/swift6-mainactor-compile-fixes/SKILL.md` (already has `references/synthesized-conformance-codable.md`) | A third diagnostic/sub-case: **`TimelineProvider` (and its `TimelineEntry`) conformance stays main-actor-isolated under MainActor-default even with per-method `nonisolated`; the whole provider struct + entry must be `nonisolated struct`** — plus a `references/` file | Same conformance-isolation root cause as the skill's existing two diagnostics; the hand-written-witness variant would compete for the same trigger. Considered ALREADY_COVERED (the lesson is a row in the private `~/.claude/rules/ecc/common/swift6-concurrency.md`) but that file doesn't ship in the public repo, so marketplace installers would lack it → EXTEND is correct |
| xcode-cloud-tag-push-double-build-trap | `plugins/ios-dev/skills/xcode-cloud-post-clone-contract/SKILL.md` (`references/workflow-recipe.md` L26–29) **+ `plugins/ios-dev/skills/release/SKILL.md` S6/S7** | Add the missing **either-path-never-both** caveat: pushing the release tag *is* the hosted-release trigger, so doing local fastlane upload **and** a tag-triggered Xcode Cloud build for one build number re-uploads the same binary and fails **ITMS-90189**. Correct release's S6 ITMS-90189 row (its "re-run, S2 bumps" remedy is wrong for the cloud double-build) and align its S7 `tag-only` text | The recipe documents the trigger mechanism but omits the failure mode; the candidate is the missing caveat on an already-documented workflow — **a two-file edit** |
| fastlane-archive-multi-target-signing | `plugins/ios-dev/skills/release/SKILL.md` Stage 5 (example at L164–169) | Extend Stage 5 to **fetch/map a provisioning profile for every signed target** (main app + each `targets.extensions` bundle id already enumerated in `.claude/app.yml`), fixing the repo's own currently-incomplete single-bundle-id example | Stage 5 already owns this symptom ("archive signs clean but export fails with no provisioning profile mapping") but its example maps only `{ APP_IDENTIFIER => profile }` — precisely the single-target bug adding a widget/share extension exposes |

> **`release` is edited by two candidates** — fastlane-archive-multi-target (Stage 5) and xcode-cloud-tag-push (S6/S7). Sequence them in one branch so the edits don't collide (Phase 2).

---

## core-workflow — new skills (5)

`core-workflow` is the repo's only general-purpose ("everyday glue, useful in any repo") plugin and the right home for tool-agnostic `general-dev-tooling` material.

| Proposed skill | Root-cause one-liner | Dedupe evidence (why NEW, from payload) |
|---|---|---|
| `hook-merge-base-diff-command-regex-anchoring` | Two-dot git-diff against a moving ref leaks unrelated commits into a Stop hook; `git push` command regex needs statement anchoring + metachar boundary and false-positives inside quoted strings; the sentinel must fail-open on infra failure | Grep hits are incidental command usage in `commit`, `review`, `branch-explainer`, `github-repo-go-public-preflight-scan` — none concern hook correctness. Sibling `verify-dispatcher…` is missing-wiring (hook never fires), not wrong logic in a firing hook |
| `claude-transcript-purge-accreting-stats-archive` | Claude Code purges session transcripts after `cleanupPeriodDays` (~30d), so re-mining `~/.claude/projects` for all-time stats silently loses aged-out days; fix is a committed accreting archive merged via per-field `max()` with delta-folded totals | Zero grep hits; no catalog skill on transcript mining/usage stats/retention. Other general-dev-tooling siblings concern hook/automation liveness, not silent history loss |
| `launchd-git-automation-self-heal` | launchd git jobs die silently: dirty tracked files block `git pull --ff-only`, bootstrap can't self-init from a missing clone, stale branches block retry; fix is force-clean before ff-only pull, bootstrap living outside the script it creates, `checkout -B` for idempotent retry | Zero grep hits for `launchd`/`ff-only`/`self-heal`/`reset --hard`/`checkout -B`; the "dirty"/"pipefail" hits are refuse-on-dirty preconditions, verified unrelated. Sibling hook/agent-wiring skills have a different root cause |
| `declarative-hook-rules-inert-without-dispatcher` | Hooks defined in rule-files (`.claude/hookify.*.local.md`) silently never fire because nothing in the settings stack reads them; native hooks are configured separately in `settings.json` — verify the dispatcher before authoring rules | Two false-positive "inert" hits (`github-solo-branch-protection-codeowners`, `linear-pm`), verified unrelated. Sibling `hook-merge-base-diff…` is hooks that DO fire but mis-match — different root cause, no merge |
| `subagent-buildverify-tool-grant-check` | A subagent whose tool grant lacks Bash (or a shell) stalls indefinitely on a build/verify task instead of failing fast; check tool grants before dispatching build/verify work. **Standalone dir migrated as-is** | Grep hits only incidental "subagent"/"stalls". Nearest `parallel-ios-agent-fixes-single-sim` is worktree/sim resource-racing, not a missing-Bash-grant; it never checks grants before dispatch |

## prompt-craft — new skill (1)

| Proposed skill | Root-cause one-liner | Dedupe evidence (why NEW, from payload) |
|---|---|---|
| `structured-output-adaptive-thinking-token-bloat` | With `json_schema`-constrained output, adaptive thinking wastes ~5× tokens (21k thinking vs 3k JSON) reasoning about form the schema already fixes without improving JSON quality; omit the `thinking` parameter for schema-constrained calls | Zero grep hits for `json_schema`/`output_tokens`/`thinking`/`adaptive`/`output_config`. prompt-craft's six skills are Claude Code ask-sharpening lenses, not API cost lessons. No sibling shares the root cause. Provider-general advice for anyone calling the Anthropic API with schema-constrained output |

---

## Skipped / not migrating

Listed so nothing silently disappears. **There are zero ALREADY_COVERED verdicts in this batch** — the reader should not infer any candidate was quietly dropped as a duplicate.

| Candidate | Verdict | One-line reason |
|---|---|---|
| ingest-x-via-rss-bridge | SKIP_TOO_NARROW | A personal RSS-reader ingestion tip with no plugin home (core-workflow is repo glue; ios-dev/prompt-craft/linear-pm/second-wind are unrelated surfaces), and it depends on volatile third-party bridge instances (nitter.net has gone down and rotated repeatedly since 2024), so the fix would not reliably help a stranger's repo. Not a duplicate — zero grep hits — just not catalog-worthy. **Stays machine-local only; not archived** |

---

## Archive for backup (proposal — owner to confirm or redirect)

The task asked for a durable backup of the migrated sources, in addition to leaving the machine-local `~/.claude/skills` originals untouched (belt-and-suspenders, no deletion anywhere).

**Proposal:** copy each migrated source **verbatim** into a new repo-tracked directory at the repo root:

```
archive/learned-skills/<original-filename-or-dirname>
```

- One entry per migrated candidate: the 23 lesson files that migrate (all except `ingest-x-via-rss-bridge`, which stays machine-local only) plus the 4 migrated standalone dirs — **27 sources**. `subagent-buildverify-tool-grant-check`, `fastlane-archive-multi-target-signing`, and `realitykit-windowed-view-ios-gotchas` are copied under their **original** dir names (the last is *renamed* only for its derived skill, so the archive preserves the pre-rename source).
- Committed in the **same PR** as the derived skills, so the raw mined source and the polished skill land together and the provenance is reviewable.
- This is a **proposal, not a decided path** — the owner should confirm `archive/learned-skills/` or redirect (e.g. `docs/mined-sources/`, a separate `_provenance` branch, or "skip the in-repo archive, machine-local original is enough"). No source file is deleted from `~/.claude/skills` regardless.

---

## Guardrails (every phase)

Adapted from `docs/skill-audit-plan.md`'s guardrails to a *net-add* batch (new skills wiring in) rather than a rename/merge refactor.

1. **Bidirectional cross-reference sweep.** Each new skill both *adds* `## Related skills` links **and** earns *reciprocal* links from the existing skills it names — `avfoundation-capture-delivery-watchdog`, `mainactor-launch-watchdog-audit`, `ios-device-diagnostics`/`devicectl-crashlog-oslog-cli-diagnostics`, `legal-pages-css-scoping-bleed`, `github-pages-flat-deploy-subdir-404`, `swiftui-tabbar-swipe-nav-tradeoff`, `mainactor-runtime-isolation-trap`, etc. — plus intra-batch cross-links (e.g. `subpage-nav-anchor…` ↔ `legal-pages-css-scoping-bleed`; `swiftui-pushed-list-tabbar…` ↔ `swiftui-tabbar-swipe-nav-tradeoff`; new `xcodebuild-plugin-macro…` ↔ `xcode-cloud-post-clone-contract`/`release`; new `ondevice-model-eval-harness-kill-criteria` ↔ `ml-actor-lazy-load-graded-eviction` + `background-assets-manifest-drift-blind-redownload` + `async-enrichment-silent-loss-outcome-states` (same Cubby VLM wave, upstream selection phase) and ↔ `ondevice-generable-anti-hallucination` + `vision-layout-ocr-grounding` (existing on-device-AI family)). Grep **repo-wide**, fix both directions in the same commit. Leave archived `docs/superpowers/` specs as historical record.
2. **Atomic inventory-count sweep.** Adding 22 skills changes counts in `docs/skills-catalog.md`, `docs/catalog.html`, `docs/architecture.html`, `docs/architecture.md`, `site/index.html`, `site/og.*`, plugin `README`s, and `.claude-plugin/marketplace.json`/`plugin.json`. One scripted sweep, never hand-edit each site (per AGENTS.md). Land on the true post-migration **70 / ios-dev 50 / core-workflow 11 / prompt-craft 7** (commands 17, agents 2, hooks 7, CLI 1 unchanged) — there is **no pre-existing drift** to reconcile; `docs/skills-catalog.md`'s current 48/34 is already accurate (see Baseline correction above).
3. **CI-green gate.** `.github/workflows/test.yml` asserts every skill dir has a `SKILL.md` and runs plugin-manifest validation, `shellcheck`, `bats`, `pytest` across macOS + Ubuntu. Green before merge; the `claude-code-review` workflow posts a review with no CRITICAL/HIGH unfixed.
4. **Description trigger-richness (symptom-first).** Every new `description` leads with what the user *sees* — verbatim error text / crash thread / wrong behavior — then "use when …". "SwiftData best practices" never triggers; `NSInvalidArgumentException … unimplemented SQL generation` does. This is the trigger surface and the discoverability lever.
5. **Description char-budget guardrail on the two riskiest EXTENDs.** `swift6-mainactor-compile-fixes` is the prior swift6 merge's product, already carrying **two literal diagnostic strings verbatim** under a tight char budget (skill-audit guardrail 7). Adding `TimelineProvider` as a third trigger surface (widgetkit) — and adding CKShare/dual-mirror phrasing to `swiftdata-cloudkit-model-rules` (cloudkit) — must **keep every existing literal diagnostic string verbatim**, pass the route-spike no-regression pre-gate, and stay within budget **or the description addition aborts** and the new trigger phrases move to the body instead.
6. **One lesson per skill.** Enforced against the merge: `xcodebuild-plugin-macro-validation-per-invocation` keeps the per-invocation-flags fix as its single trigger spine; the repair-agent governance point is a bounded subsection, not a co-equal second lesson. No new skill bundles two root causes.
7. **Reference delegation for fat drafts.** Any new SKILL.md whose fix carries >~20 lines of copy-paste code demotes it to `references/<topic>.md` with imperative pointer language ("**Read `references/…` before implementing**"), keeping the on-trigger body decision-dense and ≤ ~150 lines — matching the existing `references/`-using skills.

---

## Phased execution (mode / tier / effort per AGENTS.md)

Tier mapping: **planner = Fable / Opus · executor = Sonnet · chore = Haiku.** Executor is the floor for any SKILL.md content — **chore never drafts skill content or edits a SKILL.md body or a manifest.** Effort escalates one step before tier.

| Phase | Work | Mode / tier / effort |
|---|---|---|
| **0 — Reconcile, lock, archive** | Adopt the (unchanged) verify-corrected verdicts; lock the repair-agent→xcodebuild merge resolution and the 4 EXTEND targets; adversarial dedupe re-check of the 22 new names against the live tree (guard against drift since the batch grep); copy the 27 sources into `archive/learned-skills/` pending owner confirm | Solo orchestrator, **planner (Fable), high** |
| **1 — Draft the 22 new SKILL.md (+references)** | Write each new skill in the `learn-lesson` shape (symptom-first description, Symptom/Root cause/Fix/Evidence/Related, ≤150 lines, code→`references/`). Per-skill independent → **git-worktree fan-out**. Verify: frontmatter valid, body decision-dense, refs resolve, CI's "every dir has SKILL.md" holds | Workflow, **executor (Sonnet), medium–high** |
| **2 — Apply the 4 EXTENDs + fold repair-agent** | swiftdata-cloudkit 5th rule group; swift6 TimelineProvider sub-case + ref; xcode-cloud caveat **+ the release S6/S7 correction**; release Stage 5 per-signed-target mapping — **sequence the two `release` edits so they don't collide**. Fold repair-agent into the xcodebuild skill. Description rewrites (widgetkit/cloudkit) judged against the char-budget + route-spike gate — **abort the description add if it regresses** | Workflow; description-budget judging **planner (Fable), high**; the edits **executor (Sonnet), medium** |
| **3 — Bidirectional cross-ref / Related-graph sweep** | Wire the new skills into `## Related skills` in both directions across new + named existing skills + intra-batch links; grep repo-wide; these are SKILL.md body edits → executor floor | Workflow, **executor (Sonnet), medium** |
| **4 — Scripted inventory-count sweep + CI verify** | Run the atomic count script across `docs/skills-catalog.md`, `docs/catalog.html`, `docs/architecture.*`, `site/*`, READMEs, manifests; land on 70/ios-dev 50/core-workflow 11/prompt-craft 7 (no pre-existing drift to fix — see Baseline correction); confirm every link resolves and CI is green. No SKILL.md/manifest content edits (those landed in Phases 1–3) | Single agent, **chore (Haiku), low** |
| **5 — Contribute / PR** | Branch, commit atomically (conventional format, `Co-Authored-By` trailer), push, open PR via the existing `learn-lesson` → `contribute` flow (`claude-skills-contribute`); surface the PR URL; do not auto-merge | Solo orchestrator (uses `contribute` skill), **executor (Sonnet), medium** |

---

## What this plan explicitly does NOT do

- **Does not make any file change now.** This is a proposal awaiting owner approval; no skill written, no doc edited, no PR opened.
- **Does not auto-merge any PR** — review and merge stay with the owner (per `learn-lesson`'s hard rule).
- **Does not delete or move any machine-local `~/.claude/skills` original** — migration is copy-and-adapt; originals stay put, and the proposed `archive/learned-skills/` copy is an *additional* backup, not a relocation.
- **Does not dedup against other installed marketplace plugins** (`ecc`, `superpowers`, `caveman`, …) — the batch's dedupe grep, and this plan, are scoped to *this* repo's catalog only.
- **Does not migrate `ingest-x-via-rss-bridge`, `graphify`, or the `~/.agents/skills` symlinks** — all out of scope (Skipped / Scope above).
- **Does not mint a standalone `repair-agent` skill** — its governance lesson folds into `xcodebuild-plugin-macro-validation-per-invocation` per the reconciliation.
- **Does not combine any new skill for count's sake, nor touch command/driver skill structure** (`release`, `app-preview`, `ios-build`, `ios-scaffold`, `site-pages-deploy-kit`) beyond the two scoped `release` Stage-5/S6-S7 content edits.

---

## Correction log (added by the orchestrating session, post-synthesis)

The Workflow synthesis (Opus, xhigh effort) drafted the plan above from 81 agents' worth of inventory/categorize/verify output. Before saving, the orchestrating session independently re-verified the one load-bearing numeric claim (the "pre-existing 48/34 vs true 49/35 drift") against the live filesystem and found it **incorrect**: `plugins/ios-dev/skills/_lib/` (a shared config-script helper, no `SKILL.md`) had been miscounted as a skill. All totals in this doc reflect the corrected math (48 real skills today). No other claim from the original 27-candidate batch was re-verified line-by-line — the per-candidate dedupe evidence (grep hits, "zero hits", named existing-skill matches) comes from the workflow's categorize/verify agents and should be spot-checked during Phase 0 execution, not assumed correct by construction.

**Candidate 28 added post-synthesis (same session, before owner sign-off).** The owner asked, ahead of approving Phase 0, to confirm whether a skill already existed for an "implement on-demand AI, from Cubby lessons — container deployment + benchmarking, plus implementation debugging" pattern, for reuse on future apps. Investigation traced this to Cubby's on-device VLM (vision-language model) rollout (`docs/sessions/0016`, `0018`, `docs/roadmap/2026-07-07-on-device-ai-detection.md`): two of the three sub-asks were already covered by candidates already in this plan (row 1 `ml-actor-lazy-load-graded-eviction` = implementation-phase debugging; row 3 `background-assets-manifest-drift-blind-redownload` = the "container"/asset-pack deployment step), but the third — the M0 offline model-evaluation-harness methodology (benchmarking candidate models with pre-committed kill criteria before any integration work) — had never been mined into a learned-lesson file and so was absent from the original 27-candidate batch. It was mined into `~/.claude/skills/learned/on-device-model-eval-harness-precommitted-kill-criteria.md` and adversarially verified by a single Fable agent (not the original 81-agent Workflow) against the live 48-skill catalog and all 27 already-planned candidates; verdict NEW_SKILL, zero overlap found. Added as row 28 (`ondevice-model-eval-harness-kill-criteria`, ios-dev). All counts in this doc (Baseline table, summary-table tally, ios-dev new-skills heading, Guardrail 1/2, Phase 1/4, archive source count) were updated to include it: **70 total / ios-dev 50 / 22 NEW · 4 EXTEND · 1 MERGE · 1 SKIP = 28 · 27 archive sources.** Its dedupe evidence, like candidates 1–27's, should still be spot-checked during Phase 0.
