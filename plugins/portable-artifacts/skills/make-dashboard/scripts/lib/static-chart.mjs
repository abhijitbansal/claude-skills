// A dashboard chart as a static SVG, rendered in Node with Vega (no browser, no
// network). One SVG per colour scheme, because a chart's colours are baked into
// its marks; the caller shows the one that matches the page theme.
import * as vega from 'vega';
import { compile } from 'vega-lite';
import { vegaConfig } from './vega-config.mjs';

// Two widths per scheme: a phone shows the narrow one at about its natural size instead of shrinking the wide one.
// labelX/labelY cap an axis label's width (long names end in an ellipsis instead of squeezing the plot);
// ticks is the most ticks on a horizontal value axis (fewer when its labels would not fit side by side),
// dates the most date ticks.
export const STATIC_SIZES = {
  wide: { width: 600, labelX: 240, labelY: 240, ticks: 7, dates: 4 },
  narrow: { width: 320, labelX: 130, labelY: 110, ticks: 3, dates: 2 },
};
export const STATIC_HEIGHT = 280;
// Static charts are scaled down on a phone, so type is a point larger than on the dashboard page.
const staticType = ({ labelX, labelY }) => ({
  axis: { labelFontSize: 12, titleFontSize: 13 },
  axisX: { labelLimit: labelX },
  axisY: { labelLimit: labelY, tickCount: 6 },
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

// At most `max` of the sorted values, evenly spread, always including the first and the last.
function spread(values, max) {
  if (values.length <= max) return values;
  const picked = Array.from({ length: max }, (_, k) => values[Math.round((k * (values.length - 1)) / (max - 1))]);
  return [...new Set(picked)];
}

/**
 * Temporal x/y axes tick on the data's own dates (thinned to `max`), so the ticks line up with the points
 * and the last date is labelled; a default time axis picks round dates that match no point.
 */
export function alignDateTicks(node, rows, max) {
  if (Array.isArray(node)) return node.map((n) => alignDateTicks(n, rows, max));
  if (!isObject(node)) return node;
  const out = Object.fromEntries(Object.entries(node).map(([k, v]) => [k, k === 'data' ? v : alignDateTicks(v, rows, max)]));
  if (isObject(out.encoding)) {
    for (const channel of ['x', 'y']) {
      const def = out.encoding[channel];
      if (!isObject(def) || def.type !== 'temporal' || typeof def.field !== 'string' || def.axis === null) continue;
      const times = rows.map((r) => toTime(r[unescapeField(def.field)])).filter(Number.isFinite);
      const values = spread([...new Set(times)].sort((a, b) => a - b), max);
      if (values.length > 0) out.encoding = { ...out.encoding, [channel]: { ...def, axis: { ...def.axis, values } } };
    }
  }
  return out;
}

/**
 * A horizontal value axis with `count` ticks whose scale is niced to the same count: the domain ends on a tick,
 * so the longest bar never runs past the last label.
 */
export function fitValueTicks(node, count) {
  if (Array.isArray(node)) return node.map((n) => fitValueTicks(n, count));
  if (!isObject(node)) return node;
  const out = Object.fromEntries(Object.entries(node).map(([k, v]) => [k, k === 'data' ? v : fitValueTicks(v, count)]));
  const x = out.encoding?.x;
  if (isObject(x) && x.type === 'quantitative' && x.axis !== null && x.scale?.type === undefined) {
    out.encoding = { ...out.encoding, x: { ...x, scale: { ...x.scale, nice: count }, axis: { ...x.axis, tickCount: count } } };
  }
  return out;
}

const hasValueX = (node) => (Array.isArray(node) ? node.some(hasValueX) : isObject(node) && ((isObject(node.encoding?.x) && node.encoding.x.type === 'quantitative') || Object.entries(node).some(([k, v]) => k !== 'data' && hasValueX(v))));
const MIN_TICKS = 2;

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
  const draw = async (view) => {
    const spec = { height: STATIC_HEIGHT, ...view, data: { values: rows }, config };
    if (unit) {
      spec.width = sizing.width;
      spec.autosize = { type: typeof spec.height === 'object' ? 'fit-x' : 'fit', contains: 'padding' };
    }
    const v = new vega.View(vega.parse(compile(spec, { logger: QUIET }).spec), { renderer: 'none', logLevel: vega.Error });
    try {
      return stripAria(await v.toSVG());
    } finally {
      v.finalize();
    }
  };
  // Vega hides a tick label that would overlap its neighbour (opacity 0); on a value axis, retry with fewer ticks.
  let svg;
  for (let ticks = sizing.ticks; ; ticks--) {
    svg = await draw(hasValueX(base) ? fitValueTicks(base, ticks) : base);
    if (ticks <= MIN_TICKS || !hasValueX(base) || !svg.includes(' opacity="0"')) break;
  }
  return prefixIds(svg.replace('<svg ', '<svg aria-hidden="true" focusable="false" '), idPrefix);
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
