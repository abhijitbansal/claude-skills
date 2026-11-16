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

// The measured words of `shot` from its sidecar entry in the estimate's shape, each time plus `offset` (NARRATION_LEAD:
// shot-local seconds; 0 for a recording's words, which stay in seconds from the start of the file).
function measuredWords(shot, measured, index, tokens, offset = NARRATION_LEAD) {
  const where = `words[${index}]`;
  const flat = (Array.isArray(measured.sentences) ? measured.sentences : []).flatMap((s) => (Array.isArray(s?.words) ? s.words : []));
  if (flat.length !== tokens.length) {
    throw new RangeError(`${where}: ${flat.length} words, the say of shot "${shot.id}" has ${tokens.length}`);
  }
  // The times are the voice's; what is emphasised or an aside is the film's own say.
  return flat.map((w, k) => ({ text: w.text, start: w.start + offset, end: w.end + offset, emphasis: tokens[k].emphasis, aside: tokens[k].aside }));
}

/**
 * A measured shot's words as the picture shows them: the first word from the shot's first frame (start 0), so a shot
 * never opens on an empty frame while its voice's lead-in plays; its sound still starts at its measured time (the mix
 * reads the sidecar, not these). So are the tokens that start with it: a run sharing its word ("$5 million" as one
 * word), or a spaced dash before it (a zero-length span at its start). Every other word keeps its measured time. An
 * anchor on the first word is the shot start.
 */
const shownFromShotStart = (words) => words.map((w) => (w.start === words[0].start ? { ...w, start: 0 } : w));

// A spoken shot timed by its measured words: as long as its last word end plus the trailing pause and the tail, and
// never shorter than its WAV, so the narration cannot run into the next shot.
function measuredShot(shot, pace, measured, index) {
  const { tokens, trailingPause } = parsedSay(shot);
  const words = shownFromShotStart(measuredWords(shot, measured, index, tokens));
  const narration = words.at(-1).end;
  if (!Number.isFinite(measured.seconds)) {
    throw new RangeError(`words[${index}]: seconds must be the WAV's length in seconds, got ${measured.seconds}`);
  }
  const wav = NARRATION_LEAD + measured.seconds;
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

// ---- a film narrated by one recording: the timeline follows the file ---------------------------------------------------

/** Seconds a narrated shot of a recorded film starts before its first word (never before the last word of the shot before). */
export const RECORDING_LEAD = 0.15;

/** A recorded film whose shots cannot be laid on the recording: `errors` are { path, message }, the validator's form. */
export class PlacementError extends Error {
  constructor(errors) {
    super(errors.map((e) => `${e.path}: ${e.message}`).join('\n'));
    this.name = 'PlacementError';
    this.errors = errors;
  }
}

const SECONDS_DECIMALS = 2;
const secondsText = (seconds) => String(Number(seconds.toFixed(SECONDS_DECIMALS)));
const idsText = (shots) => shots.map((s) => `"${s.id}"`).join(' and ');

// Each film shot as the layout sees it: a narrated one with its words in file seconds, or a say-less one with its hold.
function recordedShot(shot, index, measured, fps) {
  if (measured?.id !== shot.id) throw new RangeError(`words[${index}]: shot ${JSON.stringify(measured?.id)}, the film's shot is "${shot.id}"`);
  if (shot.say === undefined || shot.say === null) {
    return { id: shot.id, index, narrated: false, holdFrames: toFrames(secondsForShot(shot, null).seconds, fps) };
  }
  const { tokens } = parsedSay(shot);
  const words = measuredWords(shot, measured, index, tokens, 0);
  return { id: shot.id, index, narrated: true, tokens, words, first: words[0].start, last: words.at(-1).end };
}

// The start frame of each narrated shot: RECORDING_LEAD before its first word, not before the last word of the
// narrated shot before it, never after its own first word; the film's first shot starts at frame 0.
function narratedStarts(shots, fps, errors) {
  const starts = new Map();
  let previous = null;
  for (const shot of shots.filter((s) => s.narrated)) {
    const lead = Math.floor((shot.first - RECORDING_LEAD) * fps + FRAME_EPSILON);
    const clamp = previous === null ? 0 : Math.ceil(previous.last * fps - FRAME_EPSILON);
    const latest = Math.floor(shot.first * fps + FRAME_EPSILON);
    const start = shot.index === 0 ? 0 : Math.min(latest, Math.max(lead, clamp, 0));
    if (previous !== null && start <= starts.get(previous.index)) {
      errors.push({ path: `shots[${shot.index}]`, message: `its first word is at ${secondsText(shot.first)} s in the recording, within a frame of the start of "${previous.id}"; the recording's words must run in the film's order` });
    }
    starts.set(shot.index, start);
    previous = shot;
  }
  return starts;
}

// Say-less shots before the first narrated one: their holds, the first of them taking any room left before it.
function leadingFrames(run, startFrame, fps, firstWord, errors) {
  const total = run.reduce((n, s) => n + s.holdFrames, 0);
  if (total > startFrame) {
    errors.push({ path: `shots[${run[0].index}]`, message: `${idsText(run)} need${run.length === 1 ? 's' : ''} ${secondsText(total / fps)} s, but the recording's first word is at ${secondsText(firstWord)} s; shorten the hold, or start the recording later` });
    return run.map((s) => s.holdFrames);
  }
  return run.map((s, k) => s.holdFrames + (k === 0 ? startFrame - total : 0));
}

// The end frame of narrated shot `a` when say-less shots `run` sit between it and the next narrated shot `b` (starting
// at `bStart`): they keep their holds just before `b`, and `a` runs to them; its last word must still end inside it.
function betweenEnd(a, run, b, bStart, fps, errors) {
  const total = run.reduce((n, s) => n + s.holdFrames, 0);
  const end = bStart - total;
  if (run.length > 0 && end < Math.ceil(a.last * fps - FRAME_EPSILON)) {
    const room = bStart / fps - a.last;
    errors.push({ path: `shots[${run[0].index}]`, message: `${idsText(run)} need${run.length === 1 ? 's' : ''} ${secondsText(total / fps)} s, but the recording leaves ${secondsText(room)} s between the last word of "${a.id}" (${secondsText(a.last)} s) and the start of "${b.id}" (${secondsText(bStart / fps)} s); shorten the hold, or leave a longer pause in the recording` });
  }
  return end;
}

// The frame count of every shot, in order (see recordedTimeline).
function layoutFrames(shots, starts, fps, tail, errors) {
  const narrated = shots.filter((s) => s.narrated);
  if (narrated.length === 0) return shots.map((s) => s.holdFrames);
  const frames = new Array(shots.length);
  const firstIndex = narrated[0].index;
  leadingFrames(shots.slice(0, firstIndex), starts.get(firstIndex), fps, narrated[0].first, errors).forEach((f, k) => { frames[k] = f; });
  narrated.forEach((a, k) => {
    const b = narrated[k + 1];
    const run = shots.slice(a.index + 1, b === undefined ? shots.length : b.index);
    const end = b === undefined
      ? Math.max(starts.get(a.index) + 1, Math.ceil((a.last + tail) * fps - FRAME_EPSILON))
      : betweenEnd(a, run, b, starts.get(b.index), fps, errors);
    frames[a.index] = Math.max(1, end - starts.get(a.index));
    run.forEach((s) => { frames[s.index] = s.holdFrames; });
  });
  return frames;
}

// A cut runs over the first `dur` seconds of the shot it opens (engine/cuts): it must end inside that shot.
function cutErrors(film, frames, fps, cuts) {
  return film.shots.flatMap((shot, index) => {
    const name = shot.cut ?? 'cut';
    if (index === 0 || !cuts?.has?.(name)) return [];
    const { dur } = cuts.get(name);
    if (dur * fps <= frames[index] + FRAME_EPSILON) return [];
    return [{ path: `shots[${index}].cut`, message: `the "${name}" cut into "${shot.id}" lasts ${secondsText(dur)} s, but the shot lasts ${secondsText(frames[index] / fps)} s; use a shorter cut, or leave a longer pause before the next shot in the recording` }];
  });
}

// The timeline of a film narrated by one recording (buildTimeline with `recording`): every narrated word is heard in the
// film at its time in the file, and shown then too, but for each shot's first word, shown from the shot's first frame
// (shownFromShotStart). A narrated shot starts RECORDING_LEAD before its first word (see narratedStarts) and runs
// to the next shot; say-less shots between two narrated ones keep their holds and sit just before the next narrated
// shot; the last narrated shot runs to its last word end plus the mode's tail; say-less shots after it follow with their
// holds. Shots are whole frames back to back, so a word may sit up to a frame from a shot edge. Throws a PlacementError
// when a say-less shot or a cut cannot be laid without moving a word.
function recordedTimeline(film, { fps, pace, words, cuts }) {
  const shots = film.shots.map((shot, index) => recordedShot(shot, index, words[index], fps));
  const errors = [];
  const starts = narratedStarts(shots, fps, errors);
  const frames = layoutFrames(shots, starts, fps, pace.tail, errors);
  errors.push(...cutErrors(film, frames, fps, cuts));
  if (errors.length > 0) throw new PlacementError(errors);
  let startFrame = 0;
  const entries = shots.map((shot, index) => {
    const start = startFrame / fps;
    const local = shot.narrated ? shownFromShotStart(shot.words.map((w) => ({ ...w, start: w.start - start, end: w.end - start }))) : [];
    startFrame += frames[index];
    return { id: shot.id, index, start, end: startFrame / fps, duration: frames[index] / fps, words: local, sentences: shot.narrated ? groupSentences(shot.tokens, local) : [] };
  });
  return { fps, duration: startFrame / fps, frameCount: startFrame, timed: 'measured', shots: entries };
}

/**
 * The shot timeline of `film` at `fps`, each spoken shot paced by its mode (the registered mode's wpm and tail).
 * `modes` is the modes registry (default: the shared one; the validator passes the registries it checked with).
 * `words` is a voice sidecar's `shots` list (scripts/v2/voice/sidecar.mjs), one entry per film shot, or undefined.
 * With it every spoken shot takes its word times from the sidecar (from narrationStart), but for its first word, shown
 * from the shot's start (shownFromShotStart), its emphasis and asides from its say, and `timed` is 'measured'. A sidecar whose shot count, ids, word counts or WAV lengths do not fit the film
 * throws, never falling back to the estimate; word texts and times are validateSidecar's to check (run.mjs calls it).
 * Without it, 'estimated'. `recording: true` says the words are a recording's (scripts/v2/voice/sidecar.mjs
 * fromWhisper: one file, times from its start) and the timeline follows the file (recordedTimeline); `cuts` is the
 * cuts registry whose durations it checks against the shots (default: the shared one).
 */
export function buildTimeline(film, { fps, modes = registries.modes, words, recording = false, cuts = registries.cuts } = {}) {
  if (!Number.isFinite(fps) || fps <= 0) throw new RangeError(`fps must be a positive number, got ${fps}`);
  if (!Array.isArray(film.shots)) throw new TypeError('film.shots must be an array');
  checkWords(words, film);
  const pace = paceOf(film.mode ?? DEFAULT_MODE, modes);
  if (recording) {
    if (words === undefined) throw new TypeError('buildTimeline: a recorded film needs its words');
    return recordedTimeline(film, { fps, pace, words, cuts });
  }

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
