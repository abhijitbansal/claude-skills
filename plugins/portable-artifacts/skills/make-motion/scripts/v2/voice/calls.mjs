// A shot's parsed narration as the list of synthesis calls and silences the speech model is given.
// Pure: no phonemiser, no clock. The model can take at most MAX_IDS ids per call, and the ids depend on phonemes (which
// need the optional package), so the caller injects `countIds(tokenIndexes) -> number` (synchronous: phonemise first,
// then count from the phonemes) and this module only asks it.
//
// A call ends at a real sentence end, at a pause mark (the pause is a `silence`), and at the edge of an aside. A real
// sentence end is a token that ends in . ! ? and is not a title or abbreviation, or an initial, that the voice's text
// normalisation reads as part of the sentence (see ABBREVIATIONS). With emphasisPause 0 an emphasised word never ends a
// call (stress promotion happens later, at synthesis: the calls only keep the token indexes). Above 0 a silence of that
// length is put before an emphasised word, ending the call there when the word is in the middle of one.
// A run of tokens with nothing speakable (only dashes or punctuation) is a `skip`, not a call: every token index of the
// shot appears exactly once, in order, across the speech and skip items.
// `trailingPause` of parseSay is not a token and is not planned here: it belongs to the shot's tail.
import { VOICE_SPEED_MAX, VOICE_SPEED_MIN } from '../../../engine/modes/index.mjs';
import { EMBEDDED_VOCAB, VoiceTextError } from './tokens.mjs';

export const ASIDE_SPEED_FACTOR = 1 / 0.85;
export const MAX_IDS = 512;

// Abbreviations that do not end a sentence by themselves, lower case, without the dot. TITLES are followed by a name
// and never end one. SUFFIXES (and `etc.`) end a sentence only when a capitalised word follows.
// Dr Mr Ms Mrs etc are the ones kokoro's text normalisation (phonemes.mjs normalize) rewrites; test/v2/voice-calls.test.mjs
// proves every abbreviation normalize handles is listed. The rest are common ones it leaves alone but a call must not split at.
const TITLES = Object.freeze(['dr', 'mr', 'ms', 'mrs', 'prof', 'st', 'vs', 'mt', 'gen', 'capt', 'lt', 'col', 'rev', 'sgt', 'hon']);
const SUFFIXES = Object.freeze(['etc', 'jr', 'sr', 'inc']);
export const ABBREVIATIONS = Object.freeze([...TITLES, ...SUFFIXES]);

// Characters of a trailing quote or bracket, and of a leading one, around a token's word.
const CLOSERS_RE = /["')\]}\u201d\u2019]+$/;
const OPENERS_RE = /^["'([{\u201c\u2018]+/;
const SINGLE_INITIAL_RE = /^\p{L}\.$/u;
const DOTTED_INITIALS_RE = /^(?:\p{L}\.){2,}$/u;
const CAPITAL_START_RE = /^[^\p{L}\p{N}]*\p{Lu}/u;
// A clause ends after a token whose text ends in , ; : or a dash (closing quotes and brackets may follow), or after a
// token that is only hyphens (a spaced dash).
const CLAUSE_END_RE = /(?:[,;:\u2013\u2014]["')\]}\u201d\u2019]*|^-+)$/;
// Nothing a voice can say: only dashes, quotes, brackets and sentence punctuation.
const UNSPEAKABLE_RE = /^[-.,;:!?'"()[\]{}\u2013\u2014\u2026\u201c\u201d\u2018\u2019]+$/;

const silence = (seconds) => ({ kind: 'silence', seconds });
const levelOf = (token) => (token.aside ? 'aside' : 'normal');
const isUnspeakable = (token) => UNSPEAKABLE_RE.test(token.text);

function checkOptions({ speed, emphasisPause, countIds }) {
  if (!Number.isFinite(speed) || speed < VOICE_SPEED_MIN || speed > VOICE_SPEED_MAX) {
    throw new RangeError(`planCalls: speed must be a number from ${VOICE_SPEED_MIN} to ${VOICE_SPEED_MAX}, got ${speed}`);
  }
  if (!Number.isFinite(emphasisPause) || emphasisPause < 0) {
    throw new TypeError(`planCalls: emphasisPause must be a number of seconds, 0 or more, got ${emphasisPause}`);
  }
  if (typeof countIds !== 'function') {
    throw new TypeError('planCalls: countIds(tokenIndexes) is required: it says how many ids a call would have, so the 512 limit can be kept');
  }
}

// `countIds` wrapped so a result that is not a finite number (a Promise from an async phonemiser, undefined) is a
// TypeError that says what the contract is, not a nonsense limit message.
function checkedCounter(countIds) {
  return (indexes) => {
    const count = countIds(indexes);
    if (Number.isInteger(count) && count >= 0) return count;
    const isPromise = count !== null && typeof count === 'object' && typeof count.then === 'function';
    throw new TypeError(`planCalls: countIds must return a non-negative integer synchronously (phonemise first, then count), got ${isPromise ? 'a Promise' : String(count)}`);
  };
}

// Whether `token`, which carries a sentence-end mark, really ends a sentence: not after a title, not after a single
// initial, and after dotted initials, `etc.`, `Jr.` and the like only when a capitalised word follows.
function endsSentence(token, next) {
  if (!token.sentenceEnd) return false;
  const word = token.text.replace(CLOSERS_RE, '').replace(OPENERS_RE, '');
  if (!word.endsWith('.') || word.endsWith('..')) return true;
  const stem = word.slice(0, -1).toLowerCase();
  const capitalNext = CAPITAL_START_RE.test(next?.text ?? '');
  if (TITLES.includes(stem)) return false;
  if (SUFFIXES.includes(stem)) return capitalNext;
  if (SINGLE_INITIAL_RE.test(word)) return false;
  if (DOTTED_INITIALS_RE.test(word)) return capitalNext;
  return true;
}

// Speech calls (`{ kind, tokens, level }`, no speed yet) and silences, cut at sentence ends, pause marks and aside
// edges, with a silence before the first word of an emphasis run when emphasisPause is above 0 (not before the first
// spoken word of the say, not inside a run that crosses a sentence end, and not after a pause mark, which is already
// a silence).
function segment(tokens, emphasisPause) {
  const firstSpoken = tokens.findIndex((token) => !isUnspeakable(token));
  const items = [];
  let call = null;
  const close = () => {
    if (call) items.push(call);
    call = null;
  };
  tokens.forEach((token, index) => {
    if (token.pauseBefore > 0) {
      close();
      items.push(silence(token.pauseBefore));
    } else if (call && call.level !== levelOf(token)) {
      close();
    }
    const startsEmphasis = token.emphasis && !tokens[index - 1]?.emphasis;
    if (emphasisPause > 0 && startsEmphasis && index > firstSpoken && !(token.pauseBefore > 0)) {
      close();
      items.push(silence(emphasisPause));
    }
    call ??= { kind: 'speech', tokens: [], level: levelOf(token) };
    call.tokens.push(index);
    if (endsSentence(token, tokens[index + 1])) close();
  });
  close();
  return items;
}

function limitMessage({ shotId, ids, indexes, tokens, hasBoundary }) {
  const where = shotId === undefined ? 'a shot' : `shot "${shotId}"`;
  const head = `${where}: a stretch of narration is ${ids} model ids, over the limit of ${MAX_IDS}`;
  if (indexes.length === 1) {
    return `${head}; it is the single word "${tokens[indexes[0]].text}", which cannot be split; write it shorter or as a pronunciation hint`;
  }
  if (hasBoundary) {
    return `${head}; it has a comma, semicolon, colon or dash, but even the part up to the first one is over the limit; add punctuation sooner or split the sentence`;
  }
  return `${head}, and has no comma, semicolon, colon or dash to split it at; add punctuation or split the sentence`;
}

// Splits `indexes` into pieces of at most MAX_IDS ids, each cut after a clause end, taking the longest piece that fits.
// `count` is monotone in the prefix, so the scan stops at the first clause end whose prefix no longer fits.
function fitIds(indexes, tokens, count, shotId) {
  const ids = count(indexes);
  if (ids <= MAX_IDS) return [indexes];
  let cut = 0;
  let hasBoundary = false;
  for (let end = 1; end < indexes.length; end++) {
    if (!CLAUSE_END_RE.test(tokens[indexes[end - 1]].text)) continue;
    hasBoundary = true;
    if (count(indexes.slice(0, end)) > MAX_IDS) break;
    cut = end;
  }
  if (cut === 0) throw new VoiceTextError(limitMessage({ shotId, ids, indexes, tokens, hasBoundary }));
  return [indexes.slice(0, cut), ...fitIds(indexes.slice(cut), tokens, count, shotId)];
}

/**
 * `sayTokens` (parseSay(say).tokens) as an array of
 * `{ kind: 'speech', tokens: number[], speed, level: 'normal' | 'aside' }`, `{ kind: 'silence', seconds }` and
 * `{ kind: 'skip', tokens: number[] }` (tokens with nothing speakable; nothing is synthesised for them).
 * `tokens` are indexes into `sayTokens`. Aside calls run at speed * ASIDE_SPEED_FACTOR, at most VOICE_SPEED_MAX.
 * `speed` must be VOICE_SPEED_MIN to VOICE_SPEED_MAX (RangeError otherwise). `countIds(tokenIndexes)` is the model's id
 * count for a call over those tokens (pads included); a call over MAX_IDS is split at a clause end, and a VoiceTextError
 * naming `shotId` is thrown when it cannot be. The result and the arrays in it are frozen.
 */
export function planCalls(sayTokens, { speed, emphasisPause, countIds, shotId } = {}) {
  checkOptions({ speed, emphasisPause, countIds });
  const count = checkedCounter(countIds);
  const asideSpeed = Math.min(speed * ASIDE_SPEED_FACTOR, VOICE_SPEED_MAX);
  const isSilent = (indexes) => indexes.every((i) => isUnspeakable(sayTokens[i]));
  const items = segment(sayTokens, emphasisPause).flatMap((item) => {
    if (item.kind === 'silence') return [Object.freeze(item)];
    const callSpeed = item.level === 'aside' ? asideSpeed : speed;
    const pieces = isSilent(item.tokens) ? [item.tokens] : fitIds(item.tokens, sayTokens, count, shotId);
    return pieces.map((tokens) => Object.freeze(isSilent(tokens)
      ? { kind: 'skip', tokens: Object.freeze(tokens) }
      : { kind: 'speech', tokens: Object.freeze(tokens), speed: callSpeed, level: item.level }));
  });
  return Object.freeze(items);
}

// ---- pronunciation hints ----
// A hint (`[word](/ipa/)`) holds phoneme characters only: in the voice's vocab (embedded in tokens.mjs, so no download is
// needed), and not the pad, a space or punctuation (each would split the narration token or put a pad inside it), and not
// a character the voice's text rules rewrite (so the sound written is the sound spoken). Refused, never rewritten.
// The validator (spec.mjs) and the synthesiser both go through here, so they see the same string.
const HINT_PAD = '$';
const HINT_PUNCTUATION = new Set([...';:,.!?\u2014\u2026"()\u201c\u201d']);
const HINT_REWRITTEN = new Map([['r', '\u0279'], ['x', 'k'], ['\u02b2', 'j']]);

const codePoint = (char) => `U+${char.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`;

// Why `char` may not be in a hint, or null when it may.
function hintRefusal(char) {
  if (char === HINT_PAD) return 'the model pad, not a sound';
  if (char === ' ') return 'a space; a hint is the sound of one word';
  if (HINT_PUNCTUATION.has(char)) return 'punctuation, which splits the narration';
  if (HINT_REWRITTEN.has(char)) return `the voice rewrites it to "${HINT_REWRITTEN.get(char)}"; write that instead`;
  return EMBEDDED_VOCAB.has(char) ? null : 'not a character the voice has';
}

/**
 * The refused characters of a hint, checked after Unicode NFC normalisation, as strings such as
 * `"x" (U+0078, the voice rewrites it to "k"; write that instead)`, each character once. Empty when the hint is fine.
 */
export function hintRefusals(ipa) {
  return [...new Set([...ipa.normalize('NFC')])].flatMap((char) => {
    const why = hintRefusal(char);
    return why === null ? [] : [`"${char}" (${codePoint(char)}, ${why})`];
  });
}

/** The string the synthesiser must use for a hint: `ipa` in NFC. Throws VoiceTextError naming the refused characters. */
export function hintPhonemes(ipa) {
  const refused = hintRefusals(ipa);
  if (refused.length > 0) throw new VoiceTextError(`pronunciation hint /${ipa}/ has characters the voice cannot take: ${refused.join(', ')}`);
  return ipa.normalize('NFC');
}
