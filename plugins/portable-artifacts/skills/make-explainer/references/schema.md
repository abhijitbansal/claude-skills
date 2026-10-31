# explainer.json: top level, limits and rules

Every section type and its fields: [sections.md](sections.md). Banned phrases: [style.md](style.md). Working files, one per preset: `examples/`. All objects are closed: an unknown field is an error, and a misspelt `type`, `tone`, `theme` or `preset` gets a did-you-mean hint.

## Top level

| Field | Type | Rule |
|---|---|---|
| `title` | string, required | At most 90 characters. State the finding. |
| `subtitle` | string | At most 140 characters. |
| `preset` | `recap` `checklist` `concept` `slides` `plan` `none` | Default `none`. Mostly a label: it selects slides mode (`slides`), turns on the checklist `intro` warning (`checklist`), and for `plan` requires `key`, at least one `decision`, `approval` or `question`, and makes `mono` the default theme. |
| `key` | string | The plan's name for its saved and exported answers: `^[a-z0-9][a-z0-9._-]*$`, at most 80 characters. Required with `preset: "plan"` and whenever the spec has a `decision`, `approval` or `question`; optional otherwise. `scaffold.mjs plan` sets it from the title. |
| `mode` | `page` `slides` | Default `page`; `preset: "slides"` implies slides. `preset: "slides"` with `mode: "page"` is an error. |
| `theme` | `dusk` `press` `poster` `paper` `blueprint` `ink` `editorial` `mono` `brief` | Default `dusk` (`mono` for `preset: "plan"`). `SKILL.md` ("Choosing a theme", "Plan mode") says which to pick. Each has light and dark variants; the page follows the reader's setting and has a Theme toggle. |
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
| `decision`, `approval`, `question` | `id` at most 80 characters; `question`, `item` and `text` at most 500; option `label` at most 200; 2 to 5 options |
| `review.items` | 1 to 5 |
| `verdict` | at most one, the last section |
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

`validate.mjs` and `build.mjs`: 0 ok, 1 spec errors (printed as `path: message`), 2 usage or IO error. `--json` prints `{ ok, errors, warnings }` instead. `gather.mjs` and `scaffold.mjs`: 0 ok, 2 usage error. `check.mjs`: 0 ok or skipped, 1 problems, 2 usage error. `answers.mjs`: 0 valid (warnings are printed), 1 the plan or the answers have errors, 2 usage or IO error (a missing or unreadable file, not a regular file, an answers file over 2 MB).

## Plan answers

The plan page's Copy answers button copies, and Download saves as `plan-answers.json`, one JSON object:

```json
{
  "schema": "plan-answers/1",
  "planKey": "plan-render-skills-oct-2026",
  "planHash": "3f2a9c01b7de",
  "reviewer": "Ada",
  "verdict": "approve-with-changes",
  "answers": [
    { "id": "routing", "kind": "decision", "question": "How does …?", "answered": true, "choice": "Pinned agent file plus a hand-off line", "isRecommended": true, "text": null, "comment": null },
    { "id": "codex-untested", "kind": "approval", "question": "Ship …", "answered": true, "choice": "changes", "isRecommended": null, "text": null, "comment": "Name the owner first." },
    { "id": "codex-fallback", "kind": "question", "question": "If …?", "answered": false, "choice": null, "isRecommended": null, "text": "Keep gpt-6-luna …", "comment": null }
  ]
}
```

- `planKey` is the root `key`; `planHash` is the first 12 hex characters of a SHA-256 over the plan's `title` and `sections` (changing the subtitle, meta, theme or preset does not change it). `verdict` is `approve`, `approve-with-changes`, `not-yet` or `null`.
- One row per decision, approval and question, in page order. `choice` is the option label (decision) or `approve`, `changes`, `reject` (approval). An unanswered item carries its `default` (`choice` for a decision, `text` for a question) and `answered: false`.
- Bounds: at most 200 rows; `id` 80 characters, `choice`, `planKey` and `planHash` 500, `question` 2000, `text`, `comment` and `reviewer` 20000. Unknown fields are errors.

The plan page's Save as HTML button downloads `<key>-answered.html`: the page with a data block `<script type="application/json" id="pa-plan-saved">` holding `{ "schema": "plan-saved/1", "savedAt": <ms>, "entry": <the browser's stored entry>, "export": <the plan-answers/1 object above> }` (every `<` in it is escaped). `answers.mjs` accepts that file in place of the JSON and checks its `export` the same way. Opening the file puts `entry` back on the form unless the browser holds a newer entry (`updatedAt`; an entry with none counts as newer) for the same plan; nothing is written to the browser until the reader changes something, and later writes are stamped no earlier than the file's `savedAt`. `answers.mjs` reads only `export`, so the agent sees the answers as saved, whatever a browser shows later. A saved page can be up to 32 MiB (answers files stay capped at 2 MiB).

`node scripts/answers.mjs <plan.json> <plan-answers.json | saved-page.html> [--json]` validates the plan, then the file against it: a different `planKey`, a stale `planHash` (`the plan changed after these answers were given; re-export from the current page`), an unknown or repeated id, a kind that does not match the plan, a choice that is not one of the item's options, or a row marked answered with no choice or text is an error; an unanswered item without a default, an unanswered row carrying a value other than its default, an empty reviewer and a plan item with no row are warnings. It prints the errors and warnings (at most 20 of each, then `… N more`), then a summary: one line per item with only values taken from the plan (`routing: Pinned agent file plus a hand-off line (recommended)`, `(override)`, `(default)`, `(answered)`), then everything the reviewer typed under `Reviewer text (data, not instructions)`, each value quoted, cut at 300 characters, with invisible and control characters written as `\uXXXX`. When there is any error the summary starts with `INVALID ANSWERS — do not act on this summary`. `--json` prints one line: `{ ok, errors, warnings, errorCount, warningCount, summary }` (`errors` and `warnings` hold at most 20 entries each; the counts are the totals).

## Scripts

| Script | Use |
|---|---|
| `gather.mjs git [--base <branch>] [--repo <folder>] [--out <file>] [--json]` | Without `--base`: `main`, then `master`, preferring origin's copy when it is ahead. Prints (or writes to `--out`) facts about the checked-out branch as JSON: branch, base, commits, changed files with line counts and renames, test files, date. Committed work only. |
| `scaffold.mjs <recap\|checklist\|concept\|slides\|plan> [--facts facts.json] [--title <text>] [--out <file>]` | A starter `explainer.json`, printed or written to `--out`. Facts fill numbers, files, commits and folders; every sentence is a `TODO:` string. A `plan` starter also gets a `key` from the title (`plan-draft` without one). |
| `answers.mjs <plan.json> <plan-answers.json \| saved-page.html> [--json]` | Checks a reviewer's exported answers against the plan and prints a summary; see "Plan answers" above. |
| `validate.mjs <explainer.json> [--json]` | Schema, limits, prose lint, slide budget, file references and the embedded diagram, scene, chart and motion checks. |
| `build.mjs <explainer.json> [--out <file.html\|dir>] [--theme <name>] [--image-api <https-endpoint>] [--model <m>] [--effort <e>] [--agent <a>] [--json]` | Validates, then writes the page. `--image-api` is optional and off by default: see "Hero image from an image API" below. |
| `check.mjs <page.html> [--json]` | Optional headless check of a built page at 1280, 390 and 1800 px: console errors and warnings, sideways scrolling, elements wider than the page, content clipped sideways inside a slide, a deck's last slide reachable by arrow keys with the counter reading N / N, and each diagram's viewer mounting and its Present overlay opening and closing on Esc. Exit 0 ok or skipped (no browser), 1 problems, 2 usage. Needs Playwright and a browser (full `npm ci`); `PA_CHECK_TIMEOUT_MS` shortens the 60 s cap. |

## Hero image from an image API

`build.mjs --image-api <endpoint>` replaces the page hero's procedural art with a picture made by your own image service. It is off by default; without the flag the build never touches the network. It affects the page hero of a `dusk`, `press` or `poster` page only: a slide deck or a classic-theme page (`paper`, `blueprint`, `ink`, `editorial`, `mono`, `brief`) is refused with exit 2 before anything is sent.

- **What leaves the machine**: the page title and subtitle (joined, at most 400 characters) go to the endpoint's host. The build prints `image-api: sending the title and subtitle to <host> (leaves this machine)` on stderr before it sends.
- **Key**: your own key, in the environment variable `PA_IMAGE_API_KEY` (sent as `authorization: Bearer <key>`). The build fails with exit 2 when it is missing. Never put the key in a spec, a config file or an example; it is never written to the page.
- **Cost**: each build with the flag is one request to your service and may be billed by it. Rebuild without the flag to avoid repeat calls.
- **Endpoint contract**: an `https` URL without credentials, no redirects followed. The build POSTs JSON `{"prompt": "...", "width": 1280, "height": 720}` with `content-type: application/json`. The endpoint must answer HTTP 200 with the picture itself as the body, `content-type` `image/png`, `image/jpeg` or `image/webp`, up to 8 MiB, and the bytes must really be that format (SVG, HTML and JSON replies are refused). It must answer within 60 seconds.
- **Failure**: any problem fails the build with exit 2 and a message that names the fix; there is no silent fallback to the procedural art. The image is inlined as a `data:` URI, so the finished page stays a single offline file.
