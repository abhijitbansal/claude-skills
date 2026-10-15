---
name: make-explainer
description: Use when the user wants a branch recap, diff review, concept or plan explainer, interactive test checklist or slide deck as one polished offline HTML page; the agent fills a small JSON document of typed sections and scripts validate, lint the prose and render it, embedding make-diagram figures and make-dashboard charts when asked.
argument-hint: what to explain, e.g. "recap of this branch with a test checklist"
model: haiku
effort: low
---

# make-explainer

You write one JSON file, `explainer.json`: a title and a list of typed sections. Scripts validate it, lint the prose and build one offline HTML page or slide deck. You never write HTML, CSS, SVG or script. Text fields take only markdown-lite: paragraphs, `**bold**`, `*italic*`, `` `code` ``, `[text](https://…)` and `- ` lists; anything else is shown as plain text.

Run every command from the project folder (where `explainer.json` lives), using the full path to the scripts. If the request is empty, ask what to explain.

Run every step yourself, in this same turn. Do not end your reply after showing the JSON: keep going until validate prints `valid` and the HTML exists.

## Before the first build

`<skill-dir>` is the folder containing this SKILL.md. Run `node <skill-dir>/scripts/doctor.mjs --json` (add `--for <spec.json>` once the spec exists, `--for voiceover` for a voiceover (make-motion), `--for check` before `check.mjs` (skills that have one)). It needs only Node.

If it reports anything missing, tell the user in one message: each item, why it is needed, its size and the command, plus every `notes` and `info` entry from the output (they disclose downloads and the files an install writes). Ask once per set of missing items (the plain run and a later `--for` run may each find new ones). On yes, run `node <skill-dir>/scripts/doctor.mjs --fix <ids>` with the ids it reported, and the same `--for` you diagnosed with (for example `--fix <ids> --for check`). Hand the user the exact command to run themselves for anything the doctor reports as refused (it needs sudo, or has no automatic fix), skipped (needs node_modules first), installed elsewhere, still missing, or failed; in Claude Code suggest prefixing it with `!`. On no, do what you can without it and give the user the remaining commands.

## Workflow

1. Pick the shape. A **preset** gives a starter file, a **section list** you write yourself gives full control.
   - `recap` (branch recap or diff review): `node <skill-dir>/scripts/gather.mjs git --out facts.json`, then `node <skill-dir>/scripts/scaffold.mjs recap --facts facts.json --out explainer.json`. Gather reads committed work only. Omit `--base` to auto-detect the base (`main`, then `master`, preferring origin's copy when it is ahead); add `--base <branch>` when the branch started elsewhere, and `--repo <folder>` to read another checkout. A missing base or a folder that is not a repository is an error that names the fix.
   - `checklist` (manual test list): the same two steps with `scaffold.mjs checklist`.
   - `concept` (idea or plan explainer) and `slides` (deck): `node <skill-dir>/scripts/scaffold.mjs concept --out explainer.json` (or `slides`). Add `--title "…"` to set the title. `--out` already creates the file: edit `explainer.json` in place and do not create it again.
   - No preset fits: write `explainer.json` from the section list below. Details of every field: `<skill-dir>/references/schema.md` and `sections.md`; ready-made files in `<skill-dir>/references/examples/`.
2. Fill the file. A scaffold marks every sentence for you with `TODO: …`; replace each one with real prose from the facts and from reading the changed files. Facts (numbers, files, commits) are already correct: do not retype them. Delete a section you cannot fill. Set `generatedBy` to the model you are running as, your effort level if you know it, and your host (for example Claude Code, Codex, Copilot CLI, Gemini CLI). Never guess; leave out any field you do not know. `--model`, `--effort` and `--agent` on the build override it.
3. Once the spec exists, rerun `node <skill-dir>/scripts/doctor.mjs --json --for explainer.json` and handle anything new (make-diagram, make-dashboard or make-motion for `diagram`, `chart` and `motion` sections) as in "Before the first build". Then `node <skill-dir>/scripts/validate.mjs explainer.json`. Fix every line it prints (a JSON path, the problem, the fix) and rerun until it says `valid`. Exit 0 ok, 1 spec errors, 2 usage error. Warnings do not block, but resolve the budget warnings (too many words in a title, label, paragraph, card, list or page) before building where you can, and report any you leave.
4. `node <skill-dir>/scripts/build.mjs explainer.json` prints the HTML path. Default folder is `~/.agent/diagrams/` (or the folder in the `PA_OUTPUT_DIR` environment variable); `--out <file.html|dir>` picks another; `--theme paper|blueprint|ink|editorial` overrides the theme; `--json` prints machine-readable results. Sections with files (video, interactive chart) add a `<name>.assets/` folder next to the page: keep the two together.
5. Optional check: first run `node <skill-dir>/scripts/doctor.mjs --json --for check` (it installs the check tools after the user agrees), then `node <skill-dir>/scripts/check.mjs <printed path>` opens the page at desktop and phone width and fails on console errors, sideways scrolling, a deck that cannot reach its last slide, or a diagram Present overlay that will not close. It needs Playwright and a browser (a full `npm ci`; `doctor --for check` reports and installs both, after the user agrees); without them it prints `check: skipped` and exits 0.
6. Report: the HTML path, one line on what it shows, and the validate warnings you left.

For a change ("rename the card", "add a risk"), edit only those fields, then validate and build again.

## Writing rules

- A section `title` states the finding ("Search now ignores case"), never a label ("Overview", "Changes"). Same for the page title.
- `label` ≤ 4 words for the contents list; `title` states the finding in ≤ 8 words. A label shows on every section that renders a heading (any section with a `title`, except a `callout`) and on a leading tldr's hero card even without a title. A `callout` never shows it, and a section without a `title` is not listed in the contents.
- Plain words. Validate rejects emoji, filler such as "leverage", "seamless" and "delve" (full list in `<skill-dir>/references/style.md`), titles ending in `!`, titles numbered "01", and any leftover `TODO:` or lorem ipsum. Text over the soft caps warns (title 8 words, label 4, paragraph 3 sentences or 60 words, text section 120, card text 30, list item 20, page prose 900, tldr 3 points).
- Use the section that fits the content: numbers as `kpis`, a list of files as `files`, a sequence as `steps`, options as `compare`. A wall of `text` is the last resort.
- Checklist: always supply `intro` (validate only warns when it is missing). Fill it with the "What's in this branch" summary that lists every feature and every review-cycle fix the branch delivers, and what automated tests already cover, so the tester needs no PR. Tag the review-cycle fixes `regression`, device-only items `device`.
- Slides: each section is one slide, so keep it small: at most 6 points, 8 table rows, 12 code lines and 80 words, otherwise validate fails and says to split it. Keys in the deck: arrows or Space, `O` for the outline.

## Sections

- `tldr`: verdict block (`text`, `points`, `tone`); put it first.
- `text`: prose in markdown-lite.
- `kpis`: 1-6 number tiles (`label`, `value`).
- `cards`: 1-12 titled cards; `icon` is a make-diagram ref like `lucide:database`.
- `table`: `columns` and `rows`.
- `risks`: `risk`, `severity`, `mitigation`.
- `files`: changed files, each with `path` and `change`.
- `steps`: numbered steps.
- `timeline`: dated events.
- `compare`: 2-3 columns of points.
- `callout`: `tone` info, warn, good or bad.
- `code`: a block with a copy button.
- `details`: a collapsed block.
- `checklist`: ticks saved in the browser (`key`, `groups`).
- `diagram`: a make-diagram spec, inline or a `.json` path.
- `chart`: inline `data` rows plus `kind`, `x`, `y`; or a `dashboard` path and `chart` id.
- `motion`: a `.mp4` `video`, or a make-motion `spec` rendered at build.
- `image`: a local `src` with required `alt`.

File paths (`diagram`, `chart.dashboard`, `motion.video`, `motion.spec`, `motion.poster`, `image.src`) are relative to `explainer.json`, must stay inside its folder and cannot be symlinks. Charts read local files only; a dashboard with a Postgres or MySQL source is refused.

## Example

```json
{
  "title": "Search now ignores case",
  "preset": "concept",
  "sections": [
    { "type": "tldr", "title": "Queries match however they are typed", "label": "The verdict", "text": "Both sides are lowercased before the comparison.", "points": ["No change to the stored notes.", "One new test covers an empty store."] },
    { "type": "diagram", "title": "A query takes one extra step", "label": "Search path", "diagram": { "title": "Search path", "type": "flow", "nodes": [{ "id": "q", "label": "Query", "kind": "start" }, { "id": "l", "label": "Lowercase both sides" }, { "id": "m", "label": "Match notes", "kind": "end" }], "edges": [{ "from": "q", "to": "l" }, { "from": "l", "to": "m" }] } }
  ]
}
```

## Degraded mode

If you cannot run shell commands, write `explainer.json` and give the user the exact commands from steps 3 and 4 with the real `<skill-dir>` path.

## Security

Specs accept no HTML, CSS, SVG or script; every string is escaped. The page makes no network requests and its CSP blocks them. Links are `http` or `https` only. Keep secrets out of text, code and facts.
