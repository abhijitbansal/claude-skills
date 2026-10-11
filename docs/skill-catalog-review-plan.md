# Skill catalog review (2026-10-10) — additions, updates, deletions

**Status:** **Proposed — not yet executed, awaiting repo-owner approval.** This
document only *proposes* edits. No skill has been written, merged or deleted;
no `~/.claude/skills` file has been touched.

**Scope:** every skill in the catalog (88 across 6 plugins at `0dce572`) and
every Claude Code session transcript still on this machine (318 sessions,
2026-08-02 → 2026-10-11; Claude Code purges transcripts after ~30 days, so
older history is gone — see `claude-transcript-purge-accreting-stats-archive`).
PR #28 (merged 2026-10-10 13:01) already mined 182 of those sessions, so the
mining lane here covered only sessions that **started on 2026-10-10 or later**
(58 digests, 23 substantive) plus the 8 auto-memory notes for this repo.

**Method:** one Workflow run, 312 agents, 0 errors.
- Mine lane: one miner per substantive digest (Sonnet, high) → 31 raw
  candidates → 25 clusters after root-cause dedup.
- Review lane: 5 plugin-group reviewers + a cross-catalog trigger-overlap
  reviewer + a third-party-dominance reviewer (Opus, medium, "report
  everything") → 168 findings, 115 actionable.
- Verify lane: every candidate and every actionable finding got two fresh
  adversarial verifiers at planner tier (coverage/substance for candidates;
  accuracy/worth-the-churn for findings), default *refuted* when uncertain.
  CONFIRMED = 0 refutations, CONTESTED = 1, REFUTED = 2.

Verifier corrections are folded into every item below; where a verifier
narrowed a finding, the narrowed form is what is proposed.

---

## TL;DR

| Lane | Proposed | Not proposed |
|---|--:|---|
| **New skills** | **0** | 25 candidates; all either already covered, already fixed in-repo code, one-session/thin, or better as a 1–3 line extension (see §A) |
| **Extensions** (fold-ins to existing skills) | **6** | — |
| **Updates** (content bugs, stale facts, drift) | **48 skills** (16 content bugs, 8 doc↔code drift, 24 shape/hygiene) | — |
| **Reference delegation** | **1** (`inapp-whatsnew-popup-and-about-buildinfo`) | `release`, `shared-resource-per-owner-scoping`, `linear-pm` (refuted: settled driver/light-touch decisions) |
| **Merges** | **1** (`sheet-in-sheet-present-bridge-generalization` → its parent) | `fastlane-archive-multi-target-signing`→`release`, `background-assets-apple-hosted-packs`→sibling (refuted: no trigger competition) |
| **Deletions** | **0** | `prompt-craft` `plan`/`review`/`debug` proposed by the dominance reviewer; all refuted (see §E) |
| **Owner decisions** | 5 cross-cutting questions (§F) | — |

Net catalog after execution: **87 skills** (ios-dev 59). Inventory counts in
`docs/`, `site/`, plugin READMEs and manifests change — one scripted sweep per
AGENTS.md.

**Deletion caveat.** Skill-invocation counts from transcripts cover only
~30 days and the `ios-dev` catalog was authored June–July for projects with
few sessions in that window, so "zero invocations" is **not** deletion
evidence. The deletion bar used here: duplicated by another repo skill,
trigger competition with a worse outcome, fixed upstream, or non-portable.
Nothing met it.

---

## A. New-skill candidates — all 25 rejected as standalone skills

Every candidate was real (the verifiers confirmed the incidents in the
transcripts) but none cleared the "stranger-portable, not already covered,
not already shipped as code, more than one lesson's worth" bar. Listed so the
next mining pass does not re-propose them.

| Candidate (root cause) | Source | Verdict | Where it goes instead |
|---|---|---|---|
| Heuristic/regex gate fix-rounds oscillate (patches tuned to reviewer examples) | 2 private sessions | CONTESTED | Not a repo skill; the escalate-to-LLM half is `ecc:regex-vs-llm-structured-text`. Drop. |
| URL dedupe must strip only tracking params (identity lives in `?gh_jid=` / `#inbox/`) | 1 private session | CONTESTED | Caught in review before shipping; project-specific. Drop. |
| Mod hooks misattribute peer/subagent events (`e.turnId`, `e.agentId`) | test-board / mods sessions | CONTESTED | **Extension E1** |
| `$.tool.register` handler returned `{result:{text}}` → "does not match its output shape" | 4 sessions, fixed in PR #31 | CONTESTED | **Extension E2** |
| kokoro-js `generate()` truncates at ~510 tokens | make-motion session | CONTESTED | Never reproduced (model's own caveat while coding). **Extension E4** carries only the `tts.stream()` + `--text-file` note. |
| Worktree guard refuses `eval`-named paths, `$VAR` paths, heredoc chains | memory note + this session | CONTESTED | **Extension E3** |
| macOS Messages AppleScript send ≠ delivery; verify via chat.db | 1 private session | REFUTED | Partially contradicts `app-preview` lines 28–34 ("Apple-side, no workaround"); one spike only. Note under U-app-preview as a *possible* future correction once reproduced. |
| Strict-YAML frontmatter (`: ` in description) makes `npx skills` skip skills | portable-artifacts build | REFUTED | Already guarded by `tests/pytest/test_skill_frontmatter.py` (PR #25). |
| Eval workdir symlinked `node_modules` wiped by an agent's `npm ci` | portable-artifacts build | REFUTED | Fixed (`linkNodeModules`) and documented in `plugins/portable-artifacts/eval/`. |
| DuckDB LLM-SQL sandbox needs AST allowlist (query()/sqlite_scan bypass) | 3 make-dashboard sessions | REFUTED | Shipped in `make-dashboard`; **Extension E5** adds a bypass catalogue reference. |
| Spec-driven renderer network escape needs CSP + request abort, not validator alone | 3 review sessions | REFUTED | Shipped in `make-dashboard`/`make-motion`; **Extension E5/E6** one-line note. |
| `getRowObjectsJS` not JSON-safe (infinite DATE, BIGINT…) | make-dashboard | REFUTED | `toJsonSafe` already in `scripts/lib/data.mjs`; quote not found in transcript. |
| ffmpeg stdin EPIPE / stalled encoder hang | make-motion review | REFUTED | Fixed in `render.mjs:94-110`; well-known Node gotcha. |
| Localhost preview server Host-header / DNS rebinding | make-motion review | REFUTED | Shipped (`server.mjs:125`, tested). Note: `make-dashboard`'s `serve.mjs` may lack the same check — **Extension E5** item. |
| Test-command detection regex (`\S+` crossing `&&`, `-q` summary without banner) | test-board session | REFUTED | Grab-bag; parent skill already covers anchoring. Drop. |
| Python `ZipFile.writestr(zinfo)` mutates shared `ZipInfo` → `BadZipFile` | 1 private session | REFUTED | Real stdlib gotcha, one session, no home in this catalog. Drop. |
| Workflow script parse error from backticks inside template-literal prompts | 1 private session | REFUTED | Built-in `workflow-authoring` territory; error text already names the cause. Drop. |
| Mod test harness: register `on()` stubs before first `$`; throwing stub = skipped hook | mods session | REFUTED | **Extension E1** (2 lines under checklist item 9). |
| Inventory count sweep misses `data-count` attrs, OG descriptions, diagrams, `og.png` | claude-skills site session | REFUTED | **Extension E7** (contribute step 3 + AGENTS.md line). |
| Pages site stale after merge: `pages.yml` is release-only | claude-skills session | REFUTED | Repo design choice, not a trap → **Owner decision F3**. |
| CSS `--accent:var(--accent)` self-reference makes theme monochrome | site redesign | REFUTED | One-off authoring slip. Drop. |
| onnxruntime SIGABRT "mutex lock failed" on `process.exit()` with live session | make-motion audio | REFUTED | **Extension E4** (one troubleshooting row). |
| ffmpeg `amix` adopts first input's rate/layout → mono mix | make-motion audio | REFUTED | **Extension E4** (one gotcha line). |
| Playwright browser revision mismatch | 1 private session | REFUTED | Error banner names the fix. Drop. |
| Headless Chrome screenshot traps (500px clamp, OS colour scheme, autoplay hang) | memory note (1 witness) | REFUTED | Keep as memory note; optionally a 3-bullet `make-dashboard` reference. Drop for now. |

Memory notes evaluated: `worktree-guard-refuses-eval-paths` → E3;
`claude-skills-merge-needs-admin-bypass` → already in
`github-solo-branch-protection-codeowners`; `gateguard-write-retry`,
`subagent-commits-wrong-trailers`, `never-author-in-marketplace-clone`,
`ultracode-not-hook-settable`, `registry-parser-no-folded-scalars` →
machine/repo-local, stay as memory (the folded-scalar rule lands in U-learn-lesson).

---

## B. Extensions (fold into existing skills; descriptions byte-identical)

| # | Target skill | Addition |
|---|---|---|
| **E1** | `core-workflow:claude-mod-store-race-host-rules-checklist` | New checklist items: (10) hooks see events from **every origin** — gate per-turn resets on `e.turnId === undefined` (peer/notification/plugin submits arrive mid-turn with a `turnId`), skip per-session state refresh (branch/cwd/worktree) when `e.agentId !== undefined` but still count subagent artifacts; (11) `Button` children must be `Text` nodes; (12) wrap render-path store reads in try/catch defaulting to empty. Under item 9: register every `on()` stub **before the first `$` call** and never re-register an event the world fixture owns; a throwing stub is treated as a *skipped* hook, so inject failure with `return { deny: '…' }`. Evidence: test-board/mods sessions `e9097288`, `e7e9ebab`. |
| **E2** | same skill | Symptom bullet with the exact error `tool.call step resolved … with a result that does not match its output shape … expected string \| array \| undefined, received object`; checklist line after item 8: a handler registered with `$.tool.register` returns a **string or content-block array**, never `{ result: … }`. Evidence: PR #31 / `0dd4698`. |
| **E3** | `core-workflow:worktree-isolation-guard-refuses-complex-bash` | Triggers line gains: a path or `cd` into a directory **named `eval`** ("runs a string through eval"); a `$VAR`/computed path as a node/python argument; a `cat > f <<EOF … && python3 …` heredoc chain ("too complex to verify"). Fix: literal absolute paths, no `cd`/`&&`, write scripts with the Write tool, `node --test "plugins/<pkg>/ev[a]l/…"` glob. State plainly the pattern match is text-based and inconsistent. Also redact `doc-scan` at line 49 (see F1). |
| **E4** | `portable-artifacts:make-motion` | Voiceover/audio troubleshooting rows: voice CLI exit 134 / `mutex lock failed` → dispose the ORT session and set `process.exitCode`, never `process.exit()`; long narration → `tts.stream()` per sentence and pass text via `--text-file`; `amix` takes the **first input's** rate/layout → `aformat=sample_rates=48000:channel_layouts=stereo` per track and pin `-ac 2`. |
| **E5** | `portable-artifacts:make-dashboard` | `references/sql-sandbox.md` linked from the Security paragraph: the DuckDB bypass catalogue (`query()`/`query_table()` carrying inner SQL, bridge extensions ignoring `enable_external_access`, system views as tables, CTE shadowing `duckdb_databases`), one line per vector + the test that pins it. One sentence: the validator is **not** the offline guarantee; CSP + request abort are. Check whether `serve.mjs` has the `allowedHosts` 403 check `make-motion`'s server has; add if not. |
| **E6** | `portable-artifacts:make-motion` | Same one-sentence "validator is not the offline guarantee" note next to the existing `guardNetwork()` mention. |
| **E7** | `core-workflow:contribute` (step 3) + `AGENTS.md` "Inventory counts" bullet | Sweep multiple shapes: word forms (`five`/`5`), `data-(count\|to\|target)="N"` attributes, meta/OG descriptions, diagram node lists, "each/every/deep-dive" prose; regenerate `site/og.png` from `og.html`. Evidence: session `7320d1d4` needed three fix rounds after a sweep reported 0 hits. |

---

## C. Updates (confirmed by both verifiers unless marked ◐ = contested, narrowed)

### C1. Content bugs — a reader copying the skill ships a defect

| Skill | Defect | Fix |
|---|---|---|
| `ios-dev:release` | Stage 0 puts the `.p8` in `~/.app-store-connect/`; Stage 6 and `scripts/release.sh:90,114` call `xcrun altool --apiKey` and nothing sets `API_PRIVATE_KEYS_DIR`, so validate/upload fail on a clean machine | `export API_PRIVATE_KEYS_DIR="${HOME}/.app-store-connect"` in `release.sh` before the first altool call and in the Stage 6 snippets; extend the recovery row at SKILL.md:250 |
| `ios-dev:release` | Stage 5 snippet (SKILL.md:167-182) uses undefined `APP_EXTENSION_IDENTIFIERS` / `asc_api_key`; SKILL.md:155 says `/ios-scaffold` creates the lane but `templates/Fastfile` is a bare `gym` | Define `api_key = app_store_connect_api_key(...)`, take extension ids from `targets.extensions`, or replace the inline Ruby with "Read `fastlane-archive-multi-target-signing` before editing the archive lane" |
| `ios-dev:release` ◐ | SKILL.md:136 `xcodebuild test … 2>&1 \| tail -40` loses the exit status (no `pipefail`) | Drop the pipe or prefix `set -o pipefail;`; keep "surface last 40 lines on failure" as prose. Leave `iPhone 17 Pro` alone. |
| `ios-dev:ios-scaffold` | `templates/Fastfile` archive lane contradicts `release` Stage 5 and `fastlane-archive-multi-target-signing` (fails at cold start: no profile map) | Render the self-contained lane: `app_store_connect_api_key` from ENV, `get_provisioning_profile` loop over `APP_IDENTIFIER` + extension ids, manual `provisioningProfiles` map; bats test asserts `provisioningProfiles` in the rendered file |
| `ios-dev:pillow-favicon-set-no-rasterizer` | SKILL.md:63 resizes to 32×32 **before** saving the multi-size ICO; Pillow drops sizes larger than the source, so 48×48 silently vanishes (verified on Pillow 12.3) | `img.save("favicon.ico", sizes=[(16,16),(32,32),(48,48)])` from the 512 master; make the macOS-only font path (line 55) a parameter with `ImageFont.load_default(size=…)` fallback |
| `ios-dev:widget-appgroup-snapshot-bridge` | Writes use `.completeFileProtectionUnlessOpen` (SKILL.md:52, `references/snapshot-bridge.md:49`); a Lock Screen/StandBy widget cannot open the file while locked → the blank-widget symptom the skill targets | `.completeFileProtectionUntilFirstUserAuthentication`, with the trade-off noted |
| `core-workflow:github-repo-go-public-preflight-scan` | Step 3 says "anywhere in history" but runs plain `git grep` (working tree only); step 2 checks file **names** only — secret **content** committed and later removed is never scanned | Add `git log --all -p -G'<regex>'` (or `git rev-list --all \| xargs -n 50 git grep -nIE`) as a history-content step; relabel step 3 |
| `core-workflow:hook-merge-base-diff-command-regex-anchoring` | Sentinel snippet (SKILL.md:86-93) writes `$sentinel` on every call and checks a `$sentinel.acked` nothing creates — blocks every call | Real once-per-session flow: `[[ -f "$sentinel" ]] && exit 0` first, then create + block. Note regex misses `git -C … push`, `git --no-verify push`, `FOO=1 git push` |
| `core-workflow:declarative-hook-rules-inert-without-dispatcher` | Verification grep uses `~/.claude/plugins/*/hooks.json`, which matches nothing (real path: `~/.claude/plugins/cache/<mkt>/<plugin>/<ver>/hooks/hooks.json`) → always reports "no dispatcher" | `grep -rln '<rule-glob>' .claude/settings*.json ~/.claude/settings*.json ~/.claude/plugins --include=hooks.json` |
| `ios-dev:devicectl-crashlog-oslog-cli-diagnostics` | Headline command omits `--device <UDID>` and the bundle-id positional | `xcrun devicectl device process launch --device <UDID> --console <bundle-id> -- -com.apple.CoreData.CloudKitDebug 3 …` (check order against live `--help`); show the env-var form for `OS_ACTIVITY_DT_MODE` |
| `ios-dev:nonsendable-hardware-handle-inline-io` | CoreNFC snippet (SKILL.md:51-55) uses the NDEF delegate selector on `NFCTagReaderSessionDelegate`, calls `readNDEF` on the `NFCTag` enum, force-unwraps `tags.first!` | `tagReaderSession(_:didDetect:)`, `guard let`, switch on the `NFCTag` case to get the `NFCNDEFTag`-conforming value |
| `ios-dev:xcodebuild-plugin-macro-validation-per-invocation` + `xcode-cloud-post-clone-contract` | Both say to add `-skipPackagePluginValidation -skipMacroValidation` to `ci_post_clone.sh`'s "xcodebuild path"; the script has no xcodebuild call and hosted Xcode Cloud accepts no flags | Scope the machine-wide `defaults write` ban to developer/persistent Macs; add an explicit Xcode Cloud carve-out (ephemeral VM may use the `defaults write` in `ci_post_clone.sh`, or trust via workflow/fingerprint); fix both Related lines |
| `ios-dev:release-inapp-vs-asc-whatsnew-surfaces` + `release` SKILL.md:127-128 | "no upload lane can push What's New text" is wrong for App Store: `deliver` sets it from `fastlane/metadata/<locale>/release_notes.txt`; `pilot` has `changelog:` | Reword to "independent of the binary; set via deliver metadata / pilot changelog, or paste manually"; optionally feed `release.whatsnew_file` into the lanes |
| `ios-dev:github-pages-flat-deploy-subdir-404` | Prescribes "rewrites only touch top-level `_site/*.html` — by design" and `cp … 2>/dev/null \|\| true`; this repo's own `pages.yml` now rewrites recursively and subdir pages use `../../` links | Make the recursive `find _site -name '*.html' -print0 \| xargs -0 sed -i` rewrite + explicit `mkdir`/`cp -r` per subdir the primary fix; demote self-contained pages to an alternative; drop `\|\| true` or follow with a failing MISSING-href check |
| `ios-dev:legal-pages-css-scoping-bleed` ◐ | Bug 2 symptom lists "a page's own nav is missing its own link", yet the CORRECT `renderNav` (SKILL.md:100-105) still filters the current page out | Either render all links with `aria-current="page"`, or keep self-omit and reword the symptom so it means "the wrong link was omitted; centralize + test per page" |
| `ios-dev:swiftui-tabbar-swipe-nav-tradeoff` ◐ | `Task.yield()` two-tick guard labelled CORRECT (SKILL.md:99-106) but Evidence says mitigations were only "on the table" | Relabel "proposed — unverified on device"; note `Task.yield` is one cooperative yield, not a guaranteed second tick |
| `ios-dev:vision-barcode-cidetector-fallback` ◐ | Fallback is `CIDetectorTypeQRCode` only while description/symptom say "QR/barcode"; low-contrast and memory-pressure claims unverified | State QR-only, name options for 1D/other 2D (AVCaptureMetadataOutput on device); soften or drop the unverified claims. Body only. |

### C2. Doc ↔ code drift

| Skill | Drift | Fix |
|---|---|---|
| `core-workflow:learn-lesson` + `core-workflow:contribute` | Step 4 hand-off does not match `setup/contribute.sh`: `--skill` only scaffolds a placeholder, fails on a dirty tree (`contribute.sh:35-39`) and on an existing dir (`:61`); plain `--message` is the manifest-capture path (`capture.sh:13-14`), not "commit my edit" | Rewrite step 4: run `claude-skills-contribute --skill <name> --plugin <p>` **first** on a clean tree, overwrite the scaffold, commit + PR on that branch; for extensions, branch manually and `gh pr create`. In `contribute`, document `--plugin` (default `core-workflow`), say `--skill` writes `templates/skill.md.example`, and warn that capture mode copies home dotfiles + rewrites `claude-setup.toml` (review for secrets/private names) |
| `core-workflow:learn-lesson` | Step 3 template wraps `description:` across two physical lines (SKILL.md:36-37); `registry_lib.parse_frontmatter` truncates folded/wrapped values to `">-"` | One-line template + hard rule "description on one physical line, no `>-`/`\|`". Add a "vs `ecc:learn`" line: this skill publishes to the shared catalog via PR; `ecc:learn` is for local patterns |
| `ios-dev:app-preview` | Gotchas say to write `~/.claude/skills/app-preview/.imessage-to`; `deliver.sh:50,100` reads `$IMESSAGE_TO` first, then `$SCRIPT_DIR/../.imessage-to` (inside the plugin cache, wiped on update); `IMESSAGE_TO` is never documented | Document `IMESSAGE_TO` as primary; fix the path text at SKILL.md:82 and :244 |
| `ios-dev:ios-build` ◐ | SKILL.md documents the app's `./build.sh` (`-s`, `-d`, `--debug`, default iPhone 15 Pro Max) and never names the bundled `scripts/build.sh`, which takes only `sim\|device`, forwards nothing, hard-codes iPhone 16 and does no install | Add a "Fallback" note describing the bundled wrapper's real limits. Body only. |
| `linear-pm` | SKILL.md:8 says commands live at `.claude/commands/linear-*.md`; they ship at `plugins/linear-pm/commands/` and resolve via `${CLAUDE_PLUGIN_ROOT}`; README L5/L12/L44/L60/L152-154 carry project-local-era paths and origin-app specifics | Point at the plugin paths; `${CLAUDE_PLUGIN_ROOT}/skills/linear-pm/scripts/bootstrap.sh` with the project-local copy as fallback. ◐ Also reword "the polling agent" (SKILL.md:130-131,141; `linear-pick.md:2,49`) to "an external scheduler (not shipped)"; replace `ABH-6` with `TEAM-123` |
| `second-wind` | SKILL.md:75 says `auto` is the shipped default; true for `wind init --defaults` (`wind.py:1553`) but the wizard labels `acceptEdits` "(overnight default)" (`wind.py:406`) | "auto is the default for `--defaults` starter configs; the wizard suggests acceptEdits". ◐ Add that the preset is **full bypass** (`bypassPermissions`), not Claude Code's classifier-gated `auto` mode |
| `prompt-craft:structured-output-adaptive-thinking-token-bloat` | Body pins retired model generations (`Sonnet 4.6`, `Opus 4.8`, literal `"claude-opus-4-8"` at :52); "~5x" is derived from a comparison that changed **both** model and thinking ($0.39 Sonnet-on vs $0.12 Opus-off = 3.25×) | Replace the literal model id with a config placeholder; date-stamp the figures as observations; state the ratio honestly and that the comparison is confounded; remove "cheaper per-token model input" (:68). Re-verify "omit `thinking`" on current models via the `claude-api` reference before generalizing. Description's "~5x" stays until an eval-gated pass |
| `ios-dev:swift6-mainactor-compile-fixes` | Body now covers a third diagnostic (WidgetKit `TimelineProvider` crossing, lines 81-90) but the description says "Two diagnostics"; Hard rule bans `@unchecked Sendable`/`nonisolated(unsafe)`/`@preconcurrency` without scoping | **Ship now (body):** scope the hard rule to pure-compute value types and point to `avfoundation-capture-delivery-watchdog` / `nonsendable-hardware-handle-inline-io` where the escape hatches are legitimate; add one line on `@concurrent` vs `nonisolated async` under SE-0461. **Gate (Phase 4):** description tighten < ~800 chars keeping both literal diagnostics + a short TimelineProvider phrase |

### C3. Shape and hygiene (body-only)

| Skill | Edit |
|---|---|
| `ios-dev:fastlane-archive-multi-target-signing` | Delete the unrelated "Related note — verify the rendered version before archiving" section (lines 113-122 / 119-128); add `## Evidence` and `## Related skills` (`release`, `xcode-cloud-validate`); `<App>Widget.appex` placeholder; drop or mark done the `promotion_target` line |
| `core-workflow:launchd-git-automation-self-heal` | Second lesson appended at SKILL.md:88-124 (unattended `claude -p`: OAuth expiry, false "auto-merge queued", live-checkout hygiene) has its own Symptoms/Fix/Evidence/Related → split into its own skill (e.g. `unattended-claude-p-launchd-auth-status-truthfulness`) with cross-links; description back under ~800. Redact project names first as its own commit (F1) |
| `core-workflow:github-repo-go-public-preflight-scan` ↔ `github-solo-branch-protection-codeowners` | Bidirectional one-line `## Related skills` entries (both fire on the go-public moment and are complementary) |
| `ios-dev:xcodegen-test-targets` | Add `## Related skills` (`swiftdata-inmemory-test-harness`, `swift6-mainactor-compile-fixes`, `xcode-cloud-post-clone-contract`); replace hard-coded `iPhone 16 Pro` (line 61) with `name=<installed iPhone sim>` + `xcrun simctl list devices available` |
| `ios-dev:xcode-cloud-validate` ◐ | Add `## Related skills` (`xcode-cloud-post-clone-contract` reciprocal, `release` Stage 6 same `altool --validate-app`). altool is **not** deprecated (verified: altool 27.0.5 still lists `--validate-app`) — no deprecation note |
| `ios-dev:swiftdata-cloudkit-production-schema` ◐ | Add `## Related skills` (`swiftdata-cloudkit-model-rules`, `devicectl-crashlog-oslog-cli-diagnostics`, `release`); shorten rule 6 to a pointer to the devicectl skill. **Keep `promotion_target`** (the 2026-07-18 upstreaming spec preserves it) |
| `ios-dev:swiftdata-cloudkit-model-rules` ◐ | "four rule groups" → five at SKILL.md:32 and :138; optionally move rule 5's snippet to `references/` |
| `ios-dev:biometric-applock` ◐ | Add `## Related skills` (`deep-link-resolver-applock-pathtraversal`, `widget-appgroup-snapshot-bridge`) so the existing one-way links become mutual; pitfall 4 says "gate = drop, never defer" and points at the resolver skill |
| `ios-dev:ios-photo-sidecar-store` ◐ | Add `## Related skills`; replace "the swift-concurrency rules" (user's private global rules file) with a named repo skill |
| `ios-dev:siri-app-intents-ios26-reliability` ◐ | Add `## Related skills` (`shared-action-overload-callsite-audit`, `deep-link-resolver-applock-pathtraversal`); replace opaque `(s0044)` evidence with a portable description |
| `ios-dev:site-og-favicon-verify` ◐ | Add `pillow-favicon-set-no-rasterizer` to Related (the audit plan claims the pair is mutually linked; the back-link is missing); heading `## Related` → `## Related skills` |
| `ios-dev:demo-recording`, `inapp-whatsnew-popup-and-about-buildinfo`, `xcode-cloud-post-clone-contract` | Heading `## Related` → `## Related skills` (51 skills use the long form, 5 the short) |
| `ios-dev:ondevice-model-eval-harness-kill-criteria` ◐ | `## Solution` → `## Fix`; fold `## When to Use` into the body tail |
| `ios-dev:realityview-fullscreencover-black-defer-mount` ◐ | Related entry names `swiftui-pushed-list-tabbar-scroll-clearance` directly instead of "that skill's pushed-scroll-clearance sibling" |
| `ios-dev:background-assets-manifest-drift-blind-redownload` ◐ | Typo `undocumented-feels` (line 24); add Related back-link to `background-assets-apple-hosted-packs` |
| `ios-dev:inapp-whatsnew-popup-and-about-buildinfo` ◐ | Delete only the trailing description clause `…that otherwise means "go look at <private app>"` (zero trigger value, private name) |
| `ios-dev:release-inapp-vs-asc-whatsnew-surfaces` ◐ | Description trigger "adding a ChangelogEntry/FeatureCatalog-style in-app data file" → "when an in-app changelog already exists and a release is being prepared" (the build-the-popup request belongs to `inapp-whatsnew-…`) — **eval-gated** (description edit) |
| `core-workflow:blast-radius-rm-hold-unattended-subagent-stall` | Indent line 31 (`# (or use the session scratch dir)`) so the list-nested fence does not break; redact `foundry` (F1) |
| `core-workflow:subagent-report-truncation-delivery-contract` | Evidence line 60: "two private iOS app sessions `52367698` and `9e25d11a`"; note `core-workflow:team` is the `/team` command |
| `core-workflow:commit` | Line 41: replace the private `.xcodeproj` name and `.dev-team` with "generated project files, `build/`, `.tmp/`, anything gitignored"; line 8: drop "shell+Swift"; line 24: replace "No attribution trailer — disabled globally via settings.json" (false; AGENTS.md requires `Co-Authored-By`) with "add whatever attribution trailer the repo/harness requires"; line 46 + description ◐: "need explicit confirmation" conflicts with the standing push authorization — body line only |
| `core-workflow:dev-tracker-portable` | Description: delete the "Upstream: <app>'s `.claude/skills/tracker/SKILL.md` (…) — mirror structural changes both ways" clause (meaningless to any other user); keep every trigger phrase. ◐ Whether to also remove the app *name* is F1 |
| `ios-dev:mainactor-launch-watchdog-audit` ◐ | One body line: under `SWIFT_APPROACHABLE_CONCURRENCY` a plain `nonisolated async` fn runs on the caller's actor — mark the worker `@concurrent`; pointer to `swift6-mainactor-compile-fixes`. Do **not** unify the preflight `HEAVY_PAT` with the skill's grep (preflight is an intentionally narrower WARN heuristic) |
| `ios-dev:async-enrichment-silent-loss-outcome-states`, `avfoundation-capture-delivery-watchdog`, `shared-resource-per-owner-scoping` ◐ | Compress + genericize the Evidence sections (3–4 lines). No description edits, no split, no new `references/` |

### C4. Reference delegation (Lever 1)

`ios-dev:inapp-whatsnew-popup-and-about-buildinfo` — 553 body lines, 349 code, no
`references/`, the largest Lever-1 violation in the catalog (the audit plan's
fat-skill table topped out at 176). Keep in SKILL.md: the JSON-vs-hardcoded
decision, the gate rules currently buried in the Gotchas (seed on fresh
install, downgrade never clobbers `lastSeenVersion`, gate on marketing version
only, `BuildInfo.swift` gitignored), and a ~5-line decider signature. Move
A1–A7 → `references/whatsnew-gate.md`, B1–B2 → `references/about-buildinfo.md`,
the hardcoded-Swift variant → `references/`. Promote rules out of code comments
into prose **before** demoting the code; imperative "Read `references/…`
before implementing" pointers. Private app names appear at lines 3, 16, 25,
82, 303 and the A7 heading, not only in "Canonical references" (F1).

Refuted delegations (do not do): `release` (plan: driver skills' structure is
do-not-touch; at most replace the duplicated ExportOptions heredoc at
SKILL.md:198-206 with a pointer to `scripts/release.sh:60-69`);
`shared-resource-per-owner-scoping` (20% code, Lever 1 targets 40–53%);
`linear-pm` session-rename section (plan: light touch).

---

## D. Merges

### D1. `sheet-in-sheet-present-bridge-generalization` → `swiftui-sheet-in-sheet-uikit-present-bridge` (3 independent reviewers, both verifiers each time)

The 27-line delta note carries its own `promotion_target` ("fold into … delete
this file on promotion"), has no Symptom/Root cause/Evidence sections, and its
description is a strict superset of the parent's ("Use alongside …"), so both
fire on "share sheet / document picker flashes and self-dismisses from a
sheet". This is the plan's discriminator (genuine trigger competition) met.
Note it **reverses** the 2026-07-18 cubby-upstreaming spec's "do NOT fold any
delta-skill in this batch" — that was a batch-scoping rule, not a design
decision, but say so in the PR.

Execution, bound to the plan's guardrails:
1. Add labeled prompts to `tests/fixtures/intent-router/labeled-prompts.json`
   for camera picker, QuickLook, mail composer, share sheet and doc-picker
   flashes **before** the merge, so `route_spike.py` gates the widened
   description.
2. Widen the parent description to name `UIImagePickerController`,
   `QLPreviewController`, `MFMailComposeViewController`,
   `UIActivityViewController`, `UIDocumentPickerViewController`, plus
   "dismisses its PARENT sheet" / "never appears"; keep the parent's literal
   share-sheet text; stay inside the char budget. Add a "Generalization"
   section with the "it is a CLASS of bug" rule and the review heuristic.
3. Delete the generalization dir; sweep parent line 92,
   `docs/skills-catalog.md:70`, `docs/catalog.html`,
   `docs/features/ios-dev.html`; leave `docs/superpowers/` history alone.
4. Counts: ios-dev 60 → 59, total 88 → 87; `plugin.json` version bump.

### D2. Refuted merges (keep separate)

- `fastlane-archive-multi-target-signing` → `release`: no trigger competition
  (`release` triggers on verbs, the lesson on the export error string); the
  lesson's `promotion_target` is already executed in `release` Stage 5 →
  mark it done and add a Related link (C3).
- `background-assets-apple-hosted-packs` → `…manifest-drift-blind-redownload`:
  disjoint symptoms (manifest/version drift vs on-device extraction /
  TestFlight channel); packaging gotchas (dotfiles in `ba-package`, altool
  wait-flag hang) exist only in the delta. Add the missing back-link (C3).

---

## E. Deletions — none

The dominance reviewer proposed deleting `prompt-craft` `plan`, `review` and
`debug` as restated by built-in plan mode / `/code-review` / installed
`superpowers:systematic-debugging`. Both verifiers refuted each:

- `plan` and `review` carry `disable-model-invocation: true` — they never
  auto-route, so there is no trigger competition; cost is one catalog line.
  `registry-notes.toml` already maps them to `/ecc:plan` and `/code-review`
  as preferred alternatives. Deleting `review` also breaks
  `advisor.py:19/43` and its tests.
- `debug` auto-invokes **by design** (README line 13, catalog row); disabling
  it removes its whole trigger surface; public consumers may not have
  `superpowers`. No eval shows mis-routing.
- Optional, body-only: one pointer line in each ("for deep root-cause work
  prefer `superpowers:systematic-debugging` if installed"; "if the ask is
  vague, run `/improve-prompt` first").

Also refuted: `parallel-ios-agent-fixes-single-sim` RENAME ("single-sim" names
the project context — the H1 says so — not a one-simulator mode).

---

## F. Owner decisions (cross-cutting, not per-skill)

1. **Private project names in a public repo.** Reviewers flagged "redact
   `cubby` / `doc-scan` / `Paperix` / `foundry` / `floorprint` / `sift`" in
   ~20 skills. But `Cubby` is *deliberately* public: it appears in AGENTS.md
   lines 14–17, the site, commit subjects and ~90 tracked files (38 skill
   `.md` files alone); the other names are in 33 skill files. Per-skill
   redaction is inconsistent churn. **Decide once:** (a) names are fine →
   drop every redaction item above; (b) scrub → one scripted sweep over
   `plugins/` (skills, `references/`, scripts, templates) replacing names
   with "a private iOS app" / "a private web project", keep commit SHAs and
   session ids, add a bats grep guard, and leave `docs/superpowers/` history
   untouched. PR #28's own convention (anonymize private projects) argues
   for (b) for everything except `Cubby`.
2. **Description budget.** 13 descriptions exceed ~800 chars (`app-preview`
   1712, `async-enrichment` 1381, `avfoundation` 1271, `swift6` 1022,
   `launchd` 1018, `swiftdata-cloudkit-model-rules` 996, …). The audit plan
   makes description tightening the eval-gated Phase 4 (route-spike floor +
   `skill-creator` trigger eval); the only hard cap in the repo is 1024 chars,
   enforced for the portable-artifacts skills by
   `plugins/portable-artifacts/bin/test/frontmatter.test.mjs:29`. Nothing here
   rewrites a description outside D1, the two ◐ items marked eval-gated, and
   the `dev-tracker-portable` / `inapp-whatsnew` clause deletions (pure
   removals of non-trigger text). **Decide:** run Phase 4 now for the top
   three, or leave for a dedicated pass.
3. **`pages.yml` is release-only.** Merged PRs #22, #23, #25, #28 never
   deployed until a manual `gh workflow run pages.yml --ref main`
   (session `cfbb5d9c`). AGENTS.md line 31–32 says `pages.yml deploys the
   site from docs/ and site/`, which reads as on-merge. **Decide:** add
   `push: branches: [main]` with `paths: [site/**, docs/**]`, or fix the
   AGENTS.md wording to "on published release or manual dispatch".
4. **Count-sweep script.** `contribute` step 3 says hand-edit seven files;
   AGENTS.md says "one scripted sweep, never hand-edit"; no sweep script
   exists in `scripts/`. One source of truth: land the script (audit plan
   Phase 3) and point step 3 at it, or relax AGENTS.md.
5. **User-level skills that duplicate or could join the repo** (report only,
   outside repo scope): `~/.claude/skills/realitykit-windowed-view-ios-gotchas`
   duplicates `realityview-fullscreencover-black-defer-mount` (already
   archived in `archive/learned-skills/`) and can be removed locally;
   `~/.agents/skills/design-router` is user-authored (global CLAUDE.md calls
   it "our" router, 6 invocations in the window) and is the only personal
   skill with a case for promotion to a plugin — but its routing table is
   machine-specific (names a dozen installed third-party skills), so it
   would need a portable form first.

---

## G. Reviewed and kept as-is (53 KEEP findings)

Every one of the 88 skills was read by at least one reviewer; 127 skill-reads
in total. Explicit KEEP verdicts with no action: `xcode-license-blocks-git-exit-69`,
`field-log-duration-clustering-race-diagnosis`, `file-handoff-inbox-backstop`,
`diagnostic-export-error-redaction-boundary`, `scan-crash-recovery-store`,
`ml-actor-lazy-load-graded-eviction`, `mainactor-runtime-isolation-trap`,
`navigationsplitview-single-stack-per-detail-column`,
`pasteboard-universal-clipboard-egress`, `query-derived-typeahead-vocabulary`,
`scan-capture-quality-gates`, `shared-action-overload-callsite-audit`,
`swiftui-pushed-list-tabbar-scroll-clearance`, `site-pages-deploy-kit` (scripts
match docs), `swiftdata-inmemory-test-harness`,
`swiftdata-predicate-optional-coalesce-contains-trap`, `refresh` (scripts
match), `make-dashboard` / `make-motion` (flags match scripts),
`branch-explainer`, `improve-prompt` (its `improve this prompt` trigger is
pinned by `labeled-prompts.json:7` — do not drop it), `refactor` (keep
model-invocable; the premise "siblings are manual" is false).

Trigger-overlap clusters re-checked and left alone with no new evidence:
MainActor family; vision/scan pipeline; SwiftData pair; site-deploy trio;
favicon pair (descriptions have not drifted toward each other); the four
"subagent stalls" core-workflow skills (disjoint literal triggers); the two
Xcode Cloud skills (already split by stage); on-device AI output trio.

---

## H. Execution plan (if approved)

| Phase | Work | Mode / tier / effort | Gate |
|---|---|---|---|
| **0 — Decide** | F1–F4 answered by the owner | — | — |
| **1 — Bug fixes** (C1) | 17 body-only edits + `templates/Fastfile` + `release.sh` export; each its own commit; bats for Fastfile rendering | Workflow fan-out, executor (Sonnet) medium–high; one reviewer pass (Opus medium, report-everything) | `bats tests/bats`, `pytest`, descriptions byte-identical (`git diff` on line 3 of every touched SKILL.md) |
| **2 — Drift + hygiene** (C2, C3, B) | learn-lesson/contribute rewrite, linear-pm paths, Related-skills additions, extensions E1–E7, launchd split (new skill dir + cross-ref sweep) | same | same + `test_route_spike.py` |
| **3 — Delegation + merge** (C4, D1) | inapp-whatsnew references; sheet-in-sheet fold with labeled prompts first | executor edits; judging planner (Fable) high | route-spike no regression; description byte-identical for C4 |
| **4 — Counts + site** | one scripted sweep (ios-dev 59 / total 87 after D1; +1 core-workflow if launchd splits) across `docs/`, `site/`, READMEs, manifests, `og.png`; version bumps | chore (Haiku) low | CI green; staged-site link check |
| **5 — Description pass** (F2) | only if approved: top-3 descriptions + the two eval-gated ◐ items | planner high for judging, executor for edits | route-spike + `skill-creator` eval, no regression |

Commit authorization follows AGENTS.md: feature branch, atomic commits, PR,
CI green, `--squash` on the owner's explicit merge ask.
