// The dashboard lift: one make-dashboard chart as a scene graph (towers, ribbons, spheres, a surface, an
// extruded ring), its errors reported under lift.dashboard / lift.chart, and the 2D chart as the fallback.
// These need make-dashboard's node_modules (DuckDB, Vega); without them every test skips with the reason.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertGraph } from '../scripts/lib/graph.mjs';
import { buildScene, SceneError, validateSpec } from '../scripts/lib/api.mjs';
import { loadTheme } from '../shared/theme.mjs';
import { liftDashboard, dashboardLiftCheck } from '../scripts/lifts/dashboard.mjs';
import { installCommand, loadSibling } from '../scripts/lib/siblings.mjs';
import { build } from '../scripts/build.mjs';
import { PINNED_ENV, tempDir } from './helpers/scene-fixtures.mjs';

const FIX = fileURLToPath(new URL('./fixtures/', import.meta.url));
const GOLDEN_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'golden');
const THEME = loadTheme('dusk');
const DASHBOARD = 'dashboard.json';

let skipReason;
try {
  await loadSibling('make-dashboard', 'scripts/lib/pipeline.mjs');
} catch (e) {
  skipReason = `make-dashboard is not loadable (${String(e.message).split('\n')[0]}); run npm ci --omit=dev in make-dashboard`;
}
const dtest = (name, fn) => test(name, { skip: skipReason }, fn);

const lift = (chart, extra = {}, dashboard = DASHBOARD, dir = FIX) => liftDashboard({ dashboard, chart }, { dir, theme: THEME, ...extra });
const scene = (chart, extra = {}) => ({ title: 'Lifted chart', lift: { dashboard: DASHBOARD, chart }, ...extra });
const errorAt = (result, p) => result.errors.find((e) => e.path === p);
const itemsAt = (g, shape) => g.batches.filter((b) => b.shape === shape).flatMap((b) => b.instances).filter((i) => i[6] >= 0);
const finite = (v) => (typeof v === 'number' ? Number.isFinite(v) : Array.isArray(v) ? v.every(finite) : v && typeof v === 'object' ? Object.values(v).every(finite) : true);

// The golden keeps the geometry and drops the 2D drawing (make-dashboard's SVG is its own contract).
const goldenOf = (g) => ({ ...g, fallback: { ...g.fallback, svg: null, svgDark: null } });
const layout = (g) => `{\n${Object.keys(g).map((k) => ` ${JSON.stringify(k)}: ${JSON.stringify(g[k])}`).join(',\n')}\n}\n`;

// A dashboard in a temp folder: sales.csv, plus the queries and charts a test needs.
function dashboardIn(t, queries, charts) {
  const dir = tempDir(t, 'scene-dash-');
  fs.mkdirSync(path.join(dir, 'data'));
  fs.copyFileSync(path.join(FIX, 'data/sales.csv'), path.join(dir, 'data/sales.csv'));
  fs.writeFileSync(path.join(dir, DASHBOARD), JSON.stringify({ title: 'T', sources: { sales: { type: 'csv', path: 'data/sales.csv' } }, queries, charts }));
  return dir;
}

dtest('bar golden', async () => {
  const graph = await lift('revenue-by-region');
  assertGraph(graph);
  assert.equal(graph.kind, 'chart');
  assert.equal(graph.fallback.kind, 'svg');
  assert.ok(graph.fallback.svg.startsWith('<svg') && graph.fallback.svgDark.startsWith('<svg'), 'a light and a dark drawing');
  const golden = path.join(GOLDEN_DIR, 'lift-bar.json');
  if (process.env.UPDATE_GOLDEN === '1') {
    fs.mkdirSync(GOLDEN_DIR, { recursive: true });
    fs.writeFileSync(golden, layout(goldenOf(graph)));
  }
  assert.deepEqual(JSON.parse(JSON.stringify(goldenOf(graph))), JSON.parse(fs.readFileSync(golden, 'utf8')));
});

dtest('same input same bytes', async () => {
  for (const id of ['revenue-by-region', 'trend', 'heat', 'share']) {
    assert.equal(JSON.stringify(await lift(id)), JSON.stringify(await lift(id)));
  }
});

dtest('bar: towers rise from zero in proportion to the value, every value exact in an item', async () => {
  const g = await lift('revenue-by-region');
  assert.equal(g.items.length, 4);
  assert.deepEqual(g.items.slice(0, 3).map((i) => [i.label, i.value, i.display]), [['East', 6150, '6,150'], ['North', 2879, '2,879'], ['South', 5127, '5,127']]);
  assert.equal(g.items[3].label, 'West');
  assert.deepEqual(g.groups, [{ name: 'revenue', colour: 'cat1' }]);
  const towers = g.batches[0].instances;
  assert.equal(towers.length, 4);
  for (const t of towers) {
    assert.ok(Math.abs(t[1] - t[4] / 2) < 0.002, 'a tower stands on y = 0');
    assert.ok(Math.abs(t[4] / g.items[t[6]].value - towers[0][4] / g.items[0].value) < 1e-3, 'height is proportional to value');
  }
  assert.ok(g.labels.some((l) => l.text === 'East') && g.labels.some((l) => l.text === 'revenue'), 'category labels and axis titles');
  assert.ok(g.labels.some((l) => l.text === '2,000'), 'value ticks');
  assert.deepEqual(g.fallback.columns, ['region', 'revenue']);
  assert.equal(g.fallback.rows.length, 4);
});

dtest('negative values go below the floor, and the floor is drawn at 0', async () => {
  const g = await lift('vs-target');
  const negative = g.items.findIndex((i) => i.value < 0);
  assert.ok(negative >= 0, 'the fixture has a value under the target');
  const towers = g.batches[0].instances;
  const below = towers.find((t) => t[6] === negative);
  assert.ok(below[1] < 0 && below[1] + below[4] / 2 <= 0.001, 'a negative tower hangs from y = 0');
  const above = towers.find((t) => g.items[t[6]].value > 0);
  assert.ok(above[1] - above[4] / 2 > -0.001 && above[1] > 0, 'a positive one stands on it');
  const floor = g.batches.filter((b) => b.colour === 'line').flatMap((b) => b.instances);
  assert.ok(floor.length > 0, 'the floor is drawn');
  assert.ok(floor.every((i) => i[6] === -1 && Math.abs(i[1]) < 0.06), 'at y = 0, so a negative tower is not hidden by it');
  assert.ok(g.labels.some((l) => l.text.startsWith('-')), 'the axis has negative ticks');
  assert.ok(finite(g));
});

dtest('stacked bars stack in one column, grouped bars stand side by side', async () => {
  const stacked = await lift('stacked');
  const col = (g, x) => g.batches.flatMap((b) => b.instances).filter((i) => i[6] >= 0 && Math.abs(i[0] - x) < 0.001);
  const first = col(stacked, stacked.batches[0].instances[0][0]);
  assert.equal(first.length, 3, 'three products in the East column');
  const spans = first.map((i) => [i[1] - i[4] / 2, i[1] + i[4] / 2]).sort((a, b) => a[0] - b[0]);
  assert.ok(Math.abs(spans[0][0]) < 0.001 && spans.every((s, k) => k === 0 || Math.abs(s[0] - spans[k - 1][1]) < 0.002), 'segments are contiguous from 0');
  assert.deepEqual(stacked.groups.map((x) => x.name), ['Gadget', 'Gizmo', 'Widget']);
  assert.equal(stacked.items[0].label, 'East · Gadget');
  const grouped = await lift('grouped');
  const zs = new Set(grouped.batches.flatMap((b) => b.instances).filter((i) => i[6] >= 0).map((i) => i[2]));
  assert.equal(zs.size, 3, 'one lane per product');
  assertGraph(grouped);
});

dtest('line lifts to ribbons', async () => {
  const g = await lift('trend');
  assertGraph(g);
  assert.deepEqual(g.groups.map((x) => x.name), ['East', 'North', 'South', 'West']);
  assert.equal(g.tubes.length, 4, 'one ribbon per series');
  assert.deepEqual(g.tubes.map((t) => t.label), ['East', 'North', 'South', 'West']);
  assert.ok(g.tubes.every((t) => t.points.length === 4 && t.item === null && t.radius === 0.06));
  const lanes = new Set(g.tubes.map((t) => t.points[0][2]));
  assert.equal(lanes.size, 4, 'each series has its own lane');
  assert.equal(g.items.length, 16);
  assert.equal(itemsAt(g, 'sphere').length, 16, 'every point is a marker carrying its item, so every value is reachable');
  assert.equal(g.items[0].label, '2025-01 · East');
  assert.ok(g.labels.some((l) => l.text === '2025-01'));
  for (const t of g.tubes) t.points.forEach((p, i) => i === 0 || assert.notDeepEqual(p, t.points[i - 1]));
});

dtest('area is a thicker ribbon: 1.6 times the line radius', async () => {
  const g = await lift('trend-area');
  assert.equal(g.tubes.length, 1);
  assert.equal(g.tubes[0].radius, 0.096);
  assert.deepEqual(g.groups, [{ name: 'revenue', colour: 'cat1' }]);
});

dtest('scatter and bubble are spheres: bubble area follows size', async () => {
  const scatter = await lift('orders');
  assertGraph(scatter);
  assert.equal(itemsAt(scatter, 'sphere').length, 40);
  assert.equal(scatter.items[0].display, 'units 11 · amount 214.5');
  assert.equal(scatter.items[0].value, 214.5);
  assert.deepEqual(scatter.groups.map((x) => x.name), ['Widget', 'Gadget', 'Gizmo']);
  const bubbles = await lift('bubbles');
  const spheres = itemsAt(bubbles, 'sphere');
  const diameter = (i) => spheres.find((s) => s[6] === i)[3];
  const sizeOf = (i) => Number(/orders (\d+)$/.exec(bubbles.items[i].display)[1]);
  const [a, b] = [0, bubbles.items.findIndex((_, i) => sizeOf(i) !== sizeOf(0))];
  assert.ok(Math.abs((diameter(a) / diameter(b)) ** 2 - sizeOf(a) / sizeOf(b)) < 0.05, 'area is proportional to size');
});

dtest('heatmap is a surface on the terrain grid convention, every cell an item', async () => {
  const g = await lift('heat');
  assertGraph(g);
  const [s] = g.surfaces;
  assert.equal(g.surfaces.length, 1);
  assert.equal(s.nx, (4 - 1) * 5 + 1, 'four regions along x, a data cell every 5th vertex');
  assert.equal(s.nz, (3 - 1) * 5 + 1, 'three products along z');
  assert.equal(s.cells.length, 12);
  assert.ok(s.cells.every((c) => c >= 0));
  const peak = g.items.reduce((a, b) => (b.value > a.value ? b : a));
  const cell = s.cells.indexOf(g.items.indexOf(peak));
  const [ti, gi] = [cell % 4, Math.floor(cell / 4)];
  assert.equal(s.heights[gi * 5 * s.nx + ti * 5], 1, 'the largest value is the full height');
  assert.ok(s.heights.every((h) => h >= 0 && h <= 1));
  assert.ok(g.labels.some((l) => l.text === 'Gizmo') && g.labels.some((l) => l.text === 'East'));
});

dtest('histogram bins the values and every row lands in a bin', async () => {
  const g = await lift('amounts');
  assertGraph(g);
  assert.equal(g.items.reduce((n, i) => n + i.value, 0), 40);
  assert.match(g.items[0].label, /^\d.* – \d/);
  assert.equal(g.items[0].display, `${g.items[0].value} ${g.items[0].value === 1 ? 'row' : 'rows'}`);
});

dtest('donut is one arc per segment, sized by share', async () => {
  const g = await lift('share');
  assertGraph(g);
  assert.equal(g.tubes.length, 4);
  assert.ok(g.tubes.every((t) => t.item !== null && t.points.length >= 2 && t.radius > 0.3));
  assert.deepEqual(g.groups.map((x) => x.name), ['East', 'North', 'South', 'West']);
  const total = g.items.reduce((n, i) => n + i.value, 0);
  const angle = (p) => Math.atan2(p[2], p[0]);
  const span = (t) => t.points.reduce((n, p, k) => (k === 0 ? 0 : n + Math.abs(angle(p) - angle(t.points[k - 1]))), 0);
  const east = g.tubes.find((t) => t.item === g.items.findIndex((i) => i.label === 'East'));
  assert.ok(Math.abs(span(east) / (2 * Math.PI) - 6150 / total) < 0.02, 'the arc spans its share of the ring');
  assert.equal(g.items[0].display, '6,150 USD', 'a currency chart says so');
  assert.ok(finite(g));
});

dtest('units from the scene spec are used in every display', async () => {
  const g = await lift('revenue-by-region', { units: 'dollars' });
  assert.equal(g.units, 'dollars');
  assert.equal(g.items[0].display, '6,150 dollars');
});

dtest('boxplot rejected with liftable list', async () => {
  const r = await validateSpec(scene('spread'), { dir: FIX });
  assert.equal(r.ok, false);
  assert.equal(errorAt(r, 'lift.chart').message, 'boxplot charts cannot be lifted; liftable kinds: bar, stacked-bar, grouped-bar, line, area, scatter, bubble, heatmap, histogram, donut');
  await assert.rejects(() => lift('spread'), (e) => e instanceof SceneError && e.errors[0].path === 'lift.chart' && /boxplot charts cannot be lifted/.test(e.errors[0].message));
});

dtest('vegaLite chart rejected', async () => {
  const r = await validateSpec(scene('custom'), { dir: FIX });
  assert.match(errorAt(r, 'lift.chart').message, /^vegaLite charts cannot be lifted; liftable kinds: bar,/);
});

dtest('unknown chart did-you-mean', async () => {
  const r = await validateSpec(scene('revenue-by-regon'), { dir: FIX });
  assert.equal(r.ok, false);
  assert.match(errorAt(r, 'lift.chart').message, /did you mean "revenue-by-region"\?/);
  await assert.rejects(() => lift('nope'), (e) => e instanceof SceneError && e.errors[0].path === 'lift.chart' && /not found in the dashboard/.test(e.errors[0].message));
});

dtest('tour focus on unknown category suggests one', async () => {
  const r = await validateSpec(scene('stacked', { tour: [{ title: 'Look', focus: ['nrth'] }, { title: 'Fine', focus: ['EAST', 'gizmo', 'West · Widget'] }] }), { dir: FIX });
  assert.equal(r.ok, false);
  assert.equal(errorAt(r, 'tour[0].focus[0]').message, '"nrth" is not an x or colour value of the chart; did you mean "north"?');
  assert.equal(r.errors.length, 1, 'x, colour and item labels match case-insensitively');
  const hist = await validateSpec(scene('amounts', { tour: [{ title: 'x', focus: ['east'] }] }), { dir: FIX });
  assert.match(errorAt(hist, 'tour[0].focus[0]').message, /has no x or colour values/);
});

dtest('focus flies to every category and item', async () => {
  const g = await lift('stacked');
  for (const key of ['east', 'west', 'gadget', 'gizmo', 'widget', 'east · gadget']) assert.ok(Object.hasOwn(g.focus, key), key);
  assertGraph(g);
});

dtest('chartData errors are re-pathed under lift.dashboard and name the file', async (t) => {
  const dir = dashboardIn(t, { q: 'SELECT region, SUM(amount) AS revenue FROM sales GROUP BY 1' }, [{ id: 'c', title: 'C', query: 'q', kind: 'bar', x: 'regoin', y: 'revenue' }]);
  const spec = { title: 'T', lift: { dashboard: DASHBOARD, chart: 'c' } };
  const r = await validateSpec(spec, { dir });
  assert.equal(r.ok, false);
  const e = errorAt(r, 'lift.dashboard.charts[0].x');
  assert.match(e.message, /did you mean "region"\?.*\(in dashboard\.json\)$/);
  await assert.rejects(() => buildScene(spec, { dir, theme: THEME }), (err) => err instanceof SceneError && err.errors[0].path === 'lift.dashboard.charts[0].x');
});

dtest('a dashboard that is not JSON is a lift.dashboard error, never a stack', async (t) => {
  const dir = dashboardIn(t, { q: 'SELECT 1 AS n' }, []);
  fs.writeFileSync(path.join(dir, DASHBOARD), '{ "title": ');
  const r = await validateSpec({ title: 'T', lift: { dashboard: DASHBOARD, chart: 'c' } }, { dir });
  assert.match(errorAt(r, 'lift.dashboard').message, /not valid JSON/);
});

dtest('missing make-dashboard gives install command', async (t) => {
  const root = tempDir(t); // a folder with no make-dashboard in it
  const command = installCommand(['make-dashboard']);
  await assert.rejects(
    () => lift('revenue-by-region', { siblingRoot: root }),
    (e) => e instanceof SceneError && e.errors[0].path === 'lift.dashboard' && e.errors[0].message.includes(command) && e.errors[0].message.includes('next to make-scene'),
  );
  const errors = await dashboardLiftCheck(scene('revenue-by-region'), { dir: FIX }, { siblingRoot: root });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].path, 'lift.dashboard');
  assert.ok(errors[0].message.includes(command));
});

dtest('a valid chart lift passes validateSpec', async () => {
  for (const id of ['revenue-by-region', 'stacked', 'trend', 'orders', 'heat', 'amounts', 'share']) {
    assert.deepEqual(await validateSpec(scene(id), { dir: FIX }), { ok: true, errors: [] }, id);
  }
});

dtest('a heatmap with a value below zero is rejected with the fix; a donut is make-dashboard\'s own rule', async (t) => {
  const swing = 'SELECT region, product, SUM(amount) - 600 AS delta FROM sales GROUP BY 1, 2';
  const heatDir = dashboardIn(t, { swing }, [{ id: 'h', title: 'H', query: 'swing', kind: 'heatmap', x: 'region', y: 'product', value: 'delta' }]);
  const heat = await validateSpec({ title: 'T', lift: { dashboard: DASHBOARD, chart: 'h' } }, { dir: heatDir });
  assert.match(errorAt(heat, 'lift.chart').message, /heatmap values must be 0 or more; row \d+ has -\d+; shift the value in SQL or lift a bar chart instead/);
  await assert.rejects(() => lift('h', {}, DASHBOARD, heatDir), (e) => e instanceof SceneError && e.errors[0].path === 'lift.chart');
  const donutDir = dashboardIn(t, { mix: 'SELECT region, SUM(amount) - 5000 AS delta FROM sales GROUP BY 1' }, [{ id: 'd', title: 'D', query: 'mix', kind: 'donut', x: 'region', y: 'delta' }]);
  const donut = await validateSpec({ title: 'T', lift: { dashboard: DASHBOARD, chart: 'd' } }, { dir: donutDir });
  assert.match(donut.errors[0].message, /donut needs every delta >= 0.*\(in dashboard\.json\)$/);
  assert.equal(donut.errors[0].path, 'lift.dashboard.charts[0].kind');
});

dtest('degenerate data yields a finite graph: one row, all zeros, empty result', async (t) => {
  const dir = dashboardIn(t, {
    one: "SELECT 'only' AS region, 7.0 AS revenue",
    zeros: 'SELECT region, 0.0 AS revenue FROM sales GROUP BY 1',
    none: 'SELECT region, 1.0 AS revenue FROM sales WHERE 1 = 0',
  }, [
    { id: 'one', title: 'One', query: 'one', kind: 'bar', x: 'region', y: 'revenue' },
    { id: 'one-line', title: 'One line', query: 'one', kind: 'line', x: 'region', y: 'revenue' },
    { id: 'one-donut', title: 'One donut', query: 'one', kind: 'donut', x: 'region', y: 'revenue' },
    { id: 'one-heat', title: 'One heat', query: 'one', kind: 'heatmap', x: 'region', y: 'region', value: 'revenue' },
    { id: 'zeros', title: 'Zeros', query: 'zeros', kind: 'bar', x: 'region', y: 'revenue' },
    { id: 'zero-donut', title: 'Zero donut', query: 'zeros', kind: 'donut', x: 'region', y: 'revenue' },
    { id: 'zero-line', title: 'Zero line', query: 'zeros', kind: 'area', x: 'region', y: 'revenue' },
    { id: 'none', title: 'None', query: 'none', kind: 'bar', x: 'region', y: 'revenue' },
  ]);
  for (const id of ['one', 'one-line', 'one-donut', 'one-heat', 'zeros', 'zero-donut', 'zero-line', 'none']) {
    const g = await lift(id, {}, DASHBOARD, dir);
    assertGraph(g);
    assert.ok(finite(g), `${id} has no NaN`);
  }
  const zeros = await lift('zeros', {}, DASHBOARD, dir);
  assert.ok(zeros.batches[0].instances.every((i) => i[4] > 0), 'a zero value is a visible marker');
});

dtest('hostile labels stay text: the graph carries them verbatim and the page escapes them', async (t) => {
  const hostile = '<img src=x onerror=window.PWNED=1>';
  const dir = dashboardIn(t, { q: `SELECT '${hostile}' AS region, 5.0 AS revenue UNION ALL SELECT 'b', 3.0` }, [{ id: 'c', title: 'C', query: 'q', kind: 'bar', x: 'region', y: 'revenue' }]);
  const g = await lift('c', {}, DASHBOARD, dir);
  assert.ok(g.items.some((i) => i.label === hostile));
  const built = await buildScene({ title: 'T', lift: { dashboard: DASHBOARD, chart: 'c' } }, { dir, theme: THEME });
  assert.ok(!built.html.includes('<img src=x'), 'no raw markup reaches the page');
});

dtest('buildScene lifts a chart: fragment, light and dark fallback drawings with distinct ids, the table', async () => {
  const built = await buildScene(scene('revenue-by-region'), { dir: FIX, theme: THEME, idPrefix: 'lift' });
  assert.equal(built.graph.kind, 'chart');
  assert.equal(built.graph.title, 'Lifted chart', 'the scene spec title wins');
  assert.match(built.html, /class="sc-fb-svg sc-fb-light"><svg/);
  assert.match(built.html, /class="sc-fb-svg sc-fb-dark"><svg/);
  assert.match(built.html, /<table>/);
  const ids = (svg) => new Set([...svg.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));
  const light = ids(built.graph.fallback.svg);
  const dark = ids(built.graph.fallback.svgDark);
  assert.ok(light.size > 0 && [...light].every((id) => !dark.has(id)), 'markers and gradients cannot collide between the two drawings');
  const other = await buildScene(scene('revenue-by-region'), { dir: FIX, theme: THEME, idPrefix: 'other' });
  assert.ok([...ids(other.graph.fallback.svg)].every((id) => !light.has(id)), 'two lifts on one page do not share ids');
  assert.ok(!built.graph.fallback.rows.flat().includes(undefined));
});

dtest('buildScene: a spec tour resolves its focus against the chart', async () => {
  const built = await buildScene(scene('stacked', { tour: [{ title: 'Look', caption: 'East', focus: ['East'] }] }), { dir: FIX, theme: THEME });
  assert.deepEqual(built.graph.tour, [{ title: 'Look', caption: 'East', focus: 'east', path: null, reverse: false }]);
});

const writeLift = (t, extra = {}) => {
  const dir = dashboardIn(t, { q: 'SELECT region, SUM(amount) AS revenue FROM sales GROUP BY 1 ORDER BY 1' }, [{ id: 'c', title: 'C', query: 'q', kind: 'bar', x: 'region', y: 'revenue' }]);
  fs.writeFileSync(path.join(dir, 'scene.json'), JSON.stringify({ title: 'Lifted', lift: { dashboard: DASHBOARD, chart: 'c' }, ...extra }));
  return { dir, file: path.join(dir, 'scene.json') };
};

dtest('build.mjs writes a chart page: same spec same bytes, no alternatives', async (t) => {
  const { dir, file } = writeLift(t);
  const env = { ...PINNED_ENV, PA_OUTPUT_DIR: dir };
  const one = await build(file, { out: path.join(dir, 'one.html'), env });
  const two = await build(file, { out: path.join(dir, 'two.html'), env });
  assert.equal(one.ok, true, JSON.stringify(one.errors));
  assert.equal(one.world, null);
  assert.deepEqual(one.alternatives, []);
  assert.equal(fs.readFileSync(one.out, 'utf8'), fs.readFileSync(two.out, 'utf8'));
  assert.match(fs.readFileSync(one.out, 'utf8'), /data-scene-fallback/);
});

dtest('validate.mjs (the CLI) reports lift.chart errors: the check is registered without importing api.mjs', (t) => {
  const { file } = writeLift(t, { lift: { dashboard: DASHBOARD, chart: 'cc' } });
  const run = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/validate.mjs', import.meta.url)), file], { encoding: 'utf8', env: { ...process.env, EVAL_LOG: '' } });
  assert.equal(run.status, 1, run.stdout + run.stderr);
  assert.match(run.stdout, /^lift\.chart: .*did you mean "c"\?/m);
});
