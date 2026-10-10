---
name: make-dashboard
description: Use when the user wants a dashboard, KPI page or charts built from local data files (CSV, Parquet, JSON, DuckDB, SQLite) or Postgres/MySQL as a self-contained static HTML page whose charts show their SQL and refresh time; works offline with any agent that can run shell commands.
argument-hint: what to build, e.g. "revenue by region and monthly trend from data/sales.csv"
---

# make-dashboard

You write one JSON spec (`dashboard.json`: sources, SQL queries, KPIs, Vega-Lite charts).
Scripts validate it and build a single offline `index.html`. Every chart card shows its SQL,
row count and refresh time. No network, no LLM at build time.

## Workflow

`<skill-dir>` is the folder that contains this SKILL.md. Run every command from the project folder
(where `dashboard.json` lives), using the full path to the scripts.

First use: if `<skill-dir>/node_modules` is missing, tell the user it is a one-time local install and run
`npm ci --prefix <skill-dir>`. If the request is empty, ask what to build and from which data file(s).

1. Look at the data first. Never guess columns:
   `node <skill-dir>/scripts/inspect.mjs data/sales.csv` (column names, types, 5 sample rows; csv, parquet or json).
   For an attached source in a spec (duckdb, sqlite, postgres, mysql) list its tables, then look at one:
   `node <skill-dir>/scripts/inspect.mjs --spec dashboard.json --source shop` and `... --source shop --table items`.
2. Write `dashboard.json` next to the data. Source paths are relative to the spec file and must stay
   inside the spec's folder.
   Actually create the file: describing it or announcing a patch is not enough. If your file tool fails, write it from the shell (`cat > dashboard.json <<'EOF'` … `EOF`), then `ls dashboard.json` to confirm it exists before validating.
3. Validate and fix until it prints `valid` (it also runs every query, so valid means buildable):
   `node <skill-dir>/scripts/validate.mjs dashboard.json`
4. Build: `node <skill-dir>/scripts/build.mjs dashboard.json` (writes `dist/index.html`, `--out <dir>` to change).
   An error such as `charts[0].vegaLite.encoding.y.field: "revnue" is not a column of query ...`
   names the exact path and fix.
5. Show it: run the `serve:` line that build printed (it already has the right paths).
   Or open `dist/index.html` directly: it is one file.
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
    "by_region": "SELECT region, SUM(amount) AS revenue FROM sales GROUP BY 1 ORDER BY 2 DESC"
  },
  "kpis": [ { "id": "k1", "title": "Revenue", "query": "total", "field": "revenue", "format": "currency" } ],
  "charts": [ { "id": "c1", "title": "Revenue by region", "query": "by_region", "width": "half",
    "vegaLite": { "mark": "bar", "encoding": {
      "x": { "field": "region", "type": "nominal", "sort": null },
      "y": { "field": "revenue", "type": "quantitative" } } } } ]
}
```

- `sources.type`: `csv | parquet | json` (a table named after the key), `duckdb | sqlite` (attached; query `name.table`, `path`),
  `postgres | mysql` (attached; `"env": "PG_URL"` names the variable holding the connection string, never put it in the spec).
  sqlite/postgres/mysql need a one-time `node <skill-dir>/scripts/setup.mjs dashboard.json` (online; builds stay offline).
- `queries`: one SELECT each, names `[a-z][a-z0-9_]*`. Alias every aggregate (`AS revenue`); chart fields are those aliases.
- `kpis[].format`: `number | currency | percent | compact` (percent expects a fraction).
- `charts[].width`: `full` (default) or `half`. `vegaLite`: any Vega-Lite spec **without `data`**.
- Do not set colours, `config`, `width` or `autosize` in `vegaLite`: the page applies the palette and light/dark theme.
- Dates are UTC strings: use `"type": "temporal"` with `utc…` time units (`utcyearmonth`).
- Aim for few, clear charts: bar for magnitude, line for change over time, colour only for a real category (max 8).
- Full field list and rules: `references/schema.md`. Working examples: `references/examples/`.

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
For postgres/mysql, `READ_ONLY` on the attach only limits DuckDB: the real guard is a read-only database role.
