// Anchors: where in a shot a device fires. Pure: no DOM, no clock, no randomness.
//
// An anchor is a number of seconds, or one of these forms, each optionally
// followed by +<s> or -<s> (seconds):
//   start            the first moment of the shot
//   end              the last moment of the shot (its duration)
//   word:<n>         the start of word n, counting from 0
//   word:<text>      the start of the first word whose letters and digits match
//                    <text> without regard to case ("word:FILE" finds "file.");
//                    an all-digit <text> is read as an index, not a word
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

const SECONDS_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
// A base, then an optional signed number of seconds. The base is lazy so the
// offset claims "-0.08" in "word:file-0.08".
const OFFSET_RE = /^(.*?)([+-](?:\d+(?:\.\d+)?|\.\d+))?$/;
const INDEX_RE = /^\d+$/;
const NON_WORD_RE = /[^\p{L}\p{N}]/gu;

const letters = (text) => text.replace(NON_WORD_RE, '').toLowerCase();
const plural = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`;
const rangeOf = (prefix, count) => (count === 1 ? `${prefix}:0` : `${prefix}:0 to ${prefix}:${count - 1}`);

function badForm(ref) {
  return new AnchorError(`cannot read anchor ${JSON.stringify(ref)}; use ${FORMS}`);
}

function requireNarration(shot) {
  if (shot.words.length === 0) {
    throw new AnchorError(`shot "${shot.id}" has no narration; word and sentence anchors need a say (use start, end or seconds)`);
  }
}

function wordStart(arg, shot) {
  requireNarration(shot);
  if (INDEX_RE.test(arg)) {
    const index = Number(arg);
    if (index >= shot.words.length) {
      throw new AnchorError(`word:${arg} is out of range in shot "${shot.id}"; it has ${plural(shot.words.length, 'word')} (${rangeOf('word', shot.words.length)})`);
    }
    return shot.words[index].start;
  }
  const wanted = letters(arg);
  const found = wanted === '' ? undefined : shot.words.find((word) => letters(word.text) === wanted);
  if (found) return found.start;
  const spoken = shot.words.map((word) => word.text).join(', ');
  throw new AnchorError(`no word "${arg}" in shot "${shot.id}"; its words are: ${spoken}`);
}

function sentenceStart(arg, shot) {
  requireNarration(shot);
  const index = Number(arg);
  if (index >= shot.sentences.length) {
    throw new AnchorError(`sentence:${arg} is out of range in shot "${shot.id}"; it has ${plural(shot.sentences.length, 'sentence')} (${rangeOf('sentence', shot.sentences.length)})`);
  }
  return shot.sentences[index].start;
}

// The shot-local second a base form names, before any offset.
function baseSeconds(base, shot, ref) {
  if (base === 'start') return 0;
  if (base === 'end') return shot.duration;
  if (base.startsWith('beat:')) throw new AnchorError(BEAT_MESSAGE);
  if (base.startsWith('word:') && base.length > 'word:'.length) return wordStart(base.slice('word:'.length), shot);
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
  const text = ref.trim();
  if (SECONDS_RE.test(text)) return Number(text);
  const [, base, offset] = OFFSET_RE.exec(text);
  if (/[+-]$/.test(base)) throw badForm(ref);
  return baseSeconds(base, shot, ref) + (offset === undefined ? 0 : Number(offset));
}

export function resolveAnchor(ref, shot) {
  const seconds = secondsOf(ref, shot);
  const rounded = Math.round(seconds * ROUNDING) / ROUNDING;
  return Math.min(shot.duration, Math.max(0, rounded));
}
