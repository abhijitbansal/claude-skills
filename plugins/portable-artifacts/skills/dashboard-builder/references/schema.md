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
| `sources.<name>` | `name` matches `^[a-z][a-z0-9_]*$` and is not `main`, `temp` or `system` (DuckDB catalogs). `type`: `csv`, `parquet`, `json`, `duckdb`. `path` is relative to the **spec file**, not the cwd, and must resolve (symlinks followed) to a regular file inside the spec's folder. Only `--allow-outside` on validate/build lifts the folder rule; it is deliberately not a spec field |
| `queries.<name>` | one SQL `SELECT` (CTEs and UNIONs fine). Each source name is a table/view in the query. No other statement types |
| `kpis[]` | `id`, `title`, `query`, `field` required. Shows the first row's `field`. `format`: `number`, `currency` (USD), `percent` (value is a fraction: 0.25 → 25%), `compact` |
| `charts[]` | `id`, `title`, `query`, `vegaLite` required. `width`: `full` (default) or `half` (two columns from 900px) |

`id` values are unique across charts and KPIs and match `^[A-Za-z][A-Za-z0-9_-]*$`.

## Source types

- `csv`, `json`: `read_csv_auto` / `read_json_auto` view named after the source.
- `parquet`: `read_parquet` view.
- `duckdb`: the file is attached read-only under the source name; query `name.table`.

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
