// The `compare` kind in a stack composition (pop): one side at a time, a hard cut inside the shot at the turn. Each side
// is a stack (stack.mjs) with its title as the hero, a value (when both sides have one) as a numeral line of the same
// stack, under a tag "A" / "B" ("BEFORE" / "AFTER" for before-after), and its points under the stack in the text face at
// the largest of look.kinds.compare.pointSteps the stack stays three times, their cap line `pointGap` under it. A side's
// picture is a cut-out over its tag, at most `picture` of the stack area's height, `pictureGap` above the tag. Pure and
// DOM-free.
import { registries } from '../registry.mjs';
import { node } from '../graph/node.mjs';
import { layoutText } from '../text/layout.mjs';
import { FORCE_MARK } from '../text/breaks.mjs';
import { CAP_HEIGHT, WORD_DESCENT, sizeAt, fontFor, setCase, shownFrom } from './shared.mjs';
import { composeStack, stackNodes, stackArea } from './stack.mjs';
import { restack } from './end.mjs';
import { MIN_HERO_RATIO } from '../review/frame.mjs';
import { SIDES, valueText, hasValues, pointsText } from './compare-text.mjs';

const TAGS = Object.freeze({ versus: ['A', 'B'], 'before-after': ['BEFORE', 'AFTER'] });
const EPSILON = 1e-6;
const HALF = 2;

// The points' font: the largest of data.pointSteps the stack's largest line stays MIN_HERO_RATIO times, else the smallest.
function pointFont(look, data, lines, unit) {
  const largest = Math.max(...lines.map((line) => line.font.size));
  const fits = data.pointSteps.filter((step) => MIN_HERO_RATIO * sizeAt(look, step, unit) <= largest + EPSILON);
  return fontFor(look, 'text', sizeAt(look, fits.length > 0 ? Math.max(...fits) : Math.min(...data.pointSteps), unit), unit);
}

// A side's picture fitted into the stack area's width and `data.picture` of its height, with the room it takes over the
// tag (its keyline included, and the gap); null without one.
function pictureFit(shot, key, ctx, data, area) {
  if (shot[key].src === undefined) return null;
  const picture = ctx.asset(shot[key].src);
  const keyline = ctx.look.keyline * ctx.unit;
  const scale = Math.min((area.w - HALF * keyline) / picture.width, (data.picture * area.h) / picture.height);
  const w = picture.width * scale, h = picture.height * scale;
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

// One side: its wrapper's children (the picture, the tag, the stack, the points) and its box.
function sideParts(shot, key, k, ctx, data, at) {
  const { look, unit, measure } = ctx;
  const area = stackArea(ctx);
  const staged = { ...shot, id: `${shot.id}.${key}`, kicker: TAGS[shot.mode ?? 'versus'][k] };
  const title = setCase(look, 'display', shot[key].title);
  const text = hasValues(shot) ? `${title}${FORCE_MARK} ${setCase(look, 'display', valueText(shot[key].value))}` : title;
  const first = composeStack(text, staged, ctx);
  const words = pointsText(shot[key]);
  const font = words === null ? null : pointFont(look, data, first.lines, unit);
  const points = words === null ? null : layoutText({ text: words, font, maxWidth: area.w, measure });
  const room = points === null ? 0 : data.pointGap * unit + CAP_HEIGHT * font.size + points.lines.at(-1).y - points.lines[0].y + WORD_DESCENT * font.size;
  const fit = pictureFit(shot, key, ctx, data, area);
  const placed = restack(first, ctx, { above: fit === null ? 0 : fit.room, below: room });
  const hero = `${staged.id}.title`;
  const built = stackNodes(staged, ctx, placed, { times: placed.rows.flat().map(() => ({ at: 0, emphasised: false })), ghost: false, matched: true, hero });
  const children = [...pictureNodes(shot, key, ctx, data, { fit, placed, at }), ...built.kicker, built.group];
  if (points !== null) {
    const last = placed.lines.at(-1);
    const y = last.baseline + last.ink.down + data.pointGap * unit + CAP_HEIGHT * font.size - points.lines[0].y;
    children.push(node('text', `${staged.id}.points`, { x: area.left, y, layout: points, font, fill: look.palette.ink2, role: 'body' }));
  }
  return { id: staged.id, children, box: built.boxes.text };
}

/** The pop compare: the two sides as wrappers { id, tracks, children } shown before and from the turn, and their boxes. */
export function expandPopCompare(shot, ctx, data, turn) {
  const spans = [[0, turn], [turn, undefined]];
  // a side's picture is whole the moment its side is (the stack is too): no fade in after the hard cut at the turn
  const parts = SIDES.map((key, k) => sideParts(shot, key, k, ctx, data, spans[k][0]));
  const wrappers = parts.map((p, k) => ({ id: p.id, tracks: { opacity: shownFrom(spans[k][0], spans[k][1]) }, children: p.children }));
  return { wrappers, boxes: { left: parts[0].box, right: parts[1].box } };
}
