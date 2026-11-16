// The `label` device: a short text beside a point (`anchor`) with a leader line from the text's nearest edge to it, as
// a map labels a place or a diagram an edge. The text is set in the look's text face at the one size the caller gives
// (`size`, px), on the side of the anchor with room inside `box` (the area the label may use; `side` keeps a given
// side), and never leaves `box`. The leader draws on with the look's draw move and the text fades in, both landing on
// `at`. Returns { nodes: [group], boxes: { label: the text's box }, side }. Pure and DOM-free.
import { node } from '../graph/node.mjs';
import { layoutText } from '../text/layout.mjs';
import { checkParams, isHand, styleOf, colourOf, landing, polyline, styledBy } from './shared.mjs';

const SIDES = Object.freeze(['right', 'left', 'above', 'below']);
const GAP = 28; // units between the anchor and the text's nearest edge
const DEFAULT_LINE_WIDTH = 2; // units
const NO_WRAP = 1e6; // px: a label is one line
const HALF = 2;

function textFont(look, size, unit) {
  const { family, weight, width } = look.fonts.text;
  return { family, weight, width, size, tracking: look.tracking(size / unit, 'text') };
}

// The text's top-left corner on `side` of the anchor, `gap` px from it, before it is kept inside the box.
function placed(side, [ax, ay], w, h, gap) {
  if (side === 'right') return [ax + gap, ay - h / HALF];
  if (side === 'left') return [ax - gap - w, ay - h / HALF];
  if (side === 'above') return [ax - w / HALF, ay - gap - h];
  return [ax - w / HALF, ay + gap];
}

// The room a side leaves for a w x h text inside the box: how far the text would have to be pushed back in (0 = fits).
function overflowOf(side, anchor, w, h, gap, [bx, by, bw, bh]) {
  const [x, y] = placed(side, anchor, w, h, gap);
  return Math.max(0, bx - x) + Math.max(0, x + w - bx - bw) + Math.max(0, by - y) + Math.max(0, y + h - by - bh);
}

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));

// The point on the edge of [x, y, w, h] nearest the anchor: the middle of the edge that faces it.
function nearestEdge([x, y, w, h], side) {
  if (side === 'right') return [x, y + h / HALF];
  if (side === 'left') return [x + w, y + h / HALF];
  if (side === 'above') return [x + w / HALF, y + h];
  return [x + w / HALF, y];
}

function buildLabel(params) {
  const { id, box, at, look, unit, measure } = checkParams('label', params, ['text', 'anchor', 'size', 'side']);
  const { text, anchor, size } = params;
  if (typeof text !== 'string' || text.trim() === '') throw new Error('label: text must be a non-empty string');
  if (!Array.isArray(anchor) || anchor.length !== HALF || !anchor.every(Number.isFinite)) throw new Error(`label: anchor must be [x, y], got ${JSON.stringify(anchor)}`);
  if (!(Number.isFinite(size) && size > 0)) throw new Error(`label: size must be a font size in px > 0, got ${size}`);
  if (params.side !== undefined && !SIDES.includes(params.side)) throw new Error(`label: side must be one of ${SIDES.join(', ')}, got ${JSON.stringify(params.side)}`);
  if (measure === undefined) throw new Error('label: needs params.measure to size its text');
  const font = textFont(look, size, unit);
  const layout = layoutText({ text, font, maxWidth: NO_WRAP, measure });
  const gap = GAP * unit;
  const side = params.side ?? SIDES.reduce((best, s) => (overflowOf(s, anchor, layout.width, layout.height, gap, box) < overflowOf(best, anchor, layout.width, layout.height, gap, box) ? s : best));
  const [px, py] = placed(side, anchor, layout.width, layout.height, gap);
  const x = clamp(px, box[0], box[0] + box[2] - layout.width), y = clamp(py, box[1], box[1] + box[3] - layout.height);
  const textBox = [x, y, layout.width, layout.height];
  const style = styleOf(look, 'label');
  const step = isHand(look) ? look.moves.draw.step : undefined;
  const leader = node('path', `${id}.leader`, {
    d: polyline([nearestEdge(textBox, side), anchor]),
    stroke: colourOf(look, style.line ?? 'ink'), strokeWidth: (style.width ?? DEFAULT_LINE_WIDTH) * unit, lineCap: 'round',
  }, { tracks: { draw: landing(at, look.moves.draw, 0, 1, step) }, step });
  const label = node('text', `${id}.text`, { x, y, layout, font, fill: colourOf(look, style.text ?? 'ink'), role: 'label' }, {
    tracks: { opacity: landing(at, look.moves.enter, 0, 1) },
  });
  return { nodes: [node('group', id, {}, { children: [leader, label] })], boxes: { label: textBox }, side };
}

export const label = Object.freeze({
  name: 'label',
  summary: 'A short label beside a point, with a leader line that draws on to it.',
  supports: styledBy('label'),
  on: false, // kinds build it with their own words: an on event has no text to give it
  build: buildLabel,
});
