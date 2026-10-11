# SQL sandbox: bypass vectors and the tests that pin them

Queries are written by a model, so they are untrusted. `scripts/lib/guard.mjs` walks the syntax tree and allows only the
declared sources; `scripts/lib/sql.mjs` then runs the query in a DuckDB locked to the declared files. This page lists each
known way out of DuckDB and where a test pins it. Rejected-query cases live in the `REJECTED` table of `test/guard.test.mjs`
unless another file is named. A new vector gets a row here and a case in that table.

The validator is **not** the offline guarantee. The locked DuckDB connection (no external access, configuration locked) and
the page's `default-src 'none'` CSP are. In make-motion the equivalents are its CSP and the renderer's request abort.

## Nested SQL and indirect table access

| Vector | Why it matters | Pinned by |
|---|---|---|
| `query('<inner SQL>')` | Runs a string as SQL, so the inner text (a `sqlite_scan` of an outside file, `duckdb_settings()`) is never walked by the guard | `query() wrapping sqlite_scan on an outside file`, `query() reading settings`, `query() inside a CTE`, `query() with current_setting inside a CTE`; `sources.test.mjs` "sqlite: query() cannot smuggle an outside file past the guard (validate and build)" |
| `query_table('shop.items')` | Reads a table named by a string, so the guard cannot check the name | `query_table()`; the same `sources.test.mjs` test |
| Replacement scan, `FROM '/etc/hosts'` | A bare file path is read as a table | `replacement scan of a file` |
| Table function hidden deeper in the tree | Nested subquery, `IN (SELECT …)`, `UNION` branch, `LATERAL`, or a table-function argument | `table function in a nested subquery`, `system view in an IN-subquery`, `system view in a UNION branch`, `table function in a lateral join`, `table function inside a table function argument` |
| A second statement (`SELECT 1; DROP TABLE x`, `COPY … TO`) | Anything that is not one SELECT | `validate.test.mjs` "non-SELECT SQL is rejected"; `sources.test.mjs` "runOne refuses a string that holds more than one statement" (setup statements); `inspect.test.mjs` "--spec validates the whole spec first: an injected source type writes nothing and exits 1" (`COPY` injected through a source type) |
| `SHOW TABLES` and friends | Lists catalogs without a table reference | `SHOW TABLES` |

## Bridge extensions

| Vector | Why it matters | Pinned by |
|---|---|---|
| `sqlite_scan`, `postgres_scan`, `postgres_query`, `mysql_query` | The extensions open files and connections themselves and ignore `enable_external_access=false`, so the lockdown does not stop them | `sources.test.mjs` "extension-bridge functions are rejected by name"; `sqlite_scan on a declared file`, `postgres_query`; `sources.test.mjs` "sqlite source: end-to-end build, confined, and still locked down" |
| Extension auto-install or autoload | A build would download code | `sources.test.mjs` "missing extension fails with the setup command, no silent download" |
| A view or macro inside an attached DuckDB file | Runs with the lockdown but outside the guard (a view calling `sqlite_scan`) | "attached DuckDB file with a view or macro is refused" in `guard.test.mjs` |

## System catalogs as tables

| Vector | Why it matters | Pinned by |
|---|---|---|
| `duckdb_databases()`, `duckdb_settings()`, `pragma_database_list` | Expose local paths and settings | `duckdb_databases()`, `duckdb_databases without parens`, `pragma_database_list`, `quoted, upper-case table function` |
| `pg_catalog.*`, `information_schema.*`, `system.main.*` | System views reached by name or schema | `pg_catalog.pg_settings`, `pg_catalog.pg_database`, `information_schema.tables`, `schema-qualified table function`, `a remote catalog schema` |
| Qualified function call, `pg_catalog.pg_typeof(1)` | Reaches system functions past the unqualified denylist | `a qualified function` |
| An undeclared table | Anything not a declared source | `an undeclared table` |

## CTE shadowing

DuckDB binds a self or forward reference inside a CTE body to the catalog, so `WITH duckdb_databases AS (SELECT * FROM duckdb_databases)`
reads the system view under the CTE's name.

| Vector | Why it matters | Pinned by |
|---|---|---|
| CTE selecting from the system view it is named after (plain, `MATERIALIZED`, `RECURSIVE`) | The self reference binds to the catalog, so the CTE name hides a system view read | `a CTE that selects from the system view it is named after`, `the same, MATERIALIZED`, `the same, WITH RECURSIVE` |
| Self-reference named like `pg_settings`; non-recursive self-reference; recursive self-reference in the base branch | A CTE that refers to itself resolves to the catalog object of that name, not to the CTE | `a self-referencing CTE named like pg_settings`, `a plain self-reference (non-recursive)`, `a recursive self-reference in the base branch` |
| Forward reference to a later CTE | A name used before its CTE is defined also falls through to the catalog | `a forward reference to a later CTE`, `a forward reference to a later, harmless-looking CTE` |
| Slicing the leaked value through the shadowing CTE | Substring or similar functions over the shadowed view return a part of the leaked value | `slicing a system view through a shadowing CTE` |
| A CTE named after a system object, even with a harmless body (second layer) | Defence in depth: the name alone is refused, whatever the body does | `a CTE named after a system view (even a harmless body)`, `a CTE named after a table function, any case`, `a CTE named after an extension-only table function`, `a CTE named after a pg_catalog table`; message check "shadowing a system object is called out by name" |
| A CTE name used outside its scope | The name is not a CTE there, so it must be checked as a table | `a CTE name used outside its scope` |

## Settings, environment and files

| Vector | Why it matters | Pinned by |
|---|---|---|
| `current_setting`, `getenv`, `which_secret` as scalars (also inside a CTE or scalar subquery) | Return settings, environment values or secret names without a table reference | `current_setting as a scalar`, `current_setting in a CTE`, `current_setting in a scalar subquery`, `getenv`, `which_secret` |
| `read_csv`, `read_text`, `glob` on an outside file | Read or list files outside the declared sources | `read_csv of an outside file`, `read_text`, `glob`; `build.test.mjs` "lockdown: queries cannot read undeclared files" |
| Unlocking the connection (`SET enable_external_access=true`, `SET allowed_paths=…`, `SET lock_configuration=false`) | Would lift the lockdown that backs the guard | `build.test.mjs` "lockdown: the locked connection refuses every unlock attempt" |
| Source `path` or `type` used as an injection point | Spec text reaches SQL statements that attach or create the sources | `sources.test.mjs` "sourceStatement never interpolates the source type", "names, paths and urls reach SQL only as quoted identifiers and escaped literals", "openLockedDb with hostile source names and paths writes nothing"; `--allow-outside` is a CLI flag only (`build.test.mjs`, `validate.test.mjs`) |
