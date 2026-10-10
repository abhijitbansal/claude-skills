# Cross-host eval

Checks that the skills work with more than one agent. Each prompt runs
through a host CLI in a fresh temp directory, then the harness scores
what the host left behind.

```bash
# one-time: install each skill's deps
(cd ../skills/make-dashboard && npm ci)
(cd ../skills/make-motion && npm ci && npx playwright install chromium)

node run-eval.mjs --skill dashboard --host claude --limit 3
node run-eval.mjs --skill motion --host codex --only q3-counter,edit-existing
node run-eval.mjs --skill dashboard --host codex-oss --model gemma4
```

Hosts are defined in `hosts.json`: `claude`, `codex`, `codex-oss`
(Ollama via `codex exec --oss`), `gemini` and `copilot`. To add a host,
add an entry with a `cmd` template (`{prompt}`, `{cwd}`, `{model}`), plus
optional `modelArgs` and a `check` command.

## What a run does

1. Copies the skill (without `node_modules`, which is symlinked back to
   the original), `fixtures/data/`, and the seed spec for edit prompts
   into a temp dir.
2. Runs the host with the prompt *"Read `skills/<skill>/SKILL.md` and
   follow its workflow … Task: … Save the spec as `./<spec>.json`."*.
   `EVAL_LOG` is set, so every `validate.mjs` call the host makes adds a
   line to a log, which is how retries are counted.
3. Scores the result. The harness reruns `validate` and the output step
   (`build` for dashboards, `render --contact-sheet` for motion) itself,
   so a host whose sandbox blocked commands is still scored on its spec.

| Metric | Meaning |
|---|---|
| spec | the host wrote the spec file |
| valid | the harness's final `validate` passes |
| validate runs | how many times the host ran `validate` (1 = right first time) |
| output | the build or contact sheet succeeded |
| changed | for edit prompts: the leaf JSON paths that differ from the seed (a targeted edit changes only a few) |

Results go to `results/<timestamp>/<host>-<skill>/`: `results.json`,
`summary.md`, and for each case the spec, the transcript, and the built
page or contact-sheet PNGs. A person does the visual check by opening
those PNGs and pages. `results/` is gitignored, except for summaries
copied to `results/summary-*.md`.

## Tests

`node --test "test/**/*.test.mjs"` uses a fake skill and fake host, so it
needs no LLM.
