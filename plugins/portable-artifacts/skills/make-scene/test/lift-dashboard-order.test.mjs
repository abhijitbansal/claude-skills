// The dashboard lift orders and colours what it draws as make-dashboard's own 2D chart does (Vega-Lite's defaults,
// read from the compiled chart): colour groups, donut segments and heatmap categories ascending, nominal x in
// query order (temporal x sorted), a stack with the last colour at the bottom. The scene's fallback SVG is that
// 2D chart, so it must agree with the 3D legend. A query ordered by value (ORDER BY 3 DESC) is the case that differs.
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

dtest('colours follow the 2D chart: groups ascending by name, and the fallback SVG agrees, whatever the query order', async (t) => {
  const dir = byValueDashboard(t);
  for (const id of ['stacked', 'grouped', 'line', 'scatter', 'bubble', 'donut']) {
    const g = await lift(dir, id);
    assertGraph(g);
    const names = g.groups.map((x) => x.name);
    assert.deepEqual(names, [...names].sort(), `${id}: legend order is ascending`);
    const svg = legendColours(g.fallback.svg);
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

dtest('a heatmap lists its x and y categories ascending, as the 2D chart does', async (t) => {
  const g = await lift(byValueDashboard(t), 'heat');
  const along = (axis, texts) => texts.map((text) => g.labels.find((l) => l.text === text).at[axis]);
  const increasing = (xs) => xs.every((v, i) => i === 0 || v > xs[i - 1]);
  assert.ok(increasing(along(0, ['East', 'North', 'South', 'West'])), 'x ascending along x');
  assert.ok(increasing(along(2, ['Gadget', 'Gizmo', 'Widget'])), 'y ascending along z');
  const keys = Object.keys(g.focus);
  assert.ok(keys.includes('east') && keys.includes('widget'));
});

dtest('a donut runs ascending by name from 12 o\'clock, as the 2D chart does', async (t) => {
  const g = await lift(byValueDashboard(t), 'donut');
  const start = (tube) => Math.atan2(tube.points[0][2], tube.points[0][0]);
  const tubes = [...g.tubes].sort((a, b) => g.items[a.item].label.localeCompare(g.items[b.item].label));
  const wrapped = tubes.map((tube) => (start(tube) + Math.PI / 2 + 2 * Math.PI) % (2 * Math.PI));
  assert.ok(wrapped.every((a, i) => i === 0 || a > wrapped[i - 1]), `the segments follow in name order: ${wrapped.map((a) => a.toFixed(2)).join(', ')}`);
  assert.ok(wrapped[0] < 0.1, 'Gadget starts at the top');
});
