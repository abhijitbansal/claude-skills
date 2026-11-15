// Estimated word timing and the shot timeline, used when no voice has been
// synthesised. Pure: no DOM, no clock, no randomness.
import { parseSay, SayError } from './say.mjs';

export const MODE_PACE = Object.freeze({
  pro: Object.freeze({ wpm: 150, tail: 0.6 }),
  viral: Object.freeze({ wpm: 175, tail: 0.3 }),
});

const LETTERS_PER_WORD = 5;
const LENGTH_FACTOR_MIN = 0.6;
const LENGTH_FACTOR_MAX = 1.8;
const EMPHASIS_STRETCH = 1.15;
const EMPHASIS_LEAD = 0.12;
const ASIDE_STRETCH = 0.85;
const SENTENCE_GAP = 0.25;
const DEFAULT_MODE = 'pro';
const DEFAULT_HOLD = 2;
const MIN_SHOT_SECONDS = 1;
// Guards ceil() against float noise such as 0.1 * 30 = 3.0000000000000004.
const FRAME_EPSILON = 1e-6;
const LETTER_RE = /[\p{L}\p{N}]/gu;

const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));

// Letters and digits only; symbols and emoji count as one.
function countLetters(text) {
  return Math.max(1, (text.match(LETTER_RE) ?? []).length);
}

function wordSeconds(token, wpm) {
  const length = clamp(countLetters(token.text) / LETTERS_PER_WORD, LENGTH_FACTOR_MIN, LENGTH_FACTOR_MAX);
  const stretch = (token.emphasis ? EMPHASIS_STRETCH : 1) * (token.aside ? ASIDE_STRETCH : 1);
  return (60 / wpm) * length * stretch;
}

export function estimateWords(tokens, { wpm } = {}) {
  if (!Number.isFinite(wpm) || wpm <= 0) throw new RangeError(`wpm must be a positive number, got ${wpm}`);
  let cursor = 0;
  return tokens.map((token) => {
    const start = cursor + token.pauseBefore + (token.emphasis ? EMPHASIS_LEAD : 0);
    const end = start + wordSeconds(token, wpm);
    cursor = end + (token.sentenceEnd ? SENTENCE_GAP : 0);
    return { text: token.text, start, end, emphasis: token.emphasis, aside: token.aside };
  });
}

// One sentence per sentence-ending word; a trailing run without one counts too.
function groupSentences(tokens, words) {
  const sentences = [];
  let first = 0;
  tokens.forEach((token, last) => {
    if (!token.sentenceEnd && last !== tokens.length - 1) return;
    sentences.push({ start: words[first].start, end: words[last].end, first, last });
    first = last + 1;
  });
  return sentences;
}

function secondsForShot(shot, pace) {
  if (shot.say === undefined || shot.say === null) {
    const hold = shot.hold ?? DEFAULT_HOLD;
    if (!Number.isFinite(hold) || hold <= 0) {
      throw new RangeError(`shot "${shot.id}": hold must be a positive number, got ${hold}`);
    }
    return { seconds: hold, words: [], sentences: [] };
  }
  let parsed;
  try {
    parsed = parseSay(shot.say);
  } catch (err) {
    if (err instanceof SayError) throw new SayError(`shot "${shot.id}": ${err.message}`, { cause: err });
    throw err;
  }
  const { tokens, trailingPause } = parsed;
  const words = estimateWords(tokens, { wpm: pace.wpm });
  return {
    seconds: words.at(-1).end + trailingPause + pace.tail,
    words,
    sentences: groupSentences(tokens, words),
  };
}

const toFrames = (seconds, fps) => Math.ceil(Math.max(MIN_SHOT_SECONDS, seconds) * fps - FRAME_EPSILON);

export function buildTimeline(film, { fps } = {}) {
  if (!Number.isFinite(fps) || fps <= 0) throw new RangeError(`fps must be a positive number, got ${fps}`);
  const mode = film.mode ?? DEFAULT_MODE;
  if (!Object.hasOwn(MODE_PACE, mode)) throw new Error(`unknown mode "${mode}"`);
  if (!Array.isArray(film.shots)) throw new TypeError('film.shots must be an array');
  const pace = MODE_PACE[mode];

  let startFrame = 0;
  const shots = film.shots.map((shot, index) => {
    const { seconds, words, sentences } = secondsForShot(shot, pace);
    const frames = toFrames(seconds, fps);
    const entry = {
      id: shot.id,
      index,
      start: startFrame / fps,
      end: (startFrame + frames) / fps,
      duration: frames / fps,
      words,
      sentences,
    };
    startFrame += frames;
    return entry;
  });
  return { fps, duration: startFrame / fps, frameCount: startFrame, timed: 'estimated', shots };
}
