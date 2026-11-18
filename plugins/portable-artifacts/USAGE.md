# portable-artifacts usage guide

Walkthroughs for the five skills on every supported host. To find out what the
plugin is, read the [README](README.md). For every spec field, see each skill's
`references/schema.md`.

- [1. Install](#1-install)
- [2. Dashboards with make-dashboard](#2-dashboards-with-make-dashboard)
- [3. Diagrams with make-diagram](#3-diagrams-with-make-diagram)
- [4. Explainers with make-explainer](#4-explainers-with-make-explainer)
- [5. Videos with make-motion](#5-videos-with-make-motion)
- [6. 3D scenes with make-scene](#6-3d-scenes-with-make-scene)
- [7. What every page carries](#7-what-every-page-carries)
- [8. Asking for changes](#8-asking-for-changes)
- [9. Hosts that can't run commands](#9-hosts-that-cant-run-commands)
- [10. Troubleshooting](#10-troubleshooting)
- [11. Checking a new host or model](#11-checking-a-new-host-or-model)

## 1. Install

| You use | Do this | Then call |
|---|---|---|
| Claude Code | `/plugin marketplace add abhijitbansal/claude-skills` then `/plugin install portable-artifacts@claude-skills` | `/make-dashboard …`, `/make-diagram …`, `/make-explainer …`, `/make-motion …`, `/make-scene …`, or just ask |
| Codex CLI | `node <repo>/plugins/portable-artifacts/bin/install.mjs codex` | `$make-dashboard …`, `$make-diagram …`, `$make-explainer …`, `$make-motion …`, `$make-scene …` (or pick from `/skills`) |
| GitHub Copilot CLI / VS Code | `node <repo>/plugins/portable-artifacts/bin/install.mjs copilot` (add `--project .` for `.github/skills`) | `/make-dashboard …`, `/make-diagram …`, `/make-explainer …`, `/make-motion …`, `/make-scene …` |
| Gemini CLI | `node <repo>/plugins/portable-artifacts/bin/install.mjs gemini` | `/make-dashboard …` (a TOML command that activates the skill) |
| Any agent `npx skills` supports | `npx skills add abhijitbansal/claude-skills --skill make-dashboard make-diagram make-explainer make-motion make-scene` (pick agents interactively, or pass `-a claude-code codex github-copilot -y`). It does not resolve dependencies: to get just the explainer, name its two required skills too, `--skill make-explainer make-diagram make-dashboard` | That agent's skill invocation |
| Any other agent | Copy `skills/make-dashboard`, `skills/make-diagram`, `skills/make-explainer`, `skills/make-motion` and/or `skills/make-scene` into your project (**make-explainer needs make-diagram and make-dashboard beside it; make-scene needs them only to lift a diagram or a chart**) **with each skill's `shared/` folder**, run `npm ci --ignore-scripts` in each (`npm ci --ignore-scripts --omit=dev` for make-dashboard, make-diagram, make-explainer and make-scene), and point `AGENTS.md` at their `SKILL.md` | Ask for a dashboard, a diagram, an explainer, a 3D scene or a video |

`<repo>` is a clone of `https://github.com/abhijitbansal/claude-skills`. The
installer runs `npm ci --ignore-scripts` for you. Pass `--link` to symlink to the clone (then
`git pull` updates the skills), `--skills make-motion` to install just one, or
`--force` to replace an existing install. A skill's required skills come with it:
`--skills make-explainer` (or `make-scene`) also installs make-diagram and make-dashboard (the
`portableArtifacts.requires` list in its `package.json`). make-motion is
optional for the explainer and is only installed if you name it.

The repo-wide `adapters/install.sh codex|copilot` symlinks *every* skill in
this repo, these five included. Only `install.mjs` also runs `npm ci --ignore-scripts`, supports
project scope and writes the Gemini commands.

For **make-motion**, also run the one-time `npx playwright install chromium`
inside the skill folder (about 150 MB), and make sure `ffmpeg` is on your
`PATH`. Agents ask before downloading Chromium.

Per-OS commands for Node, ffmpeg and Chromium (macOS, Windows, Linux) are in
the [README requirements](README.md#requirements).

### Before the first build: doctor

Every skill has a `scripts/doctor.mjs` that checks what the skill needs and
prints the fix for each thing that is missing. It needs only Node, so it runs
before `npm ci --ignore-scripts` and reports a missing `node_modules` instead of crashing. It
never prompts and never installs anything on its own.

```bash
node <skill-dir>/scripts/doctor.mjs --json                  # what is missing, with the fix for your OS
node <skill-dir>/scripts/doctor.mjs --json --for spec.json  # any skill; make-explainer and make-scene add the sister skills the spec needs
node <skill-dir>/scripts/doctor.mjs --json --for check      # make-dashboard, make-diagram, make-explainer and make-scene: Playwright and a browser, before check.mjs
node <skill-dir>/scripts/doctor.mjs --json --for voiceover  # make-motion: the voice package, before a voiceover
node <skill-dir>/scripts/doctor.mjs --json --for cutout     # make-motion: onnxruntime-node, before cutout.mjs
node <skill-dir>/scripts/doctor.mjs --fix node_modules      # install the named ids (comma-separated)
```

Every entry script takes `--help` (usage on stdout, exit 0), and an unknown flag exits 2 with the flags it does accept.

The consent flow in each SKILL.md: the agent runs the doctor first. If anything
is missing it sends you one message with each item, why it is needed, its size
and the command, and asks once. On yes it runs `--fix <ids>`. Anything that
needs `sudo`, has no automatic fix or fails (for example a sandbox without
network) comes back to you as the exact command to run yourself; in Claude Code
prefix it with `!`. On no the agent does what it can without the item, for
example make-motion still writes `film.json`, runs `make.mjs --outline` and hands you the
build command. `--for` takes a spec `.json` in every skill (make-explainer and
make-scene add sister skills from it), `check` (make-dashboard, make-diagram, make-explainer and make-scene), and `voiceover` or `cutout` (make-motion). Unknown or
misspelled arguments exit 2 and list the accepted ones. `--fix` takes the same
`--for` the diagnosis used: it resolves ids against that target, so an id the
target does not list (say `chromium` with a spec that has no check step) is
refused as "unknown id". Without `--for` it accepts every id the skill could
need, sister skills included. `dev_deps` (Playwright) and `chromium` (the browser
`check.mjs` uses) are required under `--for check`; plain diagnosis needs
neither. make-motion has no `check` target (its review runs inside `make.mjs`). make-explainer names the browser that renders its motion section
`motion_chromium`: it installs through make-motion's Playwright, apart from its
own `chromium`. `--fix` exits 1 when any requested id is refused, skipped,
failed, still missing afterwards or installed elsewhere, optional ids included.
On Windows the text output labels command lines `(cmd.exe)`.

If a build prints `warning: this script runs from …, not the installed copy …`, it was started from an old folder under `~/.claude/plugins/cache/` while `~/.claude/plugins/installed_plugins.json` points at a newer one. Run `npm ci --ignore-scripts` in the installed skill folder it names (or its `doctor.mjs --fix node_modules`) and use that folder's scripts.

### Tested hosts

Every number below was measured on a release before 1.2.0, and no run on 1.2.0 or later has a committed summary; which
release each summary covers is in [`eval/results/INDEX.md`](eval/results/INDEX.md). Tested live: **Claude Code**, and
**GitHub Copilot CLI 1.0.98** (one non-interactive run per skill on 2026-10-15, plus reruns of the doctor
install path: each run picked up its skill, ran the doctor, set the host name,
validated and built a page). The browser check (`check.mjs`) was never run by an
agent there, and consent was pre-granted in the prompt, so the ask-first step was
not exercised. An earlier live eval on 2026-10-10 ran **Codex CLI 0.145.0**:
dashboard 10/10, motion (make-motion 1) 5/10 under today's scorer (the summary counted six valid, one of them an edit that left the seed untouched; four more prompts were stopped by the
account's usage limit; the five that ran all built a page)
([`summary-full-2026-10-10.md`](eval/results/summary-full-2026-10-10.md)).
A local model through Ollama (gemma4) built a dashboard 10/10 after a SKILL.md fix (a 2026-10-12 rerun gave 7/10 and 6/10) but only 4/10 to 7/10 on motion (make-motion 1) and 0/8 on explainer (on motion the cause found was the model ending its turn before it wrote the spec);
the eval refuses those two without `--allow-local-models`.
**Gemini CLI**: its install paths were checked against its documentation on
2026-10-15 and not run live. **make-scene**: 10/10 valid builds on the first run (Claude Haiku in Claude Code, median 1.5 validate runs, median 40 s)
([`eval/results/summary-scene-2026-10-19.md`](eval/results/summary-scene-2026-10-19.md)). Results:
[`eval/results/summary-portability-copilot-2026-10-15.md`](eval/results/summary-portability-copilot-2026-10-15.md)
and [`eval/results/summary-install-targets-2026-10-15.md`](eval/results/summary-install-targets-2026-10-15.md).

### Director and operator

Each `SKILL.md` has a `## Director and operator` section, the same text in all five skills. The agent you talk to is the director: it runs the intake, writes the spec, views what was built and decides every `creative` finding. It may hand the one build command, `node <skill-dir>/scripts/make.mjs <spec> --json`, to a small `artifact-builder` operator agent on a cheap model. The operator fixes only `mechanical` findings (a JSON path to change), at most twice, and returns the report. It never writes a spec and never acts on a `creative` finding. The director trusts the report and the output file, not the operator's prose, and takes over when the same `mechanical` finding survives two operator attempts or names no path. With no `artifact-builder` in the host's list of agents, or if it fails to start, the director runs the same command itself.

Where the agent file lives, per host:

| Host | File | How the director gets it |
|---|---|---|
| Claude Code | `agents/artifact-builder.md` in the plugin (model `haiku`, tools Read, Edit and Bash); `install.mjs claude` writes it to `.claude/agents` | Listed as `<plugin>:artifact-builder`; the skill tells the director to start it with the skill directory and the spec path |
| Copilot CLI, VS Code Copilot Chat | `~/.copilot/agents/artifact-builder.agent.md` (project scope: `.github/agents`) | The same hand-off from the skill; advisory, the main agent may choose to run the command itself. VS Code is untested |
| Codex | `~/.codex/agents/artifact-builder.toml` (project scope: `.codex/agents`), or the `default_subagent_model` key under `[agents]` in Codex config | The same hand-off; written from the Codex docs, not run live |
| Gemini CLI | nothing | The director runs the command itself |

No `SKILL.md` pins a model or an effort in its frontmatter any more.

Install the agent file with one of these (add `--project <dir>` for project scope, and use `codex` or `agents` in place of `copilot` for those hosts):

```bash
node plugins/portable-artifacts/bin/install.mjs copilot
node plugins/portable-artifacts/bin/install.mjs copilot --agents-only
```

The first command installs the skills and the agent. The second writes only the agent file, for users whose skills came another way. An existing agent file is kept unless you pass `--force`.

Installed with `npx skills add`, which copies skill folders only (no `bin/install.mjs`)? Use the doctor instead:

```bash
node <skill-dir>/scripts/doctor.mjs
node <skill-dir>/scripts/doctor.mjs --fix builder_agent
```

The doctor reports a missing agent file as an optional item, and only where `~/.copilot` or `~/.codex` exists. `--fix builder_agent` runs the skill's own copy of `shared/agents.mjs`, which writes `~/.copilot/agents/artifact-builder.agent.md` and/or `~/.codex/agents/artifact-builder.toml` (user level, outside the project; an existing file is kept, never overwritten). The skill's workflow already tells the agent to ask you before running a doctor fix. Project-level install (`.github/agents`, `.codex/agents`) still needs `install.mjs --project`. A host may need a new session before it lists the new agent.

**What was measured, and on which scheme.** No run of the director and operator scheme has a committed summary: the billed eval of it is open, and `eval/run-eval.mjs` has a delegation view for it. The only measurements below were taken on 2026-10-21 on Copilot CLI 1.0.98 under the earlier scheme, where each skill had a "Cheaper model" section and the cheap model wrote the spec itself (the session ran as `copilot -p "<prompt>" --allow-all-tools --agent artifact-builder`, on make-motion 1 for motion). They are kept as dated records ([`summary-routing-2026-10-21.md`](eval/results/summary-routing-2026-10-21.md)):

| Run | Valid builds | Model |
|---|---|---|
| make-motion 1, all 10 prompts | 10/10 (validate runs 1-4, median 2; 26-57 s per case) | `claude-haiku-5.5` reported for 9 of 10; the edit case did not set `generatedBy` |
| dashboard, diagram, explainer, scene (9 runs) | 9/9 | `claude-haiku-5.5` reported for all 9 |
| Copilot's own logs, all 19 runs | 19 lines `Using model "claude-haiku-5.5" from custom agent "artifact-builder"` | the default would have been `claude-sonnet-5.5` |

Under that scheme the skill hand-off was advisory. In the one live trial (make-explainer on the default model, no retries), the main agent did hand off and the sub-agent ran on `claude-haiku-5.5` and obeyed the loop guard, but the sub-agent hit `Permission denied because no interactive user response was available` on both its tools when reading the skill file. That skill was a `--link` symlink pointing outside the project; the cause was not verified and a copy install was not tried. The main agent said so and built the page itself (validate passed, 34 s). So the hand-off happened and the fallback worked, but the cheap model did not do the work in that run.

Cost: only that one trial was measured, at 18.7 AI Credits (about $0.19 at 1 credit = $0.01; 432k input tokens, 353k of them cached, 4.2k output tokens). The cost of the smoke and motion runs was not measured. Claude Haiku 5.5 is listed at $0.10 / $0.50 per 1M input / output tokens; the default model's price was not looked up here, so no saving is claimed.

Not tested: Codex (no account; the files come from the Codex docs), VS Code Copilot Chat, and a copy install for the hand-off trial.

## 2. Dashboards with make-dashboard

**Ask:**

> Build a dashboard from data/sales.csv: total revenue and units as KPI
> tiles, revenue by region, and the monthly revenue trend.

**What the agent does** (every command is `node <skill-dir>/scripts/…`, run
from your project folder):

1. `inspect.mjs data/sales.csv` reads the real column names and types. It
   never guesses.
2. Writes `dashboard.json` next to the data.
3. `validate.mjs dashboard.json` checks the spec, parses and binds every query
   against the data, and compiles every chart. The agent fixes each
   `path: message` line until it prints `valid`.
4. `build.mjs dashboard.json` writes `dist/index.html` next to the spec (`--out <dir>`
   picks another folder; this skill ignores `PA_OUTPUT_DIR`), then prints the page's
   `file://` URL alone on its own line and the `serve:` command. `query.mjs dashboard.json
   --chart <id>` prints the rows one chart will show, so a chart title can state what they show.
5. Optionally `check.mjs dist --shots shots` opens the page at 1280 and 390 px, light and
   dark, and fails on console errors, chart errors, empty panes or sideways scrolling; `--shots`
   writes one PNG per width and colour scheme to open and look at. It needs Playwright and a
   browser; without them it prints `check: skipped` and exits 0 (`--json` says `"skipped": true`,
   and a skipped run is not a pass).
6. Gives you the page path and URL, with one line per chart.

**What the page can do:**

- **Chart kinds:** bar, stacked-bar, grouped-bar, line, area, scatter, bubble, heatmap, histogram, boxplot and donut. The agent names the columns and the build writes the chart. Raw Vega-Lite still works for anything else. Reference: `make-dashboard/references/kinds.md`.
- **Views:** each card can switch between alternate views (sorted, share, 100%, area, boxplot, …) and a sortable Table view; `pair: true` shows two side by side.
- **Export:** every card has an Export menu for PNG, SVG and CSV.
- **Themes:** `paper` (default), `blueprint`, `editorial`, `ink`, the newer `dusk`, `press` and `poster`, and the plan-page themes `mono` and `brief` (see the [README](README.md#themes-and-art)). Ask for one, or pass `--theme <name>` to `build.mjs`. The page also has an icon toggle that cycles Auto, Light and Dark.
- **Live reload:** see below.

**Open the result:** double-click `dist/index.html` (it is one
self-contained file), or run the printed `serve:` command. Every chart card
has a *Query* disclosure with the SQL, the row count, the refresh time and
the first rows of the result.

**Live reload while you edit:**

```bash
node <skill-dir>/scripts/serve.mjs --watch dashboard.json --open
```

It rebuilds when you save the spec or a file source (csv, parquet, json, duckdb, sqlite) and reloads the page. Postgres and MySQL have no file to watch: add `--interval 60` (5 to 86400 seconds). The page has a *Rebuild now* button. A failed build shows a banner and keeps the last good page. `--out <dir>` (with `--watch`) puts the watched build somewhere other than `dist/`. A page opened from disk (`file://`) is static.

**Refresh the data:** rerun `node <skill-dir>/scripts/build.mjs
dashboard.json`. No agent is needed. For a schedule, copy the cron or launchd
recipe from `make-dashboard/references/refresh.md`.

**Databases:**

```json
"sources": {
  "shop": { "type": "sqlite", "path": "data/shop.db" },
  "wh":   { "type": "postgres", "env": "WAREHOUSE_URL" }
}
```

- Run `node <skill-dir>/scripts/setup.mjs dashboard.json` once, online. It
  installs the DuckDB extensions those sources need, and later builds stay
  offline.
- Query attached tables as `shop.orders` or `wh.public.orders`.
- Put the connection string in the environment (`export
  WAREHOUSE_URL=postgres://readonly@host/db`). Use a **read-only** database
  role. Sources attach `READ_ONLY` either way.

**Data outside the project folder:** sources must live under the spec's
folder. Move or copy the data in, or, if you mean it, add `--allow-outside`
to the `validate` and `build` commands yourself. The agent is told never to
work around this.

## 3. Diagrams with make-diagram

**Ask:**

> Draw the checkout request path from the browser to the orders DB: a web
> app calls the checkout API, which writes to Postgres and charges the card
> through an external payment provider.

**What the agent does** (commands are `node <skill-dir>/scripts/…`, run from
your project folder):

1. Picks the type (`architecture`, `flow`, `sequence` or `state`) and writes
   `diagram.json`: nodes and edges, or participants and messages. There are
   no coordinates, colours or CSS in the spec; layout is automatic.
2. `icons.mjs search postgres` finds an icon ref (`brand:postgresql`) when one
   helps. Most kinds have a default icon; start, end, decision and choice are drawn as shapes and take none.
3. `validate.mjs diagram.json` checks the spec, then lays the diagram out and
   lints the geometry (text that does not fit, overlapping nodes). The agent
   fixes each `path: message` line until it prints `valid`.
4. `build.mjs diagram.json` writes one offline HTML file and prints `wrote <path>`, then
   the page's `file://` URL alone on its own line. With no `--out` the page goes to
   `$PA_OUTPUT_DIR` if that is set, else `<git root>/.scratch/<slug>.html` when the spec sits in
   a git repository, else `~/.agent/diagrams/<slug>.html`. `--out file.html` or `--out dir` overrides all of
   these; an `--out` that does not end in `.html` is a folder. Add `.scratch/` to `.gitignore`
   (the build prints a note when it is not ignored). `--theme <name>` overrides the spec's
   theme: `blueprint` (default), `paper`, `ink`, `editorial`, `dusk`, `press`,
   `poster`, `mono` or `brief`. `--format svg --out diagram.svg` writes one standalone SVG
   instead, in the theme's light palette, with no browser.
5. `check.mjs <page>` opens the page at 1440 and 390 px and reports overflow,
   console errors, text that leaves its box, a node under the legend
   overlay, labels that draw below the legibility floor at fit, and a story that cannot
   reach its last beat. `--shots <dir>` also writes one PNG per width (390, 1280) and colour scheme;
   open them and look before you report. It needs Playwright and a browser (a full `npm ci --ignore-scripts` plus
   `npx playwright install chromium` in the skill folder). Without them it
   prints `check: skipped` with the doctor command to run
   (`doctor.mjs --for check --fix dev_deps` or `--fix chromium`) and exits 0.
   Building needs no browser.
6. Tells you the path, what the diagram shows, and that Play story (or `P`)
   opens beat 1, Space plays it, `E` explores and `F` is full screen.

**In the page:** wheel or pinch to zoom, drag to pan, `0` or double-click to
fit, `F` for full screen, `A` toggles edge-flow animation, and the toolbar
exports SVG or PNG, and an icon toggle cycles auto, light and dark. **Play story**
(`P`) opens beat 1 and Space plays: the camera follows each hop, a dot travels
along the edge, and the caption bar shows the beat's title and sentence. The
transport bar has previous and next beat or chapter, a scrubber, speed (0.5x to
2x) and loop; arrows, Page Up/Down, Home and End step, and `Esc` leaves.
**Explore** (`E`): click a node or edge for its details (kind, note, detail,
what it sends and receives), shift-click a second node for the shortest route,
and `/` finds nodes by name. Reduced-motion settings turn the dot, the glides
and `autoplay` off.

**Stories:** write `stories`, up to 8 named chapters with 60 beats in all.
Each beat has a `title`, an optional `caption`, and one target: an `edge` id,
a `from`/`to` pair, or `focus` ids. One story for the main path and one per
side path (the retry, the failure) reads best; `"autoplay": true` starts the
player when the page opens. Nodes and participants may also carry one `emoji`
(drawn in the icon tile) and a `detail` (up to 400 characters, shown in
Explore). Leave `stories` out and the build makes one beat per layout layer
(one per message in a sequence). The older `steps` form still works but cannot
be mixed with `stories`.

**Keep it readable:** labels are nouns, edge labels are verbs, and about 12
nodes per diagram reads best. Past that, ask for two diagrams. Hard limits are
60 nodes, 120 edges, 12 participants and 60 messages.

**Reference:** every field is in `make-diagram/references/schema.md`, the
kinds and icons in `references/kinds.md`, and one working file per type in
`references/examples/`.

## 4. Explainers with make-explainer

**Ask:**

> Recap this branch for review, with a manual test checklist for the parts a
> person still has to try.

(or "explain how our cache works as a five-slide deck", "make a test checklist
for the login change", "turn this plan into a one-page explainer")

**What the agent does** (commands are `node <skill-dir>/scripts/…`, run from
your project folder):

1. For a branch, `gather.mjs git --out facts.json` reads the committed
   work: commits, files changed with line counts and renames, test files and
   the date. `--repo <folder>` reads another checkout; `--base` defaults to
   `main`, then `master`, preferring origin's copy when it is ahead.
2. `scaffold.mjs recap --facts facts.json --out explainer.json` writes a starter
   file (also `checklist`, `concept` and `slides`). `concept` and `slides` take no facts. Without `--facts`, `recap` is a shorter skeleton (tl;dr, how it works, risks: no numbers, files or timeline) and `checklist` has one TODO area group plus the regression group.
   The numbers, file list, timeline and checklist groups are filled in; every
   sentence is a `TODO: …` string. With no preset, the agent writes the file
   from the section list. `--out` refuses a file that already exists, because it may
   be filled in; edit that file in place, or pass `--force` to replace it.
3. The agent reads the changed files and replaces each `TODO:` with prose.
   Section titles state the finding ("Search now ignores case"), not a label.
4. `validate.mjs explainer.json` checks the schema and limits, file references,
   the embedded diagrams and charts, and the prose rules. It fails on leftover
   `TODO:` text, filler phrases ("leverage", "seamless", "delve"), titles
   numbered like `01` or ending in `!`, and (for slides) a slide with more
   than 6 points, 8 table rows, 12 code lines or 80 words. Each line is a JSON
   path, the problem and the fix; `--strict` turns the length caps into errors; without it text over the soft caps only warns (exit 0): title 8 words, label 4 words, paragraph 3 sentences or 60 words, text section 120 words, card text 30 words, list item 20 words, page prose 900 words (1,800 on a plan page), `tldr` 3 points. Emoji are allowed; dense emoji only warn: a prose string with 3 or more at more than 1 per 40 characters, or a section title with more than 3. Each warning names the section; resolve them before building where you can.
5. `build.mjs explainer.json` writes one HTML file and prints its path, then the page's `file://` URL
   alone on the last line. With no `--out` the page goes to `$PA_OUTPUT_DIR` if that is set, else
   `<git root>/.scratch/<slug>.html` when the spec sits in a git repository (add `.scratch/` to
   `.gitignore`), else `~/.agent/diagrams/`; to keep the page next to the spec in a project, pass
   `--out ./<name>.html`. `--out file.html` or `--out dir` overrides all of these. `--strict` is the same as
   in validate. `--md` also writes the markdown twin of the checklist sections (`<name>.md`) next to
   the page and is an error when the spec has no checklist. `--theme <name>` overrides the spec's
   theme: `dusk` (default), `press`, `poster`, `paper`, `blueprint`, `ink`,
   `editorial`, `mono` or `brief` (see [Choosing a theme](#choosing-a-theme)); `--model`, `--effort` and `--agent` set the
   provenance stamp (see [section 7](#7-what-every-page-carries)). A video or an interactive chart adds a
   `<name>.assets/` folder beside the page: keep them together.
   `--image-api <https-endpoint>` is an optional extra described
   [below](#optional-hero-image); without it the build never uses the network.
6. Optionally runs `check.mjs <page>`, which opens the page at 1280, 390 and 1800 px and
   fails on console errors or warnings, sideways scrolling, elements wider than the page,
   content clipped sideways inside a slide, a deck that cannot
   reach its last slide with the arrow keys, a number and its unit that wrap across two lines,
   a KPI value wider than its tile, a checklist whose ticks are not saved, or a diagram Present overlay that
   will not close on Esc. A page with a Simple English toggle is measured again with the toggle
   pressed, and those problems say "(simple)". `--shots <dir>` writes one PNG per width (390, 1280)
   and colour scheme to open and look at. It needs Playwright and a browser (a full `npm ci --ignore-scripts` plus
   `npx playwright install chromium` in the skill folder); without them it prints
   `check: skipped` with the doctor command to run
   (`doctor.mjs --for check --fix dev_deps` or `--fix chromium`) and exits 0.
7. Tells you the path and what the page shows.

**Presets:** `recap` (tl;dr, numbers, how it works, files changed, timeline,
risks), `checklist` (a group per area of changed files, a regression group, an
intro and "If something fails"), `concept` (tl;dr, explanation, cards, steps),
`slides` (a deck), `plan` (a plan that explains before it asks, which the
reviewer answers on the page, see below). **Sections** (25): `tldr`, `text`,
`kpis`, `cards`, `table`, `risks`, `files`, `steps`, `timeline`, `compare`, `callout`, `code`, `diff` (a unified diff,
one marked row per line),
`details`, `checklist`, `diagram`, `chart`, `motion`, `scene`, `image`, and
for plans `decision`, `approval`, `question`, `review`, `verdict`.

A checklist item can carry `tags` (up to four free labels, next to the `regression` or `device` tag), `steps` (what to do,
in order, as a numbered list under the item) and `expect` (a "You should see" line); a group can carry an `intro`
("read this first"). Editing an item's `steps` or `expect` does not reset its tick; editing its `text` does.

**Plan mode.** Ask for a plan, proposal or design to be reviewed and answered.
`scaffold.mjs plan --title "…" --out plan.json` writes a starter that
explains before it asks: a summary, three numbers, a card per workstream, goals,
one workstream's tasks as steps (copy it once per workstream), a table of choices
already made, a diagram, phases and risks, then a decision, an approval, a
question, "review these first" and last the reviewer's overall verdict control.
Validate warns when a decision, approval or question comes before any steps, cards,
table, files or text section. A plan page may hold 1,800 words of prose, not 900.
The agent replaces each `TODO:` and builds the page, which defaults to the `mono`
theme (`--theme brief` for the executive look). The reviewer picks one option per decision, approves,
asks for changes or rejects each approval, answers each question, gives an
overall verdict and a name, then presses Copy answers or Download
`plan-answers.json`, or Save as HTML. Answers are saved in the reviewer's browser, keyed by the
plan's `key` and a hash of its content, so answers to an edited plan are
flagged instead of reused. **Save as HTML** is a button in the sticky contents
menu on the left (a corner button on a phone, or on a page too short for a
menu): it downloads `<key>-answered.html`, this same page with the answers put
inside it. Opening that file shows the answers again, in any browser, with no
storage needed, so it can be kept, shared with others or handed to the agent. If this
browser already holds a newer answer for the same plan (or one written before saved
pages existed), that answer wins; otherwise the file's answers are shown, and nothing
is written to this browser until the reader changes something. The agent reads the
answers as they were saved in the file, not what a browser shows later. The reviewer's
theme choice is not baked into the file. A saved page is a full web page, not inert
JSON: open one only if you trust whoever sent it, and give it to the agent only through
`answers.mjs`. The agent
never reads a file directly: it runs `answers.mjs plan.json plan-answers.json`
or `answers.mjs plan.json <key>-answered.html`
(add `--json` for machine-readable output), which exits 0 for valid answers, 1
for problems and 2 for a usage error, and acts only on a summary that does not
start with `INVALID ANSWERS`. If the answers come back pasted into a chat,
write them unchanged to `plan-answers.json` first. A worked example is
`references/examples/plan.explainer.json`.

**Embedding other skills:**

- `diagram`: an inline make-diagram spec, or the path to a `*.diagram.json` in
  the same folder. It gets hover tracing and a Present button. The page's
  theme wins over a theme in the diagram (a warning says so).
- `chart`: either rows written inline (up to 500) with a `kind`, `x` and `y`,
  or a make-dashboard `dashboard.json` plus a chart id. The page draws a
  static SVG, light and dark, with a data table. `interactive: true` also
  builds the dashboard next to the page and links it. Local files only: a
  dashboard with a Postgres or MySQL source is refused.
- `motion`: an `.mp4` (up to 50 MB), or a make-motion film (version 2, a
  `film.json`) rendered during the build (needs make-motion, ffmpeg and Chromium; set
  `PA_MOTION_TIMEOUT_MS` for a long render). A version 1 spec is refused with
  the validator's own sentence. The video never autoplays.
- `scene`: an inline make-scene spec, or the path to a `.json` (up to 1 MB), drawn
  as an interactive 3D view in a fixed frame that renders only while visible.
  At most 4 per page. The page's theme wins over the scene's. Decks and print
  show its data table (or the 2D drawing of a lift).
- These need `make-diagram` and `make-dashboard` installed beside
  `make-explainer` (the installer adds them; see the install table), and
  `make-scene` for a `scene` section.

**Labels:** any section may carry a `label` of up to 4 words ("Eval results").
The contents list and a small eyebrow above the heading use it; `title` stays
the finding sentence. Without a label the contents list falls back to the title.
A label shows on every section that has a `title`, except a `callout`, and on a
leading `tldr`'s hero card even without a title. `scaffold.mjs` adds a label
placeholder (`TODO: 2-4 word label`) to each section; the agent fills it in.

**In the page:** the page opens with a hero (title, subtitle, meta chips and the
leading `tldr` as a card with an accent rule), then the numbers; sections
alternate onto a surface band. A contents list from four sections up, copy
buttons on code, an icon theme toggle, print styles. **Checklists** save their ticks in your browser
(per `key`), show a progress bar and per-group counts, and Reset asks before it
clears. A tick follows its item if the list is reordered; editing an item's
text clears that item. The `intro` ("What's in this branch") lists every
feature and every fix from review, so a tester needs no PR. **Slides** use the
arrow keys, Space, Page Up and Page Down, Home and End; `O` opens an outline,
`#slide-3` opens slide 3, the last slide is remembered, and printing gives one
slide per page.

### Choosing a theme

make-explainer follows these rules (a make-motion film has a look, not a theme; see
[section 5](#5-videos-with-make-motion)):

1. A theme you name wins: `--theme poster`, or "use poster" in the prompt.
2. Otherwise the agent picks one from the prompt and says which and why in one
   line: `press` for dense docs, long reads, changelogs and branch recaps;
   `poster` for launch decks, pitches, demos and energetic clips; `dusk` for
   everything else, or when it is unclear.
3. If the prompt fits two themes equally, the agent asks once and lists the
   three with a one-line feel each (`dusk` soft and warm, `press` calm print,
   `poster` loud and condensed). If it cannot ask, it uses `dusk`.

`paper`, `blueprint`, `ink`, `editorial`, `mono` and `brief` still work, but only
when you name them (`mono` and `brief` are meant for plan pages; a `plan` defaults to `mono`). In `dusk`, `press` and `poster` the page hero and a deck's title and
closing slides carry procedural art drawn from the title: no network, and the
same title gives the same picture.

### Optional hero image

`build.mjs explainer.json --image-api <https-endpoint>` swaps the page hero's
art for a picture from an image service you choose. It is off by default.
Before you use it:

- **Data leaves your machine.** The page title and subtitle are sent to that
  host; the build says so on stderr before it sends.
- **It may cost money.** Each build with the flag is one request your service
  may bill. Rebuild without the flag to stop.
- **Your key**, in `PA_IMAGE_API_KEY`. It is never written to the page.
- **Page hero only**, and only in `dusk`, `press` or `poster`. A deck or any
  other theme is refused (exit 2) before anything is sent.

Any failure stops the build with exit 2; there is no silent fallback. The
picture is inlined, so the page stays one offline file. The request and reply
format is in `make-explainer/references/schema.md` ("Hero image from an image
API").

**Reference:** every field is in `make-explainer/references/schema.md` and
`sections.md`, the banned phrases in `style.md`, and one working file per
preset in `references/examples/`.

## 5. Videos with make-motion

make-motion 2 reads version 2 films only: a script of shots in one JSON file, `film.json`. A version 1 spec (one with `scenes`) is refused with a pointer to `skills/make-motion/references/migrating.md`, which says what each version 1 feature became and what is not in 2.0. The clips in the gallery and on the site were made with make-motion 1.x.

**Ask:**

> Make a 10-second explainer: "Q3 revenue up 18%" with a counter, then a bar
> chart of Q1 32M, Q2 35.7M, Q3 42.1M with Q3 highlighted.

**What the agent does:**

1. Asks one intake round (see below), then writes `film.json`: `{ "version": 2, "shots": [...] }`. Each shot has an `id`, a `show` (its kind: `statement`, `number`, `chart` and so on) and usually a `say`, the sentence that narrates it. A shot lasts as long as its narration takes at the mode's pace, plus a short tail.
2. `make.mjs film.json --outline` checks the film and prints each shot with its start, end and narration, with no browser. The agent fixes every line it prints (`<json.path>: <message>`).
3. `make.mjs film.json --json` validates the film, reviews every shot in a browser, writes review sheets (one PNG per shot and one strip per cut) and renders the MP4. Findings are `mechanical` (a JSON path and a message: change it and run again) or `creative` (a call for the agent, never a failure). The agent opens each sheet, writes `review.md` and fixes the film until `ok` is true.
4. Offers `make.mjs film.json --preview --open`, a local page on `127.0.0.1` with a scrubber. It keeps running until you stop it.
5. The MP4 lands in `out/<name>.mp4` beside the film, and the sheets in `out/<name>.sheets/`. Two renders of the same film and media give the same frames; the MP4's `comment` tag carries the build date, so the files differ by day unless `SOURCE_DATE_EPOCH` is set. Exit 0 is ok, 1 findings or an invalid film, 2 usage or machine trouble, 130 interrupted.

**Looks and kinds.** A look is the whole style of the film. There are seven (`node <skill-dir>/scripts/make.mjs --list looks`): `desk` (editorial paper collage, the default of `pro`), `pop` (short-form caption collage, the default of `viral`), `cosmos`, `ledger`, `poster`, `keynote` and `marker`, a whiteboard time-lapse in which a hand draws every stroke. A prompt that asks for a whiteboard or a hand-drawn look sets `marker`. A kind is one idea on screen. There are sixteen (`--list kinds` prints each with its fields and one example to copy): `statement`, `number`, `clipping`, `end`, `list`, `quote`, `compare`, `chart`, `media`, `screen`, `map`, `diagram`, `timeline`, `code`, `feed` and `free`. Some looks park a kind (it renders with a note) or exclude it (it is refused, with the looks that have it); the table is in `skills/make-motion/SKILL.md` and `README.md`. `--list` also takes `modes`, `devices`, `moves`, `cuts`, `fields` and `voices`.

**The intake round.** Before it writes the film the agent asks once, in one message, listing each option with its default: `mode` (`pro`, a calm 16:9 explainer, or `viral`, a fast 9:16 short for Reels, TikTok and Shorts), `look`, `format` (`16:9`, `9:16`, `1:1` or `4:5`), `length` (about 30 s for `pro`, 15 s for `viral`), `assets` (none), `voice` (off), `music` (none), `sound` (none in `pro`) and `ask` (a closing line, none). Answer all of it in one reply, or say "defaults". An option your prompt already settles ("a vertical short", "with a voiceover") is not asked again. A run that cannot pause for an answer (`claude -p`, `codex exec`, an eval) skips the round and builds with the defaults, and its final report carries one line naming what it used:
`intake: skipped (<reason>); values used: mode pro, look desk, format 16:9, length 30 s, assets none, voice off, music none, sound off, ask none`
(the values shown are the defaults; a value your prompt settled appears instead).

**The storyboard.** For a film over 20 s, after the intake round, the agent runs `storyboard.mjs film.json --out plan.json`. That writes a make-explainer plan page for you to answer before the film is built. The step is skipped, with one line in the final report (`storyboard: skipped (<reason>)`), for a film of 20 s or less, when make-explainer is not installed beside make-motion, and under `claude -p`, `codex exec`, `copilot -p`, an eval, or any run that cannot pause for an answer (the agent passes `--non-interactive`). A skip is never an error: the film is built directly.

**Narration and anchors.** `say` is the narration, written for the ear: short sentences, one idea each, with `*word*` marking the few words that carry the point. An `on` list ties a device (a circle, a highlight, an arrow) to a spoken word: `{ "at": "word:query", "do": "highlight", "target": "region:query" }`. `cut` on a shot names how the film arrives at it (`--list cuts`). `make.mjs film.json --phonemes` prints how each sentence will be read, so a word with two readings (resume and résumé, lead, read) can be respelled in the `say` text.

**Audio is opt-in.** The agent adds a `voice`, `music` or `sound` only when you ask for sound ("with a voiceover", "with background music from music.mp3"). A prompt that says nothing about sound renders silent. In `viral` mode the designed cues play unless the film says `"sound": "off"`.

- **Voiceover.** `"voice": { "name": "af_heart" }` at the root; the narration is made on this machine. The agent asks once to install the voice package (about 227 MB, `doctor --fix kokoro`, measured with `du -sk` after `npm ci --ignore-scripts` in `optional/voice`) and a model of about 93 MB, downloaded once on first use (the five pinned files total 92,886,949 bytes; one pinned commit, each file SHA-256 checked). `make.mjs --list voices` prints the voices without loading the model. The only claim this document makes about the voice is a measured one: on the held-out fixture lines, for the word starts that follow a silence, the predicted start was a median 9 ms from the onset ffmpeg's silence detector found. Nobody has listened to the audio, so the agent says what the run printed and never that it sounds right.
- **Music.** `"music": { "bed": "pulse", "bpm": 92 }` (a synthesised bed: `pulse`, `drift` or `tape`) or a file you supply, `"music": { "src": "data/music.wav" }`. `beats.mjs data/music.wav` finds the beat grid of a music file with a local detector and writes `data/music.beats.json`; name it in `music.beats` and set `music.snap` so the cuts move onto the beats. It exits 1 with `no steady beat found` when the track has none; `--bpm` forces a tempo when the detector picks the wrong one.
- **Cues.** `"sound": "on"` turns on the designed cues, synthesised on this machine (`pop`, `click`, `whoosh`, `chime`, `impact`, `riser`, `swoosh`, `drop`, `ding`, `sub`, `paper`, `marker`, `erase`); a `cues` list, `[{ "at": 2.5, "cue": "pop" }]`, places your own. `audio` adds extra sound files, `[{ "src": "ding.wav", "at": 3 }]`.
- **Captions** are a separate switch, `"captions": true`, off by default. `--subtitles srt` (or `vtt`) writes a subtitle file; no caption file is read.

**More from the same command.**

- `make.mjs film.json --poster 4.5` writes one still instead of the MP4 (`--poster-out <file>.jpg` names it).
- `--workers 4` (or `auto`) captures frames in parallel. `--exact` captures every frame as a PNG. `--sheets-only` writes the review sheets and encodes nothing.
- **One video per row.** Declare `vars` in the film, `{ "name": { "type": "string", "default": "Ada" } }`, write `{{name}}` where a value goes, put the values in a JSON array of objects, and run `make.mjs film.json --batch rows.json --out "renders/{name}.mp4"`. The `--out` needs `{index}` or a `{var}`.
- **Footage and pictures.** A `media` shot places a picture or a clip from the project folder (`src`, and for a clip `in`, `out` and `muted`). A `clipping` shot shows a screenshot with highlighted regions. A `cutout` device places a picture with transparency; `cutout.mjs photo.png` makes one locally after a one-time install the agent asks about.
- `--model`, `--effort` and `--agent` set the provenance stamp; `--no-provenance` (or `"provenance": false` in the film) leaves the authoring tags out of the MP4.
- Finished films to copy are in `skills/make-motion/references/examples/v2/`. The fields every film and shot take, the report and the exit codes are in `references/schema.md`; how to write for the picture is in `references/story.md`.

**Not in 2.0.** Lottie, the nine themes and `--theme`, the 38 blocks, scenes with elements and keyframes, colour grades, a caption file as input, the recorded `kenney:` cues, `"beat:<n>"` times, `voice.mjs` as its own command, and `--contact-sheet`, `--quality`, `--fps`, `--size`, `--loudness` and `--true-peak` (each refused with a hint). `references/migrating.md` says what replaces each one.

## 6. 3D scenes with make-scene

**Ask:**

> Show our commits per week per folder as a 3D city, with a tour of the busiest
> weeks.

**What the agent does:**

1. Gets the data. Rows it already has go in `data.rows`; a CSV goes in `data.csv`
   with `columns`; for git history, `rows.mjs git --weeks 12` writes
   `scene-rows.json` (commits per top-level folder per ISO week), which the spec
   reads as `data.file`.
2. Writes `scene.json`: a title, `data` (rows of `group`, `t`, `value`) or a
   `lift`, an optional `world` and a `tour` of up to 12 camera stops. It copies
   the closest file in `references/examples/`.
3. `validate.mjs scene.json` until it prints `valid`. Each line is a JSON path,
   the problem and the fix.
4. `build.mjs scene.json` writes one HTML file and prints `wrote <path>`, then the page's
   `file://` URL alone on its own line, then an
   **alternatives table**: each world, why it fits, the page size, a render
   weight and the exact command to switch. The agent shows you that table
   unchanged. With no `--out` the page goes to `$PA_OUTPUT_DIR` if that is set, else
   `<git root>/.scratch/<slug>.html` for a spec inside a git repository, else `~/.agent/diagrams/`;
   `--out file.html` or `--out dir` overrides all of these. `--theme <name>` overrides the spec's
   theme (default `dusk`). `--fragment` writes `<slug>.fragment.html` instead: the scene's css, host,
   runtime and mount call, to paste into another page.
5. Optionally runs `check.mjs <page>`, which opens the page at 1440 and 390 px
   and fails on console errors, overflow, a blank canvas, a fallback data table that
   stays visible once WebGL runs, or a tour that cannot reach its last beat. `--shots <dir>`
   also checks the dark scheme and writes PNGs, one per width and scheme and one per tour beat:
   open them and look. It needs Playwright and a browser, and a browser with WebGL; without them it
   prints `check: skipped` and exits 0.

**Worlds** (from `data`): `city` (a district per group, buildings by `t`, height
is value), `forest` (a tree per group, branches by `t`, leaf size is value; a
`parent` grows a sub-tree), `galaxy` (a star per group, planets by `t`, links
draw light trails) and `terrain` (a group by `t` grid as a landscape; needs `t`
on every row and one row per group and `t`). The build picks the one that fits
the data (links: galaxy; parents: forest; a mostly full grid of plain numbers: terrain;
else city, so dates and weeks, even a full grid, start as a city and offer
terrain as an alternative) unless the spec sets `world`.

**Lifts** (instead of `data`): `{ "diagram": "flow.diagram.json" }` redraws a
make-diagram diagram as blocks and tubes on a floor and replays its stories
along the edges; `{ "dashboard": "dashboard.json", "chart": "<id>" }` redraws
one chart (bar, stacked, grouped, histogram, line, area, scatter, bubble,
heatmap or donut) as towers, ribbons, spheres or a surface. Boxplot and
hand-written Vega-Lite charts are not liftable. A lift needs make-diagram or
make-dashboard installed beside make-scene.

**Switching costs no model tokens.** Pick another row of the table and run its
command, which is the same build (same `--out`, `--theme` and
`--allow-outside`) with `--world <world>`. It rewrites `world` in
`scene.json` and builds again.

**Data rules.** One source: `data.rows`, `data.file` or `data.csv` with
`columns`; local files only. `group` is free text up to 48 characters, `value`
is 0 or more, at most 2000 rows and 24 groups. Give `t` sortable values:
numbers, ISO dates, zero-padded ISO weeks (`2026-W09`) or months; a string `t`
sorts as text. Tour `focus` names a group or row label (or a node id in a
diagram lift).

**In the page:** drag, scroll or pinch to orbit and zoom (it auto-orbits until
you touch it); hover or tap for the exact label and value; the Explore list
flies to any group or item; Play or Space runs the tour and the arrow keys step
the beats; `F` is full screen; PNG export saves the current view. Without WebGL
the page shows a data table (or the 2D drawing for a lift). Reduced-motion
settings turn off auto-orbit and sway, and tour beats cut instead of fly.

## 7. What every page carries

**Favicon.** Each page has an inline SVG favicon in its theme accent: three bars
for a dashboard, three linked nodes for a diagram, a page with lines for an
explainer, stacked blocks for a 3D scene. Nothing is fetched.

**Theme toggle.** A sun, moon or auto icon button cycles Auto, then Light, then
Dark, and remembers the choice in your browser. It still cycles when the browser
blocks storage. The make-motion preview has none: it is a local tool, and a film's
look sets how the video is drawn.

**Who made it.** Set `generatedBy` in the spec to the model, effort and host that
wrote it, or override per field at build time with flags:

```json
"generatedBy": { "model": "Claude Opus 5.5", "effort": "high", "agent": "Claude Code" }
```

```bash
node <skill-dir>/scripts/build.mjs spec.json --model "Claude Opus 5.5" --effort high --agent "Claude Code"
node <skill-dir>/scripts/make.mjs film.json --model "Claude Opus 5.5" --effort high --agent "Claude Code"   # make-motion
```

On make-motion the flags override the film's `generatedBy`, and `--no-provenance` leaves the authoring tags out of the MP4.

Each field is 1 to 60 characters from `A-Za-z0-9 ._:/()+-`; anything else fails
validation (exit 1) and never reaches the page. A field the agent does not know is
left out, and the page reads "not reported": nothing is guessed. The stamp shows as
a footer line (make-diagram: a line under the title), for example
`make-explainer · Claude Haiku · low effort · Claude Code · 15 Oct 2026`, and as
`<meta name="generator">`. The make-motion preview shows it in its footer, and the
MP4 gets it in the `comment` tag (and the model in `artist` when it is reported). When `generatedBy`
is set in the spec, a dashboard refresh keeps the original author; a stamp passed
only as flags is not kept by a refresh run without them. A dashboard also shows its
refresh time. Set `SOURCE_DATE_EPOCH` to pin the footer date for a reproducible build.

### Sharing a built page (Claude Code only)

Other hosts have no Artifact tool, so this applies to Claude Code. When the reader is on another
device or needs a link, hand the built HTML to the Artifact tool unchanged (a title, an icon and a
one-sentence description are enough); do not rewrite it as new HTML by hand.

- **One file or a folder.** A page with no `<name>.assets/` folder (a diagram, a scene, an explainer
  with no video or interactive chart, a dashboard's `index.html`) is already one file. A page with
  a `<name>.assets/` folder (an explainer with a video or an interactive chart) needs that folder
  too: pass it through the Artifact tool's `files` map, or the media does not load for the reader.
- **Size.** The Artifact tool caps a page at 16 MB, and each supporting file at 16 MB (15 MB for an
  image, video or font). Check the sizes of `<name>.html` and its folder first.
- **Ticks stay in each browser.** A checklist saves its ticks in the reader's own browser, so every
  reader ticks their own copy: nothing reaches another device or the agent. Do not promise shared
  progress. State that has to be shared or read back is a different Artifact feature (a runtime
  capability) that these pages do not use.
- **Keep private pages local.** A page that holds personal contacts or private plans
  stays on this machine unless the owner asks to publish it, and a built dashboard embeds its query
  results, so publishing it publishes the data. An Artifact is private by default; check who it is
  shared with before you pass the link on.
- **Not tried yet.** No built page from this plugin has been trial-published: open the published page
  signed out and look at it before you send a link, and note its size.

**Type.** The theme sets the fonts, all bundled, so nothing is fetched: `dusk`
Funnel Display, Host Grotesk and Commit Mono; `press` Young Serif, Schibsted
Grotesk and JetBrains Mono; `poster` Big Shoulders Display, Familjen Grotesk
and Martian Mono; `paper` and `blueprint` Geist and Geist Mono; `ink` Bricolage
Grotesque headings over Geist; `editorial` Newsreader headings and an Atkinson
Hyperlegible body; `mono` JetBrains Mono throughout, in regular weight only (no bold face, so bold text is synthesized by the browser); `brief` Newsreader headings,
an Atkinson Hyperlegible body and Geist Mono. A make-motion film uses the fonts of its look, bundled with the skill. Links in running text are underlined; buttons,
navigation and cards are not.

## 8. Asking for changes

All five skills edit **a few fields of the spec**, so everything else stays the
same:

| Ask | What changes |
|---|---|
| "Make the region chart a line chart" | `charts[0].kind` |
| "Add a KPI for total units" | one new entry in `kpis` (+ one query) |
| "Slow scene 2 down" | `scenes[1].duration` (+ that scene's keyframe times) |
| "Change the counter to 25" | `elements[n].to` |
| "Add a cache between the API and the DB" | one node and two edges in `diagram.json` |
| "Rename Orders DB to Ledger" | `nodes[n].label` |
| "Add a risk about the migration" | one new entry in a `risks` section's `items` |
| "Add a rollback step to the plan" | one new entry in a `steps` section's `items` |
| "Show it as a forest instead" | `scene.json` `world` (the printed switch command rewrites it) |
| "Add a beat for the week 32 spike" | one new entry in `tour` |

Never hand-edit `dist/`, the diagram or explainer HTML, or the MP4. Change the spec and rebuild.

## 9. Hosts that can't run commands

If an agent can write files but can't run shell commands, it still writes and
explains the spec, then prints the exact `validate`, `build` / `render` and
`serve` / `preview` commands for you to run.

## 10. Troubleshooting

| Symptom | Fix |
|---|---|
| `Cannot find package 'ajv'` (or duckdb, playwright) | Run `node <skill-dir>/scripts/doctor.mjs --json`, or `npm ci --ignore-scripts` inside the skill folder (`npm ci --ignore-scripts --omit=dev` for make-dashboard, make-diagram, make-explainer and make-scene) |
| `node` exits with code 139 / `SecItemCopyMatching failed -50` when an agent runs the scripts inside the Codex sandbox | `NODE_USE_SYSTEM_CA` is set (often via `launchctl setenv`); unset it for that session (`env -u NODE_USE_SYSTEM_CA codex …`) — Node 24 reads the keychain at startup and the sandbox denies it |
| `run: node …/scripts/setup.mjs` | A sqlite, postgres or mysql source needs its DuckDB extension. Run that command once, online |
| `sources.x.path: resolves outside the spec folder` | Move the data under the spec's folder, or add `--allow-outside` yourself |
| `queries.q: …` with a DuckDB message | The SQL doesn't bind (wrong table or column). Run `inspect.mjs` on the file and compare |
| `environment variable WAREHOUSE_URL is not set` | Export it in the shell (and in the cron/launchd environment) |
| Query stopped after 30 s | Make it cheaper, or pass `--timeout 120` to `build` |
| `nodes[0].kind: kind "databse" is not valid for architecture diagrams; did you mean "database"?` (and similar `path: message` lines from make-diagram) | The path is the field to fix and the message names the fix. The agent edits that field and reruns `validate` |
| `text is … px wide; the box fits … px — shorten the label` or `node "b" overlaps node "a"` | make-diagram's geometry lint: shorten the label or note, or split the diagram |
| `generatedBy.model: must match pattern "^[A-Za-z0-9 ._:/()+-]+$"` (or a 61-character value) | The `--model`, `--effort` or `--agent` flag, or the spec's `generatedBy`, has a character outside the allowed set or is longer than 60. Shorten it or drop the odd character |
| `sections[3].title: warning: title is 12 words; keep it to 8` (or label, paragraph, card, list item) | A soft cap. It does not block the build. Shorten the text or convert it (a long `text` into `cards` or `steps`) |
| `sections[3].text: still has a TODO placeholder` | A scaffold sentence was left in. Replace every `TODO: …` with real prose, or delete the section |
| `banned phrase "leverage"; replace it with "use"` (or `heading ends with "!"`) | Reword as the message says. The full list is `make-explainer/references/style.md` |
| `sections[0].text: warning: 4 emoji in 25 characters of prose; keep it under 1 per 40 → cut some, say it in words` (or `title has 4 emoji; keep it to 3`) | A soft warning; the build still runs. Keep an emoji or two and say the rest in words |
| `slide has 7 points; the limit is 6 — split this section into two slides` | In a deck each section is one slide: at most 6 points, 8 table rows, 12 code lines and 80 words. Split it |
| `make-diagram skill not found next to make-explainer (looked in …); install it with: npx --yes skills@1.7.2 add … -y` (or make-dashboard, make-scene, make-motion) | The embedded diagram, chart, icon or motion spec needs that sibling skill in the folder next to `make-explainer`. Run the printed command, or `node plugins/portable-artifacts/bin/install.mjs <host> --skills make-explainer` |
| `… is installed but its dependencies are missing` | Run `npm ci --ignore-scripts --omit=dev` inside the named sibling skill's folder |
| `dashboard: source "x" is postgres, a network source; explainer charts read local files only` | A build never uses the network. Export the query to CSV or Parquet and point a file source at it |
| `gather.mjs` prints `… is not a git repository` or `base "x" does not exist` (with the branches that do) | Pass `--repo <folder inside the repository>` and a real `--base <branch>` |
| `make-motion cannot render this spec: it needs ffmpeg and a Chromium browser` | Install both (see the README requirements), or render the clip first and use `video` with the `.mp4` |
| `check: skipped (no browser: …)` from any skill's `check.mjs` (make-scene also skips when the browser has no WebGL) | Expected without Playwright or Chromium; the page is still built. A skipped check is not a pass: `--json` carries `"skipped": true`. To run the check, use the command the skip line prints (`doctor.mjs --for check --fix dev_deps` or `--fix chromium`), or `npm ci --ignore-scripts` then `npx playwright install chromium` inside the skill folder |
| `npx playwright install chromium` hint on render | Install Chromium once inside the skill folder (Linux: `npx playwright install --with-deps chromium`), or install Google Chrome for the fallback |
| `the optional voice package is not installed. Run: …` | `npm ci --ignore-scripts --prefix <skill-dir>/optional/voice` (voiceover only; or doctor --fix kokoro; npm ci in the skill folder leaves it alone) |
| `onnxruntime-node is not installed` | `npm ci --ignore-scripts --prefix <skill-dir>/optional/cutout` (cutouts only; or doctor --fix cutout; npm ci in the skill folder leaves it alone) |
| `audio[0].src: ffmpeg cannot decode …` | The file is not a valid audio file. Re-export it as mp3 or wav |
| `ffmpeg not found` | macOS `brew install ffmpeg`, Windows `winget install Gyan.FFmpeg` (then a new terminal), Linux `sudo apt-get install ffmpeg`, or set `FFMPEG_PATH` |
| `remote data is not allowed` / `not allowed — external URLs are never fetched` | Charts must carry their data inline (motion: in the film) or come from a SQL query (dashboard) |
| `this is a version 1 spec; make-motion 2 reads version 2 only. See references/migrating.md` | The file is a make-motion 1 spec (it has `scenes`). Write it again as a version 2 film; `skills/make-motion/references/migrating.md` maps each feature |

## 11. Checking a new host or model

`eval/run-eval.mjs` runs a fixed set of prompts through a host and scores the
results:

```bash
node plugins/portable-artifacts/eval/run-eval.mjs --skill dashboard --host codex-oss --model gemma4
node plugins/portable-artifacts/eval/run-eval.mjs --skill diagram --host claude --limit 3
node plugins/portable-artifacts/eval/run-eval.mjs --skill explainer --host claude --only recap-from-repo,edit-existing
node plugins/portable-artifacts/eval/run-eval.mjs --skill dashboard --host claude --set kinds
```

It records: spec written, valid, validate retries, build or contact sheet ok,
the browser check where the skill has one, whether the spec used the feature the prompt asked for,
and which fields changed on edit prompts. `--set <name>` picks a further prompt set, and
`--host claude-frontmatter` runs Claude Code without a `--model` flag (the account's default model; no `SKILL.md`
frontmatter pins a model now, and whether the old frontmatter ever applied there was unverified, see [`eval/README.md`](eval/README.md)). A local model needs `--allow-local-models` on motion and explainer.
Each run is billed on a billed host: count the prompts first. See [`eval/README.md`](eval/README.md)
and the version each committed summary covers in [`eval/results/INDEX.md`](eval/results/INDEX.md).
