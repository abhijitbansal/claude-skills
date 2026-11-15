// Word times from the Kokoro model's per-token `durations` output (one float per input token, pads included).
// Evidence for every constant: docs/superpowers/plans/2026-11-15-pa2-voice-spike-report.md ("Duration-to-word mapping").
// Pure: no I/O, no clock. All arithmetic is in integer samples; seconds are taken once, at the end.
import { VoiceTextError } from './tokens.mjs';

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

// Token k owns the next counts[k] phoneme groups of the clause; a token with no group (a spaced dash) gets null.
// Returns null when the counts do not add up (espeak linked or split words in context).
function spansByCount(chars, tokenChars) {
  const counts = tokenChars.map((tc) => phonemeGroups(tc).length);
  const groups = phonemeGroups(chars);
  if (counts.reduce((a, b) => a + b, 0) !== groups.length) return null;
  const ends = counts.map((_, k) => counts.slice(0, k + 1).reduce((a, b) => a + b, 0));
  return counts.map((n, k) => (n === 0 ? null : { first: groups[ends[k] - n].first, last: groups[ends[k] - 1].last }));
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
// partner takes the previous phone's token (the first one takes token 0).
function alignLabels(a, b) {
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
  return labels.reduce((out, label, x) => [...out, label >= 0 ? label : (x > 0 ? out[x - 1] : 0)], []);
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

/** A zero-length span (a say token with no phonemes): last === first - 1. */
export const isEmptySpan = (span) => span.last === span.first - 1;

// Character spans (or null) to token spans: +1 for the leading pad; a null becomes a zero-length span placed right
// after the previous span (first = previous last + 1, last = previous last).
function toTokenSpans(spans) {
  let previousLast = 0;
  return spans.map((s) => {
    const span = s === null ? { first: previousLast + 1, last: previousLast } : { first: s.first + 1, last: s.last + 1 };
    previousLast = span.last;
    return span;
  });
}

/**
 * Token index ranges (into the ids, pads included: token t is kept character t - 1) for each parseSay token of a call,
 * one per token, in order. `kept` is the call's kept phoneme string (toIds), `tokenPhonemes` each say token's kept
 * phonemes made alone (used only to count its phoneme words, or to align when the counts disagree). A token with no
 * phonemes (a spaced dash) gets a zero-length span (isEmptySpan). Throws VoiceTextError when a token has phonemes but
 * none of them is found in the call.
 */
export function wordSpans(kept, tokenPhonemes) {
  if (typeof kept !== 'string') throw new TypeError('wordSpans: kept must be a string');
  if (!Array.isArray(tokenPhonemes) || !tokenPhonemes.every((p) => typeof p === 'string')) {
    throw new TypeError('wordSpans: tokenPhonemes must be an array of strings');
  }
  const chars = [...kept];
  const tokenChars = tokenPhonemes.map((p) => [...p]);
  const spans = spansByCount(chars, tokenChars) ?? spansByAlignment(chars, tokenChars);
  const lost = spans.findIndex((s, k) => s === null && phonemeGroups(tokenChars[k]).length > 0);
  if (lost >= 0) {
    throw new VoiceTextError(`say token ${lost} ("${tokenPhonemes[lost]}") has phonemes that were not found in the call "${kept}"`);
  }
  return toTokenSpans(spans);
}

function checkSpans(spans, keptLength) {
  spans.forEach((s, i) => {
    const ok = Number.isInteger(s.first) && Number.isInteger(s.last) && s.first >= 1 && s.last >= s.first - 1 && s.last <= keptLength;
    if (!ok) throw new RangeError(`spans[${i}]: ${JSON.stringify(s)} is not a token range inside 1..${keptLength}`);
    if (i > 0 && s.first <= spans[i - 1].last) throw new RangeError(`spans[${i}]: overlaps or precedes spans[${i - 1}]`);
  });
}

// Lead in samples by context, decided from the phoneme string only. Token t is kept character t - 1.
function leadSamples(index, first, chars, frames) {
  if (index === 0) return msToSamples(LEAD.callStartBaseMs + LEAD.callStartPerPadFrameMs * frames[0]);
  const before = chars[first - 2];
  const isSpaceBefore = before === SPACE;
  const prior = isSpaceBefore ? chars[first - 3] : before;
  if (PUNCTUATION.has(prior)) return msToSamples(LEAD.afterPunctuationMs);
  const spaceFrames = isSpaceBefore ? frames[first - 1] : 0;
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
 * -119 + 12 * pad frames ms; after punctuation 42 ms; mid-phrase half the space before it plus 75 ms. A start never
 * precedes the previous word's start or the call's start.
 * End: a word followed directly by another word (only a space between) ends at that word's start; a word followed by
 * punctuation, or last in its call, ends after its last token counted as at most END_CAP_FRAMES frames. An end never
 * precedes its start. A zero-length span starts and ends at the next word's start, or at the previous word's end.
 */
export function wordTimes({ kept, frames, spans }) {
  const chars = [...kept];
  if (frames.length !== chars.length + 2) {
    throw new RangeError(`frames: expected ${chars.length + 2} (one per kept phoneme and two pads), got ${frames.length}`);
  }
  checkSpans(spans, chars.length);
  const cum = frames.reduce((acc, f) => [...acc, acc.at(-1) + f], [0]);
  const wordIndexes = spans.flatMap((span, i) => (isEmptySpan(span) ? [] : [i]));
  const words = wordIndexes.map((i) => spans[i]);
  const starts = wordStarts(words, chars, frames, cum);
  const ends = wordEnds(words, starts, chars, frames, cum);
  return spans.map((_, i) => {
    const w = wordIndexes.indexOf(i);
    const samples = w >= 0 ? { start: starts[w], end: ends[w] } : emptyTime(i, wordIndexes, starts, ends);
    return { start: samples.start / SAMPLE_RATE, end: samples.end / SAMPLE_RATE };
  });
}
