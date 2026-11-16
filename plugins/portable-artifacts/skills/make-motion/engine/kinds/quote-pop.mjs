// The `quote` kind in a stack composition (pop): the quotation as a stack (stack.mjs) with no marks in its words; its
// opening mark is a giant shape in the accent, `mark` em of the first line tall, flush left on the stack's edge and
// drawn behind the first line, which it reaches `into` of its own height (a shape, not a glyph: it is drawn, not set,
// so it is never a second size or a text on text). The attribution is a tag `tagGap` under the stack, label caps on the
// look's tag colours at the largest of `tagSteps` that fits the width, wrapped when it still does not. A portrait is a
// cut-out `portrait` of the short side at its longest, beside the mark over the first line (over the mark when the row
// is too narrow). Pure and DOM-free.
import { registries } from '../registry.mjs';
import { node } from '../graph/node.mjs';
import { layoutText } from '../text/layout.mjs';
import { landing, entrance, colourOf, polyline } from '../devices/shared.mjs';
import { sizeAt, fontFor, setCase, arrivesMatched } from './shared.mjs';
import { STACK, stackArea, composeStack, stackNodes } from './stack.mjs';
import { restack } from './end.mjs';
import { ghostWords } from './statement.mjs';
import { quotationOf, attributionOf } from './quote-text.mjs';

// One opening mark (a "6") in a 0.45 x 0.8 box, as cubic curves from its tail's tip; the pair sets two of them 0.55 apart.
const SIX = Object.freeze([
  ['M', 0.45, 0.02],
  ['C', 0.2, 0.1, 0.04, 0.3, 0.03, 0.52],
  ['C', 0.02, 0.7, 0.12, 0.8, 0.24, 0.8],
  ['C', 0.36, 0.8, 0.45, 0.71, 0.45, 0.59],
  ['C', 0.45, 0.47, 0.37, 0.39, 0.26, 0.39],
  ['C', 0.25, 0.27, 0.32, 0.16, 0.45, 0.1],
]);
const SIX_OFFSET = 0.55;
const SIX_LEFT = 0.02; // the shape's leftmost point: set on `left`, so the mark sits flush on the stack edge
const MARK_HEIGHT = 0.8; // of the shape's own box; its width is 1
const TAG_PAD = Object.freeze({ x: 0.32, y: 0.2 }); // em of the tag's own size, as number.mjs plainTag
const DECIMALS = 2;
const ROOM_SEARCH_STEPS = 16; // bisection steps for the room over the stack: well under a pixel
const NO_WRAP = 1e6;
const EPSILON = 1e-6;
const HALF = 2;

const fixed = (v) => Number(v.toFixed(DECIMALS));

/** The opening-mark pair as one path at (left, top), `height` tall. */
export function markPath(left, top, height) {
  const s = height / MARK_HEIGHT;
  const one = (dx) => SIX.map(([cmd, ...xy]) => `${cmd}${xy.map((v, i) => fixed((i % HALF === 0 ? left + (v - SIX_LEFT + dx) * s : top + v * s))).join(' ')}`).join('') + 'Z';
  return one(0) + one(SIX_OFFSET);
}

// The attribution as a tag: label caps on the look's tag colours at the largest of `steps` that fits `maxWidth`, else
// the smallest, wrapped. Built like number.mjs plainTag (private there). { nodes, box, height } with the plate's top
// left at (left, top).
function attributionTag(shot, ctx, { left, top, maxWidth, at, steps }) {
  const { look, unit, measure } = ctx;
  const style = look.devices.tag ?? {};
  const text = setCase(look, 'label', attributionOf(shot));
  const padded = (size, width) => width + HALF * TAG_PAD.x * size;
  const sizes = [...steps].sort((a, b) => b - a).map((step) => sizeAt(look, step, unit));
  const oneLine = (size) => layoutText({ text, font: fontFor(look, 'label', size, unit), maxWidth: NO_WRAP, measure });
  const size = sizes.find((s) => padded(s, oneLine(s).width) <= maxWidth + EPSILON) ?? sizes.at(-1);
  const font = fontFor(look, 'label', size, unit);
  const layout = layoutText({ text, font, maxWidth: maxWidth - HALF * TAG_PAD.x * size, measure });
  const w = padded(size, layout.width), h = layout.height + HALF * TAG_PAD.y * size;
  const corners = [[-w / HALF, -h / HALF], [w / HALF, -h / HALF], [w / HALF, h / HALF], [-w / HALF, h / HALF]];
  const plate = node('path', `${shot.id}.by.plate`, { d: polyline(corners, true), fill: colourOf(look, style.fill ?? 'ink') });
  const label = node('text', `${shot.id}.by.text`, {
    x: -w / HALF + TAG_PAD.x * size, y: -h / HALF + TAG_PAD.y * size, layout, font, fill: colourOf(look, style.text ?? 'paper'), role: 'tag',
  });
  const group = entrance({ id: `${shot.id}.by`, at, look, unit, cx: left + w / HALF, cy: top + h / HALF, children: [plate, label] });
  return { nodes: [group], box: [left, top, w, h], height: h };
}

// The portrait's size, longest side `portrait` of the short side, or null.
function portraitSize(shot, ctx, data) {
  if (shot.src === undefined) return null;
  const picture = ctx.asset(shot.src);
  const scale = (data.portrait * Math.min(ctx.canvas.w, ctx.canvas.h)) / Math.max(picture.width, picture.height);
  return { w: picture.width * scale, h: picture.height * scale, keyline: ctx.look.keyline * ctx.unit };
}

// Where the portrait goes: beside the mark (a gutter after it, its bottom a tag gap over the first line) when the row has
// the width, else over the mark; and the room it needs over the first line beyond the mark's own.
function portraitPlace(portrait, area, markH, ctx) {
  const { unit, look } = ctx;
  const gap = STACK.kickerGap * unit;
  const besideLeft = area.left + markH / MARK_HEIGHT + look.grid.gutter * unit + portrait.keyline;
  const beside = besideLeft + portrait.w + portrait.keyline <= area.left + area.w + EPSILON;
  const tall = portrait.h + HALF * portrait.keyline + gap;
  return beside ? { beside, left: besideLeft, extra: (markAbove) => Math.max(0, tall - markAbove) } : { beside, left: area.left + portrait.keyline, extra: () => tall };
}

// The stack set again (end.mjs restack) with the mark's room over it, the portrait's beyond that and the tag's under it.
// The mark's room follows the first line's size, which the room itself sets (more room, smaller lines), so the room is
// found by bisection: the least that still holds the mark at the size the stack then takes. The top of the range always
// holds (restack never sets a line larger than composeStack did).
function placeStack(first, ctx, data, { portrait, area, below }) {
  const roomFor = (size) => {
    const above = data.mark * size * (1 - data.into);
    return above + (portrait === null ? 0 : portraitPlace(portrait, area, data.mark * size, ctx).extra(above));
  };
  const at = (room) => restack(first, ctx, { above: room, below });
  let low = 0, high = roomFor(first.lines[0].font.size);
  for (let i = 0; i < ROOM_SEARCH_STEPS; i++) {
    const mid = (low + high) / HALF;
    if (roomFor(at(mid).lines[0].font.size) <= mid) high = mid;
    else low = mid;
  }
  return at(high);
}

/** The pop quote: { nodes, boxes } with the stack group carrying the hero id. */
export function expandPopQuote(shot, ctx, data, times, hero) {
  const { look, unit, seed } = ctx;
  const area = stackArea(ctx);
  const staged = { ...shot, kicker: undefined };
  const first = composeStack(setCase(look, 'display', quotationOf(shot)), staged, ctx);
  const portrait = portraitSize(shot, ctx, data);
  const markAbove = (size) => data.mark * size * (1 - data.into);
  const tagProbe = attributionTag(shot, ctx, { left: 0, top: 0, maxWidth: area.w, at: 0, steps: data.tagSteps });
  const placed = placeStack(first, ctx, data, { portrait, area, below: data.tagGap * unit + tagProbe.height });
  const line0 = placed.lines[0];
  const markH = data.mark * line0.font.size;
  const markTop = line0.baseline - line0.ink.up - markAbove(line0.font.size);
  const mark = node('path', `${shot.id}.mark`, { d: markPath(area.left, markTop, markH), fill: look.palette.accent }, {
    tracks: { opacity: landing(look.moves.enter.dur, look.moves.enter, 0, 1) },
  });
  const flags = { ghost: ghostWords(ctx), matched: arrivesMatched(shot, ctx) };
  const stackTimes = times.words.map(({ at, spoken }) => ({ at, emphasised: spoken !== null && ctx.timing.words[spoken].emphasis }));
  const built = stackNodes(staged, ctx, placed, { times: stackTimes, hero, ...flags });
  const last = placed.lines.at(-1);
  const tag = attributionTag(shot, ctx, { left: area.left, top: last.baseline + last.ink.down + data.tagGap * unit, maxWidth: area.w, at: times.by, steps: data.tagSteps });
  const boxes = { text: built.boxes.text, ...Object.fromEntries(Object.entries(built.boxes).filter(([k]) => k.startsWith('word:'))), by: tag.box };
  const nodes = [mark, built.group, ...tag.nodes];
  if (portrait === null) return { nodes, boxes };
  const image = node('image', `${shot.id}.portrait.image`, { src: shot.src, w: portrait.w, h: portrait.h });
  const place = portraitPlace(portrait, area, markH, ctx);
  const firstTop = line0.baseline - line0.ink.up;
  const bottom = place.beside ? firstTop - STACK.kickerGap * unit - portrait.keyline : markTop - STACK.kickerGap * unit - portrait.keyline;
  const box = [place.left, bottom - portrait.h, portrait.w, portrait.h];
  const cutout = registries.devices.get('cutout').build({ id: `${shot.id}.portrait`, box, at: look.moves.enter.dur, look, unit, seed, image }).nodes;
  return { nodes: [...cutout, ...nodes], boxes };
}
