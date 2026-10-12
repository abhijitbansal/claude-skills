// Interaction params added at build: deterministic per kind, namespaced pa_*
// so they never collide with params a model wrote. Verified to evaluate under
// vega-embed { ast: true } and the page's strict CSP (spike, 2026-10-12).

export const HOVER = { name: 'pa_hover', select: { type: 'point', on: 'pointerover', clear: 'pointerout' } };
export const ZOOM_X = { name: 'pa_zoom', select: { type: 'interval', encodings: ['x'] }, bind: 'scales' };
export const ZOOM_XY = { name: 'pa_zoom', select: { type: 'interval' }, bind: 'scales' };
export const NEAREST_X = { name: 'pa_x', select: { type: 'point', encodings: ['x'], nearest: true, on: 'pointerover', clear: 'pointerout' } };
export const legendParam = (field) => ({ name: 'pa_legend', select: { type: 'point', fields: [field] }, bind: 'legend' });
const dimUnless = (param) => ({ condition: { param, empty: true, value: 1 }, value: param === 'pa_legend' ? 0.2 : 0.55 });

export function addTooltips(node) {
  if (Array.isArray(node)) return node.map(addTooltips);
  if (!node || typeof node !== 'object') return node;
  const out = {};
  for (const [k, v] of Object.entries(node)) out[k] = addTooltips(v);
  if (typeof node.mark === 'string') out.mark = { type: node.mark, tooltip: true };
  else if (node.mark && typeof node.mark === 'object' && node.mark.tooltip === undefined) out.mark = { ...node.mark, tooltip: true };
  return out;
}

// For a kind: which params to add and which opacity encoding expresses them.
// `colorField` is the escaped field ref of the colour role, or undefined.
export function interactionsFor(kind, { colorField } = {}) {
  switch (kind) {
    case 'bar':
    case 'histogram':
    case 'heatmap':
      return { params: [HOVER], opacity: dimUnless('pa_hover') };
    case 'stacked-bar':
    case 'grouped-bar':
    case 'donut':
      return { params: [legendParam(colorField)], opacity: dimUnless('pa_legend') };
    case 'scatter':
    case 'bubble':
      return colorField
        ? { params: [ZOOM_XY, legendParam(colorField)], opacity: dimUnless('pa_legend') }
        : { params: [ZOOM_XY] };
    default:
      return { params: [] }; // line/area: built as layers in views.mjs; boxplot: tooltip only
  }
}

const hasParams = (node) => {
  if (Array.isArray(node)) return node.some(hasParams);
  if (!node || typeof node !== 'object') return false;
  return Array.isArray(node.params) || Object.values(node).some(hasParams);
};
const isUnit = (vl) => !['layer', 'hconcat', 'vconcat', 'concat', 'repeat', 'facet', 'spec'].some((k) => k in vl);
const markOf = (vl) => (typeof vl.mark === 'string' ? vl.mark : vl.mark?.type);

// Best effort for model-written Vega-Lite: tooltips everywhere; a legend
// filter or zoom only on simple unit specs that declare no params of their own.
export function enhanceRaw(vl, classes) {
  const out = addTooltips(vl);
  if (hasParams(vl) || !isUnit(vl)) return out;
  const color = vl.encoding?.color;
  if (color?.field && (color.type === 'nominal' || classes[color.field] === 'nominal') && !vl.encoding.opacity) {
    return { ...out, params: [legendParam(color.field)], encoding: { ...out.encoding, opacity: dimUnless('pa_legend') } };
  }
  if (['point', 'circle', 'square'].includes(markOf(vl))) return { ...out, params: [ZOOM_XY] };
  return out;
}
