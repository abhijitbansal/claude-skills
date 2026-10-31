// Browser-safe (no Node imports): the root `captions` track. Parses SRT, WebVTT, Whisper JSON and the voice sidecar into
// timed words, groups them into what is on screen at once, and says what a style shows at a moment. Shared by spec
// validation, the renderer (template/caption-layer.mjs) and the tests. The grouping rules follow HyperFrames' rules.
import { graphemes, TYPING_SECONDS_PER_CHAR } from './defaults.mjs';

export const CAPTION_STYLES = Object.freeze(['plain', 'pill', 'karaoke', 'kinetic', 'boxed', 'typewriter']);
export const CAPTION_EXTENSIONS = Object.freeze(['srt', 'vtt', 'json']);
export const MAX_CAPTION_TRACKS = 20;

// groupWords' defaults: 2 to 6 words and at most 42 characters a group; a sentence end or a pause of 0.15 s starts a new
// one; a lone word joins a neighbour up to 0.5 s away; nothing shows before 0.1 s.
const GROUPING = Object.freeze({ maxWords: 6, minWords: 2, maxChars: 42, pauseSeconds: 0.15, mergeGapSeconds: 0.5, firstAt: 0.1 });
const KINETIC_SCALE = 1.15; // a kinetic word starts this big ...
const KINETIC_SECONDS = 0.15; // ... and settles to 1 over this long

const MS = 1000;
const TIME_EPSILON = 1e-6; // a count reached exactly at a step must not read as one less
const ms = (seconds) => Math.round(seconds * MS);
export const roundSeconds = (seconds) => ms(seconds) / MS;

// `line` is the 1-based line of the cue the message is about (SRT and VTT), or null (JSON).
export class CaptionError extends Error {
  constructor(message, line = null) {
    super(message);
    this.name = 'CaptionError';
    this.line = line;
  }
}

const SENTENCE_END = /[.!?。！？…‽]$/u;
const CLOSERS = /["'”’»)\]]+$/u;
const endsSentence = (word) => SENTENCE_END.test(word.replace(CLOSERS, ''));

const splitWords = (text) => String(text).split(/[\s ]+/u).filter(Boolean);
const charCount = (text) => graphemes(text).length;
export const groupText = (words) => words.map((w) => w.text).join(' ');

// The words of `text` spoken from `start` to `end`: each weighted by its characters plus one separating space (every word
// but the last), starting at its share of the span, rounded to the millisecond; the last ends exactly at `end`.
function spreadWords(text, start, end) {
  const words = splitWords(text);
  const weights = words.map((word, i) => charCount(word) + (i < words.length - 1 ? 1 : 0));
  const total = weights.reduce((a, b) => a + b, 0);
  const at = (before) => roundSeconds(start + ((end - start) * before) / total);
  let before = 0;
  return words.map((word, i) => {
    const wordStart = at(before);
    before += weights[i];
    return { text: word, start: wordStart, end: i === words.length - 1 ? end : at(before) };
  });
}

// ---- SRT and WebVTT -----------------------------------------------------------------------------------------------

const TIMESTAMP = /^(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})$/;
const ARROW = '-->';
const VTT_SKIPPED = /^(WEBVTT|NOTE|STYLE|REGION)(\s|$)/;
const CUE_INDEX = /^\d+$/;
const BOM = /^﻿/;
const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&nbsp;': ' ', '&quot;': '"', '&apos;': "'" };
const MAX_CODE_POINT = 0x10ffff;
// Only tag-shaped markup: SRT <i> <b> <u> <font …>, WebVTT <c.class>, <v Name>, <lang en>, <ruby>, <rt> and the
// karaoke timestamps <00:00:01.000>. Anything else in angle brackets is text ("a<b and c>d").
const TAGS = /<\/?(?:[biu]|c|ruby|rt)(?:\.[\w.-]+)?>|<(?:v|lang)(?:\.[\w.-]+)?(?:\s[^>]*)?>|<\/(?:v|lang)>|<font(?:\s[^>]*)?>|<\/font>|<(?:\d+:)?\d{2}:\d{2}\.\d{3}>/gi;

function seconds(stamp, where) {
  const m = TIMESTAMP.exec(stamp);
  if (!m) throw new CaptionError(`${where.label}: "${stamp}" is not a time such as 00:00:01,000`, where.line);
  const [, h = '0', min, s, frac] = m;
  return roundSeconds(Number(h) * 3600 + Number(min) * 60 + Number(s) + Number(frac.padEnd(3, '0')) / MS);
}

// &amp; and the other named entities above, and &#NNN; / &#xHH;; anything else is left as written.
function decodeEntity(entity) {
  const numeric = /^&#(x[0-9a-f]+|\d+);$/i.exec(entity);
  if (!numeric) return ENTITIES[entity] ?? entity;
  const code = numeric[1][0].toLowerCase() === 'x' ? parseInt(numeric[1].slice(1), 16) : Number(numeric[1]);
  return code > 0 && code <= MAX_CODE_POINT ? String.fromCodePoint(code) : entity;
}

// Cue text without markup: a line break (<br>, <br/>) becomes a space, then tags, ASS overrides ({\an8}) and entities go.
const cueText = (lines) => lines.join(' ').replace(/<br\s*\/?>/gi, ' ').replace(TAGS, '').replace(/\{\\[^}]*\}/g, '').replace(/&#?\w+;/g, decodeEntity);

// Blank-line separated blocks with the 1-based line each starts on. A block holding a second timing line is two cues
// whose blank line went missing: it is split there, and a bare cue number just before that line goes with the new cue.
function blocks(text) {
  const out = [];
  let current = null;
  String(text).replace(BOM, '').split(/\r\n|\r|\n/).forEach((line, i) => {
    if (line.trim() === '') { current = null; return; }
    const secondTiming = current && line.includes(ARROW) && current.lines.some((l) => l.includes(ARROW));
    if (secondTiming) {
      const index = CUE_INDEX.test(current.lines.at(-1).trim()) && !current.lines.at(-1).includes(ARROW) ? current.lines.pop() : null;
      current = { line: index === null ? i + 1 : i, lines: index === null ? [] : [index] };
      out.push(current);
    }
    if (!current) out.push(current = { line: i + 1, lines: [] });
    current.lines.push(line);
  });
  return out;
}

function parseCue(block, n) {
  const where = { label: `cue ${n} (line ${block.line})`, line: block.line };
  const at = block.lines.findIndex((l) => l.includes(ARROW));
  if (at < 0) throw new CaptionError(`${where.label}: no timing line such as "00:00:01,000 --> 00:00:02,500"`, block.line);
  const [from, rest] = block.lines[at].split(ARROW).map((s) => s.trim());
  const to = rest.split(/\s+/)[0]; // a VTT cue may carry settings after the end time
  const start = seconds(from, where);
  const end = seconds(to, where);
  if (end < start) throw new CaptionError(`${where.label}: end ${to} is before start`, block.line);
  if (end === start) throw new CaptionError(`${where.label}: end ${to} is not after start ${from}; make the cue last at least 1 ms`, block.line);
  return { where, from, start, end, text: cueText(block.lines.slice(at + 1)) };
}

// Timed cues in file order. A cue must start after the one before it; a cue that runs into the next is cut at the next
// one's start, so one cue (and so one group) is on screen at a time.
function parseCues(text, ext) {
  const cues = blocks(text).filter((b) => ext !== 'vtt' || !VTT_SKIPPED.test(b.lines[0])).map((b, i) => parseCue(b, i + 1));
  const spoken = cues.filter((c) => splitWords(c.text).length > 0);
  return spoken.map((cue, i) => {
    const prev = spoken[i - 1];
    if (prev && cue.start <= prev.start) {
      throw new CaptionError(`${cue.where.label}: start ${cue.from} is not after the previous cue's start ${prev.from}; sort the cues by time`, cue.where.line);
    }
    const next = spoken[i + 1];
    return { ...cue, end: next && next.start < cue.end ? next.start : cue.end };
  });
}

// ---- JSON: Whisper or the voice sidecar ----------------------------------------------------------------------------

function timed(item, label) {
  const { start, end } = item ?? {};
  if (!Number.isFinite(start) || !Number.isFinite(end)) throw new CaptionError(`${label}: start and end must be numbers of seconds`);
  if (end < start) throw new CaptionError(`${label}: end ${end} is before start ${start}`);
  return { start, end };
}

// A Whisper word: its text is `word` (Whisper) or `text`.
function whisperWord(x, label) {
  const word = x?.word ?? x?.text;
  if (word === undefined || word === null) throw new CaptionError(`${label}: no "word" or "text"; give every word its text`);
  return { label, word: String(word), ...timed(x, label) };
}

// [{ label, start, end, text?, word? }] in file order: Whisper words, Whisper segments without word timings, or sidecar
// sentences. A sentence or segment is spread over its span like a cue; a Whisper word is used as given.
function jsonItems(data) {
  if (Array.isArray(data?.sentences)) return data.sentences.map((s, i) => ({ label: `sentences[${i}]`, text: s?.text, ...timed(s, `sentences[${i}]`) }));
  if (Array.isArray(data?.words)) return data.words.map((x, i) => whisperWord(x, `words[${i}]`));
  if (!Array.isArray(data?.segments)) return [];
  return data.segments.flatMap((seg, si) => (Array.isArray(seg?.words)
    ? seg.words.map((x, wi) => whisperWord(x, `segments[${si}].words[${wi}]`))
    : [{ label: `segments[${si}]`, text: seg?.text, ...timed(seg, `segments[${si}]`) }]));
}

function parseJson(text) {
  let data;
  try { data = JSON.parse(String(text).replace(BOM, '')); } catch (e) { throw new CaptionError(`not valid JSON: ${e.message}`); }
  const items = jsonItems(data);
  items.forEach((item, i) => {
    if (i > 0 && item.start < items[i - 1].start) throw new CaptionError(`${item.label}: start ${item.start} is before the start of the one before it; sort them by time`);
  });
  return items.flatMap((item) => {
    if (item.word === undefined) return spreadWords(item.text ?? '', item.start, item.end);
    const word = item.word.trim(); // Whisper puts the separating space in front of the word
    return word ? [{ text: word, start: item.start, end: item.end }] : [];
  });
}

const NO_CAPTIONS = 'no captions found; expected SRT or WebVTT cues (a "00:00:01,000 --> 00:00:02,500" line, then the text), or JSON with Whisper "segments" or "words", or the voice sidecar\'s "sentences"';

/**
 * The words of a captions file, in order: [{ text, start, end }] in seconds from the file's start. `ext` is the file's
 * extension (srt, vtt or json). Throws CaptionError naming the cue and its line (SRT, VTT) or the JSON path.
 */
export function parseCaptions(text, ext) {
  const kind = String(ext).toLowerCase();
  if (!CAPTION_EXTENSIONS.includes(kind)) throw new CaptionError(`unsupported captions format ".${ext}"; use srt, vtt or json`);
  const words = kind === 'json' ? parseJson(text) : parseCues(text, kind).flatMap((cue) => spreadWords(cue.text, cue.start, cue.end));
  if (!words.length) throw new CaptionError(NO_CAPTIONS);
  return words;
}

// ---- grouping --------------------------------------------------------------------------------------------------------

const gapMs = (before, after) => ms(after[0].start) - ms(before.at(-1).end);

// Split pass: a new group after a sentence end, after a pause, at maxWords, or before a word that would take the group
// past maxChars (a word is never split, so one longer word is a group of its own).
function split(words, o) {
  const groups = [];
  for (const word of words) {
    const current = groups.at(-1);
    const fresh = !current || endsSentence(current.at(-1).text) || gapMs(current, [word]) >= ms(o.pauseSeconds)
      || current.length >= o.maxWords || charCount(groupText([...current, word])) > o.maxChars;
    if (fresh) groups.push([word]);
    else current.push(word);
  }
  return groups;
}

// Merge pass: a group under minWords joins the next group when it is close enough (mergeGapSeconds) and the result keeps
// within maxWords and maxChars, else the previous one under the same conditions. When neither fits it borrows the
// adjacent word of a close neighbour that can spare one (previous first), so no lone word sits beside a close group; a
// word that ends a sentence is never borrowed. Otherwise it stays alone: a one-word track, a word isolated by long
// pauses, or one too long to pair.
function merge(groups, o) {
  const fits = (words) => words.length <= o.maxWords && charCount(groupText(words)) <= o.maxChars;
  const near = (a, b) => gapMs(a, b) <= ms(o.mergeGapSeconds);
  const spare = (g) => g.length > o.minWords;
  const pending = [...groups];
  const out = [];
  for (let i = 0; i < pending.length; i++) {
    const words = pending[i];
    const next = pending[i + 1];
    const prev = out.at(-1);
    if (words.length >= o.minWords) out.push(words);
    else if (next && near(words, next) && fits([...words, ...next])) pending[i + 1] = [...words, ...next];
    else if (prev && near(prev, words) && fits([...prev, ...words])) out[out.length - 1] = [...prev, ...words];
    else if (prev && near(prev, words) && spare(prev) && !endsSentence(prev.at(-1).text) && fits([prev.at(-1), ...words])) out.splice(-1, 1, prev.slice(0, -1), [prev.at(-1), ...words]);
    else if (next && near(words, next) && spare(next) && !endsSentence(next[0].text) && fits([...words, next[0]])) {
      out.push([...words, next[0]]);
      pending[i + 1] = next.slice(1);
    } else out.push(words);
  }
  return out;
}

/**
 * The words as caption groups, one on screen at a time: [{ start, end, words }]. Each ends at min(its own end, the next
 * group's start). Groups that end by firstAt are dropped, and the first one left starts at max(its start, firstAt), so
 * no group shows before firstAt; a group left with no time on screen is dropped too. Pure.
 */
export function groupWords(words, options = {}) {
  const o = { ...GROUPING, ...options };
  const groups = merge(split(words, o), o);
  const timedGroups = groups
    .map((g, i) => ({ start: g[0].start, end: groups[i + 1] ? Math.min(g.at(-1).end, groups[i + 1][0].start) : g.at(-1).end, words: g }))
    .filter((g) => ms(g.end) > ms(g.start) && ms(g.end) > ms(o.firstAt));
  return timedGroups.map((g, i) => (i === 0 ? { ...g, start: Math.max(g.start, o.firstAt) } : g));
}

/**
 * A track's groups on the video's clock: its words moved by `offset` seconds (the track's `scene` + `at`), then
 * grouped. Throws CaptionError when nothing would show. Shared by the validator and the page.
 */
export function trackGroups(words, offset) {
  const groups = groupWords(words.map((w) => ({ ...w, start: roundSeconds(w.start + offset), end: roundSeconds(w.end + offset) })));
  if (!groups.length) throw new CaptionError(`nothing would show: every word ends by ${GROUPING.firstAt} s into the video; start the track later with at, or fix the times in the file`);
  return groups;
}

// ---- what a style shows ----------------------------------------------------------------------------------------------

const MARKS_WORD = new Set(['karaoke', 'kinetic']);
const easeOutCubic = (p) => 1 - (1 - p) ** 3;

/**
 * What caption style `style` shows at `t` (seconds, the groups' clock): { group, wordIndex, chars, popScale }. `group`
 * is the one with start <= t < end, or null. `wordIndex` (karaoke and kinetic; -1 otherwise or between words) is the
 * word with start <= t < end. `chars` is how many characters of the group's text show: typewriter types one every
 * 0.035 s from the group start; the others show them all. `popScale` (kinetic) shrinks the current word from 1.15 to 1
 * over the 0.15 s after it starts. Pure.
 */
export function captionState(groups, style, t) {
  const group = groups.find((g) => t >= g.start && t < g.end) ?? null;
  if (!group) return { group: null, wordIndex: -1, chars: 0, popScale: 1 };
  const total = charCount(groupText(group.words));
  const wordIndex = MARKS_WORD.has(style) ? group.words.findIndex((w) => t >= w.start && t < w.end) : -1;
  const chars = style === 'typewriter' ? Math.min(total, Math.floor((t - group.start) / TYPING_SECONDS_PER_CHAR + TIME_EPSILON)) : total;
  const settled = wordIndex < 0 ? 1 : Math.min(1, (t - group.words[wordIndex].start) / KINETIC_SECONDS);
  const popScale = style === 'kinetic' && wordIndex >= 0 ? 1 + (KINETIC_SCALE - 1) * (1 - easeOutCubic(settled)) : 1;
  return { group, wordIndex, chars, popScale };
}
