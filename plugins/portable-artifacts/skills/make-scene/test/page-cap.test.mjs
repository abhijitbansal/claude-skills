// The page cap (MAX_PAGE_BYTES) must be one rule everywhere: validate.mjs rejects what build.mjs would reject, the
// alternatives table never offers a world whose page is over the cap, and a heatmap with too many cells is a spec
// error, not a crash. Anything that can exhaust memory runs in a child process under a heap cap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from '../scripts/build.mjs';
import { MAX_PAGE_BYTES } from '../scripts/lib/bundle.mjs';
import { loadSibling } from '../scripts/lib/siblings.mjs';
import { PINNED_ENV, tempDir } from './helpers/scene-fixtures.mjs';

const SCRIPTS = fileURLToPath(new URL('../scripts/', import.meta.url));
const VALIDATE = path.join(SCRIPTS, 'validate.mjs');
const BUILD = path.join(SCRIPTS, 'build.mjs');
const CAP_MESSAGE = /^the page is \d+ KB; the limit is 1408 KB - use fewer rows or fewer groups$/;
const HEAP_MB = 256;
const TIMEOUT_MS = 120_000;

const env = (dir) => ({ ...PINNED_ENV, PA_OUTPUT_DIR: dir });
const specIn = (t, spec) => {
  const dir = tempDir(t, 'scene-cap-');
  const file = path.join(dir, 'scene.json');
  fs.writeFileSync(file, JSON.stringify(spec));
  return { dir, file };
};
const validated = (file, args = []) => {
  const r = spawnSync(process.execPath, [`--max-old-space-size=${HEAP_MB}`, VALIDATE, file, '--json', ...args], { encoding: 'utf8', timeout: TIMEOUT_MS, env: { ...process.env, ...PINNED_ENV, EVAL_LOG: '' } });
  let result = null;
  try {
    result = JSON.parse(r.stdout);
  } catch {
    // no result line: the assertions report the crash
  }
  return { status: r.status, signal: r.signal, stderr: r.stderr, result };
};

// groups x per rows, as the history command would write them.
const gridRows = (groups, per) => Array.from({ length: groups * per }, (_, i) => ({ group: `g${i % groups}`, t: `w${String(Math.floor(i / groups)).padStart(3, '0')}`, value: (i * 7) % 50 }));

test('validate rejects a forest build would reject: 20 groups of 100 rows is over the cap', async (t) => {
  const { dir, file } = specIn(t, { title: 'Forest', world: 'forest', data: { rows: gridRows(20, 100) } });
  const built = await build(file, { env: env(dir) });
  assert.equal(built.ok, false, 'the premise: build refuses this spec');
  assert.match(built.errors[0].message, CAP_MESSAGE);
  const v = validated(file);
  assert.equal(v.status, 1, `validate must refuse too: ${JSON.stringify(v.result)}`);
  assert.deepEqual(v.result.errors, built.errors, 'the same message');
});

test('validate rejects one group of 2000 rows in a forest, and accepts the same rows as a city', async (t) => {
  const rows = Array.from({ length: 2000 }, (_, i) => ({ group: 'only', t: `w${String(i).padStart(4, '0')}`, value: i % 40 }));
  const forest = specIn(t, { title: 'F', world: 'forest', data: { rows } });
  const refused = validated(forest.file);
  assert.equal(refused.status, 1, JSON.stringify(refused.result));
  assert.match(refused.result.errors[0].message, CAP_MESSAGE);
  const city = specIn(t, { title: 'C', world: 'city', data: { rows } });
  assert.deepEqual(validated(city.file).result, { ok: true, errors: [] });
});

test('validate and build agree on a spec just under the cap: both pass', async (t) => {
  const { dir, file } = specIn(t, { title: 'City', world: 'city', data: { rows: gridRows(24, 83) } });
  const built = await build(file, { env: env(dir), out: path.join(dir, 'city.html') });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  assert.ok(built.bytes < MAX_PAGE_BYTES && built.bytes > MAX_PAGE_BYTES * 0.7, `${built.bytes} bytes`);
  assert.deepEqual(validated(file).result, { ok: true, errors: [] });
});

test('the alternatives table lists an over-cap world as not available, with no switch command', async (t) => {
  const { dir, file } = specIn(t, { title: 'City', world: 'city', data: { rows: gridRows(24, 83) } });
  const built = await build(file, { env: env(dir), out: path.join(dir, 'city.html') });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  const over = built.alternatives.filter((a) => a.eligible === false && a.unavailable === 'over the page limit');
  assert.ok(over.some((a) => a.world === 'forest'), `forest is over the cap: ${JSON.stringify(built.alternatives)}`);
  for (const alt of built.alternatives.filter((a) => a.eligible)) assert.ok(alt.estBytes <= MAX_PAGE_BYTES, `${alt.world} is offered at ${alt.estBytes} bytes`);
  for (const alt of over) {
    const line = built.table.split('\n').find((l) => l.startsWith(alt.world));
    assert.match(line, /not available: over the page limit/, line);
    assert.doesNotMatch(line, /--world|build\.mjs/, `${alt.world} has no switch command`);
  }
});

test('--world to an over-cap world fails with the cap message and leaves scene.json alone', async (t) => {
  const { dir, file } = specIn(t, { title: 'City', world: 'city', data: { rows: gridRows(24, 83) } });
  const before = fs.readFileSync(file, 'utf8');
  const out = path.join(dir, 'out');
  const result = await build(file, { world: 'forest', env: env(out), out });
  assert.equal(result.ok, false);
  assert.match(result.errors[0].message, CAP_MESSAGE);
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'scene.json is byte-identical');
  assert.equal(fs.existsSync(out), false, 'no page was written');
  const cli = spawnSync(process.execPath, [BUILD, file, '--world', 'forest', '--out', out], { encoding: 'utf8', timeout: TIMEOUT_MS, env: { ...process.env, ...PINNED_ENV } });
  assert.equal(cli.status, 1);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

// ---- the heatmap lift --------------------------------------------------------------------------

let skipReason;
try {
  await loadSibling('make-dashboard', 'scripts/lib/pipeline.mjs');
} catch (e) {
  skipReason = `make-dashboard is not loadable (${String(e.message).split('\n')[0]})`;
}
const dtest = (name, fn) => test(name, { skip: skipReason }, fn);

// A heatmap of n x n distinct values, one row each, made by SQL (no data files).
function heatmapOf(t, n) {
  const dir = tempDir(t, 'scene-heat-');
  const sql = `SELECT 'x' || i::VARCHAR AS xc, 'y' || i::VARCHAR AS yc, 1.0::DOUBLE AS v FROM range(${n}) AS r(i)`;
  fs.writeFileSync(path.join(dir, 'dashboard.json'), JSON.stringify({ title: 'T', sources: {}, queries: { q: sql }, charts: [{ id: 'c', title: 'C', query: 'q', kind: 'heatmap', x: 'xc', y: 'yc', value: 'v' }] }));
  const file = path.join(dir, 'scene.json');
  fs.writeFileSync(file, JSON.stringify({ title: 'Heat', lift: { dashboard: 'dashboard.json', chart: 'c' } }));
  return { dir, file };
}

dtest('validate rejects a heatmap whose page is over the cap, as build does', async (t) => {
  const { dir, file } = heatmapOf(t, 100);
  const built = await build(file, { env: env(dir) });
  assert.equal(built.ok, false, 'the premise: 100 sparse rows build to an over-cap page');
  assert.match(built.errors[0].message, CAP_MESSAGE);
  const v = validated(file);
  assert.equal(v.status, 1, `validate must refuse too: ${JSON.stringify(v.result)} ${v.stderr.split('\n')[0]}`);
  assert.deepEqual(v.result.errors, built.errors);
});

dtest('a heatmap with 1,700 distinct values per axis is a spec error naming the limit, never an internal error', (t) => {
  const { file } = heatmapOf(t, 1700);
  const v = validated(file);
  assert.equal(v.signal, null, `validate must not be killed (${v.signal}); ${v.stderr.split('\n')[0]}`);
  assert.equal(v.status, 1);
  const [first] = v.result.errors;
  assert.equal(first.path, 'lift.chart');
  assert.doesNotMatch(first.message, /internal error|Invalid array length/);
  assert.match(first.message, /chart "c"/);
  assert.match(first.message, /at most 20000/);
});

dtest('a small heatmap still validates', (t) => {
  const { file } = heatmapOf(t, 6);
  assert.deepEqual(validated(file).result, { ok: true, errors: [] });
});
