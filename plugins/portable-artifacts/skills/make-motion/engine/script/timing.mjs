// Word timing and the shot timeline: estimated from the text when no voice has
// been synthesised, measured from a voice sidecar's word times when one has.
// Pure: no DOM, no clock, no randomness. The pace (wpm, tail) is the film's
// mode's own, read from the modes registry.
import { parseSay, SayError } from './say.mjs';
import { registries } from '../registry.mjs';
import '../modes/index.mjs';

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

// The shot's say parsed; a SayError names the shot.
function parsedSay(shot) {
  try {
    return parseSay(shot.say);
  } catch (err) {
    if (err instanceof SayError) throw new SayError(`shot "${shot.id}": ${err.message}`, { cause: err });
    throw err;
  }
}

function secondsForShot(shot, pace) {
  if (shot.say === undefined || shot.say === null) {
    const hold = shot.hold ?? DEFAULT_HOLD;
    if (!Number.isFinite(hold) || hold <= 0) {
      throw new RangeError(`shot "${shot.id}": hold must be a positive number, got ${hold}`);
    }
    return { seconds: hold, words: [], sentences: [] };
  }
  const { tokens, trailingPause } = parsedSay(shot);
  const words = estimateWords(tokens, { wpm: pace.wpm });
  return {
    seconds: words.at(-1).end + trailingPause + pace.tail,
    words,
    sentences: groupSentences(tokens, words),
  };
}

/**
 * Seconds from a shot's start to its narration's start. The estimate starts its first word at the shot start (plus
 * that word's own pause), and measured words keep that lead-in: sidecar times are from the first sample of the shot's
 * WAV, and the WAV is placed at narrationStart(shot).
 */
export const NARRATION_LEAD = 0;

/** The film second a timeline shot's narration (its WAV, for a voiced film) starts at. */
export const narrationStart = (shot) => shot.start + NARRATION_LEAD;

// The measured words of `shot` from its sidecar entry, as shot-local seconds in the estimate's shape.
function measuredWords(shot, measured, index, tokens) {
  const where = `words[${index}]`;
  const flat = (Array.isArray(measured.sentences) ? measured.sentences : []).flatMap((s) => (Array.isArray(s?.words) ? s.words : []));
  if (flat.length !== tokens.length) {
    throw new RangeError(`${where}: ${flat.length} words, the say of shot "${shot.id}" has ${tokens.length}`);
  }
  return flat.map((w) => ({ text: w.text, start: w.start + NARRATION_LEAD, end: w.end + NARRATION_LEAD, emphasis: w.emphasis, aside: w.aside }));
}

// A spoken shot timed by its measured words: as long as its last word end plus the trailing pause and the tail, and
// never shorter than its WAV, so the narration cannot run into the next shot.
function measuredShot(shot, pace, measured, index) {
  const { tokens, trailingPause } = parsedSay(shot);
  const words = measuredWords(shot, measured, index, tokens);
  const narration = words.at(-1).end;
  const wav = Number.isFinite(measured.seconds) ? NARRATION_LEAD + measured.seconds : 0;
  return {
    seconds: Math.max(narration + trailingPause + pace.tail, wav),
    words,
    sentences: groupSentences(tokens, words),
  };
}

function checkWords(words, film) {
  if (words === undefined) return;
  if (!Array.isArray(words)) throw new TypeError('words must be the voice sidecar\'s shots array, or undefined');
  if (words.length !== film.shots.length) throw new RangeError(`words: ${words.length} shots, the film has ${film.shots.length}`);
}

// The shot timed by its measured words when the film has them and the shot speaks, else as estimated.
function timedShot(shot, pace, words, index) {
  if (words === undefined) return secondsForShot(shot, pace);
  const measured = words[index];
  if (measured?.id !== shot.id) throw new RangeError(`words[${index}]: shot ${JSON.stringify(measured?.id)}, the film's shot is "${shot.id}"`);
  if (shot.say === undefined || shot.say === null) return secondsForShot(shot, pace);
  return measuredShot(shot, pace, measured, index);
}

const toFrames = (seconds, fps) => Math.ceil(Math.max(MIN_SHOT_SECONDS, seconds) * fps - FRAME_EPSILON);

// { wpm, tail } of the registered mode `name`; the registry's own error for an unknown one.
function paceOf(name, modes) {
  const { wpm, tail } = modes.get(name);
  if (!Number.isFinite(wpm) || wpm <= 0) throw new RangeError(`mode "${name}": wpm must be a positive number, got ${wpm}`);
  if (!Number.isFinite(tail) || tail < 0) throw new RangeError(`mode "${name}": tail must be a number of seconds, 0 or more, got ${tail}`);
  return { wpm, tail };
}

/**
 * The shot timeline of `film` at `fps`, each spoken shot paced by its mode (the registered mode's wpm and tail).
 * `modes` is the modes registry (default: the shared one; the validator passes the registries it checked with).
 * `words` is a voice sidecar's `shots` list (scripts/v2/voice/sidecar.mjs), one entry per film shot, or undefined.
 * With it every spoken shot takes its word times from the sidecar (from narrationStart) and `timed` is 'measured'; a
 * sidecar that does not match the film throws, never falling back to the estimate. Without it, 'estimated'.
 */
export function buildTimeline(film, { fps, modes = registries.modes, words } = {}) {
  if (!Number.isFinite(fps) || fps <= 0) throw new RangeError(`fps must be a positive number, got ${fps}`);
  if (!Array.isArray(film.shots)) throw new TypeError('film.shots must be an array');
  checkWords(words, film);
  const pace = paceOf(film.mode ?? DEFAULT_MODE, modes);

  let startFrame = 0;
  const shots = film.shots.map((shot, index) => {
    const { seconds, words: shotWords, sentences } = timedShot(shot, pace, words, index);
    const frames = toFrames(seconds, fps);
    const entry = {
      id: shot.id,
      index,
      start: startFrame / fps,
      end: (startFrame + frames) / fps,
      duration: frames / fps,
      words: shotWords,
      sentences,
    };
    startFrame += frames;
    return entry;
  });
  return { fps, duration: startFrame / fps, frameCount: startFrame, timed: words === undefined ? 'estimated' : 'measured', shots };
}
