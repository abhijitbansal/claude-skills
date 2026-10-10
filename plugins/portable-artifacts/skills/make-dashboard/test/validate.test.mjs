import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadSpec, validateSpec } from '../scripts/lib/spec.mjs';
import { openDb, checkSelect, wrapLimit } from '../scripts/lib/sql.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(ROOT, 'test/fixtures');
const EXAMPLES = path.join(ROOT, 'references/examples');
const VALIDATE = path.join(ROOT, 'scripts/validate.mjs');

const base = () => ({
  title: 'T',
  sources: { sales: { type: 'csv', path: 'data/sales.csv' } },
  queries: {
    rev_by_region: 'SELECT region, SUM(amount) AS revenue FROM sales GROUP BY 1',
    total: 'SELECT SUM(amount) AS revenue FROM sales',
  },
  charts: [{
    id: 'c1', title: 'C', query: 'rev_by_region',
    vegaLite: { mark: 'bar', encoding: { x: { field: 'region', type: 'nominal' }, y: { field: 'revenue', type: 'quantitative' } } },
  }],
});
const check = (spec) => validateSpec(spec, { dir: FIXTURES });

test('both examples are valid', async () => {
  for (const f of ['sales-overview.json', 'minimal.json']) {
    const { spec, dir } = loadSpec(path.join(EXAMPLES, f));
    const r = await validateSpec(spec, { dir });
    assert.deepEqual(r.errors, [], f);
    assert.equal(r.ok, true);
  }
});

test('unknown top-level property gets did-you-mean', async () => {
  const s = { ...base(), titel: 'x' };
  const r = await check(s);
  assert.deepEqual(r.errors, [{ path: 'titel', message: 'unknown property; did you mean "title"?' }]);
});

test('bad source type reports the enum', async () => {
  const s = base();
  s.sources.sales.type = 'parquet2';
  const r = await check(s);
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].path, 'sources.sales.type');
  assert.match(r.errors[0].message, /must be one of "csv", "parquet", "json", "duckdb", "sqlite", "postgres", "mysql"; did you mean "parquet"\?/);
});

test('chart query typo suggests the real query', async () => {
  const s = base();
  s.charts[0].query = 'rev_by_regin';
  const r = await check(s);
  assert.deepEqual(r.errors, [{ path: 'charts[0].query', message: '"rev_by_regin" not found; did you mean "rev_by_region"?' }]);
});

test('kpi query typo is reported', async () => {
  const s = base();
  s.kpis = [{ id: 'k1', title: 'K', query: 'totl', field: 'revenue' }];
  const r = await check(s);
  assert.deepEqual(r.errors, [{ path: 'kpis[0].query', message: '"totl" not found; did you mean "total"?' }]);
});

test('duplicate chart / kpi ids are rejected', async () => {
  const s = base();
  s.charts.push({ ...s.charts[0] });
  const r = await check(s);
  assert.deepEqual(r.errors, [{ path: 'charts[1].id', message: 'duplicate id "c1"' }]);
  const s2 = base();
  s2.kpis = [{ id: 'c1', title: 'K', query: 'total', field: 'revenue' }];
  const r2 = await check(s2);
  assert.deepEqual(r2.errors, [{ path: 'charts[0].id', message: 'duplicate id "c1"' }]);
});

test('missing source file is reported with its resolved path', async () => {
  const s = base();
  s.sources.sales.path = 'data/nope.csv';
  const r = await check(s);
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].path, 'sources.sales.path');
  assert.equal(r.errors[0].message, `file not found: ${path.join(FIXTURES, 'data/nope.csv')}`);
});

test('non-SELECT SQL is rejected', async () => {
  for (const sql of ['DELETE FROM sales', 'SELECT 1; SELECT 2', "COPY sales TO '/tmp/x.csv'", 'SELECT 1; DROP TABLE x']) {
    const s = base();
    s.queries.total = sql;
    const r = await check(s);
    assert.equal(r.ok, false, sql);
    assert.equal(r.errors[0].path, 'queries.total', sql);
    assert.match(r.errors[0].message, /single SELECT/, sql);
  }
});

test('SQL syntax errors surface as parse errors', async () => {
  const s = base();
  s.queries.total = 'SELECT FROM WHERE';
  const r = await check(s);
  assert.equal(r.errors[0].path, 'queries.total');
  assert.match(r.errors[0].message, /^SQL parse error:/);
});

test('checkSelect accepts CTEs, unions and a trailing semicolon; wrapLimit strips it', async () => {
  const db = await openDb();
  try {
    assert.equal(await checkSelect(db.conn, 'WITH a AS (SELECT 1 x) SELECT * FROM a UNION ALL SELECT 2;'), null);
  } finally { db.close(); }
  assert.equal(wrapLimit('SELECT 1;  ', 10), 'SELECT * FROM (SELECT 1\n) LIMIT 10');
});

test('vegaLite.data is rejected', async () => {
  const s = base();
  s.charts[0].vegaLite.data = { values: [] };
  const r = await check(s);
  assert.deepEqual(r.errors, [{ path: 'charts[0].vegaLite.data', message: 'remove — data is injected from the query' }]);
});

test('invalid Vega-Lite is surfaced under the chart', async () => {
  const s = base();
  s.charts[0].vegaLite.encoding.x.type = 'bogus';
  const r = await check(s);
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].path, 'charts[0].vegaLite');
  assert.match(r.errors[0].message, /^Vega-Lite compile error:/);
});

test('unknown mark gets did-you-mean', async () => {
  const s = base();
  s.charts[0].vegaLite.mark = 'barr';
  const r = await check(s);
  assert.deepEqual(r.errors, [{ path: 'charts[0].vegaLite.mark', message: 'unknown mark "barr"; did you mean "bar"?' }]);
});

test('maxRows range is enforced', async () => {
  const s = { ...base(), maxRows: 0 };
  const r = await check(s);
  assert.equal(r.errors[0].path, 'maxRows');
});

test('loadSpec throws UsageError on unreadable / invalid JSON', () => {
  assert.throws(() => loadSpec('/nonexistent/spec.json'), { name: 'UsageError' });
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dash-')), 'bad.json');
  fs.writeFileSync(f, '{nope');
  assert.throws(() => loadSpec(f), { name: 'UsageError' });
});

const cli = (args, env = {}) =>
  spawnSync(process.execPath, [VALIDATE, ...args], { encoding: 'utf8', env: { ...process.env, ...env }, cwd: os.tmpdir() });

test('CLI exit codes: 0 valid, 1 spec errors, 2 usage', () => {
  const ok = cli([path.join(EXAMPLES, 'minimal.json')]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /valid/);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-'));
  fs.cpSync(path.join(FIXTURES, 'data'), path.join(dir, 'data'), { recursive: true });
  const bad = { ...base(), titel: 'x' };
  fs.writeFileSync(path.join(dir, 'bad.json'), JSON.stringify(bad));
  const r1 = cli([path.join(dir, 'bad.json')]);
  assert.equal(r1.status, 1);
  assert.match(r1.stdout, /^titel: unknown property; did you mean "title"\?$/m);
  const r1j = cli([path.join(dir, 'bad.json'), '--json']);
  assert.equal(JSON.parse(r1j.stdout).ok, false);

  assert.equal(cli([]).status, 2);
  assert.equal(cli(['/nonexistent.json']).status, 2);
});

test('EVAL_LOG gets one JSON line per run', () => {
  const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dash-')), 'eval.log');
  cli([path.join(EXAMPLES, 'minimal.json')], { EVAL_LOG: log });
  cli(['/nonexistent.json'], { EVAL_LOG: log });
  const lines = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.length, 2);
  assert.equal(lines[0].ok, true);
  assert.equal(lines[0].errors, 0);
  assert.equal(lines[1].ok, false);
  assert.ok(lines[0].ts);
});

// ---- review fix pass ------------------------------------------------------

test('Vega-Lite network / page-option vectors are rejected at any depth', async () => {
  const bar = () => ({ mark: 'bar', encoding: { x: { field: 'region', type: 'nominal' }, y: { field: 'revenue', type: 'quantitative' } } });
  const cases = {
    'lookup from.data.url': [(vl) => { vl.transform = [{ lookup: 'region', from: { data: { url: 'https://evil.test/a.json' }, key: 'k', fields: ['f'] } }]; }, 'charts[0].vegaLite.transform[0].from.data'],
    'image mark url': [(vl) => { vl.mark = { type: 'image', url: 'https://evil.test/i.png' }; }, 'charts[0].vegaLite.mark.url'],
    'url encoding channel': [(vl) => { vl.encoding.url = { value: 'https://evil.test/i.png' }; }, 'charts[0].vegaLite.encoding.url'],
    'usermeta embedOptions': [(vl) => { vl.usermeta = { embedOptions: { actions: true } }; }, 'charts[0].vegaLite.usermeta'],
    'layer data': [(vl) => { delete vl.mark; vl.layer = [bar(), { mark: 'rule', data: { url: 'x' } }]; delete vl.encoding; }, 'charts[0].vegaLite.layer[1].data'],
  };
  for (const [name, [mutate, expected]] of Object.entries(cases)) {
    const s = base();
    s.charts[0].vegaLite = bar();
    mutate(s.charts[0].vegaLite);
    const r = await check(s);
    assert.deepEqual(r.errors.map((e) => e.path), [expected], name);
    assert.match(r.errors[0].message, /not allowed|remove/, name);
  }
});

test('queries calling settings functions are rejected', async () => {
  for (const sql of ["SELECT current_setting('home_directory') AS h", 'SELECT name FROM duckdb_settings()']) {
    const s = base();
    s.queries.total = sql;
    const r = await check(s);
    assert.equal(r.errors[0].path, 'queries.total', sql);
    assert.match(r.errors[0].message, /is not allowed/, sql);
  }
});

test('validate binds queries to the real sources (valid means buildable)', async () => {
  const s = base();
  s.queries.total = 'SELECT SUM(amount) AS revenue FROM nope';
  let r = await check(s);
  assert.equal(r.errors[0].path, 'queries.total');
  assert.equal(r.errors[0].message, 'table "nope" is not allowed; queries may read only the declared sources (sales) and their own CTEs');

  // an unknown table is stopped by the allowlist; an unknown column reaches DuckDB's binder
  const s2 = base();
  s2.queries.total = 'SELECT nosuch FROM sales';
  r = await check(s2);
  assert.match(r.errors[0].message, /nosuch/);
  assert.match(r.errors[0].message, /Candidate bindings|did you mean|Did you mean/i, 'keeps the cause lines');

  const s3 = base();
  s3.queries.total = "SELECT * FROM read_csv('/etc/hosts')";
  r = await check(s3);
  assert.equal(r.errors[0].path, 'queries.total');
});

function outsideProject() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dash-out-')));
  fs.mkdirSync(path.join(root, 'proj/data'), { recursive: true });
  fs.copyFileSync(path.join(FIXTURES, 'data/sales.csv'), path.join(root, 'outside.csv'));
  fs.copyFileSync(path.join(FIXTURES, 'data/sales.csv'), path.join(root, 'proj/data/sales.csv'));
  return { root, dir: path.join(root, 'proj') };
}

test('sources must resolve inside the spec folder unless allowOutside', async () => {
  const { root, dir } = outsideProject();
  const s = base();
  s.sources.sales.path = '../outside.csv';
  let r = await validateSpec(s, { dir });
  assert.deepEqual(r.errors, [{
    path: 'sources.sales.path',
    message: `resolves outside the spec folder (${path.join(root, 'outside.csv')}); move the data under ${dir} or pass --allow-outside`,
  }]);
  r = await validateSpec(s, { dir, allowOutside: true });
  assert.deepEqual(r.errors, []);

  // a symlink inside the folder that points outside is still outside
  fs.symlinkSync(path.join(root, 'outside.csv'), path.join(dir, 'data/link.csv'));
  const s2 = base();
  s2.sources.sales.path = 'data/link.csv';
  r = await validateSpec(s2, { dir });
  assert.match(r.errors[0].message, /^resolves outside the spec folder/);
});

test('sources must be regular files (directory, FIFO)', async () => {
  const { dir } = outsideProject();
  const s = base();
  s.sources.sales.path = 'data';
  let r = await validateSpec(s, { dir });
  assert.equal(r.errors[0].message, `not a regular file: ${path.join(dir, 'data')}`);
  const fifo = path.join(dir, 'data/pipe.csv');
  if (spawnSync('mkfifo', [fifo]).status === 0) {
    s.sources.sales.path = 'data/pipe.csv';
    r = await validateSpec(s, { dir });
    assert.match(r.errors[0].message, /^not a regular file: /);
  }
});

test('reserved DuckDB catalog names cannot be source names', async () => {
  const s = base();
  s.sources.main = s.sources.sales;
  const r = await check(s);
  assert.deepEqual(r.errors, [{ path: 'sources.main', message: '"main" is reserved by DuckDB; choose another source name' }]);
});

test('CLI: unknown flag exits 2, --json reports it, --allow-outside is accepted', () => {
  const r = cli([path.join(EXAMPLES, 'minimal.json'), '--bogus']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Unknown option '--bogus'/);
  const j = cli([path.join(EXAMPLES, 'minimal.json'), '--bogus', '--json']);
  assert.equal(j.status, 2);
  const parsed = JSON.parse(j.stdout);
  assert.equal(parsed.ok, false);
  assert.match(parsed.errors[0].message, /Unknown option/);
  const nf = cli(['/nonexistent.json', '--json']);
  assert.equal(nf.status, 2);
  assert.equal(JSON.parse(nf.stdout).ok, false);
  assert.equal(cli([path.join(EXAMPLES, 'minimal.json'), '--allow-outside']).status, 0);
  assert.equal(cli([path.join(EXAMPLES, 'minimal.json'), '--timeout', 'abc']).status, 2);
});

test('CLI: outside source is an error without --allow-outside and fine with it', () => {
  const { dir } = outsideProject();
  const s = base();
  s.sources.sales.path = '../outside.csv';
  fs.writeFileSync(path.join(dir, 'd.json'), JSON.stringify(s));
  assert.equal(cli([path.join(dir, 'd.json')]).status, 1);
  assert.equal(cli([path.join(dir, 'd.json'), '--allow-outside']).status, 0);
});

test('EVAL_LOG: empty value is ignored, unwritable log cannot change the result, usage errors are logged', () => {
  assert.equal(cli([path.join(EXAMPLES, 'minimal.json')], { EVAL_LOG: '' }).status, 0);
  const dirAsLog = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-'));
  const r = cli([path.join(EXAMPLES, 'minimal.json')], { EVAL_LOG: dirAsLog });
  assert.equal(r.status, 0, 'unwritable EVAL_LOG must not break validation');
  assert.match(r.stdout, /valid/);
  const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dash-')), 'e.log');
  cli([], { EVAL_LOG: log }); // missing argument is a usage error
  const line = JSON.parse(fs.readFileSync(log, 'utf8').trim());
  assert.equal(line.ok, false);
});

test('wrapLimit survives trailing semicolons and comments', async () => {
  const { wrapLimit } = await import('../scripts/lib/sql.mjs');
  assert.equal(wrapLimit('SELECT 1; -- done', 5), 'SELECT * FROM (SELECT 1\n) LIMIT 5');
  assert.equal(wrapLimit('SELECT 1 /* x */ ;;  ', 5), 'SELECT * FROM (SELECT 1\n) LIMIT 5');
  assert.equal(wrapLimit("SELECT 'a--b'", 5), "SELECT * FROM (SELECT 'a--b'\n) LIMIT 5");
  assert.equal(wrapLimit('SELECT 1', 5, '"x"'), 'SELECT "x" FROM (SELECT 1\n) LIMIT 5');
});
