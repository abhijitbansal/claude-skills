// The `label` device: a short text beside a point (`anchor`) with a leader line from the text's nearest edge to it, as
// a map labels a place or a diagram an edge. The text is set in the look's text face (or the `face` given) at the one size the caller gives
// (`size`, px), on the side of the anchor with room inside `box` (the area the label may use; `side` keeps a given
// side), and never leaves `box`. The leader draws on with the look's draw move and the text fades in, both landing on
// `at`. A style with a `dot` (ledger) ends the leader on a dot of that diameter. Returns { nodes: [group], boxes: {
// label: the text's box }, side }. Pure and DOM-free.
import { node } from '../graph/node.mjs';
import { layoutText } from '../text/layout.mjs';
import { checkParams, isHand, styleOf, colourOf, landing, polyline, styledBy, at2 } from './shared.mjs';
import { setCase } from '../kinds/shared.mjs';

const SIDES = Object.freeze(['right', 'left', 'above', 'below']);
const GAP = 28; // units between the anchor and the text's nearest edge
const DEFAULT_LINE_WIDTH = 2; // units
const NO_WRAP = 1e6; // px: a label is one line
const HALF = 2;

const FACES = Object.freeze(['text', 'label', 'display']);
// `leader`: 'drawn' (the default) draws from the text to the anchor on the look's draw move, landing with the text;
// 'joined' grows from the anchor out to the text over the text's own entrance, so it is never seen before the text or
// apart from what it labels (a chart's note on a column, ledger: drawn, it began as a stray dot over the column);
// 'none' sets the text alone, no leader and no dot (a bar's note at the bar's end, ledger: a tick there read as a minus)
const LEADERS = Object.freeze(['drawn', 'joined', 'none']);

function textFont(look, size, unit, face = 'text') {
  const { family, weight, width } = look.fonts[face];
  return { family, weight, width, size, tracking: look.tracking(size / unit, face) };
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
  const { id, box, at, look, unit, measure } = checkParams('label', params, ['text', 'anchor', 'size', 'side', 'face', 'gap', 'leader']);
  const leaderStyle = params.leader ?? 'drawn';
  if (!LEADERS.includes(leaderStyle)) throw new Error(`label: leader must be one of ${LEADERS.join(', ')}, got ${JSON.stringify(params.leader)}`);
  // `gap`: units between the anchor and the text, in place of GAP (a chart's note keeps to the room its values keep)
  if (params.gap !== undefined && !(Number.isFinite(params.gap) && params.gap >= 0)) throw new Error(`label: gap must be a number of units >= 0, got ${params.gap}`);
  const { anchor, size } = params;
  // `face`: the look's font role to set the text in (default 'text'); a 'label' face takes the look's label case
  const face = params.face ?? 'text';
  if (!FACES.includes(face)) throw new Error(`label: face must be one of ${FACES.join(', ')}, got ${JSON.stringify(face)}`);
  const text = face === 'text' || typeof params.text !== 'string' ? params.text : setCase(look, face, params.text);
  if (typeof text !== 'string' || text.trim() === '') throw new Error('label: text must be a non-empty string');
  if (!Array.isArray(anchor) || anchor.length !== HALF || !anchor.every(Number.isFinite)) throw new Error(`label: anchor must be [x, y], got ${JSON.stringify(anchor)}`);
  if (!(Number.isFinite(size) && size > 0)) throw new Error(`label: size must be a font size in px > 0, got ${size}`);
  if (params.side !== undefined && !SIDES.includes(params.side)) throw new Error(`label: side must be one of ${SIDES.join(', ')}, got ${JSON.stringify(params.side)}`);
  if (measure === undefined) throw new Error('label: needs params.measure to size its text');
  const font = textFont(look, size, unit, face);
  const layout = layoutText({ text, font, maxWidth: NO_WRAP, measure });
  const gap = (params.gap ?? GAP) * unit;
  const side = params.side ?? SIDES.reduce((best, s) => (overflowOf(s, anchor, layout.width, layout.height, gap, box) < overflowOf(best, anchor, layout.width, layout.height, gap, box) ? s : best));
  const [px, py] = placed(side, anchor, layout.width, layout.height, gap);
  const x = clamp(px, box[0], box[0] + box[2] - layout.width), y = clamp(py, box[1], box[1] + box[3] - layout.height);
  const textBox = [x, y, layout.width, layout.height];
  const style = styleOf(look, 'label');
  const label = node('text', `${id}.text`, { x, y, layout, font, fill: colourOf(look, style.text ?? 'ink'), role: 'label' }, {
    tracks: { opacity: landing(at, look.moves.enter, 0, 1) },
  });
  const marks = leaderStyle === 'none' ? [] : [leaderNode(id, { anchor, edge: nearestEdge(textBox, side), joined: leaderStyle === 'joined' }, style, look, unit, at),
    ...dotNode(id, anchor, style, look, unit, at)];
  return { nodes: [node('group', id, {}, { children: [...marks, label] })], boxes: { label: textBox }, side };
}

// The leader from the text's nearest edge to the anchor, drawn on the look's draw move landing on `at`; `joined`: from
// the anchor out to the text, on the text's entrance move, so it starts with the text and grows from what it labels.
function leaderNode(id, { anchor, edge, joined }, style, look, unit, at) {
  const step = isHand(look) ? look.moves.draw.step : undefined;
  const points = joined ? [anchor, edge] : [edge, anchor];
  return node('path', `${id}.leader`, {
    d: polyline(points),
    stroke: colourOf(look, style.line ?? 'ink'), strokeWidth: (style.width ?? DEFAULT_LINE_WIDTH) * unit, lineCap: 'round',
  }, { tracks: { draw: landing(at, joined ? look.moves.enter : look.moves.draw, 0, 1, step) }, step });
}

// The dot a leader ends on (style.dot: its diameter in units, ledger), in the leader's colour, landing with it; none
// without the style.
function dotNode(id, [ax, ay], style, look, unit, at) {
  if (style.dot === undefined) return [];
  const r = (style.dot * unit) / HALF;
  return [node('path', `${id}.dot`, { d: circlePath(ax, ay, r), fill: colourOf(look, style.line ?? 'ink') }, { tracks: { opacity: landing(at, look.moves.enter, 0, 1) } })];
}

// A closed circle of radius r about (cx, cy) in four cubic quarter arcs (devices write only M, L, Q, C and Z).
const QUARTER = 0.5523; // control-point distance of a quarter circle, as a share of the radius
function circlePath(cx, cy, r) {
  const k = QUARTER * r;
  return `M${at2([cx + r, cy])}C${at2([cx + r, cy + k])} ${at2([cx + k, cy + r])} ${at2([cx, cy + r])}`
    + `C${at2([cx - k, cy + r])} ${at2([cx - r, cy + k])} ${at2([cx - r, cy])}`
    + `C${at2([cx - r, cy - k])} ${at2([cx - k, cy - r])} ${at2([cx, cy - r])}`
    + `C${at2([cx + k, cy - r])} ${at2([cx + r, cy - k])} ${at2([cx + r, cy])}Z`;
}

export const label = Object.freeze({
  name: 'label',
  summary: 'A short label beside a point, with a leader line that draws on to it.',
  supports: styledBy('label'),
  on: false, // kinds build it with their own words: an on event has no text to give it
  build: buildLabel,
});
