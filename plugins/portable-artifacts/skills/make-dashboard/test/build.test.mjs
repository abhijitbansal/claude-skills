import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadSpec } from '../scripts/lib/spec.mjs';
import { toJsonSafe, runQueries, checkFields } from '../scripts/lib/data.mjs';
import { escapeHtml, jsonForScript } from '../scripts/lib/html.mjs';
import { openLockedDb } from '../scripts/lib/sql.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(ROOT, 'test/fixtures');
const EXAMPLE = path.join(ROOT, 'references/examples/sales-overview.json');
const BUILD = path.join(ROOT, 'scripts/build.mjs');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dash-build-'));

// A project dir holding a copy of the fixture data and the given spec.
function project(overrides = {}) {
  const dir = tmp();
  fs.cpSync(path.join(FIXTURES, 'data'), path.join(dir, 'data'), { recursive: true });
  const spec = {
    title: 'T',
    sources: { sales: { type: 'csv', path: 'data/sales.csv' } },
    queries: { rev: 'SELECT region, SUM(amount) AS revenue FROM sales GROUP BY 1 ORDER BY 2 DESC' },
    charts: [{
      id: 'c1', title: 'Chart', query: 'rev',
      vegaLite: { mark: 'bar', encoding: { x: { field: 'region', type: 'nominal' }, y: { field: 'revenue', type: 'quantitative' } } },
    }],
    ...overrides,
  };
  const file = path.join(dir, 'dashboard.json');
  fs.writeFileSync(file, JSON.stringify(spec));
  return { dir, file, spec };
}

const build = (args, opts = {}) => spawnSync(process.execPath, [BUILD, ...args], { encoding: 'utf8', ...opts });
const readPage = (out) => fs.readFileSync(path.join(out, 'index.html'), 'utf8');
function dataBlock(html) {
  const m = html.match(/<script type="application\/json" id="dash-data">([\s\S]*?)<\/script>/);
  assert.ok(m, 'data block present');
  return m[1];
}

test('escapeHtml and jsonForScript neutralise markup', () => {
  assert.equal(escapeHtml(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  const out = jsonForScript({ s: '</script><img onerror=1>  ' });
  assert.ok(!out.includes('<'));
  assert.ok(!out.includes(' ') && !out.includes(' '));
  assert.equal(JSON.parse(out).s, '</script><img onerror=1>  ');
});

test('toJsonSafe converts DuckDB value types', () => {
  assert.equal(toJsonSafe(5n), 5);
  assert.equal(toJsonSafe(123456789012345678901n), '123456789012345678901');
  assert.equal(toJsonSafe(new Date('2024-01-02T03:04:05.000Z')), '2024-01-02T03:04:05.000Z');
  assert.equal(toJsonSafe(null), null);
  assert.equal(toJsonSafe(NaN), null);
  assert.equal(toJsonSafe(1.5), 1.5);
  assert.deepEqual(toJsonSafe([1n, { a: 2n }]), [1, { a: 2 }]);
});

test('build the example: self-contained, provenance visible', () => {
  const out = tmp();
  const r = build([EXAMPLE, '--out', out]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const html = readPage(out);
  assert.doesNotMatch(html, /<script[^>]*\ssrc=/i);
  assert.doesNotMatch(html, /<link[^>]*href=["']https?:/i);
  assert.match(html, /SUM\(amount\) AS revenue FROM sales GROUP BY 1 ORDER BY 2 DESC/);
  assert.match(html, /4 rows/); // rev_by_region
  assert.match(html, /<details>\s*<summary>Query · 4 rows · refreshed /);
  assert.match(r.stdout, /rev_by_region.*4 rows/);
  assert.match(r.stdout, new RegExp(path.join(out, 'index.html').replace(/[\\.]/g, '\\$&')));
});

test('Review Focus 1: spec paths resolve against the spec file, not the cwd', () => {
  const out = tmp();
  const cwd = fs.realpathSync(os.tmpdir());
  const rel = path.relative(cwd, EXAMPLE);
  const r = build([rel, '--out', out], { cwd });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.ok(fs.existsSync(path.join(out, 'index.html')));
});

test('default --out is <specdir>/dist', () => {
  const p = project();
  const r = build([p.file], { cwd: os.tmpdir() });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(p.dir, 'dist/index.html')));
});

test('Review Focus 2: BIGINT, DECIMAL, DATE, TIMESTAMP, NULL and huge ints survive', async () => {
  const p = project({
    queries: {
      types: `SELECT 9007199254740993::BIGINT AS big, 1::BIGINT AS small, 12.34::DECIMAL(10,2) AS dec,
        DATE '2024-01-02' AS d, TIMESTAMP '2024-01-02 03:04:05' AS ts, NULL AS n,
        123456789012345678901234::HUGEINT AS huge, 'x' AS s`,
    },
    charts: [{
      id: 'c1', title: 'Types', query: 'types',
      vegaLite: { mark: 'bar', encoding: { x: { field: 's', type: 'nominal' }, y: { field: 'small', type: 'quantitative' } } },
    }],
  });
  const r = build([p.file]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const data = JSON.parse(dataBlock(readPage(path.join(p.dir, 'dist'))));
  const row = data.queries.types.rows[0];
  assert.equal(row.big, '9007199254740993');
  assert.equal(row.small, 1);
  assert.equal(row.dec, 12.34);
  assert.equal(row.d, '2024-01-02');
  assert.equal(row.ts, '2024-01-02T03:04:05.000Z');
  assert.equal(row.n, null);
  assert.equal(row.huge, '123456789012345678901234');
  assert.equal(row.s, 'x');
});

test('Review Focus 3: malicious strings cannot break out of the page', () => {
  const evil = '</script><img src=x onerror=alert(1)>';
  const p = project({
    title: evil,
    description: evil,
    queries: { q: `SELECT '${evil}' AS region, 1 AS revenue -- ${evil}` },
    charts: [{
      id: 'c1', title: evil, query: 'q',
      vegaLite: { mark: 'bar', encoding: { x: { field: 'region', type: 'nominal' }, y: { field: 'revenue', type: 'quantitative' } } },
    }],
  });
  const r = build([p.file]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const html = readPage(path.join(p.dir, 'dist'));
  const block = dataBlock(html);
  assert.ok(!block.includes('<'), 'no raw < in data block');
  assert.ok(!html.includes('<img src=x'), 'no injected element anywhere');
  assert.ok(!html.includes('</script><img'));
  assert.match(html, /&lt;\/script&gt;&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.equal(JSON.parse(block).queries.q.rows[0].region, evil);
});

test('Review Focus 4: empty and truncated results are labelled', () => {
  const p = project({
    maxRows: 2,
    queries: {
      empty: 'SELECT * FROM sales WHERE false',
      many: 'SELECT * FROM sales',
    },
    charts: [
      { id: 'c1', title: 'Empty', query: 'empty', vegaLite: { mark: 'bar', encoding: { x: { field: 'region', type: 'nominal' } } } },
      { id: 'c2', title: 'Many', query: 'many', vegaLite: { mark: 'bar', encoding: { x: { field: 'region', type: 'nominal' } } } },
    ],
  });
  const r = build([p.file]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const html = readPage(path.join(p.dir, 'dist'));
  assert.match(html, /0 rows/);
  assert.match(html, /truncated at 2/);
  const data = JSON.parse(dataBlock(html));
  assert.equal(data.queries.many.rows.length, 2);
  assert.equal(data.queries.many.truncated, true);
  assert.equal(data.queries.empty.truncated, false);
  assert.equal(data.queries.empty.rowCount, 0);
});

test('Review Focus 1: a kind chart over zero rows builds, says so, and still offers the table', () => {
  const p = project({
    queries: { none: 'SELECT region, SUM(amount) AS revenue FROM sales WHERE 1 = 0 GROUP BY 1' },
    charts: [{ id: 'c1', title: 'Nothing', query: 'none', kind: 'bar', x: 'region', y: 'revenue' }],
  });
  const r = build([p.file]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const html = readPage(path.join(p.dir, 'dist'));
  assert.match(html, /<p class="meta empty">No rows returned<\/p>/);
  const chart = JSON.parse(dataBlock(html)).charts[0];
  assert.equal(chart.empty, true);
  assert.deepEqual(chart.views.map((v) => v.name), ['bar', 'table']);
});

test('field typo is caught with a did-you-mean', () => {
  const p = project();
  const spec = JSON.parse(fs.readFileSync(p.file, 'utf8'));
  spec.charts[0].vegaLite.encoding.y.field = 'revnue';
  fs.writeFileSync(p.file, JSON.stringify(spec));
  const r = build([p.file]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^charts\[0\]\.vegaLite\.encoding\.y\.field: "revnue" is not a column of query "rev" \(columns: region, revenue\); did you mean "revenue"\?$/m);
  assert.ok(!fs.existsSync(path.join(p.dir, 'dist/index.html')));
});

test('checkFields walks layers, honours transform `as`, and checks KPI fields', () => {
  const results = { q: { columns: ['a', 'b'] } };
  const spec = {
    kpis: [{ id: 'k', title: 'k', query: 'q', field: 'zz' }],
    charts: [{
      id: 'c', title: 'c', query: 'q',
      vegaLite: {
        transform: [{ calculate: 'datum.a * 2', as: 'double' }],
        layer: [
          { mark: 'bar', encoding: { x: { field: 'a' }, y: { field: 'double' } } },
          { mark: 'rule', encoding: { y: { field: 'c' }, x: { aggregate: 'count' } } },
        ],
      },
    }],
  };
  const errs = checkFields(spec, results);
  assert.deepEqual(errs.map((e) => e.path), ['kpis[0].field', 'charts[0].vegaLite.layer[1].encoding.y.field']);
  assert.match(errs[1].message, /"c" is not a column of query "q" \(columns: a, b\); did you mean "a"\?/);
});

test('lockdown: queries cannot read undeclared files', async () => {
  const p = project();
  const secret = path.join(tmp(), 'secret.csv');
  fs.writeFileSync(secret, 'x\n1\n');
  for (const sql of [`SELECT * FROM read_csv('${secret}')`, `SELECT * FROM read_csv('${path.join(p.dir, 'data/../../secret.csv')}')`]) {
    const spec = { ...p.spec, queries: { leak: sql }, charts: [] };
    await assert.rejects(runQueries(spec, p.dir, { now: new Date() }), (e) => {
      assert.equal(e.errors[0].path, 'queries.leak');
      assert.match(e.errors[0].message, /permission|not allowed|disabled|access/i);
      return true;
    });
  }
});

test('lockdown: the locked connection refuses every unlock attempt', async () => {
  const p = project();
  const db = await openLockedDb(p.spec, p.dir);
  try {
    // Each statement runs directly on the locked connection; removing
    // `SET lock_configuration=true` from openLockedDb makes these succeed.
    for (const sql of ['SET enable_external_access=true', "SET allowed_paths=['/etc/hosts']", "SET allowed_directories=['/etc']", 'SET lock_configuration=false']) {
      await assert.rejects(db.conn.run(sql), /locked/i, sql);
    }
    await assert.rejects(db.conn.run("SELECT * FROM read_csv('/etc/hosts')"), /Permission Error/);
  } finally { db.close(); }
});

test('declared sources still read after lockdown, results carry metadata', async () => {
  const p = project();
  const res = await runQueries(p.spec, p.dir, { now: new Date('2026-01-01T00:00:00Z') });
  assert.equal(res.rev.rowCount, 4);
  assert.deepEqual(res.rev.columns, ['region', 'revenue']);
  assert.equal(res.rev.refreshedAt, '2026-01-01T00:00:00.000Z');
  assert.match(res.rev.sql, /SUM\(amount\)/);
});

test('loadSpec + runQueries on the example (parquet + csv sources)', async () => {
  const { spec, dir } = loadSpec(EXAMPLE);
  const res = await runQueries(spec, dir, { now: new Date() });
  assert.equal(res.rev_by_quarter_region.rowCount > 4, true);
  assert.equal(res.total.rows[0].revenue > 0, true);
});

test('page carries a restrictive CSP and fixed embed options', () => {
  const out = tmp();
  assert.equal(build([EXAMPLE, '--out', out]).status, 0);
  const html = readPage(out);
  const csp = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/);
  assert.ok(csp, 'CSP meta present');
  assert.equal(csp[1], "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:");
  assert.ok(html.indexOf('Content-Security-Policy') < html.indexOf('<style>'), 'CSP comes before any content');
  assert.match(html, /ast: true/);
  assert.match(html, /actions: false/);
});

test('build prints each resolved source path and a serve hint', () => {
  const out = tmp();
  const r = build([EXAMPLE, '--out', out]);
  const dataDir = fs.realpathSync(path.join(ROOT, 'references/examples/data'));
  assert.match(r.stdout, new RegExp(`^source sales: ${path.join(dataDir, 'sales.parquet').replace(/[\\.]/g, '\\$&')}$`, 'm'));
  assert.match(r.stdout, /^serve: node .*serve\.mjs/m);
});

test('build refuses sources outside the spec folder unless --allow-outside', () => {
  const root = fs.realpathSync(tmp());
  fs.mkdirSync(path.join(root, 'proj'));
  fs.copyFileSync(path.join(FIXTURES, 'data/sales.csv'), path.join(root, 'outside.csv'));
  const spec = { title: 'T', sources: { sales: { type: 'csv', path: '../outside.csv' } }, queries: { q: 'SELECT 1 AS n FROM sales LIMIT 1' } };
  fs.writeFileSync(path.join(root, 'proj/d.json'), JSON.stringify(spec));
  const r = build([path.join(root, 'proj/d.json')]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^sources\.sales\.path: resolves outside the spec folder \(.*outside\.csv\); move the data under .*proj or pass --allow-outside$/m);
  const ok = build([path.join(root, 'proj/d.json'), '--allow-outside']);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
});

test('build IO errors are one-line usage errors (exit 2)', () => {
  const blocker = path.join(tmp(), 'file');
  fs.writeFileSync(blocker, 'x');
  const r = build([EXAMPLE, '--out', path.join(blocker, 'sub')]);
  assert.equal(r.status, 2);
  assert.equal(r.stderr.trim().split('\n').length, 1);
  assert.match(r.stderr, /cannot write/);
  const bad = build([EXAMPLE, '--bogus']);
  assert.equal(bad.status, 2);
  const timeoutBad = build([EXAMPLE, '--timeout', '0']);
  assert.equal(timeoutBad.status, 2);
});

test('build --json reports success and failure as JSON', () => {
  const out = tmp();
  const ok = build([EXAMPLE, '--out', out, '--json']);
  assert.equal(ok.status, 0);
  const parsed = JSON.parse(ok.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.queries.rev_by_region.rowCount, 4);
  const bad = build(['--json']);
  assert.equal(bad.status, 2);
  assert.equal(JSON.parse(bad.stdout).ok, false);
});

test('query timeout interrupts a runaway query', async () => {
  const p = project();
  const spec = { ...p.spec, queries: { slow: 'SELECT max(a.range * b.range) AS m FROM range(1000000) a, range(1000000) b' }, charts: [] };
  const started = Date.now();
  await assert.rejects(runQueries(spec, p.dir, { now: new Date(), timeoutMs: 400 }), (e) => {
    assert.equal(e.errors[0].path, 'queries.slow');
    assert.match(e.errors[0].message, /timed out after 0\.4s/);
    return true;
  });
  assert.ok(Date.now() - started < 10000);
});

test('Review Focus 2+: exotic DuckDB types become JSON-safe values', async () => {
  const p = project({
    queries: {
      exotic: `SELECT DATE 'infinity' AS d_inf, TIMESTAMP 'infinity' AS ts_inf, DATE '2024-01-02' AS d,
        TIMESTAMPTZ '2024-01-02 03:04:05+00' AS tz, TIME '01:02:03.5' AS t, INTERVAL 3 DAY AS iv,
        '\\xAA\\xBB'::BLOB AS b, '101'::BIT AS bt,
        12.5::DECIMAL(38,2) AS dec_small, 1234567890123456789012.34::DECIMAL(30,2) AS dec_big,
        [DATE '2024-01-02', DATE 'infinity'] AS l,
        {'a': 9007199254740993::BIGINT, 'b': TIMESTAMP '2024-01-02 03:04:05', 'c': [1, NULL]} AS s,
        NULL::DATE AS nd`,
    },
    charts: [{ id: 'c1', title: 'x', query: 'exotic', vegaLite: { mark: 'bar', encoding: { x: { field: 'd', type: 'nominal' } } } }],
  });
  const r = build([p.file]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const row = JSON.parse(dataBlock(readPage(path.join(p.dir, 'dist')))).queries.exotic.rows[0];
  assert.equal(row.d_inf, 'infinity');
  assert.equal(row.ts_inf, 'infinity');
  assert.equal(row.d, '2024-01-02');
  assert.equal(row.tz, '2024-01-02T03:04:05.000Z');
  assert.equal(row.t, '01:02:03.5');
  assert.equal(row.iv, '3 days');
  assert.equal(row.b, '<blob 2 bytes>');
  assert.equal(row.bt, '<bit 3 bits>');
  assert.equal(row.dec_small, 12.5);
  assert.equal(row.dec_big, '1234567890123456789012.34');
  assert.deepEqual(row.l, ['2024-01-02', 'infinity']);
  assert.equal(row.s.a, '9007199254740993');
  assert.equal(row.s.b, '2024-01-02 03:04:05'); // nested values keep DuckDB's text form
  assert.deepEqual(row.s.c, [1, null]);
  assert.equal(row.nd, null);
});

test('checkFields covers facet row/column and sort.field', () => {
  const results = { q: { columns: ['a', 'b'] } };
  const spec = {
    charts: [{
      id: 'c', title: 'c', query: 'q',
      vegaLite: {
        facet: { row: { field: 'zz' }, column: { field: 'a' } },
        spec: { mark: 'bar', encoding: { x: { field: 'a', sort: { field: 'nope', op: 'sum' } }, y: { field: 'b', sort: { encoding: 'x' } } } },
      },
    }],
  };
  const errs = checkFields(spec, results);
  assert.deepEqual(errs.map((e) => e.path), [
    'charts[0].vegaLite.facet.row.field',
    'charts[0].vegaLite.spec.encoding.x.sort.field',
  ]);
});

test('build output has no "N rows" note under the chart, only a truncation note', () => {
  const out = tmp();
  build([EXAMPLE, '--out', out]);
  assert.doesNotMatch(readPage(out), /<p class="meta">\d+ rows/);
});
