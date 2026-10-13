# Cross-host eval

Checks that the skills work with more than one agent. Each prompt runs
through a host CLI in a fresh temp directory, then the harness scores
what the host left behind.

```bash
# one-time: install each skill's deps
(cd ../skills/make-dashboard && npm ci)
(cd ../skills/make-diagram && npm ci --omit=dev)
(cd ../skills/make-explainer && npm ci --omit=dev)   # also needs make-diagram and make-dashboard installed
(cd ../skills/make-motion && npm ci && npx playwright install chromium)

node run-eval.mjs --skill dashboard --host claude --limit 3
node run-eval.mjs --skill motion --host codex --only q3-counter,edit-existing
node run-eval.mjs --skill diagram --host claude --only checkout-path,edit-existing
node run-eval.mjs --skill explainer --host claude --model haiku --only recap-from-repo,edit-existing
node run-eval.mjs --skill dashboard --host codex-oss --model gemma4
```

Hosts are defined in `hosts.json`: `claude`, `codex`, `codex-oss`
(Ollama via `codex exec --oss`), `gemini` and `copilot`. To add a host,
add an entry with a `cmd` template (`{prompt}`, `{cwd}`, `{model}`), plus
optional `modelArgs` and a `check` command.

## What a run does

1. Copies the skill (without `node_modules`, which is symlinked back to
   the original), `fixtures/data/`, and the seed spec for edit prompts
   into a temp dir. A skill that loads sibling skills (`explainer` needs
   `make-diagram` and `make-dashboard`) gets those copied beside it. A prompt
   marked `"repo": true` also gets `./repo`, a small git repository (`main`,
   then `feat/search` with three commits) for `gather.mjs` to read.
2. Runs the host with the prompt *"Read `skills/<skill>/SKILL.md` and
   follow its workflow … Task: … Save the spec as `./<spec>.json`."*.
   `EVAL_LOG` is set, so every `validate.mjs` call the host makes adds a
   line to a log, which is how retries are counted.
3. Scores the result. The harness reruns `validate` and the output step
   (`build` for dashboards, diagrams and explainers, `render --contact-sheet` for motion) itself,
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
