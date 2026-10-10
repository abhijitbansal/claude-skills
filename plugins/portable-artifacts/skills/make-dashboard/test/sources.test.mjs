import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DuckDBInstance } from '@duckdb/node-api';
import { validateSpec } from '../scripts/lib/spec.mjs';
import { sourceStatement, extensionsFor } from '../scripts/lib/sources.mjs';
import { checkSelect, openDb, makeScrubber } from '../scripts/lib/sql.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(ROOT, 'test/fixtures');
const BUILD = path.join(ROOT, 'scripts/build.mjs');
const VALIDATE = path.join(ROOT, 'scripts/validate.mjs');
const SETUP = path.join(ROOT, 'scripts/setup.mjs');

// Extensions come from the network on first INSTALL; skip (with the reason)
// when that is not possible rather than failing offline runs.
async function unavailable(ext) {
  try {
    const conn = await (await DuckDBInstance.create(':memory:')).connect();
    await conn.run(`INSTALL ${ext}`);
    await conn.run(`LOAD ${ext}`);
    return false;
  } catch (e) {
    return `DuckDB extension "${ext}" cannot be installed here: ${String(e.message).split('\n')[0]}`;
  }
}
const noSqlite = await unavailable('sqlite');
const noPostgres = await unavailable('postgres');
const noMysql = await unavailable('mysql');

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dash-src-')));
const run = (script, args, env = {}) =>
  spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: { ...process.env, ...env }, cwd: os.tmpdir() });

async function makeSqlite(file) {
  const conn = await (await DuckDBInstance.create(':memory:')).connect();
  await conn.run('INSTALL sqlite');
  await conn.run('LOAD sqlite');
  await conn.run(`ATTACH '${file}' AS w (TYPE sqlite)`);
  await conn.run('CREATE TABLE w.items(item TEXT, qty INTEGER)');
  await conn.run("INSERT INTO w.items VALUES ('apple', 3), ('pear', 5), ('apple', 4)");
}

function sqliteProject() {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'data'));
  const spec = {
    title: 'Shop',
    sources: { shop: { type: 'sqlite', path: 'data/shop.db' } },
    queries: { qty_by_item: 'SELECT item, SUM(qty) AS qty FROM shop.items GROUP BY 1 ORDER BY 1' },
    charts: [{
      id: 'c1', title: 'Qty', query: 'qty_by_item',
      vegaLite: { mark: 'bar', encoding: { x: { field: 'item', type: 'nominal' }, y: { field: 'qty', type: 'quantitative' } } },
    }],
  };
  const file = path.join(dir, 'dashboard.json');
  fs.writeFileSync(file, JSON.stringify(spec));
  return { dir, file, spec, db: path.join(dir, 'data/shop.db') };
}

test('ATTACH / view statement builder, per source type (no server needed)', () => {
  assert.equal(
    sourceStatement('db', { type: 'postgres', env: 'PG_URL' }, { url: "host=h user=o'neil" }),
    `ATTACH 'host=h user=o''neil' AS "db" (TYPE postgres, READ_ONLY)`,
  );
  assert.equal(
    sourceStatement('db', { type: 'mysql', env: 'MY_URL' }, { url: 'host=h' }),
    `ATTACH 'host=h' AS "db" (TYPE mysql, READ_ONLY)`,
  );
  assert.equal(
    sourceStatement('shop', { type: 'sqlite', path: 'x' }, { abs: '/d/shop.db' }),
    `ATTACH '/d/shop.db' AS "shop" (TYPE sqlite, READ_ONLY)`,
  );
  assert.equal(
    sourceStatement('s', { type: 'csv', path: 'x' }, { abs: '/d/s.csv' }),
    `CREATE VIEW "s" AS SELECT * FROM read_csv_auto('/d/s.csv')`,
  );
  assert.equal(
    sourceStatement('d', { type: 'duckdb', path: 'x' }, { abs: '/d/a.duckdb' }),
    `ATTACH '/d/a.duckdb' AS "d" (READ_ONLY)`,
  );
});

test('extensionsFor lists only what the sources need', () => {
  assert.deepEqual(extensionsFor({ sources: { a: { type: 'csv' }, b: { type: 'sqlite' }, c: { type: 'postgres' }, d: { type: 'postgres' } } }), ['sqlite', 'postgres']);
  assert.deepEqual(extensionsFor({ sources: { a: { type: 'parquet' } } }), []);
});

test('source shape errors name the field', async () => {
  const q = { q: 'SELECT 1 AS n' };
  const dir = FIXTURES;
  let r = await validateSpec({ title: 't', queries: q, sources: { db: { type: 'postgres', path: 'x.db', env: 'PG_URL' } } }, { dir });
  assert.deepEqual(r.errors, [{ path: 'sources.db.path', message: 'not allowed for type "postgres"; use env' }]);
  r = await validateSpec({ title: 't', queries: q, sources: { db: { type: 'mysql' } } }, { dir });
  assert.deepEqual(r.errors, [{ path: 'sources.db.env', message: 'required for type "mysql" (the name of an environment variable holding the connection string)' }]);
  r = await validateSpec({ title: 't', queries: q, sources: { s: { type: 'csv', env: 'X' } } }, { dir });
  assert.deepEqual(r.errors.map((e) => e.path), ['sources.s.env', 'sources.s.path']);
  r = await validateSpec({ title: 't', queries: q, sources: { db: { type: 'postgres', env: 'pg_url' } } }, { dir });
  assert.equal(r.errors[0].path, 'sources.db.env');
  assert.match(r.errors[0].message, /pattern/);
});

test('unset env var is an error at validate and at build', async () => {
  const spec = { title: 't', queries: { q: 'SELECT 1 AS n' }, sources: { db: { type: 'postgres', env: 'DASH_TEST_UNSET_PG_URL' } } };
  const r = await validateSpec(spec, { dir: FIXTURES });
  assert.deepEqual(r.errors, [{ path: 'sources.db.env', message: 'environment variable DASH_TEST_UNSET_PG_URL is not set' }]);
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'd.json'), JSON.stringify(spec));
  const env = { DASH_TEST_UNSET_PG_URL: '' };
  for (const script of [VALIDATE, BUILD]) {
    const out = run(script, [path.join(dir, 'd.json')], env);
    assert.equal(out.status, 1, script);
    assert.match(out.stdout, /^sources\.db\.env: environment variable DASH_TEST_UNSET_PG_URL is not set$/m);
  }
});

test('extension-bridge functions are rejected by name', async () => {
  const conn = (await openDb()).conn;
  for (const sql of [
    "SELECT * FROM sqlite_scan('/etc/other.db', 'x')",
    "SELECT * FROM postgres_query('db', 'select 1')",
    "SELECT * FROM postgres_scan('host=h', 'public', 't')",
    "SELECT * FROM mysql_query('db', 'select 1')",
  ]) {
    assert.match(await checkSelect(conn, sql), /is not allowed/, sql);
  }
});

test('scrubber removes secrets, URL credentials and password= pairs', () => {
  const scrub = makeScrubber(['hunter2']);
  const out = scrub('failed: postgres://user:S3CRET@h:1/db and host=h password=S3CRET2 and hunter2');
  assert.doesNotMatch(out, /S3CRET|hunter2/);
  assert.match(out, /postgres:\/\/user:<redacted>@h:1\/db/);
});

test('sqlite source: end-to-end build, confined, and still locked down', { skip: noSqlite }, async () => {
  const p = sqliteProject();
  await makeSqlite(p.db);

  const v = run(VALIDATE, [p.file]);
  assert.equal(v.status, 0, v.stdout + v.stderr);
  const b = run(BUILD, [p.file]);
  assert.equal(b.status, 0, b.stdout + b.stderr);
  assert.match(b.stdout, /^source shop: .*shop\.db$/m);
  const html = fs.readFileSync(path.join(p.dir, 'dist/index.html'), 'utf8');
  const data = JSON.parse(html.match(/id="dash-data">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(data.queries.qty_by_item.rows, [{ item: 'apple', qty: 7 }, { item: 'pear', qty: 5 }]);

  // another sqlite file on disk must not be readable through the extension
  const other = path.join(tmp(), 'other.db');
  await makeSqlite(other);
  const evil = { ...p.spec, queries: { leak: `SELECT * FROM sqlite_scan('${other}', 'items')` }, charts: [] };
  const r = await validateSpec(evil, { dir: p.dir });
  assert.match(r.errors[0].message, /is not allowed/);

  // same confinement as file sources
  const outside = { ...p.spec, sources: { shop: { type: 'sqlite', path: path.relative(p.dir, other) } } };
  const r2 = await validateSpec(outside, { dir: p.dir });
  assert.match(r2.errors[0].message, /^resolves outside the spec folder/);
  const r3 = await validateSpec(outside, { dir: p.dir, allowOutside: true });
  assert.deepEqual(r3.errors, []);
});

test('missing extension fails with the setup command, no silent download', { skip: noSqlite }, async () => {
  const p = sqliteProject();
  await makeSqlite(p.db);
  const empty = tmp();
  const out = run(VALIDATE, [p.file], { DUCKDB_EXTENSION_DIRECTORY: empty });
  assert.equal(out.status, 1, out.stdout + out.stderr);
  assert.match(out.stdout, /^sources\.shop: the "sqlite" DuckDB extension is not installed; run: node ".*setup\.mjs"$/m);
  assert.deepEqual(fs.readdirSync(empty), [], 'nothing was downloaded into the extension dir');
});

for (const [type, skip, conn] of [
  ['postgres', noPostgres, 'postgres://user:SECRET@127.0.0.1:1/db'],
  ['postgres', noPostgres, 'host=127.0.0.1 port=1 user=u password=SECRET dbname=d'],
  ['mysql', noMysql, 'host=127.0.0.1 port=1 user=u password=SECRET database=d'],
]) {
  test(`${type} connection string never reaches output (${conn.split(' ')[0].slice(0, 12)}…)`, { skip }, () => {
    const dir = tmp();
    const spec = { title: 't', queries: { q: 'SELECT * FROM db.t' }, sources: { db: { type, env: 'DASH_TEST_CONN' } } };
    fs.writeFileSync(path.join(dir, 'd.json'), JSON.stringify(spec));
    const log = path.join(dir, 'eval.log');
    for (const script of [VALIDATE, BUILD]) {
      const out = run(script, [path.join(dir, 'd.json')], { DASH_TEST_CONN: conn, EVAL_LOG: log });
      assert.equal(out.status, 1, `${script}\n${out.stdout}${out.stderr}`);
      assert.match(out.stdout, /^sources\.db: /m);
      assert.doesNotMatch(out.stdout + out.stderr, /SECRET/, script);
      assert.doesNotMatch(out.stdout + out.stderr, /127\.0\.0\.1:1\/db/, 'host part of the URL is scrubbed too');
    }
    if (fs.existsSync(log)) assert.doesNotMatch(fs.readFileSync(log, 'utf8'), /SECRET/);
    assert.ok(!fs.existsSync(path.join(dir, 'dist')), 'no page written');
  });
}

test('setup.mjs installs what the spec needs and prints the extension directory', { skip: noSqlite }, () => {
  const p = sqliteProject();
  const out = run(SETUP, [p.file]);
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /^extension directory: .*extensions/m);
  assert.match(out.stdout, /^sqlite: .*sqlite_scanner/m);
  assert.doesNotMatch(out.stdout, /postgres|mysql/);
  assert.equal(run(SETUP, ['--bogus']).status, 2);
  assert.equal(run(SETUP, ['/nonexistent.json']).status, 2);
});
