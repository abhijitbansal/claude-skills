# make-explainer

**Prompt → JSON outline → one offline HTML page or slide deck.** A branch
recap, a diff review, a concept or plan explainer, an interactive test
checklist or a presentation. The agent fills a small JSON document of typed
sections; local scripts validate it, lint the prose and render it. Works with
any agent that can run shell commands. Nothing leaves your machine
unless you opt in with `--image-api` (see below).

- **One spec, `explainer.json`**: a title and 1 to 40 sections of 24 types.
  The agent never writes HTML, CSS, SVG or script; the spec accepts none of
  them, and text fields take only a small markdown subset.
- **Facts come from scripts**: `gather.mjs git` reads a branch (commits, files
  changed with line counts and renames, test files) and `scaffold.mjs` turns
  that into a starter file with the numbers, files and timeline filled in. The
  agent replaces each `TODO:` with prose, and validation fails until it has.
- **Checked before you see it**: schema and limits, file references (inside
  the spec folder, no symlinks), embedded diagrams and charts through their own
  skills' validators, and a prose lint that rejects filler such as
  "seamless" or "leverage", numbered titles and placeholder text.
- **Presets**: `recap`, `checklist`, `concept`, `slides`, `plan`.
- **Stamped**: a favicon, an icon theme toggle and a provenance footer (model,
  effort, agent from `generatedBy` or `--model`/`--effort`/`--agent`; "not
  reported" when unknown). `scripts/doctor.mjs` reports missing sister skills
  and tools, with the fix for your OS.
- **Short on purpose**: the page opens with a hero and a TL;DR card; any section
  takes a `label` of up to 4 words for the contents list; validation warns (never
  fails) over the soft caps: title 8 words, label 4, paragraph 3 sentences or 60
  words, text section 120, card text 30, list item 20, page prose 900, tl;dr 3 points.
- **A page worth opening**: themed (nine themes, light and dark; `dusk` by default, `mono` for a plan), a
  contents list from four sections up, copy buttons on code, print styles,
  reduced motion respected, no network at build or view time
  (unless you opt in with `--image-api`, see below).
- **Optional hero image**: `--image-api <https-endpoint>` swaps the page hero's
  art for a picture from your own image service. Off by default. It sends the
  page title and subtitle to that host, needs your key in `PA_IMAGE_API_KEY`, and
  may cost money; the endpoint contract is in `references/schema.md`.
- **Checklists remember**: ticks are saved in the browser, with a progress bar,
  per-group tallies and a reset that asks first.
- **Slides**: one section per slide, arrow keys and Space, `O` for an outline,
  `#slide-3` deep links, the last slide remembered, one slide per printed page.
  A slide that is too full fails validation (at most 6 points, 8 table rows, 12
  code lines, 80 words).
- **Embeds other skills**: a `diagram` section draws a make-diagram figure with
  hover tracing and a Present mode; a `chart` section draws a make-dashboard
  chart as static SVG with a data table; a `scene` section embeds a make-scene
  3D scene (orbit it, hover for exact values) that starts only when scrolled
  into view, and shows a data table in decks and print; a `motion` section
  plays an MP4 or renders a make-motion spec.

> Agents: the instructions you follow are in [`SKILL.md`](SKILL.md). This
> README is for people.

## Quick start

```bash
cd make-explainer && npm ci --omit=dev && cd -        # one-time
node make-explainer/scripts/doctor.mjs                # optional: what is missing, and how to fix it
node make-explainer/scripts/gather.mjs git --out facts.json
node make-explainer/scripts/scaffold.mjs recap --facts facts.json --out explainer.json
# replace every "TODO: ..." in explainer.json with real prose, then:
node make-explainer/scripts/validate.mjs explainer.json   # warnings (soft caps) do not block
node make-explainer/scripts/build.mjs    explainer.json   # add --model/--effort/--agent to stamp the page
node make-explainer/scripts/check.mjs    ~/.agent/diagrams/<name>.html   # optional; skips when no browser is installed
```

Or just ask your agent: *"Recap this branch with a manual test checklist."* It
gathers the facts, fills the file, runs validate and build and tells you where
the page is. The default output folder is `~/.agent/diagrams/`; set
`PA_OUTPUT_DIR` or pass `--out <file.html|dir>` to change it. A section with
files (a video, an interactive chart) also writes `<name>.assets/` next to the
page, so keep the two together.

## Requirements

- Node.js ≥ 20 and a one-time `npm ci --omit=dev` inside this folder (Ajv only).
- `gather.mjs` needs `git` on `PATH`.
- Diagram and chart sections need the **`make-diagram`** and **`make-dashboard`**
  skills in folders next to this one, each with its own `npm ci --omit=dev`.
  `bin/install.mjs` installs them for you (this skill's `package.json` lists
  them under `portableArtifacts.requires`). `npx skills add` does not resolve
  that list, so name all three:
  `npx skills add abhijitbansal/claude-skills --skill make-explainer make-diagram make-dashboard`.
  A `scene` section needs **`make-scene`** the same way, and only a spec with
  one asks for it. Without them a spec with no diagram, chart, scene or icon still builds; with one
  missing, validate prints that exact command.
- `motion` sections that point at an existing `.mp4` need nothing more. Rendering
  a make-motion `spec` also needs the optional **`make-motion`** skill beside it,
  ffmpeg and Chromium; `PA_MOTION_TIMEOUT_MS` bounds the render.
- No browser is needed to validate or build. Only `scripts/check.mjs` (an optional
  headless check of the built page at 1280 and 390 px) and this skill's browser
  tests use one. Playwright is a dev dependency, so `check.mjs` needs a full
  `npm ci` plus a Chromium or Chrome (`npx playwright install chromium`); without
  either it skips cleanly and says so, naming the doctor command
  (`doctor.mjs --for check --fix dev_deps` or `--fix chromium`).

## Sections

`tldr`, `text`, `kpis`, `cards`, `table`, `risks`, `files`, `steps`,
`timeline`, `compare`, `callout`, `code`, `details`, `checklist`, `diagram`,
`chart`, `scene`, `motion`, `image`, and for plans `decision`, `approval`,
`question`, `review`, `verdict`. Every field and limit:
[`references/sections.md`](references/sections.md) and
[`references/schema.md`](references/schema.md). The banned-phrase list:
[`references/style.md`](references/style.md). One working example per preset:
[`references/examples/`](references/examples/).

## Presets

| Preset | Starts from | You get |
|---|---|---|
| `recap` | `gather.mjs` facts | tl;dr, numbers, how it works, files changed, timeline, risks |
| `checklist` | `gather.mjs` facts | one group per area of changed files, a regression group, an intro and "If something fails" |
| `concept` | an empty skeleton | tl;dr, explanation, cards, steps |
| `slides` | an empty skeleton | a deck of cover, tl;dr, cards, steps and a closing slide |
| `plan` | an empty skeleton | decision first: summary, three numbers, a decision, an approval and a question the reviewer answers on the page, review pointers, goals, a diagram, phases, risks and the verdict with Copy / Download answers; `mono` theme by default; check the answers with `scripts/answers.mjs` |

## Tests

`npm ci` (the full install, with Playwright) then `npm test`. The browser tests
skip cleanly when no Chromium is installed.
