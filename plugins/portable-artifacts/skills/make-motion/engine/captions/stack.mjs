// The `stack` caption style (pop): the spoken words in the display face, in caps, a few at a time, flush left on the
// stack edge (the left edge of the platform safe zone on 9:16, of column 1 elsewhere) and low in that area, pinned to
// the frame. The word being spoken is in the accent and the rest in ink; an emphasised word keeps the accent once spoken
// (the look's recolour) and, in a look whose emphasis also scales (recolor-scale), pops to the look's emphasize scale,
// growing from its left edge while the words after it on its line move aside by as much, so it never runs into a
// neighbour and never past the zone: the layout keeps the room the peak needs. Pure and DOM-free.
import { node } from '../graph/node.mjs';
import { track, sample } from '../time/track.mjs';
import { layoutText } from '../text/layout.mjs';
import { sizeAt, fontFor, setCase, compositionRect, runInk, shownFrom, pulseScale, easePeak } from '../kinds/shared.mjs';
import { emphasisFlags } from '../kinds/emphasis-flags.mjs';
import { STRETCH_KEYWORDS } from '../fonts/index.mjs';

// The stretch keyword one step wider than `width` (as kinds/stack.mjs widerKeyword; not imported from there: that module
// loads the looks, which need the caption styles registered first)
function widerKeyword(width) {
  const keywords = STRETCH_KEYWORDS.map(([, keyword]) => keyword);
  const at = keywords.indexOf(width);
  if (at < 0) throw new Error(`width must be one of ${keywords.join(', ')}, got ${JSON.stringify(width)}`);
  return keywords[Math.min(keywords.length - 1, at + 1)];
}
import { captionGroups, groupTimes, fitGroup, heardStart, spokenLayout, clearZone, ZONE_ASCENT, ZONE_DESCENT } from './groups.mjs';

const STACK = Object.freeze({
  step: 3, // the display face at scale step 3 (a stack line's smallest), smaller only for a group that does not fit
  maxLines: 2,
  minColumns: 4, // the zone never narrows to fewer columns than this to step past a pinned card or a mark
  grouping: Object.freeze({ maxWords: 3, maxChars: 18 }),
});

// The area a stack composes in: the platform safe zone on 9:16 for a look that keeps to it, else columns 1 to 12 inside
// the margins (as kinds/stack.mjs stackArea).
function areaOf(ctx) {
  const { look, canvas, unit } = ctx;
  const rect = compositionRect(ctx);
  if (rect.safe) return { left: rect.left, top: rect.top, w: rect.w, h: rect.h };
  const margin = look.grid.margin * unit;
  return { left: ctx.gridX(1), top: margin, w: ctx.gridX(look.grid.columns + 1) - ctx.gridX(1), h: canvas.h - 2 * margin };
}

const displayFont = (ctx) => fontFor(ctx.look, 'display', sizeAt(ctx.look, STACK.step, ctx.unit), ctx.unit);
const scales = (look) => emphasisFlags(look).scales === true && look.moves.emphasize.scale !== undefined;
// The largest scale an emphasised word reaches (the spring's overshoot included), or 1 in a look that does not scale.
const peakOf = (look) => (scales(look) ? 1 + (look.moves.emphasize.scale - 1) * easePeak(look.moves.emphasize.ease) : 1);

/**
 * The zone: the bottom of the area, as high as two lines at their peak scale, over its whole width. Against a pinned
 * text card or a marked region in the band (ctx.avoid, ctx.marks: groups.mjs clearZone) it keeps to the stack edge (the
 * left) while it can, narrowing from the right, then moves its left edge right, never under STACK.minColumns columns.
 */
function zone(ctx) {
  const font = displayFont(ctx);
  const area = areaOf(ctx);
  const h = (STACK.maxLines - 1) * font.lineHeight * font.size + (ZONE_ASCENT + ZONE_DESCENT) * font.size * peakOf(ctx.look);
  const to = ctx.look.grid.columns;
  const rank = ({ a, b }) => [a - 1, a - b]; // on the stack edge first, then the widest
  return clearZone(ctx, [area.left, area.top + area.h - h, area.w, h], { from: 1, to, minColumns: STACK.minColumns, left: area.left, right: area.left + area.w, rank });
}

// A word's colour over time: ink, the accent while it is spoken (from its start to `next`, the next later start), and,
// emphasised, the accent from its start on.
function fillTrack(look, at, next, emphasised) {
  const { ink, accent } = look.palette;
  const keys = [{ t: 0, v: ink }, { t: at, v: ink }, { t: at, v: accent }];
  return track(emphasised || next === undefined ? keys : [...keys, { t: Math.max(at, next), v: accent }, { t: Math.max(at, next), v: ink }]);
}

// x keys that follow `scaleTracks` frame by frame: at each frame of their spans, the sum of (scale - 1) * width.
function followTrack(parts, fps) {
  if (parts.length === 0) return undefined;
  const from = Math.min(...parts.map((p) => p.track.points[0].t)), to = Math.max(...parts.map((p) => p.track.points.at(-1).t));
  const frames = Math.ceil((to - from) * fps) + 1;
  const keys = Array.from({ length: frames }, (_, f) => {
    const t = Math.min(to, from + f / fps);
    return { t, v: parts.reduce((sum, p) => sum + (sample(p.track, t) - 1) * p.width, 0) };
  });
  return track([{ t: 0, v: 0 }, ...keys.filter((k) => k.t > 0), { t: to, v: 0 }]);
}

// A look whose emphasis widens and keeps its colour (poster's scale, emphasis-flags.mjs) steps the spoken word one width
// keyword wider instead of recolouring it: the keyword, or undefined for every other look.
function widthStep(look) {
  const flags = emphasisFlags(look);
  return flags.widens === true && flags.keepsColour === true ? widerKeyword(look.fonts.display.width) : undefined;
}

// A word's width over time: the display width, the wider keyword while it is spoken (from its start to `next`) and,
// emphasised, from its start on: a hard step, in room reserved at the wider keyword (setAt), so nothing re-flows.
function widthTrack(look, wider, at, next, emphasised) {
  const base = look.fonts.display.width;
  const keys = [{ t: 0, v: base }, { t: at, v: wider }];
  return track(emphasised || next === undefined ? keys : [...keys, { t: Math.max(at, next), v: base }]);
}

// The word tracks of one group: the fills (or the width step), and in a look that scales the pulse of each emphasised
// word (about its left edge) and the shift of the words after it on its line.
function wordTracksOf(layout, group, ctx) {
  const { look, fps } = ctx;
  const wider = widthStep(look);
  const words = layout.lines.flatMap((line) => line.words.map((w) => ({ line, w })));
  const pulses = new Map(words.filter(({ w }) => scales(look) && group.words[w.index].emphasis)
    .map(({ w }) => [w.index, pulseScale(look, { pulse: heardStart(group.words[w.index]) })]));
  return words.map(({ line, w }) => {
    const said = group.words[w.index];
    // lit from when it is heard until a later word is: the words of a merged run (one shared time) light together
    const next = group.words.slice(w.index + 1).map(heardStart).find((t) => t > heardStart(said));
    const fill = wider === undefined ? { fill: fillTrack(look, heardStart(said), next, said.emphasis) } : { width: widthTrack(look, wider, heardStart(said), next, said.emphasis) };
    const before = line.words.filter((o) => o.index < w.index && pulses.has(o.index)).map((o) => ({ track: pulses.get(o.index), width: o.width }));
    const own = pulses.has(w.index) ? [{ track: pulses.get(w.index), width: w.width / 2 }] : [];
    const x = followTrack([...before, ...own], fps);
    return { ...fill, ...(own.length > 0 ? { scale: pulses.get(w.index) } : {}), ...(x ? { x } : {}) };
  });
}

// The group's text laid out in caps at `size` px in `maxWidth`, as { layout, font }: one layout word per spoken word, or
// an error that says which differ.
function setAt(group, size, maxWidth, ctx) {
  const font = fontFor(ctx.look, 'display', size, ctx.unit);
  const text = setCase(ctx.look, 'display', group.words.map((w) => w.text).join(' '));
  // with a width step every word is measured at the wider keyword (text/layout.mjs reserve), so a step moves nothing
  const wider = widthStep(ctx.look);
  const reserve = wider === undefined ? {} : { reserve: { width: wider } };
  return { layout: spokenLayout(layoutText({ text, font, maxWidth, measure: ctx.measure, ...reserve }), group, text, ctx.captionId), font };
}

// The group at step STACK.step, or smaller (down to the look's smallest step) when it needs more than STACK.maxLines or
// a line's ink is wider than `maxWidth` there: groups.mjs fitGroup.
function setGroup(group, maxWidth, ctx) {
  const fits = ({ layout, font }) => layout.lines.length <= STACK.maxLines
    && layout.lines.every((line) => { const ink = runInk(line, font, ctx.measure); return ink.right - ink.left <= maxWidth; });
  return fitGroup((px) => setAt(group, px, maxWidth, ctx), fits, displayFont(ctx).size, sizeAt(ctx.look, 1, ctx.unit));
}

/** The shot's caption nodes: one text per group, pinned, each on screen in turn. */
function compose(words, ctx) {
  const { look, timing, fps, captionId, hero, filmStart, measure } = ctx;
  const z = zone(ctx);
  const peak = peakOf(look);
  const groups = captionGroups(words, STACK.grouping);
  const times = groupTimes(groups, { duration: timing.duration, fps });
  return groups.map((group, k) => {
    const { layout, font } = setGroup(group, z[2] / peak, ctx);
    const ink = runInk(layout.lines[0], font, measure);
    // the last baseline keeps the descent at the peak scale above the zone's bottom
    const y = z[1] + z[3] - ZONE_DESCENT * font.size * peak - layout.lines.at(-1).y;
    const emphasis = layout.lines.flatMap((l) => l.words).filter((w) => group.words[w.index].emphasis).map((w) => w.index);
    const caption = { zone: z, end: filmStart + times[k].end, hero, emphasis, marks: ctx.markIds ?? [] };
    return node('text', `${captionId}.${k}`, { x: z[0] - ink.left, y, layout, font, fill: look.palette.ink, role: 'caption', furniture: true, fixed: true, caption }, {
      tracks: { opacity: shownFrom(times[k].at, times[k].until) },
      wordTracks: wordTracksOf(layout, group, ctx),
    });
  });
}

export const stack = {
  name: 'stack',
  summary: 'The spoken words in display caps, a few at a time, flush left on the stack edge low in the platform safe zone; the word being spoken in the accent, an emphasised one keeping it.',
  zone,
  compose,
};
