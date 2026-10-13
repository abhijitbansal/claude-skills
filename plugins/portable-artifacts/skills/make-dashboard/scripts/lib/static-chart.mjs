// A dashboard chart as a static SVG, rendered in Node with Vega (no browser, no
// network). One SVG per colour scheme, because a chart's colours are baked into
// its marks; the caller shows the one that matches the page theme.
import * as vega from 'vega';
import { compile } from 'vega-lite';
import { vegaConfig } from './vega-config.mjs';
import { tickLayout } from './axis-ticks.mjs';
import { AXIS_FORMAT } from './views.mjs';

// Two widths per scheme: a phone shows the narrow one at about its natural size instead of shrinking the wide one.
// labelX/labelY cap an axis label's width (long names end in an ellipsis instead of squeezing the plot);
// ticks is the most ticks on a horizontal value axis (a vertical one takes VERTICAL_TICKS), dates the most date ticks;
// si: an axis with no format of its own prints thousands as 1.5k (a phone has no room for 1,500).
export const STATIC_SIZES = {
  wide: { width: 600, labelX: 240, labelY: 240, ticks: 7, dates: 4 },
  narrow: { width: 320, labelX: 130, labelY: 110, ticks: 4, dates: 2, si: true },
};
export const STATIC_HEIGHT = 280;
const VERTICAL_TICKS = 6;
const LABEL_SIZE = 12;
const SI_FORMAT = '.3~s';
// Static charts are scaled down on a phone, so type is a point larger than on the dashboard page.
const staticType = ({ labelX, labelY }) => ({
  axis: { labelFontSize: LABEL_SIZE, titleFontSize: 13 },
  axisX: { labelLimit: labelX },
  axisY: { labelLimit: labelY },
  legend: { labelFontSize: 13, titleFontSize: 13 },
  text: { fontSize: 12 },
});

// Vega-Lite warns about autosize details that do not matter here; the dashboard page shows none of them either.
const QUIET = { level() { return this; }, warn() { return this; }, info() { return this; }, debug() { return this; }, error(...args) { throw new Error(args.join(' ')); } };

const COLOUR_ROLES = ['surface', 'text2', 'text3', 'grid'];
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** `"Family", fallback` for a theme's body font (the page's --font value). */
export const fontOf = (fonts) => `"${fonts.body.family}", ${fonts.body.fallback}`;

/** A theme's light or dark token set -> the colours vegaConfig takes. */
export function coloursOf(tokens) {
  return {
    ...Object.fromEntries(COLOUR_ROLES.map((k) => [k, tokens[k]])),
    cat: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => tokens[`cat${i}`]),
    seq: [1, 2, 3, 4, 5, 6, 7].map((i) => tokens[`seq${i}`]),
  };
}

// An opacity encoding that reads a pa_* interaction param (hover dim, legend dim).
const readsInteraction = (opacity) => isObject(opacity) && [].concat(opacity.condition ?? []).some((c) => String(c.param ?? '').startsWith('pa_'));

/**
 * A view without its interaction: params dropped, hover-only layers (the
 * nearest-x rule and dots, invisible until hovered) removed, interaction
 * opacity removed. Nothing else changes.
 */
export function staticView(node) {
  if (Array.isArray(node)) return node.map(staticView);
  if (!isObject(node)) return node;
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'params') continue;
    if (key === 'layer' && Array.isArray(value)) {
      out.layer = value.filter((l) => !(readsInteraction(l.encoding?.opacity) && l.encoding.opacity.value === 0)).map(staticView);
    } else if (key === 'encoding' && isObject(value)) {
      out.encoding = staticView(Object.fromEntries(Object.entries(value).filter(([ch, def]) => !(ch === 'opacity' && readsInteraction(def)))));
    } else {
      out[key] = staticView(value);
    }
  }
  return out;
}

const merge = (a, b) => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = isObject(v) && isObject(a?.[k]) ? merge(a[k], v) : v;
  return out;
};

const unescapeField = (field) => String(field).replace(/\\(.)/g, '$1');
const toTime = (v) => Date.parse(typeof v === 'string' && v.length === 10 ? `${v}T00:00:00Z` : v);
const DAY = 86400000;

// One label format for the data's own unit, unambiguous: a year, a month, a day, or a day with a 24-hour time.
function dateFormat(times) {
  const dates = times.map((t) => new Date(t));
  if (dates.some((d) => d.getTime() % DAY !== 0)) return '%b %d %H:%M';
  if (dates.every((d) => d.getUTCDate() === 1 && d.getUTCMonth() === 0)) return '%Y';
  if (dates.every((d) => d.getUTCDate() === 1)) return '%b %Y';
  return '%b %d, %Y';
}

// At most `max` of the sorted times, evenly spread, first and last included: every k-th data time when the count
// divides evenly, else evenly spaced in time (so the steps never differ).
function thin(times, max) {
  if (times.length <= max) return times;
  for (let m = max; m >= 3; m--) {
    if ((times.length - 1) % (m - 1) === 0) {
      const k = (times.length - 1) / (m - 1);
      return Array.from({ length: m }, (_, i) => times[i * k]);
    }
  }
  const first = times[0];
  const last = times.at(-1);
  return Array.from({ length: max }, (_, i) => Math.round(first + ((last - first) * i) / (max - 1)));
}

/**
 * Temporal x/y axes tick on the data's own times (thinned to `max`), labelled in one format for their unit, so
 * the ticks line up with the points and the last one is labelled. An axis that sets its own `values` is left alone.
 */
export function alignDateTicks(node, rows, max) {
  if (Array.isArray(node)) return node.map((n) => alignDateTicks(n, rows, max));
  if (!isObject(node)) return node;
  const out = Object.fromEntries(Object.entries(node).map(([k, v]) => [k, k === 'data' ? v : alignDateTicks(v, rows, max)]));
  if (isObject(out.encoding)) {
    for (const channel of ['x', 'y']) {
      const def = out.encoding[channel];
      if (!isObject(def) || def.type !== 'temporal' || typeof def.field !== 'string' || def.axis === null || def.axis?.values !== undefined) continue;
      const all = [...new Set(rows.map((r) => toTime(r[unescapeField(def.field)])).filter(Number.isFinite))].sort((a, b) => a - b);
      if (all.length > 0) out.encoding = { ...out.encoding, [channel]: { ...def, axis: { ...def.axis, values: thin(all, max), format: def.axis?.format ?? dateFormat(all) } } };
    }
  }
  return out;
}

const locale = vega.formatLocale();
/** A number as the chart axis prints it for a dashboard `format` name (number, currency, percent, compact). */
export const axisFormat = (value, format) => locale.format(AXIS_FORMAT[format] ?? AXIS_FORMAT.number)(value);

// Vega writes aria attributes per mark; the whole figure is one labelled image, so they are dropped.
const stripAria = (svg) => svg.replace(/ (?:aria-[a-z]+|role)="[^"]*"/g, '');

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Two SVGs on one page must not share ids (clip paths, gradients); every id and its references get `prefix`.
function prefixIds(svg, prefix) {
  const ids = new Set([...svg.matchAll(/ id="([^"]*)"/g)].map((m) => m[1]));
  let out = svg;
  for (const id of ids) {
    out = out.replaceAll(` id="${id}"`, ` id="${prefix}${id}"`)
      .replace(new RegExp(`url\\(#${escapeRe(id)}\\)`, 'g'), `url(#${prefix}${id})`)
      .replace(new RegExp(` (xlink:href|href)="#${escapeRe(id)}"`, 'g'), ` $1="#${prefix}${id}"`);
  }
  return out;
}

const runView = async (vegaSpec) => {
  const view = new vega.View(vega.parse(vegaSpec), { renderer: 'none', logLevel: vega.Error });
  await view.runAsync();
  return view;
};

// A linear scale with a visible axis: where tick planning applies.
function valueScales(vegaSpec) {
  return (vegaSpec.scales ?? []).filter((sc) => sc.type === 'linear' && (vegaSpec.axes ?? []).some((a) => a.scale === sc.name && !a.grid));
}

/**
 * Value axes (linear scales) get ticks chosen from the room they have and the width of their labels, and a
 * domain that ends on a tick, so no tick label is hidden for overlap and the scale never runs far past the data.
 * One extra layout pass reads each scale's raw extent and pixel length. Facets and concats are left to Vega.
 */
async function planValueAxes(vegaSpec, sizing) {
  const scales = valueScales(vegaSpec);
  if (scales.length === 0 || vegaSpec.scales.some((sc) => sc.name.includes('child__'))) return vegaSpec;
  const raw = structuredClone(vegaSpec);
  for (const sc of raw.scales) if (scales.some((v) => v.name === sc.name)) sc.nice = false;
  const view = await runView(raw);
  try {
    const plan = new Map();
    const siFormatted = new Set();
    for (const sc of scales) {
      const axis = vegaSpec.axes.find((a) => a.scale === sc.name && !a.grid);
      if (axis.formatType !== undefined && axis.formatType !== 'number') continue;
      const horizontal = axis.orient === 'bottom' || axis.orient === 'top';
      const scale = view.scale(sc.name);
      const [r0, r1] = scale.range();
      const [d0, d1] = scale.domain();
      const spec = axis.format ?? (sizing.si && Math.max(Math.abs(d0), Math.abs(d1)) >= 1000 ? SI_FORMAT : undefined);
      if (spec && !axis.format) siFormatted.add(sc.name);
      const format = spec ? locale.format(spec) : null;
      const label = (v, step) => (format ? format(v) : locale.format(`,.${Math.min(6, Math.max(0, -Math.floor(Math.log10(step))))}f`)(v));
      const layout = tickLayout({ domain: scale.domain(), pixels: Math.abs(r1 - r0), label, fontSize: LABEL_SIZE, horizontal, max: horizontal ? sizing.ticks : VERTICAL_TICKS });
      if (layout) plan.set(sc.name, layout);
    }
    if (plan.size === 0) return vegaSpec;
    const planned = structuredClone(vegaSpec);
    for (const sc of planned.scales) {
      const layout = plan.get(sc.name);
      if (!layout) continue;
      for (const key of ['nice', 'zero', 'domainMin', 'domainMax', 'domainMid', 'domainRaw']) delete sc[key];
      sc.domain = layout.domain;
    }
    for (const axis of planned.axes) {
      const layout = plan.get(axis.scale);
      if (!layout) continue;
      axis.values = layout.values;
      if (siFormatted.has(axis.scale) && axis.format === undefined) axis.format = SI_FORMAT;
      delete axis.tickCount;
      delete axis.tickMinStep;
    }
    return planned;
  } finally {
    view.finalize();
  }
}

/**
 * One SVG string for `vegaLite` drawn over `rows` with `colours` (see coloursOf) and `font`.
 * Mirrors the dashboard page's embed(): the view's own height wins, a unit view
 * gets a fixed width and "fit" autosize.
 */
export async function renderSvg(vegaLite, rows, { colours, font, size = 'wide', idPrefix = '' }) {
  const sizing = STATIC_SIZES[size];
  const base = alignDateTicks(staticView(vegaLite), rows, sizing.dates);
  const unit = !('hconcat' in base || 'vconcat' in base || 'concat' in base || 'repeat' in base || 'facet' in base);
  const own = base.config?.numberFormat ? { numberFormat: base.config.numberFormat } : {};
  const config = { ...merge(vegaConfig(colours, font), staticType(sizing)), ...own };
  const spec = { height: STATIC_HEIGHT, ...base, data: { values: rows }, config };
  if (unit) {
    spec.width = sizing.width;
    spec.autosize = { type: typeof spec.height === 'object' ? 'fit-x' : 'fit', contains: 'padding' };
  }
  const vegaSpec = await planValueAxes(compile(spec, { logger: QUIET }).spec, sizing);
  const view = await runView(vegaSpec);
  try {
    const svg = stripAria(await view.toSVG());
    return prefixIds(svg.replace('<svg ', '<svg aria-hidden="true" focusable="false" '), idPrefix);
  } finally {
    view.finalize();
  }
}

/**
 * The SVGs for a theme loaded by shared/theme.mjs ({ light, dark, fonts }):
 * { light: { wide, narrow }, dark: { wide, narrow } } strings. Ids carry `idPrefix`, the scheme and the size.
 */
export async function renderThemedSvgs(vegaLite, rows, theme, { idPrefix = 'c-' } = {}) {
  const font = fontOf(theme.fonts);
  const draw = (mode, size) => renderSvg(vegaLite, rows, { colours: coloursOf(theme[mode]), font, size, idPrefix: `${idPrefix}${mode[0]}${size[0]}-` });
  const both = (mode) => Promise.all(['wide', 'narrow'].map((size) => draw(mode, size))).then(([wide, narrow]) => ({ wide, narrow }));
  const [light, dark] = await Promise.all([both('light'), both('dark')]);
  return { light, dark };
}
