import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DuckDBInstance } from '@duckdb/node-api';
import { openDb, checkSelect, makeScrubber } from '../scripts/lib/sql.mjs';
import { fetchQuery } from '../scripts/lib/data.mjs';
import { validateSpec } from '../scripts/lib/spec.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = path.join(ROOT, 'scripts/build.mjs');
const policy = { views: new Set(['sales']), attached: new Set(['shop']) };
const db = await openDb();
const verdict = (sql) => checkSelect(db.conn, sql, policy);

const REJECTED = {
  'query() wrapping sqlite_scan on an outside file': "SELECT * FROM query('SELECT * FROM sqlite_scan(''/outside.sqlite'', ''t'')')",
  'query() reading settings': "SELECT * FROM query('SELECT name, value FROM duckdb_settings()')",
  'query_table()': "SELECT * FROM query_table('shop.items')",
  'query() inside a CTE': "WITH x AS (SELECT * FROM query('SELECT 1')) SELECT * FROM x",
  'query() with current_setting inside a CTE': "SELECT * FROM query('WITH c AS (SELECT current_setting(''home_directory'') h) SELECT * FROM c')",
  'table function in a nested subquery': 'SELECT * FROM (SELECT * FROM (SELECT * FROM duckdb_databases()) a) b',
  'system view in an IN-subquery': 'SELECT item FROM shop.items WHERE item IN (SELECT name FROM pg_catalog.pg_settings)',
  'unqualified pg_settings in an IN-subquery': 'SELECT 1 WHERE 1 IN (SELECT 1 FROM pg_settings)',
  'system view in a UNION branch': 'SELECT 1 AS n UNION ALL SELECT name FROM pg_catalog.pg_settings',
  'table function in a lateral join': 'SELECT * FROM range(2) t(i), LATERAL (SELECT * FROM duckdb_databases())',
  'pg_catalog.pg_settings': 'SELECT * FROM pg_catalog.pg_settings',
  'pg_catalog.pg_database': 'SELECT * FROM pg_catalog.pg_database',
  'information_schema.tables': 'SELECT * FROM information_schema.tables',
  'a remote catalog schema': 'SELECT * FROM shop.information_schema.tables',
  'duckdb_databases()': 'SELECT database_name, path FROM duckdb_databases()',
  'duckdb_databases without parens': 'SELECT * FROM duckdb_databases',
  'pragma_database_list': 'SELECT * FROM pragma_database_list',
  'schema-qualified table function': 'SELECT * FROM system.main.duckdb_settings()',
  'quoted, upper-case table function': 'SELECT * FROM "DUCKDB_SETTINGS"()',
  'current_setting as a scalar': "SELECT current_setting('home_directory') AS h",
  'current_setting in a CTE': "WITH c AS (SELECT current_setting('home_directory') h) SELECT * FROM c",
  'current_setting in a scalar subquery': "SELECT (SELECT current_setting('home_directory')) AS h",
  'getenv': "SELECT getenv('HOME')",
  'read_csv of an outside file': "SELECT * FROM read_csv('/etc/hosts')",
  'read_text': "SELECT * FROM read_text('/etc/hosts')",
  'glob': "SELECT * FROM glob('/*')",
  'replacement scan of a file': "SELECT * FROM '/etc/hosts'",
  'table function inside a table function argument': 'SELECT * FROM range((SELECT count(*) FROM duckdb_settings()))',
  'which_secret': "SELECT * FROM which_secret('s3://x', 's3')",
  'SHOW TABLES': 'SHOW TABLES',
  'an undeclared table': 'SELECT * FROM nope',
  'a CTE name used outside its scope': 'SELECT * FROM (WITH pg_settings AS (SELECT 1) SELECT 1) a, pg_settings',
  'sqlite_scan on a declared file': "SELECT * FROM sqlite_scan('/x.db', 't')",
  'postgres_query': "SELECT * FROM query('SELECT * FROM postgres_query(''wh'', ''select 1'')')",
  'a qualified function': 'SELECT pg_catalog.pg_typeof(1)',
  // CTE scoping: a CTE body does not see itself or later CTEs (DuckDB binds those to the catalog)
  'a CTE that selects from the system view it is named after': 'WITH duckdb_databases AS (SELECT * FROM duckdb_databases) SELECT path FROM duckdb_databases',
  'the same, MATERIALIZED': 'WITH duckdb_databases AS MATERIALIZED (SELECT * FROM duckdb_databases) SELECT path FROM duckdb_databases',
  'the same, WITH RECURSIVE': 'WITH RECURSIVE duckdb_databases AS (SELECT * FROM duckdb_databases) SELECT path FROM duckdb_databases',
  'a self-referencing CTE named like pg_settings': 'WITH pg_settings AS (SELECT * FROM pg_settings) SELECT name, setting FROM pg_settings',
  'a forward reference to a later CTE': 'WITH x AS (SELECT * FROM pragma_database_list), pragma_database_list AS (SELECT 1 AS seq) SELECT * FROM x',
  'a forward reference to a later, harmless-looking CTE': 'WITH a AS (SELECT * FROM b), b AS (SELECT 1 AS n) SELECT * FROM a',
  'a plain self-reference (non-recursive)': 'WITH t AS (SELECT * FROM t) SELECT * FROM t',
  'a recursive self-reference in the base branch': 'WITH RECURSIVE t(n) AS (SELECT n FROM t UNION ALL SELECT 1) SELECT * FROM t',
  'slicing a system view through a shadowing CTE': 'WITH duckdb_databases AS (SELECT * FROM duckdb_databases) SELECT reverse(path) r, substr(path, 1, 12) a, substr(path, 13) b FROM duckdb_databases',
  'a CTE named after a system view (even a harmless body)': 'WITH duckdb_databases AS (SELECT 1 AS path) SELECT path FROM duckdb_databases',
  'a CTE named after a table function, any case': 'WITH Duckdb_Settings AS (SELECT 1 AS name) SELECT * FROM Duckdb_Settings',
  'a CTE named after an extension-only table function': 'WITH read_postgres_binary AS (SELECT 1 AS a) SELECT * FROM read_postgres_binary',
  'a CTE named after a pg_catalog table': 'WITH pg_database AS (SELECT 1 AS n) SELECT * FROM pg_database',
};

for (const [name, sql] of Object.entries(REJECTED)) {
  test(`guard rejects: ${name}`, async () => {
    const message = await verdict(sql);
    assert.ok(message, `expected a rejection for: ${sql}`);
    assert.match(message, /not allowed|single SELECT|shadows a system object/);
  });
}

const ACCEPTED = {
  'a declared source': 'SELECT region, SUM(amount) AS revenue FROM sales GROUP BY 1 ORDER BY 2 DESC',
  'date_trunc and strftime': "SELECT date_trunc('month', date) AS m, strftime(date, '%Y-%m') AS s FROM sales",
  'window functions': 'SELECT region, SUM(amount) OVER (PARTITION BY region ORDER BY date) AS running FROM sales',
  'CASE': "SELECT CASE WHEN amount > 100 THEN 'big' ELSE 'small' END AS size FROM sales",
  'CTEs, including a recursive one': 'WITH a AS (SELECT * FROM sales), b AS (SELECT region FROM a) SELECT * FROM b',
  'a recursive CTE': 'WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM r WHERE n < 3) SELECT * FROM r',
  'a counting recursive CTE': 'WITH RECURSIVE t(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM t WHERE n < 5) SELECT * FROM t',
  'a later CTE reading an earlier one': 'WITH a AS (SELECT * FROM sales), b AS (SELECT region FROM a), c AS (SELECT * FROM a JOIN b USING (region)) SELECT * FROM c',
  'a CTE reading an outer CTE from a nested WITH': 'WITH a AS (SELECT 1 AS n) SELECT * FROM (WITH b AS (SELECT * FROM a) SELECT * FROM b) s',
  'a MATERIALIZED CTE': 'WITH a AS MATERIALIZED (SELECT * FROM sales) SELECT * FROM a',
  'an attached table, two parts': 'SELECT * FROM shop.items',
  'an attached table, three parts': 'SELECT * FROM shop.main.items',
  'a subquery and IN-subquery': 'SELECT * FROM (SELECT * FROM sales) s WHERE region IN (SELECT region FROM sales WHERE units > 3)',
  'a UNION': 'SELECT region FROM sales UNION ALL SELECT region FROM sales',
  'a join of sources': 'SELECT * FROM sales a JOIN sales b ON a.region = b.region',
  'range and generate_series': 'SELECT * FROM range(3) t(i), generate_series(1, 2) g(j)',
  'unnest as a table function': 'SELECT * FROM unnest([1, 2, 3]) t(i)',
  'unnest as a scalar and a list literal': 'SELECT unnest([1, 2]) AS i',
  'a lateral join over range': 'SELECT * FROM range(2) t(i), LATERAL (SELECT * FROM range(i)) u',
  'VALUES': 'SELECT * FROM (VALUES (1), (2)) v(n)',
  'DESCRIBE of a query': 'DESCRIBE SELECT * FROM sales',
  'a trailing semicolon': 'SELECT 1;',
  'a source, schema-qualified with main': 'SELECT * FROM main.sales',
};

for (const [name, sql] of Object.entries(ACCEPTED)) {
  test(`guard accepts: ${name}`, async () => {
    assert.equal(await verdict(sql), null);
  });
}

test('shadowing a system object is called out by name', async () => {
  assert.equal(
    await verdict('WITH duckdb_databases AS (SELECT 1 AS path) SELECT path FROM duckdb_databases'),
    'CTE name "duckdb_databases" shadows a system object; rename it',
  );
});

test('table errors list what is readable and suggest a close source name', async () => {
  assert.equal(
    await verdict('SELECT * FROM sale'),
    'table "sale" is not allowed; queries may read only the declared sources (sales, shop.<table>) and their own CTEs; did you mean "sales"?',
  );
});

test('result cells are scrubbed before they leave the query layer', async () => {
  const conn = (await openDb()).conn;
  const scrub = makeScrubber(['SECRET-VALUE'], { heuristics: false });
  const { rows } = await fetchQuery(conn, `SELECT 'x SECRET-VALUE y' AS s, ['SECRET-VALUE', 'ok'] AS l, {'k': 'SECRET-VALUE'} AS o, 5 AS n`, 10, 5000, scrub);
  assert.deepEqual(rows[0], { s: 'x <redacted> y', l: ['<redacted>', 'ok'], o: { k: '<redacted>' }, n: 5 });
});

// ---- attached DuckDB files with views / macros are refused ----------------

async function duckdbFile(dir, statements) {
  const file = path.join(dir, 'ext.duckdb');
  const conn = await (await DuckDBInstance.create(':memory:')).connect();
  await conn.run(`ATTACH '${file}' AS w`);
  for (const sql of statements) await conn.run(sql);
  await conn.run('DETACH w');
  return file;
}
const specFor = (file) => ({ title: 't', sources: { ext: { type: 'duckdb', path: path.basename(file) } }, queries: { q: 'SELECT * FROM ext.items' } });
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dash-guard-')));

test('attached DuckDB file with a view or macro is refused', async () => {
  const dir = tmp();
  const file = await duckdbFile(dir, [
    'CREATE TABLE w.items(a INT)', 'CREATE VIEW w.v1 AS SELECT * FROM w.items', 'CREATE MACRO w.m2(x) AS x + 1',
  ]);
  const r = await validateSpec(specFor(file), { dir });
  assert.deepEqual(r.errors, [{
    path: 'sources.ext',
    message: 'attached DuckDB file defines views/macros (v1, m2), which could bypass the lockdown; export plain tables instead',
  }]);
});

test('attached DuckDB file with plain tables is accepted and readable', async () => {
  const dir = tmp();
  const file = await duckdbFile(dir, ['CREATE TABLE w.items(a INT)', 'INSERT INTO w.items VALUES (1), (2)']);
  const spec = specFor(file);
  assert.deepEqual((await validateSpec(spec, { dir })).errors, []);
  fs.writeFileSync(path.join(dir, 'd.json'), JSON.stringify(spec));
  const r = spawnSync(process.execPath, [BUILD, path.join(dir, 'd.json')], { encoding: 'utf8', cwd: os.tmpdir() });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
