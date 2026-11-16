// The `compare` kind's sides as its compositions read them (compare.mjs, compare-desk.mjs, compare-pop.mjs): when the
// right side arrives, how a value is shown and the words of each side. Pure and DOM-free.
import { formatValue } from './shared.mjs';

export const SIDES = Object.freeze(['left', 'right']);
const MAX_DECIMALS = 3;
const POINT_DASH = '–';
const LINE_BREAK = ' | '; // a lone `|` forces a break after the word before it (text/layout.mjs)
const HALF = 2;

/**
 * When the right side arrives, in shot seconds: the second sentence's start; with one sentence, the start of the middle
 * spoken word (round(words / 2)); with fewer than two words or no narration, half the shot. Always inside the shot.
 */
export function compareTurn(timing) {
  const { words, sentences, duration } = timing;
  if (sentences.length >= HALF) return sentences[1].start;
  if (words.length >= HALF) return words[Math.min(words.length - 1, Math.round(words.length / HALF))].start;
  return duration / HALF;
}

/** A value as shown: a number with thousands grouped and its own decimals (at most 3), a string as written. */
export function valueText(value) {
  if (typeof value === 'string') return value;
  const decimals = Math.min(MAX_DECIMALS, (String(value).split('.')[1] ?? '').length);
  return formatValue(value, decimals);
}

/** Does the shot set values (on both sides: the validator refuses one side alone)? */
export const hasValues = (shot) => shot.left.value !== undefined && shot.right.value !== undefined;

/** A side's points as one text, each on its own line after a dash (none when `dash` is false: cosmos), or null. */
export const pointsText = (side, { dash = true } = {}) => (Array.isArray(side.points) && side.points.length > 0
  ? side.points.map((p) => (dash ? `${POINT_DASH} ${p}` : p)).join(LINE_BREAK) : null);
