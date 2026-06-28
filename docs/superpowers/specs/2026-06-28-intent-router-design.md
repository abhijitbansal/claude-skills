# claude-skills: `intent-router` — configurable intent-routing + prompt-improvement framework

**Date:** 2026-06-28
**Status:** Proposed (RFC — awaiting sign-off)
**Epic:** [ABH-43](https://linear.app/abhijitbansal/issue/ABH-43) · sub-issues [ABH-44](https://linear.app/abhijitbansal/issue/ABH-44) (templates), [ABH-45](https://linear.app/abhijitbansal/issue/ABH-45) (router), [ABH-46](https://linear.app/abhijitbansal/issue/ABH-46) (capabilities), [ABH-47](https://linear.app/abhijitbansal/issue/ABH-47) (packaging)

## Context

Today this repo ships four plugins with **13 skills, 11 commands, 2 agents, 2 hooks** — and a
**hand-maintained** `docs/skills-catalog.md`. There is no `category:` field anywhere and nothing
that, given a user's request, surfaces *which* of those commands is the right one. As the command
count grows, two problems compound:

1. **Discovery.** A user (or Claude) has to already know a command exists to use it. Relevant
   capabilities go unused because nothing points at them at the moment of need.
2. **Determinism.** A vague prompt ("fix the thing") routes to whatever Claude improvises, instead
   of a known, well-shaped lens/command with a confirm-step.

This spec turns the fixed capability set into a **configurable, portable framework** that (a) lets
any repo declare its own intent→template→command mappings, (b) builds a **catalog** of everything
available and **heuristically injects the relevant commands** into the prompt at the moment of need,
(c) **improves the prompt** up front (deterministic spec, recommended commands) and **suggests
follow-up commands** at the end, and (d) bundles best-practice Claude Code capabilities so adopting
it raises the floor on *how* Claude Code is used. Distributed as a fifth plugin, `intent-router`.

The intended outcome: drop the plugin into any repo and, with zero config, get relevant
slash-commands surfaced on every prompt, a `/improve-prompt` that turns rough asks into deterministic
specs, and seven intent lenses — all overridable via one config file.

## Verified mechanics (vs. live docs, 2026-06-28)

These load-bearing facts were re-verified against `code.claude.com/docs` and drive the design:

- **`UserPromptSubmit` hook** injects `hookSpecificOutput.additionalContext` (or plain stdout) as
  context Claude acts on — it does **not** rewrite the prompt in place. 30s timeout. Exit 2 blocks.
- **Hook handler types**: `command` (shell, fast/free), `prompt` (cheap-model judge), `agent`
  (subagent w/ tools), plus `http`/`mcp_tool`; `async: true` / `asyncRewake` to background.
- **`Stop` hook** can inject `additionalContext` (follow-up suggestions) and optionally block-to-continue.
- **Skills == commands (merged).** `.claude/skills/<n>/SKILL.md` is both `/n` and auto-invoked via its
  `description`. Frontmatter: `name`, `description`, `disable-model-invocation`, `user-invocable`,
  `allowed-tools`, `model`, `effort`, `context: fork`, `agent`, `paths`. Plugin skills namespace as `/plugin:skill`.
- **Plugins bundle MCP** (`.mcp.json` / inline), hooks (`hooks/hooks.json` + `${CLAUDE_PLUGIN_ROOT}`),
  agents (`agents/*.md`), and skills — all auto-register on install. `SessionStart` hook available.

## Decisions

| Question | Decision |
| --- | --- |
| Scope | **Maximal** — advance all four sub-issues in one plugin, shipped behind opt-in flags where heavy |
| Plugin | New 5th plugin `intent-router` in the existing marketplace |
| Config format | **TOML** (`lenses.toml`, `router.toml`), stdlib `tomllib` read — matches `claude-setup.toml` |
| Lens generation | Generator emits `SKILL.md` inside managed markers; **generated files committed** (review-ability) + idempotent re-run |
| Category taxonomy | Shared default enum: `diagnose build modify review verify explain decide plan pm meta domain`; repos may **extend** (not redefine the core) |
| Catalog | Build-time `catalog.json` (machine) + regenerated human index. Never clobbers the hand-written `docs/skills-catalog.md` — writes a **managed block** (merge_guidelines.py marker pattern) |
| Router tiers | T0 native + **T1 deterministic hook ON** (surfaced); **T2 prompt-model opt-in** (flag); **T3 MCP** `route_intent` shipped, optional enable |
| Injection default | **On, surfaced to you** — hook injects `Relevant commands: /x, /y` Claude can mention; silent when nothing matches |
| Prompt improvement | **Both** — explicit `/improve-prompt` (high `effort`/`model`) **and** opt-in auto `UserPromptSubmit` prompt-hook (off by default) |
| Follow-ups | `Stop` hook suggests next commands, on + surfaced, silent when none |
| Freshness | `/rebuild-catalog` (manual) + `SessionStart` staleness rebuild (covers new-skill-installed) + documented CI step |
| Selection | T1 keyword/category heuristic; T3 adds optional embedding shortlist + model tiebreak; ambiguity → top-N or ask, **never silent misroute** |
| Distribution | marketplace entry; repo-scoped (`extraKnownMarketplaces`) + org-managed (`forcedPlugins`/`strictKnownMarketplaces`); **GHES caveat** documented |
| Capabilities v1 | 3 subagents (`reviewer`, `explorer`, `verifier`), `/plan` goal-setting, opt-in guardrails (secret/`.env` block, format-on-edit), statusline goal/context extension |
| Deps | Python 3.11+ **stdlib**; PEP 723 only where unavoidable (MCP SDK for T3 server; optional embedding index) |

## Target layout

```
plugins/intent-router/
├── .claude-plugin/plugin.json
├── .mcp.json                         # registers the Tier-3 router MCP server (optional enable)
├── lenses.toml                       # 7 default lenses + category taxonomy (repos override/extend)
├── router.toml                       # tiers on/off, score threshold, top-N, auto-improve flag, guardrail toggles
├── catalog.json                      # generated build artifact (committed for the bundled set)
├── skills/
│   ├── debug/SKILL.md   …  architecture/SKILL.md   # 7 GENERATED lenses (committed, managed markers)
│   ├── improve-prompt/SKILL.md       # high-effort prompt → deterministic spec + recommended commands
│   ├── plan/SKILL.md                 # goal-setting → acceptance criteria → TodoWrite plan
│   └── rebuild-catalog/SKILL.md      # user-invoked catalog refresh
├── agents/{reviewer,explorer,verifier}.md
├── hooks/
│   ├── hooks.json                    # UserPromptSubmit(route), Stop(suggest), SessionStart(freshness) + opt-in guardrails
│   ├── route_intent.sh               # T1 deterministic injector (surfaced)
│   ├── suggest_next.sh               # Stop follow-up suggester
│   ├── catalog_freshness.sh          # SessionStart staleness rebuild
│   ├── improve_prompt_auto.sh        # opt-in T2 auto prompt-improver wrapper
│   ├── block_secrets.sh              # opt-in PreToolUse guardrail (exit 2 on .env/secret read)
│   └── format_on_edit.sh             # opt-in PostToolUse formatter
├── mcp/router_server.py              # T3 MCP: route_intent / list_commands / describe_command
└── scripts/
    ├── build_catalog.py              # scan skills/commands/agents/plugins/MCP → catalog.json + human index
    ├── generate_lenses.py            # lenses.toml → SKILL.md (idempotent)
    └── router_lib.py                 # shared: load catalog, score prompt → ranked commands

tests/pytest/  test_build_catalog.py  test_generate_lenses.py  test_router_lib.py  test_router_server.py
tests/bats/    intent_router.bats     intent_router_hooks.bats
tests/fixtures/intent-router/  labeled-prompts.json  (~40 labeled prompts)  +  sample-repo/
docs/superpowers/plans/2026-06-28-intent-router-impl.md   # phased build plan (companion)
```

## Components

### 1. Intent-template framework (ABH-44)

- **`lenses.toml`** — `[meta] schema_version=1`, a `[taxonomy] categories=[…]` enum, and `[[lens]]`
  tables: `id`, `name`, `category`, `description` (the load-bearing auto-invoke trigger), `template`
  (triple-quoted body with `${PLACEHOLDER}`s), optional `model`, `effort`, `tools`.
- **`generate_lenses.py`** (stdlib `tomllib`) reads the config and writes
  `skills/<id>/SKILL.md` with: correct frontmatter, a shared **contract** preamble (how the lens
  shapes the task), and the **confirm-step** (ask for missing info before acting). The body lives
  inside `<!-- intent-router:lens:begin/end -->` markers so re-running is idempotent and any
  hand-edits outside the markers survive. Generated files are committed for review.
- **Override/extend semantics**: a repo's own `lenses.toml` (or `.claude/intent-router/lenses.toml`)
  **overrides** a default lens by same `id` and **adds** new ones. Org defaults < repo overrides
  (pure override by id, documented; no deep-merge to keep mental model simple).
- **Seed library**: `debug, feature, refactor, review, test, explain, architecture` — each carries a
  `category` so the router's catalog is meaningful (the epic's sequencing requirement: 1 before 2).

### 2. Catalog builder + heuristic router (ABH-45) — the novel core

- **`build_catalog.py`** (build-time, stdlib): scans installed plugin roots + project `.claude/`
  for `skills/*/SKILL.md`, `commands/*.md`, `agents/*.md`, and MCP-exposed prompt names; parses
  frontmatter (`name`, `description`, `category`, `model`, `tools`); **infers `category`** by keyword
  heuristic when absent (mapped onto the taxonomy). Emits:
  - `catalog.json` — `{commands:[{name, kind, category, description, keywords, source}], built_at}`.
  - a **managed block** appended into `docs/skills-catalog.md` (human index) — never clobbers the
    hand-written content, mirroring `merge_guidelines.py`'s marker merge.
  - Idempotent; rebuild **drops stale entries** for deleted commands.
- **`router_lib.py`** (shared, stdlib): `score(prompt, catalog) -> ranked[(command, score, category)]`.
  Coarse-to-fine: tokenize prompt (lowercase, stoplist), score each entry by weighted overlap of
  prompt tokens against its keywords/category/name, pick category then top-N over a threshold.
  Deterministic, no model call. Returns explicit "no confident match" rather than guessing.
- **Router tiers:**
  - **T0 native** — lens auto-invocation via `description` (free; baseline).
  - **T1 deterministic `UserPromptSubmit` hook** (`route_intent.sh`, **ON by default, surfaced**):
    loads `catalog.json`, calls `router_lib`, and on a confident match injects
    `hookSpecificOutput.additionalContext`: *"Relevant slash commands for this request: /x — <desc>;
    /y — <desc>. Consider invoking one."* Non-match → exit 0, no output (prompt passes through clean).
  - **T2 prompt-model hook** (opt-in via `router.toml`): `type: prompt` handed the category index for
    a cheap-model tiebreak when T1 is ambiguous.
  - **T3 MCP server** (`router_server.py`, optional enable via `.mcp.json`): `route_intent(prompt) ->
    {command, category, rationale, confidence}`, `list_commands(category)`, `describe_command(name)`,
    backed by the same `catalog.json`. Reusable across surfaces/repos. Uses the `mcp` SDK via PEP 723
    (stdlib-only MCP is impractical — documented deviation). Optional embedding shortlist behind a flag.
- **Freshness**: `/rebuild-catalog` skill (manual); `catalog_freshness.sh` `SessionStart` hook
  rebuilds when `catalog.json` is older than any scanned plugin dir (covers "a new skill was
  installed"); documented CI/cron option for interval rebuilds.

### 3. Prompt improvement + follow-ups (the user's core ask)

- **`/improve-prompt` skill** (`model` high-tier, `effort: high`): takes a rough prompt and returns a
  **deterministic spec** — restated goal, explicit acceptance criteria, surfaced assumptions to
  confirm, and **recommended commands** drawn from `catalog.json` via `router_lib`. Explicit,
  zero-cost on normal turns. This is "use a higher model to fix the prompt, deterministic at start."
- **Opt-in auto prompt-improver** (`improve_prompt_auto.sh`, off by default): a `UserPromptSubmit`
  handler (command-wrapper around a `prompt`-type judge) that augments *every* prompt with the same
  spec for users who want it always-on. Gated by `router.toml auto_improve=true` because it adds
  latency/cost and can feel intrusive.
- **`suggest_next.sh` `Stop` hook** (on, surfaced, silent when none): after Claude finishes, inspects
  the recent actions + catalog and injects 1–3 relevant follow-up commands (*"Next: /commit to save ·
  /review to check the diff"*). This is "at the end, suggest slash commands to inject."

### 4. Best-practice capability bundle (ABH-46) — opt-in

- **Subagents** `reviewer`, `explorer`, `verifier` (`agents/*.md`, Sonnet, scoped tools) for
  context-isolated parallel work; lenses delegate to them. (Complements existing `image-parser`/
  `web-researcher` in `core-workflow`.)
- **`/plan` skill**: decompose a task → explicit goals + acceptance criteria → a TodoWrite-tracked
  plan; pairs with plan mode. Lenses can call it; not forced on every lens.
- **Guardrail hooks (opt-in, off by default)**: `block_secrets.sh` (`PreToolUse`, exit 2 on reads of
  `.env`/secret-looking paths) and `format_on_edit.sh` (`PostToolUse`). Cleanly toggleable in `router.toml`.
- **Statusline**: extend the existing `scripts/statusline.sh` pattern to optionally surface current
  goal/plan progress + context budget; ship as an opt-in enhancement, documented, no auto-override.

### 5. Packaging, distribution, `/init` (ABH-47)

- **`/init-intent-router` skill**: short Q&A scaffolds `lenses.toml` + `router.toml`, picks which
  capabilities/guardrails to enable, runs the generator + first catalog build.
- **Marketplace**: add `intent-router` to `.claude-plugin/marketplace.json`. Document repo-scoped
  install (`extraKnownMarketplaces` in project `.claude/settings.json`) and org-managed
  (`forcedPlugins`/`strictKnownMarketplaces`, or Org settings > Plugins), with the **GHES caveat**
  (org-synced GitHub marketplace unsupported on GitHub Enterprise Server → managed-settings path).
- **Config ergonomics**: one obvious file per concern (`lenses.toml`, `router.toml`); documented
  override/merge semantics with org defaults; `/plugin:skill` namespacing called out.

## Error handling

- All Python scripts: fail loud on malformed TOML/missing `schema_version`; reject unknown schema versions.
- Hooks: always `exit 0` on the no-match / error path so a router fault never blocks a user's prompt
  (guardrail hooks are the deliberate exception — they `exit 2` to block). Parse stdin JSON defensively
  via `/usr/bin/python3` like `shellcheck-on-edit.sh` / `statusline.sh`.
- `build_catalog.py`: a malformed single SKILL.md is skipped with a warning, not fatal.
- MCP `route_intent`: returns low-confidence + "no clear match" rather than false confidence.

## Testing

- **Shared labeled prompt set** (`tests/fixtures/intent-router/labeled-prompts.json`, ~40 prompts
  across categories) — the backbone for measuring routing accuracy per tier and catching regressions.
- **pytest**: `build_catalog` completeness + stale-entry removal; `generate_lenses` frontmatter +
  override precedence + idempotency (re-run → clean diff); `router_lib` match/no-match/ambiguous +
  accuracy threshold over the labeled set; `router_server` route_intent unit cases.
- **bats**: generator end-to-end into `${TMP}`; `route_intent.sh` injects on a matching prompt and is
  silent on a non-match; freshness rebuild removes a deleted command; `block_secrets.sh` blocks a
  `.env` read. Reuse `tests/bats/helpers.bash` mock-PATH + `MOCK_CALL_LOG`.
- **CI**: extend `.github/workflows/test.yml` (manifest validation already covers the new plugin.json);
  add the pytest/bats files; keep macOS+Ubuntu green.

## Build order (phased — each lands independently, repo stays green)

1. **Templates + lenses (ABH-44):** `lenses.toml`, `generate_lenses.py`, 7 lenses, taxonomy, tests.
2. **Catalog + T0–1 router (ABH-45 core):** `build_catalog.py`, `router_lib.py`, `route_intent.sh`
   (on/surfaced), freshness hook + `/rebuild-catalog`, labeled set + accuracy harness, tests.
3. **Prompt improvement + follow-ups:** `/improve-prompt`, opt-in auto hook, `suggest_next.sh` Stop hook.
4. **Capability bundle (ABH-46):** `reviewer`/`explorer`/`verifier`, `/plan`, opt-in guardrails, statusline ext.
5. **T2/T3 router (ABH-45 advanced):** prompt-model tier, MCP `router_server.py`, optional embedding index.
6. **Packaging/init (ABH-47):** marketplace entry, `/init-intent-router`, override/merge + distribution + GHES docs, README/catalog updates.

## Out of scope (this epic)

- Cross-repo hosted catalog service (one MCP serving many repos) beyond the single-server `route_intent`.
- Replacing the hand-written `docs/skills-catalog.md` outright (we append a managed block, not rewrite it).
- Non-Claude surfaces for the router (Codex/Copilot) — the adapters already cover skills; routing stays Claude-side for now.
