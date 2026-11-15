// Browser-safe (no Node imports): lay text out as lines of positioned words, fit it to a box, and give counters
// a fixed numeral advance. Pure: the caller supplies `measure` (canvas in the page, a fake in tests).
import { breakBySense, FORCE_MARK, endsSentence } from './breaks.mjs';

// Digits with $ EUR GBP % , . and a unit suffix of up to 3 letters. Words are split on whitespace and never
// broken inside, so such a token always stays on one line.
export const NUMBER_TOKEN = /^[$€£]?\d[\d,.]*[%$€£]?[A-Za-z]{0,3}$/;
// A unit word after a NUMBER_TOKEN word ("1,204 ms") is kept on the number's line. Case-sensitive.
export const UNIT_WORDS = new Set(['ms', 's', '%', 'M', 'K', 'B', 'GB', 'MB', 'kg', 'km', 'px', 'fps', 'x']);
const TRAILING_PUNCTUATION = /[,.;:!?]+$/;

const DEFAULT_LINE_HEIGHT = 1.1;
const ALIGNMENTS = new Set(['left', 'center', 'right']);
const HANGING_GLYPHS = new Set(['"', "'", '“', '‘', '(', '[']);
const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
const FIT_EPSILON = 1e-6;
// fitText sets a text up to this much smaller than the largest size that fits, for a better layout (rankOf below).
const CLEAN_BREAK_SHARE = 0.85;

// A layout is not clean when a sentence ends inside a line ("file. Scripts") or a line ends between two words marked
// `together` (together[i]: keep word i with word i + 1; a statement marks its highlight runs this way).
function unclean(layout, together = []) {
  const midSentence = layout.lines.some((line) => line.words.slice(0, -1).some((w) => endsSentence(w.text)));
  return midSentence || layout.lines.slice(0, -1).some((line) => together[line.words.at(-1).index] === true);
}

// A line holding a single word, in a text of more than one line.
const hasLoneLine = (layout) => layout.lines.length > 1 && layout.lines.some((line) => line.words.length === 1);

// How many sentences run over more than one line (a sentence ends on a word that endsSentence, or at the text's end).
function splitSentences(layout) {
  let split = 0, firstLine = null;
  layout.lines.forEach((line, k) => line.words.forEach((w, j) => {
    firstLine ??= k;
    const last = k === layout.lines.length - 1 && j === line.words.length - 1;
    if (!endsSentence(w.text) && !last) return;
    if (k !== firstLine) split++;
    firstLine = null;
  }));
  return split;
}

// A fitting layout's rank, lower is better, compared in order: clean (no sentence ending mid-line, no break inside a
// `together` run), then accepted by the caller's own test (opts.accept, when given), then no line of one word, then the
// fewest sentences broken over lines (a short last sentence set as "Scripts do / the rest." when it fits whole a little
// smaller).
const rankOf = (layout, { together, accept }) => [
  unclean(layout, together) ? 1 : 0, accept === undefined || accept(layout) ? 0 : 1, hasLoneLine(layout) ? 1 : 0, splitSentences(layout),
];
const isBetter = (a, b) => {
  const k = a.findIndex((v, i) => v !== b[i]);
  return k >= 0 && a[k] < b[k];
};

function assertOptions({ font, maxWidth, align, measure }) {
  if (typeof measure !== 'function') throw new Error('layoutText: measure must be a function');
  if (!(Number.isFinite(maxWidth) && maxWidth > 0)) throw new Error(`layoutText: maxWidth must be a positive number, got ${maxWidth}`);
  if (!(Number.isFinite(font?.size) && font.size > 0)) throw new Error(`layoutText: font.size must be a positive number, got ${font?.size}`);
  if (!ALIGNMENTS.has(align)) throw new Error(`layoutText: align must be one of ${[...ALIGNMENTS].join(', ')}, got ${align}`);
}

// Split on whitespace. `word|` forces a break after the word; a lone `|` forces one after the previous word.
function tokenize(text) {
  const tokens = [];
  for (const raw of text.split(/\s+/)) {
    if (raw === '') continue;
    if (raw === FORCE_MARK) {
      if (tokens.length > 0) tokens[tokens.length - 1] = { ...tokens[tokens.length - 1], forced: true };
    } else if (raw.endsWith(FORCE_MARK)) {
      tokens.push({ text: raw.slice(0, -FORCE_MARK.length), forced: true });
    } else {
      tokens.push({ text: raw, forced: false });
    }
  }
  return tokens;
}

// Measured width of `text` plus tracking (em) per character.
function advanceOf(measure, font, text) {
  const m = measure(text, font);
  return { width: m.width + (font.tracking ?? 0) * font.size * [...text].length, ascent: m.ascent, descent: m.descent };
}

// keepWithNext[i]: word i is a number and word i+1 is its unit, so no break may fall between them.
function numberUnitPairs(tokens) {
  return tokens.map((t, i) => {
    const next = tokens[i + 1]?.text.replace(TRAILING_PUNCTUATION, '');
    return NUMBER_TOKEN.test(t.text) && UNIT_WORDS.has(next);
  });
}

function lineOffset(align, optical, maxWidth, width, firstWord, measure, font) {
  if (align === 'center') return (maxWidth - width) / 2;
  if (align === 'right') return maxWidth - width;
  const glyph = [...firstWord][0];
  return optical && HANGING_GLYPHS.has(glyph) ? -advanceOf(measure, font, glyph).width : 0;
}

function buildLine(row, ctx, y) {
  let x = 0;
  const words = row.map((index) => {
    const word = { text: ctx.tokens[index].text, index, x, width: ctx.widths[index] };
    x += ctx.widths[index] + ctx.spaceWidth;
    return word;
  });
  const width = x - ctx.spaceWidth;
  const start = lineOffset(ctx.align, ctx.optical, ctx.maxWidth, width, words[0].text, ctx.measure, ctx.font);
  return { x: start, y, width, words };
}

const emptyLayout = (font) => ({ size: font.size, width: 0, height: 0, lines: [], overflow: false });

/**
 * Lay text out in a box of `maxWidth`.
 * @param {{ text: string, font: object, maxWidth: number, align?: 'left'|'center'|'right', measure: Function, optical?: boolean, together?: boolean[], accept?: Function }} opts
 *   together (read by fitText only): together[i] asks to keep word i with word i + 1; fitText looks for a slightly
 *   smaller size whose layout keeps every such pair (see unclean). accept (read by fitText only): (layout) => boolean,
 *   the caller's own test, ranked right after cleanliness (rankOf)
 * @returns {{ size: number, width: number, height: number, lines: object[], overflow: boolean }}
 */
export function layoutText({ text, font, maxWidth, align = 'left', measure, optical = false }) {
  assertOptions({ font, maxWidth, align, measure });
  const tokens = tokenize(text);
  if (tokens.length === 0) return emptyLayout(font);
  const metrics = tokens.map((t) => advanceOf(measure, font, t.text));
  const widths = metrics.map((m) => m.width);
  // A font may set its own word space in em (a condensed caps face whose measured space runs words together).
  const spaceWidth = font.wordSpace === undefined ? advanceOf(measure, font, ' ').width : font.wordSpace * font.size;
  const marked = tokens.map((t) => (t.forced ? t.text + FORCE_MARK : t.text));
  const rows = breakBySense(marked, widths, spaceWidth, maxWidth, numberUnitPairs(tokens));
  const ascent = Math.max(...metrics.map((m) => m.ascent));
  const descent = Math.max(...metrics.map((m) => m.descent));
  const pitch = (font.lineHeight ?? DEFAULT_LINE_HEIGHT) * font.size;
  const ctx = { tokens, widths, spaceWidth, align, optical, maxWidth, measure, font };
  const lines = rows.map((row, i) => buildLine(row, ctx, ascent + i * pitch));
  return {
    size: font.size,
    width: Math.max(...lines.map((l) => l.width)),
    height: (lines.length - 1) * pitch + ascent + descent,
    lines,
    overflow: false,
  };
}

/**
 * The largest whole-number font size in [min, max] whose layout fits the box (height, optional line count, and
 * no word wider than maxWidth), traded down to CLEAN_BREAK_SHARE of it for a better layout: the largest size there
 * whose layout ranks best (rankOf: clean first, so a sentence ending mid-line or a break between words marked
 * opts.together outranks the rest; then no line of one word; then the fewest sentences broken over lines), never below
 * limits.tradeFloor; with a tradeFloor, a layout that is still not clean (or not accepted) looks further down, to the
 * floor, for the largest clean and accepted one (a floor there is the hero ratio the caller must keep). If none fits, the layout at min, with
 * overflow: true.
 * @param {object} opts layoutText options; font.size is replaced by the search
 * @param {{ min: number, max: number, maxHeight: number, maxLines?: number, tradeFloor?: number }} limits
 */
export function fitText(opts, { min, max, maxHeight, maxLines = Infinity, tradeFloor = 0 }) {
  const low = Math.ceil(min);
  const high = Math.floor(max);
  if (!(Number.isFinite(low) && Number.isFinite(high) && low >= 1 && low <= high)) {
    throw new Error(`fitText: need 1 <= min <= max (whole sizes), got min ${min}, max ${max}`);
  }
  const at = (size) => layoutText({ ...opts, font: { ...opts.font, size } });
  const fits = (l) => l.height <= maxHeight + FIT_EPSILON && l.lines.length <= maxLines && l.width <= opts.maxWidth + FIT_EPSILON;
  for (let size = high; size > low; size--) {
    const layout = at(size);
    if (fits(layout)) return bestBelow(at, fits, layout, { low, tradeFloor, together: opts.together, accept: opts.accept });
  }
  const floor = at(low);
  return fits(floor) ? floor : { ...floor, overflow: true };
}

// The best-ranked layout from `top` (the largest that fits) down to CLEAN_BREAK_SHARE of its size, not below `low` or
// `tradeFloor`; of layouts that rank the same, the largest. The search stops early once a layout ranks perfect. With a
// tradeFloor, a best that is still not clean gives way to the largest clean layout further down, to the floor.
function bestBelow(at, fits, top, { low, tradeFloor = 0, together, accept }) {
  const floor = Math.max(low, Math.ceil(tradeFloor));
  const window = Math.max(floor, Math.ceil(top.size * CLEAN_BREAK_SHARE));
  const ranking = { together, accept };
  let best = top, bestRank = rankOf(top, ranking);
  for (let size = top.size - 1; size >= window && bestRank.some((v) => v > 0); size--) {
    const layout = at(size);
    if (!fits(layout)) continue;
    const rank = rankOf(layout, ranking);
    if (isBetter(rank, bestRank)) [best, bestRank] = [layout, rank];
  }
  if ((bestRank[0] === 0 && bestRank[1] === 0) || tradeFloor <= 0) return best;
  for (let size = window - 1; size >= floor; size--) {
    const layout = at(size);
    if (fits(layout) && !unclean(layout, together) && (accept === undefined || accept(layout))) return layout;
  }
  return best;
}

/** The widest of the digits 0-9: a fixed advance so a counter does not jitter as its digits change. */
export function numeralAdvance(measure, font) {
  return Math.max(...DIGITS.map((d) => measure(d, font).width));
}
