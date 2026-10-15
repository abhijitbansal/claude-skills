# portable-artifacts usage guide

Walkthroughs for the four skills on every supported host. To find out what the
plugin is, read the [README](README.md). For every spec field, see each skill's
`references/schema.md`.

- [1. Install](#1-install)
- [2. Dashboards with make-dashboard](#2-dashboards-with-make-dashboard)
- [3. Diagrams with make-diagram](#3-diagrams-with-make-diagram)
- [4. Explainers with make-explainer](#4-explainers-with-make-explainer)
- [5. Videos with make-motion](#5-videos-with-make-motion)
- [6. Asking for changes](#6-asking-for-changes)
- [7. Hosts that can't run commands](#7-hosts-that-cant-run-commands)
- [8. Troubleshooting](#8-troubleshooting)
- [9. Checking a new host or model](#9-checking-a-new-host-or-model)

## 1. Install

| You use | Do this | Then call |
|---|---|---|
| Claude Code | `/plugin marketplace add abhijitbansal/claude-skills` then `/plugin install portable-artifacts@claude-skills` | `/make-dashboard …`, `/make-diagram …`, `/make-explainer …`, `/make-motion …`, or just ask |
| Codex CLI | `node <repo>/plugins/portable-artifacts/bin/install.mjs codex` | `$make-dashboard …`, `$make-diagram …`, `$make-explainer …`, `$make-motion …` (or pick from `/skills`) |
| GitHub Copilot CLI / VS Code | `node <repo>/plugins/portable-artifacts/bin/install.mjs copilot` (add `--project .` for `.github/skills`) | `/make-dashboard …`, `/make-diagram …`, `/make-explainer …`, `/make-motion …` |
| Gemini CLI | `node <repo>/plugins/portable-artifacts/bin/install.mjs gemini` | `/make-dashboard …` (a TOML command that activates the skill) |
| Any agent `npx skills` supports | `npx skills add abhijitbansal/claude-skills --skill make-dashboard make-diagram make-explainer make-motion` (pick agents interactively, or pass `-a claude-code codex github-copilot -y`). It does not resolve dependencies: to get just the explainer, name its two required skills too, `--skill make-explainer make-diagram make-dashboard` | That agent's skill invocation |
| Any other agent | Copy `skills/make-dashboard`, `skills/make-diagram`, `skills/make-explainer` and/or `skills/make-motion` into your project (**make-explainer needs make-diagram and make-dashboard beside it**) **with each skill's `shared/` folder**, run `npm ci` in each (`npm ci --omit=dev` for make-dashboard, make-diagram and make-explainer), and point `AGENTS.md` at their `SKILL.md` | Ask for a dashboard, a diagram, an explainer or a video |

`<repo>` is a clone of `https://github.com/abhijitbansal/claude-skills`. The
installer runs `npm ci` for you. Pass `--link` to symlink to the clone (then
`git pull` updates the skills), `--skills make-motion` to install just one, or
`--force` to replace an existing install. A skill's required skills come with it:
`--skills make-explainer` also installs make-diagram and make-dashboard (the
`portableArtifacts.requires` list in its `package.json`). make-motion is
optional for the explainer and is only installed if you name it.

The repo-wide `adapters/install.sh codex|copilot` symlinks *every* skill in
this repo, these four included. Only `install.mjs` also runs `npm ci`, supports
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
   console errors, text that leaves its box and a node under the legend
   overlay. It needs Playwright and a browser (a full `npm ci` plus
   `npx playwright install chromium` in the skill folder). Without them it
   prints `check: skipped` and exits 0. Building needs no browser.
6. Tells you the path, what the diagram shows, and that Play story (or `P`)
   opens beat 1, Space plays it, `E` explores and `F` is full screen.

**In the page:** wheel or pinch to zoom, drag to pan, `0` or double-click to
fit, `F` for full screen, `A` toggles edge-flow animation, and the toolbar
exports SVG or PNG and switches between auto, light and dark. **Play story**
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

1. For a branch, `gather.mjs git > facts.json` reads the committed
   work: commits, files changed with line counts and renames, test files and
   the date. `--repo <folder>` reads another checkout; `--base` defaults to
   `main`, then `master`, preferring origin's copy when it is ahead.
2. `scaffold.mjs recap --facts facts.json > explainer.json` writes a starter
   file (also `checklist`, `concept` and `slides`). `concept` and `slides` take no facts. Without `--facts`, `recap` is a shorter skeleton (tl;dr, how it works, risks: no numbers, files or timeline) and `checklist` has one TODO area group plus the regression group.
   The numbers, file list, timeline and checklist groups are filled in; every
   sentence is a `TODO: …` string. With no preset, the agent writes the file
   from the section list.
3. The agent reads the changed files and replaces each `TODO:` with prose.
   Section titles state the finding ("Search now ignores case"), not a label.
4. `validate.mjs explainer.json` checks the schema and limits, file references,
   the embedded diagrams and charts, and the prose rules. It fails on leftover
   `TODO:` text, emoji, filler phrases ("leverage", "seamless", "delve"), titles
   numbered like `01` or ending in `!`, and (for slides) a slide with more
   than 6 points, 8 table rows, 12 code lines or 80 words. Each line is a JSON
   path, the problem and the fix; text over the soft caps (title 8 words, paragraph 60 words, text section 120, page 900) only warns.
5. `build.mjs explainer.json` writes one HTML file and prints its path. The
   default folder is `~/.agent/diagrams/` (set `PA_OUTPUT_DIR`, or pass
   `--out file.html` or `--out dir`). `--theme paper|blueprint|ink|editorial`
   overrides the spec's theme. A video or an interactive chart adds a
   `<name>.assets/` folder beside the page: keep them together.
6. Optionally runs `check.mjs <page>`, which opens the page at 1280 and 390 px and
   fails on console errors or warnings, sideways scrolling, a deck that cannot
   reach its last slide with the arrow keys, or a diagram Present overlay that
   will not close on Esc. It needs Playwright and a browser (a full `npm ci` plus
   `npx playwright install chromium` in the skill folder); without them it prints
   `check: skipped` and exits 0.
7. Tells you the path and what the page shows.

**Presets:** `recap` (tl;dr, numbers, how it works, files changed, timeline,
risks), `checklist` (a group per area of changed files, a regression group, an
intro and "If something fails"), `concept` (tl;dr, explanation, cards, steps),
`slides` (a deck). **Sections** (18): `tldr`, `text`, `kpis`, `cards`,
`table`, `risks`, `files`, `steps`, `timeline`, `compare`, `callout`, `code`,
`details`, `checklist`, `diagram`, `chart`, `motion`, `image`.

**Embedding other skills:**

- `diagram`: an inline make-diagram spec, or the path to a `*.diagram.json` in
  the same folder. It gets hover tracing and a Present button. The page's
  theme wins over a theme in the diagram (a warning says so).
- `chart`: either rows written inline (up to 500) with a `kind`, `x` and `y`,
  or a make-dashboard `dashboard.json` plus a chart id. The page draws a
  static SVG, light and dark, with a data table. `interactive: true` also
  builds the dashboard next to the page and links it. Local files only: a
  dashboard with a Postgres or MySQL source is refused.
- `motion`: an `.mp4` (up to 50 MB), or a make-motion `motion.json` rendered
  during the build (needs make-motion, ffmpeg and Chromium; set
  `PA_MOTION_TIMEOUT_MS` for a long render). The video never autoplays.
- These need `make-diagram` and `make-dashboard` installed beside
  `make-explainer` (the installer adds them; see the install table).

**In the page:** a contents list from four sections up, copy buttons on code,
a Theme toggle, print styles. **Checklists** save their ticks in your browser
(per `key`), show a progress bar and per-group counts, and Reset asks before it
clears. A tick follows its item if the list is reordered; editing an item's
text clears that item. The `intro` ("What's in this branch") lists every
feature and every fix from review, so a tester needs no PR. **Slides** use the
arrow keys, Space, Page Up and Page Down, Home and End; `O` opens an outline,
`#slide-3` opens slide 3, the last slide is remembered, and printing gives one
slide per page.

**Reference:** every field is in `make-explainer/references/schema.md` and
`sections.md`, the banned phrases in `style.md`, and one working file per
preset in `references/examples/`.

## 5. Videos with make-motion

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

## 6. Asking for changes

All four skills edit **a few fields of the spec**, so everything else stays the
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

Never hand-edit `dist/`, the diagram or explainer HTML, or the MP4. Change the spec and rebuild.

## 7. Hosts that can't run commands

If an agent can write files but can't run shell commands, it still writes and
explains the spec, then prints the exact `validate`, `build` / `render` and
`serve` / `preview` commands for you to run.

## 8. Troubleshooting

| Symptom | Fix |
|---|---|
| `Cannot find package 'ajv'` (or duckdb, playwright) | Run `npm ci` inside the skill folder (`npm ci --omit=dev` for make-dashboard, make-diagram and make-explainer) |
| `node` exits with code 139 / `SecItemCopyMatching failed -50` when an agent runs the scripts inside the Codex sandbox | `NODE_USE_SYSTEM_CA` is set (often via `launchctl setenv`); unset it for that session (`env -u NODE_USE_SYSTEM_CA codex …`) — Node 24 reads the keychain at startup and the sandbox denies it |
| `run: node …/scripts/setup.mjs` | A sqlite, postgres or mysql source needs its DuckDB extension. Run that command once, online |
| `sources.x.path: resolves outside the spec folder` | Move the data under the spec's folder, or add `--allow-outside` yourself |
| `queries.q: …` with a DuckDB message | The SQL doesn't bind (wrong table or column). Run `inspect.mjs` on the file and compare |
| `environment variable WAREHOUSE_URL is not set` | Export it in the shell (and in the cron/launchd environment) |
| Query stopped after 30 s | Make it cheaper, or pass `--timeout 120` to `build` |
| `nodes[0].kind: kind "databse" is not valid for architecture diagrams; did you mean "database"?` (and similar `path: message` lines from make-diagram) | The path is the field to fix and the message names the fix. The agent edits that field and reruns `validate` |
| `text is … px wide; the box fits … px — shorten the label` or `node "b" overlaps node "a"` | make-diagram's geometry lint: shorten the label or note, or split the diagram |
| `sections[3].text: still has a TODO placeholder` | A scaffold sentence was left in. Replace every `TODO: …` with real prose, or delete the section |
| `banned phrase "leverage"; replace it with "use"` (or `contains emoji`, `heading ends with "!"`) | Reword as the message says. The full list is `make-explainer/references/style.md` |
| `slide has 7 points; the limit is 6 — split this section into two slides` | In a deck each section is one slide: at most 6 points, 8 table rows, 12 code lines and 80 words. Split it |
| `make-diagram skill not found next to make-explainer (looked in …); install it with: npx skills add …` (or make-dashboard, make-motion) | The embedded diagram, chart, icon or motion spec needs that sibling skill in the folder next to `make-explainer`. Run the printed command, or `node plugins/portable-artifacts/bin/install.mjs <host> --skills make-explainer` |
| `… is installed but its dependencies are missing` | Run `npm ci --omit=dev` inside the named sibling skill's folder |
| `dashboard: source "x" is postgres, a network source; explainer charts read local files only` | A build never uses the network. Export the query to CSV or Parquet and point a file source at it |
| `gather.mjs` prints `… is not a git repository` or `base "x" does not exist` (with the branches that do) | Pass `--repo <folder inside the repository>` and a real `--base <branch>` |
| `make-motion cannot render this spec: it needs ffmpeg and a Chromium browser` | Install both (see the README requirements), or render the clip first and use `video` with the `.mp4` |
| `check: skipped (no browser: …)` from make-diagram or make-explainer | Expected without Playwright or Chromium; the page is still built. To run the check: `npm ci` then `npx playwright install chromium` inside the skill folder |
| `npx playwright install chromium` hint on render | Install Chromium once inside the skill folder (Linux: `npx playwright install --with-deps chromium`), or install Google Chrome for the fallback |
| `kokoro-js is not installed` | `npm install kokoro-js@1.2.1 --no-save --prefix <skill-dir>` (voiceover only; `npm ci` removes it) |
| `audio[0].src: ffmpeg cannot decode …` | The file is not a valid audio file. Re-export it as mp3 or wav |
| `ffmpeg not found` | macOS `brew install ffmpeg`, Windows `winget install Gyan.FFmpeg` (then a new terminal), Linux `sudo apt-get install ffmpeg`, or set `FFMPEG_PATH` |
| `remote data is not allowed` / `not allowed — external URLs are never fetched` | Charts must carry their data inline (motion) or come from a SQL query (dashboard) |
| A final counter value or keyframe never shows | Frame *i* samples `t = i/fps`. End keyframes at least one frame before the scene ends |

## 9. Checking a new host or model

`eval/run-eval.mjs` runs a fixed set of prompts through a host and scores the
results:

```bash
node plugins/portable-artifacts/eval/run-eval.mjs --skill dashboard --host codex-oss --model gemma4
node plugins/portable-artifacts/eval/run-eval.mjs --skill diagram --host claude --limit 3
node plugins/portable-artifacts/eval/run-eval.mjs --skill explainer --host claude --only recap-from-repo,edit-existing
```

It records: spec written, valid, validate retries, build or contact sheet ok,
and which fields changed on edit prompts. See [`eval/README.md`](eval/README.md).
