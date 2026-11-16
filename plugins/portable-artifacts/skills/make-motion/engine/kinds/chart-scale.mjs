// The chart kind's scale (chart.mjs and its compositions): nice ticks for a value range, a value as text with its
// unit, and numerals set in fixed advances so figures in a column or a counting label do not jitter. Pure and DOM-free.
import { formatValue } from './number.mjs';

const NICE = Object.freeze([1, 2, 2.5, 5, 10]); // a tick step is one of these times a power of ten
const QUARTER = 2.5; // the one nice multiple with a decimal of its own
const UNIT_RANGE = 1; // all-zero data gets a range of one
const DIGIT = /\d/;
const CURRENCY = /^[$€£¥₹]$/u; // a unit set before the number
const STEP_EPSILON = 1e-9; // a bound that is a whole number of steps stays one
const HALF = 2;

/**
 * Nice ticks covering lo..hi in about `count` steps: { lo, hi, step, decimals, ticks }. A range of one value runs from
 * zero to it (all zero: zero to one), so a single bar still has a scale. Each tick is a whole multiple of the step,
 * rounded to the step's decimals (no 0.30000000000000004).
 */
export function niceTicks(lo, hi, count = 3) {
  let from = Math.min(lo, hi), to = Math.max(lo, hi);
  if (from === to) {
    from = Math.min(0, from);
    to = Math.max(0, to);
    if (from === to) to = UNIT_RANGE;
  }
  const rough = (to - from) / count;
  const power = Math.floor(Math.log10(rough));
  const norm = rough / 10 ** power;
  const multiple = NICE.find((m) => norm <= m);
  const exponent = multiple === NICE.at(-1) ? power + 1 : power;
  const step = (multiple === NICE.at(-1) ? 1 : multiple) * 10 ** exponent;
  const decimals = Math.max(0, -exponent) + (multiple === QUARTER ? 1 : 0);
  const round = (v) => Number(v.toFixed(decimals));
  const first = Math.floor(from / step + STEP_EPSILON), last = Math.ceil(to / step - STEP_EPSILON);
  const ticks = Array.from({ length: last - first + 1 }, (_, k) => round((first + k) * step));
  return { lo: ticks[0], hi: ticks.at(-1), step, decimals, ticks };
}

/** A value as shown: thousands grouped, `decimals` places, a currency unit before the number (after its sign), % after it, any other unit after a space. */
export function valueText(value, decimals, unit) {
  const figure = formatValue(Math.abs(value), decimals);
  const sign = value < 0 ? '-' : '';
  if (unit === undefined || unit === '') return `${sign}${figure}`;
  if (CURRENCY.test(unit)) return `${sign}${unit}${figure}`;
  return unit === '%' ? `${sign}${figure}%` : `${sign}${figure} ${unit}`;
}

/**
 * One line of text with every digit centred in a cell as wide as the widest digit and every other character at its own
 * width (number.mjs sets its count the same way): the layout shape layoutText gives, one word per character.
 */
export function numeralLayout(text, font, measure) {
  // never tighter than the face: a display face tracked in (pop) would push one digit's ink into the next
  const tracking = Math.max(0, font.tracking ?? 0) * font.size;
  const advance = Math.max(...'0123456789'.split('').map((d) => measure(d, font).width)) + tracking;
  let x = 0;
  const words = [...text].map((ch, index) => {
    const glyph = measure(ch, font).width;
    const cell = DIGIT.test(ch) ? advance : glyph + tracking;
    const word = { text: ch, index, x: x + (cell - glyph) / HALF, width: glyph };
    x += cell;
    return word;
  });
  const { ascent, descent } = measure('0', font);
  return { size: font.size, width: x, height: ascent + descent, lines: [{ x: 0, y: ascent, width: x, words }], overflow: false };
}
