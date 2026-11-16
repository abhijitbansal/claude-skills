// A word as it is spoken, for comparing a film's say with a recording's transcription (sidecar.mjs fromWhisper): the
// synthesiser's own text normalisation (phonemes.mjs normalize: money, decimals, years, clock times, titles before a
// name), then what the phonemizer reads aloud after it (digits as words, ordinals, "%" as "percent", a title on its
// own), as a key of lower-case letters. So "$5" and "five dollars", "10%" and "ten percent", "2024" and "twenty twenty
// four", "1st" and "first" have the same key. Pure: no I/O.
import { normalize } from './phonemes.mjs';

const UNITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const SCALES = [[1e12, 'trillion'], [1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']];
const HUNDRED = 100;
const TEN = 10;
const UNITS_LIMIT = 20;
/** Digit runs longer than this stay digits (no spoken word is that long a number). */
const MAX_DIGITS = 15;
const IRREGULAR_ORDINALS = new Map([['one', 'first'], ['two', 'second'], ['three', 'third'], ['five', 'fifth'], ['eight', 'eighth'], ['nine', 'ninth'], ['twelve', 'twelfth']]);
// A title on its own (normalize spells one only before a capitalised name, which a single word has not).
const TITLES = new Map([['dr', 'doctor'], ['mr', 'mister'], ['ms', 'miss'], ['mrs', 'missus']]);
const TITLE_RE = /^(dr|mr|ms|mrs)\.?$/i;
/** Text the speller can change: a digit, a currency sign, a per cent sign or a title. Any other text keys as it is. */
const SPELLABLE_RE = /[0-9$£%]|^(?:dr|mr|ms|mrs)\.?$/i;
const NON_WORD_RE = /[^\p{L}\p{N}]/gu;

// An integer under 1000 as words: [] for 0 inside a larger number.
function belowThousand(n) {
  const words = [];
  if (n >= HUNDRED) words.push(UNITS[Math.floor(n / HUNDRED)], 'hundred');
  const rest = n % HUNDRED;
  if (rest >= UNITS_LIMIT) words.push(TENS[Math.floor(rest / TEN)], ...(rest % TEN > 0 ? [UNITS[rest % TEN]] : []));
  else if (rest > 0) words.push(UNITS[rest]);
  return words;
}

/** A whole number as its English words ("12500" -> "twelve thousand five hundred"), leading zeros aside. */
export function numberWords(digits) {
  let n = Number(digits);
  if (n === 0) return UNITS[0];
  const words = [];
  for (const [size, name] of SCALES) {
    if (n >= size) { words.push(...belowThousand(Math.floor(n / size)), name); n %= size; }
  }
  return [...words, ...belowThousand(n)].join(' ');
}

function ordinalWords(digits) {
  const words = numberWords(digits).split(' ');
  const last = words.at(-1);
  const ordinal = IRREGULAR_ORDINALS.get(last) ?? (last.endsWith('y') ? `${last.slice(0, -1)}ieth` : `${last}th`);
  return [...words.slice(0, -1), ordinal].join(' ');
}

// "90s" -> "nineties", "5s" -> "fives".
const plural = (words) => (words.endsWith('y') ? `${words.slice(0, -1)}ies` : `${words}s`);

// The digits in normalised text read as words: ordinals, plurals, then plain runs.
function spellDigits(text) {
  return text.replace(/%/g, ' percent ')
    .replace(/\b(\d{1,15})(?:st|nd|rd|th)\b/gi, (_, d) => ` ${ordinalWords(d)} `)
    .replace(/\b(\d{1,15})s\b/g, (_, d) => ` ${plural(numberWords(d))} `)
    .replace(/\d+/g, (d) => (d.length > MAX_DIGITS ? d : ` ${numberWords(d)} `));
}

/** Whether `text` has anything the speller changes (else its key is its letters and digits, lower case). */
export const isSpellable = (text) => SPELLABLE_RE.test(String(text).trim());

/** The key of `text` as it is spoken: letters and digits, lower case, after normalize and the speller. */
export function spokenKey(text) {
  const trimmed = String(text).trim();
  const title = TITLE_RE.exec(trimmed);
  const spelled = title ? TITLES.get(title[1].toLowerCase()) : spellDigits(normalize(trimmed));
  return spelled.normalize('NFKC').toLowerCase().replace(NON_WORD_RE, '');
}
