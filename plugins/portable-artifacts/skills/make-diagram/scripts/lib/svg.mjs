// SVG string helpers shared by the graph and sequence renderers: escaping,
// number formatting, text, icons and arrow markers. Everything that reaches the
// output as text or as an attribute value goes through esc().
import { iconSvg } from './icons.mjs';

export const ICON_DRAW = 18; // px an icon is drawn at (the 24-unit icon scaled down)
const ICON_VIEW = 24;
const BASELINE = 0.35; // baseline sits this many em below the middle of a line box: centres the capitals

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
// eslint-disable-next-line no-control-regex
const XML_FORBIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

/** Text or attribute value -> safe markup. Control characters XML forbids are dropped. */
export const esc = (value) => String(value).replace(XML_FORBIDDEN, '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** A coordinate, at most 2 decimals, no trailing zeros. */
export const num = (v) => String(Math.round(v * 100) / 100);

/**
 * A <text> with one <tspan> per line. `top` is the top of the first line box,
 * `lh` the line height, `size` the font size (for the baseline).
 */
export function textLines(cls, lines, { x, top, lh, size, anchor = 'middle' }) {
  const spans = lines.map((line, i) => `<tspan x="${num(x)}" y="${num(top + lh * i + lh / 2 + BASELINE * size)}">${esc(line)}</tspan>`);
  return `<text class="${cls}" text-anchor="${anchor}">${spans.join('')}</text>`;
}

/** The icon `ref` drawn ICON_DRAW px wide with its top-left corner at (x, y). */
export function iconGroup(ref, x, y) {
  const { kind, markup } = iconSvg(ref);
  return `<g class="pa-icon pa-icon-${kind}" transform="translate(${num(x)} ${num(y)}) scale(${num(ICON_DRAW / ICON_VIEW)})">${markup}</g>`;
}

const BRAND_ICON = /(<g class="pa-icon pa-icon-brand"[^>]*>)<path d="([^"]*)"\/>(<\/g>)/g;

/**
 * Draw each brand icon's path once. A brand icon is one long path (up to 10 KB), and a
 * node inlines it, so 60 nodes sharing an icon would carry it 60 times. Returns the body
 * with each of those paths replaced by a <use> of a path in `defs` (ids start with `prefix`).
 */
export function shareBrandIcons(body, prefix) {
  const ids = new Map();
  const shared = body.replace(BRAND_ICON, (_, open, d, close) => {
    if (!ids.has(d)) ids.set(d, `${esc(prefix)}-icon-${ids.size + 1}`);
    return `${open}<use href="#${ids.get(d)}"/>${close}`;
  });
  return { body: shared, defs: [...ids].map(([d, id]) => `<path id="${id}" d="${d}"/>`).join('') };
}

export const MARKER_SIZE = 8;

/** Arrow head ids for one diagram (escaped: they go straight into attributes). */
export const markerIds = (prefix) => ({ solid: `${esc(prefix)}-arrow`, open: `${esc(prefix)}-arrow-open` });

/** <defs> holding the two arrow heads (a filled one and an open chevron, tips at the path end) and `extra` markup. */
export function markerDefs(prefix, extra = '') {
  const ids = markerIds(prefix);
  const s = MARKER_SIZE;
  const marker = (id, ref, body) => `<marker id="${id}" viewBox="0 0 ${s} ${s}" refX="${ref}" refY="${s / 2}" markerWidth="${s}" markerHeight="${s}" markerUnits="userSpaceOnUse" orient="auto-start-reverse">${body}</marker>`;
  return `<defs>${marker(ids.solid, s, `<path class="pa-arrow-fill" d="M0 0.5L${s} ${s / 2}L0 ${s - 0.5}Z"/>`)}${marker(ids.open, s - 0.6, `<path class="pa-arrow-open" d="M0.8 0.8L${s - 0.6} ${s / 2}L0.8 ${s - 0.8}"/>`)}${extra}</defs>`;
}
