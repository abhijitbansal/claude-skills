// Word times from the Kokoro model's per-token `durations` output (one float per input token, pads included).
// Evidence for every constant: docs/superpowers/plans/2026-11-15-pa2-voice-spike-report.md ("Duration-to-word mapping").
// Pure: no I/O, no clock. All arithmetic is in integer samples; seconds are taken once, at the end.
import { EMBEDDED_VOCAB, VoiceTextError } from './tokens.mjs';

export const FRAME_SAMPLES = 600;
export const SAMPLE_RATE = 24000;
export const LEAD = Object.freeze({ afterPunctuationMs: 42, callStartBaseMs: -119, callStartPerPadFrameMs: 12, midPhraseMs: 75 });
export const END_CAP_FRAMES = 2;

const SAMPLES_PER_MS = SAMPLE_RATE / 1000;
const SPACE = ' ';
// The punctuation characters of the pinned vocab; they and spaces are tokens with durations but belong to no word.
const PUNCTUATION = new Set([...';:,.!?—…"()“”']);
const STRESS_MARKS = new Set(['ˈ', 'ˌ']);
const isPhone = (c) => c !== SPACE && !PUNCTUATION.has(c);
const msToSamples = (ms) => ms * SAMPLES_PER_MS;

// torch.round, as Kokoro's model.py uses: halves go to the even neighbour.
function roundHalfEven(x) {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

/** Integer frames per token: max(1, round(duration)). One frame is FRAME_SAMPLES samples. Never sum the floats. */
export function framesOf(durations) {
  return Array.from(durations, (d, k) => {
    if (!Number.isFinite(d)) throw new TypeError(`durations[${k}] is not a finite number: ${d}`);
    return Math.max(1, roundHalfEven(d));
  });
}

// Phoneme words of a character array: runs of phone characters split by spaces -> [{ first, last }] character indexes.
// Punctuation is skipped without splitting a run (kokoro always follows it with a space).
function phonemeGroups(chars) {
  const groups = [];
  let first = -1;
  let last = -1;
  chars.forEach((c, i) => {
    if (c === SPACE) {
      if (first >= 0) groups.push({ first, last });
      first = -1;
    } else if (isPhone(c)) {
      if (first < 0) first = i;
      last = i;
    }
  });
  if (first >= 0) groups.push({ first, last });
  return groups;
}

// The phone characters of a character array with stress marks, spaces and punctuation removed, as one string.
const bareSound = (chars) => chars.filter((c) => isPhone(c) && !STRESS_MARKS.has(c)).join('');

// Token k owns the next counts[k] phoneme groups of the clause; a token with no group (a spaced dash) gets null.
// Returns null when the counts do not add up (espeak linked or split words in context), or when any assigned span's
// sound differs from the token's own sound, stress ignored: a linked pair and a split word can cancel in the counts
// and shift every word between them.
function spansByCount(chars, tokenChars) {
  const counts = tokenChars.map((tc) => phonemeGroups(tc).length);
  const groups = phonemeGroups(chars);
  if (counts.reduce((a, b) => a + b, 0) !== groups.length) return null;
  const ends = counts.map((_, k) => counts.slice(0, k + 1).reduce((a, b) => a + b, 0));
  const spans = counts.map((n, k) => (n === 0 ? null : { first: groups[ends[k] - n].first, last: groups[ends[k] - 1].last }));
  const agrees = spans.every((s, k) => s === null || bareSound(chars.slice(s.first, s.last + 1)) === bareSound(tokenChars[k]));
  return agrees ? spans : null;
}

// Levenshtein distance table between two arrays of { c } (unit costs).
function editTable(a, b) {
  const table = Array.from({ length: a.length + 1 }, (_, i) => {
    const row = new Int32Array(b.length + 1);
    row[0] = i;
    return row;
  });
  for (let j = 0; j <= b.length; j++) table[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1].c === b[j - 1].c ? 0 : 1;
      table[i][j] = Math.min(table[i - 1][j - 1] + cost, table[i - 1][j] + 1, table[i][j - 1] + 1);
    }
  }
  return table;
}

// For each clause phone, the token of the per-token phone it aligns to (match or substitution); a clause phone with no
// partner takes the previous phone's token, and leading ones take the first token that has phones (b[0]).
function alignLabels(a, b) {
  const leading = b.length > 0 ? b[0].k : 0;
  const table = editTable(a, b);
  const labels = new Array(a.length).fill(-1);
  let i = a.length;
  let j = b.length;
  while (i > 0 && j > 0) {
    const cost = a[i - 1].c === b[j - 1].c ? 0 : 1;
    if (table[i][j] === table[i - 1][j - 1] + cost) {
      labels[i - 1] = b[j - 1].k;
      i--;
      j--;
    } else if (table[i][j] === table[i - 1][j] + 1) i--;
    else j--;
  }
  return labels.reduce((out, label, x) => [...out, label >= 0 ? label : (x > 0 ? out[x - 1] : leading)], []);
}

// Spans by alignment of the per-token phonemes to the clause, stress marks ignored; each span then reaches back over
// the stress marks directly before its first phone. A token with no aligned phone gets null.
function spansByAlignment(chars, tokenChars) {
  const keep = (c) => isPhone(c) && !STRESS_MARKS.has(c);
  const a = chars.flatMap((c, i) => (keep(c) ? [{ c, i }] : []));
  const b = tokenChars.flatMap((tc, k) => tc.filter(keep).map((c) => ({ c, k })));
  const labels = alignLabels(a, b);
  return tokenChars.map((_, k) => {
    const mine = a.filter((_, x) => labels[x] === k);
    if (mine.length === 0) return null;
    let first = mine[0].i;
    while (first > 0 && STRESS_MARKS.has(chars[first - 1])) first--;
    return { first, last: mine.at(-1).i };
  });
}

// Maximal runs of adjacent token indexes whose flag is true.
function runsOf(flags) {
  return flags.reduce((runs, flag, k) => {
    if (!flag) return runs;
    const last = runs.at(-1);
    return last && last.at(-1) === k - 1 ? [...runs.slice(0, -1), [...last, k]] : [...runs, [k]];
  }, []);
}

// Normalize can reorder words across say tokens ("$5 million" is spoken "5 million dollars"), which no in-order
// placement can express. A run of two or more adjacent tokens whose spans fail the sound check is merged when one of
// them is misplaced: its own sound occurs in the run's region but not in its own span. Each token of a merged run gets
// the union span (run's first phone to its last) with `merged: true`; tokens outside the run are untouched. A run of
// tokens that are only reduced in context ("to the" as tə ðɪ) has no misplaced token and stays as placed.
function mergeReordered(chars, tokenChars, spans) {
  const soundOf = (s) => bareSound(chars.slice(s.first, s.last + 1));
  const fails = spans.map((s, k) => s !== null && soundOf(s) !== bareSound(tokenChars[k]));
  const merges = runsOf(fails).filter((run) => run.length > 1).flatMap((run) => {
    const union = { first: spans[run[0]].first, last: spans[run.at(-1)].last, merged: true };
    const region = soundOf(union);
    const isMisplaced = (k) => {
      const own = bareSound(tokenChars[k]);
      return own.length > 0 && region.includes(own) && !soundOf(spans[k]).includes(own);
    };
    return run.some(isMisplaced) ? run.map((k) => [k, union]) : [];
  });
  const byToken = new Map(merges);
  return spans.map((s, k) => byToken.get(k) ?? s);
}

/**
 * A zero-length span (a say token with no phonemes): last === first - 1. Its `first` is the token right after the
 * previous span (often the space or punctuation before the next word), NOT where the next word starts; it marks an
 * insertion point only. Never read `first` of an empty span as a position: wordTimes places it at the next word's start.
 */
export const isEmptySpan = (span) => span.last === span.first - 1;

// Character spans (or null) to token spans: +1 for the leading pad; a null becomes a zero-length span placed right
// after the previous span (first = previous last + 1, last = previous last).
function toTokenSpans(spans) {
  let previousLast = 0;
  return spans.map((s) => {
    const placed = s === null ? { first: previousLast + 1, last: previousLast } : { first: s.first + 1, last: s.last + 1 };
    const span = s?.merged ? { ...placed, merged: true } : placed;
    previousLast = span.last;
    return span;
  });
}

/**
 * Token index ranges (into the ids, pads included: token t is kept character t - 1) for each parseSay token of a call,
 * one per token, in order. `kept` is the call's kept phoneme string (toIds), `tokenPhonemes` each say token's
 * phonemes made alone (used only to count its phoneme words, or to align when the counts disagree); characters outside
 * the vocab are ignored in them. A token with no phonemes (a spaced dash) gets a zero-length span (isEmptySpan).
 * Adjacent tokens that normalize reordered ("$5 million" -> "5 million dollars") all get one shared span with
 * `merged: true` (isMergedWith). Throws VoiceTextError when a token has phonemes but none of them is found in the call.
 */
export function wordSpans(kept, tokenPhonemes) {
  if (typeof kept !== 'string') throw new TypeError('wordSpans: kept must be a string');
  if (!Array.isArray(tokenPhonemes) || !tokenPhonemes.every((p) => typeof p === 'string')) {
    throw new TypeError('wordSpans: tokenPhonemes must be an array of strings');
  }
  const chars = [...kept];
  const tokenChars = tokenPhonemes.map((p) => [...p].filter((c) => EMBEDDED_VOCAB.has(c)));
  const spans = spansByCount(chars, tokenChars) ?? mergeReordered(chars, tokenChars, spansByAlignment(chars, tokenChars));
  const lost = spans.findIndex((s, k) => s === null && phonemeGroups(tokenChars[k]).length > 0);
  if (lost >= 0) {
    throw new VoiceTextError(`say token ${lost} ("${tokenPhonemes[lost]}") has phonemes that were not found in the call "${kept}"`);
  }
  return toTokenSpans(spans);
}

/** Whether `span` repeats the merged span `previous` (two tokens of one merged run). */
export const isMergedWith = (span, previous) => previous !== undefined && span.merged === true && previous.merged === true
  && span.first === previous.first && span.last === previous.last;

function checkSpans(spans, keptLength) {
  spans.forEach((s, i) => {
    const ok = Number.isInteger(s.first) && Number.isInteger(s.last) && s.first >= 1 && s.last >= s.first - 1 && s.last <= keptLength;
    if (!ok) throw new RangeError(`spans[${i}]: ${JSON.stringify(s)} is not a token range inside 1..${keptLength}`);
    if (i > 0 && !isMergedWith(s, spans[i - 1]) && s.first <= spans[i - 1].last) {
      throw new RangeError(`spans[${i}]: overlaps or precedes spans[${i - 1}]`);
    }
  });
}

// Lead in samples by context, decided from the phoneme string only. Token t is kept character t - 1.
// The contiguous run of space tokens before the word (two when a spaced bracket was dropped) is skipped: punctuation
// before the run means after punctuation; otherwise mid-phrase, with half the run's summed frames.
function leadSamples(index, first, chars, frames) {
  // Call start: clamped to at least 0, so a pad shorter than the fitted range (11 to 24 frames) never moves a start
  // later than raw.
  if (index === 0) return Math.max(0, msToSamples(LEAD.callStartBaseMs + LEAD.callStartPerPadFrameMs * frames[0]));
  let token = first - 1;
  let spaceFrames = 0;
  while (token >= 1 && chars[token - 1] === SPACE) {
    spaceFrames += frames[token];
    token--;
  }
  if (token >= 1 && PUNCTUATION.has(chars[token - 1])) return msToSamples(LEAD.afterPunctuationMs);
  return (spaceFrames * FRAME_SAMPLES) / 2 + msToSamples(LEAD.midPhraseMs);
}

// Start samples of the words (non-empty spans) in order, each clamped to the previous start and to 0.
function wordStarts(words, chars, frames, cum) {
  let floor = 0;
  return words.map((span, w) => {
    floor = Math.max(floor, cum[span.first] * FRAME_SAMPLES - leadSamples(w, span.first, chars, frames));
    return floor;
  });
}

// End samples of the words: the next word's start when only spaces (or nothing, in a linked group) lie between them;
// otherwise (punctuation follows, or the word is last) the last token counted as at most END_CAP_FRAMES frames.
function wordEnds(words, starts, chars, frames, cum) {
  return words.map((span, w) => {
    const next = words[w + 1];
    const isDirect = next !== undefined && chars.slice(span.last, next.first - 1).every((c) => c === SPACE);
    if (isDirect) return starts[w + 1];
    const capped = (cum[span.last] + Math.min(frames[span.last], END_CAP_FRAMES)) * FRAME_SAMPLES;
    return Math.max(starts[w], capped);
  });
}

// A zero-length token sits at the next word's start, else at the previous word's end, else at the call's start.
function emptyTime(index, wordIndexes, starts, ends) {
  const next = wordIndexes.findIndex((i) => i > index);
  if (next >= 0) return { start: starts[next], end: starts[next] };
  const previous = wordIndexes.length - 1;
  return previous >= 0 ? { start: ends[previous], end: ends[previous] } : { start: 0, end: 0 };
}

/**
 * `[{ start, end }]` in seconds from the call's first sample, one per span (say token), in order.
 * Start: raw (the first sample of the word's first token) minus a lead by context: first word of the call
 * max(0, -119 + 12 * pad frames) ms; after punctuation 42 ms; mid-phrase half the spaces before it plus 75 ms. A start never
 * precedes the previous word's start or the call's start.
 * End: a word followed directly by another word (only a space between) ends at that word's start; a word followed by
 * punctuation, or last in its call, ends after its last token counted as at most END_CAP_FRAMES frames. An end never
 * precedes its start. A zero-length span starts and ends at the next word's start, or at the previous word's end.
 * Tokens of one merged run (isMergedWith) are one word: each gets that word's start and end.
 * `end === start` is legal: a zero-length span (a spaced dash), or a word whose start was clamped up to the previous
 * word's start or whose capped end was clamped up to its start. Consumers must not assume `end > start`.
 */
export function wordTimes({ kept, frames, spans }) {
  const chars = [...kept];
  if (frames.length !== chars.length + 2) {
    throw new RangeError(`frames: expected ${chars.length + 2} (one per kept phoneme and two pads), got ${frames.length}`);
  }
  const bad = frames.findIndex((f) => !Number.isInteger(f) || f < 1);
  if (bad >= 0) throw new RangeError(`frames[${bad}]: ${frames[bad]} is not an integer of at least 1 (use framesOf(durations))`);
  checkSpans(spans, chars.length);
  const cum = frames.reduce((acc, f) => [...acc, acc.at(-1) + f], [0]);
  // One word per non-empty span; the later tokens of a merged run repeat the run's span and share its word.
  const wordIndexes = spans.flatMap((span, i) => (isEmptySpan(span) || isMergedWith(span, spans[i - 1]) ? [] : [i]));
  const words = wordIndexes.map((i) => spans[i]);
  const starts = wordStarts(words, chars, frames, cum);
  const ends = wordEnds(words, starts, chars, frames, cum);
  const headOf = (i) => (i > 0 && isMergedWith(spans[i], spans[i - 1]) ? headOf(i - 1) : i);
  return spans.map((_, i) => {
    const w = wordIndexes.indexOf(headOf(i));
    const samples = w >= 0 ? { start: starts[w], end: ends[w] } : emptyTime(i, wordIndexes, starts, ends);
    return { start: samples.start / SAMPLE_RATE, end: samples.end / SAMPLE_RATE };
  });
}
