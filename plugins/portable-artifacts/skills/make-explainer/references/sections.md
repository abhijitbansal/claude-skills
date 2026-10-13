# Sections

Every section has `type`, an optional `id` and an optional `title`. A `title` is a claim a reader can agree or disagree with ("Search now ignores case"), not a label ("Overview"). Limits are in [schema.md](schema.md). Fields marked `*` are required. Closed sets: `tone` is `neutral` `accent` `good` `warn` `bad` unless the section says otherwise.

In slides mode each section is one slide (the title is the slide heading) and must fit the budget in schema.md; split a section that does not.

## Text and numbers

| Type | Fields | Notes |
|---|---|---|
| `tldr` | `text`*, `points[]`, `tone` | The verdict block. Put it first. `text` is one or two sentences, each point one fact. |
| `text` | `text`* | Markdown-lite prose. Several short paragraphs beat one long one. |
| `kpis` | `items[]`* (1-6): `label`*, `value`* (string or number), `delta`, `tone`, `note` | Stat tiles. Use `delta` for a change ("+12 vs last week"). |
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

## Diagram

`diagram`: `diagram`* and `caption`. `diagram` is either a make-diagram spec written inline as an object, or a path to a `.json` file in the explainer's folder (at most 1 MB). The full make-diagram rules apply, geometry lint included, and its errors are reported under the section (`sections[2].diagram.nodes[0].label: …`).

- The page theme wins: a `theme` inside the diagram is ignored, with a warning.
- Hover traces edges. A Present button opens a full-screen step-by-step walkthrough; in a deck the arrow keys belong to it while it is open.
- Needs the `make-diagram` skill next to this one.

## Chart

`chart`: either `dashboard`* + `chart`* (a make-dashboard `dashboard.json` path and one chart id in it), or inline `data`* + `kind`* with `x`, `y`, `color`, `size`, `value`, `format`; plus `caption` and `interactive`. Mixing the two forms is an error.

- Inline `data` is an array of up to 500 row objects. `kind` is one of `bar`, `stacked-bar`, `grouped-bar`, `line`, `area`, `scatter`, `bubble`, `heatmap`, `histogram`, `boxplot`, `donut`; each takes the roles make-dashboard defines (a `bar` needs `x` and `y`; a `histogram` needs `value`). `format` is `number`, `currency`, `percent` or `compact`.
- A dashboard chart must exist in a dashboard that validates. Its query result must be at most 500 rows; aggregate in SQL.
- The page draws a static SVG for light and dark and for wide and narrow screens, and a collapsed "Data table" of the plotted rows (first 25 shown), so no value is only a colour.
- `interactive: true` (dashboard form only) also builds the dashboard to `<slug>.assets/<chart id>/index.html` and links it. Two different dashboards cannot offer the same chart id when interactive.
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

Verdict first (`tldr`), then numbers (`kpis`), then the story (`text`, `steps`, `timeline`), the evidence (`files`, `table`, `chart`, `diagram`), what could go wrong (`risks`, `callout`), and last what to do by hand (`checklist`). A recap is `tldr`, `kpis`, `text`, `files`, `timeline`, `risks`; a concept page is `tldr`, `text`, `cards`, `steps`; a deck is one claim per section.
