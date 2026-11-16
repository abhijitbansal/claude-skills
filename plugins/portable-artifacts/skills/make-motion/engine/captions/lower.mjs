// The `lower` caption style (desk): the spoken words in label caps on a taped paper card, low on the grid. The card's
// right edge is the right edge of column 11 (the slug's right margin: the slug sits top right, the caption bottom right,
// so the spoken words never take the bottom left, where a clipping's own caption card rests) and its bottom is the
// bottom margin; it sits square, pinned to the frame (props.fixed: a camera push leaves it in place). Up to two lines in
// the zone's width (columns 6 to 11 on a wide canvas, 2 to 11 on a tall one, narrowed from the left past any pinned text
// card of the kind that comes into the band: a clipping's caption card at rest and where a push takes it); the groups are
// sized to that width. One card per shot, sized to its largest group, on screen while a group is; the groups swap inside
// it as each one's last word ends. An emphasised word is
// marked with the look's emphasis: a highlighter band drawn on as it is spoken (a highlight look), else its fill turns
// accent. Pure and DOM-free.
import { registries } from '../registry.mjs';
import { node } from '../graph/node.mjs';
import { track } from '../time/track.mjs';
import { layoutText } from '../text/layout.mjs';
import { sizeAt, fontFor, setCase, isWide, runInk, shownFrom, asTextCard, compositionRect, requireDevice } from '../kinds/shared.mjs';
import { captionGroups, groupTimes, fitGroup, ZONE_ASCENT, ZONE_DESCENT } from './groups.mjs';

const LOWER = Object.freeze({
  step: 2, // label caps at scale step 2, as a slug's kicker
  pad: 30, // units of paper around the text, as a slug
  maxLines: 2,
  wide: Object.freeze([6, 11]), // the zone's columns on a wide canvas...
  tall: Object.freeze([2, 11]), // ...and on a tall one
  minColumns: 3, // the zone never narrows to fewer columns than this to step past a pinned card
  maxWords: 7,
  maxChars: 32,
  fill: 0.8, // a group holds at most this share of the characters its lines could, so breaks by sense still fit
});
const PROBE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'; // the average advance of a capital, for how many fit on a line
const JOIN_EPSILON = 1e-9; // seconds: spans closer than this are back to back
const HALF = 2;

// The right edge in pixels of 1-based grid column `column` (1 to 12).
const columnRight = (ctx, column) => (column === ctx.look.grid.columns ? ctx.gridX(column + 1) : ctx.gridX(column + 1) - ctx.look.grid.gutter * ctx.unit);
const labelFont = (ctx) => fontFor(ctx.look, 'label', sizeAt(ctx.look, LOWER.step, ctx.unit), ctx.unit);
const pitchOf = (font) => font.lineHeight * font.size;

// The first caption column whose left edge clears every box of ctx.avoid (pinned text cards) and ctx.marks (marked
// regions) that reaches into the band [top, bottom] and the columns from..to, by a gutter; `from` when none does, or when
// that would leave fewer than LOWER.minColumns.
function clearColumn(ctx, [from, to], top, bottom) {
  const gutter = ctx.look.grid.gutter * ctx.unit;
  const blocking = [...(ctx.avoid ?? []), ...(ctx.marks ?? [])].filter(([x, y, w, h]) => y < bottom && y + h > top && x + w > ctx.gridX(from) && x < columnRight(ctx, to));
  if (blocking.length === 0) return from;
  const clear = Math.max(...blocking.map(([x, , w]) => x + w)) + gutter;
  const column = Array.from({ length: to - from + 1 }, (_, i) => from + i).find((c) => ctx.gridX(c) >= clear);
  return column !== undefined && to - column + 1 >= LOWER.minColumns ? column : from;
}

/**
 * The zone: the band at the bottom of the grid, two lines and their paper high, over the caption columns (6 to 11 wide,
 * 2 to 11 tall), its left edge moved right of any pinned text card or marked region (ctx.avoid, ctx.marks) that comes
 * into the band; inside the platform safe zone for a look that composes in it (compositionRect safe).
 */
function zone(ctx) {
  const { look, canvas, unit } = ctx;
  const font = labelFont(ctx);
  const columns = isWide(canvas) ? LOWER.wide : LOWER.tall;
  const rect = compositionRect(ctx);
  const h = HALF * LOWER.pad * unit + (ZONE_ASCENT + ZONE_DESCENT) * font.size + (LOWER.maxLines - 1) * pitchOf(font);
  const bottom = Math.min(canvas.h - look.grid.margin * unit, rect.top + rect.h);
  const left = Math.max(rect.left, ctx.gridX(clearColumn(ctx, columns, bottom - h, bottom)));
  const right = Math.min(rect.left + rect.w, columnRight(ctx, columns[1]));
  return [left, bottom - h, right - left, h];
}

// The grouping limits for a zone `width` px wide: at most LOWER.fill of the capitals its lines could hold.
function groupingFor(width, font, ctx) {
  const advance = ctx.measure(PROBE, font).width / PROBE.length + font.tracking * font.size;
  const perLine = Math.floor((width - HALF * LOWER.pad * ctx.unit) / advance);
  return { maxWords: LOWER.maxWords, maxChars: Math.max(1, Math.min(LOWER.maxChars, Math.floor(perLine * LOWER.maxLines * LOWER.fill))) };
}

// One group laid out in caps at `size` px: { layout, font, ink: { up, down, left }, block } with block its ink's height.
function setAt(group, size, maxWidth, ctx) {
  const font = fontFor(ctx.look, 'label', size, ctx.unit);
  const text = setCase(ctx.look, 'label', group.words.map((w) => w.text).join(' '));
  const layout = layoutText({ text, font, maxWidth, measure: ctx.measure });
  const count = layout.lines.reduce((n, l) => n + l.words.length, 0);
  if (count !== group.words.length) throw new Error(`${ctx.captionId}: "${text}" lays out as ${count} words, not the ${group.words.length} spoken`);
  const inks = layout.lines.map((line) => runInk(line, font, ctx.measure));
  const ink = { up: inks[0].up, down: inks.at(-1).down, left: Math.min(...inks.map((i) => i.left)), right: Math.max(...inks.map((i) => i.right)) };
  return { layout, font, ink, block: ink.up + layout.lines.at(-1).y - layout.lines[0].y + ink.down };
}

// One group at step LOWER.step, or smaller (down to the look's smallest step) when it needs more than LOWER.maxLines or
// is wider than `maxWidth` there (a long word alone): groups.mjs fitGroup.
function setGroup(group, maxWidth, ctx) {
  const fits = (set) => set.layout.lines.length <= LOWER.maxLines && set.ink.right - set.ink.left <= maxWidth;
  return fitGroup((px) => setAt(group, px, maxWidth, ctx), fits, labelFont(ctx).size, sizeAt(ctx.look, 1, ctx.unit));
}

// Opacity that is 1 during each [at, until) (in order) and 0 elsewhere, stepped; a span that starts where the one before
// it ends joins it, so the card never blinks between two groups.
function visibleDuring(spans) {
  const keys = [{ t: 0, v: 0 }];
  for (const span of spans) {
    const last = keys.at(-1);
    const at = Math.max(span.at, last.t);
    if (keys.length > 1 && at - last.t < JOIN_EPSILON) keys.pop(); // drop the "off" key of the span before
    else keys.push({ t: at, v: 0 }, { t: at, v: 1 });
    keys.push({ t: Math.max(at, span.until), v: 1 }, { t: Math.max(at, span.until), v: 0 });
  }
  return track(keys);
}

// The emphasis of one group: highlighter bands (card-local) behind each emphasised word, drawn on as the word is spoken
// and whole by the group's last frame (before `until`), or accent fills on them.
function emphasisOf(set, group, origin, ctx, { id, until }) {
  const { look, unit, seed, measure } = ctx;
  const marked = set.layout.lines.flatMap((line) => line.words.filter((w) => group.words[w.index]?.emphasis).map((w) => ({ line, w })));
  if (marked.length === 0) return { bands: [], wordTracks: [] };
  const at = (w) => group.words[w.index].start;
  if (look.emphasis !== 'highlight' || !registries.devices.get('highlight').supports(look)) {
    const fills = set.layout.lines.flatMap((l) => l.words).map((w) => (group.words[w.index].emphasis
      ? { fill: track([{ t: 0, v: look.palette.ink }, { t: at(w), v: look.palette.ink }, { t: at(w), v: look.palette.accent }]) } : {}));
    return { bands: [], wordTracks: fills };
  }
  const bands = marked.map(({ line, w }, k) => {
    const ink = runInk(line, set.font, measure, w.index, w.index);
    const box = [origin.x + ink.left, origin.y + line.y - ink.up, ink.right - ink.left, ink.up + ink.down];
    const lands = Math.max(at(w), Math.min(at(w) + look.moves.draw.dur, until - 1 / ctx.fps)); // full on the group's last frame
    return registries.devices.get('highlight').build({ id: `${id}.hl${k}`, box, at: lands, look, unit, seed }).nodes[0];
  });
  return { bands, wordTracks: [] };
}

// The card around the largest group, as built by the card device (square, its entrance replaced by `opacity`).
function cardGroup(ctx, box, opacity, children) {
  const { look, unit, seed, captionId } = ctx;
  const card = registries.devices.get('card').build({ id: captionId, box, at: 0, look, unit, seed }).nodes[0];
  return node('group', captionId, { ...card.props, rotate: 0, fixed: true }, { tracks: { opacity }, children: [...asTextCard(captionId, card.children), ...children] });
}

/** The shot's caption nodes: one taped card holding each group in turn. */
function compose(words, ctx) {
  const { look, unit, timing, fps, captionId, hero, filmStart } = ctx;
  requireDevice(look, 'card', 'caption style lower');
  const z = zone(ctx);
  const pad = LOWER.pad * unit;
  const groups = captionGroups(words, groupingFor(z[2], labelFont(ctx), ctx));
  const times = groupTimes(groups, { duration: timing.duration, fps });
  const sets = groups.map((g) => setGroup(g, z[2] - HALF * pad, ctx));
  const w = Math.min(z[2], Math.max(...sets.map((s) => s.ink.right - s.ink.left)) + HALF * pad);
  const h = Math.max(...sets.map((s) => s.block)) + HALF * pad;
  const box = [z[0] + z[2] - w, z[1] + z[3] - h, w, h];
  const children = sets.map((set, k) => {
    const id = `${captionId}.${k}`;
    // flush left on the card's padding, the block centred in the card's height (card-local: its centre is 0, 0)
    const origin = { x: -w / HALF + pad - set.ink.left, y: -set.block / HALF + set.ink.up - set.layout.lines[0].y };
    const { bands, wordTracks } = emphasisOf(set, groups[k], origin, ctx, { id, until: times[k].until });
    const emphasis = set.layout.lines.flatMap((l) => l.words).filter((wd) => groups[k].words[wd.index]?.emphasis).map((wd) => wd.index);
    const caption = { zone: z, end: filmStart + times[k].end, hero, emphasis, marks: ctx.markIds ?? [] };
    const text = node('text', `${id}.text`, { ...origin, layout: set.layout, font: set.font, fill: look.palette.ink, role: 'caption', furniture: true, caption }, { wordTracks });
    return node('group', id, {}, { tracks: { opacity: shownFrom(times[k].at, times[k].until) }, children: [...bands, text] });
  });
  return [cardGroup(ctx, box, visibleDuring(times), children)];
}

export const lower = {
  name: 'lower',
  summary: 'The spoken words in label caps on a taped paper card at the bottom of the grid, its right edge on column 11; up to two lines; each group swaps in as the one before it ends.',
  zone,
  compose,
};
