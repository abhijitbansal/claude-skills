import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INSPECT = path.join(ROOT, 'scripts/inspect.mjs');
const DATA = path.join(ROOT, 'test/fixtures/data');
const run = (args, cwd) => spawnSync(process.execPath, [INSPECT, ...args], { encoding: 'utf8', cwd });

test('prints column names, types and 5 sample rows for csv and parquet', () => {
  for (const f of ['sales.csv', 'sales.parquet']) {
    const r = run([f], DATA);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^columns:$/m);
    assert.match(r.stdout, /^ {2}date +DATE$/m);
    assert.match(r.stdout, /^ {2}amount +DOUBLE$/m);
    assert.match(r.stdout, /^sample \(5 rows\):$/m);
    assert.equal(r.stdout.split('\n').filter((l) => l.startsWith('  {')).length, 5);
  }
});

test('prints per-column distinct count, min, max and null share', () => {
  const r = run(['sales.csv'], DATA);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^summary:$/m);
  assert.match(r.stdout, /^ {2}region +distinct ~?4 +min East +max West +null 0%$/m);
  assert.match(r.stdout, /^ {2}date +distinct ~?\d+ +min 2025-01-\d\d +max 2025-\d\d-\d\d +null 0%$/m);
  const j = JSON.parse(run(['sales.csv', '--json'], DATA).stdout);
  const region = j.summary.find((c) => c.name === 'region');
  assert.equal(region.min, 'East');
  assert.equal(region.max, 'West');
  assert.equal(region.nullShare, 0);
  assert.equal(typeof region.distinct, 'number');
});

test('a summary that cannot be computed never hides the columns and sample rows', () => {
  // the CSV sniffer types n from the first rows; the full scan SUMMARIZE needs then hits the text row
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dash-insp-dirty-')));
  const lines = ['n', ...Array.from({ length: 25000 }, (_, i) => String(i)), 'not a number'];
  fs.writeFileSync(path.join(dir, 'dirty.csv'), `${lines.join('\n')}\n`);
  const r = run(['dirty.csv'], dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^sample \(5 rows\):$/m);
  assert.match(r.stdout, /^summary: unavailable \(.+\)$/m);
  const j = JSON.parse(run(['dirty.csv', '--json'], dir).stdout);
  assert.equal(j.rows.length, 5);
  assert.deepEqual(j.summary, []);
  assert.match(j.summaryError, /\S/);
});

test('--json prints machine-readable output', () => {
  const r = run(['sales.csv', '--json'], DATA);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.columns.map((c) => c.name), ['date', 'region', 'product', 'amount', 'units']);
  assert.equal(out.rows.length, 5);
});

test('files outside the working directory need --allow-outside', () => {
  const cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dash-insp-')));
  const r = run([path.join(DATA, 'sales.csv')], cwd);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /resolves outside the spec folder|outside the working folder/);
  assert.equal(run([path.join(DATA, 'sales.csv'), '--allow-outside'], cwd).status, 0);
});

test('usage errors exit 2', () => {
  assert.equal(run([], DATA).status, 2);
  assert.equal(run(['nope.csv'], DATA).status, 2);
  assert.equal(run(['sales.csv', '--bogus'], DATA).status, 2);
  assert.equal(run(['package.txt'], DATA).status, 2);
});

// ---- --spec / --source / --table ------------------------------------------


function specDir(sources = { sales: { type: 'csv', path: 'data/sales.csv' } }) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dash-insp-spec-')));
  fs.cpSync(DATA, path.join(dir, 'data'), { recursive: true });
  const spec = { title: 't', sources, queries: { q: 'SELECT 1 AS n' } };
  fs.writeFileSync(path.join(dir, 'dashboard.json'), JSON.stringify(spec));
  return dir;
}

test('--spec --source shows a declared file source (columns plus 5 rows)', () => {
  const dir = specDir();
  const r = run(['--spec', 'dashboard.json', '--source', 'sales'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^ {2}region +VARCHAR$/m);
  assert.equal(r.stdout.split('\n').filter((l) => l.startsWith('  {')).length, 5);
});

test('--spec problems exit 2 with one line', () => {
  const dir = specDir();
  let r = run(['--spec', 'dashboard.json'], dir);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--source/);
  r = run(['--spec', 'dashboard.json', '--source', 'nope'], dir);
  assert.equal(r.status, 2);
  assert.equal(r.stderr.trim(), 'unknown source "nope"; the spec declares: sales');
  r = run(['--spec', 'dashboard.json', '--source', 'sales', '--table', ''], dir);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--table needs a table name/);
  r = run(['--spec', 'dashboard.json', '--source', 'sales', '--table', 't'], dir);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--table only applies to attached sources/);
  r = run(['sales.csv', '--spec', 'dashboard.json', '--source', 'sales'], dir);
  assert.equal(r.status, 2);
  r = run(['--spec', 'missing.json', '--source', 'sales'], dir);
  assert.equal(r.status, 2);
});

test('--spec validates the whole spec first: an injected source type writes nothing and exits 1', () => {
  const dir = specDir();
  const marker = path.join(dir, 'pwned.csv');
  const spec = {
    title: 't',
    sources: { x: { type: `duckdb); COPY (SELECT 42 AS pwned) TO '${marker}'; SELECT (1`, env: 'HOME' } },
    queries: { q: 'SELECT 1' },
  };
  fs.writeFileSync(path.join(dir, 'evil.json'), JSON.stringify(spec));
  const r = run(['--spec', 'evil.json', '--source', 'x'], dir);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^sources\.x\.type: must be one of "csv", "parquet"/m);
  assert.ok(!fs.existsSync(marker), 'the COPY must not run');
});

test('--spec works on a draft whose queries do not bind yet (table discovery comes first)', () => {
  const dir = specDir();
  const spec = JSON.parse(fs.readFileSync(path.join(dir, 'dashboard.json'), 'utf8'));
  spec.queries.q = 'SELECT not_a_column_yet FROM sales';
  spec.charts = [{ id: 'c1', title: 'C', query: 'q', kind: 'bar', x: 'not_a_column_yet', y: 'n' }];
  fs.writeFileSync(path.join(dir, 'dashboard.json'), JSON.stringify(spec));
  const r = run(['--spec', 'dashboard.json', '--source', 'sales'], dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^ {2}region +VARCHAR$/m);
});

test('--spec honours --allow-outside like validate', () => {
  const dir = specDir({ sales: { type: 'csv', path: '../outside.csv' } });
  fs.copyFileSync(path.join(DATA, 'sales.csv'), path.join(dir, '..', 'outside.csv'));
  assert.equal(run(['--spec', 'dashboard.json', '--source', 'sales'], dir).status, 1);
  const r = run(['--spec', 'dashboard.json', '--source', 'sales', '--allow-outside'], dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
