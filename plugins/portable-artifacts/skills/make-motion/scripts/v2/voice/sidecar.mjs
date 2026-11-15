// The voice sidecar (version 1): the measured word times of a film's narration, one entry per shot.
//
// { version: 1, model: { id, commit, file, sha256 }, voice, sampleRate: 24000,
//   shots: [{ id, wav, seconds, sentences: [{ start, end, words: [{ text, start, end, emphasis, aside }] }] }] }
//
// `wav` is the file name of the shot's narration beside the sidecar, or null for a shot without `say`. Every time is in
// seconds from the first sample of that shot's WAV, rounded to TIME_STEP; `seconds` is the WAV's length. The sidecar
// holds no film-level time: where a shot sits in the film is the timeline's business.
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { parseSay } from '../../../engine/script/say.mjs';
import { SAMPLE_RATE } from './words.mjs';

export const SIDECAR_VERSION = 1;
export const SIDECAR_FILE = 'voice.json';
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

/** Writes `data` as JSON to `file`, through a temporary file renamed into place, so a reader never sees half a file. */
export function writeSidecar(file, data) {
  const partial = `${file}.partial-${process.pid}`;
  writeFileSync(partial, `${JSON.stringify(data, null, JSON_INDENT)}\n`);
  renameSync(partial, file);
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
  const count = shot.sentences.reduce((n, s) => n + (Array.isArray(s?.words) ? s.words.length : 0), 0);
  if (count !== tokens.length) fail(`${where}.sentences`, `has ${count} words, the film's say has ${tokens.length}`);
  let k = 0;
  shot.sentences.forEach((sentence, s) => sentence.words.forEach((w, i) => {
    const at = `${where}.sentences[${s}].words[${i}]`;
    if (w?.text !== tokens[k].text) fail(`${at}.text`, `expected ${JSON.stringify(tokens[k].text)} (the film's say), got ${JSON.stringify(w?.text)}`);
    checkWord(w, at, shot.seconds);
    k++;
  }));
}

function checkShot(shot, filmShot, index) {
  const where = `shots[${index}]`;
  if (shot?.id !== filmShot.id) fail(`${where}.id`, `expected ${JSON.stringify(filmShot.id)} (the film's shot), got ${JSON.stringify(shot?.id)}`);
  const hasSay = filmShot.say !== undefined && filmShot.say !== null;
  if (hasSay && (typeof shot.wav !== 'string' || shot.wav === '')) fail(`${where}.wav`, 'must name the WAV of a shot with narration');
  if (!hasSay && shot.wav !== null) fail(`${where}.wav`, `must be null for a shot without say, got ${JSON.stringify(shot.wav)}`);
  if (!isTime(shot.seconds)) fail(`${where}.seconds`, `must be a number of seconds, 0 or more, got ${JSON.stringify(shot.seconds)}`);
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
