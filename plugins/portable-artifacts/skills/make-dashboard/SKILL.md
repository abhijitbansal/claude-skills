---
name: make-dashboard
description: Use when the user wants a dashboard, KPI page or charts built from local data files (CSV, Parquet, JSON, DuckDB, SQLite) or Postgres or MySQL, as one self-contained static HTML page whose charts show their SQL and refresh time. Works offline. Not for a single throwaway chart in a reply, or for a 3D view of data (make-scene).
argument-hint: what to build, e.g. "revenue by region and monthly trend from data/sales.csv"
---

# make-dashboard

You write one JSON spec (`dashboard.json`: sources, SQL queries, KPIs, charts as kinds or raw Vega-Lite).
Scripts validate it and build a single offline `index.html`. Every chart card shows its SQL,
row count and refresh time. No network, no LLM at build time.

## Director and operator

You are the director: you run the intake, write the spec, view what was built and decide every `creative` finding. A cheaper operator agent only runs the one command and fixes `mechanical` findings.

The command is `node <skill-dir>/scripts/make.mjs <spec> --json` (add `--out <path>` to name the output). It checks the spec, builds, checks the result and prints one report: `ok`, `output`, `stages`, `findings`. A `mechanical` finding names a JSON path to change and makes `ok` false. A `creative` finding is a call for you and never a failure.

Hand off with the first rung that works, unless you are already artifact-builder (then run the command, fix only `mechanical` findings, as your own instructions say, and do not hand off again):

1. Write the spec first. If `artifact-builder` is in your list of available agents (a plugin may list it as `<plugin>:artifact-builder`), start that agent with three things: this skill directory (the full path of the folder that holds this SKILL.md), the spec path (the file already exists) and, optionally, the output path. It has no memory of this conversation and needs nothing else. Do not choose a model for it: its own file names one.
2. No such agent, or it fails or cannot start: run the same command yourself.

Trust the report and the output file, never the operator's prose. You take over (fix it yourself and rerun) when the same `mechanical` finding survives two operator attempts, or when its path is empty (the operator may change nothing).

Before you report, view what was built: the files listed under `sheets` in the report (make-motion), or the page through `node <skill-dir>/shared/shot.mjs <output>` when that file exists, then open each PNG it prints. Fix what you see and decide each `creative` finding.

## Before the first build

`<skill-dir>` is the folder containing this SKILL.md. Run `node <skill-dir>/scripts/doctor.mjs --json` (add `--for check` before `check.mjs`; `--for <spec.json>` is accepted and checks nothing extra here). It needs only Node.

If it reports anything missing, tell the user in one message: each item, why it is needed, its size and the command, plus every `notes` and `info` entry from the output (they disclose downloads and the files an install writes). Ask once per set of missing items (the plain run and a later `--for` run may each find new ones). On yes, run `node <skill-dir>/scripts/doctor.mjs --fix <ids>` with the ids it reported, and the same `--for` you diagnosed with (for example `--fix <ids> --for check`). Hand the user the exact command to run themselves for anything the doctor reports as refused (it needs sudo, or has no automatic fix), skipped (needs node_modules first), installed elsewhere, still missing, or failed; in Claude Code suggest prefixing it with `!`. On no, do what you can without it and give the user the remaining commands.

## Running the commands

- Run one plain command per call, with literal absolute paths: write `<skill-dir>` out in full, never through a shell variable.
- No heredocs, no sed -i and no inline scripts: write specs and other files with your file-writing tool. If that tool fails, say so; do not work around it with a shell script.
- No cd, no && or ; chains, no shell variables and no pipes. Run from the project folder, and do not follow a command with an echo of its exit code.
- A command prints its own verdict (`valid`, `wrote <path>`, `check: skipped`). That output is the result; the exit codes listed for each script are for reference.

## Workflow

Run every step yourself, in this same turn, with your shell or file tools. Do not end your reply after showing or describing the JSON: keep going until validate prints `valid` and the output file exists. The one command is `make.mjs` (see Director and operator); `validate.mjs` and `build.mjs` below remain for stepwise work.

Run every command from the project folder
(where `dashboard.json` lives), using the full path to the scripts.

If the request is empty, ask what to build and from which data file(s).

1. Look at the data first. Never guess columns:
   `node <skill-dir>/scripts/inspect.mjs data/sales.csv` (column names, types, 5 sample rows and, per column, the distinct count, min, max and null share; csv, parquet or json).
   For an attached source in a spec (duckdb, sqlite, postgres, mysql) list its tables, then look at one:
   `node <skill-dir>/scripts/inspect.mjs --spec dashboard.json --source shop` and `... --source shop --table items`.
2. Write `dashboard.json` next to the data. Source paths are relative to the spec file and must stay
   inside the spec's folder.
   Rows that exist only in the conversation (pasted or computed) go into a CSV file first, then into `sources`.
   Actually create the file: describing it or announcing a patch is not enough. Confirm the file exists before validating. If your file tool fails, say so and give the user the JSON and the path; do not work around it with a shell script.
3. Validate and fix until it prints `valid`. It runs every query and expands every chart as build does, so a slice cap, a colour cap or a bad value shows here; `--bind-only` only binds each query (faster) and skips those checks:
   `node <skill-dir>/scripts/validate.mjs dashboard.json`
4. See the rows before you write a finding title. `node <skill-dir>/scripts/query.mjs dashboard.json --chart c1` prints that chart's rows (the first 20; `--limit n`, `--json`), run exactly as build runs them. A title states what those rows show, so set or fix each title after you have read them. A dashboard rebuilt on a schedule keeps its titles on every refresh: give it neutral titles (`references/refresh.md`).
5. Set `generatedBy` in the spec with the keys `model`, `effort` and `agent` (your host; `host` is accepted as an alias of `agent`), for example `"generatedBy": { "model": "claude-opus-5-5", "effort": "low", "agent": "Claude Code" }`. Never guess; leave out any key you do not know. `--model`, `--effort` and `--agent` on the build override it. A `serve.mjs --watch` rebuild reads it from the spec and does not get the flags, so the spec is where it must live. Build: `node <skill-dir>/scripts/build.mjs dashboard.json` (writes `dist/index.html`, `--out <dir>` to change; `--theme <name>` overrides the theme) and prints the page path, then its `file://` URL on a line of its own.
   An error such as `charts[0].y: "revnue" is not a column of query "by_region" (columns: region, revenue); did you mean "revenue"?`
   names the exact path and fix.
6. Look at it. First run `node <skill-dir>/scripts/doctor.mjs --json --for check`, then `node <skill-dir>/scripts/check.mjs dist --shots shots`. It opens the page at 1280 and 390 px in light and dark, waits for every chart and fails on a console or page error, a chart error, a chart that drew nothing or horizontal scroll. `--shots shots` also writes one PNG per width and colour scheme into the `shots` folder and prints each path: view every PNG before you report, and fix what you see. It needs Playwright and a browser (`doctor --for check` reports and installs them, after the user agrees). Without them it prints `check: skipped` and exits 0: a skipped check is not a pass.
7. Show it. Point the user at `dist/index.html`: it is one file, so opening it directly is enough. Start `node <skill-dir>/scripts/serve.mjs --watch dashboard.json --open` only when the user wants live updates while editing (rebuilds on save; Postgres/MySQL: add `--interval 60`; `--out <dir>` works with it). It never exits on its own: run it in the background, and stop it when you are done. `--open` without a browser opener just keeps serving.
8. To change anything, edit **only `dashboard.json`**, then rerun steps 3 and 5. Never edit `dist/`.
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
  Optional `kpis[].trend`: `{ "query": "by_month", "field": "revenue" }` names a declared query (never SQL) and draws a small line of that column under the tile's value, in query order.
- `charts[].width`: `full` (default) or `half`. Each chart has exactly one of `kind` or `vegaLite`.
- `kind`: `bar | stacked-bar | grouped-bar | line | area | scatter | bubble | heatmap | histogram | boxplot | donut`.
  Name columns by role (`x`, `y`, `color`, `size`, `value`); the build makes the chart, tooltips, alternate views, a sortable Table view and PNG/SVG/CSV export.
  Raw `vegaLite` (any Vega-Lite spec **without `data`**) still works for anything the kinds don't cover.
- Chart titles state the finding ("North drives half of revenue"), not the field names: the title is set large, as the chart's claim.
- `views` picks alternate views (e.g. `["sorted", "table"]`); `pair: true` puts the primary view and a second (switchable) view side by side. Order follows the query, so write `ORDER BY`.
- `theme`: `paper` (default), `blueprint`, `editorial`, `ink`, `dusk`, `press`, `poster`, `mono`, `brief`. Never set colours, `config`, `width` or `autosize` in `vegaLite`.
- Theme by purpose: `paper` (the default here) is clean and neutral, `blueprint` is technical, `dusk` is warm and soft, `press` is print editorial for dense reads, `poster` is loud and condensed for launches and demos, `mono` is a terminal console, `brief` is calm and executive, `ink` and `editorial` are the older looks. A theme the user names wins; otherwise keep `paper` unless the page is for a launch or pitch (`poster`), a dense read (`press`) or a sign-off (`brief`).
- Full kind reference (roles, views, rules, errors): `references/kinds.md`.
- Raw `vegaLite` dates are UTC strings: use `"type": "temporal"` with `utc…` time units (`utcyearmonth`).
- Aim for few, clear charts: bar for magnitude, line for change over time, colour only for a real category (max 8).
- Field list and rules: `references/schema.md`. Working examples: `references/examples/`.

## Degraded mode

If you cannot run shell commands, write `dashboard.json` and give the user the exact commands from steps 3 to 7 to run (with the real `<skill-dir>` path).

When done, report the spec path, the built `index.html` path, the check result as one word (passed, failed or skipped), the serve URL if you started a server, and one line per chart. Offer once to lift a chart into a 3D scene with make-scene (a `lift` with `dashboard` and `chart`).

Sharing: `dist/index.html` is one file you can send as is. The page embeds the query results, so do not publish it, or send it to anyone, if the data is private. If your host can publish a page to a link, publish that single file.

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
