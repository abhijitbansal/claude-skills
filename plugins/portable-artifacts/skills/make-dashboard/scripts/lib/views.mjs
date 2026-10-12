// Expand kind charts into Vega-Lite views at build time, from the query rows
// and their DuckDB column types. The page renders exactly what this returns.
import { KINDS, classOf, fieldRef } from './kinds.mjs';
import { enhanceRaw, interactionsFor, NEAREST_X, ZOOM_X, legendParam } from './interact.mjs';

const AXIS_FORMAT = { number: ',.2~f', currency: '$,.2~f', percent: '.1~%', compact: '.3~s' };
const HORIZONTAL_LABEL = 12;
const HORIZONTAL_COUNT = 8;
const TABLE = { name: 'table', label: 'Table' };
export const LABELS = { sorted: 'Sorted', share: 'Share', grouped: 'Grouped', stacked: 'Stacked', normalized: '100%', area: 'Area', line: 'Line', scatter: 'Scatter', boxplot: 'Box plot', histogram: 'Histogram', bar: 'Bar' };
const MAX_COLORS = 8;
const MAX_COLORS_ALL_PAIRS = 3; // dataviz: scatter/bubble validate only the first three slots all-pairs
const MAX_DONUT = 6;

export function temporalUnit(values) {
  const dates = values.filter((v) => v !== null && v !== undefined).map((v) => new Date(String(v).length === 10 ? `${v}T00:00:00Z` : v));
  if (!dates.length || dates.some((d) => Number.isNaN(d.getTime()))) return null;
  const midnight = dates.every((d) => d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0);
  if (!midnight) return null;
  if (dates.every((d) => d.getUTCDate() === 1 && d.getUTCMonth() === 0)) return 'utcyear';
  if (dates.every((d) => d.getUTCDate() === 1)) return 'utcyearmonth';
  return 'utcyearmonthdate';
}

// A field def reduced to what a tooltip row needs; a quantitative one gets the chart's format.
function tooltipRow(d, format) {
  const { field, type, title, timeUnit, bin, aggregate } = d;
  return {
    field, type, title,
    ...(timeUnit ? { timeUnit } : {}), ...(bin ? { bin } : {}), ...(aggregate ? { aggregate } : {}),
    ...(type === 'quantitative' && format ? { format } : {}),
  };
}

// Per-chart context the builders share: field defs for every role in use.
function context(chart, result) {
  const cls = (col) => classOf(result.types[result.columns.indexOf(col)]);
  const format = chart.format ? AXIS_FORMAT[chart.format] : undefined;
  // `where` is how the channel shows the number: an axis, a legend, or only the tooltip (theta).
  const def = (role, extra = {}, where = 'axis') => {
    const col = chart[role];
    if (col === undefined) return undefined;
    const type = cls(col);
    const base = { field: fieldRef(col), type, title: col };
    if (type === 'temporal') {
      const unit = temporalUnit(result.rows.map((r) => r[col]));
      Object.assign(base, unit ? { timeUnit: unit } : {}, { scale: { type: 'utc' } });
    }
    if (type === 'quantitative' && format && where !== 'tooltip') base[where] = { format };
    return { ...base, ...extra };
  };
  const tooltip = (...defs) => defs.filter(Boolean).map((d) => tooltipRow(d, format));
  const labels = chart.x !== undefined ? result.rows.map((r) => String(r[chart.x] ?? '')) : [];
  const distinct = new Set(labels);
  const horizontal = chart.x !== undefined && cls(chart.x) === 'nominal'
    && (distinct.size > HORIZONTAL_COUNT || labels.some((l) => l.length > HORIZONTAL_LABEL));
  // The legend field: donut colours by x; every other kind by its color role.
  const legend = chart.kind === 'donut' ? chart.x : chart.color;
  const xNominal = chart.x !== undefined && cls(chart.x) === 'nominal';
  return { def, tooltip, format, horizontal, xNominal, colorField: legend === undefined ? undefined : fieldRef(legend) };
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
  enc.tooltip = ctx.tooltip(x, y, enc.color);
  if (offset) enc[ctx.horizontal ? 'yOffset' : 'xOffset'] = { field: ctx.colorField };
  return { mark: 'bar', encoding: enc, ...(ctx.horizontal ? { height: { step: 24 } } : {}) };
}

function lineLike(ctx, mark) {
  const x = ctx.def('x', ctx.xNominal ? { sort: null } : {}); // nominal x keeps query order
  const y = ctx.def('y');
  const color = ctx.def('color');
  // A coloured area is stacked by Vega-Lite; the hover dots must sit on their band.
  const dotsY = mark === 'area' && color ? { ...y, stack: 'zero' } : y;
  // Zoom binds scales, which Vega-Lite supports only on continuous (temporal) x.
  const main = { params: [...(ctx.xNominal ? [] : [ZOOM_X]), ...(color ? [legendParam(ctx.colorField)] : [])], mark, encoding: { y, ...(color ? { color, opacity: { condition: { param: 'pa_legend', empty: true, value: 1 }, value: 0.2 } } : {}) } };
  const rule = { params: [NEAREST_X], mark: { type: 'rule', tooltip: false }, encoding: { opacity: { condition: { param: 'pa_x', empty: false, value: 0.5 }, value: 0 } } };
  const dots = { mark: { type: 'point', filled: true }, encoding: { y: dotsY, ...(color ? { color } : {}), tooltip: ctx.tooltip(x, y, color), opacity: { condition: { param: 'pa_x', empty: false, value: 1 }, value: 0 } } };
  return { encoding: { x }, layer: [main, rule, dots] };
}

export const BUILDERS = {
  bar: (ctx) => bar(ctx),
  'stacked-bar': (ctx) => bar(ctx, { color: true }),
  'grouped-bar': (ctx) => bar(ctx, { color: true, offset: true }),
  line: (ctx) => lineLike(ctx, 'line'),
  area: (ctx) => lineLike(ctx, 'area'),
  scatter: (ctx) => {
    const x = ctx.def('x');
    const y = ctx.def('y');
    const color = ctx.colorField ? ctx.def('color') : undefined;
    return { mark: 'point', encoding: { x, y, ...(color ? { color } : {}), tooltip: ctx.tooltip(x, y, color) } };
  },
  bubble: (ctx) => {
    const x = ctx.def('x');
    const y = ctx.def('y');
    const size = ctx.def('size', {}, 'legend');
    const color = ctx.colorField ? ctx.def('color') : undefined;
    return { mark: 'circle', encoding: { x, y, size, ...(color ? { color } : {}), tooltip: ctx.tooltip(x, y, size, color) } };
  },
  heatmap: (ctx) => {
    const x = banded(ctx.def('x'));
    const y = banded(ctx.def('y'));
    const color = ctx.def('value', {}, 'legend');
    return { mark: 'rect', encoding: { x, y, color, tooltip: ctx.tooltip(x, y, color) } };
  },
  histogram: (ctx) => {
    const x = ctx.def('value', { bin: { maxbins: 20 } });
    const count = { aggregate: 'count', type: 'quantitative', title: 'Count' };
    return { mark: 'bar', encoding: { x, y: count, tooltip: [...ctx.tooltip(x), count] } };
  },
  // VL builds the box-part tooltips itself and formats them with the config number format.
  boxplot: (ctx) => {
    const x = ctx.def('x');
    return {
      mark: { type: 'boxplot', extent: 1.5, tooltip: true },
      encoding: { y: ctx.def('value'), ...(x ? { x } : {}) },
      ...(ctx.format ? { config: { numberFormat: ctx.format } } : {}),
    };
  },
  donut: (ctx) => {
    const theta = ctx.def('y', { stack: true }, 'tooltip');
    const color = ctx.def('x');
    return { mark: { type: 'arc', innerRadius: 60 }, encoding: { theta, color, tooltip: ctx.tooltip(color, theta) } };
  },
  // Alternates reuse the primary helpers; share and normalized add transforms.
  sorted: (ctx) => bar(ctx, { sort: ctx.horizontal ? '-x' : '-y' }),
  share: (ctx, chart) => {
    const total = 'pa_total';
    const share = 'pa_share';
    const v = bar(ctx);
    const valueKey = ctx.horizontal ? 'x' : 'y';
    v.transform = [
      { joinaggregate: [{ op: 'sum', field: fieldRef(chart.y), as: total }] },
      { calculate: `datum[${JSON.stringify(chart.y)}] / datum.${total}`, as: share },
    ];
    const title = `Share of ${chart.y}`;
    v.encoding[valueKey] = { field: share, type: 'quantitative', title, axis: { format: '.0%' } };
    v.encoding.tooltip.push({ field: share, type: 'quantitative', title, format: '.1%' }); // after the raw value
    return v;
  },
  stacked: (ctx) => bar(ctx, { color: true }),
  grouped: (ctx) => bar(ctx, { color: true, offset: true }),
  normalized: (ctx) => {
    const v = bar(ctx, { color: true, stack: 'normalize' });
    v.encoding[ctx.horizontal ? 'x' : 'y'].axis = { format: '.0%' };
    return v;
  },
};

// Adds the kind's params and opacity to a built unit view.
function interactive(kind, vl, ctx) {
  const { params, opacity } = interactionsFor(kind, ctx);
  const withParams = params.length ? { params, ...vl } : vl;
  return opacity && !vl.layer ? { ...withParams, encoding: { ...withParams.encoding, opacity } } : withParams;
}

// Alternates share their primary's interaction family.
const FAMILY = { sorted: 'bar', share: 'bar', stacked: 'stacked-bar', grouped: 'stacked-bar', normalized: 'stacked-bar' };
export function buildView(name, chart, ctx) {
  return interactive(FAMILY[name] ?? name, BUILDERS[name](ctx, chart), ctx);
}

// A cell as a number, or null: wide DECIMALs arrive as numeric strings, NULLs as null.
function numeric(v) {
  if (typeof v === 'number' || typeof v === 'bigint') return Number(v);
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

// First row (1-based) whose value in `col` is negative, ignoring NULLs.
function firstNegative(rows, col) {
  const i = rows.findIndex((r) => numeric(r[col]) < 0);
  return i < 0 ? null : { row: i + 1, value: rows[i][col] };
}
const total = (rows, col) => rows.reduce((n, r) => n + (numeric(r[col]) ?? 0), 0);
// NULL counts as a category: it gets a colour and a legend entry like any other.
const distinct = (rows, col) => new Set(rows.map((r) => r[col] ?? null)).size;

// Which of the kind's alternate views these rows can support, and why not.
export function availableViews(chart, result) {
  const offered = [];
  const blocked = {};
  const nonNeg = (view) => {
    const neg = firstNegative(result.rows, chart.y);
    if (neg) { blocked[view] = `${view} needs every ${chart.y} >= 0 (row ${neg.row} has ${neg.value})`; return false; }
    if (!(total(result.rows, chart.y) > 0)) { blocked[view] = `${view} needs a positive total of ${chart.y}`; return false; }
    return true;
  };
  for (const view of KINDS[chart.kind].views) {
    let ok = true;
    if (view === 'share' || view === 'normalized') ok = nonNeg(view);
    if (view === 'area' && chart.color !== undefined) ok = nonNeg(view);
    if (ok) offered.push(view);
  }
  return { offered, blocked };
}

function colourErrors(chart, result, p) {
  if (chart.color === undefined) return [];
  const limit = chart.kind === 'scatter' || chart.kind === 'bubble' ? MAX_COLORS_ALL_PAIRS : MAX_COLORS;
  const n = distinct(result.rows, chart.color);
  return n > limit
    ? [{ path: `${p}.color`, message: `${chart.color} has ${n} values; ${chart.kind} colour allows at most ${limit} (fold the rest into "Other" in SQL or drop color)` }]
    : [];
}

function expandKind(chart, result, p) {
  const errors = colourErrors(chart, result, p);
  if (chart.kind === 'donut') {
    const n = distinct(result.rows, chart.x);
    if (n > MAX_DONUT) errors.push({ path: `${p}.kind`, message: `donut needs <= ${MAX_DONUT} slices (${chart.x} has ${n}); use kind "bar"` });
    else if (firstNegative(result.rows, chart.y)) errors.push({ path: `${p}.kind`, message: `donut needs every ${chart.y} >= 0; use kind "bar"` });
  }
  if (chart.kind === 'area' && chart.color !== undefined) {
    // A coloured area stacks, so it cannot draw negatives (an uncoloured area or a line can).
    const neg = firstNegative(result.rows, chart.y);
    if (neg) errors.push({ path: `${p}.kind`, message: `area with color stacks; it needs every ${chart.y} >= 0 (row ${neg.row} has ${neg.value}); use kind line` });
  }
  if (errors.length) return { views: [], errors };
  const ctx = context(chart, result);
  const { offered, blocked } = availableViews(chart, result);
  (chart.views ?? []).forEach((v, i) => {
    // An empty result blocks share/normalized by definition; that is a data refresh, not a spec defect.
    if (v !== 'table' && blocked[v] && result.rowCount > 0) errors.push({ path: `${p}.views[${i}]`, message: blocked[v] });
  });
  // `views` narrows and reorders the defaults; the table always comes last.
  const names = chart.views?.filter((v) => v !== 'table') ?? offered;
  const views = [
    { name: chart.kind, label: KINDS[chart.kind].label, vegaLite: buildView(chart.kind, chart, ctx) },
    ...names.filter((v) => offered.includes(v)).map((v) => ({ name: v, label: LABELS[v], vegaLite: buildView(v, chart, ctx) })),
    TABLE,
  ];
  return { views, errors };
}

function expandRaw(chart, result) {
  const classes = Object.fromEntries(result.columns.map((c, i) => [c, classOf(result.types[i])]));
  return { views: [{ name: 'chart', label: 'Chart', vegaLite: enhanceRaw(chart.vegaLite, classes) }, TABLE], errors: [] };
}

export function expandCharts(spec, results) {
  const charts = [];
  const errors = [];
  (spec.charts ?? []).forEach((chart, i) => {
    const result = results[chart.query];
    const out = chart.kind ? expandKind(chart, result, `charts[${i}]`) : expandRaw(chart, result);
    errors.push(...out.errors);
    const pair = chart.pair === true && out.views.length >= 2;
    charts.push({
      id: chart.id, title: chart.title, query: chart.query, width: pair ? 'full' : (chart.width ?? 'full'),
      pair, empty: result.rowCount === 0, views: out.views,
    });
  });
  return { charts, errors };
}
