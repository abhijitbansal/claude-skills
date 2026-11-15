// Phoneme strings for Kokoro narration, built exactly as kokoro-js 1.2.1 builds them for an American voice.
//
// `normalize` and `toPhonemes` are a transcription of kokoro-js 1.2.1 (dist/kokoro.js, the unexported text function),
// package author hexgrad, licensed under the Apache License, Version 2.0.
// Changes: readable names, the phonemizer is injected, ES module exports.
// The transcription matched kokoro-js's own phoneme string on 21 of 21 recorded calls (test/v2/voice-phonemes.test.mjs).
//
// Pure: no I/O. The phonemizer is passed in as `phonemize(text, lang) -> Promise<string[]>`.

const PHONEMIZER_LANG = 'en-us';
const PRIMARY_STRESS = 'ˈ';
const SECONDARY_STRESS = 'ˌ';
const VOWELS = new Set([...'aeiouɑɐɒæɔəɚɛɜɪʊʌᵻAIOɨ']);

// Number and money spelling, kokoro-js's helpers in the same order.
function splitNum(e) {
  if (e.includes('.')) return e;
  if (e.includes(':')) {
    const [a, t] = e.split(':').map(Number);
    if (t === 0) return `${a} o'clock`;
    return t < 10 ? `${a} oh ${t}` : `${a} ${t}`;
  }
  const a = parseInt(e.slice(0, 4), 10);
  if (a < 1100 || a % 1000 < 10) return e;
  const t = e.slice(0, 2);
  const r = parseInt(e.slice(2, 4), 10);
  const n = e.endsWith('s') ? 's' : '';
  if (a % 1000 >= 100 && a % 1000 <= 999) {
    if (r === 0) return `${t} hundred${n}`;
    if (r < 10) return `${t} oh ${r}${n}`;
  }
  return `${t} ${r}${n}`;
}

function flipMoney(e) {
  const a = e[0] === '$' ? 'dollar' : 'pound';
  if (isNaN(Number(e.slice(1)))) return `${e.slice(1)} ${a}s`;
  if (!e.includes('.')) {
    const t = e.slice(1) === '1' ? '' : 's';
    return `${e.slice(1)} ${a}${t}`;
  }
  const [t, r] = e.slice(1).split('.');
  const n = parseInt(r.padEnd(2, '0'), 10);
  const coin = e[0] === '$' ? (n === 1 ? 'cent' : 'cents') : (n === 1 ? 'penny' : 'pence');
  return `${t} ${a}${t === '1' ? '' : 's'} and ${n} ${coin}`;
}

function pointNum(e) {
  const [a, t] = e.split('.');
  return `${a} point ${t.split('').join(' ')}`;
}

const PUNCT = ';:,.!?¡¿—…"«»“”(){}[]';
const PUNCT_RE = new RegExp(`(\\s*[${PUNCT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}]+\\s*)+`, 'g');

/** Text as kokoro-js normalises it before phonemising (quotes, brackets, titles, numbers, money, acronyms). */
export function normalize(text) {
  // The single (non-global) `/  +/` is kokoro-js's own; it is kept so the strings stay identical.
  return text.replace(/[‘’]/g, "'").replace(/«/g, '“').replace(/»/g, '”').replace(/[“”]/g, '"')
    .replace(/\(/g, '«').replace(/\)/g, '»')
    .replace(/、/g, ', ').replace(/。/g, '. ').replace(/！/g, '! ').replace(/，/g, ', ').replace(/：/g, ': ').replace(/；/g, '; ').replace(/？/g, '? ')
    .replace(/[^\S \n]/g, ' ').replace(/  +/, ' ').replace(/(?<=\n) +(?=\n)/g, '')
    .replace(/\bD[Rr]\.(?= [A-Z])/g, 'Doctor').replace(/\b(?:Mr\.|MR\.(?= [A-Z]))/g, 'Mister').replace(/\b(?:Ms\.|MS\.(?= [A-Z]))/g, 'Miss')
    .replace(/\b(?:Mrs\.|MRS\.(?= [A-Z]))/g, 'Mrs').replace(/\betc\.(?! [A-Z])/gi, 'etc').replace(/\b(y)eah?\b/gi, "$1e'a")
    .replace(/\d*\.\d+|\b\d{4}s?\b|(?<!:)\b(?:[1-9]|1[0-2]):[0-5]\d\b(?!:)/g, splitNum)
    .replace(/(?<=\d),(?=\d)/g, '')
    .replace(/[$£]\d+(?:\.\d+)?(?: hundred| thousand| (?:[bm]|tr)illion)*\b|[$£]\d+\.\d\d?\b/gi, flipMoney)
    .replace(/\d*\.\d+/g, pointNum).replace(/(?<=\d)-(?=\d)/g, ' to ').replace(/(?<=\d)S/g, ' S')
    .replace(/(?<=[BCDFGHJ-NP-TV-Z])'?s\b/g, "'S").replace(/(?<=X')S\b/g, 's')
    .replace(/(?:[A-Za-z]\.){2,} [a-z]/g, (m) => m.replace(/\./g, '-')).replace(/(?<=[A-Z])\.(?=[A-Z])/gi, '-')
    .trim();
}

// Splits `text` into runs that match `re` (punctuation with its spaces) and runs between them, in order.
function splitKeep(text, re) {
  const parts = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (last < m.index) parts.push({ isPunct: false, text: text.slice(last, m.index) });
    if (m[0].length > 0) parts.push({ isPunct: true, text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ isPunct: false, text: text.slice(last) });
  return parts;
}

// kokoro-js's replacements on the joined phoneme string (American voice).
function postReplace(phonemes) {
  return phonemes
    .replace(/kəkˈoːɹoʊ/g, 'kˈoʊkəɹoʊ').replace(/kəkˈɔːɹəʊ/g, 'kˈəʊkəɹəʊ').replace(/ʲ/g, 'j').replace(/r/g, 'ɹ').replace(/x/g, 'k')
    .replace(/ɬ/g, 'l').replace(/(?<=[a-zɹː])(?=hˈʌndɹɪd)/g, ' ').replace(/ z(?=[;:,.!?¡¿—…"«»“” ]|$)/g, 'z')
    .replace(/(?<=nˈaɪn)ti(?!ː)/g, 'di')
    .trim();
}

/**
 * The phoneme string kokoro-js 1.2.1 builds for `clause`: normalise, split on punctuation, phonemise the rest as en-us,
 * join, post-replacements. Phonemise a whole clause, never a word alone (espeak changes words out of context).
 */
export async function toPhonemes(clause, phonemize) {
  const parts = splitKeep(normalize(clause), PUNCT_RE);
  const pieces = await Promise.all(parts.map(async ({ isPunct, text }) => (
    isPunct ? text : (await phonemize(text, PHONEMIZER_LANG)).join(' ')
  )));
  return postReplace(pieces.join(''));
}

// One space-free phoneme group: secondary becomes primary, else primary goes before the first vowel. No vowel: unchanged.
function promoteGroup(group) {
  if (group.includes(PRIMARY_STRESS)) return group;
  if (group.includes(SECONDARY_STRESS)) return group.replace(SECONDARY_STRESS, PRIMARY_STRESS);
  const chars = [...group];
  const vowel = chars.findIndex((c) => VOWELS.has(c));
  if (vowel < 0) return group;
  return [...chars.slice(0, vowel), PRIMARY_STRESS, ...chars.slice(vowel)].join('');
}

/**
 * Emphasis as stress: a word without primary stress gets one (its secondary is promoted, or a primary goes before its
 * first vowel); a word that already has primary stress is unchanged. A token that spans several phoneme words
 * (`2024`) is promoted group by group.
 */
export function promoteStress(wordPhonemes) {
  return wordPhonemes.split(' ').map(promoteGroup).join(' ');
}
