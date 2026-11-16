// The voice sidecar (version 1): the measured word times of a film's narration, one entry per shot.
//
// { version: 1, model: { id, commit, file, sha256 }, voice, sampleRate: 24000,
//   shots: [{ id, wav, seconds, sentences: [{ start, end, words: [{ text, start, end, emphasis, aside }] }] }] }
//
// `wav` is the file name of the shot's narration beside the sidecar, or null for a shot without `say`. Every time is in
// seconds from the first sample of that shot's WAV, rounded to TIME_STEP; `seconds` is the WAV's length. The sidecar
// holds no film-level time: where a shot sits in the film is the timeline's business.
//
// The words of an author's own recording (`voice: { src, words }`, one file for the whole film) have the same shape with
// every `wav` null and every time in seconds from the first sample of that one file; `seconds` is the shot's last word
// end in it. fromWhisper reads them from a Whisper word-timestamp JSON, the only words file accepted.
import { randomUUID } from 'node:crypto';
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { parseSay } from '../../../engine/script/say.mjs';
import { SAMPLE_RATE } from './words.mjs';

export const SIDECAR_VERSION = 1;
export const SIDECAR_FILE = 'voice.json';
/** The file name of shot `index`'s narration beside the sidecar; the only name a sidecar may give. */
export const wavName = (index) => `shot-${index}.wav`;
const TIME_STEPS_PER_SECOND = 1e4;
const JSON_INDENT = 2;

export class SidecarError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'SidecarError';
  }
}

/** Seconds rounded to 1e-4. */
export const roundTime = (seconds) => Math.round(seconds * TIME_STEPS_PER_SECOND) / TIME_STEPS_PER_SECOND;

/**
 * Words grouped into sentences: a sentence ends at a token with `sentenceEnd`, and a trailing run without one is a
 * sentence too. `tokens` are parseSay tokens and `words` the matching `{ text, start, end, emphasis, aside }`.
 */
export function sentencesOf(tokens, words) {
  const sentences = [];
  let first = 0;
  tokens.forEach((token, last) => {
    if (!token.sentenceEnd && last !== tokens.length - 1) return;
    const own = words.slice(first, last + 1);
    sentences.push({ start: own[0].start, end: own.at(-1).end, words: own });
    first = last + 1;
  });
  return sentences;
}

/** The parsed sidecar at `file`; an error naming the file when it cannot be read or is not JSON. */
export function readSidecar(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new SidecarError(`cannot read the voice sidecar ${file}: ${String(err?.message ?? err).split('\n')[0]}`, { cause: err });
  }
}

/**
 * Writes `data` as JSON to `file`, through a temporary file renamed into place, so a reader never sees half a file.
 * The temporary name is unique to this write and created exclusively (never through a planted file or link); it is
 * removed when the write or the rename fails.
 */
export function writeSidecar(file, data) {
  const partial = `${file}.partial-${process.pid}-${randomUUID()}`;
  try {
    writeFileSync(partial, `${JSON.stringify(data, null, JSON_INDENT)}\n`, { flag: 'wx' });
    renameSync(partial, file);
  } catch (err) {
    rmSync(partial, { force: true });
    throw err;
  }
}

const fail = (where, message) => {
  throw new SidecarError(`${where}: ${message}`);
};
const isTime = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;

function checkWord(w, where, seconds) {
  if (!isTime(w.start)) fail(`${where}.start`, `must be a number of seconds, 0 or more, got ${JSON.stringify(w.start)}`);
  if (!isTime(w.end) || w.end < w.start) fail(`${where}.end`, `must be a number of seconds, at least start ${w.start}, got ${JSON.stringify(w.end)}`);
  if (w.end > seconds) fail(`${where}.end`, `${w.end} s lies past the end of the shot's narration, ${seconds} s`);
}

function checkShotWords(shot, where, tokens) {
  if (!Array.isArray(shot.sentences)) fail(`${where}.sentences`, 'must be an array');
  shot.sentences.forEach((s, i) => {
    if (!Array.isArray(s?.words)) fail(`${where}.sentences[${i}].words`, 'must be an array of words');
  });
  const count = shot.sentences.reduce((n, s) => n + s.words.length, 0);
  if (count !== tokens.length) fail(`${where}.sentences`, `has ${count} words, the film's say has ${tokens.length}`);
  let k = 0;
  shot.sentences.forEach((sentence, s) => sentence.words.forEach((w, i) => {
    const at = `${where}.sentences[${s}].words[${i}]`;
    if (w?.text !== tokens[k].text) fail(`${at}.text`, `expected ${JSON.stringify(tokens[k].text)} (the film's say), got ${JSON.stringify(w?.text)}`);
    checkWord(w, at, shot.seconds);
    k++;
  }));
}

// A shot's WAV is null (no narration, or nothing speakable: then 0 s) or exactly shot-<index>.wav beside the sidecar,
// so no sidecar can make a reader open a file anywhere else.
function checkWav(shot, where, index, hasSay) {
  if (!hasSay && shot.wav !== null) fail(`${where}.wav`, `must be null for a shot without say, got ${JSON.stringify(shot.wav)}`);
  if (shot.wav === null) {
    if (shot.seconds !== 0) fail(`${where}.wav`, `is null, so the shot has no narration time, but seconds is ${JSON.stringify(shot.seconds)}`);
    return;
  }
  if (shot.wav !== wavName(index)) fail(`${where}.wav`, `must be ${JSON.stringify(wavName(index))} or null, got ${JSON.stringify(shot.wav)}`);
}

function checkShot(shot, filmShot, index) {
  const where = `shots[${index}]`;
  if (shot?.id !== filmShot.id) fail(`${where}.id`, `expected ${JSON.stringify(filmShot.id)} (the film's shot), got ${JSON.stringify(shot?.id)}`);
  const hasSay = filmShot.say !== undefined && filmShot.say !== null;
  if (!isTime(shot.seconds)) fail(`${where}.seconds`, `must be a number of seconds, 0 or more, got ${JSON.stringify(shot.seconds)}`);
  checkWav(shot, where, index, hasSay);
  checkShotWords(shot, where, hasSay ? parseSay(filmShot.say).tokens : []);
}

/**
 * Throws a SidecarError `<path>: <message>` at the first place `data` does not match `film`: the version, the sample
 * rate, the shot count and ids, a wav for each narrated shot (null otherwise), the word count and each word's text
 * against the film's `say`, and word times inside their shot. Returns `data`.
 */
export function validateSidecar(data, film) {
  if (data?.version !== SIDECAR_VERSION) fail('version', `expected ${SIDECAR_VERSION}, got ${JSON.stringify(data?.version)}`);
  if (data.sampleRate !== SAMPLE_RATE) fail('sampleRate', `expected ${SAMPLE_RATE}, got ${JSON.stringify(data.sampleRate)}`);
  if (!Array.isArray(data.shots) || data.shots.length !== film.shots.length) {
    fail('shots', `expected ${film.shots.length} shots (the film's), got ${Array.isArray(data.shots) ? data.shots.length : JSON.stringify(data.shots)}`);
  }
  data.shots.forEach((shot, i) => checkShot(shot, film.shots[i], i));
  return data;
}

// ---- the words of an author's own recording ----------------------------------------------------------------------------

/** Where a film's recording words are named; every RecordingWordsError is reported there. */
export const WORDS_PATH = 'voice.words';
// Up to this many tokens and words on each side of a run whose joined text matches ("12,500" as " 12" ",500").
const MAX_RUN = 6;
// How far a word the recording renders differently looks ahead for the alignment to pick up again.
const RESYNC_WINDOW = 8;
const NON_WORD_RE = /[^\p{L}\p{N}]/gu;
/** The one shape a words file may have, as messages name it. */
export const WHISPER_SHAPE = 'the JSON Whisper writes with word timestamps: { "segments": [{ "words": [{ "word", "start", "end" }] }] }';

/** The words of a recording do not fit the film: an invalid film at voice.words (`path`). */
export class RecordingWordsError extends SidecarError {
  constructor(message, options) {
    super(message, options);
    this.name = 'RecordingWordsError';
    this.path = WORDS_PATH;
  }
}

const refuse = (message) => {
  throw new RecordingWordsError(message);
};
const hasSay = (shot) => shot.say !== undefined && shot.say !== null;
/** A word's letters and digits, lower case: what two renderings of one word share ("Every," and " every"). */
const keyOf = (text) => String(text).normalize('NFKC').toLowerCase().replace(NON_WORD_RE, '');

function whisperWord(w, at, previous) {
  if (typeof w?.word !== 'string') refuse(`the words file ${at}.word: must be the word's text, got ${JSON.stringify(w?.word)}`);
  if (!isTime(w.start)) refuse(`the words file ${at}.start: must be a number of seconds, 0 or more, got ${JSON.stringify(w.start)}`);
  if (!isTime(w.end) || w.end < w.start) refuse(`the words file ${at}.end: must be a number of seconds, at least start ${w.start}, got ${JSON.stringify(w.end)}`);
  if (previous && w.start < previous.start) refuse(`the words file ${at}.start: ${w.start} s is out of order: the word before it starts at ${previous.start} s`);
  return { key: keyOf(w.word), start: w.start, end: w.end };
}

// Whisper's words in order as { key, start, end }, checked; words with no letter or digit (a lone dash) are dropped.
function whisperWords(json) {
  if (!Array.isArray(json?.segments)) {
    refuse(`the words file has no "segments" list; it must be ${WHISPER_SHAPE}`);
  }
  const words = [];
  json.segments.forEach((segment, s) => {
    if (!Array.isArray(segment?.words)) refuse(`the words file segments[${s}] has no word times; run Whisper with word timestamps on`);
    segment.words.forEach((w, k) => words.push(whisperWord(w, `segments[${s}].words[${k}]`, words.at(-1))));
  });
  return words.filter((w) => w.key !== '');
}

const joined = (items, from, count) => items.slice(from, from + count).map((x) => x.key).join('');

// A token and a word that match, or the shortest run of tokens and words whose joined text matches: { tokens, words,
// shared } (shared: the run's tokens all take the run's span), or null.
function matchAt(tokens, i, words, j) {
  if (j >= words.length || i >= tokens.length) return null;
  if (tokens[i].key === words[j].key) return { tokens: 1, words: 1, shared: false };
  for (let total = 3; total <= 2 * MAX_RUN; total++) {
    for (let p = 1; p < total; p++) {
      const q = total - p;
      if (p > MAX_RUN || q > MAX_RUN || i + p > tokens.length || j + q > words.length) continue;
      if (joined(tokens, i, p) === joined(words, j, q) && tokens[i + p - 1].key !== '') return { tokens: p, words: q, shared: true };
    }
  }
  return null;
}

const nextSpoken = (tokens, i) => {
  let k = i;
  while (k < tokens.length && tokens[k].key === '') k++;
  return k;
};

// Whether the words at `j` may follow the shot: the next narrated shot's first word starts there (`nextKey`), or, after
// the last narrated shot, no word is left.
function endsAt(words, j, nextKey) {
  if (nextKey === null) return j === words.length;
  if (j >= words.length) return false;
  const key = words[j].key;
  return key === nextKey || key.startsWith(nextKey) || nextKey.startsWith(key);
}

// The alignment holds at token `i` and word `j`: two pairs match in a row, or the shot ends there cleanly.
function holdsAt(tokens, i, words, j, nextKey) {
  if (i >= tokens.length) return endsAt(words, j, nextKey);
  const first = matchAt(tokens, i, words, j);
  if (first === null) return false;
  const after = nextSpoken(tokens, i + first.tokens);
  return after >= tokens.length ? endsAt(words, j + first.words, nextKey) : matchAt(tokens, after, words, j + first.words) !== null;
}

// Words the recording renders differently ("Ansa" for "answer"): d spoken tokens for d words, one each, where the
// alignment holds again just after. A run with more words than tokens (an extra word) or fewer (a missing one) never
// qualifies, so no word is ever moved onto its neighbour's time.
function substitutionAt(tokens, i, words, j, nextKey) {
  let end = i;
  for (let d = 1; d <= RESYNC_WINDOW; d++) {
    end = nextSpoken(tokens, end) + 1;
    if (end > tokens.length || j + d > words.length) return null;
    if (holdsAt(tokens, nextSpoken(tokens, end), words, j + d, nextKey)) return { tokens: end - i, words: d, shared: false };
  }
  return null;
}

// Shot times from a step: a shared run gives every token the run's span; otherwise each spoken token its own word.
function place(times, tokens, step, i, words, j) {
  if (step.shared) {
    const span = { start: words[j].start, end: words[j + step.words - 1].end };
    for (let k = 0; k < step.tokens; k++) times[i + k] = span;
    return;
  }
  let w = j;
  for (let k = i; k < i + step.tokens; k++) {
    if (tokens[k].key !== '') times[k] = { start: words[w].start, end: words[w++].end };
  }
}

// A token with no letter or digit (a spaced dash) has no word: a zero-length span where the word before it ended, or,
// at the shot's start, where the word after it starts.
function fillEmpty(times) {
  for (let k = 0; k < times.length; k++) {
    if (times[k] !== null) continue;
    const before = times.slice(0, k).reverse().find((t) => t !== null);
    const at = before ? before.end : times.slice(k + 1).find((t) => t !== null).start;
    times[k] = { start: at, end: at };
  }
  return times;
}

function countMessage(shot, tokens, words, from, nextKey) {
  const spoken = tokens.filter((t) => t.key !== '').length;
  const found = nextKey === null ? -1 : words.findIndex((w, k) => k >= from && w.key === nextKey);
  const recorded = (found === -1 ? words.length : found) - from;
  return `shot "${shot.id}": its say has ${spoken} words and the words file has ${recorded} for it, which cannot be matched word `
    + 'for word; make the say and the recording\'s words the same (a word the recording adds or leaves out cannot be placed)';
}

// The file times of one narrated shot's tokens, from word `from` on: { times, next }, or a RecordingWordsError.
function alignShot(shot, tokens, words, from, nextKey) {
  if (tokens.every((t) => t.key === '')) refuse(`shot "${shot.id}": its say has no word to find in the recording`);
  const times = new Array(tokens.length).fill(null);
  let i = 0;
  let j = from;
  while (i < tokens.length) {
    if (tokens[i].key === '') { i++; continue; }
    const step = matchAt(tokens, i, words, j) ?? substitutionAt(tokens, i, words, j, nextKey);
    if (step === null) refuse(countMessage(shot, tokens, words, from, nextKey));
    place(times, tokens, step, i, words, j);
    i += step.tokens;
    j += step.words;
  }
  if (!endsAt(words, j, nextKey)) refuse(countMessage(shot, tokens, words, from, nextKey));
  return { times: fillEmpty(times), next: j };
}

/**
 * The film's words in a recording, from a Whisper word-timestamp JSON (`segments[].words[] { word, start, end }`) -> a
 * recording sidecar (header). Each say token is matched in order to the recording's words by its letters and digits
 * (case and punctuation aside): one to one; or a run whose joined text matches ("12,500" as " 12" ",500", "$5 million."
 * as one word), whose tokens all take the run's span; or, for words rendered differently, as many words as tokens, one
 * each, where the match picks up again right after. A spaced dash takes a zero-length span. Emphasis, asides and
 * sentences are the film's. Anything else (an extra or a missing word) is a RecordingWordsError naming the shot and both
 * counts: a word is never moved onto another's time.
 */
export function fromWhisper(json, film) {
  const words = whisperWords(json);
  const plans = film.shots.map((shot) => (hasSay(shot) ? parseSay(shot.say).tokens.map((t) => ({ ...t, key: keyOf(t.text) })) : null));
  const firstKeyAfter = (index) => plans.slice(index + 1).find((p) => p !== null)?.find((t) => t.key !== '')?.key ?? null;
  let next = 0;
  const shots = film.shots.map((shot, index) => {
    const tokens = plans[index];
    if (tokens === null) return { id: shot.id, wav: null, seconds: 0, sentences: [] };
    const aligned = alignShot(shot, tokens, words, next, firstKeyAfter(index));
    next = aligned.next;
    const placed = tokens.map((t, k) => ({ text: t.text, ...aligned.times[k], emphasis: t.emphasis, aside: t.aside }));
    return { id: shot.id, wav: null, seconds: placed.at(-1).end, sentences: sentencesOf(tokens, placed) };
  });
  return { version: SIDECAR_VERSION, model: null, voice: null, sampleRate: SAMPLE_RATE, shots };
}
