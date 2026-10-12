// Expand kind charts into Vega-Lite views at build time, from the query rows
// and their DuckDB column types. The page renders exactly what this returns.
import { KINDS, classOf, fieldRef } from './kinds.mjs';
import { addTooltips, enhanceRaw, interactionsFor, NEAREST_X, ZOOM_X, legendParam } from './interact.mjs';

const AXIS_FORMAT = { number: ',.2~f', currency: '$,.2~f', percent: '.1~%', compact: '.3~s' };
const HORIZONTAL_LABEL = 12;
const HORIZONTAL_COUNT = 8;
const TABLE = { name: 'table', label: 'Table' };

export function temporalUnit(values) {
  const dates = values.filter((v) => v !== null && v !== undefined).map((v) => new Date(String(v).length === 10 ? `${v}T00:00:00Z` : v));
  if (!dates.length || dates.some((d) => Number.isNaN(d.getTime()))) return null;
  const midnight = dates.every((d) => d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0);
  if (!midnight) return null;
  if (dates.every((d) => d.getUTCDate() === 1 && d.getUTCMonth() === 0)) return 'utcyear';
  if (dates.every((d) => d.getUTCDate() === 1)) return 'utcyearmonth';
  return 'utcyearmonthdate';
}

// Per-chart context the builders share: field defs for every role in use.
function context(chart, result) {
  const cls = (col) => classOf(result.types[result.columns.indexOf(col)]);
  const def = (role, extra = {}) => {
    const col = chart[role];
    if (col === undefined) return undefined;
    const type = cls(col);
    const base = { field: fieldRef(col), type, title: col };
    if (type === 'temporal') {
      const unit = temporalUnit(result.rows.map((r) => r[col]));
      Object.assign(base, unit ? { timeUnit: unit } : {}, { scale: { type: 'utc' } });
    }
    if (type === 'quantitative' && chart.format) base.axis = { format: AXIS_FORMAT[chart.format] };
    return { ...base, ...extra };
  };
  const labels = chart.x !== undefined ? result.rows.map((r) => String(r[chart.x] ?? '')) : [];
  const distinct = new Set(labels);
  const horizontal = chart.x !== undefined && cls(chart.x) === 'nominal'
    && (distinct.size > HORIZONTAL_COUNT || labels.some((l) => l.length > HORIZONTAL_LABEL));
  // The legend field: donut colours by x; every other kind by its color role.
  const legend = chart.kind === 'donut' ? chart.x : chart.color;
  return { def, horizontal, colorField: legend === undefined ? undefined : fieldRef(legend) };
}

// Bars on a time axis read better as ordinal bands.
const banded = (d) => {
  if (!d || d.type !== 'temporal') return d;
  const { scale, ...rest } = d; // a utc scale does not apply to ordinal bands
  return { ...rest, type: 'ordinal' };
};

function bar(ctx, { color, stack, offset, sort } = {}) {
  const x = banded(ctx.def('x', { sort: sort ?? null }));
  const y = ctx.def('y', stack ? { stack } : {});
  const enc = ctx.horizontal ? { y: x, x: y } : { x, y };
  if (color) enc.color = ctx.def('color');
  if (offset) enc[ctx.horizontal ? 'yOffset' : 'xOffset'] = { field: ctx.colorField };
  return { mark: 'bar', encoding: enc, ...(ctx.horizontal ? { height: { step: 24 } } : {}) };
}

function lineLike(ctx, mark) {
  const x = ctx.def('x');
  const y = ctx.def('y');
  const color = ctx.def('color');
  const main = { params: [ZOOM_X, ...(color ? [legendParam(ctx.colorField)] : [])], mark, encoding: { y, ...(color ? { color, opacity: { condition: { param: 'pa_legend', empty: true, value: 1 }, value: 0.2 } } : {}) } };
  const rule = { params: [NEAREST_X], mark: { type: 'rule', tooltip: false }, encoding: { opacity: { condition: { param: 'pa_x', empty: false, value: 0.5 }, value: 0 } } };
  const dots = { mark: { type: 'point', filled: true }, encoding: { y, ...(color ? { color } : {}), opacity: { condition: { param: 'pa_x', empty: false, value: 1 }, value: 0 } } };
  return { encoding: { x }, layer: [main, rule, dots] };
}

const BUILDERS = {
  bar: (ctx) => bar(ctx),
  'stacked-bar': (ctx) => bar(ctx, { color: true }),
  'grouped-bar': (ctx) => bar(ctx, { color: true, offset: true }),
  line: (ctx) => lineLike(ctx, 'line'),
  area: (ctx) => lineLike(ctx, 'area'),
  scatter: (ctx) => ({ mark: 'point', encoding: { x: ctx.def('x'), y: ctx.def('y'), ...(ctx.colorField ? { color: ctx.def('color') } : {}) } }),
  bubble: (ctx) => ({ mark: 'circle', encoding: { x: ctx.def('x'), y: ctx.def('y'), size: ctx.def('size'), ...(ctx.colorField ? { color: ctx.def('color') } : {}) } }),
  heatmap: (ctx) => ({ mark: 'rect', encoding: { x: banded(ctx.def('x')), y: banded(ctx.def('y')), color: ctx.def('value') } }),
  histogram: (ctx) => ({ mark: 'bar', encoding: { x: ctx.def('value', { bin: { maxbins: 20 } }), y: { aggregate: 'count', type: 'quantitative', title: 'Count' } } }),
  boxplot: (ctx) => ({ mark: { type: 'boxplot', extent: 1.5 }, encoding: { y: ctx.def('value'), ...(ctx.def('x') ? { x: ctx.def('x') } : {}) } }),
  donut: (ctx) => ({ mark: { type: 'arc', innerRadius: 60 }, encoding: { theta: ctx.def('y', { stack: true }), color: ctx.def('x') } }),
};

// Adds the kind's params and opacity to a built unit view.
function interactive(kind, vl, ctx) {
  const { params, opacity } = interactionsFor(kind, ctx);
  const withParams = params.length ? { params, ...vl } : vl;
  const withOpacity = opacity && !vl.layer ? { ...withParams, encoding: { ...withParams.encoding, opacity } } : withParams;
  return addTooltips(withOpacity);
}

export function buildView(name, chart, ctx) {
  return interactive(name, BUILDERS[name](ctx), ctx);
}

function expandKind(chart, result) {
  const ctx = context(chart, result);
  const primary = { name: chart.kind, label: KINDS[chart.kind].label, vegaLite: buildView(chart.kind, chart, ctx) };
  return { views: [primary, TABLE], errors: [] };
}

function expandRaw(chart, result) {
  const classes = Object.fromEntries(result.columns.map((c, i) => [c, classOf(result.types[i])]));
  return { views: [{ name: 'chart', label: 'Chart', vegaLite: enhanceRaw(chart.vegaLite, classes) }, TABLE], errors: [] };
}

export function expandCharts(spec, results) {
  const charts = [];
  const errors = [];
  for (const chart of spec.charts ?? []) {
    const result = results[chart.query];
    const out = chart.kind ? expandKind(chart, result) : expandRaw(chart, result);
    errors.push(...out.errors);
    charts.push({
      id: chart.id, title: chart.title, query: chart.query, width: chart.width ?? 'full',
      pair: false, empty: result.rowCount === 0, views: out.views,
    });
  }
  return { charts, errors };
}
