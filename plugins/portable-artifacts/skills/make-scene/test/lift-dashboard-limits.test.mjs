// Dashboard lifts at the edges of float precision: tiny, equal-within-noise and enormous values must give a
// drawn chart or a spec error, never a hang, an out-of-memory crash or "internal error". Anything that can hang or
// exhaust memory runs in a child process under a timeout and a heap cap, so a regression cannot wedge the suite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadSibling } from '../scripts/lib/siblings.mjs';
import { AxisError, valueAxis } from '../scripts/lifts/dashboard-frame.mjs';
import { tempDir } from './helpers/scene-fixtures.mjs';

const SCRIPTS = fileURLToPath(new URL('../scripts/', import.meta.url));
const VALIDATE = path.join(SCRIPTS, 'validate.mjs');
const DASHBOARD = 'dashboard.json';
const HEAP_MB = 128;
const TIMEOUT_MS = 60_000;

let skipReason;
let niceStep;
try {
  niceStep = (await loadSibling('make-dashboard', 'scripts/lib/axis-ticks.mjs')).niceStep;
} catch (e) {
  skipReason = `make-dashboard is not loadable (${String(e.message).split('\n')[0]})`;
}
const dtest = (name, fn) => test(name, { skip: skipReason }, fn);

// A dashboard folder with one query (no data files: the SQL makes the rows) and one chart.
function dashboardWith(t, sql, chart) {
  const dir = tempDir(t, 'scene-limits-');
  fs.writeFileSync(path.join(dir, DASHBOARD), JSON.stringify({ title: 'T', sources: {}, queries: { q: sql }, charts: [{ id: 'c', title: 'C', query: 'q', ...chart }] }));
  fs.writeFileSync(path.join(dir, 'scene.json'), JSON.stringify({ title: 'T', lift: { dashboard: DASHBOARD, chart: 'c' } }));
  return dir;
}

const child = (args, input) => spawnSync(process.execPath, [`--max-old-space-size=${HEAP_MB}`, ...args], {
  encoding: 'utf8', timeout: TIMEOUT_MS, env: { ...process.env, EVAL_LOG: '' }, input,
});

// validate.mjs as a user runs it: { status, signal, result } with the --json line parsed.
function validated(dir) {
  const r = child([VALIDATE, path.join(dir, 'scene.json'), '--json']);
  let result = null;
  try {
    result = JSON.parse(r.stdout);
  } catch {
    // a crash prints no result; the assertions say so
  }
  return { status: r.status, signal: r.signal, stderr: r.stderr, result };
}

// The lifted graph, read in a child process: { items: [{ label, value }], fallback: its kind, hasSvg }.
function lifted(dir) {
  const code = `
    import { liftDashboard } from ${JSON.stringify(pathToFileURL(path.join(SCRIPTS, 'lifts/dashboard.mjs')).href)};
    import { loadTheme } from ${JSON.stringify(pathToFileURL(path.join(SCRIPTS, '../shared/theme.mjs')).href)};
    const g = await liftDashboard({ dashboard: ${JSON.stringify(DASHBOARD)}, chart: 'c' }, { dir: ${JSON.stringify(dir)}, theme: loadTheme('dusk') });
    process.stdout.write(JSON.stringify({ items: g.items.map((i) => ({ label: i.label, value: i.value })), fallback: g.fallback.kind, hasSvg: Boolean(g.fallback.svg) }));
  `;
  const r = child(['--input-type=module'], code);
  assert.equal(r.status, 0, `the lift must finish (status ${r.status}, signal ${r.signal}): ${r.stderr.split('\n').slice(0, 3).join(' | ')}`);
  return JSON.parse(r.stdout);
}
const liftedItems = (dir) => lifted(dir).items;

const asSpecError = (v) => {
  assert.equal(v.signal, null, `validate must not be killed (${v.signal})`);
  assert.equal(v.status, 1, `exit 1 (a spec error): ${v.stderr.split('\n')[0]}`);
  const [first] = v.result.errors;
  assert.doesNotMatch(first.message, /internal error/);
  return first;
};

// ---- F1: the value axis ----------------------------------------------------------------------

dtest('valueAxis: a value range of 1e-11 still gets a handful of increasing ticks (the loop used to spin forever)', () => {
  // clean() rounded every tick to 10 decimals, so clean(0 + 2e-12) was 0 and the loop never advanced.
  const axis = valueAxis(0, 2e-11, niceStep);
  assert.ok(axis.ticks.length >= 2 && axis.ticks.length <= 12, `ticks: ${axis.ticks.length}`);
  assert.ok(axis.ticks.every((v, i) => Number.isFinite(v) && (i === 0 || v > axis.ticks[i - 1])), 'finite and strictly increasing');
  assert.ok(axis.ticks.at(-1) >= 2e-11 - axis.step / 2, 'reaches the data');
  assert.ok(Number.isFinite(axis.k) && axis.k > 0);
});

dtest('valueAxis: ticks stay on exact multiples of the step, whatever its size', () => {
  for (const [lo, hi] of [[0, 1], [0, 0.3], [-4, 11], [0, 1234567], [-3e-7, 8e-7], [0, 9e15]]) {
    const axis = valueAxis(lo, hi, niceStep);
    axis.ticks.forEach((v, i) => {
      assert.ok(Math.abs(v - Number((axis.ticks[0] + i * axis.step).toPrecision(12))) <= Math.abs(axis.step) * 1e-9, `${lo}..${hi}: tick ${v}`);
    });
    assert.ok(axis.ticks.length <= 12, `${lo}..${hi}: ${axis.ticks.length} ticks`);
  }
});

dtest('valueAxis: more ticks than the guard allows is an AxisError naming the cause, never a long loop', () => {
  assert.throws(() => valueAxis(0, 1, () => 1e-6), (e) => e instanceof AxisError && /ticks/.test(e.message));
  assert.throws(() => valueAxis(0, 1, () => 0), (e) => e instanceof AxisError);
  assert.throws(() => valueAxis(0, 1, () => Number.NaN), (e) => e instanceof AxisError);
});

dtest('validate: a bar chart whose values are 1e-11 and 2e-11 is valid (it used to abort with a heap limit)', (t) => {
  const dir = dashboardWith(t, "SELECT 'a' AS region, 1e-11::DOUBLE AS revenue UNION ALL SELECT 'b', 2e-11::DOUBLE", { kind: 'bar', x: 'region', y: 'revenue' });
  const v = validated(dir);
  assert.equal(v.signal, null, `validate must not be killed (${v.signal}); ${v.stderr.split('\n')[0]}`);
  assert.deepEqual(v.result, { ok: true, errors: [] });
});

dtest('validate: a value near 1.7e308 is a spec error naming the chart, not a RangeError', (t) => {
  const dir = dashboardWith(t, "SELECT 'a' AS region, 1.7e308::DOUBLE AS revenue", { kind: 'bar', x: 'region', y: 'revenue' });
  const first = asSpecError(validated(dir));
  assert.equal(first.path, 'lift.chart');
  assert.match(first.message, /chart "c"/);
  assert.match(first.message, /too large|too wide|too small/);
});

dtest('validate: the same holds for a line, a scatter and a stacked bar', (t) => {
  const huge = "SELECT 'a' AS region, 'p' AS product, 1.7e308::DOUBLE AS revenue, 1.0::DOUBLE AS units";
  for (const chart of [
    { kind: 'line', x: 'region', y: 'revenue' },
    { kind: 'scatter', x: 'units', y: 'revenue' },
    { kind: 'stacked-bar', x: 'region', y: 'revenue', color: 'product' },
  ]) {
    const first = asSpecError(validated(dashboardWith(t, huge, chart)));
    assert.match(first.message, /chart "c"/, chart.kind);
  }
});

// ---- F2: the histogram ---------------------------------------------------------------------

const histogramOf = (t, values) => dashboardWith(t, values.map((v, i) => `SELECT ${v}::DOUBLE AS v`).join(' UNION ALL '), { kind: 'histogram', value: 'v' });
const counted = (items) => items.reduce((n, i) => n + i.value, 0);

dtest('histogram: values equal up to float noise make one bin holding every row (it used to crash with Invalid array length)', (t) => {
  const items = liftedItems(histogramOf(t, ['0.99999999996', '0.99999999997']));
  assert.equal(items.length, 1);
  assert.equal(counted(items), 2);
});

dtest('histogram: a 1e-15 spread round 0.123456789012345 is one bin (it used to build millions of bins)', (t) => {
  const { items, fallback, hasSvg } = lifted(histogramOf(t, ['0.123456789012345', '0.123456789012346']));
  assert.equal(items.length, 1);
  assert.equal(counted(items), 2);
  // make-dashboard's own Vega drawing cannot bin this (a NaN step), so the fallback is the table alone.
  assert.deepEqual([fallback, hasSvg], hasSvg ? ['svg', true] : ['table', false]);
});

dtest('histogram: 33.333333333333336 and 33.33333333333333 are one bin, not 66,678', (t) => {
  const { items, fallback, hasSvg } = lifted(histogramOf(t, ['33.333333333333336', '33.33333333333333']));
  assert.equal(items.length, 1);
  assert.equal(counted(items), 2);
  assert.deepEqual([fallback, hasSvg], hasSvg ? ['svg', true] : ['table', false]);
});

dtest('histogram: -1e-11, 0 and 1e-11 count all three rows, in bins with distinct readable labels', (t) => {
  const items = liftedItems(histogramOf(t, ['-1e-11', '0', '1e-11']));
  assert.equal(counted(items), 3, 'the -1e-11 row used to be written to counts[-10] and lost');
  const labels = items.map((i) => i.label);
  assert.equal(new Set(labels).size, labels.length, `labels are distinct: ${labels.join(' | ')}`);
  assert.ok(labels.every((l) => !/^0 – 0$/.test(l)), 'no bin reads "0 – 0"');
  assert.ok(items.length <= 24, `${items.length} bins`);
});

dtest('histogram: a value near 1.7e308 is a spec error naming the chart, not a RangeError', (t) => {
  const first = asSpecError(validated(dashboardWith(t, 'SELECT 0.0::DOUBLE AS v UNION ALL SELECT 1.7e308::DOUBLE UNION ALL SELECT -1.7e308::DOUBLE', { kind: 'histogram', value: 'v' })));
  assert.equal(first.path, 'lift.chart');
  assert.match(first.message, /chart "c"/);
});

dtest('histogram: ordinary values still bin as before (every row counted, at most 22 bins)', (t) => {
  const items = liftedItems(histogramOf(t, ['1', '2', '2.5', '9', '14', '30', '30.5', '99']));
  assert.equal(counted(items), 8);
  assert.ok(items.length <= 22);
});
