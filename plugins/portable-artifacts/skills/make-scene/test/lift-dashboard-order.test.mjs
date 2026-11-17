// The dashboard lift orders and colours what it draws as make-dashboard's own 2D chart does (read from the compiled
// chart): a colour role's groups ascending (Vega-Lite's default), but a donut's segments and a heatmap's nominal
// axes in query (row) order (sort: null), as are nominal x on bars and lines; temporal axes sort. A stack has the last
// colour at the bottom. The scene's fallback SVG is that 2D chart, so it must agree with the 3D legend. A query
// ordered by value (ORDER BY 3 DESC) is the case where row order and name order differ.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertGraph } from '../scripts/lib/graph.mjs';
import { loadTheme } from '../shared/theme.mjs';
import { liftDashboard } from '../scripts/lifts/dashboard.mjs';
import { loadSibling } from '../scripts/lib/siblings.mjs';
import { tempDir } from './helpers/scene-fixtures.mjs';

const FIX = fileURLToPath(new URL('./fixtures/', import.meta.url));
const THEME = loadTheme('dusk');
const DASHBOARD = 'dashboard.json';

let skipReason;
try {
  await loadSibling('make-dashboard', 'scripts/lib/pipeline.mjs');
} catch (e) {
  skipReason = `make-dashboard is not loadable (${String(e.message).split('\n')[0]})`;
}
const dtest = (name, fn) => test(name, { skip: skipReason }, fn);

// Sales by region and product, biggest first: first appearance is not alphabetical.
const BY_VALUE = 'SELECT region, product, SUM(amount) AS revenue, SUM(units) AS units FROM sales GROUP BY 1, 2 ORDER BY 3 DESC';
const BY_PRODUCT = 'SELECT product, SUM(amount) AS revenue FROM sales GROUP BY 1 ORDER BY 2 DESC';
const CHARTS = [
  { id: 'stacked', kind: 'stacked-bar', x: 'region', y: 'revenue', color: 'product' },
  { id: 'grouped', kind: 'grouped-bar', x: 'region', y: 'revenue', color: 'product' },
  { id: 'line', kind: 'line', x: 'region', y: 'revenue', color: 'product' },
  { id: 'scatter', kind: 'scatter', x: 'units', y: 'revenue', color: 'product' },
  { id: 'bubble', kind: 'bubble', x: 'units', y: 'revenue', size: 'units', color: 'product' },
  { id: 'heat', kind: 'heatmap', x: 'region', y: 'product', value: 'revenue' },
  { id: 'donut', query: 'p', kind: 'donut', x: 'product', y: 'revenue' },
];

function byValueDashboard(t) {
  const dir = tempDir(t, 'scene-order-');
  fs.mkdirSync(path.join(dir, 'data'));
  fs.copyFileSync(path.join(FIX, 'data/sales.csv'), path.join(dir, 'data/sales.csv'));
  const charts = CHARTS.map((c) => ({ title: c.id, query: 'q', ...c }));
  fs.writeFileSync(path.join(dir, DASHBOARD), JSON.stringify({ title: 'T', sources: { sales: { type: 'csv', path: 'data/sales.csv' } }, queries: { q: BY_VALUE, p: BY_PRODUCT }, charts }));
  return dir;
}

const lift = (dir, chart) => liftDashboard({ dashboard: DASHBOARD, chart }, { dir, theme: THEME });

// The colour each legend entry of make-dashboard's drawing paints (fill, else stroke), by entry text.
function legendColours(svg) {
  const entries = [...svg.matchAll(/role-legend-symbol[^>]*>(<path[^>]*>)[\s\S]*?role-legend-label[^>]*><text[^>]*>([^<]*)<\/text>/g)];
  return new Map(entries.map(([, symbol, name]) => {
    const fill = /fill="([^"]+)"/.exec(symbol)?.[1];
    const stroke = /stroke="([^"]+)"/.exec(symbol)?.[1];
    return [name, fill && fill !== 'none' ? fill : stroke];
  }));
}

// A line with few series is labelled at its line ends instead of a legend (make-dashboard views.mjs): the end-dot
// group comes right before the label group, and both draw one item per series in the same order, so the nth dot's
// fill is the colour of the nth label's series.
function endLabelColours(svg) {
  const m = /<g class="mark-symbol role-mark[^"]*"[^>]*>((?:<path[^>]*\/>)+)<\/g><g class="mark-text role-mark[^"]*"[^>]*>((?:<text[^>]*>[^<]*<\/text>)+)<\/g>/.exec(svg);
  if (!m) return new Map();
  const fills = [...m[1].matchAll(/fill="([^"]+)"/g)].map((x) => x[1]);
  const names = [...m[2].matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((x) => x[1]);
  return new Map(names.map((name, i) => [name, fills[i]]));
}

dtest('colours follow the 2D chart: a colour role ascending by name, a donut in row order, and the fallback SVG agrees', async (t) => {
  const dir = byValueDashboard(t);
  const rowOrder = { donut: ['Gizmo', 'Gadget', 'Widget'] }; // BY_PRODUCT, biggest first
  for (const id of ['stacked', 'grouped', 'line', 'scatter', 'bubble', 'donut']) {
    const g = await lift(dir, id);
    assertGraph(g);
    const names = g.groups.map((x) => x.name);
    assert.deepEqual(names, rowOrder[id] ?? [...names].sort(), `${id}: legend order`);
    const svg = new Map([...legendColours(g.fallback.svg), ...endLabelColours(g.fallback.svg)]);
    if (id === 'line') assert.equal(legendColours(g.fallback.svg).size, 0, 'line: three series are labelled at the line ends, with no legend');
    // (a bubble drawing's size legend adds entries of its own, so match by group name)
    for (const { name, colour } of g.groups) assert.equal(THEME.light[colour], svg.get(name), `${id}: ${name} is the same colour in 3D (${colour}) and in the 2D drawing`);
  }
});

dtest('a stacked bar stacks as the 2D chart does: the last colour at the bottom, the first on top', async (t) => {
  const g = await lift(byValueDashboard(t), 'stacked');
  const names = g.groups.map((x) => x.name);
  assert.equal(names.length, 3);
  const column = (x) => g.batches.slice(0, names.length).flatMap((b, group) => b.instances.filter((i) => Math.abs(i[0] - x) < 0.001).map((i) => ({ group, bottom: i[1] - i[4] / 2 })));
  const east = column(g.batches[0].instances.find((i) => g.items[i[6]].label.startsWith('East'))[0]);
  assert.equal(east.length, 3);
  const bottomUp = east.sort((a, b) => a.bottom - b.bottom).map((s) => s.group);
  assert.deepEqual(bottomUp, [2, 1, 0], 'Widget lowest, Gadget on top');
});

dtest('a heatmap lists its x and y categories in row order, as the 2D chart does (sort: null)', async (t) => {
  const g = await lift(byValueDashboard(t), 'heat');
  const along = (axis, texts) => texts.map((text) => g.labels.find((l) => l.text === text).at[axis]);
  const increasing = (xs) => xs.every((v, i) => i === 0 || v > xs[i - 1]);
  assert.ok(increasing(along(0, ['East', 'South', 'West', 'North'])), 'x in first-appearance order along x');
  assert.ok(increasing(along(2, ['Gizmo', 'Gadget', 'Widget'])), 'y in first-appearance order along z');
  const keys = Object.keys(g.focus);
  assert.ok(keys.includes('east') && keys.includes('widget'));
});

dtest('a donut runs in row order from 12 o\'clock, as the 2D chart does', async (t) => {
  const g = await lift(byValueDashboard(t), 'donut');
  const start = (tube) => Math.atan2(tube.points[0][2], tube.points[0][0]);
  const inRowOrder = ['Gizmo', 'Gadget', 'Widget'];
  const tubes = [...g.tubes].sort((a, b) => inRowOrder.indexOf(g.items[a.item].label) - inRowOrder.indexOf(g.items[b.item].label));
  const wrapped = tubes.map((tube) => (start(tube) + Math.PI / 2 + 2 * Math.PI) % (2 * Math.PI));
  assert.ok(wrapped.every((a, i) => i === 0 || a > wrapped[i - 1]), `the segments follow in row order: ${wrapped.map((a) => a.toFixed(2)).join(', ')}`);
  assert.ok(wrapped[0] < 0.1, 'the biggest row (Gizmo) starts at the top');
});
