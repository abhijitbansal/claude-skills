// The legend at the top right of every diagram: one swatch and count per node
// kind used, then one wire sample per edge style (message kind) used. The
// layouts reserve LEGEND_BAND above the drawing for the row and widen the canvas
// when the row is wider than the drawing; the renderer draws geometry.legend.
import { measure, lineHeight } from '../../shared/text.mjs';
import { KINDS, family } from './kinds.mjs';
import { fonts } from './sizes.mjs';
import { esc, num, textLines } from './svg.mjs';

export const LEGEND_ROW = 20; // the row's height
export const LEGEND_BAND = 30; // reserved above the drawing: the row and a 10 px gap
export const SWATCH = 12;
export const SAMPLE = 24; // the wire sample's length
const INNER_GAP = 6; // swatch or sample to its text
const ITEM_GAP = 16;
const SWATCH_RADIUS = 3;
const MESSAGE_STYLE = { sync: 'solid', async: 'async', reply: 'dashed', self: 'solid' };

// The words the key prints (spec §3): an edge style or message kind in plain terms.
// Dashed is only a line style to authors (replies, "no" branches, transitions), so the key says "secondary".
export const STYLE_WORD = { solid: 'call', dashed: 'secondary', async: 'event' };
const MESSAGE_WORD = { sync: 'call', async: 'event', reply: 'reply', self: 'self' };

const round = (v) => Math.round(v * 10) / 10;
const textOf = (it) => (it.kind === 'kind' ? `${it.count} ${it.name}` : it.label);

/** [{ kind: 'kind', name, family, count }, …, { kind: 'style', name, style, label }], each in order of first use. */
export function legendItems(spec) {
  const sequence = spec.type === 'sequence';
  const counts = new Map();
  for (const n of sequence ? spec.participants : spec.nodes) {
    const k = n.kind ?? KINDS[spec.type].default;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const styles = new Map();
  if (sequence) for (const m of spec.messages ?? []) { const k = m.kind ?? 'sync'; if (!styles.has(k)) styles.set(k, MESSAGE_STYLE[k]); }
  else for (const e of spec.edges ?? []) { const s = e.style ?? 'solid'; if (!styles.has(s)) styles.set(s, s); }
  return [
    ...[...counts].map(([name, count]) => ({ kind: 'kind', name, family: family(spec.type, name), count })),
    ...[...styles].map(([name, style]) => ({ kind: 'style', name, style, label: (sequence ? MESSAGE_WORD : STYLE_WORD)[name] })),
  ];
}

/** The row: every item with its offset from the row's left (`dx`) and width; the row's width and height. */
export function legendLayout(spec, theme) {
  const font = fonts(theme).legend;
  let dx = 0;
  const items = legendItems(spec).map((it) => {
    const width = round((it.kind === 'kind' ? SWATCH : SAMPLE) + INNER_GAP + measure(textOf(it), font));
    const out = { ...it, dx: round(dx), width };
    dx += width + ITEM_GAP;
    return out;
  });
  return { items, width: round(Math.max(0, dx - ITEM_GAP)), height: LEGEND_ROW };
}

/** The row placed in the band: right-aligned `margin` from the canvas's right edge, `margin` from the top. */
export function placeLegend(row, canvasWidth, margin) {
  return { x: round(canvasWidth - margin - row.width), y: margin, width: row.width, height: row.height, items: row.items };
}

/** geometry.drawing: the diagram's own bounds in a canvas `height` tall, below the legend band and without the widening for a wide legend row. A page that hides the drawn legend fits the camera to this. */
export function drawingBounds(x, width, height) {
  return { x: round(x), y: LEGEND_BAND, width: round(width), height: round(height - LEGEND_BAND) };
}

const MARK = 6; // the hue mark inside a card swatch, as the tile sits inside a card
const DOT_R = 4;
const RING_R = 5;
const PILL_H = 8; // flow's start and end are pills (stadium nodes): the swatch is one, SWATCH wide
const DIAMONDS = new Set(['diamond', 'small-diamond']);

// A kind's swatch drawn the way its nodes are (css.mjs paints it): a bare neutral diamond, a filled or ringed dot,
// else a neutral card with the hue mark inside (external gets its dash from the family rule).
function swatchSvg(it, x, cy, type) {
  const fam = esc(it.family);
  const top = cy - SWATCH / 2;
  const shape = KINDS[type]?.kinds[it.name]?.shape;
  if (DIAMONDS.has(shape)) {
    const cx = x + SWATCH / 2;
    return `<path class="pa-swatch pa-swatch-diamond pa-family-${fam}" d="M${num(cx)} ${num(top)}L${num(x + SWATCH)} ${num(cy)}L${num(cx)} ${num(top + SWATCH)}L${num(x)} ${num(cy)}Z"/>`;
  }
  if (shape === 'filled-dot') return `<circle class="pa-swatch-filled-dot" cx="${num(x + SWATCH / 2)}" cy="${num(cy)}" r="${DOT_R}"/>`;
  if (shape === 'ringed-dot') return `<circle class="pa-swatch-ringed-dot" cx="${num(x + SWATCH / 2)}" cy="${num(cy)}" r="${RING_R}"/>`;
  if (shape === 'stadium') return `<rect class="pa-swatch pa-swatch-stadium pa-family-${fam}" x="${num(x)}" y="${num(cy - PILL_H / 2)}" width="${SWATCH}" height="${PILL_H}" rx="${PILL_H / 2}"/>`;
  const box = `<rect class="pa-swatch pa-family-${fam}" x="${num(x)}" y="${num(top)}" width="${SWATCH}" height="${SWATCH}" rx="${SWATCH_RADIUS}"/>`;
  if (it.family === 'bare') return box;
  const inset = (SWATCH - MARK) / 2;
  return `${box}<rect class="pa-swatch-mark pa-family-${fam}" x="${num(x + inset)}" y="${num(top + inset)}" width="${MARK}" height="${MARK}" rx="${SWATCH_RADIUS / 2}"/>`;
}

/** geometry.legend as SVG for a diagram of `type`: swatches drawn as their nodes are, wire samples in their style, the text beside each. */
export function legendSvg(legend, f, type) {
  const lh = lineHeight(f.legend);
  const cy = legend.y + legend.height / 2;
  const parts = legend.items.map((it) => {
    const x = legend.x + it.dx;
    const mark = it.kind === 'kind'
      ? swatchSvg(it, x, cy, type)
      : `<g class="pa-legend-sample pa-edge-${esc(it.style)}"><path class="pa-wire" d="M${num(x)} ${num(cy)}L${num(x + SAMPLE)} ${num(cy)}"/></g>`;
    const text = textLines('pa-legend-text', [textOf(it)], { x: x + (it.kind === 'kind' ? SWATCH : SAMPLE) + INNER_GAP, top: cy - lh / 2, lh, size: f.legend.size, anchor: 'start' });
    return mark + text;
  });
  return `<g class="pa-legend" aria-hidden="true">${parts.join('')}</g>`;
}
