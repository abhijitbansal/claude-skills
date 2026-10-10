# Portable Motion & Dashboard Skills — Design

> **Renamed 2026-10-10:** `dashboard-builder` → `make-dashboard`, `motion-explainer` → `make-motion` (one name on every host; avoids a clash with an existing `dashboard-builder` skill). Paths below use the original names.


*2026-10-09 · source proposal: `foundry/.scratch/portable-motion-dashboard-skills.md`*

This doc refines the proposal into a buildable design. The proposal's goals,
non-goals, core principle (model writes a small declarative spec, deterministic
scripts do everything else) and licence constraints carry over unchanged. This doc
records the review findings, the resolved open questions, and the concrete
schemas and interfaces.

## Review of the proposal

What holds:

- The spec-first split is right: it makes the skills host-agnostic and makes
  targeted edits ("slow scene 2") a one-field change.
- The stack is all OSI-licensed: anime.js (MIT), Playwright (Apache-2.0),
  Vega-Lite (BSD-3), DuckDB (MIT), plus system ffmpeg. Excluding Remotion and
  GSAP is correct.
- Dashboard first is the right order: it is lower risk and more useful day to day.

Verified before design (scratch probes, 2026-10-09):

- anime.js resolves to **4.5.0**. The v4 API is not v3. It uses
  `createTimeline({ autoplay: false })` and `timeline.seek(ms)`. Seeking is
  deterministic and works on plain JS objects in Node, so it can be unit-tested.
- DuckDB `SELECT json_serialize_sql(?)` returns an AST for SELECT and errors on
  every other statement type, including `SELECT 1; DROP TABLE x`.
- `SET allowed_directories=[…]` + `SET enable_external_access=false` +
  `SET lock_configuration=true` blocks reads outside the allowed set, including
  `..` traversal, and blocks re-enabling access.

What the proposal left out or got wrong (resolved below):

1. **"Shared harness" conflicts with "self-contained skill".** A skill folder
   must work when copied on its own. Resolution: each skill carries its own copy
   of the small error-formatting module. A test asserts the copies are
   byte-identical.
2. **A regex SELECT lint is weak.** Resolution: use DuckDB's own parser (see
   above). Wrap every query as `SELECT * FROM (<q>) LIMIT n` instead of
   trusting the model to add a limit.
3. **"Read-only role" only covers databases.** For local files the equivalent
   is the DuckDB lockdown above, scoped to the declared source paths.
4. **Some checks can't be JSON Schema.** These need a custom pass after Ajv:
   unique ids, keyframe `t` ≤ scene duration, chart→query references, and
   chart fields that must be result columns. They are a planned module with
   did-you-mean errors.
5. **Vega-Lite specs need validating too.** A chart is only correct if Vega-Lite
   compiles it. `validate` compiles each chart in Node.
6. **The Playwright Chromium is not installed** on this machine (only system
   Chrome is). Resolution: launch the bundled Chromium first. If it is missing,
   fall back to `channel: "chrome"` with a warning that output may differ
   between machines.
7. **Data types.** DuckDB returns BIGINT/DECIMAL/DATE values that `JSON.stringify`
   can't handle. A converter maps BIGINT→number (or string if the value is too
   big to be exact), DECIMAL→number and DATE/TIMESTAMP→ISO string.
8. **Embedded data is an XSS vector.** Query results go into a
   `<script type="application/json">` block with `<` escaped as `<`. Every
   title and SQL string is HTML-escaped.

## Resolved open questions (defaults; easy to revisit)

| Question | Decision |
|---|---|
| Hosts first | Claude Code and Codex CLI (installed here). Ollama goes through `codex exec --oss`. Gemini CLI and Copilot get host entries in the eval runner but are not run here because they aren't installed. A local model is not a hard requirement. |
| Day-one data sources | Local files (csv, parquet, json) and DuckDB database files. Phase 5 adds SQLite (tested locally) plus Postgres and MySQL (code path and unit test only, since no server is available here). |
| Where skills live | A new plugin, `plugins/portable-artifacts/`, in this marketplace. Each skill folder is self-contained, so it can be copied into any project or any other skills directory. |
| Motion targets | Default 1920×1080 at 30 fps. Allowed fps: 24, 25, 30 or 60. Total length ≤ 120 s. No audio. |

## Layout

```
plugins/portable-artifacts/
  .claude-plugin/plugin.json
  README.md                        # install, AGENTS.md fallback line, hosts
  skills/
    dashboard-builder/
      SKILL.md
      package.json  package-lock.json
      references/schema.md  references/examples/*.json  references/refresh.md
      scripts/validate.mjs  build.mjs  serve.mjs  setup.mjs
      scripts/lib/errors.mjs       # shared copy (byte-identical)
      scripts/lib/{spec,sql,data,html}.mjs
      template/page.html           # page shell + CSS
      test/*.test.mjs  test/fixtures/
    motion-explainer/
      SKILL.md
      package.json  package-lock.json
      references/schema.md  references/examples/*.json
      scripts/validate.mjs  preview.mjs  render.mjs
      scripts/lib/errors.mjs       # shared copy (byte-identical)
      scripts/lib/{spec,server,browser,ffmpeg}.mjs
      template/index.html  template/renderer.mjs  template/timeline.mjs
      test/*.test.mjs
  eval/
    run-eval.mjs  hosts.json  prompts/{dashboard,motion}.json  fixtures/
```

Nothing under `skills/` except skill folders, because the CI manifest check
requires a `SKILL.md` in every entry. `node_modules/` is gitignored. Vendor JS
(anime, vega, fonts) is read from `node_modules` at build or serve time and is
never committed.

## Shared validation contract

- `node scripts/validate.mjs <spec.json> [--json]`. Exit codes: `0` valid,
  `1` spec errors, `2` usage or unreadable file.
- Text output is one line per error, `<json.path>: <message>`, followed by a
  summary line. `--json` emits `{ ok, errors: [{ path, message }] }`.
- `errors.mjs` exports `formatAjvErrors(ajvErrors)`, `didYouMean(word, candidates)`
  and `printResult(result, { json })`. Did-you-mean (Levenshtein ≤ 2, or a shared
  prefix) applies to unknown properties, enum values and cross-references.
- Example: `charts[0].query: "rev_by_regin" not found; did you mean "rev_by_region"?`

## Dashboard skill

### Spec (`dashboard.json`)

```json
{
  "title": "Revenue by region",
  "description": "optional subtitle",
  "maxRows": 5000,
  "sources": {
    "sales": { "type": "parquet", "path": "data/sales.parquet" }
  },
  "queries": {
    "rev_by_region": "SELECT region, SUM(amount) AS revenue FROM sales GROUP BY 1 ORDER BY 2 DESC",
    "total": "SELECT SUM(amount) AS revenue FROM sales"
  },
  "kpis": [
    { "id": "k1", "title": "Total revenue", "query": "total", "field": "revenue", "format": "currency" }
  ],
  "charts": [
    { "id": "c1", "title": "Revenue by region", "query": "rev_by_region", "width": "half",
      "vegaLite": { "mark": "bar", "encoding": {
        "x": { "field": "region", "type": "nominal" },
        "y": { "field": "revenue", "type": "quantitative" } } } }
  ]
}
```

- `sources.<name>.type`: `csv | parquet | json | duckdb`. Phase 5 adds
  `sqlite | postgres | mysql`. File types take `path`, relative to the spec
  file. Postgres and MySQL take `env` (the name of an environment variable that
  holds the connection string) and never take a literal credential.
- Each file source becomes `CREATE VIEW <name> AS SELECT * FROM read_<type>_auto('<abs>')`.
  Database files are `ATTACH`ed `READ_ONLY` under their source name.
- `queries.<name>` is a SQL string. Names match `^[a-z][a-z0-9_]*$`.
- `kpis[].format`: `number | currency | percent | compact`. Optional.
- `charts[].vegaLite` is any Vega-Lite unit or layer spec **without** `data`
  (the build injects `data.values`). `width` is `full | half`, default `full`.
- `maxRows`: default 5000, range 1–100000, applied to every query.

### Validate

1. Ajv strict schema (`additionalProperties: false`, enums).
2. Cross-references: unique chart and KPI ids, every `query` exists, every
   source path exists.
3. SQL: each query parses as exactly one SELECT via `json_serialize_sql`.
4. Vega-Lite: `vegaLite` has no `data` key and compiles with `vega-lite`'s
   `compile()` against empty values.

### Build — `node scripts/build.mjs <spec.json> [--out dist]`

1. Validate. Abort on errors.
2. Open in-memory DuckDB, create the views and attachments, then lock down:
   allow only the declared source directories, disable external access, lock
   the configuration.
3. Run each query wrapped in `LIMIT maxRows`. Record row count, a
   `truncated` flag and the refresh timestamp.
4. Check every `encoding.*.field` and KPI `field` against the result columns,
   with did-you-mean on failure.
5. Write `dist/index.html`: one self-contained file with the vega,
   vega-lite and vega-embed UMD bundles inlined, the data in an escaped JSON
   block, and a light/dark theme. Every card has a `<details>` with the SQL, row
   count and refresh time. The header shows the overall refresh time. No LLM
   and no network are involved.

`serve.mjs` serves `dist/` on `127.0.0.1` and prints the URL (`--open` launches
a browser). `setup.mjs` pre-installs the DuckDB extensions the sources need so
later runs stay offline. `references/refresh.md` gives cron and launchd
snippets for scheduled rebuilds.

## Motion skill

### Spec (`motion.json`)

```json
{
  "size": [1920, 1080], "fps": 30, "background": "#0b0d12",
  "scenes": [
    { "id": "intro", "duration": 3, "transition": "fade",
      "elements": [
        { "id": "title", "type": "text", "text": "Q3 revenue up 18%",
          "x": 960, "y": 480, "fontSize": 96, "fontWeight": 700, "color": "#ffffff",
          "keyframes": [
            { "t": 0, "opacity": 0, "y": 520 },
            { "t": 0.6, "opacity": 1, "y": 480, "ease": "outCubic" } ] },
        { "id": "pct", "type": "counter", "from": 0, "to": 18, "suffix": "%",
          "x": 960, "y": 640, "fontSize": 140,
          "keyframes": [ { "t": 0.4, "value": 0 }, { "t": 2, "value": 18, "ease": "outQuad" } ] }
      ] }
  ]
}
```

- Root fields: `size` (default `[1920,1080]`, each side 16–3840), `fps` (24, 25,
  30 or 60), `background`, `scenes` (1–50). Total duration ≤ 120 s.
- Scene fields: `id`, `duration` (0.2–60 s), optional `background`, `transition`
  (`none | fade`, a 0.4 s fade-in), `elements`.
- Common element fields: `id` (unique across the whole spec), `type`, `x`, `y`
  (canvas pixels, anchor = element centre), `opacity`, `scale`, `rotate` (deg),
  `keyframes`.
- Element types:
  - `text`: `text`, `fontSize`, `fontWeight` (400–800), `color`, `align`,
    `maxWidth`, `font` (`sans | mono`).
  - `counter`: `from`, `to`, `decimals`, `prefix`, `suffix`, plus the text
    styling fields. The animatable `value` starts at `from`.
  - `shape`: `shape` (`rect | ellipse | line`), `width`, `height`, `radius`,
    `fill`, `stroke`, `strokeWidth`. A `line` is horizontal with length
    `width`; use `rotate` to angle it. Animatable `draw` (0–1) reveals the
    stroke.
  - `image`: `src` (path relative to the spec), `width`, `height`, `fit`.
  - `chart`: `vegaLite` with inline `data.values`, `width`, `height`.
    Animatable `reveal` (0–1) wipes the chart in left to right.
- `keyframes[]`: `t` (seconds within the scene, sorted, ≤ duration), optional
  `ease` (an enum of anime.js v4 names: `linear`, `in|out|inOut` ×
  `Quad|Cubic|Quart|Back|Elastic|Bounce|Sine|Expo|Circ`), and any of the
  animatable props: `opacity x y scale rotate draw reveal value`.
- Track semantics, per property: before the first keyframe that sets it, the
  value is that keyframe's value (or the element's base value if no keyframe
  sets it). Between keyframes it interpolates using the destination keyframe's
  `ease`. After the last keyframe it holds.

### Runtime

- `template/timeline.mjs` (pure, DOM-free, runs in Node for tests) compiles the
  spec into one paused anime.js timeline. The timeline animates one plain
  state object per element, and each scene starts at the sum of the previous
  durations. It exports `buildTimeline(spec) → { timeline, states, duration, sceneStarts }`.
- `template/renderer.mjs` builds the DOM: a fixed-size stage, one layer per
  scene, HTML for text and counters, SVG for shapes, Vega-Lite rendered to SVG
  once at load. On every seek it applies the states to the DOM. It exposes
  `window.__motion = { ready, duration, fps, seek(sec), sceneStarts }`.
  `ready` resolves after the fonts and charts have loaded.
- Fonts: Inter and JetBrains Mono (both OFL), served from `@fontsource` packages
  in `node_modules`.
- `preview.mjs <motion.json>`: a local server on 127.0.0.1 with a fit-to-window
  stage, a scrubber, play/pause, scene markers, and live reload (SSE) when the
  spec file changes.
- `render.mjs <motion.json> [--out out/video.mp4] [--fps] [--size WxH] [--contact-sheet]`:
  Playwright opens the page in render mode. For every frame it seeks to
  `i/fps`, takes a PNG screenshot and pipes it into `ffmpeg -f image2pipe … -c:v libx264 -pix_fmt yuv420p`.
  `--contact-sheet` writes one PNG per scene, taken at 85 % of its duration,
  to `out/contact/<scene-id>.png` instead of a video.
- ffmpeg lookup order: `$FFMPEG_PATH`, then `ffmpeg` on PATH, then an
  optionally installed `ffmpeg-static`. The binary is never vendored.

## Eval harness (`eval/`)

- `prompts/<skill>.json` holds 10 prompts per skill. Dashboard prompts use the
  fixture data in `eval/fixtures/`.
- `hosts.json` holds a command template per host: `claude`, `codex`,
  `codex-oss` (Ollama), `gemini` and `copilot`. Every host gets the same prompt
  preamble: "Read `skills/<skill>/SKILL.md` and follow it."
- `run-eval.mjs --skill dashboard --host claude [--limit n]` gives each prompt
  a fresh temp workdir containing the skill copy and fixtures, then runs the
  host. It scores: did the spec appear, does the final validate pass, how many
  times did validate run (counted through an `EVAL_LOG` env hook in
  `validate.mjs`), did build or contact-sheet succeed, and how long it took.
  It writes `eval/results/<date>-<host>-<skill>.json` plus a Markdown table.
  The visual check is done by a person, using the screenshots and contact
  sheets it saves.

## Testing

- `node --test` in each skill covers: errors and did-you-mean, schema
  acceptance and rejection for every example, the SQL guard, the lockdown,
  the data converter, HTML escaping, build end-to-end on fixtures, timeline
  sampling (seek → state values), and a render smoke test that skips itself
  when no browser or ffmpeg is present.
- CI gets a `node` job (setup-node 24): `npm ci` and `npm test` in both skills,
  plus the byte-identity check on `errors.mjs`. The render smoke test is skipped
  in CI because no browser is installed there.

## Phases (one or more commits each)

1. Plugin scaffold, shared `errors.mjs`, and CI node job.
2. Dashboard MVP: validate, build, serve, examples, SKILL.md.
3. Motion MVP: timeline, renderer, preview, render, contact sheet, charts in scenes, SKILL.md.
4. Eval harness, plus a smoke run on the hosts available here.
5. Extras: SQLite/Postgres/MySQL sources, `setup.mjs`, refresh docs.
6. Docs and inventory sweep, and the manual-test checklist.
