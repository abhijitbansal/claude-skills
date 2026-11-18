# Cross-host eval

Checks that the skills work with more than one agent. Each prompt runs
through a host CLI in a fresh temp directory, then the harness scores
what the host left behind.

```bash
# one-time: install each skill's deps
(cd ../skills/make-dashboard && npm ci)
(cd ../skills/make-diagram && npm ci --omit=dev)
(cd ../skills/make-explainer && npm ci --omit=dev)   # also needs make-diagram and make-dashboard installed
(cd ../skills/make-scene && npm ci --omit=dev)       # also needs make-diagram and make-dashboard installed
(cd ../skills/make-motion && npm ci && npx playwright install chromium)

node run-eval.mjs --skill dashboard --host claude --limit 3
node run-eval.mjs --skill motion --host codex --only number-kpi,edit-existing
node run-eval.mjs --skill motion --host claude --model haiku --only chart-bar,vars-batch
node run-eval.mjs --skill diagram --host claude --only checkout-path,edit-existing
node run-eval.mjs --skill explainer --host claude --model haiku --only recap-from-repo,edit-existing
node run-eval.mjs --skill scene --host claude --model haiku --only city-inline,edit-switch-forest
node run-eval.mjs --skill dashboard --host codex-oss --model gemma4
node run-eval.mjs --skill motion --host codex-oss --model gemma4 --allow-local-models
node run-eval.mjs --skill explainer --host copilot --agent artifact-builder --model "Claude Haiku 5.5"
node run-eval.mjs --skill diagram --host claude-frontmatter     # no --model: the account default model; frontmatter use unverified
node run-eval.mjs --skill dashboard --host claude-director --only rev-by-region --budget 2   # billed, one case, capped at 2 USD
```

Each command above runs a real host, and a billed host is billed per prompt: count the prompts first (`--limit`,
`--only`) and state the number before a run. Nothing else in this folder calls a model: the tests use a fake skill and a fake host.

Hosts are defined in `hosts.json`: `claude`, `claude-frontmatter` (the same command with no `modelArgs`, so a
`--model` is refused and the account's default model runs). The harness copies the skill to
`<work>/skills/<dir>/` and the prompt says to read its `SKILL.md`; Claude Code does not scan that folder for
skills, so the skill is read as a plain file and whether its `model` and `effort` frontmatter applies is
unverified. Check the session log before using this host to measure the frontmatter path. The other hosts are `codex`, `codex-oss`
(Ollama via `codex exec --oss`), `gemini` and `copilot`. To add a host,
add an entry with a `cmd` template (`{prompt}`, `{cwd}`, `{model}`), plus
optional `modelArgs`, `agentArgs` and a `check` command. The `claude` allowlist includes the read-only
helpers `echo`, `pwd` and `head` next to `node`, `npm`, `ls` and `cat`.

A host marked `"local": true` (`codex-oss`) is not run on `motion` or `explainer` unless you pass
`--allow-local-models`: gemma4 often ended its turn before writing the spec on those two (see
[`results/INDEX.md`](results/INDEX.md)), and each such run waited out the whole timeout. A run that has written no spec and
made no `validate` call after `--abort-no-spec <sec>` seconds (default: the host's `abortNoSpecSec`, 240 for
`codex-oss`; `0` turns it off) is killed and marked `aborted` in the summary. For an edit prompt, a seed left unchanged counts as no spec.

## The `claude-director` host: seeing a delegation

`claude-director` runs the session as Claude Code does for a user and records what it did, so the evidence of who
built what comes from the session's own events, not from what an agent says about itself. Its command is the `claude`
one plus `--output-format stream-json --verbose --forward-subagent-text --include-hook-events`, the subagent tool
(`Agent`, and `Task` as an older name) in `--allowedTools`, and `--setting-sources project`, so only the workdir's
`.claude/` is read and the owner's user-level setup (global rules, hooks, plugins) is not loaded. It names no `--model`:
the director runs as the account default, and `--model` is refused. For each case the harness writes the `claude`
operator agent file (`shared/agents.mjs`) to `<work>/.claude/agents/artifact-builder.md`, and the prompt ends with "follow
the skill's Director and operator section; stop when the build is done" instead of "stop after validate and
build/render" (the other hosts' prompt is unchanged). A skill whose `SKILL.md` has no such section gives the session
nothing to follow, and its rows read "director ran it".

`--budget <usd>` is the per-case spend cap (`--max-budget-usd`). The host needs it, and any host without `budgetArgs`
refuses it. A case that reaches the cap is marked `hit the budget cap` in the notes.

`eval/session.mjs` reads each case's `transcript.txt` (the stream) into a record kept in `results.json` as `session`:
whether the director delegated, to which agent name, the model each side ran as (`director` events versus events with a
parent tool-use id, which are the subagent's), the model the delegating call asked for (`requestedModel`: a model named
there overrides the agent file), who wrote the spec, ran `make.mjs` and viewed a sheet or page, the agents, plugins,
setting sources and hooks the stream lists, cost and cap. These columns follow `first try` in `summary.md`:

| Column | Meaning |
|---|---|
| first build valid | `ok` of the report from the first `make.mjs` run in the session (`✓`, `✗`, or `-` when none ran or its result was not a report) |
| spec by, make by | `director`, `operator`, or `director+operator`, with `×n` for n steps; `-` for none |
| operator model | the model of the subagent's own messages; `director ran it` when nobody delegated (the case is kept); `(director requested <m>: overrides the agent file)` when the delegating call named a model |
| director model | the model of the session's own messages |

`model reported` is kept and its header reads `model reported (self-reported)` in these summaries: it is
`generatedBy.model` as the agent wrote it, never evidence of which model ran. A stream the parser cannot read gives
`unreadable` in every new column and a note. The summary also prints `Delegated d/n · first build valid v/m` and a
`Session setup (read from the stream)` line (setting sources, plugins, hooks that fired). A `make.mjs` run adds a
`{ "command": "make" }` line to `.eval-log.jsonl`; `validate runs` and `first try` ignore those lines.

Status of the parser: the stream shapes it reads (an `init` event listing model, agents and plugins; `tool_use` and
`tool_result` blocks; `parent_tool_use_id` on a subagent's events; the `result` event) are written from the plan and
tested on hand-written, synthetic streams only (`test/helpers/stream-fixtures.mjs`). No real stream has been captured
yet: the first billed case replaces the fixtures and the parser is corrected against it. Until then the setting
sources, hook names and the `error_max_budget_usd` cap marker are expectations, not observations.

`--set <name>` runs the prompts in `prompts/<skill>-<name>.json` instead of
the default `prompts/<skill>.json` (which stays as it is, so committed
summaries remain comparable). An unknown set exits 2 with
`unknown --set "x"; available for dashboard: kinds`. `--only` and
`--limit` apply after `--set`. Motion has no set (see "Motion sets" below). The sets are:
explainer `features` (Simple English, a plan round trip, embeds by file, an edit, `kpis`, `cards`, `image`, `details`
and `diff` sections), dashboard `kinds` (the six chart kinds the default set does not name) and diagram `cloud` (AWS icons).

`--agent <name>` runs the host through a named custom agent. It works only
for a host with `agentArgs` (today `copilot`: `--agent {agent}`); any other
host exits with `host "<x>" has no agentArgs`. Install the agent first (the
plugin installer writes `artifact-builder.agent.md` for Copilot).
`summary.md` has a `model reported` column: the `generatedBy.model` the
agent wrote into its saved spec (every skill asks for it, motion included),
or `-` when it wrote none. It is what the agent self-reported, not a check
of which model ran. (The harness rebuilds each page from the spec without
`--model`, so the page carries nothing the spec does not.)

## What a run does

1. Copies the skill (with a `node_modules` folder of links back to the
   original), `fixtures/data/`, and the seed spec for edit prompts
   into a temp dir. A skill that loads sibling skills (`explainer` needs
   `make-diagram` and `make-dashboard`; so does `scene`, for its lift prompts)
   gets those copied beside it. `explainer` gets neither `make-scene` nor `make-motion` on purpose: a
   `scene` or `motion` section needs a WebGL page or ffmpeg and Chromium, and no prompt asks for one (a test pins that exemption).
   A prompt marked `"repo": true` also gets `./repo`, a small git repository (`main`,
   then `feat/search` with three commits, dated one day apart ending now so they stay inside a "last 12 weeks" window) for `gather.mjs` to read.
2. Runs the host with the prompt *"Read `skills/<skill>/SKILL.md` and
   follow its workflow … Task: … Save the spec as `./<spec>.json`."*.
   `EVAL_LOG` is set, so every `validate.mjs` call the host makes adds a
   line (`{ ts, ok, errors }`) to a log, which is how retries are counted. The log is copied into the case
   folder as `.eval-log.jsonl`. The per-call error messages are not in it yet: the validators write only the count,
   so a retry loop can be seen (how many calls, which one was the first valid) but not read.
3. Scores the result. The harness reruns `validate` and the output step
   (`build` for dashboards, diagrams, explainers and scenes, `make.mjs --sheets-only` for motion) itself,
   so a host whose sandbox blocked commands is still scored on its spec.

| Metric | Meaning |
|---|---|
| spec | the host wrote the spec file |
| valid | the harness's final `validate` passes |
| validate runs | how many times the host ran `validate`. 1 is a single call; 0 means the host never ran it (the harness still validates the spec itself), which is not the same as valid on the first call |
| output | the build or the review sheets succeeded |
| check | `scripts/check.mjs … --json` passed (`✓`), failed (`✗`), or did not apply (`-`: skipped without a browser, the output step failed, or the skill has no check). Diagram, explainer and scene check the page the build wrote (`out/<skill>.html`); dashboard has none here; motion has no separate check, its column is the `ok` of the `make.mjs` report of the output step. It runs only after `output` succeeded, and its output is kept as `check.log`. The totals line reads `check ok n/m` over the rows whose check ran. A check that opens a browser runs one prompt at a time, like everything else here. |
| feature | the spec uses what the prompt asked for: the prompt's `expect` list (`key`, `key=value` or `key^=prefix`, matched on any object in the spec; `show=statement`, `kind=area`, `type=diff`; `a|b` is met by either, for a thing the spec can say two ways, like a transition given as a bare name or as an object with a `type`) is all found. `kind=` counts the typed chart kind only, so a chart written as raw Vega-Lite reads as missing. `-` when the prompt lists none. It never changes `valid`, so a summary from before this column is still comparable. The totals line reads `feature used n/m`; a miss names what was not found |
| first try | `✓` when the host's first `validate` call passed, `✗` when it needed more, `-` when it never ran one |
| changed | for edit prompts: the leaf JSON paths that differ from the seed (a targeted edit changes only a few). A prompt with `maxChanged` is flagged `edit too broad` in the notes when more paths changed than that (a rewrite of the seed is not an edit). It never changes `valid`: the paths are counted by array index, so one node inserted mid-array shifts every later one. The limits sit above what committed summaries show a correct edit changing |

Results go to `results/<timestamp>/<host>-<skill>/`: `results.json`,
`summary.md`, and for each case the spec, the transcript, and the built
page or contact-sheet PNGs. A person does the visual check by opening
those PNGs and pages. `results/` is gitignored, except for summaries
copied to `results/summary-*.md`.

## Scene prompts

`prompts/scene.json` has ten prompts for `make-scene`: one per world (city
from inline numbers, forest with sub-teams, galaxy from
`data/service_calls.json`, terrain from `data/web_traffic.csv`), commits per
folder from `./repo`, a diagram lift (`data/orders.diagram.json`), a
dashboard lift (`data/units.dashboard.json`, a bar chart), and three edit
prompts. The lift inputs ride in `fixtures/data/` because a seed can only
become the spec itself. Edit prompts start from `fixtures/seeds/scene.json`
(a city with no tour) or `scene-tour.json` (the same city with a two-beat
tour, for the rename). The pass bar for a billed run is 90% valid.

## Motion sets

`prompts/motion.json` (no `--set`; the version 1 `benchmark` and `items` sets are gone) holds eleven prompts for
make-motion 2. The agent writes `film.json`, a script of shots; the harness checks it with `make.mjs --outline --json`
and builds the review sheets with `make.mjs --sheets-only --json --out <work>/out/film.mp4`, and the `check` column
reads the `ok` of that report (the review runs inside `make.mjs`; there is no separate check command). The ids are
`statement-hook`, `number-kpi`, `clipping-highlight`, `list-steps`, `quote-card`, `compare-two`, `chart-bar`,
`viral-vertical`, `voiced-pro`, `edit-existing` (from `fixtures/seeds/motion.json`) and `vars-batch`. Each names what a
correct film must contain, and an `expect` list feeds the feature-used column (`show=<kind>`, `mode=viral`,
`vars`, and so on). A test checks that every expectation is met by a film in
`skills/make-motion/references/examples/v2/`. These prompts have not been run on any host; nothing is recorded for them.

The motion prompts read two files from `fixtures/data/`, which every run copies to `./data/`:

| File | Content |
|---|---|
| `rows.json` | 3 rows of `{ "name", "city", "count" }` for the `vars-batch` prompt |
| `portrait.jpg` | a drawn portrait (1280x720) for the `clipping-highlight` prompt |

`music.wav` (a 10 s, 120 BPM click track) stays because make-motion's `beats` tests read it; `captions.srt`, `captions.vtt`,
`badge.lottie.json` and `portrait-cutout.png` stay until the cut-over's delete removes the version 1 tests that read them. No motion
prompt names them.

## Other fixtures

`fixtures/seeds/` holds the spec an edit prompt starts from (`dashboard.json`, `diagram.json`, `explainer.json`,
`scene.json`, `scene-tour.json`, `motion.json`); `fixtures/data/` also has `sales.csv`, `web_traffic.csv`,
`tickets.csv` (priority, channel, team and three numbers, for the dashboard `kinds` set), `service_calls.json`,
`orders.diagram.json`, `units.dashboard.json` and `logo.svg`. An edit prompt names the change it wants, and
`maxChanged` is how many leaf paths a targeted edit should change; more is reported as too broad.

## Bar and budget

- **Bar.** Each committed summary states its own bar in its Gate section, and the bars differ, so read the summary
  rather than assuming one rule. As recorded: diagram and explainer, at least 7 of 8 valid with median validate runs
  2 or fewer; dashboard v2, at least 9 of 10 valid with median 1; routing (motion gate), at least 8 of 10 valid and
  built; scene, at least 90% valid; motion gates 1 and 2, `ceil(0.9 × n)` valid (13 of 14, 9 of 10) with median
  validate runs 2 or fewer on the 10-prompt set. For a new billed run the default is 90% valid, `ceil(0.9 × n)`, and a median of 2 or fewer; state
  the bar in the summary before the run. Valid means the harness's own `validate` and output step passed; the `feature`
  column says whether the prompt's feature is in the spec, and `check` whether the page passes its browser check.
  Neither judges whether the text or the picture is good.
- **Budget.** One prompt is one host session. State the prompt count and the host before a billed run, run each prompt once
  (no cell here has been run three times, so a pass is one sample), and add a row to
  [`results/INDEX.md`](results/INDEX.md) with the plugin version, the host CLI version and the command line.
- **Which model ran.** `model reported` is the agent's own claim. With `--host claude-frontmatter` the model is the
  account default and the frontmatter path is unverified: read the model from the session log.

## Tests

`node --test "test/**/*.test.mjs"` uses a fake skill and fake host, so it
needs no LLM. `test/lib.test.mjs` covers scoring, the prompt files (every block, section type and chart kind has a
prompt that expects it) and the run-eval flags; `test/session.test.mjs` and `test/director-host.test.mjs` cover the stream
parser, the `claude-director` host, `--budget` and the new columns on synthetic streams (a fake `claude` prints one); `test/validate-fuzz.test.mjs` runs the five `validate.mjs` scripts on specs
whose keys and lookup values are `constructor`, `__proto__` and `toString`, and shows it catches a scratch validator
that accepts them; `test/docs-facts.test.mjs` ties the plugin README and USAGE to the code. They need each skill's
`node_modules` installed, and none opens a browser or calls a model.

## Caveats

- **Not a sandbox.** Hosts may run `node` (and `npm` for the `claude` host),
  so a run can execute arbitrary code as you. Codex runs in its
  `workspace-write` sandbox. Run evals on a machine and account you trust the
  host with.
- **Shared packages.** Each workdir gets its own `node_modules` folder whose
  entries are symlinks to the packages in this checkout, so a host that runs
  `npm ci` or deletes `node_modules` only removes the links. (An earlier
  version symlinked the whole folder, and a local model's `npm ci` emptied the
  real one.) A host that runs `npm install <pkg>` inside a package folder can
  still modify it.
- On timeout the harness kills the host's whole process group (renders and
  servers included). Workdirs are deleted once their artifacts have been
  copied to `results/`.
