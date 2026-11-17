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

// The block's height: each line's ink plus the gaps between them, `em` of the larger neighbour.
const blockHeight = (lines, em = STACK.gap) => lines.reduce((sum, l, k) => sum + l.ink.up + l.ink.down + (k === 0 ? 0 : em * Math.max(l.font.size, lines[k - 1].font.size)), 0);

// The gap between a stack's rows, in ems of the larger neighbour: look.stack.rowGap (poster, gate-poster-2 ruling 6: room
// for the beat bar's clear space, look.stack.beatPadY, without meeting the next row), else STACK.gap.
const rowGap = (look) => look.stack?.rowGap ?? STACK.gap;

/** The clear space a beat bar keeps above and below `line`'s ink (look.stack.beatPadY ems), px; 0 without the beat. */
export const beatPad = (look, line) => (look.stack?.beat === 'bar' ? (look.stack.beatPadY ?? 0) * line.font.size : 0);

// The kicker tag's plate height (the tag device sizes itself from its text), or 0 without a kicker.
export function kickerHeight(shot, ctx) {
  if (shot.kicker === undefined) return 0;
  requireDevice(ctx.look, 'tag', 'statement');
  const probe = registries.devices.get('tag').build({ id: 'probe', text: shot.kicker, box: [0, 0, 1, 1], at: 0, look: ctx.look, unit: ctx.unit, seed: ctx.seed, measure: ctx.measure, ...kickerSized(shot) });
  return probe.boxes.tag[3];
}

// the kicker tag's size when the caller sets one (shot.kickerSize, px: a poster compare's side tag at its points' size)
const kickerSized = (shot) => (shot.kickerSize === undefined ? {} : { size: shot.kickerSize });

// Lines fill the width by size only, never stretched, at two sizes: the smallest fitted size and look.stack.ratio times
// it (a line that would grow past that is set at it, still flush left). With `lead` (the emphasised word indexes of a
// look whose emphasis leads, poster's `scale`), the rows holding one take the large size, at most what each fits, and
// every other row the small one: at most what each fits and never more than the large size over the ratio, so the
// emphasised row reads larger even when it is the widest (the viral hook).
export function keepRatio(lines, rows, words, ctx, lead, ratio = ctx.look.stack?.ratio) {
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
const WIDTH_SHARE_TIE = 0.02; // two row sets whose narrowest rows are this close in width share tie on width

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
// `largeFirst` (a look with stack.hookRatio: one word dominates): the larger largest line ranks before the smallest.
// `widthFirst` (a justified fill, look.stack.justify): the set whose narrowest row takes more of the width ranks first, so
// the rows run edge to edge before the stack grows by size.
function betterHook(area, min, largeFirst = false, widthFirst = false) {
  const sizes = ({ lines }) => lines.map((l) => l.font.size * Math.min(1, area.w / l.width));
  const clean = (set) => sizes(set).every((s) => s >= min - EPSILON);
  const narrowest = ({ lines }) => Math.min(...lines.map((l) => Math.min(1, l.width / area.w)));
  const byWidth = (a, b) => (Math.abs(narrowest(a) - narrowest(b)) > WIDTH_SHARE_TIE ? (narrowest(b) > narrowest(a) ? b : a) : null);
  const bySmall = (a, b) => {
    const [smallA, smallB] = [Math.min(...sizes(a)), Math.min(...sizes(b))];
    return Math.abs(smallA - smallB) > EPSILON ? (smallB > smallA ? b : a) : null;
  };
  const byLarge = (a, b) => {
    const [largeA, largeB] = [Math.max(...sizes(a)), Math.max(...sizes(b))];
    return Math.abs(largeA - largeB) > EPSILON ? (largeB > largeA ? b : a) : null;
  };
  const order = [...(widthFirst ? [byWidth] : []), ...(largeFirst ? [byLarge, bySmall] : [bySmall, byLarge])];
  return (a, b) => {
    if (clean(a) !== clean(b)) return clean(b) ? b : a;
    for (const rank of order) {
      const won = rank(a, b);
      if (won !== null) return won;
    }
    return b.rows.length < a.rows.length ? b : a;
  };
}

// A hook (a viral film's first statement) may be set in other rows when that sets it larger (hookCandidates), each set
// kept to look.stack.hook of the area's height.
// `min`: the floor a clean set's lines keep; `largeFirst`: rank by the dominant word first (betterHook).
function hookLines(words, own, fitted, area, ctx, lead, { min = sizeAt(ctx.look, STACK.fromStep, ctx.unit), largeFirst = false, widthFirst = false } = {}) {
  const share = ctx.look.stack?.hook;
  const plain = words.map(bare);
  const forced = words.some((w) => w.endsWith(FORCE_MARK));
  const sets = Number.isFinite(share) && words.length >= 2 && !forced ? hookCandidates(words, own, ctx, lead) : null;
  if (sets === null) return own;
  const limit = share * area.h;
  const em = rowGap(ctx.look);
  // too tall: the largest lines come down first (a ceiling), and only when every line is at the ceiling all shrink
  const within = (lines, rows) => {
    if (blockHeight(lines, em) <= limit) return lines;
    const capped = (c) => rows.map((row, k) => (lines[k].font.size <= c ? lines[k] : lineAt(row.map((i) => plain[i]), c, ctx)));
    let low = Math.min(...lines.map((l) => l.font.size)), high = Math.max(...lines.map((l) => l.font.size));
    const floor = capped(low);
    if (blockHeight(floor, em) > limit) return rows.map((row, k) => lineAt(row.map((i) => plain[i]), floor[k].font.size * (limit / blockHeight(floor, em)), ctx));
    for (let i = 0; i < CEILING_STEPS; i++) {
      const mid = (low + high) / HALF;
      if (blockHeight(capped(mid), em) <= limit) low = mid;
      else high = mid;
    }
    return capped(low);
  };
  const setOf = (rows) => ({ rows, lines: within(rows === own.rows ? own.lines : fitted(rows), rows) });
  if (ctx.look.stack?.hookWrap === true) return sets.map(setOf).reduce(betterHook(area, min, largeFirst, widthFirst));
  const smallest = ({ lines }) => Math.min(...lines.map((l) => l.font.size));
  return sets.map(setOf).reduce((best, c) => (smallest(c) > smallest(best) + EPSILON ? c : best));
}

// A stack shorter than look.stack.grow of its area is broken finer: each line of more than one word is split by sense
// (stackLines on its own words, else in two), one pass at a time, until the block reaches the share, a word sits on
// each line, or the next set would be too tall for the area (look review 2: type fills the width, then the height).
function grownLines(words, own, fitted, area, ctx) {
  const share = ctx.look.stack?.grow;
  if (!Number.isFinite(share) || isWide(ctx.canvas)) return own; // a wide frame has the height already
  const em = rowGap(ctx.look);
  let best = own;
  for (let pass = 0; pass < words.length && blockHeight(best.lines, em) < share * area.h; pass++) {
    const rows = best.rows.flatMap((row) => (row.length < HALF ? [row] : splitRow(row, words)));
    if (rows.length === best.rows.length) break;
    const lines = fitted(rows);
    if (blockHeight(lines, em) > area.h) break;
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
// look without the share never turns, nor does a look whose look.stack.turnSafe is false where it composes in a platform
// safe zone (poster, gate-poster-2 ruling 2: a feed reads upright, turned type stays a pro composition).
function shortOnTall(height, area, ctx) {
  const share = ctx.look.stack?.turn;
  if (uprightOnly(ctx)) return false;
  return Number.isFinite(share) && !isWide(ctx.canvas) && height < share * area.h;
}

/** Does the look keep its stacks upright here (look.stack.turnSafe false, in a platform mode's safe zone)? */
export const uprightOnly = (ctx) => ctx.look.stack?.turnSafe === false && ctx.mode?.platformSafeZone === true;

/** The stack laid out: { rows (word indexes per line), lines [{ font, layout, ink, x, baseline }], area, kicker } . */
// `lead`: the word indexes whose rows take the large size (keepRatio); `widen`: a stretch keyword a one-line stack is
// measured at, so its emphasised word can step to it (poster's scale emphasis)
// `turn`: the caller (a statement) allows the turned stack (stack-turn.mjs) when the look's stack.turn share asks for it
// `cap` (units): the largest a line may be set, in place of STACK.max (a compare title on a wide frame, poster)
export function composeStack(text, shot, ctx, area = stackArea(ctx), { hook = false, maxSize = Infinity, lead, widen, turn = false, cap = STACK.max } = {}) {
  const { look, unit } = ctx;
  const words = markedWords(text);
  const em = rowGap(look);
  // look.stack.hookRatio and hookFloor (poster, gate-poster-2 ruling 1): in a hook with an emphasised word that word's row
  // is set as large as the width allows and the other rows hookRatio smaller, down to scale step hookFloor (one word
  // dominates; at the stack's ratio and floor the starred row read 1.35 times the others)
  const dominant = hook && Number.isFinite(look.stack?.hookRatio) && lead instanceof Set && lead.size > 0;
  // a stack that may not turn where it would (uprightOnly) fills its tall area by the hook's row search instead
  const fills = hook || (turn && uprightOnly(ctx) && !isWide(ctx.canvas) && words.length <= HOOK_WRAP_MAX_WORDS);
  // look.stack.justify (poster, gate-poster-2 ruling 6): a fill with no emphasised word sets each row at the size that
  // runs it edge to edge (the review counts a stack's lines as one size), up to justifyCap units, and the row set whose
  // narrowest row takes the most width wins (the 9:16 close and list rows left 35 to 50 percent of the width empty)
  const justify = fills && !dominant && !(lead instanceof Set && lead.size > 0) && look.stack?.justify === true && !isWide(ctx.canvas);
  const top = justify && Number.isFinite(look.stack.justifyCap) ? look.stack.justifyCap : cap;
  const limits = { min: sizeAt(look, dominant ? look.stack.hookFloor ?? STACK.fromStep : STACK.fromStep, unit), max: Math.min(top * unit, maxSize) };
  const ratio = dominant ? look.stack.hookRatio : look.stack?.ratio;
  const fit = (rows) => rows.map((row) => fitLine(row.map((i) => bare(words[i])), area.w, limits, ctx));
  const fitted = justify ? fit : (rows) => keepRatio(fit(rows), rows, words, ctx, lead, ratio);
  let rows = stackLines(words);
  let lines = fitted(rows);
  if (fills) ({ rows, lines } = hookLines(words, { rows, lines }, fitted, area, ctx, lead, { min: limits.min, largeFirst: dominant, widthFirst: justify }));
  else ({ rows, lines } = grownLines(words, { rows, lines }, fitted, area, ctx));
  if (widen !== undefined && rows.length === 1) lines = [fitLine(rows[0].map((i) => bare(words[i])), area.w, limits, ctx, { width: widen })];
  const tag = kickerHeight(shot, ctx);
  // the kicker sits clear of a beat bar's pad over the first line too (beatPad)
  const kickerGap = STACK.kickerGap * unit + beatPad(look, lines[0]);
  const above = tag === 0 ? 0 : tag + kickerGap;
  for (let i = 0; i < SHRINK_PASSES && blockHeight(lines, em) + above > area.h; i++) {
    const share = (area.h - above) / blockHeight(lines, em);
    lines = rows.map((row, k) => lineAt(row.map((j) => bare(words[j])), lines[k].font.size * share, ctx, lines[k].layout.reserve));
  }
  // set smaller than scale step 3 to fit the height, a line no longer reads as a stack: it says so, as a statement
  // that cannot fit does (the review's overflow finding tells the director to cut words); so does a line still wider
  // than the area (a long word at the floor), whose fit flag the ratio, hook and shrink passes rebuild it without
  const tooWide = (line) => line.width > area.w + WIDTH_TOLERANCE;
  lines = lines.map((line) => (line.font.size < limits.min || tooWide(line) ? { ...line, layout: { ...line.layout, overflow: true } } : line));
  // never a hook: a viral film's first statement opens upright on frame 0 (looks-four Task 7 round three ruling)
  if (turn && !hook && shortOnTall(blockHeight(lines, em) + above, area, ctx)) {
    const turned = turnedStack(words, shot, ctx, area, { lead });
    if (turned !== null) return turned;
  }
  // look.stack.spread (poster, gate-poster-2 ruling 1): a filled tall stack (the hook, an upright fill) is spaced down
  // its whole area, row gaps opened evenly, so a dominant word with smaller rows round it still fills the frame
  // (in a platform mode only: a pro 9:16 close spread to its band's foot put its ask past the review's safe area)
  const spread = fills && uprightOnly(ctx) && Number.isFinite(look.stack?.spread) && lines.length > 1;
  const placed = spread ? spreadRows(lines, area.top + above, area.h - above, look.stack.spread * area.h, area, em) : placeRows(lines, centredTop(area, blockHeight(lines, em) + above, ctx) + above, area, undefined, em);
  const kicker = tag === 0 ? null : { top: placed[0].baseline - placed[0].ink.up - kickerGap - tag, left: area.left };
  return { rows, lines: placed, area, kicker, ...(spread ? { spread: look.stack.spread } : {}) };
}

// Lines placed flush left from `top`, `em` of the larger neighbour apart (rowGap), or `gaps` px apart when given (one per
// pair of rows).
function placeRows(lines, top, area, gaps, em = STACK.gap) {
  let y = top;
  return lines.map((line, k) => {
    if (k > 0) y += gaps?.[k - 1] ?? em * Math.max(line.font.size, lines[k - 1].font.size);
    const baseline = y + line.ink.up;
    y = baseline + line.ink.down;
    return { ...line, x: area.left - line.ink.left, baseline };
  });
}

// Lines spaced down `room` px from `top`: each gap the stack's own for its pair (`em` of the larger neighbour) plus one
// even share of the room left, at most `most` px unless its own is more; a block that cannot fill it is centred in it.
// (One gap for every pair, the largest pair's own, ran rows of very different sizes, a justified stack, past the room.)
function spreadRows(lines, top, room, most, area, em = STACK.gap) {
  // the last line's layout box below its ink stays inside the room too (its descent: nothing set below the band's foot)
  const last = lines.at(-1);
  room -= Math.max(0, last.layout.height - last.layout.lines[0].y - last.ink.down);
  const ink = lines.reduce((sum, l) => sum + l.ink.up + l.ink.down, 0);
  const least = lines.slice(1).map((l, k) => em * Math.max(l.font.size, lines[k].font.size));
  const extra = Math.max(0, (room - ink - least.reduce((sum, g) => sum + g, 0)) / (lines.length - 1));
  const gaps = least.map((g) => Math.min(Math.max(most, g), g + extra));
  const height = ink + gaps.reduce((sum, g) => sum + g, 0);
  return placeRows(lines, top + Math.max(0, (room - height) / HALF), area, gaps);
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
// `until`: when the last beat bar comes off (a compare side's at the turn), else it stays to the end
export function stackNodes(shot, ctx, placed, { times, ghost, matched, hero, bars = new Map(), until = Infinity }) {
  const { look, unit, seed, measure } = ctx;
  const boxes = [];
  const beats = beatWindows(placed, times, look, until);
  const beatOf = new Map(beats.map((b) => [b.k, b]));
  const lineNodes = placed.lines.map((line, k) => {
    const row = placed.rows[k];
    const y = line.baseline - line.layout.lines[0].y;
    line.layout.lines[0].words.forEach((w, j) => {
      const ink = inkExtent(w.text, line.font, measure); // the box a word's glyphs cover, so a flush edge is the ink's
      boxes[row[j]] = line.turn === undefined ? capBox(line.x + w.x + ink.left, line.baseline, ink.right - ink.left, line.font.size) : turnedWordBox(line, w, ink);
    });
    const widen = line.layout.reserve?.width;
    // a turned line (stack-turn.mjs) is placed by its layout's top-left corner and turned about it
    const at = line.turn === undefined ? { x: line.x, y } : { x: line.turn.x, y: line.turn.y, rotate: line.turn.rotate };
    const beat = beatOf.get(k);
    // a beat row is hidden while its bar and knockout copy (beatNodes) stand in for it
    return node('text', `${hero}.line${k}`, { ...at, layout: line.layout, font: line.font, fill: look.palette.ink, role: 'hero', stack: hero }, {
      wordTracks: row.map((i) => wordTracks(look, times[i], { ghost, matched, widen, bar: bars.get(i) })),
      ...(beat === undefined ? {} : { tracks: { opacity: stepped(1, 0, beat) } }),
    });
  });
  // the beat's bars and their knockout copies draw after every line, inside the hero group: a bar is then never under a
  // neighbouring line, which the contrast review would judge against it
  const beatNodes = beats.flatMap((b) => beatPair(`${hero}.beat${b.k}`, b, placed.rows[b.k].map((i) => boxes[i]), lineNodes[b.k], placed.lines[b.k], ctx));
  const group = node('group', hero, {}, { children: [...lineNodes, ...beatNodes] });
  const kicker = placed.kicker === null ? [] : registries.devices.get('tag').build({
    // set on the shot's first frame in a look whose shots open set (poster: gate-poster-1 ruling 7, chips not faded in)
    id: `${shot.id}.kicker`, text: shot.kicker, box: [placed.kicker.left, placed.kicker.top, 1, 1], at: opensSet(look) ? 0 : look.moves.enter.dur, look, unit, seed, measure, ...kickerSized(shot),
  }).nodes;
  return { group, kicker, boxes: Object.fromEntries([['text', unionBox(boxes)], ...boxes.map((box, i) => [`word:${i}`, box])]) };
}

// ---- the beat (look.stack.beat 'bar', poster: gate-poster-2 rulings 1 and 3, kinetic type) ----

// A cut-paper bar under the row being spoken: it lands under the first row holding an emphasised word (else the first
// row) on that row's first spoken word, steps to each later row on its first word and stays on the last, so the frame at
// the end is never the frame at 0. Rows whose words are untimed (all at 0: a list item, a compare side) or turned get
// none. [{ k (row index), at, until }]
function beatWindows(placed, times, look, until = Infinity) {
  if (look.stack?.beat !== 'bar') return [];
  const rows = placed.rows.map((row, k) => ({ k, at: Math.min(...row.map((i) => times[i]?.at ?? 0)), lead: row.some((i) => times[i]?.emphasised === true) }))
    .filter((r) => r.at > 0 && r.at < until && placed.lines[r.k].turn === undefined);
  const live = rows.slice(Math.max(0, rows.findIndex((r) => r.lead)));
  // rows spoken at one time (a struck compare title) share it: only the last of them takes the bar
  return live.map((r, j) => ({ k: r.k, at: r.at, until: live[j + 1]?.at ?? until })).filter((w) => w.until > w.at);
}

// Hard steps on [at, until): `on` from at, `off` again from until (none when until is Infinity).
export const stepped =(off, on, { at, until }) => track([{ t: 0, v: off }, { t: at, v: off }, { t: at, v: on }, ...(Number.isFinite(until) ? [{ t: until, v: on }, { t: until, v: off }] : [])]);

// The beat for one row: the look's highlight bar (one builder, devices/highlight.mjs) round the row's word boxes,
// look.stack.beatPad units wider each side and the line's ink high, and a knockout copy of the row's line over it in the
// bar's text colour (look.devices.highlight.text), both on by a hard step on the row's first spoken word and off on the
// next row's: the row changes ground. [bar, copy]
export function beatPair(id, beat, rowBoxes, lineNode, line, ctx) {
  const { look, unit, seed } = ctx;
  const [x, , w] = unionBox(rowBoxes);
  // look.stack.beatPadY (ems of the line, gate-poster-2 ruling 6): clear space above the cap line and below the ink, so
  // the letters do not touch the bar's edges
  const padY = beatPad(look, line);
  const y = line.baseline - line.ink.up - padY, h = line.ink.up + line.ink.down + HALF * padY;
  const padX = (look.stack.beatPad ?? 0) * unit;
  const built = registries.devices.get('highlight').build({ id, box: [x - padX, y, w + HALF * padX, h], at: beat.at, look, unit, seed }).nodes[0];
  const on = { opacity: stepped(0, 1, beat) };
  const bar = node('path', id, built.props, { tracks: on });
  const wordTracks = lineNode.wordTracks.map(({ fill, ...rest }) => rest); // the copy keeps the words' moves, not their colour
  // the copy stands in for its row while the bar is under it (`beatOf`: that row's line), in the stack's size class
  const copy = node('text', `${id}.text`, { ...lineNode.props, fill: colourOf(look, look.devices.highlight.text), beatOf: lineNode.id }, { wordTracks, tracks: on });
  return [bar, copy];
}

// ---- a stack set again with room above and below it (end, list, quote, compare) ----

// One display line of `text` at `size` (lineAt with the text as its one word list).
const textLine = (text, size, ctx) => lineAt([text], size, ctx);

const lineText = (line) => line.layout.lines[0].words.map((w) => w.text).join(' ');

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
  const em = rowGap(ctx.look);
  const room = Math.max(1, area.h - tag - above - below); // never zero: the lines then shrink to the floor and say so
  let lines = placed.lines;
  for (let i = 0; i < FIT_PASSES && blockHeight(lines, em) > room + EPSILON; i++) {
    const share = room / blockHeight(lines, em);
    lines = lines.map((line) => {
      const next = textLine(lineText(line), line.font.size * share, ctx);
      return next.font.size < min ? { ...next, layout: { ...next.layout, overflow: true } } : next;
    });
  }
  // a spread stack (composeStack, look.stack.spread) is spaced down the room left to it
  const out = Number.isFinite(placed.spread) && lines.length > 1
    ? spreadRows(lines, area.top + above + tag, room, placed.spread * area.h, area, em)
    : placeRows(lines, centredTop(area, blockHeight(lines, em) + tag + above + below, ctx) + above + tag, area, undefined, em);
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
