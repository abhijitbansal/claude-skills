# Sections

Every section has `type`, an optional `id`, an optional `title` and an optional `label`. A `title` is a claim a reader can agree or disagree with ("Search now ignores case"), not a label ("Overview"). The `label` is that short name ("Eval results", at most 4 words): the contents list shows it, and it sits as a small eyebrow above the heading (and above the slide heading in a deck). The label shows on every section that renders a heading (any section with a `title`, except a `callout`) and on a leading tldr's hero card even without a title. A `callout` draws its own heading and never shows a label; a section without a `title` shows no label and is not listed in the contents. Limits are in [schema.md](schema.md). Fields marked `*` are required. Closed sets: `tone` is `neutral` `accent` `good` `warn` `bad` unless the section says otherwise.

Numbers with a percent sign or unit (`87%`, `1,204 ms`, `$4.2k`) are kept on one line when the page is built. Write `1,000 ms` with comma grouping: `1 000 ms` binds only `000 ms`. The binder is for percent and unit tokens, not arbitrary number-noun pairs such as `12 files`. A KPI value is one line when it fits its tile and wraps inside it when it does not (validate warns above 12 characters; move the words to `note`).

On a page, a `tldr` that comes first (and is not the only section) is drawn inside the hero, under the title, as its summary card; its `label` is the card's heading, and the `title` then names the card for screen readers only. Visual sections (`kpis`, `cards`, `compare`, `diagram`, `chart`, `scene`) alternate onto a surface band, starting with the first: the 1st, 3rd and so on.

In slides mode each section is one slide (the title is the slide heading) and must fit the budget in schema.md; split a section that does not.

## Text and numbers

| Type | Fields | Notes |
|---|---|---|
| `tldr` | `text`*, `points[]`, `tone` | The verdict block. Put it first: it then becomes the hero's card. `text` is one or two sentences, each point one fact; three points at most read best. |
| `text` | `text`* | Markdown-lite prose. Several short paragraphs beat one long one. |
| `kpis` | `items[]`* (1-6): `label`*, `value`* (string or number), `delta`, `tone`, `note` | Stat tiles. A number value prints with thousands separators from 10,000 (51301 shows as 51,301; 2026 and 1107 stay as written); a string shows as written, so use a string for versions and "12k". Use `delta` for a change ("+12 vs last week"). |
| `cards` | `items[]`* (1-12): `title`*, `text`*, `icon`, `tone`, `tag`; `columns` (2, 3 or 4) | Parallel items. `icon` is a make-diagram catalog ref (`lucide:<name>` or `brand:<slug>`); find one with `node <skill-dir>/../make-diagram/scripts/icons.mjs search <word>`. An unknown icon is an error. |
| `table` | `columns[]`* (1-8 strings), `rows[][]`* (1-60 rows of strings or numbers, one cell per column), `caption`, `align[]` (`left` `center` `right`, one per column) | Sticky header; numbers align right. |
| `callout` | `tone`* (`info` `warn` `good` `bad`), `title`*, `text`* | A boxed note with an icon and a label. |
| `details` | `summary`*, `text`* | A collapsed block for detail most readers skip. |
| `code` | `code`*, `language`, `caption` | At most 120 lines. Has a copy button. |
| `image` | `src`*, `alt`*, `caption` | A local file, inlined. An SVG with script, event handlers or external references is refused. |

## Changes, plans and risks

| Type | Fields | Notes |
|---|---|---|
| `files` | `items[]`* (1-200): `path`*, `change`* (`added` `modified` `deleted` `renamed`), `note`, `add`, `del` | Grouped by folder. `add` and `del` are line counts. The scaffold fills this from `gather.mjs`. |
| `risks` | `items[]`*: `risk`*, `severity`* (`low` `medium` `high` `critical`), `mitigation`*, `owner` | Severity is shown with a shape and a word. |
| `steps` | `items[]`*: `title`*, `text`, `status` (`done` `doing` `todo`) | Numbered. |
| `timeline` | `items[]`*: `date`*, `title`*, `text` | Vertical. `date` is free text. |
| `compare` | `columns[]`* (2-3): `title`*, `points[]`* (at least 1), `tone`; `verdict` | Side by side. Put the conclusion in `verdict`. |

## Checklist

`checklist`: `key`*, `groups[]`* (at least 1): `title`*, `items[]`* (at least 1): `text`*, `tag` (`regression` `device` `manual` `visual`), `note`; `intro`; `onFail`.

- Ticks are saved in the reader's browser under `key` (unique in the file; lowercase letters, digits, `.`, `-`, `_`). Blocked storage is tolerated and the page says progress will not be saved.
- A tick follows its item when items are reordered. Changing an item's `text` or its group's `title` resets that item.
- Two equal items in groups with the same title are an error: reword one.
- `intro` (markdown-lite) is shown open at the top as "What's in this branch": list every feature and every review-cycle fix the branch delivers, and what automated tests already cover. With `preset: "checklist"`, leaving it out is a validate warning.
- `onFail` (markdown-lite) replaces the default "If something fails" advice.
- Tag a bug fixed during review `regression`, a hardware-only step `device`.

## Plan mode

Five types for a plan a reviewer answers on the page (`preset: "plan"`; SKILL.md "Plan mode" has the workflow). `decision`, `approval` and `question` require an `id` (`^[a-z][a-z0-9-]*$`, at most 80 characters, unique on the page, not `verdict` or `plan-verdict`): the answers file keys on it. Any page with one of them needs a root `key` and a `verdict` as its last section.

| Type | Fields | Notes |
|---|---|---|
| `decision` | `id`*, `question`* (≤ 500 characters), `options[]`* (2-5): `label`* (≤ 200 characters, unique ignoring case, no leading or trailing space), `pros[]`, `cons[]`; `recommended`* (one option label exactly), `why`*, `default` (one option label exactly) | The reader picks one option or writes an override in the comment box. `recommended` gets a Recommended chip; `why` says why, with the number that decides it; `default` is what happens if nobody answers. One line per option. |
| `approval` | `id`*, `item`* (≤ 500 characters), `why`*, `impact`, `owner` | The reader chooses Approve, Needs changes or Reject, with an optional comment. |
| `question` | `id`*, `text`* (≤ 500 characters), `default` | Free-text answer. A blank answer means the `default` applies, and the export says so. |
| `review` | `items[]`* (1-5): `point`*, `why`*, `target` | "Review these first": the places to look hardest. `target` is the explicit `id` of the section it points at (not this review); the page links to it. Not answered. |
| `verdict` | `text` | The overall control: Approve, Approve with changes or Not yet, the reviewer's name, and the Copy answers and Download `plan-answers.json` buttons. At most one, and it must be the last section. Give it an `id`, a `title` and a `label` (the scaffold uses `verdict` and "Your verdict") so it is listed in the contents and has a stable link. |

- Answers save in the reader's browser under the plan's `key` as they go; a plan edited since the answers were saved shows a notice and no saved answers; the first new answer replaces the old entry. Blocked storage is tolerated and stated.
- In a deck the controls do not run: a slide shows the question, the options with the recommendation, and a note that answers are collected in the page version.
- Limits on a plan page: 2-5 options per decision, 1-5 review items.

## Diagram

`diagram`: `diagram`* and `caption`. `diagram` is either a make-diagram spec written inline as an object, or a path to a `.json` file in the explainer's folder (at most 1 MB). The full make-diagram rules apply, geometry lint included, and its errors are reported under the section (`sections[2].diagram.nodes[0].label: …`).

- The page theme wins: a `theme` inside the diagram is ignored, with a warning.
- Hover traces edges. A Present button opens make-diagram's whole viewer in an overlay: Play story (the transport, chapter and beat chips, the travelling dot), Explore (a side panel for a node or edge, Find, shift-click routes) and full screen. In a deck the keys belong to the overlay while it is open; Esc closes the panel, then leaves full screen, then closes the overlay.
- Needs the `make-diagram` skill next to this one.

## Scene

`scene`: `scene`* and `caption`. `scene` is either a make-scene spec written inline as an object, or a path to a `.json` file in the explainer's folder (at most 1 MB; a data file it names resolves next to it). The full make-scene rules apply and its errors are reported under the section (`sections[2].scene.world: …`).

- The page theme wins: a `theme` inside the scene is ignored, with a warning.
- The scene sits in a 16:9 frame (at least 18rem tall) and starts only when it is about to scroll into view; orbit, hover, Explore, a tour and PNG export come from make-scene. Until it starts, and wherever WebGL is unavailable, the frame shows the scene's data table.
- Decks and print show that data table instead (a deck ships no 3D runtime).
- At most 4 scene sections per page (each one is a WebGL context); validate reports the fifth. Scene sections alternate onto the surface band like `diagram` and `chart`.
- The page's content security policy does not change; make-scene needs nothing new.
- Needs the `make-scene` skill next to this one (only a spec with a `scene` section asks for it).

## Chart

`chart`: either `dashboard`* + `chart`* (a make-dashboard `dashboard.json` path and one chart id in it), or inline `data`* + `kind`* with `x`, `y`, `color`, `size`, `value`, `format`; plus `caption` and `interactive`. Mixing the two forms is an error.

- Inline `data` is an array of up to 500 row objects. `kind` is one of `bar`, `stacked-bar`, `grouped-bar`, `line`, `area`, `scatter`, `bubble`, `heatmap`, `histogram`, `boxplot`, `donut`; each takes the roles make-dashboard defines (a `bar` needs `x` and `y`; a `histogram` needs `value`). `format` is `number`, `currency`, `percent` or `compact`.
- A dashboard chart must exist in a dashboard that validates. Its query result must be at most 500 rows; aggregate in SQL.
- The page draws a static SVG for light and dark and for wide and narrow screens, and a collapsed "Data table" of the plotted rows (first 25 shown), so no value is only a colour.
- `interactive: true` (dashboard form only) also builds the dashboard to `<slug>.assets/<chart id>/index.html` and links it. Two different dashboards cannot offer the same chart id when interactive. The interactive dashboard's "Refreshed" time is the newest input file's time (the dashboard file or any of its data files), not the build time, so rebuilding unchanged inputs gives the same bytes (give every query a total `ORDER BY`; DuckDB returns tied rows in any order). Each build records the files it wrote in `<slug>.assets/.pa-assets.json`; a rebuild deletes only files that the previous build listed there and this build no longer writes, and only the subfolders a build made. Your own files in that folder (an image, a video or a poster the spec reads) are never deleted or overwritten. If `<slug>.assets` is a symlink or a plain file, the build fails and writes nothing.
- Local files only: a dashboard with a `postgres` or `mysql` source is refused because a build never uses the network. Export the data to CSV or Parquet first.
- Needs the `make-dashboard` skill next to this one.

## Motion

`motion`: `video` (an `.mp4`, at most 50 MB) and/or `spec` (a make-motion `motion.json` path); `poster`, `caption`. At least one of `video` and `spec` is required.

- With `video` the file is copied to `<slug>.assets/`. With only `spec`, make-motion renders it during the build (needs ffmpeg and Chromium; it can take minutes, bounded by `PA_MOTION_TIMEOUT_MS`).
- If both are given the video is shown and the spec is ignored, with a warning.
- A `spec` without its own `theme` is drawn with the page theme. A rendered video uses the theme's dark variant whatever the page mode.
- `poster` (png, jpg or webp) is inlined; a rendered video gets a frame as its poster. The video never autoplays, and print shows the poster.
- Needs the `make-motion` skill next to this one only when `spec` is used.

## Which section for what

Verdict first (`tldr`), then numbers (`kpis`), then the story (`text`, `steps`, `timeline`), the evidence (`files`, `table`, `chart`, `diagram`), what could go wrong (`risks`, `callout`), and last what to do by hand (`checklist`). A recap is `tldr`, `kpis`, `text`, `files`, `timeline`, `risks`; a concept page is `tldr`, `text`, `cards`, `steps`; a deck is one claim per section. A plan is decision first: `tldr`, `kpis`, the `decision`, `approval` and `question` sections, `review`, then `text` (goals and non-goals), `diagram`, `steps`, `details` (risks) and `verdict` last.
