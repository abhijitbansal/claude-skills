// Browser-safe (no Node imports): choose line breaks the way a typographer would, by sense.
// A dynamic program over word positions: every line costs the square of its unused width, a break away from a
// preferred point costs extra, and a lone word on the last line under a long line costs a lot.

export const PREPOSITIONS = new Set(['of', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'from', 'and', 'or', 'but', 'that', 'which']);

export const FORCE_MARK = '|';
// A break after one of , ; : . ! ? and the em dash is natural; closing quotes and brackets may trail it.
const BREAK_AFTER = /[,;:.!?—]["'”’)\]]*$/;
const EDGE_NON_LETTERS = /^[^\p{L}]+|[^\p{L}]+$/gu;

const FIT_EPSILON = 1e-6;
// Divides maxWidth^2 to give the cost of breaking away from a preferred point.
const OFF_POINT_DIVISOR = 4;
// A sentence end: fitText (layout.mjs) keeps it at a line end when a slightly smaller size allows.
const SENTENCE_END = /[.!?]["'”’)\]]*$/;

/** Does a word end a sentence (. ! or ? with any closing quote or bracket)? */
export const endsSentence = (word) => SENTENCE_END.test(word);
// A last line of one word is penalised when the line above has at least this many words.
const LONG_LINE_WORDS = 3;

const isForced = (word) => word.endsWith(FORCE_MARK);
const bare = (word) => (isForced(word) ? word.slice(0, -FORCE_MARK.length) : word);

function buildContext(words, widths, spaceWidth, maxWidth, keepWithNext) {
  const n = words.length;
  const forced = words.map(isForced);
  // A forced break wins over keep-with-next.
  const glued = words.map((_, i) => Boolean(keepWithNext[i]) && !forced[i]);
  const plain = words.map(bare);
  const prefix = [0];
  for (const w of widths) prefix.push(prefix[prefix.length - 1] + w);
  const lineWidth = (i, k) => prefix[k] - prefix[i] + spaceWidth * (k - i - 1);
  // Is a line ending after word k-1 (next word k) at a preferred point?
  const preferred = (k) => k >= n
    || forced[k - 1]
    || BREAK_AFTER.test(plain[k - 1])
    || PREPOSITIONS.has(plain[k].toLowerCase().replace(EDGE_NON_LETTERS, ''));
  return { n, forced, glued, lineWidth, preferred, maxWidth };
}

// Cost of a line holding words i..k-1, given the word count (capped) of the line above it.
function lineCost(ctx, i, k, above) {
  const slack = Math.max(0, ctx.maxWidth - ctx.lineWidth(i, k));
  let cost = slack * slack;
  if (!ctx.preferred(k)) cost += (ctx.maxWidth * ctx.maxWidth) / OFF_POINT_DIVISOR;
  const loneLast = k === ctx.n && k - i === 1 && above >= LONG_LINE_WORDS && !ctx.forced[i - 1];
  if (loneLast) cost += ctx.maxWidth * ctx.maxWidth;
  return cost;
}

// Word index (exclusive) where a line starting at i may end: not past a forced break, not after a keep-with-next
// word, not wider than maxWidth unless that is the shortest line possible (one word, or a kept-together pair).
function lineEnds(ctx, i) {
  const ends = [];
  for (let k = i + 1; k <= ctx.n; k++) {
    if (ends.length > 0 && ctx.lineWidth(i, k) > ctx.maxWidth + FIT_EPSILON) break;
    if (!(ctx.glued[k - 1] && k < ctx.n)) ends.push(k);
    if (ctx.forced[k - 1]) break;
  }
  return ends;
}

// ---- the stack: short lines, each set at its own size ----

const STACK_MAX_WORDS = 3;
const STACK_LONG_LETTERS = 12; // a line of more letters than this holds at most 2 words...
const STACK_LONG_COST = 100; // ...which is all but a rule: this outweighs any other choice
const STACK_LINE_COST = 1; // fewer lines are preferred
const STACK_OFF_POINT_COST = 0.75; // a break away from a preferred point
const STACK_SHORT_LETTERS = 4; // a line of one word this short or shorter is a short word left alone...
const STACK_ALONE_COST = 0.5; // ...which costs this much
const LETTERS = /[\p{L}\p{N}]/gu;

const letterCount = (word) => (bare(word).match(LETTERS) ?? []).length;

/**
 * Break words into the lines of a stack, where each line is then set at its own size: at most STACK_MAX_WORDS words a
 * line, two when the line would have more than STACK_LONG_LETTERS letters, a `|` forcing a break, and otherwise as few
 * lines as possible, broken at preferred points (punctuation, before a preposition). Widths play no part.
 * @param {string[]} words words; one ending in `|` forces a break after it
 * @returns {number[][]} word indexes per line
 */
export function stackLines(words) {
  const n = words.length;
  if (n === 0) return [];
  const ctx = buildContext(words, words.map(() => 0), 0, Infinity, []);
  const cost = (i, k) => {
    const letters = words.slice(i, k).reduce((sum, w) => sum + letterCount(w), 0);
    const long = k - i > 2 && letters > STACK_LONG_LETTERS ? STACK_LONG_COST : 0;
    const alone = k - i === 1 && letters <= STACK_SHORT_LETTERS ? STACK_ALONE_COST : 0;
    return STACK_LINE_COST + long + alone + (ctx.preferred(k) ? 0 : STACK_OFF_POINT_COST);
  };
  const best = new Array(n + 1).fill(Infinity);
  const choice = new Array(n + 1).fill(n);
  best[n] = 0;
  for (let i = n - 1; i >= 0; i--) {
    for (let k = i + 1; k <= Math.min(n, i + STACK_MAX_WORDS); k++) {
      const total = cost(i, k) + best[k];
      if (total < best[i]) { best[i] = total; choice[i] = k; }
      if (ctx.forced[k - 1]) break;
    }
  }
  const rows = [];
  for (let i = 0; i < n; i = choice[i]) rows.push(Array.from({ length: choice[i] - i }, (_, j) => i + j));
  return rows;
}

/**
 * Break words into lines.
 * @param {string[]} words words; one ending in `|` forces a break after it (the caller strips the `|` when drawing)
 * @param {number[]} widths measured width of each word
 * @param {number} spaceWidth width of one space
 * @param {number} maxWidth line width limit; a word wider than this gets a line to itself
 * @param {boolean[]} [keepWithNext] keepWithNext[i] true: no break after word i (a number and its unit)
 * @returns {number[][]} word indexes per line
 */
export function breakBySense(words, widths, spaceWidth, maxWidth, keepWithNext = []) {
  if (widths.length !== words.length) throw new Error(`breakBySense: ${words.length} words but ${widths.length} widths`);
  const n = words.length;
  if (n === 0) return [];
  const ctx = buildContext(words, widths, spaceWidth, maxWidth, keepWithNext);
  const states = LONG_LINE_WORDS + 1; // the line above holds 0 (none) .. LONG_LINE_WORDS or more words
  const best = Array.from({ length: n + 1 }, () => new Array(states).fill(Infinity));
  const choice = Array.from({ length: n + 1 }, () => new Array(states).fill(n));
  best[n].fill(0);
  for (let i = n - 1; i >= 0; i--) {
    const ends = lineEnds(ctx, i);
    for (let above = 0; above < states; above++) {
      for (const k of ends) {
        const total = lineCost(ctx, i, k, above) + best[k][Math.min(LONG_LINE_WORDS, k - i)];
        if (total < best[i][above]) { best[i][above] = total; choice[i][above] = k; }
      }
    }
  }
  const rows = [];
  for (let i = 0, above = 0; i < n;) {
    const k = choice[i][above];
    rows.push(Array.from({ length: k - i }, (_, j) => i + j));
    above = Math.min(LONG_LINE_WORDS, k - i);
    i = k;
  }
  return rows;
}
