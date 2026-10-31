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
node run-eval.mjs --skill motion --host codex --only q3-counter,edit-existing
node run-eval.mjs --skill motion --host claude --model haiku --set benchmark
node run-eval.mjs --skill motion --host claude --model haiku --set benchmark --only chart-race,map-regions
node run-eval.mjs --skill diagram --host claude --only checkout-path,edit-existing
node run-eval.mjs --skill explainer --host claude --model haiku --only recap-from-repo,edit-existing
node run-eval.mjs --skill scene --host claude --model haiku --only city-inline,edit-switch-forest
node run-eval.mjs --skill dashboard --host codex-oss --model gemma4
node run-eval.mjs --skill explainer --host copilot --agent artifact-builder --model "Claude Haiku 5.5"
```

Hosts are defined in `hosts.json`: `claude`, `codex`, `codex-oss`
(Ollama via `codex exec --oss`), `gemini` and `copilot`. To add a host,
add an entry with a `cmd` template (`{prompt}`, `{cwd}`, `{model}`), plus
optional `modelArgs`, `agentArgs` and a `check` command.

`--set <name>` runs the prompts in `prompts/<skill>-<name>.json` instead of
the default `prompts/<skill>.json` (which stays as it is, so committed
summaries remain comparable). An unknown set exits 2 with
`unknown --set "x"; available for motion: benchmark, items`. `--only` and
`--limit` apply after `--set`. Motion has two sets (see "Motion sets" below).

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

1. Copies the skill (without `node_modules`, which is symlinked back to
   the original), `fixtures/data/`, and the seed spec for edit prompts
   into a temp dir. A skill that loads sibling skills (`explainer` needs
   `make-diagram` and `make-dashboard`; so does `scene`, for its lift prompts)
   gets those copied beside it. A prompt
   marked `"repo": true` also gets `./repo`, a small git repository (`main`,
   then `feat/search` with three commits) for `gather.mjs` to read.
2. Runs the host with the prompt *"Read `skills/<skill>/SKILL.md` and
   follow its workflow … Task: … Save the spec as `./<spec>.json`."*.
   `EVAL_LOG` is set, so every `validate.mjs` call the host makes adds a
   line to a log, which is how retries are counted.
3. Scores the result. The harness reruns `validate` and the output step
   (`build` for dashboards, diagrams, explainers and scenes, `render --contact-sheet` for motion) itself,
   so a host whose sandbox blocked commands is still scored on its spec.

| Metric | Meaning |
|---|---|
| spec | the host wrote the spec file |
| valid | the harness's final `validate` passes |
| validate runs | how many times the host ran `validate` (1 = right first time) |
| output | the build or contact sheet succeeded |
| check | motion only: `scripts/check.mjs <spec> --json` passed (`✓`), failed (`✗`), or did not apply (`-`: skipped without a browser, the output step failed, or the skill has no check). It runs only after `output` succeeded, and its output is kept as `check.log`. The totals line reads `check ok n/m` over the rows whose check ran. |
| changed | for edit prompts: the leaf JSON paths that differ from the seed (a targeted edit changes only a few) |

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

- `prompts/motion.json` (no `--set`): the original ten prompts.
- `--set benchmark`: twelve prompts, two per category (product launch, PR
  walkthrough, data viz, captioned social, docs to video, templated batch),
  each naming a 10 to 30 second duration and tagged with a `category`. Some ask for
  capabilities a later release adds, so a spec that cannot express them is a
  real miss, not a harness fault.
- `--set items`: one prompt per new field or block, appended as each feature
  lands (empty until then).

The benchmark prompts read files from `fixtures/data/`, which every run copies to
`./data/`:

| File | Content |
|---|---|
| `captions.srt` | 6 cues, 24 words, English |
| `captions.vtt` | the same cues as WebVTT |
| `clip.mp4` | 2 s, 320x180, SMPTE bars, silent (committed, a few KB) |
| `music.wav` | 10 s mono 8 kHz click track at 120 BPM: a 20 ms 1 kHz burst every 0.5 s on silence, so beat detection has onsets |
| `rows.json` | 3 rows of `{ "name", "city", "count" }` for the templated-batch prompts |

`music.wav` is `writeWav` from the make-motion test helpers with
`{ seconds: 10, sampleRate: 8000, clickBpm: 120 }`, and `clip.mp4` is
`makeTestVideo` with `{ source: 'smptebars' }`; both were generated once and
committed. A test checks `music.wav` byte for byte against the helper.

## Tests

`node --test "test/**/*.test.mjs"` uses a fake skill and fake host, so it
needs no LLM.

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
