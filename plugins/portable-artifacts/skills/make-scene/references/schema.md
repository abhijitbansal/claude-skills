# scene.json: every field

The spec is a closed JSON object: an unknown property is an error, and the validator names the nearest known one ("did you mean ..."). Exactly one of `data` or `lift`. Errors print as `path: message`.

```json
{
  "title": "Commits per folder, last 12 weeks",
  "subtitle": "optional one line",
  "world": "city",
  "theme": "dusk",
  "data": { "rows": [ { "group": "api", "t": "2026-W30", "value": 12 } ] },
  "links": [ { "from": "api", "to": "web", "value": 3 } ],
  "units": "commits",
  "tour": [ { "title": "Web spikes in week 32", "focus": ["2026-W32"], "caption": "The redesign landed." } ],
  "autoplay": false,
  "generatedBy": { "model": "...", "effort": "...", "agent": "..." }
}
```

## Top level

| Field | Type | Rule |
|---|---|---|
| `title` | string | Required, 1 to 120 characters. Also names the output file. |
| `subtitle` | string | Optional, up to 160 characters. |
| `world` | `city` `forest` `galaxy` `terrain` | Optional with `data`; leave it out and the build picks the best fit. Not allowed with `lift`. The data must be able to feed it (see Eligibility). |
| `theme` | string | `dusk` (default), `press`, `poster`, `paper`, `blueprint`, `ink`, `editorial`, `mono`, `brief`. `build.mjs --theme` overrides it. |
| `data` | object | Rows for a world. Exactly one of `data` or `lift`. |
| `links` | array | Optional, data scenes only: `{ "from", "to", "value" }` between groups. Drawn by the galaxy. |
| `lift` | object | An existing diagram or dashboard chart, instead of `data`. |
| `units` | string | Optional unit text shown after each value (`commits`, `mm`). A currency dashboard chart defaults to `USD`. |
| `tour` | array | Optional, up to 12 beats. |
| `autoplay` | boolean | Optional. `true` starts the tour when the page opens (ignored under reduced motion). |
| `generatedBy` | object | Optional provenance: `model`, `effort`, `agent` (strings). Build flags `--model`, `--effort`, `--agent` override it. |

## `data`

Exactly one source:

| Field | Type | Meaning |
|---|---|---|
| `rows` | array of rows | Inline rows, for small data already in hand. |
| `file` | string | A local JSON file `{ "rows": [...], "links": [...] }` (`links` optional). `rows.mjs git` writes this shape. Resolved from the spec's folder. |
| `csv` | string | A local CSV file; the first line is the headers. Use with `columns`. |
| `columns` | object | Only with `csv`. Maps CSV headers onto row fields: `{ "group": "folder", "t": "week", "value": "commits", "label": "...", "parent": "..." }`. A field left out uses the header of the same name; `group` and `value` must exist as headers. Every `value` cell must be a number. `links` cannot come from a CSV. |

Paths are local files inside the spec's folder: no URLs, no absolute paths, no `..` (pass `--allow-outside` to `validate.mjs` and `build.mjs` to lift that), and the file must exist.

### Row

| Field | Type | Rule |
|---|---|---|
| `group` | string | Required, 1 to 48 characters. Free display text, not an id (`.github`, `Sources` are fine). At most 24 distinct groups. |
| `value` | number | Required, 0 or more. |
| `t` | string or number | Optional order or time. Use sortable values: numbers, ISO dates (`2026-07-14`), ISO weeks (`2026-W09`, zero-padded) or months (`2026-07`). A column whose `t` values are all plain numbers, even as text (`"1"`, `"2"`, `"10"`), sorts as numbers, whether it comes from `data.rows`, `data.file` or `data.csv` (a column of bare years such as `"2026"`, or a value that would not print back as written such as `"01"`, stays text, so a focus names it as written). Any other string `t` sorts as text, so unpadded `W9` lands after `W10`. A tour `focus` may name a `t` value (see `tour`). Terrain requires it. |
| `label` | string | Optional text for hover and the Explore list. A tour `focus` may name it. |
| `parent` | string | Optional, the name of another `group`. A group has one parent; cycles and unknown names are errors. The forest grows that group as a branch of its parent's tree. |

At most 2000 rows. Duplicate `(group, t)` pairs are kept as separate items, never summed.

### Link

`from` and `to` (required) name groups that exist in the rows and differ from each other; `value` (optional) is a number of 0 or more. Links may sit in the top-level `links` or in `data.file`.

### Eligibility

`city`, `forest` and `galaxy` accept any rows. `terrain` needs `t` on every row and exactly one row per `(group, t)`. An explicit `world` the data cannot feed is an error that lists the eligible worlds.

## `lift`

Instead of `data`, exactly one of:

| Form | Meaning |
|---|---|
| `{ "diagram": "flow.diagram.json" }` | A path to a make-diagram `diagram.json`, or the diagram object inline. Any of its four types. |
| `{ "dashboard": "dashboard.json", "chart": "<chart id>" }` | One chart of a make-dashboard dashboard. `chart` is required with `dashboard` and not allowed with `diagram`. |

A lift takes no `world` and no top-level `links`. Liftable dashboard kinds: bar, stacked-bar, grouped-bar, histogram, line, area, scatter, bubble, heatmap, donut. A boxplot or a `vegaLite` chart is rejected with that list. A heatmap value, a donut `y` and a bubble `size` must be 0 or more. Lifting needs make-diagram or make-dashboard installed beside this skill (`doctor.mjs --for scene.json` checks).

## `tour`

Up to 12 beats:

| Field | Type | Rule |
|---|---|---|
| `title` | string | Required, up to 48 characters. |
| `caption` | string | Optional, up to 160 characters. |
| `focus` | array of strings | Required, at least one. Each names a `group`, a row `label` or a row `t` value (such as a week, `2026-W31`; all case-insensitive) in a data scene, or a node, group or participant id in a diagram lift, or an x value, colour value or label in a dashboard lift. A group or label that is also a `t` value keeps its own view. A miss gets a did-you-mean error. The camera flies to the first entry that resolves. In the city and terrain a `t` focus looks at that whole column across every district; in the forest and galaxy `t` only orders, so it flies to the tree or star of the first row at that `t`. |

A diagram lift with no `tour` replays the diagram's own `stories`: each beat becomes a hop along its 3D edge with a travelling light.

## Limits

| What | Limit |
|---|---|
| Rows, lifted chart rows | 2000 |
| Groups | 24 |
| Tour beats | 12 |
| `group` | 48 characters |
| Beat `title` / `caption` | 48 / 160 characters |
| `title` / `subtitle` | 120 / 160 characters |
| Scene source inside a make-explainer `scene` section | 1 MB |
| `scene` sections per make-explainer page | 4 |

### Row ceilings by world

The 2000-row limit is a ceiling on the input. The page also has a size cap (1408 KB), which a world can reach first. Measured with `heaviestPage` (the size `validate.mjs` compares with the cap: the heaviest theme plus room for the provenance stamp) on rows with `t` as `w0000`-style text and values either whole numbers 0 to 49 or two-decimal numbers up to 99999.99, in 8 and in 24 groups:

| World | Rows that fit | Measured |
|---|---|---|
| city | 2000 | all 2000 fit in every shape tried |
| galaxy | 2000 | all 2000 fit in every shape tried |
| terrain | 2000 | all 2000 fit (needs one row per group and `t`) |
| forest | about 1,250 | largest fit 1,248 rows (24 groups), 1,280 (8 groups, two-decimal values), 1,304 (8 groups, whole values) |

An earlier probe measured the forest at about 1,050 rows and the terrain at about 1,700; those used other row shapes and were not re-run for this table, so treat them as that probe's numbers. Longer values and labels cost bytes, so a forest near its ceiling can still go over. When a page is over the cap, `validate.mjs` and `build.mjs` name the worlds whose page does fit the same rows ("or pick a world that fits these rows (city, galaxy)"). A lifted chart has no other world to offer, so aggregate in SQL.

## Output

`build.mjs` writes `<slug-of-title>.html`, one offline page, to `--out` (a file or folder), else `PA_OUTPUT_DIR`, else `<git root>/.scratch/` for a spec inside a repository, else `~/.agent/diagrams/`; it prints `wrote <path>`, the page's `file://` URL on its own line, and an alternatives table. `--fragment` writes `<slug>.fragment.html` instead (no table): the scene's CSS, host, runtime and one `PAScene.initAll({ embedded: true })` call, for a host page that defines the theme variables. See `references/scene-graph.md` for the intermediate scene graph the worlds produce.
