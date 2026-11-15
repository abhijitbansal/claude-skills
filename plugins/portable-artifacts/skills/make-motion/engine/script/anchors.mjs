// Anchors: where in a shot a device fires. Pure: no DOM, no clock, no randomness.
//
// An anchor is a number of seconds, or one of these forms, each optionally
// followed by +<s> or -<s> (seconds):
//   start            the first moment of the shot
//   end              the last moment of the shot (its duration)
//   word:<n>         the start of word n, counting from 0
//   word:<text>      the start of the first word whose letters and digits match
//                    <text> without regard to case ("word:FILE" finds "file.");
//                    an all-digit <text> is read as an index, not a word. The
//                    whole text is tried as a word first, so "word:covid-19"
//                    finds "covid-19"; only if no word matches is a trailing
//                    +<s> or -<s> split off as an offset ("word:file-0.08").
//   sentence:<n>     the start of sentence n, counting from 0
//   beat:<n>         refused until the engine has music
// A numeric string such as "1.5" is seconds. The result is in shot-local
// seconds, rounded to 1e-6 and clamped to [0, shot.duration].

export class AnchorError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AnchorError';
  }
}

const FORMS = 'a number of seconds, "start", "end", "word:<n>", "word:<text>" or "sentence:<n>", '
  + 'each optionally followed by +<s> or -<s> (for example "word:file-0.08")';
const BEAT_MESSAGE = 'beat anchors need music, which this build does not have yet';
const ROUNDING = 1e6;
const WORD_PREFIX = 'word:';

// How much of a user's value an error message may repeat.
export const ECHO_LIMIT = 80;
const ELLIPSIS = '...';
const CONTROL_RE = /[\p{Cc}\u2028\u2029]/gu;

const SECONDS_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
// A base, then an optional signed number of seconds. The base is lazy so the
// offset claims "-0.08" in "word:file-0.08", and any character may be in it
// (a line terminator included) so the pattern always matches.
const OFFSET_RE = /^([\s\S]*?)([+-](?:\d+(?:\.\d+)?|\.\d+))?$/;
const INDEX_RE = /^\d+$/;
// Digits only, with or without an offset: always the index form, never a word.
const INDEX_FORM_RE = /^\d+(?:[+-](?:\d+(?:\.\d+)?|\.\d+))?$/;
const WHITESPACE_RE = /\s/;
const NON_WORD_RE = /[^\p{L}\p{N}]/gu;

// Enough UTF-16 units to hold more than ECHO_LIMIT code points (4 each at most).
const PREFIX_UNITS = ECHO_LIMIT * 4;

function jsonText(value) {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

// A user's value as an error message may repeat it: one line, at most
// ECHO_LIMIT code points (never a cut inside a surrogate pair). Strings stay
// as they are; anything else is JSON. Only a prefix is looked at, so a huge
// value costs no more than a short one.
export function echoValue(value) {
  const text = typeof value === 'string' ? value : jsonText(value);
  const points = Array.from(text.slice(0, PREFIX_UNITS).replace(CONTROL_RE, ' '));
  if (points.length <= ECHO_LIMIT) return points.join('');
  return `${points.slice(0, ECHO_LIMIT - ELLIPSIS.length).join('')}${ELLIPSIS}`;
}

// echoValue for a message: a string in quotes, anything else as plain JSON, so
// "3" and 3 read differently.
export const showValue = (value) => (typeof value === 'string' ? JSON.stringify(echoValue(value)) : echoValue(value));

const letters = (text) => text.replace(NON_WORD_RE, '').toLowerCase();
const plural = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`;
const rangeOf = (prefix, count) => (count === 1 ? `${prefix}:0` : `${prefix}:0 to ${prefix}:${count - 1}`);

function badForm(ref) {
  return new AnchorError(`cannot read anchor ${showValue(ref)}; use ${FORMS}`);
}

function requireNarration(shot) {
  if (shot.words.length === 0) {
    throw new AnchorError(`shot "${echoValue(shot.id)}" has no narration; word and sentence anchors need a say (use start, end or seconds)`);
  }
}

function findWord(text, shot) {
  const wanted = letters(text);
  return wanted === '' ? undefined : shot.words.find((word) => letters(word.text) === wanted);
}

function wordStart(arg, shot) {
  requireNarration(shot);
  if (INDEX_RE.test(arg)) {
    const index = Number(arg);
    if (index >= shot.words.length) {
      throw new AnchorError(`word:${echoValue(arg)} is out of range in shot "${echoValue(shot.id)}"; it has ${plural(shot.words.length, 'word')} (${rangeOf('word', shot.words.length)})`);
    }
    return shot.words[index].start;
  }
  const found = findWord(arg, shot);
  if (found) return found.start;
  const spoken = shot.words.map((word) => word.text).join(', ');
  throw new AnchorError(`no word "${echoValue(arg)}" in shot "${echoValue(shot.id)}"; its words are: ${spoken}`);
}

function sentenceStart(arg, shot) {
  requireNarration(shot);
  const index = Number(arg);
  if (index >= shot.sentences.length) {
    throw new AnchorError(`sentence:${echoValue(arg)} is out of range in shot "${echoValue(shot.id)}"; it has ${plural(shot.sentences.length, 'sentence')} (${rangeOf('sentence', shot.sentences.length)})`);
  }
  return shot.sentences[index].start;
}

// The start of a word named by all of `text` ("word:covid-19"), or null when
// `text` is not a word anchor or no word matches it whole.
function wholeWordStart(text, shot) {
  if (!text.startsWith(WORD_PREFIX)) return null;
  const arg = text.slice(WORD_PREFIX.length);
  if (arg === '' || INDEX_FORM_RE.test(arg) || WHITESPACE_RE.test(arg)) return null;
  return findWord(arg, shot)?.start ?? null;
}

// The shot-local second a base form names, before any offset.
function baseSeconds(base, shot, ref) {
  if (base === 'start') return 0;
  if (base === 'end') return shot.duration;
  if (base.startsWith('beat:')) throw new AnchorError(BEAT_MESSAGE);
  if (base.startsWith(WORD_PREFIX) && base.length > WORD_PREFIX.length) {
    const arg = base.slice(WORD_PREFIX.length);
    if (WHITESPACE_RE.test(arg)) throw badForm(ref); // no word is spoken with whitespace inside it
    return wordStart(arg, shot);
  }
  const sentence = /^sentence:(\d+)$/.exec(base);
  if (sentence) return sentenceStart(sentence[1], shot);
  throw badForm(ref);
}

function secondsOf(ref, shot) {
  if (typeof ref === 'number') {
    if (!Number.isFinite(ref)) throw badForm(ref);
    return ref;
  }
  if (typeof ref !== 'string') throw badForm(ref);
  const text = ref; // not trimmed: stray whitespace is a bad form, listed with the good ones
  if (SECONDS_RE.test(text)) return Number(text);
  const whole = wholeWordStart(text, shot);
  if (whole !== null) return whole;
  const match = OFFSET_RE.exec(text);
  if (!match) throw badForm(ref);
  const [, base, offset] = match;
  if (/[+-]$/.test(base)) throw badForm(ref);
  return baseSeconds(base, shot, ref) + (offset === undefined ? 0 : Number(offset));
}

export function resolveAnchor(ref, shot) {
  const seconds = secondsOf(ref, shot);
  const rounded = Math.round(seconds * ROUNDING) / ROUNDING;
  return Math.min(shot.duration, Math.max(0, rounded));
}
