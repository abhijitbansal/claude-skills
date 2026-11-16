// The `compare` kind in a stack composition (pop): on a wide frame one side at a time, a hard cut inside the shot at the
// turn; on a tall frame (look data stackTall) both at once, A in the top part of the stack area and B in the bottom part,
// `sideGap` apart, the unspoken side at `dim` opacity (B until the turn, A from it). Each side
// is a stack (stack.mjs) with its title as the hero, a value (when both sides have one) as a numeral line of the same
// stack, under a tag "A" / "B" ("BEFORE" / "AFTER" for before-after), and its points under the stack in the text face at
// the largest of look.kinds.compare.pointSteps the stack stays three times, their cap line `pointGap` under it. A side's
// picture is a cut-out over its tag, at most `picture` of the stack area's height, `pictureGap` above the tag. Pure and
// DOM-free.
import { registries } from '../registry.mjs';
import { node } from '../graph/node.mjs';
import { track } from '../time/track.mjs';
import { landing } from '../devices/shared.mjs';
import { layoutText } from '../text/layout.mjs';
import { CAP_HEIGHT, WORD_DESCENT, sizeAt, fontFor, setCase, shownFrom, stepUnder, fitInBox, numeralLayout } from './shared.mjs';
import { STACK, composeStack, stackNodes, stackArea, restack } from './stack.mjs';
import { MIN_HERO_RATIO } from '../review/frame.mjs';
import { SIDES, valueText, hasValues, pointsText } from './compare-text.mjs';

// a side's tag, a label line of its own over the title (look review 2: "B" over "A SCRIPT" read as "B A SCRIPT")
const TAGS = Object.freeze({ versus: ['OPTION A', 'OPTION B'], 'before-after': ['BEFORE', 'AFTER'] });
const TURN_BAR = Object.freeze({ width: 0.24, height: 14 }); // the turn's accent bar: a share of the stack width, units tall
const HALF = 2;
const SHARE_PASSES = 2;

// The points' font: the largest of data.pointSteps the stack's largest line stays MIN_HERO_RATIO times, else the smallest.
function pointFont(look, data, lines, unit) {
  const largest = Math.max(...lines.map((line) => line.font.size));
  return fontFor(look, 'text', sizeAt(look, stepUnder(look, data.pointSteps, unit, [{ size: largest, ratio: MIN_HERO_RATIO }]), unit), unit);
}

// A side's picture fitted into the stack area's width and `data.picture` of its height, with the room it takes over the
// tag (its keyline included, and the gap); null without one.
function pictureFit(shot, key, ctx, data, area) {
  if (shot[key].src === undefined) return null;
  const keyline = ctx.look.keyline * ctx.unit;
  const { w, h } = fitInBox(ctx.asset(shot[key].src), area.w - HALF * keyline, data.picture * area.h);
  return { w, h, keyline, room: h + HALF * keyline + data.pictureGap * ctx.unit };
}

// The picture as a cut-out flush left on the stack edge, its keyline `pictureGap` over the tag (or the first line).
function pictureNodes(shot, key, ctx, data, { fit, placed, at }) {
  if (fit === null) return [];
  const first = placed.lines[0];
  const under = placed.kicker === null ? first.baseline - first.ink.up : placed.kicker.top;
  const top = under - data.pictureGap * ctx.unit - fit.keyline - fit.h;
  const image = node('image', `${shot.id}.${key}.src.image`, { src: shot[key].src, w: fit.w, h: fit.h });
  return registries.devices.get('cutout').build({
    id: `${shot.id}.${key}.src`, box: [placed.area.left + fit.keyline, top, fit.w, fit.h], at, look: ctx.look, unit: ctx.unit, seed: ctx.seed, image,
  }).nodes;
}

// One side in `area` (the stack area, or its part on a tall frame): its wrapper's children (the picture, the tag, the
// stack, the points) and its box.
function sideParts(shot, key, k, ctx, data, { at, value, area, maxSize = Infinity }) {
  const { look, unit, measure } = ctx;
  const staged = { ...shot, id: `${shot.id}.${key}`, kicker: TAGS[shot.mode ?? 'versus'][k] };
  const first = composeStack(setCase(look, 'display', shot[key].title), staged, ctx, area, { maxSize });
  const numeral = value === null ? null : numeralLayout(value.texts[k], value.font, measure);
  const valueRoom = numeral === null ? 0 : STACK.gap * value.font.size + (CAP_HEIGHT + WORD_DESCENT) * value.font.size;
  const words = pointsText(shot[key]);
  const font = words === null ? null : pointFont(look, data, [...first.lines, ...(value === null ? [] : [{ font: value.font }])], unit);
  const points = words === null ? null : layoutText({ text: words, font, maxWidth: area.w, measure });
  const room = points === null ? 0 : data.pointGap * unit + CAP_HEIGHT * font.size + points.lines.at(-1).y - points.lines[0].y + WORD_DESCENT * font.size;
  const fit = pictureFit(shot, key, ctx, data, area);
  const placed = restack(first, ctx, { above: fit === null ? 0 : fit.room, below: valueRoom + room });
  const hero = `${staged.id}.title`;
  const built = stackNodes(staged, ctx, placed, { times: placed.rows.flat().map(() => ({ at: 0, emphasised: false })), ghost: false, matched: true, hero });
  const children = [...pictureNodes(shot, key, ctx, data, { fit, placed, at }), ...built.kicker, built.group];
  const last = placed.lines.at(-1);
  let under = last.baseline + last.ink.down; // the lowest ink so far
  if (numeral !== null) {
    // the value: a numeral line of its own under the title, at the size both sides share (never styled as better)
    const baseline = under + STACK.gap * value.font.size + CAP_HEIGHT * value.font.size;
    const layout = value.small ? { ...numeral, overflow: true } : numeral;
    // one size class with the title's lines (stack: the hero id), as when it was a line of the stack
    children.push(node('text', `${staged.id}.value`, { x: area.left, y: baseline - numeral.lines[0].y, layout, font: value.font, fill: look.palette.ink, role: 'hero', stack: hero }));
    under = baseline + WORD_DESCENT * value.font.size;
  }
  if (points !== null) {
    const y = under + data.pointGap * unit + CAP_HEIGHT * font.size - points.lines[0].y;
    children.push(node('text', `${staged.id}.points`, { x: area.left, y, layout: points, font, fill: look.palette.ink2, role: 'body' }));
  }
  return { id: staged.id, children, box: built.boxes.text, largest: Math.max(...placed.lines.map((line) => line.font.size)) };
}

// Both values' one size: the largest, up to a stack line's cap (and `valueTall` of a side's height when both sides share
// the frame), at which the wider of the two fills the stack area's width, in fixed digit advances; under the stack's
// floor step it is flagged (small). null without values.
function sharedValue(shot, ctx, data, sideHeight) {
  if (!hasValues(shot)) return null;
  const { look, unit, measure } = ctx;
  const width = stackArea(ctx).w;
  const texts = SIDES.map((k) => setCase(look, 'display', valueText(shot[k].value)));
  const cap = Math.min(STACK.max * unit, data.valueTall * sideHeight);
  const widest = Math.max(...texts.map((text) => numeralLayout(text, fontFor(look, 'display', cap, unit), measure).width));
  const size = Math.min(cap, Math.floor((cap * width) / widest));
  return { texts, font: fontFor(look, 'display', size, unit), small: size < sizeAt(look, STACK.fromStep, unit) };
}

// The stack area cut in two, A's part over B's, `sideGap` apart.
function sideAreas(ctx, data) {
  const area = stackArea(ctx);
  const h = (area.h - data.sideGap * ctx.unit) / HALF;
  return [{ ...area, h }, { ...area, top: area.top + area.h - h, h }];
}

// A side's opacity when both are on screen: full while it is spoken, `dim` otherwise, changing over the look's enter move
// at the turn (A speaks first).
function dimTrack(look, data, k, turn) {
  const [from, to] = k === 0 ? [1, data.dim] : [data.dim, 1];
  return track([{ t: 0, v: from }, { t: turn, v: from }, { t: turn + look.moves.enter.dur, v: to, ease: look.moves.enter.ease }]);
}

/**
 * The pop compare: the two sides as wrappers { id, tracks, children } and their boxes; one at a time (shown before and
 * from the turn) or, `both`, A over B with the unspoken side dimmed.
 */
export function expandPopCompare(shot, ctx, data, { turn, both }) {
  const spans = [[0, turn], [turn, undefined]];
  const areas = both ? sideAreas(ctx, data) : [stackArea(ctx), stackArea(ctx)];
  const value = sharedValue(shot, ctx, data, both ? areas[0].h : Infinity);
  // a side's picture is whole the moment its side is (the stack is too): no fade in after the hard cut at the turn
  const partsAt = (maxSize) => SIDES.map((key, k) => sideParts(shot, key, k, ctx, data, { at: both ? 0 : spans[k][0], value, area: areas[k], maxSize }));
  let parts = partsAt(Infinity);
  // both on one frame: the two titles one size, the smaller side's largest (twice: a side set again may shrink to fit)
  for (let pass = 0; both && pass < SHARE_PASSES; pass++) parts = partsAt(Math.min(...parts.map((p) => p.largest)));
  const opacity = (k) => (both ? dimTrack(ctx.look, data, k, turn) : shownFrom(spans[k][0], spans[k][1]));
  const wrappers = parts.map((p, k) => ({ id: p.id, tracks: { opacity: opacity(k) }, children: p.children }));
  const boxes = { left: parts[0].box, right: parts[1].box };
  if (!both) return { wrappers, boxes };
  const bar = turnBar(shot, ctx, areas[0], boxes, turn);
  return { wrappers, boxes: { ...boxes, turn: bar.box }, extra: [bar.node] };
}

// Both sides on one frame: the turn marked by the accent bar midway between the blocks, flush left, punched in at the
// turn (look review 2: a dim alone did not read as the handover).
function turnBar(shot, ctx, area, { left, right }, turn) {
  const { look, unit } = ctx;
  const w = TURN_BAR.width * area.w, h = TURN_BAR.height * unit;
  const y = (left[1] + left[3] + right[1]) / HALF - h / HALF;
  const box = [area.left, y, w, h];
  const d = `M${area.left} ${y}h${w}v${h}h${-w}Z`;
  return { box, node: node('path', `${shot.id}.turn`, { d, fill: look.palette.accent }, { tracks: { opacity: landing(turn, look.moves.enter, 0, 1) } }) };
}
