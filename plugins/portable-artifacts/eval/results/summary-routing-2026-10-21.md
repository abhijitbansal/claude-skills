# Cheap-model routing run: GitHub Copilot CLI (2026-10-21)

Measured on this macOS machine (Node 24.x), 2026-10-21, with `GitHub Copilot CLI 1.0.98`.
The question: does Copilot CLI honour the `model:` key of the `artifact-builder` agent file, and can that agent build all five skills' specs on the cheap model?

## Setup (exact)

Agent file installed with:

`node plugins/portable-artifacts/bin/install.mjs copilot --agents-only`

It wrote `~/.copilot/agents/artifact-builder.agent.md`, whose frontmatter is `model: ['Claude Haiku 5.5', 'GPT-5.4 nano']`.

Each eval case ran as `copilot -p "<prompt>" --allow-all-tools --agent artifact-builder` in a temp project (the harness builds that command from the line below).

## Commands (exact)

`node eval/run-eval.mjs --skill <s> --host copilot --agent artifact-builder [--limit N]`

- Smoke: `<s>` = dashboard (1 run, then 2 runs), diagram, explainer, scene (2 runs each, `--limit 2`).
- Motion gate: `<s>` = motion, all 10 prompts of `eval/prompts/motion.json`.

The pass rule set before the motion run: at least 8 of 10 prompts valid and built.

## Results

Source for every table: the harness's own `summary.md` per run (raw files in the run's scratch folder); the smoke rows are compiled from the five smoke runs.

### Smoke: dashboard, diagram, explainer, scene (9 runs, 9/9 spec written, valid and output ok)

| skill | id | spec | valid | validate runs | output | seconds | model reported |
|---|---|---|---|---|---|---|---|
| dashboard (first run, `--limit 1`) | rev-by-region | ✓ | ✓ | 3 | ✓ | 23 | claude-haiku-5.5 |
| dashboard | rev-by-region | ✓ | ✓ | 2 | ✓ | 25 | claude-haiku-5.5 |
| dashboard | monthly-trend | ✓ | ✓ | 1 | ✓ | 17 | claude-haiku-5.5 |
| diagram | checkout-path | ✓ | ✓ | 2 | ✓ | 24 | claude-haiku-5.5 |
| diagram | password-reset | ✓ | ✓ | 2 | ✓ | 27 | claude-haiku-5.5 |
| explainer | recap-from-repo | ✓ | ✓ | 2 | ✓ | 36 | claude-haiku-5.5 |
| explainer | test-checklist | ✓ | ✓ | 2 | ✓ | 39 | claude-haiku-5.5 |
| scene | city-inline | ✓ | ✓ | 2 | ✓ | 27 | claude-haiku-5.5 |
| scene | forest-parent | ✓ | ✓ | 1 | ✓ | 22 | claude-haiku-5.5 |

Validate runs per case ranged from 1 to 3 in the smoke table above.

### Motion gate: all 10 prompts

Spec written 10/10 · valid 10/10 · output ok 10/10. Validate runs per case 1-4 (median 2); 26-57 s per case. Pass rule (at least 8 of 10 valid and built): **PASSED**.

| id | spec | valid | validate runs | output | seconds | model reported | notes |
|---|---|---|---|---|---|---|---|
| q3-counter | ✓ | ✓ | 2 | ✓ | 33 | claude-haiku-5.5 |  |
| pipeline-steps | ✓ | ✓ | 2 | ✓ | 47 | claude-haiku-5.5 |  |
| signups-chart | ✓ | ✓ | 4 | ✓ | 57 | claude-haiku-5.5 |  |
| title-card | ✓ | ✓ | 1 | ✓ | 26 | claude-haiku-5.5 |  |
| milestone | ✓ | ✓ | 2 | ✓ | 45 | claude-haiku-5.5 |  |
| before-after | ✓ | ✓ | 2 | ✓ | 42 | claude-haiku-5.5 |  |
| roadmap-line | ✓ | ✓ | 2 | ✓ | 37 | claude-haiku-5.5 |  |
| quote-code | ✓ | ✓ | 2 | ✓ | 43 | claude-haiku-5.5 |  |
| square-social | ✓ | ✓ | 3 | ✓ | 39 | claude-haiku-5.5 |  |
| edit-existing | ✓ | ✓ | 1 | ✓ | 35 | - | changed: scenes[1].duration, scenes[1].elements[0].to, scenes[1].elements[0].keyframes[1].value |

`model reported` is claude-haiku-5.5 for 9 of 10 cases. The edit-existing case reports `-` because the agent did not set `generatedBy` when it edited an existing spec. That column comes from the spec the agent wrote, so it is the agent's own claim; the next section checks it independently.

## Independent check of which model ran

Copilot's own process logs (`~/.copilot/logs`) for these 19 runs (9 smoke + 10 motion) contain 19 lines of the form:

`Using model "claude-haiku-5.5" from custom agent "artifact-builder" (resolved from "Claude Haiku 5.5")`

The same logs show what would have run without the agent: `Using default model: claude-sonnet-5.5`. So the `model:` key in the agent file is honoured by Copilot CLI 1.0.98 together with `-p` and `--agent`.

## Delegation trial (skill hands off to the agent): 1 run, no retries

Command, in a temp project installed with `node plugins/portable-artifacts/bin/install.mjs copilot --project <dir> --link --no-deps --skills make-explainer`, on Copilot's default model (claude-sonnet-5.5):

`copilot -p "/make-explainer a one-page concept explainer of how a CDN serves a request. Save the spec as ./cdn.explainer.json and build it to ./cdn.html" --allow-all-tools`

What the session log (`~/.copilot/session-state/<id>/events.jsonl`) shows:

1. The main agent read the new "Cheaper model" block of SKILL.md and decided to hand off ("the skill instructions say to delegate to it. I should put together a self-contained brief").
2. It started `artifact-builder`, which ran on claude-haiku-5.5 and obeyed the loop guard ("I'm artifact-builder and shouldn't delegate further").
3. **The sub-agent then failed.** Its bash and view tools both returned `Permission denied because no interactive user response was available` when it tried to read the skill file. The skill was a `--link` symlink pointing outside the project folder. The cause is not verified; a copy (non-link) install was not tried.
4. The main agent said so and finished the work itself: validate passed and `./cdn.html` was written.

Outcome: the hand-off happened and the fallback worked, but the hand-off did not achieve its result in this run. The page was built by the default model, not by the cheap one.

Measured for this trial: 34 s, 18.7 AI Credits (about $0.19 at 1 credit = $0.01), 432k input tokens (353k cached), 4.2k output tokens.

## Cost

- Only the delegation trial was measured: 18.7 AI Credits (above).
- The cost of the smoke runs and of the motion runs was **not measured**.
- GitHub moved Copilot to token-based AI Credits billing in 2026 (1 credit = $0.01). Claude Haiku 5.5 is listed at $0.10 / $0.50 per 1M input / output tokens. claude-sonnet-5.5 is not priced in the sources used here, so no saving is claimed.

## Not tested

- Codex: no account here. The Codex agent file (`~/.codex/agents/artifact-builder.toml`) was written from the Codex docs only and never run.
- VS Code Copilot Chat (the agent picker and skill hand-off there).
- Copilot CLI `--agent` selection by any route other than the `--agent` flag.
- A copy (non-link) install for the delegation trial, so the permission denial above is unexplained.
- Claude Code and Gemini: they get no agent file. Claude Code is documented to apply a skill's `model:` frontmatter; that was not measured here. The earlier make-scene run ([`summary-scene-2026-10-19.md`](summary-scene-2026-10-19.md)) pinned Haiku with `--model haiku`, which is a different path from the frontmatter key. Motion on Haiku in Claude Code itself was not measured either (the gate above measured Copilot's claude-haiku-5.5).
- A baseline of the same prompts on Copilot's default model: the motion gate passed, so the planned no-agent comparison run was not made.
