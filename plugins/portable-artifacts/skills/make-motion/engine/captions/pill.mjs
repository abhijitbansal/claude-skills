// The `pill` caption style (cosmos): the spoken words in the look's label face, sentence case, on one line inside a
// pill at the bottom of the grid, centred across the caption columns (2 to 11 on a wide canvas, 1 to 12 on a tall one,
// inside the platform safe zone for a look that composes in it). The pill is the look's card colour, opaque (the
// review measures the words against it), sized to the shot's largest group and pinned to the frame (props.fixed); the
// groups swap inside it as each one's last word ends. Each word turns to the accent while it is spoken and back to ink
// after; an emphasised word stays in the accent. Same contract as lower.mjs ({ summary, zone, compose }).
// Not registered here: engine/captions/index.mjs registers it (the look names it once it is). Pure and DOM-free.
import { node } from '../graph/node.mjs';
import { track } from '../time/track.mjs';
import { layoutText } from '../text/layout.mjs';
import { roundedRect, colourOf } from '../devices/shared.mjs';
import { sizeAt, fontFor, setCase, isWide, runInk, shownFrom, compositionRect } from '../kinds/shared.mjs';
import { captionGroups, groupTimes, fitGroup, heardStart, heardEnd, columnRight, visibleDuring, spokenLayout, clearZone, ZONE_ASCENT, ZONE_DESCENT } from './groups.mjs';

const PILL = Object.freeze({
  step: 2, // the label face at scale step 2
  minStep: 1, // a long word alone may shrink to step 1
  padX: 36, // units of pill around the words, across
  padY: 16, // ...and above and below
  wide: Object.freeze([2, 11]), // the zone's columns on a wide canvas...
  tall: Object.freeze([1, 12]), // ...and on a tall one
  maxWords: 7,
  maxChars: 36,
  fill: 0.85, // a group holds at most this share of the characters the line could
});
const PROBE = 'abcdefghijklmnopqrstuvwxyz'; // the average advance of a letter, for how many fit on the line
const DEFAULT_FILL = 'paper'; // the pill's colour when the look styles no card
const HALF = 2;
const MIN_COLUMNS = 4; // the zone never narrows to fewer columns than this to step past a pinned card or a mark

const labelFont = (ctx, step = PILL.step) => fontFor(ctx.look, 'label', sizeAt(ctx.look, step, ctx.unit), ctx.unit);
const pillFill = (look) => colourOf(look, look.devices?.card?.fill ?? DEFAULT_FILL);

/**
 * The zone: one line and its pill high, on the bottom margin, across the caption columns, inside compositionRect.
 * Against a pinned text card or a marked region in the band (ctx.avoid, ctx.marks: groups.mjs clearZone) it takes the
 * widest span of at least MIN_COLUMNS of the grid's columns clear of them, the nearest the caption columns' centre among
 * equals.
 */
function zone(ctx) {
  const { look, canvas, unit } = ctx;
  const font = labelFont(ctx);
  const [from, to] = isWide(canvas) ? PILL.wide : PILL.tall;
  const rect = compositionRect(ctx);
  const h = HALF * PILL.padY * unit + (ZONE_ASCENT + ZONE_DESCENT) * font.size;
  const bottom = Math.min(canvas.h - look.grid.margin * unit, rect.top + rect.h);
  const left = Math.max(rect.left, ctx.gridX(from));
  const right = Math.min(rect.left + rect.w, columnRight(ctx, to));
  const rank = ({ a, b }) => [a - b, Math.abs(a + b - from - to)]; // the widest, then the most central
  return clearZone(ctx, [left, bottom - h, right - left, h], { from: 1, to: look.grid.columns, minColumns: MIN_COLUMNS, left: rect.left, right: rect.left + rect.w, rank });
}

function groupingFor(width, ctx) {
  const font = labelFont(ctx);
  const advance = ctx.measure(PROBE, font).width / PROBE.length + font.tracking * font.size;
  const perLine = Math.floor((width - HALF * PILL.padX * ctx.unit) / advance);
  return { maxWords: PILL.maxWords, maxChars: Math.max(1, Math.min(PILL.maxChars, Math.floor(perLine * PILL.fill))) };
}

// A look that steps the spoken word's weight instead of recolouring it (look.captionWeight, keynote) measures every word
// at that weight, so a word drawn lighter sits centred in its room and nothing moves (text/layout.mjs reserve).
const reserveOf = (look) => (look.captionWeight === undefined ? {} : { reserve: { weight: look.captionWeight } });

// One group on one line at `size` px: { layout, font, ink: { up, down, left, right } }.
function setAt(group, size, ctx) {
  const font = fontFor(ctx.look, 'label', size, ctx.unit);
  const text = setCase(ctx.look, 'label', group.words.map((w) => w.text).join(' '));
  const layout = spokenLayout(layoutText({ text, font, maxWidth: Number.MAX_SAFE_INTEGER, measure: ctx.measure, ...reserveOf(ctx.look) }), group, text, ctx.captionId);
  return { layout, font, ink: runInk(layout.lines[0], font, ctx.measure) };
}

function setGroup(group, maxWidth, ctx) {
  const fits = (set) => set.ink.right - set.ink.left <= maxWidth;
  return fitGroup((px) => setAt(group, px, ctx), fits, labelFont(ctx).size, labelFont(ctx, PILL.minStep).size);
}

// A word's fill: ink, the accent from when it is heard, and ink again when it ends (unless it is emphasised).
function spokenFill(look, word) {
  const { ink, accent } = look.palette;
  const [from, to] = [heardStart(word), Math.max(heardStart(word), heardEnd(word))];
  if (look.captionWeight !== undefined) return spokenWeight(look, word, [from, to]);
  const keys = [{ t: 0, v: ink }, { t: from, v: ink }, { t: from, v: accent }];
  if (!word.emphasis) keys.push({ t: to, v: accent }, { t: to, v: ink });
  return { fill: track(keys) };
}

// A word's weight (look.captionWeight, keynote): the label weight, the caption weight from when it is heard, and the
// label weight again when it ends (unless it is emphasised). Ink throughout: no recolour.
function spokenWeight(look, word, [from, to]) {
  const [rest, heavy] = [look.fonts.label.weight, look.captionWeight];
  const keys = [{ t: 0, v: rest }, { t: from, v: rest }, { t: from, v: heavy }];
  if (!word.emphasis) keys.push({ t: to, v: heavy }, { t: to, v: rest });
  return { weight: track(keys) };
}

/** The shot's caption nodes: one pill holding each group in turn. */
function compose(words, ctx) {
  const { look, unit, timing, fps, captionId, hero, filmStart } = ctx;
  const z = zone(ctx);
  const padX = PILL.padX * unit, padY = PILL.padY * unit;
  const groups = captionGroups(words, groupingFor(z[2], ctx));
  const times = groupTimes(groups, { duration: timing.duration, fps });
  const sets = groups.map((g) => setGroup(g, z[2] - HALF * padX, ctx));
  const block = Math.max(...sets.map((s) => s.ink.up + s.ink.down));
  const w = Math.min(z[2], Math.max(...sets.map((s) => s.ink.right - s.ink.left)) + HALF * padX);
  const h = block + HALF * padY;
  const plate = node('path', `${captionId}.paper`, { d: roundedRect(-w / HALF, -h / HALF, w, h, h / HALF), fill: pillFill(look), textCard: true });
  const children = sets.map((set, k) => {
    const id = `${captionId}.${k}`;
    const inkW = set.ink.right - set.ink.left;
    // centred in the pill by its ink, the block centred in its height (pill-local: its centre is 0, 0)
    const origin = { x: -inkW / HALF - set.ink.left, y: -block / HALF + set.ink.up - set.layout.lines[0].y };
    const lineWords = set.layout.lines.flatMap((l) => l.words);
    const wordTracks = lineWords.map((wd) => spokenFill(look, groups[k].words[wd.index]));
    const emphasis = lineWords.filter((wd) => groups[k].words[wd.index]?.emphasis).map((wd) => wd.index);
    const caption = { zone: z, end: filmStart + times[k].end, hero, emphasis, marks: ctx.markIds ?? [] };
    const text = node('text', `${id}.text`, { ...origin, layout: set.layout, font: set.font, fill: look.palette.ink, role: 'caption', furniture: true, caption }, { wordTracks });
    return node('group', id, {}, { tracks: { opacity: shownFrom(times[k].at, times[k].until) }, children: [text] });
  });
  const cx = z[0] + z[2] / HALF, cy = z[1] + z[3] - h / HALF;
  return [node('group', captionId, { x: cx, y: cy, fixed: true }, { tracks: { opacity: visibleDuring(times) }, children: [plate, ...children] })];
}

export const pill = {
  name: 'pill',
  summary: 'The spoken words in the label face on one line inside a pill at the bottom of the grid; each word in the accent while it is spoken.',
  zone,
  compose,
};
