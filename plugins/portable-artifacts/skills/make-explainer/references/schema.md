# explainer.json: top level, limits and rules

Every section type and its fields: [sections.md](sections.md). Banned phrases: [style.md](style.md). Working files, one per preset: `examples/`. All objects are closed: an unknown field is an error, and a misspelt `type`, `tone`, `theme` or `preset` gets a did-you-mean hint.

## Top level

| Field | Type | Rule |
|---|---|---|
| `title` | string, required | At most 90 characters. State the finding. |
| `subtitle` | string | At most 140 characters. |
| `preset` | `recap` `checklist` `concept` `slides` `none` | Default `none`. A label only: it selects slides mode (`slides`) and turns on the checklist `intro` warning (`checklist`). |
| `mode` | `page` `slides` | Default `page`; `preset: "slides"` implies slides. `preset: "slides"` with `mode: "page"` is an error. |
| `theme` | `paper` `blueprint` `ink` `editorial` | Default `paper`. Each has light and dark variants; the page follows the reader's setting and has a Theme toggle. |
| `meta` | object | Keys `date`, `branch`, `repo`, `author`, `version`, `status`; each value at most 60 characters. Shown as chips under the title. |
| `sections` | array, required | 1 to 40 sections, see below. |

Every section has `type` (required), an optional `id` (`^[a-z][a-z0-9-]*$`, unique; the deep link `#<id>` on a page, and on a deck it opens that slide (the outline links use it; `#slide-<n>` keeps working); not `content`, `outline-title`, `slide-<n>`, `slide-<n>-title` or anything starting `ch<n>-`, which the page uses itself) and an optional `title` (at most 90 characters).

## Limits

| Thing | Limit |
|---|---|
| Sections per file | 1 to 40 |
| `tldr.text` | 400 characters; `points` 0 to 6, each 160 characters |
| `text.text`, `details.text` | 4000 characters |
| `kpis.items` | 1 to 6 |
| `cards.items` | 1 to 12; `columns` 2, 3 or 4 |
| `table` | 1 to 8 columns, 1 to 60 rows, every row as long as `columns`, `align` as long as `columns` |
| `files.items` | 1 to 200 |
| `compare.columns` | 2 to 3, each with at least 1 point |
| `code.code` | 120 lines |
| `chart.data` | 1 to 500 rows |
| `checklist.key` | `^[a-z0-9][a-z0-9._-]*$`, at most 80 characters, unique in the file |
| `image.src` | png, jpg, webp or svg, at most 1.5 MB |
| `motion.video` | `.mp4`, at most 50 MB |
| `diagram` file, `motion.spec` file | `.json`, at most 1 MB |
| Paragraph | Over 120 words is a warning |

Slides mode adds a budget to each section (errors): at most 6 points (tldr points, `- ` list lines, items of list-like sections, compare points, checklist items), 8 table rows, 12 code lines and 80 words of prose (the title and captions do not count).

## Text

Markdown-lite in every prose field: paragraphs split by a blank line, `**bold**`, `*italic*`, `` `code` ``, `[text](https://…)` (http and https only), and `- ` lists. Everything else, including `<tags>`, is shown as text. No emoji anywhere. A string must contain a non-space character.

Validate also fails on a `TODO:` or lorem ipsum anywhere, on headings ending in `!`, and on section titles numbered like `01` (a leading zero digit; "3 files changed" is fine).

## File references

`diagram`, `chart.dashboard`, `motion.video`, `motion.spec`, `motion.poster` and `image.src` are paths relative to the `explainer.json` folder. Absolute paths, `..`, symlinks and missing files are errors that name the fix. Charts read local files only.

## Output

`build.mjs` writes `${PA_OUTPUT_DIR:-~/.agent/diagrams}/<slug>.html`, where `<slug>` comes from the title; `--out <file.html|dir>` overrides it. A section that needs files (a video, an interactive chart's dashboard) writes `<slug>.assets/` beside the page.

The page carries a strict content security policy: no network, inline script and style only, `data:` images and fonts. A page with a `motion` section also allows media from `self`, `file:` and `blob:`.

Environment: `PA_OUTPUT_DIR` (default output folder), `PA_MOTION_TIMEOUT_MS` (how long a make-motion render may take, default 10 minutes).

## Exit codes

`validate.mjs` and `build.mjs`: 0 ok, 1 spec errors (printed as `path: message`), 2 usage or IO error. `--json` prints `{ ok, errors, warnings }` instead. `gather.mjs` and `scaffold.mjs`: 0 ok, 2 usage error. `check.mjs`: 0 ok or skipped, 1 problems, 2 usage error.

## Scripts

| Script | Use |
|---|---|
| `gather.mjs git [--base <branch>] [--repo <folder>] [--json]` | Without `--base`: `main`, then `master`, preferring origin's copy when it is ahead. Facts about the checked-out branch as JSON: branch, base, commits, changed files with line counts and renames, test files, date. Committed work only. |
| `scaffold.mjs <recap\|checklist\|concept\|slides> [--facts facts.json] [--title <text>]` | A starter `explainer.json` on stdout. Facts fill numbers, files, commits and folders; every sentence is a `TODO:` string. |
| `validate.mjs <explainer.json> [--json]` | Schema, limits, prose lint, slide budget, file references and the embedded diagram, chart and motion checks. |
| `build.mjs <explainer.json> [--out <file.html\|dir>] [--theme <name>] [--json]` | Validates, then writes the page. |
| `check.mjs <page.html> [--json]` | Optional headless check of a built page at 1280 and 390 px: console errors and warnings, sideways scrolling, elements wider than the page, content clipped sideways inside a slide, a deck's last slide reachable by arrow keys with the counter reading N / N, and each diagram's viewer mounting and its Present overlay opening and closing on Esc. Exit 0 ok or skipped (no browser), 1 problems, 2 usage. Needs Playwright and a browser (full `npm ci`); `PA_CHECK_TIMEOUT_MS` shortens the 60 s cap. |
