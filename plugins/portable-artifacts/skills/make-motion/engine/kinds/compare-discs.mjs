// The compare kind as scale (look.kinds.compare.discs, cosmos), when both sides carry numeric values: two discs whose
// diameters are in the true ratio of the values. The larger fills its side of the frame and, when the ratio is large,
// runs off the frame edge like a horizon (off the right on a wide frame, up from the bottom on a tall one). The smaller
// is never less than `minDot` units across, so it is always visible; when that cap applies, or the ratio is `showFrom`
// or more, the ratio is printed ("109x", with the multiplication sign) as the frame's hero. Each disc carries its value
// and title. The spoken side is lit in the accent; the other is in the look's one dim colour (ink2). Pure, DOM-free.
//
// discs data: { minDot, fill (share of the room the larger takes when it fits), showFrom, gap (units between a disc
// and its labels), valueStep, titleStep, ratioStep (scale steps) }.
import { node } from '../graph/node.mjs';
import { layoutText } from '../text/layout.mjs';
import { track } from '../time/track.mjs';
import { editorialSpan, editorialBounds } from './editorial.mjs';
import { CAP_HEIGHT, sizeAt, fontFor, isWide, setCase, enterTracks, unionBox, capBox } from './shared.mjs';
import { SIDES, valueText } from './compare-text.mjs';
import { MIN_HERO_RATIO } from '../review/frame.mjs';

const HALF = 2;
const KAPPA = 0.5523;
const ROUND = 100;
const TIMES = '×';
const NO_WRAP = 1e6;
const HERO_MARGIN = 1.03;

// A side's value as a number: a number, or a string that is plainly one ("12,742", "1392700", "3.5"); else NaN.
const NUMERIC = /^(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/;
export const numericValue = (v) => (typeof v === 'number' ? v : typeof v === 'string' && NUMERIC.test(v.trim()) ? Number(v.trim().replaceAll(',', '')) : NaN);

/** Does the look draw scale for this shot (both values numbers, the look's discs data)? */
export const drawsDiscs = (shot, data) => Boolean(data.discs) && SIDES.every((k) => numericValue(shot[k]?.value) > 0);

function circle(r) {
  const k = KAPPA * r;
  const p = (x, y) => `${Math.round(x * ROUND) / ROUND} ${Math.round(y * ROUND) / ROUND}`;
  return `M${p(0, -r)}C${p(k, -r)} ${p(r, -k)} ${p(r, 0)}C${p(r, k)} ${p(k, r)} ${p(0, r)}C${p(-k, r)} ${p(-r, k)} ${p(-r, 0)}C${p(-r, -k)} ${p(-k, -r)} ${p(0, -r)}Z`;
}

// The two diameters in px: the larger at `fill` of the room, the smaller in true ratio, or, when that would be under
// the dot floor, the smaller at the floor and the larger in true ratio from it (it runs off the frame).
export function discSizes(small, big, room, data, unit) {
  const ratio = big / small, floor = data.minDot * unit;
  const fitted = data.fill * room;
  if (fitted / ratio >= floor) return { small: fitted / ratio, big: fitted, ratio, capped: false };
  return { small: floor, big: floor * ratio, ratio, capped: true };
}

// A side's value over its title, laid out (one line each), and the block's width and height.
function labels(shot, key, ctx, data) {
  const { look, unit, measure } = ctx;
  const tFont = fontFor(look, 'label', sizeAt(look, data.discs.titleStep, unit), unit);
  // the value at least the hero ratio over the title (the review's rule for a frame's own texts)
  const vFont = fontFor(look, 'display', Math.max(sizeAt(look, data.discs.valueStep, unit), HERO_MARGIN * MIN_HERO_RATIO * tFont.size), unit);
  const value = layoutText({ text: setCase(look, 'display', valueText(shot[key].value)), font: vFont, maxWidth: NO_WRAP, measure });
  // the title, and the points after it on lines of their own at the same size (a unit: kilometres across)
  const points = Array.isArray(shot[key].points) ? shot[key].points : [];
  const title = layoutText({ text: [shot[key].title, ...points].map((t) => setCase(look, 'label', t)).join(' | '), font: tFont, maxWidth: NO_WRAP, measure });
  const gap = data.discs.gap * unit;
  return { value, title, vFont, tFont, gap, w: Math.max(value.width, title.width), h: CAP_HEIGHT * vFont.size + gap + CAP_HEIGHT * tFont.size + title.lines.at(-1).y - title.lines[0].y };
}

// When a side is spoken: lit from 0 to the turn for the left, from the turn for the right.
function litTrack(look, turn, right, on, off) {
  const { dur, ease } = look.moves.draw;
  const [a, b] = right ? [off, on] : [on, off];
  return track([{ t: 0, v: a }, { t: turn, v: a }, { t: turn + dur, v: b, ease }], { space: look.colorSpace });
}

// One disc (a dim base and a lit copy whose opacity follows the spoken side) at (cx, cy).
function discNodes(id, look, { cx, cy, r }, turn, right) {
  const d = circle(r);
  return [
    node('path', `${id}.disc`, { d, x: cx, y: cy, fill: look.palette.ink2, opacity: 0.55 }),
    node('path', `${id}.lit`, { d, x: cx, y: cy, fill: look.palette.accent }, { tracks: { opacity: litTrack(look, turn, right, 1, 0) } }),
  ];
}

// A side's labels as text nodes, the block's top-left at (x, y), in `ink` (on the field) or `deep` (on a disc).
function labelNodes(id, set, { x, y }, look, unit, colour, at) {
  const vy = y + CAP_HEIGHT * set.vFont.size - set.value.lines[0].y;
  const ty = vy + set.value.lines[0].y + set.gap + CAP_HEIGHT * set.tFont.size - set.title.lines[0].y;
  return [
    node('text', `${id}.value`, { x, y: vy, layout: set.value, font: set.vFont, fill: colour, role: 'hero' }, { tracks: enterTracks(look, unit, at, { y: vy }) }),
    node('text', `${id}.title`, { x, y: ty, layout: set.title, font: set.tFont, fill: colour, role: 'label' }, { tracks: enterTracks(look, unit, at, { y: ty }) }),
  ];
}

/** The scale compare: { nodes, boxes } with a group carrying the hero id. */
export function expandDiscs(shot, ctx, data, turn, hero) {
  const { look, canvas, unit, measure } = ctx;
  const wide = isWide(canvas);
  const span = editorialSpan(ctx, 1, look.grid.columns), bounds = editorialBounds(ctx);
  const [lv, rv] = [numericValue(shot.left.value), numericValue(shot.right.value)];
  const bigKey = rv >= lv ? 'right' : 'left', smallKey = bigKey === 'right' ? 'left' : 'right';
  const values = { left: lv, right: rv };
  const room = wide ? bounds.bottom - bounds.top : span.w;
  const size = discSizes(values[smallKey], values[bigKey], room, data.discs, unit);
  const sets = { left: labels(shot, 'left', ctx, data), right: labels(shot, 'right', ctx, data) };
  const midY = bounds.at(data.centre);
  // the larger: from 55% across a wide frame (off its right edge when large); from 58% down a tall band (off its bottom)
  const rb = size.big / HALF, rs = size.small / HALF;
  const at = wide ? data.discs.wide : data.discs.tall;
  const big = wide ? { cx: span.x + at.edge * span.w + rb, cy: midY, r: rb } : { cx: span.x + span.w / HALF, cy: bounds.at(at.edge) + rb, r: rb };
  const small = { cx: span.x + rs, cy: bounds.at(at.smallAt), r: rs };
  const gap = data.discs.gap * unit;
  const smallLabel = { x: small.cx + rs + gap, y: small.cy - sets[smallKey].h / HALF };
  // where the larger's arc is at height y (its leftmost point at its centre's height)
  const arcX = (y) => big.cx - Math.sqrt(Math.max(0, rb * rb - (y - big.cy) ** 2));
  // the larger's labels on the field beside it: left of its edge (wide, right-aligned there), over its apex (tall)
  const labelMid = wide ? bounds.at(at.bigLabelAt) : 0;
  const bigLabel = wide ? { x: arcX(labelMid) - gap * HALF - sets[bigKey].w, y: labelMid - sets[bigKey].h / HALF } : { x: big.cx - sets[bigKey].w / HALF, y: big.cy - rb - gap * HALF - sets[bigKey].h };
  const right = (k) => k === 'right';
  const nodes = [
    ...discNodes(`${shot.id}.${bigKey}`, look, big, turn, right(bigKey)),
    ...discNodes(`${shot.id}.${smallKey}`, look, small, turn, right(smallKey)),
    ...labelNodes(`${shot.id}.${smallKey}`, sets[smallKey], smallLabel, look, unit, look.palette.ink, 0),
    ...labelNodes(`${shot.id}.${bigKey}`, sets[bigKey], bigLabel, look, unit, look.palette.ink, 0),
  ];
  const boxes = {};
  for (const [k, disc] of [[bigKey, big], [smallKey, small]]) {
    const x0 = Math.max(0, disc.cx - disc.r), y0 = Math.max(0, disc.cy - disc.r);
    boxes[k] = [x0, y0, Math.min(canvas.w, disc.cx + disc.r) - x0, Math.min(canvas.h, disc.cy + disc.r) - y0];
  }
  if (size.capped || size.ratio >= data.discs.showFrom) {
    const font = fontFor(look, 'display', sizeAt(look, data.discs.ratioStep, unit), unit);
    const layout = layoutText({ text: `${Math.round(size.ratio)}${TIMES}`, font, maxWidth: NO_WRAP, measure });
    // its baseline two gaps over the small disc's labels, aligned with them
    const baseline = smallLabel.y - gap * HALF, y = baseline - layout.lines[0].y;
    nodes.push(node('text', `${shot.id}.ratio`, { x: smallLabel.x, y, layout, font, fill: look.palette.accent, role: 'hero' }, { tracks: enterTracks(look, unit, turn, { y }) }));
    boxes.ratio = capBox(smallLabel.x, baseline, layout.width, font.size);
  }
  boxes.sides = unionBox([boxes.left, boxes.right]);
  return { nodes: [node('group', hero, {}, { children: nodes })], boxes };
}
