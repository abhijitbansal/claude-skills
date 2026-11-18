// The compare kind as scale (look.kinds.compare.discs, cosmos), when both sides carry numeric values: two discs whose
// diameters are in the true ratio of the values. The larger is the look's sun at scale (sun.mjs sunBody: the same light
// model as the small sun, core to limb across the part on screen, a bloom), running off the frame like a horizon (off
// the right on a wide frame, up from the bottom on a tall one); the smaller is never less than `minDot` units across
// and is drawn as the look's Earth mark at that size (a blue dot with a ring). Each side is one group: its name, its
// number, its unit (the points) in three styles, the secondary lines at the look's floor (kinds/secondary.mjs). One
// headline, the ratio and its label, names its subject when the look asks (`subject`: "The Sun is 109x wider"); the
// larger side's group then drops its name (the headline says it).
//
// It is staged as a reveal (gate review 3: a frame complete on its first frame and held does not land the scale): the
// smaller side and its group are there from the first frame, lit; the headline is set from the first frame with its
// words ghosted (the frame keeps its hero), lighting at the turn; at the turn, when the larger side is spoken, the sun
// grows in from the frame's edge over `reveal` seconds and its group enters. Every text keeps one axis (flush left on a
// wide frame, centred on a tall one), the stack sits on the band's middle inside title-safe, and every text stays clear
// of the sun's bloom. Pure, DOM-free.
//
// discs data: { minDot, fill (share of the room the larger takes when it fits), wide: { edge } and tall: { edge } (the
// larger's near edge, a share of the span / band), gap (units between a group's lines), groupGap (em of the headline
// between the groups and the headline), valueStep, ratioStep (scale steps: the floors of the number and the headline),
// ring: { gap, width } (units), minRatio (under it: the cards), maxRatio and more (a ratio at or over it prints
// "<more> <maxRatio>"), bigCap (the larger at most this many rooms), subject (the headline names the larger side),
// reveal (seconds the sun takes to grow in), stagger (seconds between the headline's words lighting) }.
import { node } from '../graph/node.mjs';
import { layoutText } from '../text/layout.mjs';
import { track } from '../time/track.mjs';
import { editorialSpan, editorialBounds } from './editorial.mjs';
import { CAP_HEIGHT, WORD_DESCENT, sizeAt, fontFor, isWide, setCase, enterTracks, unionBox, formatValue, ghostTracks } from './shared.mjs';
import { SIDES, valueText } from './compare-text.mjs';
import { secondarySize, heroFloor } from './secondary.mjs';
import { sunBody, circlePath, hasSun, earthNodes } from '../devices/sun.mjs';
import { colourOf } from '../devices/shared.mjs';

const HALF = 2;
const DECIMAL_UNDER = 10; // a ratio under this keeps one decimal (1.5x is not 2x)
const TIMES = '×';
const MID = 0.5; // the wide Sun's centre, and the stack's: the band's middle
const VALUE_OVER = 1.4; // the number at least this many times the secondary size: a distinct middle size
const CLEAR = 1.15; // a number's cap height and a little more (ink overshoot) between any text and the large disc
const REVEAL_EASE = 'outCubic';
const GROUP_LAG = 0.4; // of the reveal: the larger side's group enters this far into the sun's way in

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

// A side's group laid out to `maxWidth` with `align`: name (label face, unless `named` is false), number (display face),
// unit (text face, the points), each line's baseline offset from the group's top, and the group's width and height.
function groupSet(shot, key, ctx, sz, { maxWidth, align, named = true }) {
  const { look, unit, measure } = ctx;
  const gap = ctx.data.discs.gap * unit;
  const lay = (role, text, size) => { const font = fontFor(look, role, size, unit); return { font, layout: layoutText({ text: setCase(look, role, text), font, maxWidth, measure, align }) }; };
  const span = (set) => set.layout.lines.at(-1).y - set.layout.lines[0].y;
  const name = named ? lay('label', shot[key].title, sz.s) : null;
  const value = lay('display', valueText(shot[key].value), sz.v);
  const points = Array.isArray(shot[key].points) && shot[key].points.length ? lay('text', shot[key].points.join(' '), sz.s) : null;
  const nameBase = name ? CAP_HEIGHT * sz.s : null;
  const valueBase = (name ? nameBase + span(name) + WORD_DESCENT * sz.s + gap : 0) + CAP_HEIGHT * sz.v;
  const unitBase = points ? valueBase + WORD_DESCENT * sz.v + gap + CAP_HEIGHT * sz.s : null;
  const h = points ? unitBase + span(points) + WORD_DESCENT * sz.s : valueBase + WORD_DESCENT * sz.v;
  return { name, value, points, nameBase, valueBase, unitBase, w: Math.max(...[name, value, points].filter(Boolean).map((x) => x.layout.width)), h, maxWidth, align };
}

// The headline's words: the ratio and its label, after the larger side's name when the look asks for a subject.
function headWords(shot, ratio, keys, discs) {
  const ratioPart = `${ratioText(ratio, discs)}${shot.ratioLabel ?? TIMES}`;
  return discs.subject ? `${shot[keys.big].title} is ${ratioPart}` : ratioPart;
}

// The headline wrapped to `maxWidth` with `align`.
function headSet(shot, ratio, keys, ctx, sz, maxWidth, align) {
  const { look, unit, measure } = ctx;
  const font = fontFor(look, 'display', sz.h, unit);
  const layout = layoutText({ text: headWords(shot, ratio, keys, ctx.data.discs), font, maxWidth, measure, align });
  return { font, layout, h: layout.lines.at(-1).y - layout.lines[0].y + (CAP_HEIGHT + WORD_DESCENT) * sz.h };
}

// When a side is spoken: lit from 0 to the turn for the left, from the turn for the right.
function litTrack(look, turn, right) {
  const { dur, ease } = look.moves.draw;
  const [on, off] = [look.palette.ink, look.palette.ink2];
  const [a, b] = right ? [off, on] : [on, off];
  return track([{ t: 0, v: a }, { t: turn, v: a }, { t: turn + dur, v: b, ease }], { space: look.colorSpace });
}

// A group's text nodes, its layout boxes from `left` (`set.maxWidth` wide) and its top at `top`, entering at `at`.
function groupNodes(id, set, { left, top }, ctx, lit, at) {
  const { look, unit } = ctx;
  const text = (part, s, base, fill) => {
    const y = top + base - s.layout.lines[0].y;
    // a lit side's words carry the fill track (a text's colour moves per word)
    const wordTracks = fill.tracks ? s.layout.lines.flatMap((l) => l.words).map(() => ({ fill: fill.tracks })) : undefined;
    return node('text', `${id}.${part}`, { x: left, y, layout: s.layout, font: s.font, role: part === 'value' ? 'value' : 'label', fill: fill.colour ?? look.palette.ink }, { tracks: enterTracks(look, unit, at, { y }), ...(wordTracks ? { wordTracks } : {}) });
  };
  return [
    ...(set.name ? [text('title', set.name, set.nameBase, { tracks: lit })] : []),
    text('value', set.value, set.valueBase, { tracks: lit }),
    ...(set.points ? [text('points', set.points, set.unitBase, { colour: look.palette.ink2 })] : []),
  ];
}

// The headline with its top at `top`, its layout box from `left`: on screen from the first frame, its words ghosted
// until the turn and lit then, one after another.
function headNode(shot, head, { left, top }, ctx, turn) {
  const { look } = ctx;
  const y = top + CAP_HEIGHT * head.font.size - head.layout.lines[0].y;
  const words = head.layout.lines.flatMap((l) => l.words);
  const wordTracks = words.map((_, k) => ghostTracks(look, turn + k * ctx.data.discs.stagger, look.palette.ink));
  return node('text', `${shot.id}.ratio`, { x: left, y, layout: head.layout, font: head.font, fill: look.palette.ink, role: 'hero' }, { wordTracks });
}

// The smaller disc at (cx, cy) radius r: the look's Earth mark when it stands at the dot floor (its size), else a dot of
// the same blue with its ring.
// `plain` (cosmos, gate review 4: the ringed dot read as a radio button and doubled the dot's apparent size in a
// to-scale drawing): the disc alone, in the Earth's blue, no ring.
const ringSpan = (d, unit) => (d.plain === true ? 0 : (d.ring.gap + d.ring.width) * unit);
function dotNodes(id, ctx, { cx, cy, r }) {
  const { look, unit, data } = ctx;
  if (data.discs.plain === true) {
    const fill = colourOf(look, look.earth?.color ?? 'ink');
    return [node('group', `${id}.earth`, { x: cx, y: cy }, { children: [node('path', `${id}.earth.dot`, { d: circlePath(r), fill })] })];
  }
  if (look.earth && Math.abs(r - look.earth.r * unit) < 1e-6) return earthNodes(`${id}.earth`, look, { cx, cy, unit });
  const ring = data.discs.ring;
  return [
    node('path', `${id}.ring`, { d: circlePath(r + ring.gap * unit), x: cx, y: cy, stroke: look.palette.ink2, strokeWidth: ring.width * unit }),
    node('path', `${id}.dot`, { d: circlePath(r), x: cx, y: cy, fill: colourOf(look, look.earth?.color ?? 'ink') }),
  ];
}

// How far right a text box may reach at rows [y0, y1] and stay `clear` off a disc at (cx, cy) radius r (its left arc).
function arcRight({ cx, cy, r }, y0, y1, clear) {
  const near = Math.max(y0, Math.min(cy, y1));
  const reach = r + clear;
  return cx - Math.sqrt(Math.max(0, reach * reach - (near - cy) ** 2));
}

// The gap between a text and the large disc: a number's cap height, and never inside the sun's bloom.
const clearOf = (ctx, sz, rb) => Math.max(CLEAR * CAP_HEIGHT * sz.v, ctx.look.sun.body.bloom * rb + ctx.look.grid.gutter * ctx.unit);

// Wide: the sun off the right edge; one left axis for every text, Earth's dot in a column before it; the stack (Earth's
// group, the headline, the Sun's group) on the band's middle, every text clear of the arc.
function wideLayout(shot, ctx, sz, size, keys) {
  const { look, unit } = ctx;
  const d = ctx.data.discs;
  const span = editorialSpan(ctx, 1, look.grid.columns), bounds = editorialBounds(ctx);
  const rb = size.big / HALF, rs = size.small / HALF;
  const big = { cx: span.x + d.wide.edge * span.w + rb, cy: bounds.at(MID), r: rb };
  const gap = d.gap * unit, dotR = rs + ringSpan(d, unit);
  const axis = span.x + HALF * dotR + gap;
  const room = arcRight(big, bounds.top, bounds.bottom, clearOf(ctx, sz, rb)) - axis;
  const small = groupSet(shot, keys.small, ctx, sz, { maxWidth: room, align: 'left' });
  const head = headSet(shot, size.ratio, keys, ctx, sz, room, 'left');
  const bigSet = groupSet(shot, keys.big, ctx, sz, { maxWidth: room, align: 'left', named: !d.subject });
  const between = d.groupGap * sz.h;
  const total = small.h + between + head.h + between + bigSet.h;
  const top = Math.max(bounds.top, bounds.at(MID) - total / HALF);
  const dot = { cx: span.x + dotR, cy: top + small.valueBase - (CAP_HEIGHT * sz.v) / HALF, r: rs };
  return {
    big, dot, small, smallAt: { left: axis, top }, head, headAt: { left: axis, top: top + small.h + between },
    bigSet, bigAt: { left: axis, top: top + small.h + between + head.h + between }, visible: span.x + span.w + look.grid.margin * unit - (big.cx - rb),
  };
}

// Tall: the sun up from the bottom; every text centred, Earth's dot over its group; the stack spread over the band
// above the horizon, a number's cap height (and the bloom) clear of it.
function tallLayout(shot, ctx, sz, size, keys) {
  const { look, unit, canvas } = ctx;
  const d = ctx.data.discs;
  const span = editorialSpan(ctx, 1, look.grid.columns), bounds = editorialBounds(ctx);
  const rb = size.big / HALF, rs = size.small / HALF;
  const gap = d.gap * unit, dotR = rs + ringSpan(d, unit);
  const small = groupSet(shot, keys.small, ctx, sz, { maxWidth: span.w, align: 'center' });
  const head = headSet(shot, size.ratio, keys, ctx, sz, span.w, 'center');
  const bigSet = groupSet(shot, keys.big, ctx, sz, { maxWidth: span.w, align: 'center', named: !d.subject });
  const content = HALF * dotR + gap + small.h + head.h + bigSet.h;
  // the horizon at its edge share of the band, lowered when the stack and its gaps need the room
  const apex = Math.max(bounds.at(d.tall.edge), bounds.top + content + HALF * d.groupGap * sz.h + clearOf(ctx, sz, rb));
  const big = { cx: span.x + span.w / HALF, cy: apex + rb, r: rb };
  const room = apex - clearOf(ctx, sz, rb) - bounds.top;
  // the spare room spread between the groups (never under the look's gap), the whole stack on the room's middle
  const between = Math.max(d.groupGap * sz.h, Math.min(sz.h, (room - content) / HALF));
  const top = bounds.top + Math.max(0, (room - content - HALF * between) / HALF);
  const groupTop = top + HALF * dotR + gap;
  return {
    big, dot: { cx: big.cx, cy: top + dotR, r: rs }, small, smallAt: { left: span.x, top: groupTop },
    head, headAt: { left: span.x, top: groupTop + small.h + between },
    bigSet, bigAt: { left: span.x, top: groupTop + small.h + between + head.h + between }, visible: canvas.h - apex,
  };
}

// The sun's way in: from just past the frame's edge (its bloom too) to its place, over the look's reveal, from the turn.
function riseTracks(ctx, lay, turn) {
  const { canvas } = ctx;
  const wide = isWide(canvas);
  const reach = lay.big.r * (1 + ctx.look.sun.body.bloom);
  const away = wide ? canvas.w - (lay.big.cx - reach) : canvas.h - (lay.big.cy - reach);
  const along = track([{ t: 0, v: away }, { t: turn, v: away }, { t: turn + ctx.data.discs.reveal, v: 0, ease: REVEAL_EASE }]);
  return wide ? { x: along } : { y: along };
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
  const sun = node('group', `${shot.id}.${keys.big}.rise`, {}, { tracks: riseTracks(c, lay, turn), children: sunBody(`${shot.id}.${keys.big}.sun`, look, { ...lay.big, visible: lay.visible }) });
  const nodes = [
    sun,
    ...dotNodes(`${shot.id}.${keys.small}`, c, lay.dot),
    ...groupNodes(`${shot.id}.${keys.small}`, lay.small, lay.smallAt, c, litTrack(look, turn, right(keys.small)), 0),
    // the larger side's group enters with its sun, once the sun is coming into the frame
    ...groupNodes(`${shot.id}.${keys.big}`, lay.bigSet, lay.bigAt, c, litTrack(look, turn, right(keys.big)), turn + GROUP_LAG * data.discs.reveal),
    headNode(shot, lay.head, lay.headAt, c, turn),
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
