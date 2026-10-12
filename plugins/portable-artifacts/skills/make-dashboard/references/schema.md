# dashboard.json reference

Authoritative schema: `SCHEMA` in `scripts/lib/spec.mjs`. Unknown properties are errors.

```json
{
  "title": "Revenue by region",
  "description": "optional subtitle",
  "maxRows": 5000,
  "theme": "paper",
  "sources": { "sales": { "type": "parquet", "path": "data/sales.parquet" } },
  "queries": { "rev_by_region": "SELECT region, SUM(amount) AS revenue FROM sales GROUP BY 1" },
  "kpis":   [ { "id": "k1", "title": "Total", "query": "total", "field": "revenue", "format": "currency" } ],
  "charts": [ { "id": "c1", "title": "North drives half of revenue", "query": "rev_by_region", "width": "half",
                "kind": "bar", "x": "region", "y": "revenue", "format": "currency" } ]
}
```

## Fields

| Field | Rule |
|---|---|
| `title` | required string |
| `description` | optional subtitle |
| `theme` | optional: `paper` (default), `blueprint`, `editorial`, `ink`. `build.mjs --theme <name>` and `serve.mjs --watch --theme <name>` override it. An unknown name fails with did-you-mean. The page also has a "Theme: Auto / Light / Dark" toggle |
| `maxRows` | integer 1–100000, default 5000; applied to every query. Longer results are cut and the card says "truncated at N" |
| `sources.<name>` | `name` matches `^[a-z][a-z0-9_]*$` and is not `main`, `temp` or `system` (DuckDB catalogs). `type`: `csv`, `parquet`, `json`, `duckdb`, `sqlite` (take `path`) or `postgres`, `mysql` (take `env`, never `path`). `path` is relative to the **spec file**, not the cwd, and must resolve (symlinks followed) to a regular file inside the spec's folder. Only `--allow-outside` on validate/build lifts the folder rule; it is deliberately not a spec field |
| `queries.<name>` | one SQL `SELECT` (CTEs and UNIONs fine). Each source name is a table/view in the query. No other statement types |
| `kpis[]` | `id`, `title`, `query`, `field` required. Shows the first row's `field`. `format`: `number`, `currency` (USD), `percent` (value is a fraction: 0.25 → 25%), `compact` |
| `charts[]` | `id`, `title`, `query` required, plus **exactly one of `kind` or `vegaLite`**. `width`: `full` (default) or `half` (two columns from 900px). See "Chart fields" below |

`id` values are unique across charts and KPIs and match `^[A-Za-z][A-Za-z0-9_-]*$`.

## Chart fields

| Field | Applies to | Rule |
|---|---|---|
| `kind` | kind charts | `bar`, `stacked-bar`, `grouped-bar`, `line`, `area`, `scatter`, `bubble`, `heatmap`, `histogram`, `boxplot`, `donut`. Roles, views and rules per kind: `kinds.md` |
| `x`, `y`, `color`, `size`, `value` | kind charts | Column names of the chart's query. Which are required, optional or unused depends on the kind; each must be a real column of an accepted type (checked at validate) |
| `format` | kind charts | `number`, `currency`, `percent`, `compact`; formats the numeric axis |
| `views` | kind charts | Alternate view names for the kind (e.g. `["sorted", "table"]`), at most 6, unique. Narrows and reorders the defaults; `table` is always available and last |
| `pair` | kind charts | `true` shows the first two views side by side and forces `width: full` |
| `vegaLite` | raw charts | A Vega-Lite spec without `data` (next section) |

Exactly one of `kind` / `vegaLite` per chart. `x`, `y`, `color`, `size`, `value`, `views`, `format` and `pair` on a raw `vegaLite` chart are errors
(`<key> needs kind (raw vegaLite charts ignore it)`). Every kind chart also gets tooltips, a sortable Table view (first 500 rows shown)
and an Export menu: PNG and SVG (filled with the theme surface) and CSV (all embedded rows; formula-like text, starting with `=`, `+`, `-`, `@`, tab or CR, is prefixed with `'`).
A query with zero rows shows "No rows returned" and still offers the Table view.

## Source types

- `csv`, `json`: `read_csv_auto` / `read_json_auto` view named after the source.
- `parquet`: `read_parquet` view.
- `duckdb`, `sqlite`: the file is attached read-only under the source name; query `name.table`
  (`SELECT item FROM shop.items`). `sqlite` follows the same folder and regular-file rules as `path` sources.
- `postgres`, `mysql`: `"env": "PG_URL"` names an environment variable that holds the connection string
  (`postgres://user:pass@host:5432/db`, or `host=… user=… password=… dbname=…`; MySQL uses `host=… user=… password=… database=…`).
  It is attached read-only under the source name; query `name.table`, or `name.schema.table` for postgres.
  `env` must match `^[A-Z_][A-Z0-9_]*$`. Credentials never go in the spec. An unset or empty variable is an error
  at validate and at build (`sources.db.env: environment variable PG_URL is not set`).
  The connection string is scrubbed from every error message, and it never reaches the page, the SQL shown or EVAL_LOG.

### Extensions (sqlite, postgres, mysql)

These sources need a DuckDB extension. Run once, while online: `node <skill-dir>/scripts/setup.mjs [spec.json]`
(only what the spec needs; all three without a spec). It prints the extension directory. Builds only `LOAD` from that
cache: autoinstall and autoload are switched off, so nothing is downloaded silently. A missing extension fails with
`run: node "<skill-dir>/scripts/setup.mjs"`. `DUCKDB_EXTENSION_DIRECTORY` points setup and builds at another cache folder.

Lockdown still applies after attaching: an attached sqlite file stays queryable under `enable_external_access=false` and
`allowed_paths` (tested). The extensions' own bridge functions (`sqlite_scan`, `postgres_query`, `mysql_scan`, …) open files
and connections outside that lockdown, so the SQL allowlist rejects them (see "SQL rules").
Postgres and MySQL are attached before the lock; they were not run against a live server in the tests.
**For postgres and mysql, use a read-only database role.** `READ_ONLY` on the ATTACH limits what DuckDB itself does; it is not
a guarantee about what the server executes for the statements DuckDB passes through.
An attached `duckdb` file may not define views or macros (they would run outside the allowlist); the source is refused
with their names. Export plain tables instead.

## vegaLite (raw charts)

Any Vega-Lite 6 unit, layer or concat spec **without `data`**. Use it for what the kinds do not cover. The build injects the query rows. Rules:

- Every `encoding.*.field` must be a column of the chart's query, or a field produced by a `transform` (`as`).
  Column names come from the SQL, so alias aggregates: `SUM(amount) AS revenue`.
- Dates arrive as `YYYY-MM-DD` strings (DATE) or ISO strings (TIMESTAMP), so use `"type": "temporal"`.
  They are UTC: use `utc` time units (`utcyearmonth`, `utcmonth`, …) or axes shift by a month/day.
- `url`, `data` and `usermeta` keys are rejected at any depth (`lookup` `from.data`, image marks, the `url` channel,
  `usermeta.embedOptions`). Charts never fetch anything and the export/editor actions stay off.
- Fields in `encoding.*.field`, `encoding.*.sort.field` and `facet`/`row`/`column` are checked against the query columns.
  Fields inside `transform` entries are not checked.
- Theme (palette, grid, light/dark) comes from the page. Do not set colors, `config`, `width` or `autosize`; set `height` only if you need it (default 260).
- Tooltips are added to every mark automatically.
- Use at most 8 colour categories. Fold the rest into "Other" in SQL.

## Validation order

1. Schema (did-you-mean on typos). 2. Cross-references: unique ids, queries exist, source files exist, inside the spec folder, regular files.
3. SQL parses as exactly one SELECT. 4. Vega-Lite compiles. 5. Each query is bound against the real sources on the locked-down
database (`LIMIT 0`), so unknown tables or columns are reported at `queries.<name>` with DuckDB's cause lines. The same column types check the kind roles, view names and `vegaLite` fields, so a typo in `x` or `field` fails at validate. Value-based rules (negatives, slice and colour counts) run at build, where rows exist. Then at build:
queries run (30 s limit, `--timeout <seconds>`), and fields are checked against the result columns.

## SQL rules

A query is one statement that DuckDB's parser accepts as a SELECT. An allowlist then walks its whole syntax tree
(subqueries, CTEs, set operations, lateral joins, `IN (SELECT …)`, string constants cannot hide anything):

- **Tables:** only the declared sources: a `csv`/`parquet`/`json` source by name (`sales`), an attached source as
  `name.table` or `name.schema.table`, and CTEs defined in the same query. Everything else is rejected:
  other schemas and catalogs, `pg_catalog`, `information_schema`, `system`, `temp`, replacement scans like `FROM 'file.csv'`.
- **Table functions:** only `range`, `generate_series` and `unnest`. That rejects `query()`, `query_table()`, `read_*`, `glob`,
  `duckdb_*()` (such as `duckdb_settings()`, `duckdb_databases()`), `pragma_*` and the `sqlite_*`/`postgres_*`/`mysql_*` bridges.
- **Other functions:** scalar, aggregate and window functions are allowed except those that read settings, the environment
  or files (`current_setting`, `getenv`, `duckdb_*`, `pg_*`, `sqlite_*`, `postgres_*`, `mysql_*`, `query*`, `read_*`, `glob`,
  `which_secret`, `nextval`, `currval`) and schema-qualified calls. This part is a denylist: scalar functions cannot read files
  or open connections, so the table-function allowlist is what closes the file and network paths.
- `DESCRIBE <query>`, `SUMMARIZE <query>` and `VALUES` work. `SHOW TABLES`, `PIVOT` and anything that is not a SELECT do not.
  A trailing `;` or `-- comment` is fine.

CTE scoping follows DuckDB's binder: a CTE body sees only the CTEs defined before it, plus itself in the recursive branch of a
real `WITH RECURSIVE` (a self or forward reference would bind to the *catalog*). CTE names that shadow a system view, table or
table function (`duckdb_databases`, `pg_settings`, …) are rejected: `CTE name "x" shadows a system object; rename it`.

Every query is also bound with `LIMIT 0` against the real sources at validate time. Result cells pass through a scrubber for
connection-string secrets, but that is defence in depth only: the guard is the control.

## Types in results

| DuckDB type | JSON value |
|---|---|
| BIGINT / HUGEINT | number; string when above 2^53 |
| DECIMAL | number, or the exact string when it needs more than 15 significant digits |
| DATE | `YYYY-MM-DD`; `infinity` / out-of-range stay strings |
| TIMESTAMP / TIMESTAMPTZ | ISO string with ms and `Z`; `infinity` stays a string |
| TIME, TIMETZ, INTERVAL | DuckDB text (`01:02:03.5`, `3 days`) |
| BLOB / BIT | `<blob N bytes>` / `<bit N bits>` |
| LIST, STRUCT, MAP, UNION | JSON, converted recursively; big integers become strings; dates and timestamps inside keep DuckDB text form |
| NULL | `null` |

## Security model

Queries are model-written, so they are untrusted; the SQL allowlist is the control, the rest is depth. Layers, in order: the SQL allowlist above; in-memory DuckDB with reads limited
to exactly the declared files (`allowed_paths`), external access off and the configuration locked; sources confined to the
spec folder (`--allow-outside` is a CLI flag, never a spec field); attached DuckDB files without views or macros; a row limit
and a timeout. For postgres and mysql the read-only database role is the guard that matters. Titles and SQL are HTML-escaped and
embedded data has `<` escaped. The page carries `Content-Security-Policy: default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:`;
charts use Vega's bundled expression interpreter (`ast: true`), so no `unsafe-eval` is needed. The built page contains the query
results: sharing it shares the data.
