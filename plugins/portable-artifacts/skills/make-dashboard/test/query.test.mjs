import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const QUERY = path.join(ROOT, 'scripts/query.mjs');
const DATA = path.join(ROOT, 'test/fixtures/data');
const run = (args) => spawnSync(process.execPath, [QUERY, ...args], { encoding: 'utf8', cwd: os.tmpdir() });

function project(spec) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dash-query-')));
  fs.cpSync(DATA, path.join(dir, 'data'), { recursive: true });
  const file = path.join(dir, 'dashboard.json');
  fs.writeFileSync(file, JSON.stringify(spec));
  return file;
}

const SPEC = {
  title: 'T',
  sources: { sales: { type: 'csv', path: 'data/sales.csv' } },
  queries: {
    by_region: 'SELECT region, SUM(amount) AS revenue FROM sales GROUP BY 1 ORDER BY 2 DESC',
    rows: 'SELECT * FROM sales ORDER BY date',
  },
  charts: [
    { id: 'rev', title: 'Revenue by region', query: 'by_region', kind: 'bar', x: 'region', y: 'revenue' },
    { id: 'all', title: 'All sales', query: 'rows', kind: 'histogram', value: 'amount' },
  ],
};

test('prints the chart query rows, so a title can state what they show', () => {
  const r = run([project(SPEC), '--chart', 'rev']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^chart rev \(query by_region\): 4 rows$/m);
  assert.match(r.stdout, /^columns: region VARCHAR, revenue DOUBLE$/m);
  const rows = r.stdout.split('\n').filter((l) => l.startsWith('  {')).map((l) => JSON.parse(l));
  assert.equal(rows.length, 4);
  assert.deepEqual(Object.keys(rows[0]), ['region', 'revenue']);
  assert.ok(rows[0].revenue >= rows[1].revenue, 'query order is kept');
});

test('--limit caps the printed rows and says how many were left out', () => {
  const r = run([project(SPEC), '--chart', 'all', '--limit', '3']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^chart all \(query rows\): 40 rows$/m);
  assert.equal(r.stdout.split('\n').filter((l) => l.startsWith('  {')).length, 3);
  assert.match(r.stdout, /^ {2}… 37 more rows$/m);
});

test('--json prints rows, columns and counts', () => {
  const j = JSON.parse(run([project(SPEC), '--chart', 'rev', '--json']).stdout);
  assert.equal(j.ok, true);
  assert.equal(j.chart, 'rev');
  assert.equal(j.query, 'by_region');
  assert.equal(j.rowCount, 4);
  assert.deepEqual(j.columns, [{ name: 'region', type: 'VARCHAR' }, { name: 'revenue', type: 'DOUBLE' }]);
  assert.equal(j.rows.length, 4);
});

test('an unknown chart id suggests the close one and exits 1', () => {
  const r = run([project(SPEC), '--chart', 'revv']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /chart "revv" not found in the dashboard; did you mean "rev"\?/);
});

test('usage problems exit 2; --help exits 0', () => {
  assert.equal(run([project(SPEC)]).status, 2, 'needs --chart');
  assert.equal(run([project(SPEC), '--chart', 'rev', '--limit', '0']).status, 2);
  assert.equal(run([project(SPEC), '--chart', 'rev', '--bogus']).status, 2);
  assert.equal(run(['/nonexistent.json', '--chart', 'rev']).status, 2);
  const help = run(['--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /usage: node scripts\/query\.mjs <spec\.json> --chart <id>/);
});
