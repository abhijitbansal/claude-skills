# portable-artifacts usage guide

Walkthroughs for the four skills on every supported host. To find out what the
plugin is, read the [README](README.md). For every spec field, see each skill's
`references/schema.md`.

- [1. Install](#1-install)
- [2. Dashboards with make-dashboard](#2-dashboards-with-make-dashboard)
- [3. Diagrams with make-diagram](#3-diagrams-with-make-diagram)
- [4. Explainers with make-explainer](#4-explainers-with-make-explainer)
- [5. Videos with make-motion](#5-videos-with-make-motion)
- [6. What every page carries](#6-what-every-page-carries)
- [7. Asking for changes](#7-asking-for-changes)
- [8. Hosts that can't run commands](#8-hosts-that-cant-run-commands)
- [9. Troubleshooting](#9-troubleshooting)
- [10. Checking a new host or model](#10-checking-a-new-host-or-model)

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

### Before the first build: doctor

Every skill has a `scripts/doctor.mjs` that checks what the skill needs and
prints the fix for each thing that is missing. It needs only Node, so it runs
before `npm ci` and reports a missing `node_modules` instead of crashing. It
never prompts and never installs anything on its own.

```bash
node <skill-dir>/scripts/doctor.mjs --json                  # what is missing, with the fix for your OS
node <skill-dir>/scripts/doctor.mjs --json --for spec.json  # make-explainer: also the sister skills the spec needs
node <skill-dir>/scripts/doctor.mjs --json --for check      # make-diagram, make-explainer: Playwright and a browser
node <skill-dir>/scripts/doctor.mjs --json --for voiceover  # make-motion: kokoro-js, before a voiceover
node <skill-dir>/scripts/doctor.mjs --fix node_modules      # install the named ids (comma-separated)
```

The consent flow in each SKILL.md: the agent runs the doctor first. If anything
is missing it sends you one message with each item, why it is needed, its size
and the command, and asks once. On yes it runs `--fix <ids>`. Anything that
needs `sudo`, has no automatic fix or fails (for example a sandbox without
network) comes back to you as the exact command to run yourself; in Claude Code
prefix it with `!`. On no the agent does what it can without the item, for
example make-motion still writes and validates `motion.json` and hands you the
render commands. `--for` takes a spec `.json` in every skill (only make-explainer
adds sister skills from it), `check` in make-diagram and make-explainer, and
`voiceover` in make-motion; make-dashboard has no keyword target. Unknown or
misspelled arguments exit 2 and list the accepted ones. `--fix` takes the same
`--for` the diagnosis used: it resolves ids against that target, so an id the
target does not list (say `chromium` with a spec that has no check step) is
refused as "unknown id". Without `--for` it accepts every id the skill could
need, sister skills included. `dev_deps` (Playwright) and `chromium` (the browser
`check.mjs` uses) are required under `--for check`; plain diagnosis needs
neither. make-explainer names the browser that renders its motion section
`motion_chromium`: it installs through make-motion's Playwright, apart from its
own `chromium`. `--fix` exits 1 when any requested id is refused, skipped,
failed, still missing afterwards or installed elsewhere, optional ids included.
On Windows the text output labels command lines `(cmd.exe)`.

### Tested hosts

Tested live on this branch: **Claude Code**, and **GitHub Copilot CLI 1.0.98**
(one non-interactive run per skill on 2026-10-15, plus reruns of the doctor
install path: each run picked up its skill, ran the doctor, set the host name,
validated and built a page). The browser check (`check.mjs`) was never run by an
agent there, and consent was pre-granted in the prompt, so the ask-first step was
not exercised. An earlier live eval on 2026-10-10 ran **Codex CLI 0.145.0**:
dashboard 10/10, motion 6/10, with the last four motion prompts stopped by the
account's usage limit ([`summary-full-2026-10-10.md`](eval/results/summary-full-2026-10-10.md)).
**Gemini CLI**: its install paths were checked against its documentation on
2026-10-15 and not run live. Results:
[`eval/results/summary-portability-copilot-2026-10-15.md`](eval/results/summary-portability-copilot-2026-10-15.md)
and [`eval/results/summary-install-targets-2026-10-15.md`](eval/results/summary-install-targets-2026-10-15.md).

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
- **Themes:** `paper` (default), `blueprint`, `editorial`, `ink`, and the newer `dusk`, `press` and `poster` (see the [README](README.md#themes-and-art)). Ask for one, or pass `--theme <name>` to `build.mjs`. The page also has an icon toggle that cycles Auto, Light and Dark.
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
   `--out file.html` or `--out dir`). `--theme <name>` overrides the spec's
   theme: `blueprint` (default), `paper`, `ink`, `editorial`, `dusk`, `press`
   or `poster`.
5. `check.mjs <page>` opens the page at 1440 and 390 px and reports overflow,
   console errors, text that leaves its box and a node under the legend
   overlay. It needs Playwright and a browser (a full `npm ci` plus
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
   from the section list.
3. The agent reads the changed files and replaces each `TODO:` with prose.
   Section titles state the finding ("Search now ignores case"), not a label.
4. `validate.mjs explainer.json` checks the schema and limits, file references,
   the embedded diagrams and charts, and the prose rules. It fails on leftover
   `TODO:` text, filler phrases ("leverage", "seamless", "delve"), titles
   numbered like `01` or ending in `!`, and (for slides) a slide with more
   than 6 points, 8 table rows, 12 code lines or 80 words. Each line is a JSON
   path, the problem and the fix; text over the soft caps only warns (exit 0): title 8 words, label 4 words, paragraph 3 sentences or 60 words, text section 120 words, card text 30 words, list item 20 words, page prose 900 words, `tldr` 3 points. Emoji are allowed; dense emoji only warn: a prose string with 3 or more at more than 1 per 40 characters, or a section title with more than 3. Each warning names the section; resolve them before building where you can.
5. `build.mjs explainer.json` writes one HTML file and prints its path. The
   default folder is `~/.agent/diagrams/` (set `PA_OUTPUT_DIR`, or pass
   `--out file.html` or `--out dir`). `--theme <name>` overrides the spec's
   theme: `dusk` (default), `press`, `poster`, `paper`, `blueprint`, `ink` or
   `editorial` (see [Choosing a theme](#choosing-a-theme)); `--model`, `--effort` and `--agent` set the
   provenance stamp (see [section 6](#6-what-every-page-carries)). A video or an interactive chart adds a
   `<name>.assets/` folder beside the page: keep them together.
   `--image-api <https-endpoint>` is an optional extra described
   [below](#optional-hero-image); without it the build never uses the network.
6. Optionally runs `check.mjs <page>`, which opens the page at 1280 and 390 px and
   fails on console errors or warnings, sideways scrolling, a deck that cannot
   reach its last slide with the arrow keys, or a diagram Present overlay that
   will not close on Esc. It needs Playwright and a browser (a full `npm ci` plus
   `npx playwright install chromium` in the skill folder); without them it prints
   `check: skipped` with the doctor command to run
   (`doctor.mjs --for check --fix dev_deps` or `--fix chromium`) and exits 0.
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

make-explainer and make-motion share these rules:

1. A theme you name wins: `--theme poster`, or "use poster" in the prompt.
2. Otherwise the agent picks one from the prompt and says which and why in one
   line: `press` for dense docs, long reads, changelogs and branch recaps;
   `poster` for launch decks, pitches, demos and energetic clips; `dusk` for
   everything else, or when it is unclear.
3. If the prompt fits two themes equally, the agent asks once and lists the
   three with a one-line feel each (`dusk` soft and warm, `press` calm print,
   `poster` loud and condensed). If it cannot ask, it uses `dusk`.

`paper`, `blueprint`, `ink` and `editorial` still work, but only when you name
them. In `dusk`, `press` and `poster` the page hero and a deck's title and
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
- **Page hero only**, and only in `dusk`, `press` or `poster`. A deck or an
  older theme is refused (exit 2) before anything is sent.

Any failure stops the build with exit 2; there is no silent fallback. The
picture is inlined, so the page stays one offline file. The request and reply
format is in `make-explainer/references/schema.md` ("Hero image from an image
API").

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

**Theme.** The agent picks it as in [Choosing a theme](#choosing-a-theme) and
writes it as the spec's `theme`. A spec without one renders in `dusk`. The
theme's dark colours and fonts are the defaults; any colour the spec sets
itself still wins. `render.mjs --theme <name>` fills in only for a spec that
names none. A `text` with `"role": "title"` uses the theme's display font and,
with no keyframes of its own, gets the theme's entrance (`dusk` rises, `press`
inks in, `poster` slams). A scene with `"background": "art"` draws the theme's
procedural art behind its elements, seeded by the scene id.
`references/examples/launch-title.json` uses both.

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

## 6. What every page carries

**Favicon.** Each page has an inline SVG favicon in its theme accent: three bars
for a dashboard, three linked nodes for a diagram, a page with lines for an
explainer, a play triangle for the make-motion preview. Nothing is fetched.

**Theme toggle.** A sun, moon or auto icon button cycles Auto, then Light, then
Dark, and remembers the choice in your browser. It still cycles when the browser
blocks storage. The make-motion preview has none: it is a dark-only local tool,
and the video follows the spec's theme.

**Who made it.** Set `generatedBy` in the spec to the model, effort and host that
wrote it, or override per field at build time with flags:

```json
"generatedBy": { "model": "Claude Opus 5.5", "effort": "high", "agent": "Claude Code" }
```

```bash
node <skill-dir>/scripts/build.mjs spec.json --model "Claude Opus 5.5" --effort high --agent "Claude Code"
node <skill-dir>/scripts/render.mjs motion.json --model "Claude Opus 5.5" --effort high --agent "Claude Code"   # make-motion
```

make-motion's `preview.mjs` takes no provenance flags: the preview footer comes
from the spec's `generatedBy`, and `render.mjs` takes the flags for the MP4.

Each field is 1 to 60 characters from `A-Za-z0-9 ._:/()+-`; anything else fails
validation (exit 1) and never reaches the page. A field the agent does not know is
left out, and the page reads "not reported": nothing is guessed. The stamp shows as
a footer line (make-diagram: a line under the title), for example
`make-explainer · Claude Haiku · low effort · Claude Code · 15 Oct 2026`, and as
`<meta name="generator">`. The make-motion preview shows it in its footer and the same meta tag, and the
MP4 gets it in the `comment` tag (and the model in `artist` when it is reported). When `generatedBy`
is set in the spec, a dashboard refresh keeps the original author; a stamp passed
only as flags is not kept by a refresh run without them. A dashboard also shows its
refresh time. Set `SOURCE_DATE_EPOCH` to pin the footer date for a reproducible build.

**Type.** The theme sets the fonts, all bundled, so nothing is fetched: `dusk`
Funnel Display, Host Grotesk and Commit Mono; `press` Young Serif, Schibsted
Grotesk and JetBrains Mono; `poster` Big Shoulders Display, Familjen Grotesk
and Martian Mono; `paper` and `blueprint` Geist and Geist Mono; `ink` Bricolage
Grotesque headings over Geist; `editorial` Newsreader headings and an Atkinson
Hyperlegible body. The make-motion preview and video use the spec's theme
(`dusk` when it names none). Links in running text are underlined; buttons,
navigation and cards are not.

## 7. Asking for changes

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

## 8. Hosts that can't run commands

If an agent can write files but can't run shell commands, it still writes and
explains the spec, then prints the exact `validate`, `build` / `render` and
`serve` / `preview` commands for you to run.

## 9. Troubleshooting

| Symptom | Fix |
|---|---|
| `Cannot find package 'ajv'` (or duckdb, playwright) | Run `node <skill-dir>/scripts/doctor.mjs --json`, or `npm ci` inside the skill folder (`npm ci --omit=dev` for make-dashboard, make-diagram and make-explainer) |
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
| `make-diagram skill not found next to make-explainer (looked in …); install it with: npx --yes skills@1.7.2 add … -y` (or make-dashboard, make-motion) | The embedded diagram, chart, icon or motion spec needs that sibling skill in the folder next to `make-explainer`. Run the printed command, or `node plugins/portable-artifacts/bin/install.mjs <host> --skills make-explainer` |
| `… is installed but its dependencies are missing` | Run `npm ci --omit=dev` inside the named sibling skill's folder |
| `dashboard: source "x" is postgres, a network source; explainer charts read local files only` | A build never uses the network. Export the query to CSV or Parquet and point a file source at it |
| `gather.mjs` prints `… is not a git repository` or `base "x" does not exist` (with the branches that do) | Pass `--repo <folder inside the repository>` and a real `--base <branch>` |
| `make-motion cannot render this spec: it needs ffmpeg and a Chromium browser` | Install both (see the README requirements), or render the clip first and use `video` with the `.mp4` |
| `check: skipped (no browser: …)` from make-diagram or make-explainer | Expected without Playwright or Chromium; the page is still built. To run the check, use the command the skip line prints (`doctor.mjs --for check --fix dev_deps` or `--fix chromium`), or `npm ci` then `npx playwright install chromium` inside the skill folder |
| `npx playwright install chromium` hint on render | Install Chromium once inside the skill folder (Linux: `npx playwright install --with-deps chromium`), or install Google Chrome for the fallback |
| `kokoro-js is not installed` | `npm install kokoro-js@1.2.1 --no-save --prefix <skill-dir>` (voiceover only; `npm ci` removes it) |
| `audio[0].src: ffmpeg cannot decode …` | The file is not a valid audio file. Re-export it as mp3 or wav |
| `ffmpeg not found` | macOS `brew install ffmpeg`, Windows `winget install Gyan.FFmpeg` (then a new terminal), Linux `sudo apt-get install ffmpeg`, or set `FFMPEG_PATH` |
| `remote data is not allowed` / `not allowed — external URLs are never fetched` | Charts must carry their data inline (motion) or come from a SQL query (dashboard) |
| A final counter value or keyframe never shows | Frame *i* samples `t = i/fps`. End keyframes at least one frame before the scene ends |

## 10. Checking a new host or model

`eval/run-eval.mjs` runs a fixed set of prompts through a host and scores the
results:

```bash
node plugins/portable-artifacts/eval/run-eval.mjs --skill dashboard --host codex-oss --model gemma4
node plugins/portable-artifacts/eval/run-eval.mjs --skill diagram --host claude --limit 3
node plugins/portable-artifacts/eval/run-eval.mjs --skill explainer --host claude --only recap-from-repo,edit-existing
```

It records: spec written, valid, validate retries, build or contact sheet ok,
and which fields changed on edit prompts. See [`eval/README.md`](eval/README.md).
