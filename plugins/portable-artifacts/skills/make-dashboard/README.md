# make-dashboard

**Prompt → SQL + Vega-Lite → one static HTML dashboard where every chart shows
its SQL and when it was refreshed.** Local, offline, open source, and usable
by any agent that can run shell commands.

<img src="../../../../docs/features/img/portable-artifacts/dashboard-light.jpg" alt="Dashboard with KPI tiles, bar, line and stacked charts; each card has a Query disclosure" width="100%">

- **One spec, `dashboard.json`**: data sources, named SQL queries, KPI tiles and
  Vega-Lite charts. The agent writes it; scripts do the rest.
- **One output file, `dist/index.html`**: charts, data and libraries are all
  inlined. It opens from disk, needs no server and loads nothing from the
  network.
- **Provenance on every card**: expand *Query* to see the SQL, the row count,
  the refresh time and the first rows of the result.
- **Refresh is a rebuild**: rerun `build.mjs` (from cron, launchd or by hand).
  No LLM is involved.

> Agents: the instructions you follow are in [`SKILL.md`](SKILL.md). This
> README is for people.

## Quick start

```bash
cd make-dashboard && npm ci && cd -        # one-time, inside the skill folder

SKILL=path/to/make-dashboard
node $SKILL/scripts/inspect.mjs data/sales.csv          # columns, types, 5 sample rows
# … write dashboard.json (or let your agent write it) …
node $SKILL/scripts/validate.mjs dashboard.json         # prints `valid`, or path-precise errors
node $SKILL/scripts/build.mjs dashboard.json            # writes dist/index.html
node $SKILL/scripts/serve.mjs dist --open               # or just open dist/index.html
```

From an agent, just ask: *"Build a dashboard of revenue by region and the
monthly trend from data/sales.csv."* In Claude Code or Copilot you can call
`/make-dashboard …`, and in Codex `$make-dashboard …`.

## The spec

```json
{
  "title": "Sales overview",
  "sources": { "sales": { "type": "csv", "path": "data/sales.csv" } },
  "queries": {
    "total": "SELECT SUM(amount) AS revenue FROM sales",
    "by_region": "SELECT region, SUM(amount) AS revenue FROM sales GROUP BY 1 ORDER BY 2 DESC"
  },
  "kpis": [
    { "id": "k1", "title": "Total revenue", "query": "total", "field": "revenue", "format": "currency" }
  ],
  "charts": [
    { "id": "c1", "title": "Revenue by region", "query": "by_region", "width": "half",
      "vegaLite": { "mark": "bar", "encoding": {
        "x": { "field": "region", "type": "nominal", "sort": null },
        "y": { "field": "revenue", "type": "quantitative" } } } }
  ]
}
```

| Field | What it holds |
|---|---|
| `sources` | `csv`, `parquet`, `json` files (each becomes a table named after its key); `duckdb`, `sqlite` database files; `postgres`, `mysql` via `"env": "VAR"` naming an environment variable with the connection string |
| `queries` | One SQL `SELECT` per name. Alias every aggregate; chart fields are those aliases |
| `kpis` | Number tiles: `query`, `field`, `format` = `number`, `currency`, `percent` or `compact` |
| `charts` | Any Vega-Lite spec **without `data`**. The build injects the query result. `width` = `full` or `half` |
| `maxRows` | Row cap applied to every query (default 5000, max 100000) |

The full reference is in [`references/schema.md`](references/schema.md), and
there are working specs in [`references/examples/`](references/examples/).

## Scripts

| Command | Does | Flags |
|---|---|---|
| `inspect.mjs <file>` | Column names, types and 5 sample rows of a csv/parquet/json file | `--type`, `--json`, `--allow-outside` |
| `validate.mjs <spec>` | Schema, references, SQL guard; binds every query against the real data and compiles every chart. `valid` means buildable | `--json`, `--timeout <s>`, `--allow-outside` |
| `build.mjs <spec>` | Runs the queries and writes `dist/index.html` (next to the spec). Prints the exact `serve:` command | `--out <dir>`, `--timeout <s>` (default 30), `--allow-outside`, `--json` |
| `serve.mjs [dir]` | Serves the built page on `127.0.0.1` | `--port <n>`, `--open` |
| `setup.mjs [spec]` | One-time `INSTALL` of the DuckDB extensions for sqlite/postgres/mysql, so builds stay offline | — |

Exit codes for every script: `0` OK, `1` spec errors, `2` usage or IO error.
Errors name the JSON path and suggest the fix:

```
charts[0].query: "rev_by_regin" not found; did you mean "rev_by_region"?
charts[0].vegaLite.encoding.y.field: "revnue" is not a column of query "rev_by_region" (columns: region, revenue); did you mean "revenue"?
sources.sales.path: resolves outside the spec folder (/etc/passwd); move the data under /proj or pass --allow-outside
```

## Scheduled refresh

[`references/refresh.md`](references/refresh.md) has a crontab line and a
launchd plist that rebuild the page on a schedule. For Postgres or MySQL
sources, the connection-string variable must be set in that environment.

## Security

The agent writes the SQL, so it is treated as untrusted:

- Every query must parse with DuckDB's own parser as a single SELECT, and then
  an **allowlist** runs over its syntax tree. It may read only the declared
  sources (`name`, `source.table`, `source.schema.table`) and CTEs defined in
  the same query. The only table functions allowed are `range`,
  `generate_series` and `unnest`, so `query()`, `read_*`, `glob`, `duckdb_*()`,
  `sqlite_*`/`postgres_*`/`mysql_*` and `pragma_*` are all rejected. System
  catalogs (`pg_catalog`, `information_schema`) and functions that read
  settings or the environment (`current_setting`, `getenv`) are rejected too.
  Scalar and aggregate functions are otherwise open (a denylist), because they
  cannot read files.
- Queries run on a connection locked to the exact declared files
  (`allowed_paths`, external access off, configuration locked). Each one is
  wrapped in a row limit and stopped after a timeout.
- An attached DuckDB file that defines views or macros is refused: they would
  run outside the allowlist. Export plain tables instead.
- Sources must resolve to regular files inside the spec's folder.
  `--allow-outside` is a flag only the person running the command can add.
  The spec can't add it.
- Database sources attach `READ_ONLY`, which limits DuckDB only. For Postgres
  and MySQL, **use a read-only database role**: that is the real guard, because
  statements are passed through to the server. Connection strings are read from
  environment variables and scrubbed from error messages. Result cells are
  scrubbed for them too, but that is defence in depth only: the guard above is
  the control that keeps secrets out of result rows.
- Charts can't load anything: `url`, `data` and `usermeta` are rejected
  anywhere in `vegaLite`. The page runs under a CSP without `unsafe-eval`
  (Vega's AST interpreter is used) and with chart actions disabled.
- **The built page contains the query results.** Sharing it shares the data.

## Requirements and licences

Node.js ≥ 20. The dependencies, pinned by the lockfile, are DuckDB (MIT),
Vega, Vega-Lite and vega-embed (BSD-3-Clause), and Ajv (MIT).
