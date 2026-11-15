// Browser-safe (no Node imports): lay text out as lines of positioned words, fit it to a box, and give counters
// a fixed numeral advance. Pure: the caller supplies `measure` (canvas in the page, a fake in tests).
import { breakBySense, FORCE_MARK } from './breaks.mjs';

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
 * @param {{ text: string, font: object, maxWidth: number, align?: 'left'|'center'|'right', measure: Function, optical?: boolean }} opts
 * @returns {{ size: number, width: number, height: number, lines: object[], overflow: boolean }}
 */
export function layoutText({ text, font, maxWidth, align = 'left', measure, optical = false }) {
  assertOptions({ font, maxWidth, align, measure });
  const tokens = tokenize(text);
  if (tokens.length === 0) return emptyLayout(font);
  const metrics = tokens.map((t) => advanceOf(measure, font, t.text));
  const widths = metrics.map((m) => m.width);
  const spaceWidth = advanceOf(measure, font, ' ').width;
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
 * no word wider than maxWidth). If none fits, the layout at min, with overflow: true.
 * @param {object} opts layoutText options; font.size is replaced by the search
 * @param {{ min: number, max: number, maxHeight: number, maxLines?: number }} limits
 */
export function fitText(opts, { min, max, maxHeight, maxLines = Infinity }) {
  const low = Math.ceil(min);
  const high = Math.floor(max);
  if (!(Number.isFinite(low) && Number.isFinite(high) && low >= 1 && low <= high)) {
    throw new Error(`fitText: need 1 <= min <= max (whole sizes), got min ${min}, max ${max}`);
  }
  const at = (size) => layoutText({ ...opts, font: { ...opts.font, size } });
  const fits = (l) => l.height <= maxHeight + FIT_EPSILON && l.lines.length <= maxLines && l.width <= opts.maxWidth + FIT_EPSILON;
  for (let size = high; size > low; size--) {
    const layout = at(size);
    if (fits(layout)) return layout;
  }
  const floor = at(low);
  return fits(floor) ? floor : { ...floor, overflow: true };
}

/** The widest of the digits 0-9: a fixed advance so a counter does not jitter as its digits change. */
export function numeralAdvance(measure, font) {
  return Math.max(...DIGITS.map((d) => measure(d, font).width));
}
