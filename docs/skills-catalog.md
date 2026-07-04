# Skills & Tools Catalog

> Visual version: [searchable catalog](catalog.html) (open in a browser)

Five plugins, one CLI, one adapter script. Install only what you need:

```
/plugin marketplace add abhijitbansal/claude-skills
```

## ios-dev (plugin)

The iOS app lifecycle: build, screenshot, deliver to your phone, ship to the App Store,
standardize the repo, deploy the marketing site — plus a knowledge-skill catalog mined
from real portfolio bugs. Needs `.claude/app.yml` (schema v2) in the target app repo — `/ios-init` writes it.

| Name | Kind | What it does |
| --- | --- | --- |
| `app-preview` | skill | Builds the app on the booted simulator, launches it (optionally deep-linking), screenshots, and delivers the image to your iPhone — iMessage ping for the notification, iCloud Drive for the bytes. Output organized per git branch. |
| `ios-build` | skill | Builds for simulator or a connected device via `build.sh`, encoding signing and provisioning-profile detection rules. |
| `release` | skill | Code-complete → App Store Connect: gated pre-flight (compliance strings, entitlement parity, MainActor runtime-trap audit, whatsnew), version bump + `Release-Note:` trailer notes, Fastlane gym/pilot/deliver (xcodebuild+altool fallback), tag, site deploy. `testflight` / `appstore` modes; `--dry-run` stops before upload. |
| `ios-scaffold` | skill | Idempotent repo standardizer: marketing copy home, Fastfile/Gemfile, `ci_post_clone.sh`, release-hooks dir, architecture checklist, AGENTS.md skeleton. Creates missing, reports drift, never clobbers. |
| `site-pages-deploy-kit` | skill | The site standard (floorprint model): `site/` source in the app repo → split-repo public GitHub Pages, subtree force-push over an SSH deploy key, og/CSP/favicon lint, skeleton + runbook. |
| `xcode-cloud-post-clone-contract` | skill | The four-rule `ci_scripts/ci_post_clone.sh` contract (materialize gitignored .xcodeproj, mirror local generation, pin `Package.resolved`, brew-only) + the PR-check / tag-release workflow recipe. |
| `alternate-app-icons`, `biometric-applock`, `demo-recording`, `swift6-mainactor-migration`, `xcode-cloud-validate`, `xcodegen-test-targets` | skills | Focused how-to skills for their named features. |
| `mainactor-launch-watchdog-audit` | skill (mined) | Launch watchdog 0x8BADF00D SIGKILL + boot-loop from heavy work implicitly on MainActor; off-main idioms + idempotent-retry rule. |
| `mainactor-runtime-isolation-trap` | skill (mined) | `brk 1` on SwiftUI AsyncRenderer from @MainActor closures stored by UIKit (dynamic color/image providers); `.ips` diagnosis reflex + re-entrancy guards. |
| `swiftdata-cloudkit-model-rules` | skill (mined) | CloudKit-safe SwiftData: explicit `cloudKitDatabase`, throwing container factory + fallback, single-side inverse, reserved names, centralized schema. |
| `widget-appgroup-snapshot-bridge` | skill (mined) | App→widget snapshot DTO over an App Group, backfill-on-launch, transient-empty-clobber + App-Lock redaction invariants. |
| `file-handoff-inbox-backstop` | skill (mined) | Share/action-extension inbox with attempt-cap + quarantine so a poison item can't boot-loop the app. |
| `deep-link-resolver-applock-pathtraversal` | skill (mined) | One pure resolver for all URL entries; drop links under App-Lock; path-traversal validation. |
| `vision-layout-ocr-grounding` | skill (mined) | Ground on-device AI on Vision-layout text (never `PDFDocument.string`); versioned sidecar; verify on the cold path. |
| `ondevice-generable-anti-hallucination` | skill (mined) | Flat `@Generable` (nested hangs iOS 26), verbatim-quote pinning, context-window clipping. |
| `scan-crash-recovery-store` | skill (mined) | Persist RoomPlan/ARKit results before the hang-prone build step; decode-mismatch clearing; crash marker. |
| `scan-capture-quality-gates` | skill (mined) | Soft variance-of-Laplacian sharpness gate + scan auto-naming discipline. |
| `site-og-favicon-verify` | skill (mined) | Teams/iMessage unfurl rules: absolute og:image + true dimensions, self-hosted fonts + CSP, complete favicon set. |
| `avfoundation-capture-delivery-watchdog` | skill (mined) | Camera capture "gets stuck" with no error — delegate callback never fires after a session teardown/re-mount race; timeout watchdog. |
| `ios26-toolbar-leading-title-truncation` | skill (mined) | SwiftUI title in `ToolbarItem(.topBarLeading)` renders as a single letter + ellipsis on iOS 26 Liquid Glass. |
| `swiftdata-inmemory-test-harness` | skill (mined) | First SwiftData test in a target: avoids runner crashes, batch-delete "mandatory OTO nullify inverse" failures, cross-suite races. |
| `vision-barcode-cidetector-fallback` | skill (mined) | `VNDetectBarcodesRequest` returns nil for a valid barcode on Simulator — CIDetector fallback for reliable decode tests. |
| `nonisolated-struct-codable-mainactor` | skill (mined) | Synthesized `Decodable`/`Equatable` conformance is MainActor-isolated too — fix for stateless structs decoded off-main. |
| `swiftui-tabbar-swipe-nav-tradeoff` | skill (mined) | `TabView` labeled-bar vs swipe-between-tabs tradeoff, and the custom-pager race with deep-link/NFC/Siri tab routing. |
| `query-derived-typeahead-vocabulary` | skill (mined) | Type-ahead suggestion chips derived from the persistent store instead of a stale hardcoded list; shared, testable filtering. |
| `github-pages-flat-deploy-subdir-404` | skill (mined) | Flat `cp docs/*.html _site/` deploy model: subdirectory doc pages 404 live despite a green CI build. |
| `pillow-favicon-set-no-rasterizer` | skill (mined) | Generate a raster favicon set from a simple SVG mark with Pillow when no SVG rasterizer is available. |
| `legal-pages-css-scoping-bleed` | skill (mined) | Privacy/support/legal pages break from shared-stylesheet hero bleed and hand-duplicated nav/footer drift. |
| `parallel-ios-agent-fixes-single-sim` | skill (mined) | Fan out subagents to fix independent findings/tasks in an iOS repo without stomping the tree or racing one simulator. |
| `/ios-init` | command | Scaffold or `--migrate` `.claude/app.yml` (schema v2) — detects scheme/bundle/team/extensions, interviews for the rest, validates. |
| `/ios-scaffold` | command | Run the repo standardizer and walk DRIFTs one by one. |
| `/release` | command | `testflight` / `appstore` (`--dry-run`) — the release skill, staged, stopping at every FAIL gate. |
| `/site` | command | `create` / `deploy` / `verify` the marketing site per the standard. |
| `/preview` | command | One-shot build + launch + screenshot + deliver, with deep-link and `--no-build` options. |
| `/fix` | command | Tight UI-bug loop: apply a focused Swift fix, rebuild, screenshot, deliver proof to your phone. |
| `app-build-reminder` | hook | Stop hook — reminds the agent to run the build when Swift files are dirty before declaring done. |

## linear-pm (plugin)

Linear conventions an agent can execute: label vocabulary, status taxonomy, per-repo policy in `.claude/linear.yml`.

| Name | Kind | What it does |
| --- | --- | --- |
| `linear-pm` | skill | The conventions layer: `agent-ready`/`agent-blocked`/`needs-spec` labels, branch and PR naming, issue template, session-rename protocol. |
| `/linear-init` | command | Bootstrap a repo: write `.claude/linear.yml`, create the standard labels. |
| `/linear-new` | command | File an issue using the Why / What / Acceptance-criteria template. |
| `/linear-pick` | command | The autonomous loop: fetch issue → validate → branch → implement → verify → PR → update Linear. Refuses to write code unless repo policy allows autonomy. |
| `/linear-status` | command | Where everything stands, per the status taxonomy. |
| `/linear-sync` | command | Reconcile Linear state with repo reality. |
| `/linear-block` | command | Mark an issue `agent-blocked` with a reason comment. |

## core-workflow (plugin)

The everyday glue, useful in any repo.

| Name | Kind | What it does |
| --- | --- | --- |
| `commit` | skill | Stage, shellcheck-lint shell scripts, write a single conventional commit generated from the diff. Local only — never pushes uninvited. |
| `contribute` | skill | Send improvements back to this repo from any working directory: branches, validates with the test suite, opens a PR. |
| `learn-lesson` | skill | Capture a session lesson (symptom → root cause → fix → evidence) into the skills catalog: dedupes against existing skills, extends or creates, hands off to `contribute` for the PR. |
| `/learn` | command | Invoke lesson capture from any repo — reports the dedupe verdict and PR URL. |
| `branch-explainer` | skill | Generate a self-contained HTML explainer for the current branch/PR: what's implemented, an architecture diagram, key files, test evidence, next steps — scoped to one branch rather than the whole repo. |
| `github-repo-go-public-preflight-scan` | skill | Scan working tree AND full git history for secrets before flipping a GitHub repo private → public. |
| `github-solo-branch-protection-codeowners` | skill | Branch protection on a solo-owner repo: others' PRs need approval, owner can still self-merge. |
| `/explain-branch` | command | Invoke the branch explainer, diffing against a given base (default `main`); writes to `.scratch/branch-explainer/` and delivers it. |
| `/team` | command | Multi-agent team orchestration helper. |
| `/contribute-skill` | command | Scaffold a new skill into a plugin and open the PR (`--plugin` picks the destination). |
| `image-parser` | agent | Vision subagent: OCR, screenshot comparison, "is the title cut off?" checks. |
| `web-researcher` | agent | Docs/API lookup subagent: tight synthesis with sources, not raw page dumps. |
| `shellcheck-on-edit` | hook | PostToolUse hook — lints any `.sh` file the agent edits. |

## second-wind (plugin + CLI)

Claude Code pauses everything at the 5-hour usage limit. `wind` notices, waits, and resumes — including overnight.

| Name | Kind | What it does |
| --- | --- | --- |
| `wind` | CLI | Single-file, stdlib-only Python at `tools/second-wind/wind.py`. One tmux session per repo (`wind up`), a watcher that scans panes for the limit message (`wind watch`), one account-level reset clock, optional ntfy.sh notifications and macOS caffeinate. 16-test suite. |
| `second-wind` | skill | Teaches the agent `wind init/add/up/watch/status/resume/down`, the config keys (incl. `scan_roots` and the `auto`/full-auto default preset), `wind add` for pulling in a repo without re-init, and how to self-install `wind` when missing from PATH. |

CLI install without the plugin:

```bash
curl -fsSL https://raw.githubusercontent.com/abhijitbansal/claude-skills/main/tools/second-wind/wind.py -o ~/.local/bin/wind
chmod +x ~/.local/bin/wind
```

## prompt-craft (plugin)

Sharpen the ask before the work, surface the right next step after it. Zero config; guardrail hooks off by default. A command advisor — ranking next commands by keyword relevance, your command-history frequency, and git-state context — powers the prompt hint, Stop-hook follow-ups, and statusline segment (all user-only; never fed to the model).

| Name | Kind | What it does |
| --- | --- | --- |
| `improve-prompt` | skill | Rough ask → deterministic spec: restated goal, acceptance criteria, assumptions to confirm, recommended commands. High effort/model; stops before doing the work. |
| `plan` | skill | Decompose a task → goals + per-step acceptance criteria → a TodoWrite plan. |
| `debug` | skill (lens) | Reproduce → isolate → one hypothesis → failing test → fix. Auto-invokes on bug reports. |
| `refactor` | skill (lens) | Behavior-preserving restructure, guarded by tests green before and after. |
| `review` | skill (lens) | Diff/branch review: correctness + security first, then quality, by severity. |
| `refresh` | skill | Rebuild `~/.claude/prompt-craft/registry.json` + `profile.json` on demand via `/prompt-craft:refresh`. Also wires the statusline. |
| `suggest_next` | hook (Stop) | After each turn, routes through the advisor to suggest follow-up commands from git state. Silent on no match. |
| `prompt_hint` | hook (UserPromptSubmit) | Before each prompt, surfaces the top advisor recommendation as a user-only `systemMessage`. Never feeds the model. |
| `registry_freshness` | hook (SessionStart) | On session start, rebuilds the registry when stale (repo change, signature change, or Claude version change). |
| `statusline_hint` | hook (statusLine) | Live `💡 next: /x` statusline segment; chains to your existing statusline command. Wire with `wire_statusline.py --wire`. |
| `block_secrets` | hook (PreToolUse, opt-in) | Blocks reads/edits of secret-looking files. Enable via `PROMPT_CRAFT_BLOCK_SECRETS=1`. |
| `format_on_edit` | hook (PostToolUse, opt-in) | Formats edited files with the installed formatter. Enable via `PROMPT_CRAFT_FORMAT_ON_EDIT=1`. |

## adapters (multi-tool)

SKILL.md is tool-agnostic — one script wires the same skills everywhere.

| Mode | Target | What it does |
| --- | --- | --- |
| `codex` | `~/.codex/skills` | Symlinks every plugin skill. Skips cleanly if Codex isn't installed; `CODEX_SKILLS_DIR` overrides. |
| `copilot` | `~/.copilot/skills` | Same for Copilot CLI; `COPILOT_SKILLS_DIR` overrides. |
| `agents-md` | any `AGENTS.md` | Maintains a marker-delimited index block — every skill's name, description, and path — for Hermes and anything AGENTS.md-aware. Idempotent. |
| `all` | everything above | All three modes; prunes links it created for removed skills. |
