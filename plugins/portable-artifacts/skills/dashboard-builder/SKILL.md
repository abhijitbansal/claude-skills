---
name: dashboard-builder
description: Use when the user wants a dashboard, KPI page or charts built from local data files (CSV, Parquet, JSON, DuckDB) as a self-contained static HTML page whose charts show their SQL and refresh time; works offline with any agent that can run shell commands.
---

# dashboard-builder

You write one JSON spec (`dashboard.json`: sources, SQL queries, KPIs, Vega-Lite charts).
Scripts validate it and build a single offline `index.html`. Every chart card shows its SQL,
row count and refresh time. No network, no LLM at build time.

## Workflow

`<skill-dir>` is the folder that contains this SKILL.md. Run every command from the project folder
(where `dashboard.json` lives), using the full path to the scripts. One-time: `npm ci` in `<skill-dir>`.

1. Look at the data first. Never guess columns:
   `node <skill-dir>/scripts/inspect.mjs data/sales.csv` (column names, types, 5 sample rows; csv, parquet or json).
2. Write `dashboard.json` next to the data. Source paths are relative to the spec file and must stay
   inside the spec's folder.
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

## Security

Queries are checked to be a single SELECT, then run in DuckDB locked to the declared files only.
Titles, SQL and data are escaped in the page. Keep credentials out of specs and data paths.
Do not point `path` at files the user did not mention. Charts can never load URLs
(`url`, `data`, `usermeta` are rejected anywhere in `vegaLite`) and the page ships a strict CSP.
