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
// The alignment's costs. A substitution (a word the recording renders differently, in its own place) costs more than one
// unmatched word and less than two, so one word added and another left out always beats moving the words between them
// one place: the error names both instead of shifting any word onto its neighbour's time.
const COST = Object.freeze({ unmatched: 2, substitute: 3 });
// More substitutions than this in a row are not misheard words but different ones: they are reported as unmatched.
const MAX_SUBSTITUTIONS = 3;
/** The alignment table's cells, (spoken say tokens + 1) x (file words + 1), at most: 32 MiB, one byte each. */
export const MAX_ALIGN_CELLS = 2 ** 25;
const ECHO_MAX = 40; // characters of a word quoted in a message
const LIST_MAX = 10; // words listed for each side of a shot in a message
const NON_WORD_RE = /[^\p{L}\p{N}]/gu;
// A token with no letter or digit that is silent (a dash, a bracket, a quote, a stop); any other (&, +, %, an emoji) is
// a symbol, which Whisper writes as the word spoken.
const SILENT_RE = /^[\p{Pd}\p{Ps}\p{Pe}\p{Pi}\p{Pf}.,;:!?…'"]+$/u;
/** The one shape a words file may have, as messages name it. */
export const WHISPER_SHAPE = 'the JSON Whisper writes with word timestamps: { "segments": [{ "words": [{ "word", "start", "end" }] }] }';
const UNMATCHED_ADVICE = 'make the say and the recording\'s words the same (a word the recording adds or leaves out cannot be placed)';

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
const echoText = (text) => JSON.stringify(text.length > ECHO_MAX ? `${text.slice(0, ECHO_MAX)}...` : text);
// A JSON value as a message names it: a string (cut to ECHO_MAX characters) or a number as it is, anything else by its
// type, so a huge object in a words file is never echoed whole.
function echoValue(value) {
  if (typeof value === 'string') return echoText(value);
  if (typeof value !== 'object' || value === null) return String(value);
  return Array.isArray(value) ? 'an array' : 'an object';
}
const listed = (items) => (items.length > LIST_MAX ? `${items.slice(0, LIST_MAX).join(', ')} and ${items.length - LIST_MAX} more` : items.join(', '));

function whisperWord(w, at, previous) {
  if (typeof w?.word !== 'string') refuse(`the words file ${at}.word: must be the word's text, got ${echoValue(w?.word)}`);
  if (!isTime(w.start)) refuse(`the words file ${at}.start: must be a number of seconds, 0 or more, got ${echoValue(w.start)}`);
  if (!isTime(w.end) || w.end < w.start) refuse(`the words file ${at}.end: must be a number of seconds, at least start ${w.start}, got ${echoValue(w.end)}`);
  if (previous && w.start < previous.start) refuse(`the words file ${at}.start: ${w.start} s is out of order: the word before it starts at ${previous.start} s`);
  return { key: keyOf(w.word), text: w.word.trim(), start: w.start, end: w.end };
}

// Whisper's words in order as { key, text, start, end }, checked (times finite, 0 or more, each end at or after its
// start, starts never decreasing); words with no letter or digit (a lone dash) are dropped.
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

// ---- the alignment: the film's spoken tokens against the file's words, as two sequences --------------------------------

// One step per table cell, one byte: a token and a word that match, a word rendered differently in its place
// (substitute), a token with no word (missing), a word with no token (extra), or a run of p tokens and q words.
const STEP = Object.freeze({ match: 1, substitute: 2, missing: 3, extra: 4 });
const RUN_BASE = 8;
const CODE_SPAN = 64; // every step code is under this, so a cell packs as cost * CODE_SPAN + code
const runCode = (p, q) => RUN_BASE + (p - 1) * MAX_RUN + (q - 1);

function stepOf(code) {
  if (code >= RUN_BASE) return { kind: 'run', p: Math.floor((code - RUN_BASE) / MAX_RUN) + 1, q: ((code - RUN_BASE) % MAX_RUN) + 1 };
  if (code === STEP.missing) return { kind: 'missing', p: 1, q: 0 };
  if (code === STEP.extra) return { kind: 'extra', p: 0, q: 1 };
  return { kind: code === STEP.match ? 'match' : 'substitute', p: 1, q: 1 };
}

const joined = (items, from, count) => items.slice(from, from + count).map((x) => x.key).join('');

// The cheapest run of p tokens of one shot and q words (p + q of 3 or more) that ends at token i and word j and whose
// joined text matches ("12,500" as " 12" ",500"; "$5 million." as one word): { code, cost }, or null. Joined texts that
// match end alike, so a pair whose last keys do not is skipped at once.
function runAt(tokens, words, i, j, row) {
  const a = tokens[i - 1].key;
  const b = words[j - 1].key;
  if (!a.endsWith(b) && !b.endsWith(a)) return null;
  let best = null;
  for (let p = 1; p <= Math.min(MAX_RUN, i) && tokens[i - p].shot === tokens[i - 1].shot; p++) {
    const left = joined(tokens, i - p, p);
    for (let q = Math.max(1, 3 - p); q <= Math.min(MAX_RUN, j); q++) {
      const cost = row(i - p)[j - q];
      if ((best === null || cost < best.cost) && joined(words, j - q, q) === left) best = { code: runCode(p, q), cost };
    }
  }
  return best;
}

// The cheapest step into cell (i, j), packed. On a tie a match wins, then a run, then an unmatched token or word; a
// substitution only when strictly cheaper, so a tie is reported rather than substituted.
function cheapest(tokens, words, i, j, row) {
  const up = row(i - 1);
  const cur = row(i);
  let cost = up[j] + COST.unmatched;
  let code = STEP.missing;
  if (cur[j - 1] + COST.unmatched < cost) { cost = cur[j - 1] + COST.unmatched; code = STEP.extra; }
  if (tokens[i - 1].id === words[j - 1].id) return up[j - 1] <= cost ? up[j - 1] * CODE_SPAN + STEP.match : cost * CODE_SPAN + code;
  const run = runAt(tokens, words, i, j, row);
  if (run !== null && run.cost <= cost) { cost = run.cost; code = run.code; }
  if (up[j - 1] + COST.substitute < cost) { cost = up[j - 1] + COST.substitute; code = STEP.substitute; }
  return cost * CODE_SPAN + code;
}

// The edit-distance table of `tokens` against `words`: the step into every cell (row-major, words + 1 wide). Costs are
// kept for the last MAX_RUN + 1 rows only, which is all a run reaches back.
function fillTable(tokens, words) {
  const width = words.length + 1;
  const steps = new Uint8Array((tokens.length + 1) * width);
  const rows = Array.from({ length: MAX_RUN + 1 }, () => new Int32Array(width));
  const row = (i) => rows[i % rows.length];
  for (let j = 1; j < width; j++) { row(0)[j] = j * COST.unmatched; steps[j] = STEP.extra; }
  for (let i = 1; i <= tokens.length; i++) {
    const cur = row(i);
    cur[0] = i * COST.unmatched;
    steps[i * width] = STEP.missing;
    for (let j = 1; j < width; j++) {
      const packed = cheapest(tokens, words, i, j, row);
      cur[j] = Math.floor(packed / CODE_SPAN);
      steps[i * width + j] = packed % CODE_SPAN;
    }
  }
  return steps;
}

// The steps of the cheapest alignment, first to last, each with the token (i) and word (j) it starts at.
function stepsOf(table, width, tokens, words) {
  const steps = [];
  let i = tokens;
  let j = words;
  while (i > 0 || j > 0) {
    const step = stepOf(table[i * width + j]);
    i -= step.p;
    j -= step.q;
    steps.push({ ...step, i, j });
  }
  return steps.reverse();
}

const unmatchedPair = (s) => [{ kind: 'missing', p: 1, q: 0, i: s.i, j: s.j }, { kind: 'extra', p: 0, q: 1, i: s.i + 1, j: s.j }];

// The steps with every run of more than MAX_SUBSTITUTIONS substitutions in a row turned into a missing token and an extra
// word each: a whole different phrase of the same length is reported, never timed word for word.
function capSubstitutions(steps) {
  const out = [];
  for (let k = 0; k < steps.length;) {
    let end = k;
    while (end < steps.length && steps[end].kind === 'substitute') end++;
    if (end === k) {
      out.push(steps[k]);
      k++;
      continue;
    }
    const run = steps.slice(k, end);
    out.push(...(run.length > MAX_SUBSTITUTIONS ? run.flatMap(unmatchedPair) : run));
    k = end;
  }
  return out;
}

/**
 * The spoken say tokens of every narrated shot in film order (`{ shot, k, key, text }`) aligned with the recording's
 * words as two sequences (an edit-distance alignment on their keys): `{ spans, missing, extra }`, spans[t] the file span
 * of token t (every token of a run shares one), `missing` the tokens with no word, `extra` the words with no token, each
 * with the shot it falls in (the shot of the token before it, else the first).
 */
function align(tokens, words) {
  const cells = (tokens.length + 1) * (words.length + 1);
  if (cells > MAX_ALIGN_CELLS) {
    refuse(`the says' ${tokens.length} words and the words file's ${words.length} are too many to match (at most ${MAX_ALIGN_CELLS} pairs); check that the words file is this film's recording`);
  }
  const ids = new Map();
  const id = (key) => { if (!ids.has(key)) ids.set(key, ids.size); return ids.get(key); };
  const table = fillTable(tokens.map((t) => ({ ...t, id: id(t.key) })), words.map((w) => ({ ...w, id: id(w.key) })));
  const spans = new Array(tokens.length).fill(null);
  const missing = [];
  const extra = [];
  for (const step of capSubstitutions(stepsOf(table, words.length + 1, tokens.length, words.length))) {
    if (step.kind === 'missing') missing.push(tokens[step.i]);
    else if (step.kind === 'extra') extra.push({ ...words[step.j], shot: tokens[Math.max(0, step.i - 1)].shot });
    else {
      const span = { start: words[step.j].start, end: words[step.j + step.q - 1].end };
      for (let k = 0; k < step.p; k++) spans[step.i + k] = span;
    }
  }
  return { spans, missing, extra };
}

// ---- the recording's words fitted to the film ---------------------------------------------------------------------------

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

function symbolHint(plan) {
  const symbols = plan.filter((t) => t.key === '' && !SILENT_RE.test(t.text)).map((t) => echoText(t.text));
  return symbols.length === 0 ? '' : ` (the say's ${listed(symbols)} has no sound of its own: write the word spoken, such as "and" for "&")`;
}

// One shot's part of an unmatched-words message: the file's words it does not say (with their times) and its say's words
// the file does not have.
function shotClause(film, plans, index, { missing, extra }) {
  const added = extra.filter((w) => w.shot === index).map((w) => `${echoText(w.text)} (${roundTime(w.start)} s)`);
  const left = missing.filter((t) => t.shot === index).map((t) => echoText(t.text));
  const parts = [];
  if (added.length > 0) parts.push(`the words file has ${listed(added)}, which the say does not`);
  if (left.length > 0) parts.push(`the say has ${listed(left)}, which the words file does not`);
  return `shot "${film.shots[index].id}": ${parts.join(', and ')}${symbolHint(plans[index])}`;
}

function unmatchedMessage(film, plans, unmatched) {
  const shots = [...new Set([...unmatched.missing, ...unmatched.extra].map((x) => x.shot))].sort((a, b) => a - b);
  return `${shots.map((index) => shotClause(film, plans, index, unmatched)).join('; ')}; ${UNMATCHED_ADVICE}`;
}

function checkPlans(film, plans, words) {
  if (plans.every((plan) => plan === null)) {
    refuse(`no shot has a say, so the words file's ${words.length} words have nothing to time; give the narrated shots their say, or remove the voice`);
  }
  plans.forEach((plan, index) => {
    if (plan !== null && plan.every((t) => t.key === '')) refuse(`shot "${film.shots[index].id}": its say has no word to find in the recording`);
  });
}

const shotWords = (shot) => shot.sentences.flatMap((s) => s.words);

// Each narrated shot's words start at or after the end of the last word of the narrated shot before: a word heard across
// a cut belongs to neither shot.
function checkShotOrder(film, shots) {
  let previous = null;
  shots.forEach((shot, index) => {
    const own = shotWords(shot);
    if (own.length === 0) return;
    const first = Math.min(...own.map((w) => w.start));
    if (previous !== null && first < previous.end) {
      refuse(`shot "${film.shots[index].id}" starts in the words file at ${first} s, before the last word of shot "${film.shots[previous.index].id}" ends `
        + `(${previous.end} s); the words of two shots must not overlap: end a shot's say where the recording pauses`);
    }
    previous = { index, end: Math.max(...own.map((w) => w.end)) };
  });
}

/**
 * The film's words in a recording, from a Whisper word-timestamp JSON (`segments[].words[] { word, start, end }`) -> a
 * recording sidecar (header). The spoken say tokens of every narrated shot and the file's words are aligned as two
 * sequences by their letters and digits (case and punctuation aside): a token and a word one to one; a run whose joined
 * text matches ("12,500" as " 12" ",500", "$5 million." as one word), whose tokens all take the run's span; or a word
 * rendered differently, in its own place, at the file's time for that place (up to MAX_SUBSTITUTIONS in a row). A
 * spaced dash takes a zero-length span.
 * Emphasis, asides and sentences are the film's. Any word of the file with no partner in the say, or say word with none
 * in the file, is a RecordingWordsError naming the shot and listing those words on each side: a word is never moved onto
 * another's time. So is a film with no narrated shot, and word times that overlap across two shots.
 */
export function fromWhisper(json, film) {
  const words = whisperWords(json);
  const plans = film.shots.map((shot) => (hasSay(shot) ? parseSay(shot.say).tokens.map((t) => ({ ...t, key: keyOf(t.text) })) : null));
  checkPlans(film, plans, words);
  const tokens = plans.flatMap((plan, shot) => (plan === null ? [] : plan.flatMap((t, k) => (t.key === '' ? [] : [{ shot, k, key: t.key, text: t.text }]))));
  const { spans, missing, extra } = align(tokens, words);
  if (missing.length > 0 || extra.length > 0) refuse(unmatchedMessage(film, plans, { missing, extra }));
  const times = plans.map((plan) => (plan === null ? null : new Array(plan.length).fill(null)));
  tokens.forEach((t, n) => { times[t.shot][t.k] = spans[n]; });
  const shots = film.shots.map((shot, index) => {
    const plan = plans[index];
    if (plan === null) return { id: shot.id, wav: null, seconds: 0, sentences: [] };
    const placed = fillEmpty(times[index]).map((span, k) => ({ text: plan[k].text, ...span, emphasis: plan[k].emphasis, aside: plan[k].aside }));
    return { id: shot.id, wav: null, seconds: placed.at(-1).end, sentences: sentencesOf(plan, placed) };
  });
  checkShotOrder(film, shots);
  return { version: SIDECAR_VERSION, model: null, voice: null, sampleRate: SAMPLE_RATE, shots };
}
