// Dashboard lift: one chart of a make-dashboard dashboard (a .json file in the spec folder, plus a chart id) as a
// scene graph, built from the chart's own rows. Importing this module registers the `lift.dashboard` check with the
// validator; make-dashboard itself (DuckDB, Vega) is loaded lazily, only when a spec lifts from it.
//
//   bar, stacked-bar, grouped-bar, histogram: dashboard-bars.mjs     line, area, scatter, bubble: dashboard-series.mjs
//   heatmap, donut: dashboard-surface.mjs                           the plot box, axes, floor and focus: dashboard-frame.mjs
// A boxplot or a hand-written vegaLite chart cannot be lifted. The fallback is the chart's own 2D drawing in both
// themes, plus the plotted columns as a table.
import path from 'node:path';
import { emptyGraph, finalizeGraph } from '../lib/graph.mjs';
import { q, suggestion } from '../lib/checks.mjs';
import { SceneError } from '../lib/scene-error.mjs';
import { registerLiftCheck } from '../lib/spec.mjs';
import { loadSibling } from '../lib/siblings.mjs';
import { kindError, readChart } from './dashboard-data.mjs';
import { AxisError, VIEW_DIRECTION, focusOf } from './dashboard-frame.mjs';
import { barsPart, histogramPart } from './dashboard-bars.mjs';
import { linesPart, scatterPart } from './dashboard-series.mjs';
import { donutPart, heatmapPart } from './dashboard-surface.mjs';
import { cameraFor } from './diagram-parts.mjs';

const AT = 'lift.dashboard';
const AT_CHART = 'lift.chart';
const CURRENCY_UNITS = 'USD';

const PARTS = {
  bar: barsPart, 'stacked-bar': barsPart, 'grouped-bar': barsPart, histogram: histogramPart,
  line: linesPart, area: linesPart, scatter: scatterPart, bubble: scatterPart,
  heatmap: heatmapPart, donut: donutPart,
};

const isSiblingError = (e) => e?.name === 'SiblingError';
const isUsageError = (e) => e?.name === 'UsageError';

// ---- make-dashboard ----------------------------------------------------------------

// Everything the lift borrows from make-dashboard; `drawing` (Vega) only when the 2D fallback is wanted.
async function borrow(siblingRoot, { drawing = false } = {}) {
  const opts = siblingRoot === undefined ? {} : { root: siblingRoot };
  const load = (file) => loadSibling('make-dashboard', `scripts/lib/${file}`, opts);
  const [pipeline, kinds, ticks, views] = await Promise.all([load('pipeline.mjs'), load('kinds.mjs'), load('axis-ticks.mjs'), load('views.mjs')]);
  const lib = { pipeline, KINDS: kinds.KINDS, classOf: kinds.classOf, niceStep: ticks.niceStep, temporalUnit: views.temporalUnit };
  return drawing ? { ...lib, renderThemedSvgs: (await load('static-chart.mjs')).renderThemedSvgs } : lib;
}

// Absolute paths inside the spec folder, as the dashboard's own messages print them, become relative to it.
const relativeTo = (dir) => (text) => text.replaceAll(`${path.resolve(dir)}${path.sep}`, '');

// make-dashboard error paths ("charts[0].x", "chart", or "" for the whole dashboard) under lift.dashboard / lift.chart.
const repath = (p) => (p === 'chart' ? AT_CHART : p ? `${AT}${p.startsWith('[') ? '' : '.'}${p}` : AT);
const reported = (errors, file, relative) => errors.map((e) => ({ path: repath(e.path), message: e.path === 'chart' ? relative(e.message) : `${relative(e.message)} (in ${file})` }));

/**
 * The chart's own rows: validate the dashboard, check the chart is liftable, run its queries.
 * -> { errors } (under lift.dashboard and lift.chart) or { lib, chart, result, view }.
 */
async function fetchChart({ dashboard, chart }, { dir, allowOutside, siblingRoot, drawing }) {
  let lib;
  try {
    lib = await borrow(siblingRoot, { drawing });
  } catch (e) {
    if (isSiblingError(e)) return { errors: [{ path: AT, message: e.message }] };
    throw e;
  }
  const file = path.resolve(dir, dashboard);
  const relative = relativeTo(dir);
  try {
    const checked = await lib.pipeline.validateChart(file, chart, { allowOutside });
    if (!checked.ok) return { errors: reported(checked.errors, dashboard, relative) };
    const bad = kindError(checked.chart, lib.KINDS);
    if (bad) return { errors: [{ path: AT_CHART, message: bad }] };
    const data = await lib.pipeline.chartData(file, chart, { allowOutside });
    if (!data.ok) return { errors: reported(data.errors, dashboard, relative) };
    return { lib, chart: data.chart, result: data.result, view: data.view };
  } catch (e) {
    if (isUsageError(e)) return { errors: [{ path: AT, message: `${relative(e.message)} (in ${dashboard})` }] };
    throw e;
  }
}

// Vega numbers its clip paths and gradients from counters that live as long as the process, so one drawing differs
// between two builds in it. Renumbered from 0 in order of appearance, a page's bytes depend on its spec alone.
// Only ids and their references in attributes are touched (id="...", ="url(#...)", href="#..."); text a chart shows is left alone.
const ID_CONTEXT = /(\bid="|="url\(#|href="#)([^"')]*?)(clip|gradient_)(\d+)(?=["')])/g;
function steadyIds(svg) {
  const order = { clip: new Map(), gradient_: new Map() };
  return svg.replace(ID_CONTEXT, (_, lead, before, family, n) => {
    const seen = order[family];
    if (!seen.has(n)) seen.set(n, seen.size);
    return `${lead}${before}${family}${seen.get(n)}`;
  });
}

// ---- the graph ------------------------------------------------------------------------

// Currency charts say so; any other chart is plain numbers unless the scene spec gives units.
const unitsFor = (chart, units) => units ?? (chart.format === 'currency' ? CURRENCY_UNITS : '');

// The part for a chart; values that cannot be laid out on an axis are a spec error that names the chart.
function partOf(model, lib, units) {
  try {
    return PARTS[model.kind](model, { units, niceStep: lib.niceStep });
  } catch (e) {
    if (e instanceof AxisError) throw new SceneError([{ path: AT_CHART, message: `chart ${JSON.stringify(model.chart.id)}: ${e.message}` }]);
    throw e;
  }
}

/** The scene graph (without its 2D drawing) of a read chart; also { part } for the callers that need the focus. */
function graphOf(model, lib, units, plotted) {
  const part = partOf(model, lib, units);
  const g = emptyGraph('chart', { title: model.chart.title, units });
  g.groups = part.groups;
  g.items = part.items;
  g.batches = part.batches.filter((b) => b.instances.length > 0);
  g.tubes = part.tubes;
  g.surfaces = part.surfaces;
  g.labels = part.labels;
  g.focus = focusOf(...part.focus);
  g.fallback = { ...g.fallback, kind: 'svg', columns: plotted.columns, rows: plotted.rows };
  const done = finalizeGraph(g);
  return { graph: finalizeGraph({ ...done, camera: cameraFor(done.bounds, VIEW_DIRECTION) }), categories: part.categories };
}

/**
 * liftDashboard({ dashboard, chart }, { dir, theme, idPrefix, siblingRoot, allowOutside, units }) -> scene graph v1 (kind "chart").
 * `dashboard` is a .json path in `dir`, `chart` a chart id in it; `theme` the loaded page theme. `idPrefix` namespaces the
 * ids of the 2D fallback's SVGs. `units` (the scene spec's) are appended to every value; a currency chart says USD.
 * `siblingRoot` points at another folder of skills (tests). Throws SceneError with paths under lift.dashboard or
 * lift.chart for a dashboard, a chart or a value the lift cannot draw, and for a missing make-dashboard.
 */
export async function liftDashboard(source, { dir = process.cwd(), theme, idPrefix, siblingRoot, allowOutside = false, units } = {}) {
  const got = await fetchChart(source, { dir, allowOutside, siblingRoot, drawing: true });
  if (got.errors) throw new SceneError(got.errors);
  const model = readChart(got, got.lib);
  if (model.errors.length > 0) throw new SceneError(model.errors);
  const { graph } = graphOf(model, got.lib, unitsFor(got.chart, units), model.table);
  const svgs = await drawing(got, theme, idPrefix);
  if (svgs === null) return { ...graph, fallback: { ...graph.fallback, kind: 'table' } };
  return { ...graph, fallback: { ...graph.fallback, svg: steadyIds(svgs.light.wide), svgDark: steadyIds(svgs.dark.wide) } };
}

// The one Vega failure that is expected: a number format built from a NaN step (`invalid format: ,.NaN~f`) when the
// values are too close together for the axis. Vega logs it, then fails later with an unrelated TypeError.
const KNOWN_VEGA_FAILURE = /invalid format/;
const noted = new Set();

// One line on stderr per chart and process, however often the drawing is tried (validate draws once per theme).
function noteTable(chartId) {
  const line = `note: ${chartId}: drawn as a table in the fallback because its values are too close together for a 2D chart`;
  if (noted.has(line)) return;
  noted.add(line);
  process.stderr.write(`${line}\n`);
}

// make-dashboard's own 2D drawing of the chart. Vega cannot lay out some extreme data (values equal to float noise
// make a NaN bin step); the 3D scene is still sound, so the fallback is then the plotted table alone (null). Only
// that known failure is caught; anything else is a real error and propagates. Vega's logger writes its stack to
// console.error: it is held back while drawing, and shown again unless it was the known failure.
async function drawing({ lib, view, result, chart }, theme, idPrefix) {
  const logged = [];
  const consoleError = console.error;
  console.error = (...args) => { logged.push(args); };
  let known = false;
  try {
    return await lib.renderThemedSvgs(view, result.rows, theme, { idPrefix: `${idPrefix ?? 'ch'}-` });
  } catch (e) {
    known = logged.some((args) => KNOWN_VEGA_FAILURE.test(args.map(String).join(' ')));
    if (!known) throw e;
    return null;
  } finally {
    console.error = consoleError;
    if (known) noteTable(chart.id);
    else for (const args of logged) consoleError(...args);
  }
}

// ---- the validator hook -----------------------------------------------------------------

function checkTourFocus(scene, { graph, categories }) {
  const keys = Object.keys(graph.focus);
  const errors = [];
  (scene.tour ?? []).forEach((beat, i) => {
    beat.focus.forEach((f, j) => {
      if (keys.includes(f.toLowerCase())) return;
      const none = !categories.x && !categories.color;
      const hint = none ? `this chart has no x or colour values; ${suggestion(f.toLowerCase(), keys)}` : suggestion(f.toLowerCase(), keys);
      errors.push({ path: `tour[${i}].focus[${j}]`, message: `${q(f)} is not an x or colour value of the chart; ${hint}` });
    });
  });
  return errors;
}

/**
 * The lift.dashboard check: make-dashboard's own validation under lift.dashboard.<path> (an unknown chart id under
 * lift.chart, with a did-you-mean), the chart's kind, its rows (a lift's limits and values it cannot draw), then
 * the tour's focus entries against the chart's category values and items. `siblingRoot` is for tests.
 */
export async function dashboardLiftCheck(scene, { dir, allowOutside = false }, { siblingRoot } = {}) {
  const got = await fetchChart(scene.lift, { dir, allowOutside, siblingRoot, drawing: false });
  if (got.errors) return got.errors;
  const model = readChart(got, got.lib);
  if (model.errors.length > 0) return model.errors;
  try {
    return checkTourFocus(scene, graphOf(model, got.lib, '', model.table));
  } catch (e) {
    if (e instanceof SceneError) return e.errors;
    throw e;
  }
}

registerLiftCheck('dashboard', (scene, ctx) => dashboardLiftCheck(scene, ctx));
