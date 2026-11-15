// Matching what is shown to what is said: word forms compared without case or punctuation, numbers 0 to 99 against
// their spelt form, "%" against "percent", and the alignment of on-screen words to spoken words by longest common
// subsequence, so a repeated word matches its own occurrence instead of the first one further on. Pure, DOM-free.

const NON_WORD_RE = /[^\p{L}\p{N}]/gu;
const DIGITS_RE = /^\d+$/;
const NO_SAY_START = 0.2; // seconds: with no narration the first word lands here...
const NO_SAY_STAGGER = 0.09; // ...and each next word this much later
const SPELT_MAX = 99;
const TEN = 10;
const TEEN_END = 20;

export const ONES = Object.freeze(['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven',
  'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']);
export const TENS = Object.freeze(['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']);
/** Words that scale or qualify a number: "one hundred", "one percent". */
export const UNIT_WORDS = Object.freeze(['hundred', 'thousand', 'million', 'billion', 'percent']);
/** Every word that is, or belongs to, a spoken number. */
export const NUMBER_WORDS = new Set([...ONES, ...TENS.filter(Boolean), ...UNIT_WORDS]);

/** A word as compared: letters and digits only, lower case; a word that is only a % sign reads "percent". */
export function wordForm(text) {
  const form = text.replace(NON_WORD_RE, '').toLowerCase();
  return form === '' && text.includes('%') ? 'percent' : form;
}

// 0 to 99 as spoken: the first word, and the whole number as one hyphenless word ("41": forty, fortyone).
function spelt(n) {
  if (n < TEEN_END) return [ONES[n]];
  const tens = TENS[Math.floor(n / TEN)], ones = n % TEN;
  return ones === 0 ? [tens] : [tens, `${tens}${ONES[ones]}`];
}

/** Does an on-screen word form match a spoken one? Equal forms, or digits 0 to 99 against their spelt form. */
export function sameWord(shown, said) {
  if (shown === said) return true;
  if (DIGITS_RE.test(shown) && Number(shown) <= SPELT_MAX) return spelt(Number(shown)).includes(said);
  return false;
}

/**
 * Align on-screen words to spoken words by longest common subsequence: for each on-screen form, the index of the
 * spoken form it matches, or null. Backtracking from the end takes a match whenever it keeps the length, so among
 * equally long alignments each word matches the occurrence nearest the words after it.
 */
export function align(shown, said) {
  const n = shown.length, m = said.length;
  const best = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      best[i][j] = sameWord(shown[i - 1], said[j - 1]) ? best[i - 1][j - 1] + 1 : Math.max(best[i - 1][j], best[i][j - 1]);
    }
  }
  const matches = new Array(n).fill(null);
  for (let i = n, j = m; i > 0 && j > 0;) {
    if (sameWord(shown[i - 1], said[j - 1]) && best[i][j] === best[i - 1][j - 1] + 1) {
      matches[i - 1] = j - 1;
      i--; j--;
    } else if (best[i - 1][j] >= best[i][j - 1]) i--;
    else j--;
  }
  return matches;
}

/**
 * When each on-screen word lands: on the start of the spoken word it aligns with; an unmatched word lands with the
 * previous matched word, or the next one when none precedes it (the first spoken word when nothing matched). With no
 * narration words stagger NO_SAY_STAGGER apart from NO_SAY_START. Each entry is { at, spoken } with `spoken` the
 * index of the matched spoken word or null.
 */
export function wordTimes(texts, timing) {
  const spoken = timing.words;
  if (spoken.length === 0) return texts.map((_, i) => ({ at: Math.min(timing.duration, NO_SAY_START + NO_SAY_STAGGER * i), spoken: null }));
  const matches = align(texts.map(wordForm), spoken.map((w) => wordForm(w.text)));
  return texts.map((_, i) => {
    if (matches[i] !== null) return { at: spoken[matches[i]].start, spoken: matches[i] };
    const before = matches.slice(0, i).findLast((m) => m !== null);
    const after = matches.slice(i + 1).find((m) => m !== null);
    return { at: spoken[before ?? after ?? 0].start, spoken: null };
  });
}
