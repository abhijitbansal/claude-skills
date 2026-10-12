# portable-artifacts usage guide

Walkthroughs for the three skills on every supported host. To find out what the
plugin is, read the [README](README.md). For every spec field, see each skill's
`references/schema.md`.

- [1. Install](#1-install)
- [2. Dashboards with make-dashboard](#2-dashboards-with-make-dashboard)
- [3. Diagrams with make-diagram](#3-diagrams-with-make-diagram)
- [4. Videos with make-motion](#4-videos-with-make-motion)
- [5. Asking for changes](#5-asking-for-changes)
- [6. Hosts that can't run commands](#6-hosts-that-cant-run-commands)
- [7. Troubleshooting](#7-troubleshooting)
- [8. Checking a new host or model](#8-checking-a-new-host-or-model)

## 1. Install

| You use | Do this | Then call |
|---|---|---|
| Claude Code | `/plugin marketplace add abhijitbansal/claude-skills` then `/plugin install portable-artifacts@claude-skills` | `/make-dashboard …`, `/make-diagram …`, `/make-motion …`, or just ask |
| Codex CLI | `node <repo>/plugins/portable-artifacts/bin/install.mjs codex` | `$make-dashboard …`, `$make-diagram …`, `$make-motion …` (or pick from `/skills`) |
| GitHub Copilot CLI / VS Code | `node <repo>/plugins/portable-artifacts/bin/install.mjs copilot` (add `--project .` for `.github/skills`) | `/make-dashboard …`, `/make-diagram …`, `/make-motion …` |
| Gemini CLI | `node <repo>/plugins/portable-artifacts/bin/install.mjs gemini` | `/make-dashboard …` (a TOML command that activates the skill) |
| Any agent `npx skills` supports | `npx skills add abhijitbansal/claude-skills --skill make-dashboard make-diagram make-motion` (pick agents interactively, or pass `-a claude-code codex github-copilot -y`) | That agent's skill invocation |
| Any other agent | Copy `skills/make-dashboard`, `skills/make-diagram` and/or `skills/make-motion` into your project **with each skill's `shared/` folder**, run `npm ci` in each (`npm ci --omit=dev` for make-dashboard and make-diagram), and point `AGENTS.md` at their `SKILL.md` | Ask for a dashboard, a diagram or a video |

`<repo>` is a clone of `https://github.com/abhijitbansal/claude-skills`. The
installer runs `npm ci` for you. Pass `--link` to symlink to the clone (then
`git pull` updates the skills), `--skills make-motion` to install just one, or
`--force` to replace an existing install.

The repo-wide `adapters/install.sh codex|copilot` symlinks *every* skill in
this repo, these three included. Only `install.mjs` also runs `npm ci`, supports
project scope and writes the Gemini commands.

For **make-motion**, also run the one-time `npx playwright install chromium`
inside the skill folder (about 150 MB), and make sure `ffmpeg` is on your
`PATH`. Agents ask before downloading Chromium.

Per-OS commands for Node, ffmpeg and Chromium (macOS, Windows, Linux) are in
the [README requirements](README.md#requirements).

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
4. `build.mjs dashboard.json` writes `dist/index.html` and prints the
   `serve:` command.
5. Gives you the page path and URL, with one line per chart.

**What the page can do:**

- **Chart kinds:** bar, stacked-bar, grouped-bar, line, area, scatter, bubble, heatmap, histogram, boxplot and donut. The agent names the columns and the build writes the chart. Raw Vega-Lite still works for anything else. Reference: `make-dashboard/references/kinds.md`.
- **Views:** each card can switch between alternate views (sorted, share, 100%, area, boxplot, …) and a sortable Table view; `pair: true` shows two side by side.
- **Export:** every card has an Export menu for PNG, SVG and CSV.
- **Themes:** `paper` (default), `blueprint`, `editorial`, `ink`. Ask for one, or pass `--theme <name>` to `build.mjs`. The page also has a Theme: Auto / Light / Dark toggle.
- **Live reload:** see below.

**Open the result:** double-click `dist/index.html` (it is one
self-contained file), or run the printed `serve:` command. Every chart card
has a *Query* disclosure with the SQL, the row count, the refresh time and
the first rows of the result.

**Live reload while you edit:**

```bash
node <skill-dir>/scripts/serve.mjs --watch dashboard.json --open
```

It rebuilds when you save the spec or a file source (csv, parquet, json, duckdb, sqlite) and reloads the page. Postgres and MySQL have no file to watch: add `--interval 60` (5 to 86400 seconds). The page has a *Rebuild now* button. A failed build shows a banner and keeps the last good page. A page opened from disk (`file://`) is static.

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
4. `build.mjs diagram.json` writes one offline HTML file and prints its path.
   The default folder is `~/.agent/diagrams/` (set `PA_OUTPUT_DIR`, or pass
   `--out file.html` or `--out dir`). `--theme paper|blueprint|ink|editorial`
   overrides the spec's theme.
5. `check.mjs <page>` opens the page at 1440 and 390 px and reports overflow,
   console errors and text that leaves its box. It needs Playwright and a
   browser (a full `npm ci` plus `npx playwright install chromium` in the
   skill folder). Without them it prints `check: skipped` and exits 0. Building
   needs no browser.
6. Tells you the path, what the diagram shows, and that `P` presents it.

**In the page:** wheel or pinch to zoom, drag to pan, `F` or double-click to
fit, hover a node to trace its edges (click pins, `Esc` clears), `A` toggles
edge-flow animation, and the toolbar exports SVG or PNG and switches between
auto, light and dark. **Press `P` to present:** arrows or Space step through,
the camera moves to each step's focus (never past twice the fit), and `Esc`
exits. Reduced-motion settings turn the animation and camera moves off.

**Steps:** leave `steps` out and the build makes one step per layer (one per
message in a sequence). Write your own `steps` when you want a talk track:
each has a `title`, an optional `note`, and the `show`, `focus` and
`highlight` ids. Anything no step reveals appears in a final "Everything"
step.

**Keep it readable:** labels are nouns, edge labels are verbs, and about 12
nodes per diagram reads best. Past that, ask for two diagrams. Hard limits are
60 nodes, 120 edges, 12 participants and 60 messages.

**Reference:** every field is in `make-diagram/references/schema.md`, the
kinds and icons in `references/kinds.md`, and one working file per type in
`references/examples/`.

## 4. Videos with make-motion

**Ask:**

> Make a 10-second explainer: "Q3 revenue up 18%" with a counter, then a bar
> chart of Q1 32M, Q2 35.7M, Q3 42.1M with Q3 highlighted.

**What the agent does:**

1. Writes `motion.json` (scenes → elements → keyframes).
2. `validate.mjs motion.json` until it prints `valid`.
3. `render.mjs motion.json --contact-sheet` writes `out/contact/<scene>.png`,
   one frame per scene. The agent looks at each one and fixes clipping,
   overlaps or unreadable text.
4. Offers `preview.mjs motion.json --open`, a local page with a scrubber,
   play/pause, scene markers and frame-by-frame arrow keys. It reloads
   whenever `motion.json` changes, and shows validation errors in the page.
5. `render.mjs motion.json` writes `out/motion.mp4` (1920×1080, 30 fps,
   H.264, plus AAC audio when the spec has `audio` tracks).

**Other sizes:** set `"size": [1080, 1080]` in the spec for a square social
clip, or override at render time with `--size 1280x720 --fps 24`. If the
aspect ratio differs from the spec, the frame is letterboxed in the spec's
background colour.

**Charts in videos** are Vega-Lite specs with inline `data.values`. Animate
`reveal` from 0 to 1 for a left-to-right wipe.

**Audio is opt-in.** The agent adds `audio` tracks only when you ask for
sound ("with background music from music.mp3", "with a voiceover reading
it"); a prompt that says nothing about sound renders silent, as before.
A track is a local file next to `motion.json` (mp3, wav, m4a, aac, ogg or
flac) with `at` (seconds), or `scene` plus `at` so the clip moves with its
scene, and optional `duration`, `volume`, `fadeIn` and `fadeOut`. ffmpeg
mixes the tracks into the MP4 as AAC stereo; the preview plays them in sync
(approximately; `M` mutes) and the MP4 timing is exact. Music is always a
file you supply. For narration the agent runs
`voice.mjs "<text>" --out voice/<scene>.wav` (Kokoro, local, 28 voices,
`--voice af_heart` by default) after asking once to install `kokoro-js`
(about 250 MB plus a 90 MB model downloaded a single time).

## 5. Asking for changes

All three skills edit **a few fields of the spec**, so everything else stays the
same:

| Ask | What changes |
|---|---|
| "Make the region chart a line chart" | `charts[0].kind` |
| "Add a KPI for total units" | one new entry in `kpis` (+ one query) |
| "Slow scene 2 down" | `scenes[1].duration` (+ that scene's keyframe times) |
| "Change the counter to 25" | `elements[n].to` |
| "Add a cache between the API and the DB" | one node and two edges in `diagram.json` |
| "Rename Orders DB to Ledger" | `nodes[n].label` |

Never hand-edit `dist/`, the diagram HTML or the MP4. Change the spec and rebuild.

## 6. Hosts that can't run commands

If an agent can write files but can't run shell commands, it still writes and
explains the spec, then prints the exact `validate`, `build` / `render` and
`serve` / `preview` commands for you to run.

## 7. Troubleshooting

| Symptom | Fix |
|---|---|
| `Cannot find package 'ajv'` (or duckdb, playwright) | Run `npm ci` inside the skill folder (`npm ci --omit=dev` for make-dashboard and make-diagram) |
| `node` exits with code 139 / `SecItemCopyMatching failed -50` when an agent runs the scripts inside the Codex sandbox | `NODE_USE_SYSTEM_CA` is set (often via `launchctl setenv`); unset it for that session (`env -u NODE_USE_SYSTEM_CA codex …`) — Node 24 reads the keychain at startup and the sandbox denies it |
| `run: node …/scripts/setup.mjs` | A sqlite, postgres or mysql source needs its DuckDB extension. Run that command once, online |
| `sources.x.path: resolves outside the spec folder` | Move the data under the spec's folder, or add `--allow-outside` yourself |
| `queries.q: …` with a DuckDB message | The SQL doesn't bind (wrong table or column). Run `inspect.mjs` on the file and compare |
| `environment variable WAREHOUSE_URL is not set` | Export it in the shell (and in the cron/launchd environment) |
| Query stopped after 30 s | Make it cheaper, or pass `--timeout 120` to `build` |
| `nodes[0].kind: kind "databse" is not valid for architecture diagrams; did you mean "database"?` (and similar `path: message` lines from make-diagram) | The path is the field to fix and the message names the fix. The agent edits that field and reruns `validate` |
| `text is … px wide; the box fits … px — shorten the label` or `node "b" overlaps node "a"` | make-diagram's geometry lint: shorten the label or note, or split the diagram |
| `check: skipped (no browser: …)` from make-diagram | Expected without Playwright or Chromium; the page is still built. To run the check: `npm ci` then `npx playwright install chromium` inside the skill folder |
| `npx playwright install chromium` hint on render | Install Chromium once inside the skill folder (Linux: `npx playwright install --with-deps chromium`), or install Google Chrome for the fallback |
| `kokoro-js is not installed` | `npm install kokoro-js@1.2.1 --no-save --prefix <skill-dir>` (voiceover only; `npm ci` removes it) |
| `audio[0].src: ffmpeg cannot decode …` | The file is not a valid audio file. Re-export it as mp3 or wav |
| `ffmpeg not found` | macOS `brew install ffmpeg`, Windows `winget install Gyan.FFmpeg` (then a new terminal), Linux `sudo apt-get install ffmpeg`, or set `FFMPEG_PATH` |
| `remote data is not allowed` / `not allowed — external URLs are never fetched` | Charts must carry their data inline (motion) or come from a SQL query (dashboard) |
| A final counter value or keyframe never shows | Frame *i* samples `t = i/fps`. End keyframes at least one frame before the scene ends |

## 8. Checking a new host or model

`eval/run-eval.mjs` runs a fixed set of prompts through a host and scores the
results:

```bash
node plugins/portable-artifacts/eval/run-eval.mjs --skill dashboard --host codex-oss --model gemma4
node plugins/portable-artifacts/eval/run-eval.mjs --skill diagram --host claude --limit 3
```

It records: spec written, valid, validate retries, build or contact sheet ok,
and which fields changed on edit prompts. See [`eval/README.md`](eval/README.md).
