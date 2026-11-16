// What the caption styles share, with no import of index.mjs or of a style, so that every caption module can be imported
// first, on its own, in any order: the grouping of a shot's words, when each group is on screen, the room a zone keeps
// for a line's ink, and the fit of a group that is too long at its size. Pure and DOM-free.
import { endsSentence } from '../text/breaks.mjs';

/** Seconds a caption group stays after its last word ends; the review allows CAPTION_LATE_SECONDS (frame.mjs, 0.3). */
export const CAPTION_HOLD = 0.2;
/** The room a zone keeps for a line's ink above and below its baseline, as shares of the size (caps reach about 0.73 em
 *  up in the bundled faces; a Q's tail or a comma about 0.2 em down). */
export const ZONE_ASCENT = 0.8;
export const ZONE_DESCENT = 0.25;
// A word that ends a clause: , ; : or a dash (spaced, or closing the word), with any closing quote or bracket after it.
const CLAUSE_END = /[,;:–—-]["'”’)\]]*$/;
// Costs of the grouping's dynamic program: every group, a group of one word in a sentence of more, a break that is not
// after clause punctuation, and the squared share of a group's unused characters (balance).
const COST = Object.freeze({ group: 1, lone: 100, offClause: 2, balance: 1 });
const FIT_STEP = 0.92; // a group too long for its zone is tried again this much smaller

const isWhole = (n) => Number.isInteger(n) && n >= 1;

// The words as units that are never split: a merged run (consecutive words sharing one start and end, as a voice gives
// "$5 million") is one unit. Each unit is { first, last } (word indexes, inclusive).
function unitsOf(words) {
  const units = [];
  words.forEach((w, i) => {
    const prev = units.at(-1);
    const shares = prev && words[prev.last].start === w.start && words[prev.last].end === w.end;
    if (shares) prev.last = i;
    else units.push({ first: i, last: i });
  });
  return units;
}

// The units split into sentences: a sentence ends at a unit whose last word ends one (or at the last unit).
function sentencesOf(units, words) {
  const sentences = [[]];
  units.forEach((u, k) => {
    sentences.at(-1).push(u);
    if (endsSentence(words[u.last].text) && k < units.length - 1) sentences.push([]);
  });
  return sentences;
}

// The cost of one group: units[i..j) of a sentence of `units`, Infinity when it breaks the limits (a single unit never
// does: it cannot be split).
function groupCost(units, i, j, words, { maxWords, maxChars }) {
  const first = units[i].first, last = units[j - 1].last;
  const count = last - first + 1;
  const chars = words.slice(first, last + 1).map((w) => w.text).join(' ').length;
  if (j - i > 1 && (count > maxWords || chars > maxChars)) return Infinity;
  const sentenceWords = units.at(-1).last - units[0].first + 1;
  const lone = count === 1 && sentenceWords > 1 ? COST.lone : 0;
  const offClause = j < units.length && !CLAUSE_END.test(words[last].text) ? COST.offClause : 0;
  const slack = Math.max(0, maxChars - chars) / maxChars;
  return COST.group + lone + offClause + COST.balance * slack * slack;
}

// One sentence's units as groups, by a dynamic program over break points (fewest groups, breaks after clause
// punctuation, no group of one word, balanced). Ties keep the earlier break.
function sentenceGroups(units, words, limits) {
  const best = [0], from = [0];
  for (let j = 1; j <= units.length; j++) {
    best[j] = Infinity;
    for (let i = 0; i < j; i++) {
      const cost = best[i] + groupCost(units, i, j, words, limits);
      if (cost < best[j]) { best[j] = cost; from[j] = i; }
    }
  }
  const groups = [];
  for (let j = units.length; j > 0; j = from[j]) groups.unshift({ first: units[from[j]].first, last: units[j - 1].last });
  return groups;
}

/**
 * The words of a shot as caption groups, in order: { first, last, words } (word indexes, inclusive, and the words).
 * Breaks at sentence ends first (a group never runs across one), then after clause punctuation; never splits a merged
 * pair (two words sharing one time); never leaves a group of one word unless its sentence is one word; a group holds at
 * most `maxWords` words and `maxChars` characters (spaces included) unless it is one unbreakable unit.
 * @param {{ text: string, start: number, end: number }[]} words @param {{ maxWords: number, maxChars: number }} limits
 */
export function captionGroups(words, { maxWords, maxChars } = {}) {
  if (!isWhole(maxWords) || !isWhole(maxChars)) throw new RangeError(`captionGroups: maxWords and maxChars must be whole numbers of 1 or more, got ${maxWords} and ${maxChars}`);
  if (!Array.isArray(words)) throw new TypeError('captionGroups: words must be an array of timeline words');
  if (words.length === 0) return [];
  return sentencesOf(unitsOf(words), words)
    .flatMap((sentence) => sentenceGroups(sentence, words, { maxWords, maxChars }))
    .map(({ first, last }) => ({ first, last, words: words.slice(first, last + 1) }));
}

/**
 * When each group is on screen, in shot seconds: { at, until, end } with `end` its last word's end. `until` is the next
 * group's start or `end + CAPTION_HOLD`, whichever is first, inside the shot, and at least one frame after `at`.
 */
export function groupTimes(groups, { duration, fps }) {
  return groups.map((g, k) => {
    const at = g.words[0].start;
    const end = Math.max(...g.words.map((w) => w.end));
    const next = groups[k + 1]?.words[0].start ?? Infinity;
    const until = Math.min(next, end + CAPTION_HOLD, duration);
    return { at, end, until: Math.min(duration, Math.max(until, at + 1 / fps)) };
  });
}

/**
 * A group set at the largest size from `size` down to `min` (FIT_STEP apart, `min` last) at which it fits: `setAt(px)`
 * lays it out as { layout, ... }, `fits(set)` says whether that is short and narrow enough. A group that fits at no size
 * is the one at `min` with layout.overflow (a creative finding: the review asks for fewer words).
 */
export function fitGroup(setAt, fits, size, min) {
  const floor = Math.min(min, size);
  for (let px = size; px > floor; px *= FIT_STEP) {
    const set = setAt(px);
    if (fits(set)) return set;
  }
  const last = setAt(floor);
  return fits(last) ? last : { ...last, layout: { ...last.layout, overflow: true } };
}
