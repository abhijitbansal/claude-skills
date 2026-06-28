# intent-router Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Implement phase-by-phase;
> the repo must stay green (`bats tests/bats`, `pytest tests/pytest`, shellcheck, manifest validation)
> between phases. Each phase is independently shippable.

**Goal:** Ship a fifth plugin, `intent-router`, that builds a catalog of every available slash
command, injects the relevant ones into each prompt, improves rough prompts into deterministic specs,
suggests follow-up commands, and bundles best-practice capabilities — all configurable per repo.

**Architecture:** New `plugins/intent-router/` with generated lens skills, a build-time catalog
(`build_catalog.py` → `catalog.json`), a shared scorer (`router_lib.py`), a `UserPromptSubmit`
injection hook (on, surfaced), a `Stop` follow-up hook, a `SessionStart` freshness hook, opt-in
guardrails, three subagents, and a Tier-3 MCP router server. Config in TOML (`lenses.toml`,
`router.toml`), parsed with stdlib `tomllib`.

**Tech Stack:** Python 3.11+ stdlib (`tomllib`, `json`, `re`); bash hooks parsing stdin JSON via
`/usr/bin/python3`; `mcp` SDK via PEP 723 for the Tier-3 server; bats + pytest.

**Spec:** `docs/superpowers/specs/2026-06-28-intent-router-design.md`

**Decisions locked with owner (2026-06-28):** maximal scope · prompt-fix = both (explicit skill +
opt-in auto) · injection = on & surfaced.

---

### Phase 1 — Intent-template framework (ABH-44)

**Files:** `plugins/intent-router/.claude-plugin/plugin.json`, `lenses.toml`,
`scripts/generate_lenses.py`, `skills/{debug,feature,refactor,review,test,explain,architecture}/SKILL.md`,
`tests/pytest/test_generate_lenses.py`, `tests/bats/intent_router.bats`.

- [ ] Write `lenses.toml`: `[meta]`, `[taxonomy] categories=[…]`, 7 `[[lens]]` tables (`id`, `name`, `category`, `description`, `template`, optional `model`/`effort`/`tools`).
- [ ] `generate_lenses.py` (stdlib `tomllib`): emit `skills/<id>/SKILL.md` with frontmatter + shared contract + confirm-step inside `<!-- intent-router:lens:begin/end -->` markers; `--dry-run`, idempotent.
- [ ] Generate + commit the 7 lens `SKILL.md` files.
- [ ] pytest: frontmatter correctness, override precedence (same-id override wins, new id adds), re-run idempotency (clean diff).
- [ ] bats: generator writes into `${TMP}`, asserts files + `name:`/`category:` frontmatter.

**Verify:** `pytest tests/pytest/test_generate_lenses.py` green; `/debug` invokes and auto-invokes.

### Phase 2 — Catalog builder + Tier 0–1 router (ABH-45 core)

**Files:** `scripts/build_catalog.py`, `scripts/router_lib.py`, `catalog.json`,
`hooks/route_intent.sh`, `hooks/catalog_freshness.sh`, `hooks/hooks.json`,
`skills/rebuild-catalog/SKILL.md`, `tests/fixtures/intent-router/labeled-prompts.json` + `sample-repo/`,
`tests/pytest/test_build_catalog.py`, `tests/pytest/test_router_lib.py`.

- [ ] `build_catalog.py`: scan plugin roots + `.claude/` for skills/commands/agents/MCP prompts; parse frontmatter; infer `category` when absent; emit `catalog.json` + managed block in `docs/skills-catalog.md`; idempotent; drops stale entries.
- [ ] `router_lib.py`: `score(prompt, catalog)` → ranked commands (tokenize + stoplist + weighted keyword/category/name overlap; threshold + top-N; explicit no-match).
- [ ] `route_intent.sh` `UserPromptSubmit` hook (**on, surfaced**): inject `additionalContext` "Relevant slash commands: …" on confident match; `exit 0` silent on no-match.
- [ ] `catalog_freshness.sh` `SessionStart` hook: rebuild when `catalog.json` older than any scanned plugin dir.
- [ ] `/rebuild-catalog` skill (manual refresh).
- [ ] Build the ~40-prompt labeled set + a `sample-repo/` fixture (≥4 categories).
- [ ] pytest: catalog completeness + stale removal; router accuracy over the labeled set (report per-tier); match/no-match/ambiguous.
- [ ] bats: matching prompt → injection present; non-matching → silent; freshness rebuild removes deleted command.

**Verify:** accuracy report printed; a real prompt surfaces the right command; non-matching prompt untouched.

### Phase 3 — Prompt improvement + follow-ups

**Files:** `skills/improve-prompt/SKILL.md`, `hooks/improve_prompt_auto.sh`, `hooks/suggest_next.sh`,
`hooks/hooks.json` (extend), `router.toml`.

- [ ] `/improve-prompt` skill (`model` high-tier, `effort: high`): rough prompt → goal + acceptance criteria + assumptions-to-confirm + recommended commands (via `router_lib`).
- [ ] `improve_prompt_auto.sh` opt-in `UserPromptSubmit` handler (off by default; `router.toml auto_improve=true`).
- [ ] `suggest_next.sh` `Stop` hook (on, surfaced, silent when none): 1–3 follow-up commands from recent actions + catalog.
- [ ] `router.toml`: tier toggles, threshold, top-N, `auto_improve`, guardrail flags.
- [ ] bats: `/improve-prompt` output shape; Stop hook injects follow-ups; auto hook silent when flag off.

**Verify:** `/improve-prompt "fix the thing"` returns a deterministic spec; finishing a task surfaces a sensible next command.

### Phase 4 — Capability bundle (ABH-46, opt-in)

**Files:** `agents/{reviewer,explorer,verifier}.md`, `skills/plan/SKILL.md`,
`hooks/{block_secrets,format_on_edit}.sh`, `hooks/hooks.json` (extend), statusline ext doc.

- [ ] Three subagents (Sonnet, scoped tools); a lens delegates to one to prove isolation.
- [ ] `/plan` skill: decompose → goals + acceptance criteria → TodoWrite plan.
- [ ] Opt-in guardrails: `block_secrets.sh` (`PreToolUse` exit 2 on `.env`/secret read), `format_on_edit.sh` (`PostToolUse`); toggleable in `router.toml`.
- [ ] Statusline: document optional goal/context extension of `scripts/statusline.sh`.
- [ ] bats: guardrail blocks a `.env` read; a no-extras config leaves prompts unaffected.

**Verify:** `/plan` yields tracked plan + criteria; secret read blocked when enabled; default repo unaffected.

### Phase 5 — Tier 2/3 router (ABH-45 advanced)

**Files:** `mcp/router_server.py`, `.mcp.json`, `hooks/hooks.json` (T2 prompt handler), `tests/pytest/test_router_server.py`.

- [ ] T2 `prompt`-type hook for cheap-model tiebreak when T1 is ambiguous (opt-in).
- [ ] `router_server.py` MCP (PEP 723 `mcp` SDK): `route_intent`, `list_commands`, `describe_command` over `catalog.json`; low-confidence "no clear match" path.
- [ ] `.mcp.json` registers it (optional enable); optional embedding shortlist behind a flag.
- [ ] pytest: `route_intent` match/no-match/ambiguous.

**Verify:** `route_intent("…")` returns `{command, category, rationale, confidence}` with sane no-match handling.

### Phase 6 — Packaging, distribution, /init (ABH-47)

**Files:** `.claude-plugin/marketplace.json` (add entry), `skills/init-intent-router/SKILL.md`,
`README.md` + `docs/skills-catalog.md` (updates), `docs/` distribution + GHES notes.

- [ ] Add `intent-router` to `marketplace.json`.
- [ ] `/init-intent-router` Q&A: scaffold `lenses.toml` + `router.toml`, pick capabilities/guardrails, run generator + first catalog build.
- [ ] Docs: config + override/merge semantics, `/plugin:skill` namespacing, repo-scoped + org-managed install, **GHES caveat**.
- [ ] README + catalog updates; CI green on macOS + Ubuntu.

**Verify:** `/init-intent-router` in a clean repo → working lenses + chosen capabilities; plugin installs from marketplace; managed-settings snippet dry-runs against a GHES-style config.

---

### Cross-cutting verification

- `bats tests/bats/` · `uv tool run pytest tests/pytest -q` · `shellcheck` on every new `.sh` · manifest validation — all green before each phase merges.
- Routing accuracy over the shared labeled set is reported as tiers land and re-checked after any catalog/template change (regression backbone).
