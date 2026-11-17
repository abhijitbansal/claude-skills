// The `lower` caption style (desk): the spoken words in label caps on a taped paper card, low on the grid. The card's
// right edge is the right edge of column 11 (the slug's right margin: the slug sits top right, the caption bottom right,
// so the spoken words never take the bottom left, where a clipping's own caption card rests) and its bottom is the
// bottom margin; it sits square, pinned to the frame (props.fixed: a camera push leaves it in place). Up to two lines in
// the zone's width (columns 6 to 11 on a wide canvas, 2 to 11 on a tall one, narrowed past any pinned text card of the
// kind or marked region of the shot that comes into the band: a clipping's caption card at rest and where a push takes
// it); the groups are
// sized to that width. One card per shot, sized to its largest group, on screen while a group is; the groups swap inside
// it as each one's last word ends. An emphasised word is
// marked with the look's emphasis: a highlighter band drawn on as it is spoken (a highlight look), else its fill turns
// accent. A look that selects the plain variant (look.captionVariant 'plain', ledger) gets a white strip with a top
// hairline instead of the taped card, the text face in sentence case, and the word being heard in ink at 600 (PLAIN).
// Pure and DOM-free.
import { registries } from '../registry.mjs';
import { node } from '../graph/node.mjs';
import { track } from '../time/track.mjs';
import { layoutText } from '../text/layout.mjs';
import { sizeAt, fontFor, setCase, isWide, runInk, shownFrom, asTextCard, compositionRect, requireDevice } from '../kinds/shared.mjs';
import { captionGroups, groupTimes, fitGroup, heardStart, heardEnd, columnRight, visibleDuring, spokenLayout, clearZone, ZONE_ASCENT, ZONE_DESCENT } from './groups.mjs';

const LOWER = Object.freeze({
  step: 2, // label caps at scale step 2, as a slug's kicker
  pad: 30, // units of paper around the text, as a slug
  maxLines: 2,
  wide: Object.freeze([6, 11]), // the zone's columns on a wide canvas...
  tall: Object.freeze([2, 11]), // ...and on a tall one
  band: Object.freeze([2, 11]), // the columns it may move along to keep off a pinned card or a mark
  minColumns: 3, // the zone never narrows to fewer columns than this to step past a pinned card
  maxWords: 7,
  maxChars: 32,
  fill: 0.8, // a group holds at most this share of the characters its lines could, so breaks by sense still fit
});
const PROBE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'; // the average advance of a capital, for how many fit on a line
const HALF = 2;
// The plain strip (look.captionVariant 'plain', ledger): the text face in sentence case on a white strip with a top
// hairline in the rule colour; the word being spoken in ink at SPOKEN_WEIGHT (every word measured at it, so nothing
// moves), the rest in ink2.
const PLAIN = Object.freeze({ strip: '#ffffff', line: 'rule', lineWidth: 1, rest: 'ink2', spoken: 'ink', weight: 600 });
const isPlain = (look) => look.captionVariant === 'plain';
const faceOf = (look) => (isPlain(look) ? 'text' : 'label');

const labelFont = (ctx) => fontFor(ctx.look, faceOf(ctx.look), sizeAt(ctx.look, LOWER.step, ctx.unit), ctx.unit);
const pitchOf = (font) => font.lineHeight * font.size;

/**
 * The zone: the band at the bottom of the grid, two lines and their paper high, over the caption columns (6 to 11 wide,
 * 2 to 11 tall), inside the platform safe zone for a look that composes in it (compositionRect safe). Against a pinned
 * text card or a marked region in the band (ctx.avoid, ctx.marks: groups.mjs clearZone) it keeps its right edge on
 * column 11 while it can, moving its left edge right, then takes the widest span of columns 2 to 11 clear of them that
 * ends furthest right, never under LOWER.minColumns.
 */
function zone(ctx) {
  const { look, canvas, unit } = ctx;
  const font = labelFont(ctx);
  const [from, to] = isWide(canvas) ? LOWER.wide : LOWER.tall;
  const rect = compositionRect(ctx);
  const h = HALF * LOWER.pad * unit + (ZONE_ASCENT + ZONE_DESCENT) * font.size + (LOWER.maxLines - 1) * pitchOf(font);
  const bottom = Math.min(canvas.h - look.grid.margin * unit, rect.top + rect.h);
  const [left, right] = [Math.max(rect.left, ctx.gridX(from)), Math.min(rect.left + rect.w, columnRight(ctx, to))];
  const rank = ({ a, b }) => [to - b, a - b]; // the right edge on column 11 first, then the widest
  const [bandFrom, bandTo] = LOWER.band;
  return clearZone(ctx, [left, bottom - h, right - left, h], { from: bandFrom, to: bandTo, minColumns: LOWER.minColumns, left: rect.left, right: rect.left + rect.w, rank });
}

// The grouping limits for a zone `width` px wide: at most LOWER.fill of the capitals its lines could hold.
function groupingFor(width, font, ctx) {
  const advance = ctx.measure(PROBE, font).width / PROBE.length + font.tracking * font.size;
  const perLine = Math.floor((width - HALF * LOWER.pad * ctx.unit) / advance);
  return { maxWords: LOWER.maxWords, maxChars: Math.max(1, Math.min(LOWER.maxChars, Math.floor(perLine * LOWER.maxLines * LOWER.fill))) };
}

// One group laid out in caps at `size` px: { layout, font, ink: { up, down, left }, block } with block its ink's height.
function setAt(group, size, maxWidth, ctx) {
  const face = faceOf(ctx.look);
  const font = fontFor(ctx.look, face, size, ctx.unit);
  const text = setCase(ctx.look, face, group.words.map((w) => w.text).join(' '));
  const reserve = isPlain(ctx.look) ? { reserve: { weight: PLAIN.weight } } : {};
  const layout = spokenLayout(layoutText({ text, font, maxWidth, measure: ctx.measure, ...reserve }), group, text, ctx.captionId);
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

// The emphasis of one group: highlighter bands (card-local) behind each emphasised word, drawn on as the word is spoken
// and whole by the group's last frame (before `until`), or accent fills on them.
function emphasisOf(set, group, origin, ctx, { id, until }) {
  const { look, unit, seed, measure } = ctx;
  const marked = set.layout.lines.flatMap((line) => line.words.filter((w) => group.words[w.index]?.emphasis).map((w) => ({ line, w })));
  if (marked.length === 0) return { bands: [], wordTracks: [] };
  const at = (w) => heardStart(group.words[w.index]);
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

// The plain strip's word tracks: every word in ink2, the one being heard in ink (the accent when emphasised) at
// PLAIN.weight from its heard start to its heard end.
function plainWordTracks(set, group, look) {
  const rest = look.palette[PLAIN.rest], base = look.fonts.text.weight;
  return set.layout.lines.flatMap((l) => l.words).sort((a, b) => a.index - b.index).map((w) => {
    const word = group.words[w.index];
    const [from, to] = [heardStart(word), Math.max(heardStart(word), heardEnd(word))];
    const on = word.emphasis ? look.palette.accent : look.palette[PLAIN.spoken];
    return {
      fill: track([{ t: 0, v: rest }, { t: from, v: rest }, { t: from, v: on }, { t: to, v: on }, { t: to, v: rest }]),
      weight: track([{ t: 0, v: base }, { t: from, v: base }, { t: from, v: PLAIN.weight }, { t: to, v: PLAIN.weight }, { t: to, v: base }]),
    };
  });
}

// The plain strip around the largest group: a white strip (`.strip`, the text card) and its top hairline, square and
// pinned to the frame, shown by `opacity`.
function stripGroup(ctx, [x, y, w, h], opacity, children) {
  const { look, unit, captionId } = ctx;
  const d = `M${-w / HALF} ${-h / HALF}L${w / HALF} ${-h / HALF}L${w / HALF} ${h / HALF}L${-w / HALF} ${h / HALF}Z`;
  const strip = node('path', `${captionId}.strip`, { d, fill: PLAIN.strip, textCard: true });
  const line = node('path', `${captionId}.hairline`, { d: `M${-w / HALF} ${-h / HALF}L${w / HALF} ${-h / HALF}`, stroke: look.palette[PLAIN.line], strokeWidth: PLAIN.lineWidth * unit });
  return node('group', captionId, { x: x + w / HALF, y: y + h / HALF, fixed: true }, { tracks: { opacity }, children: [strip, line, ...children] });
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
  if (!isPlain(look)) requireDevice(look, 'card', 'caption style lower');
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
    const { bands, wordTracks } = isPlain(look) ? { bands: [], wordTracks: plainWordTracks(set, groups[k], look) } : emphasisOf(set, groups[k], origin, ctx, { id, until: times[k].until });
    const emphasis = set.layout.lines.flatMap((l) => l.words).filter((wd) => groups[k].words[wd.index]?.emphasis).map((wd) => wd.index);
    const caption = { zone: z, end: filmStart + times[k].end, hero, emphasis, marks: ctx.markIds ?? [] };
    const text = node('text', `${id}.text`, { ...origin, layout: set.layout, font: set.font, fill: look.palette.ink, role: 'caption', furniture: true, caption }, { wordTracks });
    return node('group', id, {}, { tracks: { opacity: shownFrom(times[k].at, times[k].until) }, children: [...bands, text] });
  });
  return [(isPlain(look) ? stripGroup : cardGroup)(ctx, box, visibleDuring(times), children)];
}

export const lower = {
  name: 'lower',
  summary: 'The spoken words in label caps on a taped paper card at the bottom of the grid, its right edge on column 11; up to two lines; each group swaps in as the one before it ends.',
  zone,
  compose,
};
