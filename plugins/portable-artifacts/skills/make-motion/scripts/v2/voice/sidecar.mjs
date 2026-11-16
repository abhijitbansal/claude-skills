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
    // The mix shapes emphasis and asides from the sidecar and the picture from the film: they must agree.
    for (const mark of ['emphasis', 'aside']) {
      if (w[mark] !== tokens[k][mark]) fail(`${at}.${mark}`, `expected ${tokens[k][mark]} (the film's say), got ${JSON.stringify(w[mark])}`);
    }
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
 * rate, the shot count and ids, a wav for each narrated shot (null otherwise), the word count and each word's text,
 * emphasis and aside against the film's `say`, and word times inside their shot. Returns `data`.
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
const MAX_RUN_ITEMS = 6; // (not say.mjs's MAX_RUN, which counts something else)
// The alignment's costs. A substitution (a word the recording renders differently, in its own place) costs more than one
// unmatched word and less than two, so one word added and another left out always beats moving the words between them
// one place: the error names both instead of shifting any word onto its neighbour's time.
const COST = Object.freeze({ unmatched: 2, substitute: 3 });
// A substitution is allowed only between two words that plausibly are one word misheard: their keys (keyOf) at most
// MAX_EDITS edits apart (Levenshtein, by code point) and at most 40% of the longer key's length, or the same number
// written differently. Two edits admit "colour"/"color" (1 of 6) and "their"/"there" (2 of 5, exactly 40%); the share
// refuses one short word for another ("is"/"as", 1 of 2; "form"/"from", 2 of 4). Any other pair is one word added and
// one left out, both named: a word never takes its neighbour's time.
const MAX_EDITS = 2;
const SIMILAR_SHARE = Object.freeze({ edits: 2, chars: 5 }); // edits x 5 <= 2 x longer: at most 40%
// Keys longer than this are never compared letter by letter (no spoken word is), so one cell's work stays bounded.
const MAX_SIMILAR_CHARS = 32;
const UNITS = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen';
const TENS = 'twenty thirty forty fifty sixty seventy eighty ninety';
// The number words a recording may write for the say's digits ("ten" for "10"), one word for one token.
const NUMBER_WORDS = new Map([
  ...UNITS.split(' ').map((word, n) => [word, String(n)]),
  ...TENS.split(' ').map((word, k) => [word, String(20 + 10 * k)]),
]);
// The table covers only the cells within BAND_MARGIN of the diagonals the two lengths allow (an offset of 0 to file
// words - say tokens). A matching alignment leaves that range only through runs (several tokens for one word, or the
// reverse) that drift more than BAND_MARGIN beyond the net difference; such a path is lost, which can only add unmatched
// words (a refusal), never accept a film that would otherwise fail.
const BAND_MARGIN = 128;
/**
 * The alignment table's cells at most (4 MiB, one byte each): 5000 say words against 5000 file words take 1.3 M. A
 * words file that needs more is refused at voice.words. Measured on the development Mac (arm64, Node 24): 5000 x 5000 in 33-173 ms, the
 * slowest crafted input found under the cap in about 0.5 s (synchronous).
 */
export const MAX_ALIGN_CELLS = 2 ** 22;
const INF = 2 ** 29; // the cost of a cell outside the band
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
const runCode = (p, q) => RUN_BASE + (p - 1) * MAX_RUN_ITEMS + (q - 1);

function stepOf(code) {
  if (code >= RUN_BASE) return { kind: 'run', p: Math.floor((code - RUN_BASE) / MAX_RUN_ITEMS) + 1, q: ((code - RUN_BASE) % MAX_RUN_ITEMS) + 1 };
  if (code === STEP.missing) return { kind: 'missing', p: 1, q: 0 };
  if (code === STEP.extra) return { kind: 'extra', p: 0, q: 1 };
  return { kind: code === STEP.match ? 'match' : 'substitute', p: 1, q: 1 };
}

// ---- similarity: which two different keys may be one word misheard -----------------------------------------------------

// A key as a number's digits without leading zeros ("007" -> "7", "ten" -> "10"), or null when it is not a number.
const numberOf = (key) => (/^\d+$/.test(key) ? key.replace(/^0+(?=\d)/, '') : NUMBER_WORDS.get(key) ?? null);

// The Levenshtein distance of two code-point arrays, or limit + 1 as soon as it must exceed `limit`. Only the cells
// within `limit` of the diagonal are computed (any other is over the limit), so a call is O(limit x length). `rows` are
// two scratch rows of at least b.length + 1 cells, owned by the caller.
function editDistance(a, b, limit, rows) {
  const over = limit + 1;
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const n = a.length - head - tail; // what is left of each once their common start and end are set aside
  const m = b.length - head - tail;
  let [prev, cur] = rows;
  for (let j = 0; j <= m; j++) prev[j] = Math.min(j, over);
  for (let i = 1; i <= n; i++) {
    cur.fill(over, 0, m + 1);
    cur[0] = Math.min(i, over);
    let best = cur[0];
    for (let j = Math.max(1, i - limit); j <= Math.min(m, i + limit); j++) {
      const same = a[head + i - 1] === b[head + j - 1];
      cur[j] = Math.min(over, prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (same ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > limit) return over;
    [prev, cur] = [cur, prev];
  }
  return prev[m];
}

// Whether two keys ({ chars, number }) may be one word misheard (see MAX_EDITS).
function isSimilar(a, b, rows) {
  if (a.number !== null && a.number === b.number) return true;
  const longer = Math.max(a.chars.length, b.chars.length);
  if (Math.abs(a.chars.length - b.chars.length) > MAX_EDITS || longer > MAX_SIMILAR_CHARS) return false;
  const edits = editDistance(a.chars, b.chars, MAX_EDITS, rows);
  return edits <= MAX_EDITS && edits * SIMILAR_SHARE.chars <= SIMILAR_SHARE.edits * longer;
}

// isSimilar on two ids of `keys`, with two scratch rows of this alignment's own.
function similarity(keys) {
  const rows = [new Int32Array(MAX_SIMILAR_CHARS + 1), new Int32Array(MAX_SIMILAR_CHARS + 1)];
  return (a, b) => isSimilar(keys[a], keys[b], rows);
}

// ---- the table: a band of cells around the diagonals, filled row by row -------------------------------------------------

// Items with an id per distinct key, the running length of their keys (ends[k] = length of keys 0..k-1) and the keys
// joined, so a run's joined text is one slice.
function sequence(items, idOf) {
  const ends = new Int32Array(items.length + 1);
  items.forEach((x, k) => { ends[k + 1] = ends[k] + x.key.length; });
  return { items: items.map((x) => ({ ...x, id: idOf(x.key) })), ends, text: items.map((x) => x.key).join('') };
}

// The tokens and words as sequences over one id space, and `similar(a, b)` on two ids.
function contextOf(tokens, words) {
  const ids = new Map();
  const idOf = (key) => { if (!ids.has(key)) ids.set(key, ids.size); return ids.get(key); };
  const T = sequence(tokens, idOf);
  const W = sequence(words, idOf);
  const keys = [...ids.keys()].map((key) => ({ chars: Array.from(key), number: numberOf(key) }));
  return { T, W, similar: similarity(keys) };
}

// The band of t + 1 rows: row i spans words from(i) to to(i); `at(i, j)` is a cell's index; `cells` the band's size.
function bandOf(t, w) {
  const lo = Math.min(0, w - t) - BAND_MARGIN;
  const hi = Math.max(0, w - t) + BAND_MARGIN;
  const from = (i) => Math.max(0, i + lo);
  const to = (i) => Math.min(w, i + hi);
  const base = new Float64Array(t + 2);
  for (let i = 0; i <= t; i++) base[i + 1] = base[i] + to(i) - from(i) + 1;
  return { from, to, cells: base[t + 1], at: (i, j) => base[i] + j - from(i) };
}

// Whether `a` from index `s` and `b` from index `t` agree for `n` code units (no string is built).
function sameText(a, s, b, t, n) {
  for (let k = 0; k < n; k++) if (a.charCodeAt(s + k) !== b.charCodeAt(t + k)) return false;
  return true;
}

// The number of words q (minQ to MAX_RUN_ITEMS, ending at word j) whose keys joined are `length` long, or 0. Keys are never
// empty, so at most one q has that length, and only its text is compared.
function runWords(W, j, length, minQ) {
  for (let q = minQ; q <= Math.min(MAX_RUN_ITEMS,j); q++) {
    const joinedLength = W.ends[j] - W.ends[j - q];
    if (joinedLength === length) return q;
    if (joinedLength > length) return 0;
  }
  return 0;
}

// The cheapest run of p tokens of one shot and q words (p + q of 3 or more) that ends at token i and word j and whose
// joined text matches ("12,500" as " 12" ",500"; "$5 million." as one word): { code, cost }, or null. Joined texts that
// match end alike, so a pair whose last keys do not is skipped at once; texts are compared only at equal lengths.
function runAt({ T, W }, i, j, row) {
  const a = T.items[i - 1].key;
  const b = W.items[j - 1].key;
  if (!a.endsWith(b) && !b.endsWith(a)) return null;
  let best = null;
  for (let p = 1; p <= Math.min(MAX_RUN_ITEMS,i) && T.items[i - p].shot === T.items[i - 1].shot; p++) {
    const length = T.ends[i] - T.ends[i - p];
    const q = runWords(W, j, length, Math.max(1, 3 - p));
    if (q === 0) continue;
    const cost = row(i - p)[j - q];
    if ((best === null || cost < best.cost) && sameText(T.text, T.ends[i - p], W.text, W.ends[j - q], length)) {
      best = { code: runCode(p, q), cost };
    }
  }
  return best;
}

// The cheapest step into cell (i, j), packed. On a tie a match wins, then a run, then an unmatched token or word; a
// substitution only when strictly cheaper and only between similar words, so a tie is reported rather than substituted.
function cheapest(ctx, i, j, row) {
  const up = row(i - 1);
  const cur = row(i);
  let cost = up[j] + COST.unmatched;
  let code = STEP.missing;
  if (cur[j - 1] + COST.unmatched < cost) { cost = cur[j - 1] + COST.unmatched; code = STEP.extra; }
  const a = ctx.T.items[i - 1].id;
  const b = ctx.W.items[j - 1].id;
  if (a === b) return up[j - 1] <= cost ? up[j - 1] * CODE_SPAN + STEP.match : cost * CODE_SPAN + code;
  const run = runAt(ctx, i, j, row);
  if (run !== null && run.cost <= cost) { cost = run.cost; code = run.code; }
  if (up[j - 1] + COST.substitute < cost && ctx.similar(a, b)) { cost = up[j - 1] + COST.substitute; code = STEP.substitute; }
  return cost * CODE_SPAN + code;
}

// A cell of the first row or column: every word so far extra, or every token so far missing.
const edgeCell = (i, j) => (i + j) * COST.unmatched * CODE_SPAN + (i === 0 ? (j === 0 ? 0 : STEP.extra) : STEP.missing);

// The step into every cell of the band. Costs are kept for the last MAX_RUN_ITEMS + 1 rows only (all a run reaches
// back), INF outside each row's span; a row's slot is reset to INF over the span it held before it is reused.
function fillTable(ctx, band) {
  const ring = Array.from({ length: MAX_RUN_ITEMS + 1 }, () => new Int32Array(ctx.W.items.length + 1).fill(INF));
  const row = (i) => ring[i % ring.length];
  const steps = new Uint8Array(band.cells);
  for (let i = 0; i <= ctx.T.items.length; i++) {
    const stale = i - ring.length;
    if (stale >= 0) row(i).fill(INF, band.from(stale), band.to(stale) + 1);
    const cur = row(i);
    for (let j = band.from(i); j <= band.to(i); j++) {
      const packed = i === 0 || j === 0 ? edgeCell(i, j) : cheapest(ctx, i, j, row);
      cur[j] = Math.floor(packed / CODE_SPAN);
      steps[band.at(i, j)] = packed % CODE_SPAN;
    }
  }
  return steps;
}

// The steps of the cheapest alignment, first to last, each with the token (i) and word (j) it starts at.
function stepsOf(table, band, tokens, words) {
  const steps = [];
  let i = tokens;
  let j = words;
  while (i > 0 || j > 0) {
    const step = stepOf(table[band.at(i, j)]);
    i -= step.p;
    j -= step.q;
    steps.push(Object.freeze({ ...step, i, j }));
  }
  return Object.freeze(steps.reverse());
}

// The last alignment, by the keys it was computed from. Validation and the voice stage fit the same words to the same
// film in one run; the table is the only part of that work that grows with the product of their lengths, so it is
// built once. The steps hold indexes only (frozen); texts and times are read afresh by each caller.
let lastAlignment = { key: null, steps: null };

function alignmentSteps(tokens, words, band) {
  const key = JSON.stringify([tokens.map((t) => [t.shot, t.key]), words.map((w) => w.key)]);
  if (lastAlignment.key !== key) {
    const steps = stepsOf(fillTable(contextOf(tokens, words), band), band, tokens.length, words.length);
    lastAlignment = { key, steps };
  }
  return lastAlignment.steps;
}

/**
 * The spoken say tokens of every narrated shot in film order (`{ shot, k, key, text }`) aligned with the recording's
 * words as two sequences (a banded edit-distance alignment on their keys): `{ spans, missing, extra }`, spans[t] the
 * file span of token t (every token of a run shares one), `missing` the tokens with no word, `extra` the words with no
 * token, each with the shot it falls in (the shot of the token before it, else the first).
 */
function align(tokens, words) {
  const band = bandOf(tokens.length, words.length);
  if (band.cells > MAX_ALIGN_CELLS) {
    refuse(`the says' ${tokens.length} words and the words file's ${words.length} are too many to align (more than ${MAX_ALIGN_CELLS} pairs to compare); check that the words file is this film's recording`);
  }
  const spans = new Array(tokens.length).fill(null);
  const missing = [];
  const extra = [];
  for (const step of alignmentSteps(tokens, words, band)) {
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
 * misheard in its own place (at most MAX_EDITS edits and 40% of the longer word from the say's, or the same number
 * written differently), at the file's time for that place. A spaced dash takes a zero-length span.
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
  // sampleRate is the format's fixed value (validateSidecar requires it); a recording's own rate is not recorded here,
  // and nothing on this path reads the field: every time is in seconds from the file's first sample.
  return { version: SIDECAR_VERSION, model: null, voice: null, sampleRate: SAMPLE_RATE, shots };
}
