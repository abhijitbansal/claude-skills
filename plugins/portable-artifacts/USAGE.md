# portable-artifacts usage guide

Walkthroughs for both skills on every supported host. To find out what the
plugin is, read the [README](README.md). For every spec field, see each skill's
`references/schema.md`.

- [1. Install](#1-install)
- [2. Dashboards with make-dashboard](#2-dashboards-with-make-dashboard)
- [3. Videos with make-motion](#3-videos-with-make-motion)
- [4. Asking for changes](#4-asking-for-changes)
- [5. Hosts that can't run commands](#5-hosts-that-cant-run-commands)
- [6. Troubleshooting](#6-troubleshooting)
- [7. Checking a new host or model](#7-checking-a-new-host-or-model)

## 1. Install

| You use | Do this | Then call |
|---|---|---|
| Claude Code | `/plugin marketplace add abhijitbansal/claude-skills` then `/plugin install portable-artifacts@claude-skills` | `/make-dashboard …`, `/make-motion …`, or just ask |
| Codex CLI | `node <repo>/plugins/portable-artifacts/bin/install.mjs codex` | `$make-dashboard …`, `$make-motion …` (or pick from `/skills`) |
| GitHub Copilot CLI / VS Code | `node <repo>/plugins/portable-artifacts/bin/install.mjs copilot` (add `--project .` for `.github/skills`) | `/make-dashboard …`, `/make-motion …` |
| Gemini CLI | `node <repo>/plugins/portable-artifacts/bin/install.mjs gemini` | `/make-dashboard …` (a TOML command that activates the skill) |
| Any agent `npx skills` supports | `npx skills add abhijitbansal/claude-skills --skill make-dashboard make-motion` (pick agents interactively, or pass `-a claude-code codex github-copilot -y`) | That agent's skill invocation |
| Any other agent | Copy `skills/make-dashboard` and/or `skills/make-motion` into your project, run `npm ci` in each, and point `AGENTS.md` at their `SKILL.md` | Ask for a dashboard or a video |

`<repo>` is a clone of `https://github.com/abhijitbansal/claude-skills`. The
installer runs `npm ci` for you. Pass `--link` to symlink to the clone (then
`git pull` updates the skills), `--skills make-motion` to install just one, or
`--force` to replace an existing install.

The repo-wide `adapters/install.sh codex|copilot` symlinks *every* skill in
this repo, these two included. Only `install.mjs` also runs `npm ci`, supports
project scope and writes the Gemini commands.

For **make-motion**, also run the one-time `npx playwright install chromium`
inside the skill folder (about 150 MB), and make sure `ffmpeg` is on your
`PATH`. Agents ask before downloading Chromium.

Install make-motion's tools per OS (run the Chromium download inside the
make-motion skill folder, so it matches the Playwright version `npm ci` installed):

| | macOS (Homebrew) | Windows (PowerShell) | Linux (Debian/Ubuntu) |
|---|---|---|---|
| Node.js ≥ 20 | `brew install node` | `winget install OpenJS.NodeJS.LTS` | nodejs.org or a version manager (distro packages are often older) |
| ffmpeg | `brew install ffmpeg` | `winget install Gyan.FFmpeg` (or `choco install ffmpeg` / `scoop install ffmpeg`) | `sudo apt-get install ffmpeg` |
| Chromium | `npx playwright install chromium` | `npx playwright install chromium` | `npx playwright install --with-deps chromium` (adds the system libraries; asks for sudo) |

On Windows, open a new terminal after `winget` so `node` and `ffmpeg` are on `PATH`.

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

**Open the result:** double-click `dist/index.html` (it is one
self-contained file), or run the printed `serve:` command. Every chart card
has a *Query* disclosure with the SQL, the row count, the refresh time and
the first rows of the result.

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

## 3. Videos with make-motion

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

## 4. Asking for changes

Both skills edit **one field of the spec**, so everything else stays the
same:

| Ask | What changes |
|---|---|
| "Make the region chart a line chart" | `charts[0].vegaLite.mark` |
| "Add a KPI for total units" | one new entry in `kpis` (+ one query) |
| "Slow scene 2 down" | `scenes[1].duration` (+ that scene's keyframe times) |
| "Change the counter to 25" | `elements[n].to` |

Never hand-edit `dist/` or the MP4. Change the spec and rebuild.

## 5. Hosts that can't run commands

If an agent can write files but can't run shell commands, it still writes and
explains the spec, then prints the exact `validate`, `build` / `render` and
`serve` / `preview` commands for you to run.

## 6. Troubleshooting

| Symptom | Fix |
|---|---|
| `Cannot find package 'ajv'` (or duckdb, playwright) | Run `npm ci` inside the skill folder |
| `run: node …/scripts/setup.mjs` | A sqlite, postgres or mysql source needs its DuckDB extension. Run that command once, online |
| `sources.x.path: resolves outside the spec folder` | Move the data under the spec's folder, or add `--allow-outside` yourself |
| `queries.q: …` with a DuckDB message | The SQL doesn't bind (wrong table or column). Run `inspect.mjs` on the file and compare |
| `environment variable WAREHOUSE_URL is not set` | Export it in the shell (and in the cron/launchd environment) |
| Query stopped after 30 s | Make it cheaper, or pass `--timeout 120` to `build` |
| `npx playwright install chromium` hint on render | Install Chromium once inside the skill folder (Linux: `npx playwright install --with-deps chromium`), or install Google Chrome for the fallback |
| `kokoro-js is not installed` | `npm install kokoro-js@1.2.1 --no-save --prefix <skill-dir>` (voiceover only; `npm ci` removes it) |
| `audio[0].src: ffmpeg cannot decode …` | The file is not a valid audio file. Re-export it as mp3 or wav |
| `ffmpeg not found` | macOS `brew install ffmpeg`, Windows `winget install Gyan.FFmpeg` (then a new terminal), Linux `sudo apt-get install ffmpeg`, or set `FFMPEG_PATH` |
| `remote data is not allowed` / `not allowed — external URLs are never fetched` | Charts must carry their data inline (motion) or come from a SQL query (dashboard) |
| A final counter value or keyframe never shows | Frame *i* samples `t = i/fps`. End keyframes at least one frame before the scene ends |

## 7. Checking a new host or model

`eval/run-eval.mjs` runs a fixed set of prompts through a host and scores the
results:

```bash
node plugins/portable-artifacts/eval/run-eval.mjs --skill dashboard --host codex-oss --model gemma4
```

It records: spec written, valid, validate retries, build or contact sheet ok,
and which fields changed on edit prompts. See [`eval/README.md`](eval/README.md).
