// The compare kind as scale (look.kinds.compare.discs, cosmos), when both sides carry numeric values: two discs whose
// diameters are in the true ratio of the values. The larger is the look's sun at scale (sun.mjs sunBody: gold from its
// first frame, a soft inner gradient toward the core colour, the gold limb, a bloom), running off the frame like a
// horizon (off the right on a wide frame, up from the bottom on a tall one); the smaller is never less than `minDot`
// units across and wears a ring so it reads on a phone. Each side is one group: its name, its number, its unit (the
// points) in three styles, the secondary lines at the look's floor (kinds/secondary.mjs). One headline, the ratio and
// its label ("109x", or the shot's ratioLabel: "109x wider"), stands with the larger side's group as the frame's hero.
// Every text keeps a number's cap height clear of the large disc. The spoken side's name and number are lit, the other
// in the look's dim (labels dim; the star never does). Pure, DOM-free.
//
// discs data: { minDot, fill (share of the room the larger takes when it fits), wide: { edge } and tall: { edge } (the
// larger's near edge, a share of the span / band), gap (units between a group's lines), valueStep, ratioStep (scale
// steps: the floors of the number and the headline), ring: { gap, width } (units), minRatio (under it: the cards),
// maxRatio and more (a ratio at or over it prints "<more> <maxRatio>"), bigCap (the larger at most this many rooms) }.
import { node } from '../graph/node.mjs';
import { layoutText } from '../text/layout.mjs';
import { track } from '../time/track.mjs';
import { editorialSpan, editorialBounds } from './editorial.mjs';
import { CAP_HEIGHT, WORD_DESCENT, sizeAt, fontFor, isWide, setCase, enterTracks, unionBox, formatValue } from './shared.mjs';
import { SIDES, valueText } from './compare-text.mjs';
import { secondarySize, secondaryFloor, heroFloor } from './secondary.mjs';
import { sunBody, circlePath, hasSun } from '../devices/sun.mjs';

const HALF = 2;
const DECIMAL_UNDER = 10; // a ratio under this keeps one decimal (1.5x is not 2x)
const NO_WRAP = 1e6;
const TIMES = '×';
const MID = 0.5; // the wide Sun's centre: the band's middle
const VALUE_OVER = 1.4;
const CLEAR = 1.15; // a number's cap height and a little more (ink overshoot) between any text and the large disc // the number at least this many times the secondary size: a distinct middle size

// A side's value as a number: a number, or a string that is plainly one ("12,742", "1392700", "3.5"); else NaN.
const NUMERIC = /^(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/;
export const numericValue = (v) => (typeof v === 'number' ? v : typeof v === 'string' && NUMERIC.test(v.trim()) ? Number(v.trim().replaceAll(',', '')) : NaN);

/**
 * Does the look draw scale for this shot: the look's discs data and a sun to draw the larger with, both values numbers
 * above 0, and their ratio at least discs.minRatio (nearer equal, two discs read as two equal circles: the cards say it
 * better)? Otherwise the compare falls back to the cards.
 */
export function drawsDiscs(shot, data, look) {
  if (!data.discs || !hasSun(look)) return false;
  const values = SIDES.map((k) => numericValue(shot[k]?.value));
  if (!values.every((v) => v > 0)) return false;
  return Math.max(...values) / Math.min(...values) >= data.discs.minRatio;
}

/** The ratio as printed: one decimal under 10, thousands grouped above 999, at discs.maxRatio "<discs.more> <max>". */
export function ratioText(ratio, discs) {
  if (ratio >= discs.maxRatio) return `${discs.more} ${formatValue(discs.maxRatio, 0)}`;
  return formatValue(ratio, ratio < DECIMAL_UNDER ? 1 : 0);
}

// The two diameters in px: the larger at `fill` of the room, the smaller in true ratio, or, when that would be under
// the dot floor, the smaller at the floor and the larger in true ratio from it (it runs off the frame), never more than
// `bigCap` times the room (past that the arc on the frame is a straight edge anyway).
export function discSizes(small, big, room, data, unit) {
  const ratio = big / small, floor = data.minDot * unit;
  const fitted = data.fill * room;
  if (fitted / ratio >= floor) return { small: fitted / ratio, big: fitted, ratio, capped: false };
  return { small: floor, big: Math.min(floor * ratio, data.bigCap * room), ratio, capped: true };
}

// The three sizes: secondary (name, unit) at the floor, the number a distinct middle size, the headline the hero.
function sizesOf(look, unit, data) {
  const s = secondarySize(look, unit, sizeAt(look, 1, unit));
  return { s, v: Math.max(sizeAt(look, data.discs.valueStep, unit), VALUE_OVER * s), h: Math.max(sizeAt(look, data.discs.ratioStep, unit), heroFloor(look, unit)) };
}

// A side's group laid out to `maxWidth` with `align`: name (label face), number (display face), unit (text face, the
// points), each line's baseline offset from the group's top, and the group's width and height.
function groupSet(shot, key, ctx, sz, maxWidth, align) {
  const { look, unit, measure } = ctx;
  const gap = ctx.data.discs.gap * unit;
  const lay = (role, text, size) => { const font = fontFor(look, role, size, unit); return { font, layout: layoutText({ text: setCase(look, role, text), font, maxWidth, measure, align }) }; };
  const name = lay('label', shot[key].title, sz.s);
  const value = lay('display', valueText(shot[key].value), sz.v);
  const points = Array.isArray(shot[key].points) && shot[key].points.length ? lay('text', shot[key].points.join(' '), sz.s) : null;
  const span = (set) => set.layout.lines.at(-1).y - set.layout.lines[0].y;
  const nameBase = CAP_HEIGHT * sz.s;
  const valueBase = nameBase + span(name) + WORD_DESCENT * sz.s + gap + CAP_HEIGHT * sz.v;
  const unitBase = points ? valueBase + WORD_DESCENT * sz.v + gap + CAP_HEIGHT * sz.s : null;
  const h = points ? unitBase + span(points) + WORD_DESCENT * sz.s : valueBase + WORD_DESCENT * sz.v;
  return { name, value, points, nameBase, valueBase, unitBase, w: Math.max(...[name, value, points].filter(Boolean).map((x) => x.layout.width)), h, maxWidth, align };
}

// The headline: the ratio and its label, wrapped to `maxWidth`.
function headSet(shot, ratio, ctx, sz, maxWidth, align) {
  const { look, unit, measure } = ctx;
  const font = fontFor(look, 'display', sz.h, unit);
  const layout = layoutText({ text: `${ratioText(ratio, ctx.data.discs)}${shot.ratioLabel ?? TIMES}`, font, maxWidth, measure, align });
  return { font, layout, h: layout.lines.at(-1).y - layout.lines[0].y + (CAP_HEIGHT + WORD_DESCENT) * sz.h };
}

// When a side is spoken: lit from 0 to the turn for the left, from the turn for the right.
function litTrack(look, turn, right) {
  const { dur, ease } = look.moves.draw;
  const [on, off] = [look.palette.ink, look.palette.ink2];
  const [a, b] = right ? [off, on] : [on, off];
  return track([{ t: 0, v: a }, { t: turn, v: a }, { t: turn + dur, v: b, ease }], { space: look.colorSpace });
}

// A group's text nodes, its box's left edge at `left` (its layout boxes `set.maxWidth` wide) and its top at `top`.
function groupNodes(id, set, { left, top }, ctx, lit, at) {
  const { look, unit } = ctx;
  const text = (part, s, base, fill) => {
    const y = top + base - s.layout.lines[0].y;
    // a lit side's words carry the fill track (a text's colour moves per word)
    const wordTracks = fill.tracks ? s.layout.lines.flatMap((l) => l.words).map(() => ({ fill: fill.tracks })) : undefined;
    return node('text', `${id}.${part}`, { x: left, y, layout: s.layout, font: s.font, role: part === 'value' ? 'value' : 'label', fill: fill.colour ?? look.palette.ink }, { tracks: enterTracks(look, unit, at, { y }), ...(wordTracks ? { wordTracks } : {}) });
  };
  return [
    text('title', set.name, set.nameBase, { tracks: lit }),
    text('value', set.value, set.valueBase, { tracks: lit }),
    ...(set.points ? [text('points', set.points, set.unitBase, { colour: look.palette.ink2 })] : []),
  ];
}

// The headline node with its top at `top`, its layout box from `left`.
function headNode(shot, head, { left, top }, ctx, at) {
  const { look, unit } = ctx;
  const y = top + CAP_HEIGHT * head.font.size - head.layout.lines[0].y;
  return node('text', `${shot.id}.ratio`, { x: left, y, layout: head.layout, font: head.font, fill: look.palette.ink, role: 'hero' }, { tracks: enterTracks(look, unit, at, { y }) });
}

// The smaller disc in ink with its ring in the dim colour, at (cx, cy) radius r.
function dotNodes(id, ctx, { cx, cy, r }) {
  const { look, unit, data } = ctx;
  const ring = data.discs.ring;
  return [
    node('path', `${id}.ring`, { d: circlePath(r + ring.gap * unit), x: cx, y: cy, stroke: look.palette.ink2, strokeWidth: ring.width * unit }),
    node('path', `${id}.dot`, { d: circlePath(r), x: cx, y: cy, fill: look.palette.ink }),
  ];
}

// How far right a text box may reach at rows [y0, y1] and stay `clear` off a disc at (cx, cy) radius r (its left arc).
function arcRight({ cx, cy, r }, y0, y1, clear) {
  const near = Math.max(y0, Math.min(cy, y1));
  const reach = r + clear;
  return cx - Math.sqrt(Math.max(0, reach * reach - (near - cy) ** 2));
}

// Wide: the Sun off the right edge; Earth's dot and group top left; the headline and the Sun's group bottom right,
// right-aligned clear of the arc.
function wideLayout(shot, ctx, sz, size, keys) {
  const { look, unit } = ctx;
  const span = editorialSpan(ctx, 1, look.grid.columns), bounds = editorialBounds(ctx);
  const rb = size.big / HALF, rs = size.small / HALF, ring = ctx.data.discs.ring;
  const big = { cx: span.x + ctx.data.discs.wide.edge * span.w + rb, cy: bounds.at(MID), r: rb };
  const clear = CLEAR * CAP_HEIGHT * sz.v, gap = ctx.data.discs.gap * unit;
  const dotR = rs + (ring.gap + ring.width) * unit;
  const room = big.cx - big.r - clear - span.x;
  const small = groupSet(shot, keys.small, ctx, sz, room - HALF * dotR - gap, 'left');
  const dot = { cx: span.x + dotR, cy: bounds.top + small.valueBase - (CAP_HEIGHT * sz.v) / HALF, r: rs };
  const smallAt = { left: span.x + HALF * dotR + gap, top: bounds.top };
  const bigSet = groupSet(shot, keys.big, ctx, sz, room, 'right');
  const head = headSet(shot, size.ratio, ctx, sz, room, 'right');
  const top = bounds.bottom - bigSet.h - gap - head.h;
  const right = arcRight(big, top, bounds.bottom, clear);
  return { big, dot, small, smallAt, bigSet, bigAt: { left: right - bigSet.maxWidth, top: top + head.h + gap }, head, headAt: { left: right - room, top } };
}

// Tall: the Sun up from the bottom; Earth's dot and group top left; the headline and the Sun's group centred over the
// horizon's apex, a number's cap height above it, the horizon lowered when the stack needs the room.
function tallLayout(shot, ctx, sz, size, keys) {
  const { look, unit } = ctx;
  const span = editorialSpan(ctx, 1, look.grid.columns), bounds = editorialBounds(ctx);
  const rb = size.big / HALF, rs = size.small / HALF, ring = ctx.data.discs.ring;
  const clear = CLEAR * CAP_HEIGHT * sz.v, gap = ctx.data.discs.gap * unit;
  const dotR = rs + (ring.gap + ring.width) * unit;
  const small = groupSet(shot, keys.small, ctx, sz, span.w - HALF * dotR - gap, 'left');
  const dot = { cx: span.x + dotR, cy: bounds.top + small.valueBase - (CAP_HEIGHT * sz.v) / HALF, r: rs };
  const bigSet = groupSet(shot, keys.big, ctx, sz, span.w, 'center');
  const head = headSet(shot, size.ratio, ctx, sz, span.w, 'center');
  const stackH = head.h + gap + bigSet.h;
  const apex = Math.max(bounds.at(ctx.data.discs.tall.edge), bounds.top + small.h + secondaryFloor(look, unit) + stackH + clear);
  const big = { cx: span.x + span.w / HALF, cy: apex + rb, r: rb };
  const top = apex - clear - stackH;
  return { big, dot, small, smallAt: { left: span.x + HALF * dotR + gap, top: bounds.top }, bigSet, bigAt: { left: span.x, top: top + head.h + gap }, head, headAt: { left: span.x, top } };
}

/** The scale compare: { nodes, boxes } with a group carrying the hero id. */
export function expandDiscs(shot, ctx, data, turn, hero) {
  const { look, canvas, unit } = ctx;
  const c = { ...ctx, data };
  const values = { left: numericValue(shot.left.value), right: numericValue(shot.right.value) };
  const keys = values.right >= values.left ? { big: 'right', small: 'left' } : { big: 'left', small: 'right' };
  const wide = isWide(canvas);
  const room = wide ? editorialBounds(ctx).bottom - editorialBounds(ctx).top : editorialSpan(ctx, 1, look.grid.columns).w;
  const size = discSizes(values[keys.small], values[keys.big], room, data.discs, unit);
  const sz = sizesOf(look, unit, data);
  const lay = wide ? wideLayout(shot, c, sz, size, keys) : tallLayout(shot, c, sz, size, keys);
  const right = (k) => k === 'right';
  const nodes = [
    ...sunBody(`${shot.id}.${keys.big}.sun`, look, lay.big),
    ...dotNodes(`${shot.id}.${keys.small}`, c, lay.dot),
    ...groupNodes(`${shot.id}.${keys.small}`, lay.small, lay.smallAt, c, litTrack(look, turn, right(keys.small)), 0),
    ...groupNodes(`${shot.id}.${keys.big}`, lay.bigSet, lay.bigAt, c, litTrack(look, turn, right(keys.big)), 0),
    // the headline is the frame's hero from its first frame: the frame never stands without it
    headNode(shot, lay.head, lay.headAt, c, 0),
  ];
  const clip = (b) => { const x0 = Math.max(0, b[0]), y0 = Math.max(0, b[1]); return [x0, y0, Math.min(canvas.w, b[0] + b[2]) - x0, Math.min(canvas.h, b[1] + b[3]) - y0]; };
  const boxes = {
    [keys.big]: clip([lay.big.cx - lay.big.r, lay.big.cy - lay.big.r, HALF * lay.big.r, HALF * lay.big.r]),
    [keys.small]: [lay.smallAt.left, lay.smallAt.top, lay.small.w, lay.small.h],
    ratio: [lay.headAt.left, lay.headAt.top, lay.head.layout.width, lay.head.h],
  };
  boxes.sides = unionBox([boxes.left, boxes.right]);
  return { nodes: [node('group', hero, {}, { children: nodes })], boxes };
}
