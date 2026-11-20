# Director and operator on Claude Code: make-motion, ten cases, one run (2026-11-18)

One run of each case, none repeated. One sample per cell, so a pass is one sample.

**Sources.** Every figure about who did what, which model ran, the agent name, the setup and the cost is "measured: read
from the session stream by `eval/session.mjs`" (the `--output-format stream-json` transcript of each case). Two other
kinds are labelled where they appear: `valid` and `check` come from the harness's own `make.mjs --outline` and
`--sheets-only` runs after the case (`eval/lib.mjs`, not the stream), and `seconds` is the harness's wall clock for the
host command. `model reported` (`generatedBy.model`) is the agent's own claim and is not used as evidence.

## Commands and setting

| | |
|---|---|
| Date | 2026-11-18 |
| Claude Code | 2.1.327 (`claude --version`); the session's init event reports the same |
| Host | `claude-director` (`eval/hosts.json`): `claude -p … --permission-mode acceptEdits --output-format stream-json --verbose --forward-subagent-text --include-hook-events --setting-sources project --allowedTools Read Write Edit Glob Grep Agent Task Bash(node:*) Bash(npm:*) Bash(ls:*) Bash(cat:*) Bash(echo:*) Bash(pwd:*) Bash(head:*) --max-budget-usd 2` |
| Pilot | `node plugins/portable-artifacts/eval/run-eval.mjs --skill motion --host claude-director --only statement-hook --budget 2 --out <W>/.scratch/director-operator/eval` |
| Other nine, one run | `node plugins/portable-artifacts/eval/run-eval.mjs --skill motion --host claude-director --only number-kpi,clipping-highlight,list-steps,quote-card,compare-two,chart-bar,viral-vertical,voiced-pro,edit-existing --budget 2 --out <W>/.scratch/director-operator/eval-nine` (a second `--out` so the pilot's `results.json` was not overwritten) |
| Spend cap | `--max-budget-usd 2` per case, set by the owner's approval; no case came near it (largest $0.81) |
| Director model | none named: the account default (`claude-opus-5-5`, from the stream) |
| Prompts | `prompts/motion.json`, version 2 prompts; the harness writes `.claude/agents/artifact-builder.md` (the `claude` builder of `shared/agents.mjs`) into each workdir; the prompt ends "follow the skill's Director and operator section; stop when the build is done" |

## Preconditions (checked before the pilot)

- **Tree.** `git status --short` was not empty: README.md, USAGE.md and docs/features/portable-artifacts.html were modified (the Task 10 document edits, not part of this run and not read by it). No file under `plugins/` was modified, so the eval ran on committed code. Deviation from "empty", recorded.
- **Dependencies.** `npm ci --ignore-scripts` was not re-run: `skills/make-motion/node_modules` was already present and `doctor.mjs` reported no required item missing. `doctor.mjs` ran with exit 0: Chromium and ffmpeg (8.1.1) present; one optional item, `builder_agent`, reported the user's Copilot agent file as outdated (not used by this run).
- **Browsers.** `pgrep -x chrome-headless-shell` listed nothing before the pilot and before the nine.
- **Claude Code.** 2.1.327.

## Setup that was live (decision 14: isolate)

| Item | What the stream shows |
|---|---|
| Setting sources | The init event does **not** list them. The flag `--setting-sources project` was passed (command above) |
| Plugins | Four `builtin` ones in every case: `cc-plugin-agents-md`, `cc-plugin-telemetry`, `cc-plugin-privacy`, `cc-plugin-plugin-authoring`; `cc-plugin-easel` (also `builtin`) in two cases (`clipping-highlight`, `chart-bar`). No user plugin |
| Hooks | No hook event of any kind in any of the ten streams (only `init`, `thinking_tokens`, `task_*`, and one `permission_denied`); no user hook fired |
| Agents listed | `artifact-builder` (the workdir file, **no plugin prefix**), `claude`, `Explore`, `general-purpose`, `Plan`, `statusline-setup`. None of the user's own agents |
| Skills listed | Claude Code's bundled ones only (pilot init event) |
| Models that ran | Only `claude-opus-5-5` and `claude-haiku-5-5` in each case's `modelUsage`; no Sonnet |

**A leak found and fixed before the first billed call.** This machine's shell exports `CLAUDE_CODE_SUBAGENT_MODEL=sonnet`.
`--setting-sources project` does not remove an environment variable, and it would have set the operator's model for every
case, which is the override decision 14 isolates against. The harness now drops `CLAUDE_CODE_SUBAGENT_MODEL` and
`ANTHROPIC_MODEL` from a `claude-director` case's environment (`MODEL_ENV_VARS` in `eval/lib.mjs`, passed by
`run-eval.mjs`); a test fails without it and a second test shows the plain `claude` host still passes the environment
through. All ten cases ran with the fix.

## Per case

`valid` = the harness's own `make.mjs --outline` passes; `check` = its `--sheets-only` report is `ok` (both ✓ in all ten). `make by` counts every `make.mjs` build run in the stream (director runs are `--sheets-only` or a full `--json` run; `--list` and `--outline` calls are looks, not builds, and are not counted). Cost is the stream's `total_cost_usd` (list-price basis; the stream reports `apiKeySource: none`, so this is not a statement about what the account was charged). The director requested no model for the operator in any case.

| Case | valid | first build valid | spec by | make by | sheets viewed by | operator model | director requested | director model | seconds | cost USD |
|---|---|---|---|---|---|---|---|---|---|---|
| statement-hook (pilot) | ✓ | ✓ ¹ | director ×1 | operator ×1 | director ×3 | claude-haiku-5-5 | none | claude-opus-5-5 | 53 | 0.398 |
| number-kpi | ✓ | ✗ | director ×10 | operator ×2, director ×5 | director ×3 | claude-haiku-5-5 | none | claude-opus-5-5 | 169 | 0.808 |
| clipping-highlight | ✓ | ✓ | director ×1 | operator ×1 | director ×2 | claude-haiku-5-5 | none | claude-opus-5-5 | 67 | 0.436 |
| list-steps | ✓ | ✓ | director ×1 | operator ×1 | director ×1 | claude-haiku-5-5 | none | claude-opus-5-5 | 53 | 0.343 |
| quote-card | ✓ | ✓ | director ×1 | operator ×1 | director ×1 | claude-haiku-5-5 | none | claude-opus-5-5 | 50 | 0.359 |
| compare-two | ✓ | ✓ | director ×1 | operator ×1 | director ×1 | claude-haiku-5-5 | none | claude-opus-5-5 | 59 | 0.385 |
| chart-bar | ✓ | ✓ | director ×4 | operator ×2 | director ×7 | claude-haiku-5-5 | none | claude-opus-5-5 | 111 | 0.573 |
| viral-vertical | ✓ | ✓ | director ×2 | operator ×1, director ×1 | director ×5 | claude-haiku-5-5 | none | claude-opus-5-5 | 89 | 0.611 |
| voiced-pro | ✓ | ✓ | director ×2 | operator ×1, director ×1 | director ×3 | claude-haiku-5-5 | none | claude-opus-5-5 | 123 | 0.447 |
| edit-existing | ✓ | ✓ | director ×1 | operator ×1 | director ×2 | claude-haiku-5-5 | none | claude-opus-5-5 | 41 | 0.302 |

¹ The pilot's own `results.json` recorded `first build valid -` and `make by director+operator×3`: the parser then counted
the director's `make.mjs --list kinds` and `--outline` calls as make steps. That was a bug in this plan's Task 8 work. It
was fixed after the pilot, with a test, and the pilot's stream was re-read with the fixed parser to give the row above.
The pilot's first-run figure is the one in `.scratch/director-operator/eval/claude-director-motion/results.json`.

## Totals (measured: read from the session stream by `eval/session.mjs`, except as marked)

| Count | Result |
|---|---|
| Cases valid (harness) | 10 of 10 |
| Cases where the director delegated to `artifact-builder` | 10 of 10 |
| Cases with no delegation | none |
| Cases where the operator wrote the spec | 0 of 10 (every spec write and edit is the director's) |
| Cases where the operator viewed a sheet | 0 of 10 (every view is the director's) |
| Cases where the operator ran the build | 10 of 10 |
| First build valid | 9 of 10 (`number-kpi` ✗) |
| Operator model | `claude-haiku-5-5` in 10 of 10; director requested a model in 0 of 10 |
| Director model | `claude-opus-5-5` in 10 of 10 |
| Cases that hit the cap | 0 of 10 |
| Total cost (stream, list basis) | **$4.66** (ten cases, sum of `total_cost_usd`: 4.663); the largest $0.81, the smallest $0.30 |
| Of which the operator model | about $0.011 (sum of the Haiku `costUSD` in each `modelUsage`), 0.2% |

Against the README's default bar for a new run (`ceil(0.9 × n)` valid): 9 of 10 required, 10 of 10 valid. `validate runs`
reads 0 in every row because make-motion's check is `make.mjs`, not `validate.mjs`; it says nothing about retries.

## What happened that the table does not show

- **`number-kpi` (first build ✗).** The operator's first run came back `ok: false`; it reported back. The director then took over: it edited the spec, ran `make.mjs --json --sheets-only` five times itself (four ✗, then ✓), and delegated a second time to `artifact-builder` for the final render (✓). This is the take-over the section prescribes; it is also why this case cost twice the others. One command was refused (`permission_denied`, a `grep` with a regex, "This command requires approval") and the director went on.
- **`viral-vertical`, `voiced-pro`.** After viewing the sheets the director edited the spec and ran the full `make.mjs --json` itself instead of delegating the rebuild once more. Whether that is right under the section's text was not judged here.
- **The agent name.** The stream lists `artifact-builder` with no plugin prefix, because the harness puts the agent file in the workdir (decision 10). The `portable-artifacts:artifact-builder` form of a plugin install was not seen.
- **The tool name.** The delegating tool's calls are named `Agent`; the init event's tool list says `Task`. Both stay in the host's `--allowedTools` and the parser.
- **Setting sources** are not in the stream, so "isolated" rests on the flag plus the absence of user plugins, user agents, hook events and a Sonnet model in the stream.

## Not shown by this run

Nothing here measures whether the films are good (the sheets were viewed by the director model and not by a person), the
other four skills, a plugin install of the agent, or any host other than Claude Code. Codex and Copilot: install tests and documents only, not run live.
