// Expand kind charts into Vega-Lite views at build time, from the query rows
// and their DuckDB column types. The page renders exactly what this returns.
import { KINDS, classOf, fieldRef } from './kinds.mjs';
import { enhanceRaw, interactionsFor, NEAREST_X, ZOOM_X, legendParam } from './interact.mjs';

export const AXIS_FORMAT = { number: ',.2~f', currency: '$,.2~f', percent: '.1~%', compact: '.3~s' };
export const FORMAT_NAMES = Object.keys(AXIS_FORMAT);
// d3's SI suffixes (1.2G, 1.5k) rewritten to the ones Intl uses on a KPI tile (1.2B, 1.5K), so a compact
// number reads the same on the axis, the legend and the tile. A Vega expression: it runs in ast mode under the CSP.
export const COMPACT_LABEL_EXPR = "replace(replace(datum.label, 'G', 'B'), 'k', 'K')";
// A tooltip shows the exact value; only the axis and legend are abbreviated.
const TOOLTIP_FORMAT = { ...AXIS_FORMAT, compact: AXIS_FORMAT.number };
const axisProps = (name) => (name === 'compact' ? { format: AXIS_FORMAT.compact, labelExpr: COMPACT_LABEL_EXPR } : { format: AXIS_FORMAT[name] });
// Category labels on vertical bars: Vega would hide every other one when they crowd (at 390 px), so
// overlap is off and the labels turn 45 degrees once a band is narrower than the widest label.
const LABEL_FONT_SIZE = 11; // vega-config.mjs axis labelFontSize
// A label's width estimated at a monospace advance (0.6 em, the widest body font a theme ships) plus a little:
// the views are built before the theme is known, and a label that turns too early costs less than one that collides.
const CHAR_EM = 0.62;
const LABEL_ROOM = 6;
const SNAKE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;

/** An axis title for a column: snake_case SQL aliases read as words (p50_ms -> "P50 ms"); any other name stays as written. */
export function humanize(column) {
  const name = String(column);
  if (!SNAKE.test(name)) return name;
  const words = name.replaceAll('_', ' ');
  return words[0].toUpperCase() + words.slice(1);
}
const lowerFirst = (text) => text[0].toLowerCase() + text.slice(1);
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

const MIN_LINE_POINTS = 3;
// Points per series (one series without a color role), counting rows with a y value.
function seriesSizes(chart, result) {
  if (chart.y === undefined) return [];
  const counts = new Map();
  for (const r of result.rows) {
    if (r[chart.y] === null || r[chart.y] === undefined) continue;
    const key = chart.color === undefined ? '' : r[chart.color] ?? null;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.values()];
}

// Per-chart context the builders share: field defs for every role in use.
function context(chart, result) {
  const cls = (col) => classOf(result.types[result.columns.indexOf(col)]);
  const format = chart.format ? AXIS_FORMAT[chart.format] : undefined;
  const tipFormat = chart.format ? TOOLTIP_FORMAT[chart.format] : undefined;
  // `where` is how the channel shows the number: an axis, a legend, or only the tooltip (theta).
  const def = (role, extra = {}, where = 'axis') => {
    const col = chart[role];
    if (col === undefined) return undefined;
    const type = cls(col);
    const base = { field: fieldRef(col), type, title: humanize(col) };
    if (type === 'temporal') {
      const unit = temporalUnit(result.rows.map((r) => r[col]));
      Object.assign(base, unit ? { timeUnit: unit } : {}, { scale: { type: 'utc' } });
    }
    if (type === 'quantitative' && format && where !== 'tooltip') base[where] = axisProps(chart.format);
    return { ...base, ...extra };
  };
  const tooltip = (...defs) => defs.filter(Boolean).map((d) => tooltipRow(d, tipFormat));
  const labels = chart.x !== undefined ? result.rows.map((r) => String(r[chart.x] ?? '')) : [];
  const distinct = new Set(labels);
  const horizontal = chart.x !== undefined && cls(chart.x) === 'nominal'
    && (distinct.size > HORIZONTAL_COUNT || labels.some((l) => l.length > HORIZONTAL_LABEL));
  // The legend field: donut colours by x; every other kind by its color role.
  const legend = chart.kind === 'donut' ? chart.x : chart.color;
  const xNominal = chart.x !== undefined && cls(chart.x) === 'nominal';
  // A nominal role keeps the query order (Vega-Lite would sort it alphabetically: Fri, Mon, Sat).
  const queryOrder = (role) => (chart[role] !== undefined && cls(chart[role]) === 'nominal' ? { sort: null } : {});
  const widest = Math.ceil(Math.max(0, ...[...distinct].map((l) => [...l].length * CHAR_EM * LABEL_FONT_SIZE))) + LABEL_ROOM;
  const shortSeries = seriesSizes(chart, result).some((n) => n < MIN_LINE_POINTS);
  return { def, tooltip, format, tipFormat, horizontal, xNominal, queryOrder, widest, shortSeries, colorField: legend === undefined ? undefined : fieldRef(legend) };
}

// Bars on a time axis read better as ordinal bands.
const banded = (d) => {
  if (!d || d.type !== 'temporal') return d;
  const { scale, ...rest } = d; // a utc scale does not apply to ordinal bands
  return { ...rest, type: 'ordinal' };
};

// The x axis of vertical bars over categories: every label stays, turned when the bands are too narrow.
function categoryAxis(widest) {
  const narrow = `bandwidth('x') < ${widest}`;
  return { labelOverlap: false, labelAngle: { expr: `${narrow} ? -45 : 0` }, labelAlign: { expr: `${narrow} ? 'right' : 'center'` } };
}

function bar(ctx, { color, stack, offset, sort } = {}) {
  const axis = ctx.xNominal && !ctx.horizontal ? { axis: categoryAxis(ctx.widest) } : {};
  const x = banded(ctx.def('x', { sort: sort ?? null, ...axis }));
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
  // A series of one point draws no line at all, two barely show: give short series visible points.
  const main = { params: [...(ctx.xNominal ? [] : [ZOOM_X]), ...(color ? [legendParam(ctx.colorField)] : [])], mark: ctx.shortSeries ? { type: mark, point: true } : mark, encoding: { y, ...(color ? { color, opacity: { condition: { param: 'pa_legend', empty: true, value: 1 }, value: 0.2 } } : {}) } };
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
    const x = banded(ctx.def('x', ctx.queryOrder('x')));
    const y = banded(ctx.def('y', ctx.queryOrder('y')));
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
    const x = ctx.def('x', ctx.queryOrder('x'));
    return {
      mark: { type: 'boxplot', extent: 1.5, tooltip: true },
      encoding: { y: ctx.def('value'), ...(x ? { x } : {}) },
      ...(ctx.tipFormat ? { config: { numberFormat: ctx.tipFormat } } : {}),
    };
  },
  donut: (ctx) => {
    const theta = ctx.def('y', { stack: true }, 'tooltip');
    const color = ctx.def('x', ctx.queryOrder('x'));
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
    const title = `Share of ${SNAKE.test(String(chart.y)) ? lowerFirst(humanize(chart.y)) : chart.y}`; // "Share of revenue", "Share of Total Revenue"
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
