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
