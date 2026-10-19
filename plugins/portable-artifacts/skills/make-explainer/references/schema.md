# explainer.json: top level, limits and rules

Every section type and its fields: [sections.md](sections.md). Banned phrases: [style.md](style.md). Working files, one per preset: `examples/`. All objects are closed: an unknown field is an error, and a misspelt `type`, `tone`, `theme` or `preset` gets a did-you-mean hint.

## Top level

| Field | Type | Rule |
|---|---|---|
| `title` | string, required | At most 90 characters. State the finding. |
| `subtitle` | string | At most 140 characters. |
| `preset` | `recap` `checklist` `concept` `slides` `none` | Default `none`. A label only: it selects slides mode (`slides`) and turns on the checklist `intro` warning (`checklist`). |
| `mode` | `page` `slides` | Default `page`; `preset: "slides"` implies slides. `preset: "slides"` with `mode: "page"` is an error. |
| `theme` | `dusk` `press` `poster` `paper` `blueprint` `ink` `editorial` | Default `dusk`. `SKILL.md` ("Choosing a theme") says which to pick. Each has light and dark variants; the page follows the reader's setting and has a Theme toggle. |
| `generatedBy` | object | Keys `model`, `effort`, `agent`; each 1-60 characters of letters, digits, spaces and `. _ : / ( ) + -`. Shown in the page footer and a `<meta name="generator">` tag; a missing field reads "not reported". The `--model`, `--effort` and `--agent` flags of `build.mjs` override it. |
| `meta` | object | Keys `date`, `branch`, `repo`, `author`, `version`, `status`; each value at most 60 characters. Shown as chips under the title. |
| `sections` | array, required | 1 to 40 sections, see below. |

Every section has `type` (required), an optional `id` (`^[a-z][a-z0-9-]*$`, unique; the deep link `#<id>` on a page, and on a deck it opens that slide (the outline links use it; `#slide-<n>` keeps working); not `content`, `outline-title`, `slide-<n>`, `slide-<n>-title` or anything starting `ch<n>-`, which the page uses itself), an optional `title` (at most 90 characters) and an optional `label` (a short name, at most 4 words, for the contents list and the small eyebrow above the heading; without it the contents list shows the `title`). A `label` shows on every section that renders a heading (any section with a `title`, except a `callout`) and on a leading tldr's hero card even without a title. A `callout` draws its own heading and never shows a label; a section without a `title` shows no label and is not listed in the contents.

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
| `diagram` file, `scene` file, `motion.spec` file | `.json`, at most 1 MB |
| `scene` sections | at most 4 per page |
| Text length | Soft caps, warnings only: title 8 words, label 4, paragraph 3 sentences or 60 words, text section 120, card text 30, list item 20, page prose 900, tldr 3 points |

Slides mode adds a budget to each section (errors): at most 6 points (tldr points, `- ` list lines, items of list-like sections, compare points, checklist items), 8 table rows, 12 code lines and 80 words of prose (the title, the label and captions do not count).

## Text

Markdown-lite in every prose field: paragraphs split by a blank line, `**bold**`, `*italic*`, `` `code` ``, `[text](https://…)` (http and https only), and `- ` lists. Everything else, including `<tags>`, is shown as text. Emoji are allowed; validate warns if they get dense (see style.md). A string must contain a non-space character.

Validate also fails on a `TODO:` or lorem ipsum anywhere, on headings ending in `!`, and on section titles numbered like `01` (a leading zero digit; "3 files changed" is fine).

## File references

`diagram`, `scene`, `chart.dashboard`, `motion.video`, `motion.spec`, `motion.poster` and `image.src` are paths relative to the `explainer.json` folder. Absolute paths, `..`, symlinks and missing files are errors that name the fix. Charts read local files only.

## Output

`build.mjs` writes `${PA_OUTPUT_DIR:-~/.agent/diagrams}/<slug>.html`, where `<slug>` comes from the title; `--out <file.html|dir>` overrides it. A section that needs files (a video, an interactive chart's dashboard) writes `<slug>.assets/` beside the page.

The page carries a strict content security policy: no network, inline script and style only, `data:` images and fonts. A page with a `motion` section also allows media from `self`, `file:` and `blob:`.

Environment: `PA_OUTPUT_DIR` (default output folder), `PA_MOTION_TIMEOUT_MS` (how long a make-motion render may take, default 10 minutes).

## Exit codes

`validate.mjs` and `build.mjs`: 0 ok, 1 spec errors (printed as `path: message`), 2 usage or IO error. `--json` prints `{ ok, errors, warnings }` instead. `gather.mjs` and `scaffold.mjs`: 0 ok, 2 usage error. `check.mjs`: 0 ok or skipped, 1 problems, 2 usage error.

## Scripts

| Script | Use |
|---|---|
| `gather.mjs git [--base <branch>] [--repo <folder>] [--out <file>] [--json]` | Without `--base`: `main`, then `master`, preferring origin's copy when it is ahead. Prints (or writes to `--out`) facts about the checked-out branch as JSON: branch, base, commits, changed files with line counts and renames, test files, date. Committed work only. |
| `scaffold.mjs <recap\|checklist\|concept\|slides> [--facts facts.json] [--title <text>] [--out <file>]` | A starter `explainer.json`, printed or written to `--out`. Facts fill numbers, files, commits and folders; every sentence is a `TODO:` string. |
| `validate.mjs <explainer.json> [--json]` | Schema, limits, prose lint, slide budget, file references and the embedded diagram, scene, chart and motion checks. |
| `build.mjs <explainer.json> [--out <file.html\|dir>] [--theme <name>] [--image-api <https-endpoint>] [--model <m>] [--effort <e>] [--agent <a>] [--json]` | Validates, then writes the page. `--image-api` is optional and off by default: see "Hero image from an image API" below. |
| `check.mjs <page.html> [--json]` | Optional headless check of a built page at 1280 and 390 px: console errors and warnings, sideways scrolling, elements wider than the page, content clipped sideways inside a slide, a deck's last slide reachable by arrow keys with the counter reading N / N, and each diagram's viewer mounting and its Present overlay opening and closing on Esc. Exit 0 ok or skipped (no browser), 1 problems, 2 usage. Needs Playwright and a browser (full `npm ci`); `PA_CHECK_TIMEOUT_MS` shortens the 60 s cap. |

## Hero image from an image API

`build.mjs --image-api <endpoint>` replaces the page hero's procedural art with a picture made by your own image service. It is off by default; without the flag the build never touches the network. It affects the page hero of a `dusk`, `press` or `poster` page only: a slide deck or a classic-theme page (`paper`, `blueprint`, `ink`, `editorial`) is refused with exit 2 before anything is sent.

- **What leaves the machine**: the page title and subtitle (joined, at most 400 characters) go to the endpoint's host. The build prints `image-api: sending the title and subtitle to <host> (leaves this machine)` on stderr before it sends.
- **Key**: your own key, in the environment variable `PA_IMAGE_API_KEY` (sent as `authorization: Bearer <key>`). The build fails with exit 2 when it is missing. Never put the key in a spec, a config file or an example; it is never written to the page.
- **Cost**: each build with the flag is one request to your service and may be billed by it. Rebuild without the flag to avoid repeat calls.
- **Endpoint contract**: an `https` URL without credentials, no redirects followed. The build POSTs JSON `{"prompt": "...", "width": 1280, "height": 720}` with `content-type: application/json`. The endpoint must answer HTTP 200 with the picture itself as the body, `content-type` `image/png`, `image/jpeg` or `image/webp`, up to 8 MiB, and the bytes must really be that format (SVG, HTML and JSON replies are refused). It must answer within 60 seconds.
- **Failure**: any problem fails the build with exit 2 and a message that names the fix; there is no silent fallback to the procedural art. The image is inlined as a `data:` URI, so the finished page stays a single offline file.
