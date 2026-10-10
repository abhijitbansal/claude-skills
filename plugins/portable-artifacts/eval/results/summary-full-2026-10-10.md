# Cross-host eval — full prompt sets, 2026-10-10

The full 10-prompt set for each skill, run with `run-eval.mjs` on every target host that could authenticate on the dev machine: Claude Code 2.1.296 (Sonnet), Codex CLI 0.145.0 (default model), GitHub Copilot CLI 1.0.95 (via `npx @github/copilot`, default model), and a local model through Ollama (`codex exec --oss`, gemma4). Gemini CLI has no auth method configured here (needs a Google login or `GEMINI_API_KEY`); the owner chose to skip it for this release and track it as a follow-up (the harness already has a `gemini` host entry).

| Host (model) | Skill | Spec written | Final validate | Build / contact sheet | Median validate runs (valid cases) |
|---|---|---|---|---|---|
| claude (sonnet) | dashboard | 10/10 | 10/10 | 10/10 | 1 |
| claude (sonnet) | motion | 10/10 | 10/10 | 10/10 | 1 |
| codex | dashboard | 10/10 | 10/10 | 10/10 | 1 |
| codex | motion | 6/10 | 6/10 | 6/10 | 1 |
| copilot | dashboard | 10/10 | 10/10 | 10/10 | 1 |
| copilot | motion | 10/10 | 10/10 | 10/10 | 1 |
| codex-oss (gemma4), first run | dashboard | 6/10 | 4/10 | 4/10 | 2 |
| codex-oss (gemma4), first run | motion | 8/10 | 7/10 | 7/10 | 1 |
| codex-oss (gemma4), after SKILL.md fix | dashboard | 10/10 | 10/10 | 10/10 | 1 |
| codex-oss (gemma4), after SKILL.md fix | motion | 5/10 | 4/10 | 4/10 | 1 |

## Reading the results

- **Claude and Codex:** every scored run passed, nearly always on the first validate.
- **Codex motion:** the last 4 prompts (before-after, roadmap-line, quote-code, square-social) failed in 2–8 s with `ERROR: You've hit your usage limit` from the Codex account. That is a host quota, not the skill. Its `edit-existing` row also ran after the quota ran out and left the seed untouched; the harness now scores such no-op edits as failures (commit 8740361). Scored on the 5 runs that executed, Codex motion is 5/5.
- **Copilot:** 20/20, every edit prompt a real targeted change.
- **SKILL.md fix (commit 8740361):** the spec-writing step now says to actually create the file, with a shell-heredoc fallback. The rerun (`results/oss-v2-2026-10-10`, scored with the no-op-edit fix) took gemma4 dashboard from 4/10 to 10/10. Its motion failures are still the model ending its turn right after writing "I will now write this content to motion.json" without calling a tool; the same prompts swing between runs (7/10, then 4/10), so this is local-model turn-taking variance, not a spec or validator problem.
- **Local model (gemma4), first run:** most failures are the model announcing an `apply_patch` or describing the spec instead of writing the file (spec written 6/10 and 8/10). When it did write a spec, the validator's field-level errors usually got it to a valid build within 2–4 runs (overview 3, pipeline-steps 4, milestone 4). That is the retry loop the design relies on for weaker models. Its "valid with 0 runs" rows wrote a correct spec without running validate themselves; the harness's own validate passed.
- **Edit prompts (targeted change):** Claude, Copilot, Codex dashboard and gemma4 (both skills, after the fix) changed only the requested fields. In its first run gemma4 dashboard rewrote most of the spec and did not validate.
- **Visual check:** two outputs were opened and inspected during the run: Claude motion `before-after` (headline, 420 ms vs 95 ms, divider, caption all correct) and Codex dashboard `overview` (2 KPIs, 3 half-width charts, correct values). Per-case pages and PNGs are kept locally under `results/full-2026-10-10/` (gitignored).

## Per-run detail

### Eval — dashboard on claude (sonnet)

Spec written 10/10 · valid 10/10 · output ok 10/10

| id | spec | valid | validate runs | output | seconds | notes |
|---|---|---|---|---|---|---|
| rev-by-region | ✓ | ✓ | 1 | ✓ | 21 |  |
| monthly-trend | ✓ | ✓ | 1 | ✓ | 24 |  |
| product-mix | ✓ | ✓ | 1 | ✓ | 24 |  |
| top-products | ✓ | ✓ | 1 | ✓ | 22 |  |
| kpi-row | ✓ | ✓ | 1 | ✓ | 26 |  |
| quarterly-grouped | ✓ | ✓ | 1 | ✓ | 23 |  |
| traffic-lines | ✓ | ✓ | 1 | ✓ | 25 |  |
| conversion | ✓ | ✓ | 1 | ✓ | 16 |  |
| overview | ✓ | ✓ | 1 | ✓ | 28 |  |
| edit-existing | ✓ | ✓ | 1 | ✓ | 25 | changed: queries.rev_by_region, queries.total_units, kpis[1], charts[0].vegaLite.mark |

### Eval — motion on claude (sonnet)

Spec written 10/10 · valid 10/10 · output ok 10/10

| id | spec | valid | validate runs | output | seconds | notes |
|---|---|---|---|---|---|---|
| q3-counter | ✓ | ✓ | 1 | ✓ | 26 |  |
| pipeline-steps | ✓ | ✓ | 1 | ✓ | 41 |  |
| signups-chart | ✓ | ✓ | 1 | ✓ | 36 |  |
| title-card | ✓ | ✓ | 1 | ✓ | 25 |  |
| milestone | ✓ | ✓ | 1 | ✓ | 53 |  |
| before-after | ✓ | ✓ | 3 | ✓ | 47 |  |
| roadmap-line | ✓ | ✓ | 2 | ✓ | 58 |  |
| quote-code | ✓ | ✓ | 1 | ✓ | 37 |  |
| square-social | ✓ | ✓ | 2 | ✓ | 36 |  |
| edit-existing | ✓ | ✓ | 1 | ✓ | 28 | changed: scenes[1].duration, scenes[1].elements[0].to, scenes[1].elements[0].keyframes[1].value |

### Eval — dashboard on codex

Spec written 10/10 · valid 10/10 · output ok 10/10

| id | spec | valid | validate runs | output | seconds | notes |
|---|---|---|---|---|---|---|
| rev-by-region | ✓ | ✓ | 1 | ✓ | 21 |  |
| monthly-trend | ✓ | ✓ | 1 | ✓ | 51 |  |
| product-mix | ✓ | ✓ | 1 | ✓ | 34 |  |
| top-products | ✓ | ✓ | 1 | ✓ | 48 |  |
| kpi-row | ✓ | ✓ | 1 | ✓ | 106 |  |
| quarterly-grouped | ✓ | ✓ | 1 | ✓ | 93 |  |
| traffic-lines | ✓ | ✓ | 1 | ✓ | 49 |  |
| conversion | ✓ | ✓ | 1 | ✓ | 49 |  |
| overview | ✓ | ✓ | 1 | ✓ | 22 |  |
| edit-existing | ✓ | ✓ | 1 | ✓ | 42 | changed: queries.rev_by_region, queries.total_units, kpis[1], charts[0].vegaLite.mark |

### Eval — motion on codex

Spec written 6/10 · valid 6/10 · output ok 6/10

| id | spec | valid | validate runs | output | seconds | notes |
|---|---|---|---|---|---|---|
| q3-counter | ✓ | ✓ | 1 | ✓ | 31 |  |
| pipeline-steps | ✓ | ✓ | 1 | ✓ | 54 |  |
| signups-chart | ✓ | ✓ | 1 | ✓ | 134 |  |
| title-card | ✓ | ✓ | 1 | ✓ | 131 |  |
| milestone | ✓ | ✓ | 1 | ✓ | 121 |  |
| before-after | ✗ | ✗ | 0 | ✗ | 8 |  |
| roadmap-line | ✗ | ✗ | 0 | ✗ | 2 |  |
| quote-code | ✗ | ✗ | 0 | ✗ | 3 |  |
| square-social | ✗ | ✗ | 0 | ✗ | 2 |  |
| edit-existing | ✓ | ✓ | 0 | ✓ | 2 | changed:  |

### Eval — dashboard on codex-oss (gemma4)

Spec written 6/10 · valid 4/10 · output ok 4/10

| id | spec | valid | validate runs | output | seconds | notes |
|---|---|---|---|---|---|---|
| rev-by-region | ✗ | ✗ | 0 | ✗ | 81 |  |
| monthly-trend | ✓ | ✓ | 2 | ✓ | 124 |  |
| product-mix | ✓ | ✓ | 1 | ✓ | 86 |  |
| top-products | ✗ | ✗ | 0 | ✗ | 68 |  |
| kpi-row | ✓ | ✓ | 2 | ✓ | 153 |  |
| quarterly-grouped | ✓ | ✗ | 1 | ✗ | 114 | 1 errors: queries.by_quarter_region: Binder Error: Referenced column "%Y-Q" not found in FROM clause! Candidate bindings: "amount" |
| traffic-lines | ✗ | ✗ | 0 | ✗ | 25 |  |
| conversion | ✗ | ✗ | 0 | ✗ | 32 |  |
| overview | ✓ | ✓ | 3 | ✓ | 230 |  |
| edit-existing | ✓ | ✗ | 1 | ✗ | 111 | 1 errors: sources.sales.path: file not found: /var/folders/21/13cxm1hn5b1_crypz8r2mpzm0000gn/T/pa-eval-edit-existing-MMYLQG/data/sales.parquet; changed: title, sources.sales.type, sources.sales.path, queries.rev_by_region, queries.by_region, queries.total_units, kpis[0].id, kpis[0].title, kpis[1], charts[0].id, charts[0].query, charts[0].vegaLite.mark, charts[0].vegaLite.encoding.x.sort, charts[0].width, description, maxRows |

### Eval — motion on codex-oss (gemma4)

Spec written 8/10 · valid 7/10 · output ok 7/10

| id | spec | valid | validate runs | output | seconds | notes |
|---|---|---|---|---|---|---|
| q3-counter | ✗ | ✗ | 0 | ✗ | 17 |  |
| pipeline-steps | ✓ | ✓ | 4 | ✓ | 211 |  |
| signups-chart | ✓ | ✓ | 3 | ✓ | 200 |  |
| title-card | ✓ | ✓ | 0 | ✓ | 111 |  |
| milestone | ✓ | ✓ | 4 | ✓ | 236 |  |
| before-after | ✓ | ✗ | 0 | ✗ | 127 | 1 errors: (validate): /var/folders/21/13cxm1hn5b1_crypz8r2mpzm0000gn/T/pa-eval-before-after-5K8xum/motion.json is not valid JSON: Expected property name or '}' in JSON at position 1 (line 1 column 2)
 |
| roadmap-line | ✗ | ✗ | 0 | ✗ | 66 |  |
| quote-code | ✓ | ✓ | 1 | ✓ | 89 |  |
| square-social | ✓ | ✓ | 1 | ✓ | 235 |  |
| edit-existing | ✓ | ✓ | 0 | ✓ | 76 | changed: scenes[1].duration, scenes[1].elements[0].to, scenes[1].elements[0].keyframes[1].value |

### Eval — dashboard on copilot

Spec written 10/10 · valid 10/10 · output ok 10/10

| id | spec | valid | validate runs | output | seconds | notes |
|---|---|---|---|---|---|---|
| rev-by-region | ✓ | ✓ | 1 | ✓ | 38 |  |
| monthly-trend | ✓ | ✓ | 1 | ✓ | 44 |  |
| product-mix | ✓ | ✓ | 1 | ✓ | 40 |  |
| top-products | ✓ | ✓ | 1 | ✓ | 31 |  |
| kpi-row | ✓ | ✓ | 1 | ✓ | 31 |  |
| quarterly-grouped | ✓ | ✓ | 1 | ✓ | 52 |  |
| traffic-lines | ✓ | ✓ | 1 | ✓ | 29 |  |
| conversion | ✓ | ✓ | 1 | ✓ | 35 |  |
| overview | ✓ | ✓ | 1 | ✓ | 47 |  |
| edit-existing | ✓ | ✓ | 1 | ✓ | 28 | changed: queries.rev_by_region, queries.total_units, kpis[1], charts[0].vegaLite.mark |

### Eval — motion on copilot

Spec written 10/10 · valid 10/10 · output ok 10/10

| id | spec | valid | validate runs | output | seconds | notes |
|---|---|---|---|---|---|---|
| q3-counter | ✓ | ✓ | 1 | ✓ | 55 |  |
| pipeline-steps | ✓ | ✓ | 1 | ✓ | 86 |  |
| signups-chart | ✓ | ✓ | 1 | ✓ | 59 |  |
| title-card | ✓ | ✓ | 1 | ✓ | 46 |  |
| milestone | ✓ | ✓ | 1 | ✓ | 84 |  |
| before-after | ✓ | ✓ | 2 | ✓ | 78 |  |
| roadmap-line | ✓ | ✓ | 1 | ✓ | 82 |  |
| quote-code | ✓ | ✓ | 1 | ✓ | 77 |  |
| square-social | ✓ | ✓ | 1 | ✓ | 74 |  |
| edit-existing | ✓ | ✓ | 1 | ✓ | 49 | changed: scenes[1].duration, scenes[1].elements[0].to, scenes[1].elements[0].keyframes[1].value |

### Eval — dashboard on codex-oss (gemma4) (after SKILL.md fix)

Spec written 10/10 · valid 10/10 · output ok 10/10

| id | spec | valid | validate runs | output | seconds | notes |
|---|---|---|---|---|---|---|
| rev-by-region | ✓ | ✓ | 1 | ✓ | 92 |  |
| monthly-trend | ✓ | ✓ | 1 | ✓ | 74 |  |
| product-mix | ✓ | ✓ | 1 | ✓ | 83 |  |
| top-products | ✓ | ✓ | 1 | ✓ | 83 |  |
| kpi-row | ✓ | ✓ | 1 | ✓ | 77 |  |
| quarterly-grouped | ✓ | ✓ | 1 | ✓ | 99 |  |
| traffic-lines | ✓ | ✓ | 1 | ✓ | 88 |  |
| conversion | ✓ | ✓ | 1 | ✓ | 101 |  |
| overview | ✓ | ✓ | 1 | ✓ | 141 |  |
| edit-existing | ✓ | ✓ | 1 | ✓ | 148 | changed: queries.total_units, kpis[1], charts[0].vegaLite.mark |

### Eval — motion on codex-oss (gemma4) (after SKILL.md fix)

Spec written 5/10 · valid 4/10 · output ok 4/10

| id | spec | valid | validate runs | output | seconds | notes |
|---|---|---|---|---|---|---|
| q3-counter | ✓ | ✗ | 0 | ✗ | 96 | 2 errors: scenes[0].elements[1].x: required |
| pipeline-steps | ✓ | ✓ | 1 | ✓ | 99 |  |
| signups-chart | ✗ | ✗ | 0 | ✗ | 54 |  |
| title-card | ✓ | ✓ | 1 | ✓ | 117 |  |
| milestone | ✗ | ✗ | 0 | ✗ | 48 |  |
| before-after | ✗ | ✗ | 0 | ✗ | 43 |  |
| roadmap-line | ✗ | ✗ | 0 | ✗ | 42 |  |
| quote-code | ✗ | ✗ | 0 | ✗ | 43 |  |
| square-social | ✓ | ✓ | 2 | ✓ | 146 |  |
| edit-existing | ✓ | ✓ | 2 | ✓ | 113 | changed: scenes[1].duration, scenes[1].elements[0].to, scenes[1].elements[0].keyframes[1].value |
