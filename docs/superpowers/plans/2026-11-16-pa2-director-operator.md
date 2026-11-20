# portable-artifacts 2: Director and Operator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In all five skills the session model directs (intake, spec, viewing, creative decisions) and a cheap model operates (one command, mechanical fixes only). No `SKILL.md` pins a model. Every skill has `scripts/make.mjs <spec> --json` printing one report. Claude Code gets a plugin agent file pinned to Haiku; Codex and Copilot get rewritten agent files. A small billed run on Claude Code reports, from the session's own records, first-build validity, who ran each stage and the operator's model.

**Architecture:** Three layers. (1) A shared report module and a `make.mjs` per skill that runs the skill's existing scripts as child processes and maps their output to one report; make-motion's `make.mjs` already exists and sets the shape. (2) One operator instruction text in `shared/agents.mjs`, rendered into three host formats, shipped as a plugin agent file for Claude Code and written by the installer and the doctor for the others. (3) One `## Director and operator` section, identical in the five `SKILL.md` files, describing the hand-off ladder. The eval harness then learns to read a Claude Code session stream so the evidence does not rest on what the agent says about itself.

**Tech Stack:** Node 20 or later, `node:test`, the Claude Code CLI for the billed run. No new npm dependency.

**Spec:** `docs/superpowers/specs/2026-11-15-portable-artifacts-2-design.md` section 10 (binding), section 12 (authoring support, as context), section 15 step 7 (this plan) and step 10 (the billed eval), section 18 ("delegation silently not happening"). Order: `docs/superpowers/plans/2026-11-16-pa2-cutover.md` decision 7 leaves the pin and the `## Cheaper model` block for this plan, and its Task 5 writes make-motion's version 2 `SKILL.md`.

Abbreviations: `P` = `plugins/portable-artifacts`, `D` `G` `E` `S` `M` = `P/skills/make-dashboard`, `make-diagram`, `make-explainer`, `make-scene`, `make-motion`, `W` = the worktree root. Inventory read at commit `c8c1d659`; nothing was run except `claude --help` and five example builds.

## What was found

| Where | Today | Consequence |
|---|---|---|
| `SKILL.md` lines 5 and 6 of all five skills | `model: haiku`, `effort: low` | All five are pinned, not only make-motion. `P/README.md:244` says so too |
| `P/bin/test/delegation.test.mjs` | Three tests: `:23-35` each skill has a `## Cheaper model` section, first `##` heading, with eight phrases (`artifact-builder`, `self-contained brief`, `skill directory`, `unless you are already artifact-builder`, `spec path`, `output folder`, `Claude Code`, `list of available agents`); `:37-41` the text is identical in all five; `:43-47` make-motion's frontmatter has `model: haiku` and `effort: low` | All three are rewritten |
| `P/bin/test/intake.test.mjs:104` | "the opening paragraph sends the agent to the intake before Cheaper model" | Follows the heading rename |
| `P/bin/test/portability.test.mjs`, `frontmatter.test.mjs` | Host-neutral text; strict single-line frontmatter | Constrain the new section and the frontmatter edit |
| The `## Cheaper model` section (`G/SKILL.md:17-28`, same in all five) | "Skip this section if you are running in Claude Code (it already runs this skill on the model named in the frontmatter)". The brief asks the agent to write the spec and says the output folder goes "to the build script as `--out`" | Opposite of the design: the cheap model writes the spec, and Claude Code never delegates |
| `P/shared/agents.mjs:13-25` | The description and `INSTRUCTIONS`: "Reads the named SKILL.md, writes the spec JSON, runs validate and build"; "Run the skill's validate script on the spec, then its build script" | **The builder brief bug.** make-motion has no build script (`render.mjs` today, `make.mjs` after the cut-over), and the operator must not write the spec |
| `P/shared/agents.mjs:30-53` | Builders for `copilot` (`artifact-builder.agent.md`, model list `['Claude Haiku 5.5', 'GPT-5.4 nano']`) and `codex` (`artifact-builder.toml`, `gpt-6-luna`, low effort) | No Claude Code builder |
| `P/` | No `agents/` folder; `P/.claude-plugin/plugin.json` names none | **The missing Claude agent file** |
| `P/bin/install.mjs:40-44` | Agent folders for `copilot` and `codex` only; `claude` and `gemini` get none | `P/bin/test/install.test.mjs:358`, `:416` and `:602` assert that |
| `P/shared/doctor.mjs:442-480` | Requirement `builder_agent` knows two file names (`:450`) and fixes through the skill's own `shared/agents.mjs` | No Claude file; an old file is "present" and never replaced |
| `M/scripts/make.mjs`, `M/scripts/v2/run.mjs`, `report.mjs` | Report keys `ok, output, sheets, timed, voice, audio, post, capture, stages, frames, captured, seconds, msPerFrame, bytes, mbps, findings` and `error: { message, hint }`. A stage is `{ name, ok, seconds }`; names `validate`, `voice`, `timeline`, `sound`, `review`, `render`. A finding is `{ kind, shot, path, message, t }`. Exit 0, 1, 2, 130. No doctor stage, no `fix` field, no `EVAL_LOG` line | The shape the other four match. The design's "doctor" stage and `fix?` do not exist in it yet |
| `D`, `G`, `E`, `S` `scripts/` | `validate.mjs` and `build.mjs` in all four (`--json`, exit 0, 1, 2; `validate.mjs` writes `EVAL_LOG`); `check.mjs` in `G`, `E`, `S` (exit 0 for ok or skipped, 1 for problems); `doctor.mjs` in all four. No `make.mjs` | `D` has no `check.mjs` on this branch |
| `P/eval/hosts.json`, `lib.mjs`, `run-eval.mjs` | The `claude` host runs `claude -p {prompt} --permission-mode acceptEdits --allowedTools Read Write Edit Glob Grep Bash(node:*) Bash(npm:*) Bash(ls:*) Bash(cat:*)`; the transcript is plain stdout; the workdir holds skill folders only; the `model reported` column is `generatedBy.model` from the spec | The harness cannot see a delegation: no subagent tool is allowed, no agent file is present, and the only model evidence is self-reported |
| `P/README.md:242-248`, `P/USAGE.md:106-143` | "Cheaper model on Copilot and Codex", with the 2026-10-21 Copilot measurements | Describe the old scheme and the old agent text |
| The branch `docs/skill-improvement-plan` (main checkout) | Changes `P/shared/agents.mjs`, `doctor.mjs`, `cli.mjs`, `provenance.mjs` and all four `build.mjs`; adds a `check.mjs` to `D` | This plan edits the same files |

## Decisions for the controller

Each has a default this plan is written to. Change the default before dispatching the task named.

| # | Question | Default | Alternative | Task |
|---|---|---|---|---|
| 1 | When does this run relative to the cut-over? | After cut-over Task 5 (make-motion's version 2 `SKILL.md` exists). Tasks 1 to 5 here do not touch make-motion and may start earlier | Run Task 7 for the four skills first and make-motion's part after the cut-over; the "identical in five" test is then red in between | 7, 9 |
| 2 | Does `docs/skill-improvement-plan` land first? | Yes, as its own reviewed step, before Task 0 (the same call as decision 1 of the refresh plan) | No; this plan's edits to `agents.mjs`, `doctor.mjs` and the four `scripts/` folders will conflict later | 0 |
| 3 | Remove `effort: low` with `model: haiku`? | Remove both from all five. A director pinned to low effort is still a pinned director | Remove `model` only | 7 |
| 4 | Claude Code users who installed with `install.mjs claude` or the skills CLI (no plugin, so no plugin `agents/`) | `shared/agents.mjs` gains a `claude` builder; `install.mjs claude` writes `.claude/agents/artifact-builder.md`; the doctor knows it. The plugin's `P/agents/artifact-builder.md` is the same text, held equal by a test | Plugin file only; other installs fall to rung 3 (the director runs the command) | 6 |
| 5 | The agent's name on Claude Code | The section says to start the agent whose name is `artifact-builder` or ends with `:artifact-builder` (a plugin agent is listed with its plugin's prefix). The pilot run in Task 9 records the name the session actually listed | Hard-code `portable-artifacts:artifact-builder` | 7, 9 |
| 6 | Operator model names for Copilot and Codex | Keep the strings in `agents.mjs` as they are; they were not rechecked (no network) and the docs say "not run live" | Recheck against the hosts' model lists before the pull request | 6 |
| 7 | Does make-motion's `make.mjs` change? | No. The other four match its core (`ok`, `output`, `stages`, `findings`, `error`, exit codes). `fix` is optional and appears only where a validator has a suggestion. A contract test covers all five | make-motion adopts the shared report module and gains a `doctor` stage | 1, 5 |
| 8 | A `check` stage for make-dashboard | Stages `doctor`, `validate`, `build`. A `check` stage is added when `D/scripts/check.mjs` exists (decision 2) | Write a check for `D` here | 2 |
| 9 | Which findings are mechanical | Validator errors, build errors and check problems that name a JSON path are `mechanical`; validator and lint warnings and check advisories are `creative`. Each skill's task writes the table from the script's real rule ids and tests it | Everything a script reports is mechanical | 2 to 5 |
| 10 | How the eval makes the agent available | The harness writes `.claude/agents/artifact-builder.md` into each workdir from the `claude` builder (the brief's skill path is then the workdir copy) | `--plugin-dir <P>`, which is the shipped path but loads the skills from the checkout, not the workdir | 8 |
| 11 | The spend cap | `--max-budget-usd 2` per case, one pilot case first, nine more only if the pilot's evidence parses. The figure is an estimate of an upper bound, not a measurement; the owner approved "one small run" without a number | Another cap, named by the owner | 9 |
| 12 | The director's model in the eval | No `--model` flag: the account's default, which is what a user gets. The stream's first event records it. `P/eval/README.md`'s `--model haiku` example is not used: it would put the director on Haiku | Pin `--model` to a named model | 9 |
| 14 | Does the billed run load the owner's own Claude Code setup? | On this machine `claude -p` loads the user-level instructions and hooks: a global rule to set the model on every agent dispatch, `CLAUDE_CODE_SUBAGENT_MODEL=sonnet`, a session hook that asks for multi-agent workflows, and several plugins. A model named on the delegating call overrides the agent file's `model: haiku`. Default: isolate. The `claude-director` host passes `--setting-sources project` so only the workdir's `.claude/` is read; the pilot confirms the workdir agent file is still listed and that no user hook fired, and the summary names the setting sources that were live | Run with the owner's full setup and report it as "this machine's configuration", with the override visible in the record | 8, 9 |
| 15 | What the director views in the four page skills | make-motion's report lists `sheets`. The four page skills report only `output`. Default: the section tells the director to view the built page with the skill's screenshot helper when one exists (`shared/shot.mjs`, present only if decision 2's default held) and otherwise to open `output`; `make.mjs` does not take screenshots itself | Add a `--shots` flag to the four `make.mjs` that runs `shot.mjs` and reports `shots: []` | 2 to 5, 7 |
| 13 | Agent files already on users' machines | `writeAgentFile` keeps an existing file. The doctor reports a file without the text `make.mjs` as outdated and prints the command that replaces it (`install.mjs <host> --agents-only --force`); it never overwrites by itself | `doctor --fix builder_agent` replaces a file whose bytes equal a previously shipped text | 6 |

## Global Constraints

- make-motion's engine, `scripts/v2/` and report are not planned or changed here (decision 7). This plan edits `M/SKILL.md` only, after the cut-over.
- `make.mjs` in the four skills runs the existing scripts; it does not copy their logic. SQL handling, provenance flags, CSP and every validator rule stay where they are.
- Agent-facing surface rules (`~/.claude/rules/ecc/common/agent-autonomy.md`): `make.mjs` rejects an unknown flag with the accepted ones listed, never opens a dialog, never waits for input, never installs anything (the `doctor` stage is read-only), and with `--json` prints exactly one JSON object on stdout on every path, progress on stderr.
- The `SKILL.md` frontmatter keeps `name`, `description` and `argument-hint` byte for byte. Only the `model` and `effort` lines go. `description` stays one line (the registry parser truncates folded scalars).
- The `## Director and operator` section is byte-identical in all five skills and host-neutral in the sense of `P/bin/test/portability.test.mjs` (read its rules before writing the text).
- Edit `P/shared/` only, then `node W/plugins/portable-artifacts/bin/sync-shared.mjs`, then `--check`.
- Nothing in Tasks 0 to 8 calls a billed host. Task 9 is the only billed step, runs once, and stops at its cap.
- Codex and Copilot are never run live in this plan. Every sentence about them says "install-tested, not run live".
- The evidence is read from the session's records. `generatedBy.model`, an agent's own prose and the `model reported` column are never cited as proof of which model ran.
- One browser-heavy run at a time (`pgrep -fl chrome-headless-shell` first). A `make.mjs` with a `check` stage starts a browser; tests that reach it are not run in parallel with any other browser suite.
- Shell rules of this worktree: one plain command per call, literal absolute paths, no `cd`, no variables, loops or heredocs.
- Implementers do not commit. The controller commits one task per commit, pushes the branch, never force-pushes, never merges.
- Repo rules that bind: files under 800 lines, functions under 50, tests first, a guard shown failing before it is trusted, counts only through `python3 scripts/sweep_counts.py`.

## Review Focus

1. **The operator can only operate.** Its text never tells it to write a spec, choose a theme or look, or reword content. On Claude Code its `tools` list has no subagent tool and no `Write`, so it cannot delegate again or create a spec.
2. **One text, four places.** The instruction text exists once (`shared/agents.mjs`); the plugin file, the three installed files and the doctor's writer all come from it, and a test fails on drift.
3. **Report honesty.** `ok` is true only when validation passed, no stage failed, and no `mechanical` finding exists. A skipped check is a stage with `skipped: true`, never `ok` by omission. `output` is null unless the file exists.
4. **Exit codes.** 0, 1, 2 and 130 mean in the four skills what they mean in make-motion; each is pinned by a test per skill.
5. **Nothing was loosened to pass.** `delegation.test.mjs` keeps its three kinds of guard (section present, identical, frontmatter) with new content; `install.test.mjs` keeps every symlink, `--force` and unwritable-folder test.
6. **The eval reads records.** The parser's fixtures come from a real stream captured in the pilot; a case with no delegation is reported as "director ran it", not dropped.
7. **Claims in documents.** README and USAGE state what was run, on which host, on which date, and label everything else.

## File Structure

| File | Change | Task |
|---|---|---|
| new `P/shared/make-report.mjs`, `P/shared/test/make-report.test.mjs` | Stage recorder, findings, report, exit codes, the eval log line | 1 |
| new `D/scripts/make.mjs`, `D/test/make.test.mjs` | The one command | 2 |
| new `G/scripts/make.mjs`, `G/test/make.test.mjs` | The one command | 3 |
| new `E/scripts/make.mjs`, `E/test/make.test.mjs` | The one command | 4 |
| new `S/scripts/make.mjs`, `S/test/make.test.mjs`; new `P/eval/test/make-contract.test.mjs` | The one command; the five-skill contract | 5 |
| `P/shared/agents.mjs`, `P/shared/test/agents.test.mjs`, new `P/agents/artifact-builder.md`, `P/bin/install.mjs`, `P/bin/test/install.test.mjs`, `P/shared/doctor.mjs`, `P/shared/test/doctor.test.mjs` | The operator text, three host formats, the plugin agent file, install and doctor | 6 |
| the five `SKILL.md`, `P/bin/test/delegation.test.mjs`, `intake.test.mjs` | No pin; the new section | 7 |
| `P/eval/hosts.json`, `lib.mjs`, `run-eval.mjs`, `test/lib.test.mjs`, new `P/eval/session.mjs`, `test/session.test.mjs`, `P/eval/README.md` | A host that streams the session; the evidence parser | 8 |
| new `P/eval/results/summary-director-operator-<date>.md` | The billed run's record | 9 |
| `P/README.md`, `P/USAGE.md`, `P/CHANGELOG.md`, each skill's `README.md` | The new scheme, with labels | 10 |

The five skills' `shared/` copies change through `sync-shared.mjs`.

## Interfaces

**The report (all five skills).** Core keys, always present: `ok` (boolean), `output` (absolute path or null), `stages` (array of `{ name, ok, seconds }`, plus `skipped: true` on a stage that could not run for want of a browser), `findings` (array of `{ kind, path, message }` plus optional `fix`). `error: { message, hint }` only when the machine or the command line stopped the run. `kind` is `mechanical` or `creative`. make-motion keeps its extra keys and its extra finding fields (`shot`, `t`).

**Exit codes.** 0: valid and no mechanical finding. 1: invalid, or a mechanical finding (the output is still written when the build ran). 2: usage or machine trouble (`error` says which). 130: interrupted.

**`P/shared/make-report.mjs`** (pure except the log line)

- `EXIT`: `{ OK: 0, NOT_OK: 1, MACHINE: 2, INTERRUPTED: 130 }`.
- `newRun()` returns the run state.
- `runStage(state, name, fn, log)`: awaits `fn`, records `{ name, ok, seconds }`; a result of `{ skipped: true }` records `ok: true, skipped: true`; a throw records `ok: false` and rethrows.
- `finding(kind, path, message, fix)` returns the object without `fix` when `fix` is undefined; throws on an unknown `kind`.
- `reportOf(state)` and `exitCodeOf(report)`.
- `logMake(report)`: when `EVAL_LOG` is set, appends `{ ts, command: "make", ok, mechanical, creative }`; never throws.

**`<skill>/scripts/make.mjs`** (`D`, `G`, `E`, `S`)

`node scripts/make.mjs <spec> [--out <path>] [--json] [--no-check] [--theme <name>] [--model <m>] [--effort <e>] [--agent <a>]` plus the pass-through flags the skill's own `validate.mjs` and `build.mjs` already take (`--allow-outside`, `--timeout` in `D`; `--world`, `--allow-outside` in `S`; `--image-api` in `E`). Stages, in order: `doctor` (required items only, no fix), `validate`, `build`, `check` (where the skill has one, unless `--no-check`). A failed `validate` stops before `build`. Each stage runs the existing script as a child process with `--json` and maps its result.

**The operator text** (`INSTRUCTIONS` in `shared/agents.mjs`). Inputs in the brief: the skill directory, the spec path (the file already exists), optionally an output path. The text says, in this order: you are already artifact-builder and never delegate; run `node <skill-dir>/scripts/make.mjs <spec> --json` (with `--out` when given); if the report has `mechanical` findings, change only the JSON paths they name (use `fix` when present), rerun, at most two fix rounds; never create a spec, never change wording, theme, look, layout or data, never act on a `creative` finding; reply with only the last report as JSON. If the command cannot run, reply with its error line and stop.

**Agent files.** `agentFile('claude')` returns `{ fileName: 'artifact-builder.md', content }` with frontmatter `name: artifact-builder`, a one-line `description`, `model: haiku`, `tools: Read, Edit, Bash`. `copilot` and `codex` keep their file names, model fields and formats; only the description and body change. `P/agents/artifact-builder.md` equals `agentFile('claude').content`.

**The `## Director and operator` section** (first `##` heading in each `SKILL.md`). It states: you are the director; you run the intake, write the spec, view what was built and decide every `creative` finding. The hand-off ladder, first that works: (1) an `artifact-builder` agent is in your list of available agents (its name may carry a prefix ending in `:artifact-builder`): after the spec is written, start it with the skill directory, the spec path and the output path; (2) no such agent, or it fails: run the same command yourself. Unless you are already artifact-builder, in which case run the command and stop. Trust the report and the output file, never the operator's prose. If the same mechanical finding survives two operator attempts, take over. Do not choose a model for the builder: its own file names one. View what was built before you report (decision 15). It names the command line once.

---

### Task 0: Baseline

**Files:** none tracked. Writes `W/.scratch/director-operator/baseline.md`.

- [ ] **Step 1:** Record `git rev-parse HEAD` and which of decisions 1 and 2 hold (cut-over Task 5 done; the other branch merged).
- [ ] **Step 2:** Install: `npm ci --prefix <abs skill>` for `D`, `G`, `E`, `S`, as CI does (`.github/workflows/test.yml:120`); they have no `node_modules` in this worktree. `--ignore-scripts` was not checked for these four (`D` depends on a native DuckDB package); use it only if a build of one example still works afterwards. Needs the network; the implementer runs it.
- [ ] **Step 3:** Run and record counts, one at a time: `node --test "<abs P>/shared/test/*.test.mjs"`, `node --test "<abs P>/bin/test/*.test.mjs"`, `node --test "<abs P>/eval/test/*.test.mjs"`, `node <abs P>/bin/sync-shared.mjs --check`, each of the four skills' `npm --prefix <abs skill> test`.
- [ ] **Step 4:** For each of `D`, `G`, `E`, `S`, run `validate.mjs`, `build.mjs` and (where it exists) `check.mjs` with `--json` on one valid example and one fixture that fails, and paste the JSON shapes into `baseline.md`. Do the same for each `doctor.mjs`: find its read-only invocation (no `--fix`), its JSON output if it has one, and how a missing required item is reported; the `doctor` stage is built on that and on nothing that installs. Tasks 2 to 5 map from these, not from memory.

### Task 1: The shared report module

**Files:** `P/shared/make-report.mjs`, `P/shared/test/make-report.test.mjs`; synced copies.

- [ ] **Step 1: Tests first.** "a stage that returns records ok true and its seconds"; "a stage that throws records ok false and rethrows"; "a stage returning skipped records ok true and skipped true"; "ok is false when a mechanical finding exists and true when only creative ones do"; "ok is false when validate did not pass"; "ok is false when an error is set"; "finding omits fix when none is given and refuses an unknown kind"; "exitCodeOf: 0 for ok, 1 for not ok, 2 when error is set, 130 when the error is an interrupt"; "the report has ok, output, stages, findings on every path and error only when set"; "logMake writes one JSON line with command make when EVAL_LOG is set, nothing when it is not, and never throws on an unwritable path". Run: red.
- [ ] **Step 2: Implement.** No npm dependency (shared rule). Under 150 lines.
- [ ] **Step 3: Sync; verify** the shared tests and `sync-shared.mjs --check`.

### Task 2: `make.mjs` for make-dashboard

**Files:** `D/scripts/make.mjs`, `D/test/make.test.mjs`, `D/SKILL.md` is not edited here.

- [ ] **Step 1: The classification table** (decision 9), written into the test file's fixtures from Task 0's shapes: which `validate.mjs` and `build.mjs` outputs are errors (mechanical) and which are warnings (creative), and which carry a suggestion that becomes `fix`.
- [ ] **Step 2: Tests first** (no browser needed: `D` has no check stage). "a valid example exits 0 with ok true, output set to the built index.html, stages doctor, validate, build all ok"; "an invalid spec exits 1, has a mechanical finding with the validator's path and message, and no build stage"; "a query that fails at build exits 1 with a mechanical finding naming the query"; "a did-you-mean from the validator becomes fix"; "an unknown flag exits 2 and the error lists the accepted flags"; "a missing spec file exits 2 with error.message and error.hint"; "with --json stdout is exactly one JSON object on each of those paths"; "without --json the text form prints one line per finding as kind: path: message"; "--allow-outside and --timeout reach validate and build"; "--model, --effort and --agent reach build"; "EVAL_LOG gets one make line per run". Run: red.
- [ ] **Step 3: Implement** over child processes of `validate.mjs`, `build.mjs` and `doctor.mjs`. The file stays under 200 lines; argument parsing uses `P/shared/cli.mjs` `parseCli`.
- [ ] **Step 4: Verify** `npm --prefix <abs D> test`.

### Task 3: `make.mjs` for make-diagram

**Files:** `G/scripts/make.mjs`, `G/test/make.test.mjs`.

- [ ] **Step 1: The classification table,** including `check.mjs` problems and `scripts/lib/lint.mjs` warnings.
- [ ] **Step 2: Tests first.** The Task 2 list with this skill's flags, plus: "a check that finds a problem adds a mechanical finding and exits 1 with the page still written"; "a check skipped for want of a browser gives a check stage with skipped true and leaves ok true"; "--no-check runs no check stage"; "a lint warning is a creative finding and leaves the exit code 0". The check-stage tests inject the check result (a stub script path through an environment variable read only by the test) so the unit file starts no browser; one browser test in `G/test/make.test.mjs` runs the real check on `story.diagram.json`. Run: red.
- [ ] **Step 3: Implement. Step 4: Verify** `npm --prefix <abs G> test` (alone: browser tests).

### Task 4: `make.mjs` for make-explainer

**Files:** `E/scripts/make.mjs`, `E/test/make.test.mjs`.

- [ ] **Step 1: The classification table.** `E/scripts/validate.mjs` prints warnings on a valid spec ("exit 0 valid (warnings are printed)"): budget and lint warnings are creative; schema and semantic errors are mechanical; a failed embedded section (diagram, chart, scene, motion) is mechanical with the section's path.
- [ ] **Step 2: Tests first.** The Task 3 list, plus: "a spec with a lint warning exits 0 with one creative finding"; "a motion section whose film does not validate gives a mechanical finding under the section's path" (set up the way `E/test/motion.test.mjs` already does, with a copied skill and a stub script, so no film is rendered); "--image-api is passed to build only". Run: red.
- [ ] **Step 3: Implement. Step 4: Verify** `npm --prefix <abs E> test` (alone).

### Task 5: `make.mjs` for make-scene, and the contract

**Files:** `S/scripts/make.mjs`, `S/test/make.test.mjs`, `P/eval/test/make-contract.test.mjs`.

- [ ] **Step 1: The classification table** (`S/scripts/lib/row-checks.mjs`, the page-size cap, `check.mjs`: a check skipped for no WebGL is `skipped`).
- [ ] **Step 2: Tests first** for `S` as in Task 3, with `--world` and `--allow-outside` passed through, and "the page-size cap is a mechanical finding with build's own message".
- [ ] **Step 3: The contract test,** red first. It lives at `P/eval/test/make-contract.test.mjs`, not under `P/bin/test`: CI runs `P/bin/test` in the `node` job, which installs no skill (`test.yml:71-87`), so there it would skip every skill; the `eval harness` entry of the `node-skills` matrix installs all five (`test.yml:110-120`). `make-contract.test.mjs` runs each of the five `make.mjs` on a spec that does not validate (no browser, no ffmpeg) with `--json` and asserts: exit 1; one JSON object; keys `ok`, `output`, `stages`, `findings` present; `ok` false; every stage has `name`, `ok`, `seconds`; every finding has `kind` in the two values, a string `path` and a string `message`; and for a missing file: exit 2 with `error.message` and `error.hint`. A second test feeds the checker a report missing `stages` and confirms it fails (guard proof). Locally it skips a skill whose `node_modules` is absent and says so; with `CI` set, a missing install is a failure.
- [ ] **Step 4: Implement `S`. Step 5: Verify** `npm --prefix <abs S> test` (alone), then `node --test "<abs P>/eval/test/*.test.mjs"`.

### Task 6: The operator's agent files, install and doctor

**Files:** `P/shared/agents.mjs`, `P/shared/test/agents.test.mjs`, `P/agents/artifact-builder.md`, `P/bin/install.mjs`, `P/bin/test/install.test.mjs`, `P/shared/doctor.mjs`, `P/shared/test/doctor.test.mjs`.

- [ ] **Step 1: Tests first, `agents.test.mjs`.** New: "the instructions name make.mjs and --json, and name no validate or build script" (the brief bug: the words `validate script` and `build script` are absent); "the instructions forbid writing a spec and acting on creative findings, and allow two fix rounds"; "the instructions say to reply with the report only"; "the claude agent file has name, description, model haiku and a tools line without a subagent tool or Write"; "AGENT_HOSTS is claude, copilot, codex"; "cli: write claude <dir> creates artifact-builder.md". Kept, updated for the new description: the copilot and codex format tests, `tomlString`, the symlink and `wx` tests, the entry-point tests, "no three single quotes in a row". New: "`P/agents/artifact-builder.md` equals agentFile('claude').content" with a guard proof (a changed byte fails). Run: red.
- [ ] **Step 2: Implement** the text, the `claude` builder and the plugin file. Confirm, from the Claude Code plugin documentation available locally or from `claude plugin --help`, that a plugin's `agents/` folder is loaded without a manifest entry; if a manifest entry is needed, add it and say so.
- [ ] **Step 3: Tests first, `install.test.mjs`.** Flip the three that assert Claude gets nothing: `:358` "agentTargetsFor maps each host and scope to its agent dirs" now gives `claude` `.claude/agents` at both scopes and `gemini` none; `:416` becomes "a claude install writes artifact-builder.md and a gemini install writes no agent file"; `:602` becomes "--agents-only on claude writes the file; on gemini it says there is no agent file and exits 0". New: "the agents host still writes only the copilot and codex files"; "a claude install into the plugin's own checkout never writes into `P/agents`". Every existing symlink, directory, unwritable-folder and `--force` test gains a `claude` case or is shown to be host-independent. Run: red. Implement.
- [ ] **Step 4: Doctor.** Tests first in `doctor.test.mjs`: "builder_agent knows three file names"; "a file without the text make.mjs is reported as outdated with the command that replaces it" (decision 13); "an up-to-date file is ok"; "the requirement stays optional and never fails the doctor"; "the auto fix still writes only where the host folder exists and never overwrites". Implement; sync.
- [ ] **Step 5: Verify** shared tests, `P/bin` tests, `sync-shared.mjs --check`, and each skill's `doctor.test.mjs` through its `npm test`.

### Task 7: `SKILL.md` in five skills

**Files:** `D/SKILL.md`, `G/SKILL.md`, `E/SKILL.md`, `S/SKILL.md`, `M/SKILL.md`, `P/bin/test/delegation.test.mjs`, `intake.test.mjs`.

- [ ] **Step 1: Tests first, `delegation.test.mjs`.** (a) Per skill: the file has exactly one `## Director and operator` section, it is the first `##` heading, and it holds each of: `artifact-builder`, `make.mjs`, `--json`, `skill directory`, `spec path`, `mechanical`, `creative`, `unless you are already artifact-builder`, `run the same command yourself`, `list of available agents`. (b) The section is byte-identical in all five. (c) Replaces the pin test: "no SKILL.md frontmatter has a model or effort key", for all five, with a guard proof that a frontmatter containing `model: haiku` fails. (d) "no SKILL.md contains the heading `## Cheaper model` or the phrase `on the model named in the frontmatter`". (e) "each skill's SKILL.md names its own `scripts/make.mjs` and that file exists". `intake.test.mjs:104`: the heading name follows. Run: red.
- [ ] **Step 2: Write the section** once, per the Interfaces text, and place it in the five files. Read `portability.test.mjs`'s rules first. In `D`, `G`, `E`, `S` the workflow steps that say "run validate, then build" gain one line: the one command is `make.mjs`; `validate.mjs` and `build.mjs` remain for stepwise work. make-motion's workflow already names `make.mjs` after the cut-over.
- [ ] **Step 3: Remove** the `model` and `effort` lines from the five frontmatters. Nothing else in the frontmatter changes (`frontmatter.test.mjs`).
- [ ] **Step 4: Verify** `node --test "<abs P>/bin/test/*.test.mjs"`; `uv tool run pytest tests/pytest/ -q` (the registry reads frontmatter); `python3 scripts/sweep_counts.py --check`.

### Task 8: The eval harness can see a delegation

**Files:** `P/eval/hosts.json`, `lib.mjs`, `run-eval.mjs`, `session.mjs`, `test/lib.test.mjs`, `test/session.test.mjs`, `README.md`. No billed host is called.

**Interfaces**

- `hosts.json` gains `claude-director`: the `claude` command with `--output-format stream-json --verbose --forward-subagent-text`, the subagent tool added to `--allowedTools`, `budgetArgs: ["--max-budget-usd", "{budget}"]`, and `agentFile: "claude"`. All five flags exist in `claude --help` on this machine; the subagent tool's name is read from the stream's first event in the pilot, not assumed.
- The host entry also carries `--setting-sources project` (decision 14).
- `buildPrompt` in `eval/lib.mjs` ends today with "stop after validate and build/render", which steers the host around `make.mjs` and the hand-off. For a host with `agentFile` the sentence becomes "follow the skill's Director and operator section; stop when the build is done". The other hosts' prompt is unchanged, so committed summaries stay comparable.
- `run-eval.mjs` gains `--budget <usd>` (refused for a host without `budgetArgs`, like `--agent`).
- `prepareWorkdir`: for a host with `agentFile`, writes that host's agent file into `<work>/.claude/agents/` (decision 10).
- `session.mjs`: `readSession(transcriptPath)` returns `{ directorModel, agentsListed, operatorModel, delegated, steps }`, where each step is `{ what: "spec" | "make" | "view", by: "director" | "operator", ok }`: a write of the spec file, a `make.mjs` command with the `ok` of the report in its result, a read of a sheet or page. `by` is `operator` when the event carries a parent tool-use id, else `director`. `operatorModel` is the model field of the operator's own messages, or null. `requestedModel` is the `model` argument of the delegating tool call, or null when the director named none: a non-null value means the director overrode the agent file, and the row says so. `settingSources` and the plugins and hooks the first event lists are kept for the summary. `firstBuildValid(steps)` is the `ok` of the first `make` step, or null when there was none.
- `summarize` gains columns: `first build valid`, `spec by`, `make by`, `operator model`, `director model`; the `model reported` column is kept and its header says "self-reported".

- [ ] **Step 1: Tests first, `session.test.mjs`,** on hand-written stream fixtures: "a session with no subagent reports every step as director and operatorModel null"; "a session where a subagent ran make.mjs reports make by operator and the subagent's model"; "the spec write is attributed to whoever made it"; "first build valid is the first make report's ok, not the last"; "a stream that is not JSON lines returns a record that says unreadable, and the row says so"; "a make command whose result is not a report is counted with ok null"; "a delegating call that names a model is reported as an override with that model"; "the prompt for a host with agentFile has no 'stop after validate' sentence and the prompt for the claude host is byte-identical to before". `lib.test.mjs`: "--budget is refused for a host without budgetArgs"; "expandCmd substitutes {budget}"; "a host with agentFile gets .claude/agents/artifact-builder.md in the workdir, others do not"; "summarize prints the new columns and marks the self-reported one". Run: red.
- [ ] **Step 2: Implement.** The fake host of `eval/test` prints a fixture stream. The fixtures are marked provisional: Task 9's pilot replaces them with a real stream and the parser is corrected against it before the other nine cases run.
- [ ] **Step 3: `P/eval/README.md`:** the new host, `--budget`, what the columns mean and that `model reported` is self-reported.
- [ ] **Step 4: Verify** `node --test "<abs P>/eval/test/*.test.mjs"`.

### Task 9: The billed run (once)

**Depends on:** cut-over Tasks 2 and 5 (the eval's motion entry runs `scripts/make.mjs <spec> --sheets-only --json` and `prompts/motion.json` holds the ten version 2 prompts `statement-hook`, `number-kpi`, `clipping-highlight`, `list-steps`, `quote-card`, `compare-two`, `chart-bar`, `viral-vertical`, `voiced-pro`, `edit-existing`), and Tasks 6 to 8 here.

**Commands that exist today** (from `P/eval/README.md` and `run-eval.mjs`): `node plugins/portable-artifacts/eval/run-eval.mjs --skill motion --host claude [--model m] [--only id,id] [--limit n] [--timeout sec] [--out dir]`, and `node --test "plugins/portable-artifacts/eval/test/*.test.mjs"`. The harness exits 2 with `run "npm ci" in <dir> first` when the skill has no `node_modules`, and with `host "<x>" not available` when `claude --version` fails. After Task 8 the host is `claude-director` and `--budget` exists.

- [ ] **Step 1: Preconditions,** each checked and written into the summary: the cut-over tasks are committed; `npm ci --ignore-scripts --prefix <abs M>` done, Chromium and ffmpeg present (`node <abs M>/scripts/doctor.mjs`); `pgrep -fl chrome-headless-shell` lists nothing; `claude --version` recorded.
- [ ] **Step 2: Pilot, one case:** `node <abs P>/eval/run-eval.mjs --skill motion --host claude-director --only statement-hook --budget 2 --out <abs W>/.scratch/director-operator/eval`. Read `transcript.txt`: record the first event's model and tool list, the agent name as listed (decision 5), and whether subagent events carry a parent id and a model. If the stream differs from Task 8's fixtures, fix the parser and its fixtures (tests first), with no second billed call until the tests pass. If the stream cannot attribute steps at all, stop and report; do not run the other nine. Record the pilot's cost from the stream. If the pilot hit its cap, or the user-level setup was loaded against decision 14 (a hook fired, a user plugin is listed), stop and take the figure and the finding to the owner: with one run and no rerun, nine capped or contaminated cases would spend the approval for nothing.
- [ ] **Step 3: The other nine:** the same command with `--only` naming the other nine ids. One run. A case that hits its cap is reported as capped.
- [ ] **Step 4: The record,** `P/eval/results/summary-director-operator-<date>.md`: the commands, the Claude Code version, the date; per case: valid, first build valid, spec by, make by (and how many make runs), sheets viewed by, operator model, the model the director requested for it (or none), director model, seconds, cost if the stream reports it; the setting sources, plugins and hooks that were live; totals as counts out of ten; the cases where no delegation happened, named. Every figure is "measured: read from the session stream by `eval/session.mjs`". A line states: "Codex and Copilot: install tests and documents only, not run live."
- [ ] **Step 5:** No rerun to improve a number. A failure is recorded and, if it is a bug in this plan's work, fixed with a test; the summary keeps the first run's figures and says a fix followed.

### Task 10: Documents and final verification

- [ ] **Step 1: `P/README.md:242-248` and `P/USAGE.md:106-143`:** the section becomes "Director and operator": what the director does, the one command, the ladder per host in a table (Claude Code: plugin agent file, Haiku, the only deterministic pin; Copilot and Codex: installed agent files, delegation decided by the model, install-tested, not run live; any host: the director runs the command). The 2026-10-21 Copilot figures stay as a dated record and are labelled "measured with the previous agent text, which wrote the spec". The Claude Code figures come only from Task 9's summary. The installer commands gain `claude` (decision 4).
- [ ] **Step 2: `P/CHANGELOG.md` under `[Unreleased]`:** no model pin in any skill; `scripts/make.mjs` in four more skills with the report shape; the agent files and how to replace an old one; the eval's new host. Each skill's `README.md` gains the one command in its script table.
- [ ] **Step 3: Verify,** one at a time, with counts next to Task 0's baseline: shared tests, `P/bin` tests, eval tests, `sync-shared.mjs --check`, the five skills' `npm test`, `bats tests/bats`, `uv tool run pytest tests/pytest/ -q`, `python3 scripts/sweep_counts.py --check`.
- [ ] **Step 4: Manual-test checklist items:** in a real Claude Code session with the plugin installed, ask for a diagram and confirm the agent list shows the builder, the spec is written by the session model and the build runs in the builder; repeat with the builder removed and confirm the session runs `make.mjs` itself.

## Not in this plan

- Any change inside make-motion's engine or report; `--list` and the rest of design section 12.
- Live runs on Codex, Copilot or Gemini.
- The refresh of the four skills (`docs/superpowers/plans/2026-11-16-pa2-refresh-four.md`). Both plans edit each `SKILL.md`; the controller serialises those edits.
- A higher operator model. The design allows it only after the same mechanical finding survives two attempts, and then the director takes over; nothing here selects another model.

## Left to the implementer

- The exact wording of the section and of the operator text, inside the tested phrases.
- How each skill's existing JSON output maps to findings (the table of step 1 in Tasks 2 to 5).
- The text form of the report in the four skills.
