// What the caption styles share, with no import of index.mjs or of a style, so that every caption module can be imported
// first, on its own, in any order: the grouping of a shot's words, when each group is on screen, the room a zone keeps
// for a line's ink, and the fit of a group that is too long at its size. Pure and DOM-free.
import { endsSentence } from '../text/breaks.mjs';
import { track } from '../time/track.mjs';

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
const JOIN_EPSILON = 1e-9; // seconds: spans closer than this are back to back

const isWhole = (n) => Number.isInteger(n) && n >= 1;

/**
 * When a word is heard, in shot seconds: its sound times (soundStart, soundEnd), which the timeline keeps when it shows a
 * shot's first word from the shot's first frame (start 0), else its shown times. A word is lit by these (branch review
 * A, I2); when a group is on screen starts from the shown time.
 */
export const heardStart = (w) => w.soundStart ?? w.start;
export const heardEnd = (w) => w.soundEnd ?? w.end;

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

/** The right edge in pixels of 1-based grid column `column` (1 to the look's columns). */
export const columnRight = (ctx, column) => (column === ctx.look.grid.columns ? ctx.gridX(column + 1) : ctx.gridX(column + 1) - ctx.look.grid.gutter * ctx.unit);

/**
 * Opacity that is 1 during each [at, until) of `spans` (in order) and 0 elsewhere, stepped; a span that starts where the
 * one before it ends joins it, so a card or pill holding the groups in turn never blinks between two of them.
 */
export function visibleDuring(spans) {
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

/** `layout` (of `text`, a group's words) when it has one layout word per spoken word; else an error saying which differ. */
export function spokenLayout(layout, group, text, captionId) {
  const count = layout.lines.reduce((n, l) => n + l.words.length, 0);
  if (count !== group.words.length) throw new Error(`${captionId}: "${text}" lays out as ${count} words, not the ${group.words.length} spoken`);
  return layout;
}

// Two rank arrays compared in order: the first key that differs decides.
function byKeys(p, q) {
  const k = p.findIndex((v, i) => v !== q[i]);
  return k < 0 ? 0 : p[k] - q[k];
}

/**
 * Where a style's zone goes in its band against what the shot pins and marks (ctx.avoid: pinned text cards; ctx.marks:
 * marked regions; boxes over the shot): `fallback` (the style's own zone, [x, y, w, h], in the band `y` to `y + h`)
 * when no box that comes into the band meets it by a gutter; else, of the column spans from..to at least `minColumns`
 * wide (from..to may reach past the style's own columns: the rest of its band), clipped to [left, right], the one that
 * meets none and comes first by `rank({ a, b })` (an array of numbers, compared in order: the style's preference, as
 * which end of the band it keeps to). When no span clears them, the style's own zone: the frame review then names the
 * shot (a creative finding), since no spec field moves the zone.
 */
export function clearZone(ctx, fallback, { from, to, minColumns, left, right, rank }) {
  const [, top, , h] = fallback;
  const gutter = ctx.look.grid.gutter * ctx.unit;
  const blockers = [...(ctx.avoid ?? []), ...(ctx.marks ?? [])].filter(([, y, , bh]) => y < top + h && y + bh > top);
  const clear = (z) => z[2] > 0 && blockers.every(([x, , w]) => x + w + gutter <= z[0] || x >= z[0] + z[2] + gutter);
  if (clear(fallback)) return fallback;
  const box = ({ a, b }) => {
    const l = Math.max(left, ctx.gridX(a)), r = Math.min(right, columnRight(ctx, b));
    return [l, top, r - l, h];
  };
  const spans = [];
  for (let a = from; a <= to; a++) for (let b = a + minColumns - 1; b <= to; b++) spans.push({ a, b });
  const best = spans.filter((s) => clear(box(s))).sort((p, q) => byKeys(rank(p), rank(q)))[0];
  return best === undefined ? fallback : box(best);
}

/**
 * A group set at the largest size from `size` down to `min` (FIT_STEP apart, `min` last) at which it fits: `setAt(px)`
 * lays it out as { layout, ... }, `fits(set)` says whether that is short and narrow enough. A group that fits at no size
 * is the one at `min` with layout.overflow (a creative finding: the review asks for fewer words).
 */
export function fitGroup(setAt, fits, size, min) {
  if (![size, min].every((px) => Number.isFinite(px) && px > 0)) throw new RangeError(`fitGroup: size and min must be positive numbers of px, got ${size} and ${min}`);
  const floor = Math.min(min, size);
  for (let px = size; px > floor; px *= FIT_STEP) {
    const set = setAt(px);
    if (fits(set)) return set;
  }
  const last = setAt(floor);
  return fits(last) ? last : { ...last, layout: { ...last.layout, overflow: true } };
}
