// Browser-safe (no Node imports): choose line breaks the way a typographer would, by sense.
// A dynamic program over word positions: every line costs the square of its unused width, a break away from a
// preferred point costs extra, and a line holding a single word (first, middle or last) costs a lot.

export const PREPOSITIONS = new Set(['of', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'from', 'and', 'or', 'but', 'that', 'which']);

export const FORCE_MARK = '|';
// A break after one of , ; : . ! ? the em dash and a separator dot is natural; closing quotes and brackets may trail it.
const BREAK_AFTER = /[,;:.!?—·•]["'”’)\]]*$/;
// A word that is only a separator ("query · illustration") never starts a line: it stays with the word before it.
const SEPARATOR = /^[·•]$/;
const EDGE_NON_LETTERS = /^[^\p{L}]+|[^\p{L}]+$/gu;

const FIT_EPSILON = 1e-6;
// Divides maxWidth^2 to give the cost of breaking away from a preferred point.
const OFF_POINT_DIVISOR = 4;
// A sentence end: fitText (layout.mjs) keeps it at a line end when a slightly smaller size allows.
const SENTENCE_END = /[.!?]["'”’)\]]*$/;

/** Does a word end a sentence (. ! or ? with any closing quote or bracket)? */
export const endsSentence = (word) => SENTENCE_END.test(word);

// Words a line of a headline never ends on when another break exists: articles, short prepositions, conjunctions.
const WEAK_ENDS = new Set(['a', 'an', 'the', 'of', 'to', 'in', 'on', 'at', 'by', 'for', 'from', 'with', 'as', 'into', 'onto', 'via', 'and', 'or', 'but', 'nor']);
const STACK_WEAK_COST = 1.1; // a stack line ending on one: more than one more line
const STACK_COMMA_COST = 2; // a comma inside a stack line (not at its end): more than one more line and a short last word
const STACK_ORPHAN_COST = 1.1; // a first line of one word in a sentence of three words or more
const INNER_COMMA = /[,;:]$/;
// a line ending on one costs maxWidth^2 / this: more than any slack or an off-point break, less than a one-word line (a
// line of one word is no balanced break, so 'Built on / your machine.' stays when the only other choice leaves a word alone)
const WEAK_DIVISOR = 2;
const isForced = (word) => word.endsWith(FORCE_MARK);
/** Is `word` one a headline line never ends on when another break exists (an article, short preposition or conjunction)? */
export const isWeakEnd = (word) => WEAK_ENDS.has(word.toLowerCase().replace(EDGE_NON_LETTERS, ''));
const bare = (word) => (isForced(word) ? word.slice(0, -FORCE_MARK.length) : word);

function buildContext(words, widths, spaceWidth, maxWidth, keepWithNext) {
  const n = words.length;
  const forced = words.map(isForced);
  const plain = words.map(bare);
  // A forced break wins over keep-with-next; a word before a separator is kept with it.
  const glued = words.map((_, i) => (Boolean(keepWithNext[i]) || SEPARATOR.test(plain[i + 1] ?? '')) && !forced[i]);
  const prefix = [0];
  for (const w of widths) prefix.push(prefix[prefix.length - 1] + w);
  const lineWidth = (i, k) => prefix[k] - prefix[i] + spaceWidth * (k - i - 1);
  // Is a line ending after word k-1 (next word k) at a preferred point?
  const preferred = (k) => k >= n
    || forced[k - 1]
    || BREAK_AFTER.test(plain[k - 1])
    || PREPOSITIONS.has(plain[k].toLowerCase().replace(EDGE_NON_LETTERS, ''));
  const weak = plain.map(isWeakEnd);
  return { n, forced, glued, lineWidth, preferred, maxWidth, weak };
}

// Cost of a line holding words i..k-1 (a line ending on an article, preposition or conjunction costs WEAK_DIVISOR's
// share). A line of one word in a text of more costs maxWidth^2, which outweighs any
// slack, so the breaker takes another break of the same lines when there is one (a break the author forced with |
// is the same in every choice, so its one-word line changes nothing).
function lineCost(ctx, i, k) {
  const slack = Math.max(0, ctx.maxWidth - ctx.lineWidth(i, k));
  let cost = slack * slack;
  if (!ctx.preferred(k)) cost += (ctx.maxWidth * ctx.maxWidth) / OFF_POINT_DIVISOR;
  if (k - i === 1 && ctx.n > 1) cost += ctx.maxWidth * ctx.maxWidth;
  if (k < ctx.n && ctx.weak[k - 1] && !ctx.forced[k - 1]) cost += (ctx.maxWidth * ctx.maxWidth) / WEAK_DIVISOR;
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
const STACK_LONG_SENTENCE = 15; // ...or of more than this when the line ends a sentence ("NOT SHIPPED WEAK." stays whole)
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
    const limit = SENTENCE_END.test(bare(words[k - 1])) ? STACK_LONG_SENTENCE : STACK_LONG_LETTERS;
    const long = k - i > 2 && letters > limit ? STACK_LONG_COST : 0;
    const alone = k - i === 1 && letters <= STACK_SHORT_LETTERS ? STACK_ALONE_COST : 0;
    const weak = k < n && ctx.weak[k - 1] && !ctx.forced[k - 1] ? STACK_WEAK_COST : 0;
    const comma = words.slice(i, k - 1).some((w) => INNER_COMMA.test(bare(w))) ? STACK_COMMA_COST : 0;
    // a one-word first line of a longer text, unless that word is a whole sentence ("Shipped." stands alone)
    const orphan = i === 0 && k === 1 && n > 2 && !SENTENCE_END.test(bare(words[0])) ? STACK_ORPHAN_COST : 0;
    return STACK_LINE_COST + long + alone + weak + comma + orphan + (ctx.preferred(k) ? 0 : STACK_OFF_POINT_COST);
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
  const best = new Array(n + 1).fill(Infinity);
  const choice = new Array(n + 1).fill(n);
  best[n] = 0;
  for (let i = n - 1; i >= 0; i--) {
    for (const k of lineEnds(ctx, i)) {
      const total = lineCost(ctx, i, k) + best[k];
      if (total < best[i]) { best[i] = total; choice[i] = k; }
    }
  }
  const rows = [];
  for (let i = 0; i < n; i = choice[i]) rows.push(Array.from({ length: choice[i] - i }, (_, j) => i + j));
  return rows;
}
