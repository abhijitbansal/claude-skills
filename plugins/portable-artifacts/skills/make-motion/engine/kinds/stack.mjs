// The `stack` composition of a statement (pop): the text broken by sense into short lines (stackLines: at most three
// words, two when a line passes twelve letters, `|` honoured), each line set at its own size so that its ink exactly
// fills the available width (the platform safe width on 9:16, columns 1 to 12 otherwise), between scale step 3 and
// STACK.max units; a line that would need more than the cap stops there. Lines sit flush left on the left edge of the
// available width, stacked STACK.gap of the larger neighbour's size apart (ink box to ink box), and the block (with the
// kicker tag, STACK.kickerGap over the first line) is centred in the available height; when it does not fit, every line
// is set smaller in proportion. The hero is a group holding one text node per line, each tagged `stack: <hero id>` so the
// review counts the lines of one stack as one size class. Emphasis recolours: in a mode that reads from frame 0 every
// word is on screen from the first frame as a ghost (opaque, ink mixed 40% into paper, shared.mjs ghostTracks) and lights as it is spoken (ink, or the accent when emphasised); in any
// other mode words fade in on their times and an emphasised one turns accent. Nothing scales. Pure and DOM-free.
import { registries } from '../registry.mjs';
import { node } from '../graph/node.mjs';
import { track } from '../time/track.mjs';
import { layoutText, reservedFont } from '../text/layout.mjs';
import { stackLines, FORCE_MARK, isWeakEnd } from '../text/breaks.mjs';
import { gridX, gridSpan } from '../looks/index.mjs';
import { landing, colourOf } from '../devices/shared.mjs';
import { STRETCH_KEYWORDS } from '../fonts/index.mjs';
import { emphasisFlags } from './emphasis-flags.mjs';
import { turnedStack, turnedWordBox } from './stack-turn.mjs';
import { sizeAt, fontFor, compositionRect, runInk, inkExtent, capBox, unionBox, requireDevice, ghostTracks, isWide, opensSet } from './shared.mjs';

export const STACK = Object.freeze({ fromStep: 3, max: 400, gap: 0.08, kickerGap: 28, ref: 100 });
const FIT_PASSES = 3; // re-measure passes, for a face whose width is not exactly proportional to its size
const SHRINK_PASSES = 2;
const WIDTH_TOLERANCE = 1; // px: a line this much wider than the width still fits
const FIT_SLACK = 0.5; // px: a line is fitted this far inside the width, so re-measuring never leaves it a hair past the edge
const FILL_EASE = 'outCubic';
const NO_WRAP = 1e6;
const HALF = 2;
const EPSILON = 1e-6;

// The words of a text with a `|` kept on the word it follows, as stackLines takes them.
function markedWords(text) {
  const words = [];
  for (const raw of text.split(/\s+/)) {
    if (raw === '') continue;
    if (raw === FORCE_MARK) {
      if (words.length > 0 && !words.at(-1).endsWith(FORCE_MARK)) words[words.length - 1] += FORCE_MARK;
    } else words.push(raw);
  }
  return words;
}

export const bare = (word) => (word.endsWith(FORCE_MARK) ? word.slice(0, -FORCE_MARK.length) : word);

// The space a stack composes in: the platform safe zone on 9:16, else columns 1 to 12 inside the margins.
export function stackArea(ctx) {
  const { look, canvas, unit } = ctx;
  const rect = compositionRect(ctx);
  if (rect.safe) return { left: rect.left, top: rect.top, w: rect.w, h: rect.h };
  const margin = look.grid.margin * unit;
  return { left: gridX(look, canvas, 1), top: margin, w: gridSpan(look, canvas, 1, look.grid.columns).w, h: canvas.h - HALF * margin };
}

// One line's words laid out at `size`: { font, layout, ink, width } with the ink in the line's own space. `reserve`
// ({ width }): every word measured at that width, so a word that steps to it moves nothing (text/layout.mjs).
export function lineAt(words, size, ctx, reserve) {
  const font = fontFor(ctx.look, 'display', size, ctx.unit);
  const layout = layoutText({ text: words.join(' '), font, maxWidth: NO_WRAP, measure: ctx.measure, ...(reserve === undefined ? {} : { reserve }) });
  const ink = runInk(layout.lines[0], reservedFont(font, reserve), ctx.measure);
  return { font, layout, ink, width: ink.right - ink.left };
}

/** The stretch keyword one step wider than `width` (the widest stays itself). */
export function widerKeyword(width) {
  const keywords = STRETCH_KEYWORDS.map(([, keyword]) => keyword);
  const at = keywords.indexOf(width);
  if (at < 0) throw new Error(`width must be one of ${keywords.join(', ')}, got ${JSON.stringify(width)}`);
  return keywords[Math.min(keywords.length - 1, at + 1)];
}

const clampTo = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// The size at which a line's ink is `width` wide, between `min` and `max`; a line still too wide at `min` overflows.
export function fitLine(words, available, { min, max }, ctx, reserve) {
  const width = available - FIT_SLACK;
  let line = lineAt(words, STACK.ref * ctx.unit, ctx, reserve);
  for (let i = 0; i < FIT_PASSES; i++) {
    const size = clampTo((line.font.size * width) / line.width, min, max);
    if (size === line.font.size) break;
    line = lineAt(words, size, ctx, reserve);
  }
  if (line.width <= available) return line;
  if (line.width <= available + WIDTH_TOLERANCE && line.font.size > min) return lineAt(words, Math.max(min, (line.font.size * width) / line.width), ctx, reserve);
  return { ...line, layout: { ...line.layout, overflow: true } };
}

// Which rows lead (hold an emphasised word index of `lead`), or null when none or all do: then the fit picks the sizes.
function leadRows(rows, lead) {
  if (!(lead instanceof Set) || lead.size === 0) return null;
  const flags = rows.map((row) => row.some((i) => lead.has(i)));
  return flags.some(Boolean) && !flags.every(Boolean) ? flags : null;
}

// The block's height: each line's ink plus the gaps between them.
const blockHeight = (lines) => lines.reduce((sum, l, k) => sum + l.ink.up + l.ink.down + (k === 0 ? 0 : STACK.gap * Math.max(l.font.size, lines[k - 1].font.size)), 0);

// The kicker tag's plate height (the tag device sizes itself from its text), or 0 without a kicker.
export function kickerHeight(shot, ctx) {
  if (shot.kicker === undefined) return 0;
  requireDevice(ctx.look, 'tag', 'statement');
  const probe = registries.devices.get('tag').build({ id: 'probe', text: shot.kicker, box: [0, 0, 1, 1], at: 0, look: ctx.look, unit: ctx.unit, seed: ctx.seed, measure: ctx.measure });
  return probe.boxes.tag[3];
}

// Lines fill the width by size only, never stretched, at two sizes: the smallest fitted size and look.stack.ratio times
// it (a line that would grow past that is set at it, still flush left). With `lead` (the emphasised word indexes of a
// look whose emphasis leads, poster's `scale`), the rows holding one take the large size, at most what each fits, and
// every other row the small one: at most what each fits and never more than the large size over the ratio, so the
// emphasised row reads larger even when it is the widest (the viral hook).
export function keepRatio(lines, rows, words, ctx, lead) {
  const ratio = ctx.look.stack?.ratio;
  if (!Number.isFinite(ratio) || lines.length < 2) return lines;
  // two sizes (look review 2: line-by-line fitting read as auto-fit): the smallest fitted size, and the ratio times it
  // for every line that fits that large
  const small = Math.min(...lines.map((l) => l.font.size));
  const leads = leadRows(rows, lead);
  if (leads !== null) {
    const fits = (flag) => Math.min(...lines.filter((_, k) => leads[k] === flag).map((l) => l.font.size));
    const large = Math.min(fits(true), fits(false) * ratio);
    const rest = Math.min(fits(false), large / ratio);
    return lines.map((line, k) => lineAt(rows[k].map((i) => bare(words[i])), leads[k] ? large : rest, ctx));
  }
  const hero = small * ratio;
  return lines.map((line, k) => lineAt(rows[k].map((i) => bare(words[i])), line.font.size >= hero - EPSILON ? hero : small, ctx));
}


const HOOK_MAX_WORDS = 4; // a hook this short may be set a word a line
const HOOK_WRAP_MAX_WORDS = 10; // a wrapping hook (look.stack.hookWrap) tries every set of rows up to this many words
const SHORT_ALONE = 4; // letters: a word this short never gets a line to itself when a stack grows
const CEILING_STEPS = 20; // bisection steps for a hook's size ceiling: well under a pixel

// Every way to break `count` words into rows in order (word indexes per row) with no row but the last ending on a weak
// word (breaks.mjs isWeakEnd).
function wordRows(plain, before = new Set()) {
  const sets = [];
  const grow = (from, rows) => {
    if (from === plain.length) { sets.push(rows); return; }
    for (let to = from + 1; to <= plain.length; to++) {
      if (to < plain.length && isWeakEnd(plain[to - 1]) && !before.has(to)) continue;
      grow(to, [...rows, Array.from({ length: to - from }, (_, k) => from + k)]);
    }
  };
  grow(0, []);
  return sets;
}

// The row sets a hook is tried in: with look.stack.hookWrap (poster: the viral hook is the film's biggest type, filled
// by size and wrapped by words; gate-poster-tall render 1 set a six-word hook in its own two rows, the second under the
// floor) every set wordRows allows; else the stack's own rows and, for a short hook, a word a line.
function hookCandidates(words, own, ctx, lead) {
  const plain = words.map(bare);
  // look.stack.hookLead (poster, gate-poster-1 ruling 4): a row may end on a weak word just before an emphasised word,
  // so the starred word takes a row of its own at the large size ("WRITE THE / SCRIPT.")
  const before = ctx.look.stack?.hookLead === true && lead instanceof Set ? lead : new Set();
  // the lead's ruling: only where the next row is the emphasised word alone
  const alone = (rows, k) => !isWeakEnd(plain[rows[k].at(-1)]) || rows[k + 1].every((i) => before.has(i));
  if (ctx.look.stack?.hookWrap === true && words.length <= HOOK_WRAP_MAX_WORDS) return wordRows(plain, before).filter((rows) => rows.slice(0, -1).every((_, k) => alone(rows, k)));
  if (words.length > HOOK_MAX_WORDS || plain.slice(0, -1).some(isWeakEnd)) return null;
  return [own.rows, words.map((_, i) => [i])];
}

// The better of two hook sets in `area` with the stack's floor `min`: a set whose every line fits at or over the floor,
// then the larger smallest line (the hook set as large as it goes), then the larger largest line, then the fewer rows
// (no more wrapping than the size needs). A line wider than the area counts at the size that would fit it (fitLine
// clamps it to the floor, which would rank a one-row set of the whole hook above every wrap).
function betterHook(area, min) {
  const sizes = ({ lines }) => lines.map((l) => l.font.size * Math.min(1, area.w / l.width));
  const clean = (set) => sizes(set).every((s) => s >= min - EPSILON);
  return (a, b) => {
    if (clean(a) !== clean(b)) return clean(b) ? b : a;
    const [smallA, smallB] = [Math.min(...sizes(a)), Math.min(...sizes(b))];
    if (Math.abs(smallA - smallB) > EPSILON) return smallB > smallA ? b : a;
    const [largeA, largeB] = [Math.max(...sizes(a)), Math.max(...sizes(b))];
    if (Math.abs(largeA - largeB) > EPSILON) return largeB > largeA ? b : a;
    return b.rows.length < a.rows.length ? b : a;
  };
}

// A hook (a viral film's first statement) may be set in other rows when that sets it larger (hookCandidates), each set
// kept to look.stack.hook of the area's height.
function hookLines(words, own, fitted, area, ctx, lead) {
  const share = ctx.look.stack?.hook;
  const plain = words.map(bare);
  const forced = words.some((w) => w.endsWith(FORCE_MARK));
  const sets = Number.isFinite(share) && words.length >= 2 && !forced ? hookCandidates(words, own, ctx, lead) : null;
  if (sets === null) return own;
  const limit = share * area.h;
  // too tall: the largest lines come down first (a ceiling), and only when every line is at the ceiling all shrink
  const within = (lines, rows) => {
    if (blockHeight(lines) <= limit) return lines;
    const capped = (c) => rows.map((row, k) => (lines[k].font.size <= c ? lines[k] : lineAt(row.map((i) => plain[i]), c, ctx)));
    let low = Math.min(...lines.map((l) => l.font.size)), high = Math.max(...lines.map((l) => l.font.size));
    const floor = capped(low);
    if (blockHeight(floor) > limit) return rows.map((row, k) => lineAt(row.map((i) => plain[i]), floor[k].font.size * (limit / blockHeight(floor)), ctx));
    for (let i = 0; i < CEILING_STEPS; i++) {
      const mid = (low + high) / HALF;
      if (blockHeight(capped(mid)) <= limit) low = mid;
      else high = mid;
    }
    return capped(low);
  };
  const setOf = (rows) => ({ rows, lines: within(rows === own.rows ? own.lines : fitted(rows), rows) });
  if (ctx.look.stack?.hookWrap === true) return sets.map(setOf).reduce(betterHook(area, sizeAt(ctx.look, STACK.fromStep, ctx.unit)));
  const smallest = ({ lines }) => Math.min(...lines.map((l) => l.font.size));
  return sets.map(setOf).reduce((best, c) => (smallest(c) > smallest(best) + EPSILON ? c : best));
}

// A stack shorter than look.stack.grow of its area is broken finer: each line of more than one word is split by sense
// (stackLines on its own words, else in two), one pass at a time, until the block reaches the share, a word sits on
// each line, or the next set would be too tall for the area (look review 2: type fills the width, then the height).
function grownLines(words, own, fitted, area, ctx) {
  const share = ctx.look.stack?.grow;
  if (!Number.isFinite(share) || isWide(ctx.canvas)) return own; // a wide frame has the height already
  let best = own;
  for (let pass = 0; pass < words.length && blockHeight(best.lines) < share * area.h; pass++) {
    const rows = best.rows.flatMap((row) => (row.length < HALF ? [row] : splitRow(row, words)));
    if (rows.length === best.rows.length) break;
    const lines = fitted(rows);
    if (blockHeight(lines) > area.h) break;
    best = { rows, lines };
  }
  return best;
}

// A row of word indexes in two or more by sense (stackLines on its own words), else in two at its middle; kept whole
// when a part would end on a weak word (breaks.mjs isWeakEnd) or be one short word alone.
function splitRow(row, words) {
  const plain = (i) => bare(words[i]);
  const short = (part) => part.length === 1 && plain(part[0]).replace(/[^\p{L}\p{N}]/gu, '').length <= SHORT_ALONE;
  const valid = (parts) => !parts.some(short) && !parts.slice(0, -1).some((part) => isWeakEnd(plain(part.at(-1))));
  const sub = stackLines(row.map((i) => words[i])).map((r) => r.map((j) => row[j]));
  if (sub.length > 1 && valid(sub)) return sub;
  // else the first two-way cut, from the middle outward, that leaves no short word alone and no weak line end
  const middle = Math.ceil(row.length / HALF);
  const cuts = Array.from({ length: row.length - 1 }, (_, k) => k + 1).sort((a, b) => Math.abs(a - middle) - Math.abs(b - middle));
  const cut = cuts.find((c) => valid([row.slice(0, c), row.slice(c)]));
  return cut === undefined ? [row] : [row.slice(0, cut), row.slice(cut)];
}

/**
 * Where a block `height` tall starts in `area`: on a tall frame its middle on look.stack.centre of the area (its
 * optical centre), kept inside it; on a wide frame, and in a look without one, its middle on the area's middle.
 */
export function centredTop(area, height, ctx) {
  const centre = isWide(ctx.canvas) ? 1 / HALF : ctx.look.stack?.centre ?? 1 / HALF;
  const middle = area.top + (area.h - height) / HALF;
  const optical = area.top + centre * area.h - height / HALF;
  // a block that would meet the area's edge on the optical centre keeps the middle: a pulse or a punch about its
  // centre then grows evenly into the slack above and below (and an overflow is shared)
  return optical < area.top || optical + height > area.top + area.h ? middle : optical;
}

// Does an upright block `height` tall leave a tall frame's area short of the look's turn share (look.stack.turn)? A
// look without the share never turns.
function shortOnTall(height, area, ctx) {
  const share = ctx.look.stack?.turn;
  return Number.isFinite(share) && !isWide(ctx.canvas) && height < share * area.h;
}

/** The stack laid out: { rows (word indexes per line), lines [{ font, layout, ink, x, baseline }], area, kicker } . */
// `lead`: the word indexes whose rows take the large size (keepRatio); `widen`: a stretch keyword a one-line stack is
// measured at, so its emphasised word can step to it (poster's scale emphasis)
// `turn`: the caller (a statement) allows the turned stack (stack-turn.mjs) when the look's stack.turn share asks for it
export function composeStack(text, shot, ctx, area = stackArea(ctx), { hook = false, maxSize = Infinity, lead, widen, turn = false } = {}) {
  const { look, unit } = ctx;
  const words = markedWords(text);
  const limits = { min: sizeAt(look, STACK.fromStep, unit), max: Math.min(STACK.max * unit, maxSize) };
  const fitted = (rows) => keepRatio(rows.map((row) => fitLine(row.map((i) => bare(words[i])), area.w, limits, ctx)), rows, words, ctx, lead);
  let rows = stackLines(words);
  let lines = fitted(rows);
  if (hook) ({ rows, lines } = hookLines(words, { rows, lines }, fitted, area, ctx, lead));
  else ({ rows, lines } = grownLines(words, { rows, lines }, fitted, area, ctx));
  if (widen !== undefined && rows.length === 1) lines = [fitLine(rows[0].map((i) => bare(words[i])), area.w, limits, ctx, { width: widen })];
  const tag = kickerHeight(shot, ctx);
  const above = tag === 0 ? 0 : tag + STACK.kickerGap * unit;
  for (let i = 0; i < SHRINK_PASSES && blockHeight(lines) + above > area.h; i++) {
    const share = (area.h - above) / blockHeight(lines);
    lines = rows.map((row, k) => lineAt(row.map((j) => bare(words[j])), lines[k].font.size * share, ctx, lines[k].layout.reserve));
  }
  // set smaller than scale step 3 to fit the height, a line no longer reads as a stack: it says so, as a statement
  // that cannot fit does (the review's overflow finding tells the director to cut words); so does a line still wider
  // than the area (a long word at the floor), whose fit flag the ratio, hook and shrink passes rebuild it without
  const tooWide = (line) => line.width > area.w + WIDTH_TOLERANCE;
  lines = lines.map((line) => (line.font.size < limits.min || tooWide(line) ? { ...line, layout: { ...line.layout, overflow: true } } : line));
  // never a hook: a viral film's first statement opens upright on frame 0 (looks-four Task 7 round three ruling)
  if (turn && !hook && shortOnTall(blockHeight(lines) + above, area, ctx)) {
    const turned = turnedStack(words, shot, ctx, area, { lead });
    if (turned !== null) return turned;
  }
  let top = centredTop(area, blockHeight(lines) + above, ctx) + above;
  const placed = lines.map((line, k) => {
    if (k > 0) top += STACK.gap * Math.max(line.font.size, lines[k - 1].font.size);
    const baseline = top + line.ink.up;
    top = baseline + line.ink.down;
    return { ...line, x: area.left - line.ink.left, baseline };
  });
  const kicker = tag === 0 ? null : { top: placed[0].baseline - placed[0].ink.up - STACK.kickerGap * unit - tag, left: area.left };
  return { rows, lines: placed, area, kicker };
}

// A word's tracks: lit from a ghost when spoken (a mode that reads from frame 0), or fading in on its time; an emphasised
// word turns accent. `matched`: the hero arrived on a match cut and is on screen already. A look whose emphasis keeps the
// colour (poster's scale) recolours nothing; a look whose hook opens at full ink (look.hookInk) shows every word in ink
// from frame 0 instead of a ghost; a look that opens composed (opensSet) sets every word from frame 0. `widen`: the
// keyword an emphasised word steps to on its beat (its line is measured at it).
function wordTracks(look, time, flags) {
  const tracks = baseWordTracks(look, time, flags);
  const { bar } = flags; // a highlight bar lands under this word at `bar` (look.devices.highlight.text): the word takes the bar's text colour
  if (bar === undefined) return tracks;
  const to = colourOf(look, look.devices.highlight.text);
  // half way through the bar's wipe (it lands on `bar`): the bar is under the word by the time its colour is the bar's text
  const from = Math.max(0, bar - look.moves.draw.dur / 2);
  return { ...tracks, fill: track([{ t: 0, v: look.palette.ink }, { t: from, v: look.palette.ink }, { t: from + look.moves.emphasize.dur, v: to, ease: FILL_EASE }]) };
}

function baseWordTracks(look, { at, emphasised }, { ghost, matched, widen }) {
  const keeps = emphasisFlags(look).keepsColour === true;
  const lit = emphasised && !keeps ? look.palette.accent : look.palette.ink;
  const turn = (from) => track([{ t: 0, v: from }, { t: at, v: from }, { t: at + look.moves.emphasize.dur, v: lit, ease: FILL_EASE }]);
  const step = emphasised && widen !== undefined ? { width: track(at > 0 ? [{ t: 0, v: look.fonts.display.width }, { t: at, v: widen }] : [{ t: 0, v: widen }]) } : {};
  if (ghost && look.hookInk) return step;
  if (ghost) return ghostTracks(look, at, lit);
  const tracks = matched || opensSet(look) ? {} : { opacity: landing(at, look.moves.enter, 0, 1) };
  return emphasised && !keeps ? { ...tracks, fill: turn(look.palette.ink) } : { ...tracks, ...step };
}

/**
 * The stack's nodes: the hero group of line nodes, the kicker tag (or nothing), and the targets' boxes.
 * @param {{ times: { at: number, emphasised: boolean }[], ghost: boolean, matched: boolean, hero: string, bars?: Map<number, number> }} opts
 *   times: per word index, when it is spoken and whether it is emphasised
 *   bars: word index -> the time a highlight bar lands under it; the word takes the look's bar text colour from then
 */
export function stackNodes(shot, ctx, placed, { times, ghost, matched, hero, bars = new Map() }) {
  const { look, unit, seed, measure } = ctx;
  const boxes = [];
  const children = placed.lines.map((line, k) => {
    const row = placed.rows[k];
    const y = line.baseline - line.layout.lines[0].y;
    line.layout.lines[0].words.forEach((w, j) => {
      const ink = inkExtent(w.text, line.font, measure); // the box a word's glyphs cover, so a flush edge is the ink's
      boxes[row[j]] = line.turn === undefined ? capBox(line.x + w.x + ink.left, line.baseline, ink.right - ink.left, line.font.size) : turnedWordBox(line, w, ink);
    });
    const widen = line.layout.reserve?.width;
    // a turned line (stack-turn.mjs) is placed by its layout's top-left corner and turned about it
    const at = line.turn === undefined ? { x: line.x, y } : { x: line.turn.x, y: line.turn.y, rotate: line.turn.rotate };
    return node('text', `${hero}.line${k}`, { ...at, layout: line.layout, font: line.font, fill: look.palette.ink, role: 'hero', stack: hero }, {
      wordTracks: row.map((i) => wordTracks(look, times[i], { ghost, matched, widen, bar: bars.get(i) })),
    });
  });
  const group = node('group', hero, {}, { children });
  const kicker = placed.kicker === null ? [] : registries.devices.get('tag').build({
    // set on the shot's first frame in a look whose shots open set (poster: gate-poster-1 ruling 7, chips not faded in)
    id: `${shot.id}.kicker`, text: shot.kicker, box: [placed.kicker.left, placed.kicker.top, 1, 1], at: opensSet(look) ? 0 : look.moves.enter.dur, look, unit, seed, measure,
  }).nodes;
  return { group, kicker, boxes: Object.fromEntries([['text', unionBox(boxes)], ...boxes.map((box, i) => [`word:${i}`, box])]) };
}

// ---- a stack set again with room above and below it (end, list, quote, compare) ----

// One display line of `text` at `size` (lineAt with the text as its one word list).
const textLine = (text, size, ctx) => lineAt([text], size, ctx);

const lineText = (line) => line.layout.lines[0].words.map((w) => w.text).join(' ');
const lineGap = (a, b) => STACK.gap * Math.max(a.font.size, b.font.size);

/**
 * A composed stack (stack.mjs composeStack) set again with room kept `above` its tag (or first line) and `below` its last
 * line, in px: its lines set smaller in proportion when stack, tag and room do not fit the stack's area (a line under
 * scale step 3 says so, overflow: true, as composeStack does), and the whole, room included, centred in the area.
 */
export function restack(placed, ctx, { above = 0, below = 0 }) {
  const { area } = placed;
  const first = placed.lines[0];
  const tag = placed.kicker === null ? 0 : first.baseline - first.ink.up - placed.kicker.top; // the tag and its gap
  const min = sizeAt(ctx.look, STACK.fromStep, ctx.unit);
  const room = Math.max(1, area.h - tag - above - below); // never zero: the lines then shrink to the floor and say so
  let lines = placed.lines;
  for (let i = 0; i < FIT_PASSES && blockHeight(lines) > room + EPSILON; i++) {
    const share = room / blockHeight(lines);
    lines = lines.map((line) => {
      const next = textLine(lineText(line), line.font.size * share, ctx);
      return next.font.size < min ? { ...next, layout: { ...next.layout, overflow: true } } : next;
    });
  }
  let top = centredTop(area, blockHeight(lines) + tag + above + below, ctx) + above + tag;
  const out = lines.map((line, k) => {
    if (k > 0) top += lineGap(line, lines[k - 1]);
    const baseline = top + line.ink.up;
    top = baseline + line.ink.down;
    return { ...line, x: area.left - line.ink.left, baseline };
  });
  const kicker = placed.kicker === null ? null : { ...placed.kicker, top: out[0].baseline - out[0].ink.up - tag };
  return { ...placed, lines: out, kicker };
}

/** One line fitted so its ink fills `width`, between `min` and `max` px; one still too wide at `min` says so (overflow). */
export function fittedLine(text, width, { min, max }, ctx) {
  let line = textLine(text, max, ctx);
  for (let i = 0; i < FIT_PASSES; i++) {
    const size = Math.min(max, Math.max(min, (line.font.size * (width - FIT_SLACK)) / line.width));
    if (size === line.font.size) break;
    line = textLine(text, size, ctx);
  }
  return line.width <= width + WIDTH_TOLERANCE ? line : { ...line, layout: { ...line.layout, overflow: true } };
}
