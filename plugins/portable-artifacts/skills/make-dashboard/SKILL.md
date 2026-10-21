---
name: make-dashboard
description: Use when the user wants a dashboard, KPI page or charts built from local data files (CSV, Parquet, JSON, DuckDB, SQLite) or Postgres/MySQL as a self-contained static HTML page whose charts show their SQL and refresh time; works offline with any agent that can run shell commands.
argument-hint: what to build, e.g. "revenue by region and monthly trend from data/sales.csv"
model: haiku
effort: low
---

# make-dashboard

You write one JSON spec (`dashboard.json`: sources, SQL queries, KPIs, charts as kinds or raw Vega-Lite).
Scripts validate it and build a single offline `index.html`. Every chart card shows its SQL,
row count and refresh time. No network, no LLM at build time.

## Cheaper model

Skip this section if you are running in Claude Code (it already runs this skill on the model named in the frontmatter), or if `artifact-builder` is not in your list of available agents. Otherwise, if you can start another agent, start the `artifact-builder` agent to do the work, unless you are already artifact-builder. If you are already artifact-builder, skip the rest of this section and do the work yourself.

Give it a self-contained brief. It has no memory of this conversation, so the brief must say:

1. What to build, and every fact and choice from this conversation that affects it (data, names, wording, theme, what the user asked for and what they ruled out).
2. This skill directory: the full path of the folder that holds this SKILL.md.
3. The spec path: where it should write the JSON spec.
4. Optionally, an output folder for the build (it passes this to the build script as `--out`).

Relay only the output path it returns. Do not repeat its work.

If the `artifact-builder` agent is not installed, or you cannot start another agent, continue with the steps below yourself.

## Before the first build

`<skill-dir>` is the folder containing this SKILL.md. Run `node <skill-dir>/scripts/doctor.mjs --json` (add `--for <spec.json>` once the spec exists, `--for voiceover` for a voiceover (make-motion), `--for check` before `check.mjs` (skills that have one)). It needs only Node.

If it reports anything missing, tell the user in one message: each item, why it is needed, its size and the command, plus every `notes` and `info` entry from the output (they disclose downloads and the files an install writes). Ask once per set of missing items (the plain run and a later `--for` run may each find new ones). On yes, run `node <skill-dir>/scripts/doctor.mjs --fix <ids>` with the ids it reported, and the same `--for` you diagnosed with (for example `--fix <ids> --for check`). Hand the user the exact command to run themselves for anything the doctor reports as refused (it needs sudo, or has no automatic fix), skipped (needs node_modules first), installed elsewhere, still missing, or failed; in Claude Code suggest prefixing it with `!`. On no, do what you can without it and give the user the remaining commands.

## Workflow

Run every step yourself, in this same turn, with your shell or file tools. Do not end your reply after showing or describing the JSON: keep going until validate prints `valid` and the output file exists.

Run every command from the project folder
(where `dashboard.json` lives), using the full path to the scripts.

If the request is empty, ask what to build and from which data file(s).

1. Look at the data first. Never guess columns:
   `node <skill-dir>/scripts/inspect.mjs data/sales.csv` (column names, types, 5 sample rows; csv, parquet or json).
   For an attached source in a spec (duckdb, sqlite, postgres, mysql) list its tables, then look at one:
   `node <skill-dir>/scripts/inspect.mjs --spec dashboard.json --source shop` and `... --source shop --table items`.
2. Write `dashboard.json` next to the data. Source paths are relative to the spec file and must stay
   inside the spec's folder.
   Actually create the file: describing it or announcing a patch is not enough. If your file tool fails, write it with a short `node -e` script that calls `fs.writeFileSync`, then confirm the file exists before validating.
3. Validate and fix until it prints `valid` (it also runs every query, so valid means buildable):
   `node <skill-dir>/scripts/validate.mjs dashboard.json`
4. Write `generatedBy` into `dashboard.json`: the model you are running as, your effort level if you know it, and your host (for example Claude Code, Codex, Copilot CLI, Gemini CLI). Never guess; leave out any field you do not know. A `serve.mjs --watch` rebuild reads it from the spec and does not get the flags, so the spec is where it must live. `--model`, `--effort` and `--agent` on the build override it for a one-off build. Build: `node <skill-dir>/scripts/build.mjs dashboard.json` (writes `dist/index.html`, `--out <dir>` to change).
   An error such as `charts[0].y: "revnue" is not a column of query "by_region" (columns: region, revenue); did you mean "revenue"?`
   names the exact path and fix.
5. Show it. For live updates while editing the spec or data:
   `node <skill-dir>/scripts/serve.mjs --watch dashboard.json --open` (rebuilds on save; Postgres/MySQL: add `--interval 60`).
   Or run the `serve:` line that build printed, or open `dist/index.html` directly: it is one file.
6. To change anything, edit **only `dashboard.json`**, then rerun steps 3 and 4. Never edit `dist/`.
   A refresh is just a rebuild; for scheduled rebuilds see `references/refresh.md`.

Data outside the spec's folder is refused. Do not work around that: move or copy the data under the
spec folder. Only the person running the commands may add `--allow-outside` to validate/build.
Queries have a 30 s limit (`--timeout <seconds>` on build).

## Spec shape

```json
{
  "title": "Sales", "description": "optional", "maxRows": 5000,
  "sources": { "sales": { "type": "parquet", "path": "data/sales.parquet" } },
  "queries": {
    "total": "SELECT SUM(amount) AS revenue FROM sales",
    "by_region": "SELECT region, SUM(amount) AS revenue FROM sales GROUP BY 1 ORDER BY 2 DESC",
    "by_month": "SELECT date_trunc('month', date) AS month, region, SUM(amount) AS revenue FROM sales GROUP BY 1, 2 ORDER BY 1"
  },
  "kpis": [ { "id": "k1", "title": "Revenue", "query": "total", "field": "revenue", "format": "currency" } ],
  "charts": [
    { "id": "c1", "title": "North drives half of revenue", "query": "by_region", "width": "half",
      "kind": "bar", "x": "region", "y": "revenue", "format": "currency" },
    { "id": "c2", "title": "Revenue up 18% since March", "query": "by_month",
      "kind": "line", "x": "month", "y": "revenue", "color": "region" }
  ]
}
```

- `sources.type`: `csv | parquet | json` (a table named after the key), `duckdb | sqlite` (attached; query `name.table`, `path`),
  `postgres | mysql` (attached; `"env": "PG_URL"` names the variable holding the connection string, never put it in the spec).
  sqlite/postgres/mysql need a one-time `node <skill-dir>/scripts/setup.mjs dashboard.json` (online; builds stay offline).
- `queries`: one SELECT each, names `[a-z][a-z0-9_]*`. Alias every aggregate (`AS revenue`); chart fields are those aliases.
- `kpis[].format`: `number | currency | percent | compact` (percent expects a fraction).
- `charts[].width`: `full` (default) or `half`. Each chart has exactly one of `kind` or `vegaLite`.
- `kind`: `bar | stacked-bar | grouped-bar | line | area | scatter | bubble | heatmap | histogram | boxplot | donut`.
  Name columns by role (`x`, `y`, `color`, `size`, `value`); the build makes the chart, tooltips, alternate views, a sortable Table view and PNG/SVG/CSV export.
  Raw `vegaLite` (any Vega-Lite spec **without `data`**) still works for anything the kinds don't cover.
- Chart titles state the finding ("North drives half of revenue"), not the field names.
- `views` picks alternate views (e.g. `["sorted", "table"]`); `pair: true` puts the primary view and a second (switchable) view side by side. Order follows the query, so write `ORDER BY`.
- `theme`: `paper` (default), `blueprint`, `editorial`, `ink`, `dusk`, `press`, `poster`. Never set colours, `config`, `width` or `autosize` in `vegaLite`.
- Full kind reference (roles, views, rules, errors): `references/kinds.md`.
- Raw `vegaLite` dates are UTC strings: use `"type": "temporal"` with `utc…` time units (`utcyearmonth`).
- Aim for few, clear charts: bar for magnitude, line for change over time, colour only for a real category (max 8).
- Field list and rules: `references/schema.md`. Working examples: `references/examples/`.

## Degraded mode

If you cannot run shell commands, write `dashboard.json` and give the user the exact commands from steps 3, 4 and 5 to run (with the real `<skill-dir>` path).

When done, report the spec path, the built `index.html` path, the serve URL and one line per chart. Remind the user that the page embeds the query results: do not publish it if the data is private.

## Security

The SQL is written by a model, so it is untrusted. Each query must parse as one SELECT, and then an
allowlist runs over its syntax tree (nesting, CTEs, subqueries and string constants cannot hide anything):
it may read only the declared sources (`name`, `source.table`, `source.schema.table`) and its own CTEs, and the
only table functions allowed are `range`, `generate_series` and `unnest`. System catalogs (`pg_catalog`,
`information_schema`, `duckdb_*` views) and functions that read settings, the environment or files are rejected.
It then runs in DuckDB locked to the declared files. Attached DuckDB files that define views or macros are refused.
Titles, SQL and data are escaped in the page. Keep credentials out of specs and data paths.
Do not point `path` at files the user did not mention. Charts can never load URLs
(`url`, `data`, `usermeta` are rejected anywhere in `vegaLite`) and the page ships a strict CSP.
The SQL allowlist is the control; the cell/error scrubber is only defence in depth.
Each known bypass vector and the test that pins it is in `references/sql-sandbox.md`.
The allowlist is the query control; offline is guaranteed by the locked DuckDB
connection and the page's `default-src 'none'` CSP, not by the validator.
`serve.mjs` binds 127.0.0.1 and refuses non-local Host headers (403).
Watch mode serves a copy with `connect-src 'self'` for the event stream; the built file on disk keeps `default-src 'none'`.
For postgres/mysql, `READ_ONLY` on the attach only limits DuckDB: the real guard is a read-only database role.
