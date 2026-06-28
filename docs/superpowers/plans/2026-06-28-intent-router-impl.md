# prompt-craft + intent-router Implementation Plan (v2)

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax. Implement phase-by-phase; the repo
> must stay green (`bats tests/bats`, `pytest tests/pytest`, shellcheck, manifest validation) between
> phases. Each phase is independently shippable.

**Goal:** Ship the *value* first — a `prompt-craft` plugin (`/improve-prompt`, `/plan`, follow-up
suggestions, a few hand-written lenses) — then **measure** whether a keyword router beats Claude
Code's native description-based auto-invocation, and build `intent-router` **only if it wins**.

**Why v2:** v1 was maximal-scope (4-tier router, generated lenses, per-turn injection on-by-default,
~30 files) — counter to this repo's `CLAUDE.md` ("minimum code … nothing speculative"). v2 unbundles
the cheap high-value capability from the speculative router and gates the router on evidence.

**Architecture:** `plugins/prompt-craft/` (skills + Stop hook + opt-in guardrails) ships now. A spike
(`tests/fixtures/intent-router/labeled-prompts.json` + `scripts/route_spike.py`) decides whether
`plugins/intent-router/` (catalog + opt-in `UserPromptSubmit` hook) is built. Config in TOML, parsed
with stdlib `tomllib`. **No MCP server, no embeddings, no lens generator, no auto-rewrite of the
hand-curated catalog** (all out of scope — see spec).

**Tech Stack:** Python 3.11+ stdlib (`tomllib`, `json`, `re`); bash hooks parsing stdin JSON via
`/usr/bin/python3`; bats + pytest.

**Spec:** `docs/superpowers/specs/2026-06-28-intent-router-design.md`

**Decisions (v2, reopened from v1):** incremental/evidence-gated scope · prompt-fix = explicit
`/improve-prompt` only (auto-hook deferred) · injection built only if the spike wins, then opt-in
(default off).

---

### Phase 1 — `prompt-craft` v1 (the value: ABH-44 + determinism + ABH-46)

**Files:** `plugins/prompt-craft/.claude-plugin/plugin.json`,
`skills/{improve-prompt,plan,debug,refactor,review}/SKILL.md`,
`hooks/{hooks.json,suggest_next.sh,block_secrets.sh,format_on_edit.sh}`,
`tests/bats/prompt_craft.bats`, `tests/pytest/test_prompt_craft.py`.

- [ ] `/improve-prompt` skill (`model` high-tier, `effort: high`): rough prompt → restated goal + explicit acceptance criteria + assumptions-to-confirm (+ recommended commands once a catalog exists).
- [ ] `/plan` skill: decompose → goals + acceptance criteria → `TodoWrite` plan.
- [ ] 3–4 **hand-written** lens `SKILL.md` (`debug`, `refactor`, `review`; `feature` if it earns it): shared contract preamble + confirm-step; auto-invoke via `description`. No generator.
- [ ] `suggest_next.sh` `Stop` hook (on, surfaced, silent when none): 1–3 follow-up commands.
- [ ] Opt-in guardrails: `block_secrets.sh` (`PreToolUse` exit 2 on `.env`/secret read), `format_on_edit.sh` (`PostToolUse`); off by default, toggleable.
- [ ] ABH-46: lenses delegate to **existing** `core-workflow`/ecc agents (no new generic subagents); statusline goal/context extension documented as opt-in.
- [ ] pytest: `/improve-prompt` + `/plan` output-shape contracts. bats: Stop hook injects on a finished task / silent when none; `block_secrets.sh` blocks a `.env` read; default config leaves prompts unaffected.

**Verify:** `/improve-prompt "fix the thing"` returns a deterministic spec; `/plan` yields a tracked plan + criteria; finishing a task surfaces a sensible next command; secret read blocked when enabled.

### Phase 2 — Routing spike (ABH-45 gate — build before any router)

**Files:** `tests/fixtures/intent-router/labeled-prompts.json`, `scripts/route_spike.py`,
`tests/pytest/test_route_spike.py`.

- [ ] Build the ~40-prompt labeled set across categories (each labeled with the command it *should* hit, or "no clear match").
- [ ] `route_spike.py` (stdlib, ~30 lines): tokenize + stoplist + weighted keyword/name/category overlap → ranked; explicit no-match.
- [ ] Print accuracy **next to the native baseline** (what `description` auto-invoke already gets right on the same prompts).
- [ ] pytest: scorer match/no-match/ambiguous + the accuracy report.

**Verify (DECISION POINT):** if keyword routing does **not** clearly beat native auto-invoke (and justify the per-turn hook + catalog upkeep) → **stop; do not build Phase 3.** The spike + labeled set remain as the regression backbone for `/improve-prompt` recommendations regardless.

### Phase 3 — `intent-router` (ABH-45 core) — CONDITIONAL on Phase 2

**Files:** `plugins/intent-router/.claude-plugin/plugin.json`, `router.toml`, `catalog.json`,
`scripts/{build_catalog.py,router_lib.py}`,
`hooks/{hooks.json,route_intent.sh,catalog_freshness.sh}`, `skills/rebuild-catalog/SKILL.md`,
`tests/pytest/test_build_catalog.py`, `tests/pytest/test_router_lib.py`, `tests/bats/intent_router.bats`.

- [ ] `build_catalog.py`: scan plugin roots + `.claude/` for skills/commands/agents/MCP prompts; parse frontmatter; infer `category` when absent; emit `catalog.json`; idempotent; drops stale entries. **No write into `docs/skills-catalog.md`.**
- [ ] Promote `route_spike.py` → `router_lib.py` `score(prompt, catalog) -> ranked`.
- [ ] `route_intent.sh` `UserPromptSubmit` hook (**opt-in, default off**; surfaced when on): inject `additionalContext` "Relevant slash commands: …" on confident match; `exit 0` silent on no-match.
- [ ] `catalog_freshness.sh` `SessionStart` hook: rebuild when `catalog.json` older than any scanned plugin dir. `/rebuild-catalog` skill (manual).
- [ ] pytest: catalog completeness + stale removal; router accuracy over the labeled set. bats: matching prompt → injection present; non-matching → silent; freshness rebuild removes a deleted command.

**Verify:** a real prompt surfaces the right command **when the hook is enabled**; default-off config leaves prompts untouched; non-matching prompt silent.

### Phase 4 — Packaging, distribution, /init (ABH-47)

**Files:** `.claude-plugin/marketplace.json` (add entries), `skills/init-prompt-craft/SKILL.md`
(+ `init-intent-router` if Phase 3 shipped), `README.md` + `docs/skills-catalog.md` (hand updates),
`docs/` distribution + GHES notes.

- [ ] Add `prompt-craft` (and conditionally `intent-router`) to `marketplace.json`.
- [ ] `/init-prompt-craft` Q&A: pick capabilities/guardrails, scaffold config.
- [ ] Docs: config + override semantics, `/plugin:skill` namespacing, repo-scoped + org-managed install, **GHES caveat**.
- [ ] README + **hand-updated** catalog; CI green on macOS + Ubuntu.

**Verify:** `/init-prompt-craft` in a clean repo → working skills + chosen capabilities; plugin installs from marketplace; managed-settings snippet dry-runs against a GHES-style config.

---

### Cross-cutting verification

- `bats tests/bats/` · `uv tool run pytest tests/pytest -q` · `shellcheck` on every new `.sh` · manifest validation — all green before each phase merges.
- Routing accuracy over the shared labeled set is reported at the Phase 2 gate and re-checked after any catalog/template change (regression backbone) — even if Phase 3 is never built.
