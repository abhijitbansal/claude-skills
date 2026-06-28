# claude-skills: `prompt-craft` (now) + `intent-router` (evidence-gated)

**Date:** 2026-06-28
**Status:** Revised proposal (RFC v2 — supersedes the maximal-scope v1; awaiting sign-off)
**Epic:** [ABH-43](https://linear.app/abhijitbansal/issue/ABH-43) · sub-issues [ABH-44](https://linear.app/abhijitbansal/issue/ABH-44) (templates), [ABH-45](https://linear.app/abhijitbansal/issue/ABH-45) (router), [ABH-46](https://linear.app/abhijitbansal/issue/ABH-46) (capabilities), [ABH-47](https://linear.app/abhijitbansal/issue/ABH-47) (packaging)

## What changed since v1 (read this first)

v1 proposed a single **maximal-scope** 5th plugin: a 4-tier router (keyword hook → prompt-model →
MCP server + embeddings), generated lenses, a per-turn injection hook on-by-default, and an
auto-rewrite into `docs/skills-catalog.md` — ~30 files across 6 phases. That cuts directly against
this repo's own `CLAUDE.md` ("Minimum code that solves the problem. Nothing speculative. No
flexibility that wasn't requested.") and bundles one high-value, low-cost capability with one
speculative, partly-redundant one.

v2 **unbundles** them:

1. **Ship the value first.** `prompt-craft` — `/improve-prompt`, `/plan`, a `Stop`-hook follow-up
   suggester, and a few hand-written lens skills. Zero router infrastructure. High value, small surface.
2. **Make the router earn its keep.** A 40-prompt labeled set + a ~30-line scorer is built as a
   **spike** that measures keyword routing against Claude Code's *native* description-based
   auto-invocation. The router (`intent-router`) ships **only if the spike shows it wins**.
3. **Cut the speculation.** T2 (prompt-model tier), T3 (MCP server + embedding index), the lens
   *generator*, the auto-rewrite of the hand-curated catalog, and three generic subagents that
   duplicate existing ones — all moved to out-of-scope/future.

## Context

The repo ships four plugins — **13 skills, 11 commands, 2 agents, 2 hooks** — and a hand-maintained
`docs/skills-catalog.md`. The epic names two problems:

1. **Discovery** — you have to already know a command exists to use it.
2. **Determinism** — a vague prompt ("fix the thing") routes to improvisation instead of a known,
   confirm-stepped lens.

First-principles read of each:

- **Discovery is largely already solved by the platform.** Claude Code injects every skill's `name`
  + `description` into session context and the model semantically auto-invokes the right one. That is
  *strictly stronger* than a bash keyword-overlap scorer, and it is free. At **24 catalog items**
  there is no discovery crisis; "as the command count grows" is a future problem (YAGNI). So a router
  must prove it beats the native baseline before it is worth ~a subsystem of maintenance — hence the
  spike gate.
- **Determinism is the genuinely valuable, low-cost ask.** `/improve-prompt` (restate goal → explicit
  acceptance criteria → assumptions to confirm → recommended commands) maps directly onto this repo's
  own "Goal-driven execution" principle and needs no catalog/router to exist. It is the core of v2.

## Verified mechanics (vs. live docs, 2026-06-28)

Load-bearing facts re-verified against `code.claude.com/docs`:

- **`UserPromptSubmit` hook** injects `hookSpecificOutput.additionalContext` (or plain stdout) as
  context Claude acts on — it does **not** rewrite the prompt in place. 30s timeout. Exit 2 blocks.
- **Hook handler types**: `command` (shell, fast/free), `prompt` (cheap-model judge), `agent`
  (subagent), plus `http`/`mcp_tool`; `async: true` / `asyncRewake` to background.
- **`Stop` hook** can inject `additionalContext` (follow-up suggestions) and optionally block-to-continue.
- **Skills == commands (merged).** `.claude/skills/<n>/SKILL.md` is both `/n` and auto-invoked via its
  `description`. Frontmatter: `name`, `description`, `disable-model-invocation`, `user-invocable`,
  `allowed-tools`, `model`, `effort`, `context: fork`, `agent`, `paths`. Plugin skills namespace as `/plugin:skill`.
- **Plugins bundle** MCP (`.mcp.json`/inline), hooks (`hooks/hooks.json` + `${CLAUDE_PLUGIN_ROOT}`),
  agents, and skills — all auto-register on install. `SessionStart` available.

The first bullet is also the v2 argument: the platform already routes by `description`. A keyword hook
is a *weaker* second router unless measured otherwise.

## Decisions (v2 — the three v1 "locked" calls reopened)

| Question | v1 (locked) | v2 decision | Why |
| --- | --- | --- | --- |
| **Scope** | Maximal — all four sub-issues, one plugin, 6 phases | **Incremental, evidence-gated** — value-first plugin now; router only if a spike proves it | Matches repo `CLAUDE.md`; defers cost until justified |
| **Prompt-fix** | Both: explicit skill **and** opt-in auto `UserPromptSubmit` hook | **Explicit `/improve-prompt` only**; auto-hook deferred | Pull > push; auto-on-every-prompt adds latency/cost + intrusion for marginal gain |
| **Injection default** | On & surfaced on every prompt | **Built only if spike wins; then opt-in (default off), surfaced when on** | Per-turn hook = banner-blindness + per-turn spawn cost; your other hooks are narrowly matched (`Edit|Write`), not global |
| Lens authoring | TOML + `generate_lenses.py` → committed generated `SKILL.md` | **Hand-write 3–4 lenses** as plain `SKILL.md`; generator deferred | Generator + markers + idempotency + override-merge is infra to emit a few markdown files (YAGNI until >15 lenses or multi-repo override) |
| Catalog | Auto-write a managed block into `docs/skills-catalog.md` | **Emit `catalog.json` only** (if router ships); regenerate the human doc by hand | Don't put a generator/marker contract over a doc a solo maintainer edits happily at this scale |
| Router tiers | T0 native + T1 hook + T2 prompt-model + T3 MCP+embeddings | **T0 native (baseline) + T1 deterministic hook _iff_ spike wins**; T2/T3 **out** | T3 has no in-scope consumer (cross-repo + non-Claude both out of scope) = speculative generality |
| Plugins | One `intent-router` (largest in repo by 3×) | **Two**: `prompt-craft` (now) + `intent-router` (conditional) | High cohesion; ship value without the router's weight |
| Capabilities (ABH-46) | 3 new generic subagents + guardrails + statusline | **Wire existing agents into lenses + 2 cheap opt-in guardrails + statusline note** | `reviewer/explorer/verifier` duplicate `core-workflow`'s agents and the ecc fleet |
| Deps | stdlib; PEP 723 `mcp` SDK; optional embeddings | **stdlib only** | No MCP server / embedding index in scope |

## Architecture

```
plugins/prompt-craft/                    # SHIPS NOW (the value)
├── .claude-plugin/plugin.json
├── skills/
│   ├── improve-prompt/SKILL.md          # high effort/model: rough prompt → deterministic spec
│   ├── plan/SKILL.md                     # goal → acceptance criteria → TodoWrite plan
│   └── <3-4 hand-written lenses>/SKILL.md  # e.g. debug, refactor, review (auto-invoke via description)
└── hooks/
    ├── hooks.json                        # Stop(suggest_next), opt-in guardrails
    ├── suggest_next.sh                    # Stop follow-up suggester (on, surfaced, silent when none)
    ├── block_secrets.sh                   # opt-in PreToolUse guardrail (exit 2 on .env/secret read)
    └── format_on_edit.sh                  # opt-in PostToolUse formatter

tests/fixtures/intent-router/labeled-prompts.json   # the SPIKE: ~40 labeled prompts
scripts/route_spike.py                              # ~30-line scorer + accuracy report vs native baseline

# CONDITIONAL — only if the spike report shows keyword routing beats native auto-invoke:
plugins/intent-router/
├── .claude-plugin/plugin.json
├── router.toml                           # threshold, top-N, tier/guardrail toggles
├── catalog.json                          # generated build artifact (committed for bundled set)
├── skills/rebuild-catalog/SKILL.md
├── hooks/{hooks.json, route_intent.sh, catalog_freshness.sh}
└── scripts/{build_catalog.py, router_lib.py}   # router_lib promoted from route_spike.py
```

## Components

### A. `prompt-craft` — ABH-44 (templates) + the determinism ask + ABH-46 (capabilities)

- **`/improve-prompt`** (`model` high-tier, `effort: high`): rough prompt → restated goal, explicit
  acceptance criteria, surfaced assumptions to confirm, and (once a catalog exists) recommended
  commands. Explicit, zero cost on normal turns. This is "use a higher model to fix the prompt,
  deterministic at start."
- **`/plan`**: decompose a task → goals + acceptance criteria → a `TodoWrite`-tracked plan; pairs with
  plan mode.
- **3–4 hand-written lens skills** (`debug`, `refactor`, `review`, plus `feature` if it earns it):
  plain `SKILL.md` with a shared contract preamble + confirm-step. Auto-invoke via `description`
  (the native T0 path). Add more lenses only when a real one is missing — no generator yet.
- **`suggest_next.sh` `Stop` hook** (on, surfaced, silent when none): after Claude finishes, suggest
  1–3 follow-up commands (*"Next: /commit to save · /review to check the diff"*). This is "at the end,
  suggest slash commands."
- **Opt-in guardrails** (off by default, toggled in `plugin` config): `block_secrets.sh`
  (`PreToolUse`, exit 2 on `.env`/secret reads) and `format_on_edit.sh` (`PostToolUse`). Cheap, useful.
- **ABH-46 without new generic agents**: lenses delegate to the **existing** `core-workflow`
  agents (`image-parser`, `web-researcher`) and any ecc reviewer/explorer already installed, rather
  than shipping three near-duplicate `reviewer/explorer/verifier`. Statusline goal/context extension:
  documented as an opt-in tweak to the existing `scripts/statusline.sh`, not an auto-override.

### B. The routing spike — ABH-45 gate (build before any router)

- **`tests/fixtures/intent-router/labeled-prompts.json`** — ~40 prompts across categories, each
  labeled with the command it *should* route to (or "no clear match").
- **`scripts/route_spike.py`** (stdlib): a ~30-line tokenize + stoplist + weighted keyword/name/category
  overlap scorer. Run it over the labeled set and print accuracy **next to the native baseline**
  (what the model's `description` auto-invoke already gets right on the same prompts).
- **Gate:** if keyword routing does not clearly beat native auto-invoke (and is worth the per-turn
  hook + catalog maintenance), **stop here** — the router is not built. The spike code and labeled set
  stay as the regression backbone for `/improve-prompt`'s "recommended commands" either way.

### C. `intent-router` — ABH-45 core, CONDITIONAL on the spike

Only if B says yes:

- **`build_catalog.py`** (stdlib): scan installed plugin roots + project `.claude/` for
  `skills/*/SKILL.md`, `commands/*.md`, `agents/*.md`, MCP prompt names; parse frontmatter; infer
  `category` by keyword when absent; emit **`catalog.json`** (`{commands:[{name, kind, category,
  description, keywords, source}], built_at}`). Idempotent; drops stale entries. **No write into
  `docs/skills-catalog.md`** — that stays hand-curated.
- **`router_lib.py`**: `route_spike.py` promoted to a shared `score(prompt, catalog) -> ranked`.
- **`route_intent.sh` `UserPromptSubmit` hook** (**opt-in, default off**; surfaced when on): on a
  confident match inject `additionalContext` *"Relevant slash commands: /x — <desc>; /y — <desc>."*;
  non-match → `exit 0`, silent (prompt passes through clean). Ambiguity → top-N or ask, never silent
  misroute.
- **Freshness**: `/rebuild-catalog` (manual) + `catalog_freshness.sh` `SessionStart` rebuild when
  `catalog.json` is older than any scanned plugin dir; documented CI/cron option.

### D. Packaging / distribution — ABH-47

- **`/init-prompt-craft`** (and `/init-intent-router` if C ships): short Q&A scaffolds config, picks
  which capabilities/guardrails to enable.
- **Marketplace**: add `prompt-craft` (and conditionally `intent-router`) to
  `.claude-plugin/marketplace.json`. Document repo-scoped install (`extraKnownMarketplaces`) and
  org-managed (`forcedPlugins`/`strictKnownMarketplaces`), with the **GHES caveat** (org-synced GitHub
  marketplace unsupported on GitHub Enterprise Server → managed-settings path).

## Error handling

- Python scripts: fail loud on malformed TOML/JSON; reject unknown schema versions.
- Hooks: always `exit 0` on the no-match / error path so a router or suggester fault never blocks a
  prompt. Parse stdin JSON defensively via `/usr/bin/python3` like `shellcheck-on-edit.sh` /
  `statusline.sh`. Guardrail hooks are the deliberate exception — they `exit 2` to block.
- `build_catalog.py`: a malformed single `SKILL.md` is skipped with a warning, not fatal.

## Testing

- **The labeled prompt set is the backbone** (built in the spike, phase B) — measures routing
  accuracy vs the native baseline and catches regressions in `/improve-prompt` recommendations.
- **pytest**: `route_spike` accuracy report + native-baseline comparison; `improve_prompt`/`plan`
  output-shape contracts; (if C) `build_catalog` completeness + stale removal, `router_lib`
  match/no-match/ambiguous.
- **bats**: `suggest_next.sh` injects follow-ups on a finished task and is silent when none;
  `block_secrets.sh` blocks a `.env` read; (if C) `route_intent.sh` injects on match / silent on
  non-match, freshness rebuild removes a deleted command. Reuse `tests/bats/helpers.bash` mock-PATH +
  `MOCK_CALL_LOG`.
- **CI**: extend `.github/workflows/test.yml`; keep macOS + Ubuntu green.

## Build order (phased — each lands independently, repo stays green)

1. **`prompt-craft` v1 (the value):** `/improve-prompt`, `/plan`, `suggest_next` Stop hook, 3–4
   hand-written lenses, opt-in guardrails, tests. **Ships and is useful with no router.**
2. **Routing spike (ABH-45 gate):** labeled set + `route_spike.py` + accuracy-vs-native report.
   **Decision point.**
3. **`intent-router` (ABH-45 core) — only if step 2 wins:** `build_catalog.py`, `router_lib.py`,
   `route_intent.sh` (opt-in), freshness hook + `/rebuild-catalog`, tests.
4. **Packaging/init (ABH-47):** marketplace entries, `/init-*`, override/distribution + GHES docs,
   README + hand-updated catalog.

## Out of scope (this epic)

- **T2 prompt-model tier** and **T3 MCP server + embedding index** — no in-scope consumer
  (cross-repo and non-Claude surfaces are both out of scope); revisit only with a concrete caller.
- **Lens generator** (`generate_lenses.py`, TOML→`SKILL.md`, override-merge) — defer until >15 lenses
  or multiple repos overriding them.
- **Auto-rewriting `docs/skills-catalog.md`** — append nothing; the human doc stays hand-curated.
- **Three new generic subagents** — use the existing `core-workflow`/ecc agents instead.
- Cross-repo hosted catalog service; non-Claude surfaces for the router.
