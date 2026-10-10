# dashboard.json reference

Authoritative schema: `SCHEMA` in `scripts/lib/spec.mjs`. Unknown properties are errors.

```json
{
  "title": "Revenue by region",
  "description": "optional subtitle",
  "maxRows": 5000,
  "sources": { "sales": { "type": "parquet", "path": "data/sales.parquet" } },
  "queries": { "rev_by_region": "SELECT region, SUM(amount) AS revenue FROM sales GROUP BY 1" },
  "kpis":   [ { "id": "k1", "title": "Total", "query": "total", "field": "revenue", "format": "currency" } ],
  "charts": [ { "id": "c1", "title": "Revenue by region", "query": "rev_by_region", "width": "half",
                "vegaLite": { "mark": "bar", "encoding": {
                  "x": { "field": "region", "type": "nominal" },
                  "y": { "field": "revenue", "type": "quantitative" } } } } ]
}
```

## Fields

| Field | Rule |
|---|---|
| `title` | required string |
| `description` | optional subtitle |
| `maxRows` | integer 1–100000, default 5000; applied to every query. Longer results are cut and the card says "truncated at N" |
| `sources.<name>` | `name` matches `^[a-z][a-z0-9_]*$` and is not `main`, `temp` or `system` (DuckDB catalogs). `type`: `csv`, `parquet`, `json`, `duckdb`, `sqlite` (take `path`) or `postgres`, `mysql` (take `env`, never `path`). `path` is relative to the **spec file**, not the cwd, and must resolve (symlinks followed) to a regular file inside the spec's folder. Only `--allow-outside` on validate/build lifts the folder rule; it is deliberately not a spec field |
| `queries.<name>` | one SQL `SELECT` (CTEs and UNIONs fine). Each source name is a table/view in the query. No other statement types |
| `kpis[]` | `id`, `title`, `query`, `field` required. Shows the first row's `field`. `format`: `number`, `currency` (USD), `percent` (value is a fraction: 0.25 → 25%), `compact` |
| `charts[]` | `id`, `title`, `query`, `vegaLite` required. `width`: `full` (default) or `half` (two columns from 900px) |

`id` values are unique across charts and KPIs and match `^[A-Za-z][A-Za-z0-9_-]*$`.

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
`allowed_paths` (tested). The extensions' own bridge functions (`sqlite_scan`, `postgres_query`, `mysql_scan`, …, any
`sqlite_*`/`postgres_*`/`mysql_*` function) open files and connections outside that lockdown, so queries may not call them.
Postgres and MySQL are attached before the lock; they were not run against a live server in the tests.

## vegaLite

Any Vega-Lite 6 unit, layer or concat spec **without `data`**. The build injects the query rows. Rules:

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
database (`LIMIT 0`), so unknown tables or columns are reported at `queries.<name>` with DuckDB's cause lines. Then at build:
queries run (30 s limit, `--timeout <seconds>`), and fields are checked against the result columns.

## SQL rules

One statement that DuckDB's own parser accepts as a SELECT: CTEs, UNIONs, `DESCRIBE`, `SUMMARIZE`, `SHOW` and `VALUES`
are read-only and work. A trailing `;` or `-- comment` is fine. `duckdb_settings()`, `current_setting()`, `duckdb_secrets()`,
`duckdb_extensions()` and `getenv()` are rejected by name because they can expose local paths and settings.

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

Queries run in in-memory DuckDB. After the sources are attached, reads are limited to exactly the declared files
(`allowed_paths`), external access is disabled and the configuration is locked, so a query cannot read other files
or turn that off. Source paths must be inside the spec folder. Titles and SQL are HTML-escaped and embedded data has `<` escaped.
The page carries `Content-Security-Policy: default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:`;
charts use Vega's bundled expression interpreter (`ast: true`), so no `unsafe-eval` is needed.
