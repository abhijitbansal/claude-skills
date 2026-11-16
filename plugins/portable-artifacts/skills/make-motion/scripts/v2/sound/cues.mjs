// The cue plan: which cue sounds when, as data for the cue renderer (synth.mjs). Planned from the film's own events
// (events.mjs), each asking the film's look which cue it makes (look.sounds), or taken from the film's own `cues` list.
// Whether any cue plays is the mode's data (`cues`) and the film's `sound`. Pure: no clock, no randomness.
import { registries } from '../../../engine/registry.mjs';
import { validateLook } from '../../../engine/looks/index.mjs';
import '../../../engine/modes/index.mjs';
import { anchorSeconds, AnchorError } from '../../../engine/script/anchors.mjs';
import { DEFAULT_MODE } from '../spec.mjs';
import { soundEvents } from './events.mjs';
import { KNOWN_CUES } from './synth.mjs';

export const CUE_GAIN_DB = -12; // dB relative to the voice bus
export const MIN_CUE_GAP = 0.12; // seconds: no two cues kept are closer than this
const GAP_EPSILON = 1e-9; // so two cues exactly MIN_CUE_GAP apart are not split by float noise
const CUE_PAN = 0;
// Which cue wins when two fall within MIN_CUE_GAP: the more specific event (a number landing, then a device, then an
// emphasis, then a cut); between equal ranks the earlier one stays. An explicit list's cues all rank the same.
const TIE_RANK = Object.freeze({ cut: 0, emphasis: 1, device: 2, land: 3 });
const EXPLICIT_RANK = 0;
const FILM_SHOT_ID = 'film';
// "word:<text>" (any word form but the index one, "word:<n>" with an optional offset): across the whole film it must name
// one shot's word, or the cue says to use the index form.
const WORD_TEXT_RE = /^word:(?!\d+(?:[+-](?:\d+(?:\.\d+)?|\.\d+))?$)([\s\S]+)$/;
const OFFSET_RE = /[+-](?:\d+(?:\.\d+)?|\.\d+)$/;
const NON_WORD_RE = /[^\p{L}\p{N}]/gu;
const SECONDS_DECIMALS = 3;

const knownList = () => KNOWN_CUES.join(', ');

// Throws `<where>: unknown cue ...` listing the known names when `cue` is not one of them.
function checkCue(cue, where) {
  if (!KNOWN_CUES.includes(cue)) throw new RangeError(`${where}: unknown cue ${JSON.stringify(cue)}; known cues: ${knownList()}`);
}

// The look's sounds: an entry for every cut and device registered now (validateLook, as at registration: a cut or
// device registered after the look is caught here rather than played as silence), and every cue it names one the synth
// knows.
function soundsOf(look) {
  const { sounds } = look;
  if (sounds === null || typeof sounds !== 'object') throw new RangeError(`look "${look.name}" has no sounds; a look must name the cue each event makes`);
  validateLook(look);
  const tables = [['cut', sounds.cut], ['device', sounds.device]];
  for (const [part, table] of tables) {
    for (const [key, cue] of Object.entries(table ?? {})) if (cue !== null) checkCue(cue, `look "${look.name}": sounds.${part}.${key}`);
  }
  for (const key of ['emphasis', 'land']) if (sounds[key] !== null) checkCue(sounds[key], `look "${look.name}": sounds.${key}`);
  return sounds;
}

const entryOf = (table, key) => (table !== null && typeof table === 'object' && Object.hasOwn(table, key) ? table[key] : null);

// The cue an event makes in a look, or null for none (a device the look names no sound for is silent).
function cueFor(ev, sounds) {
  if (ev.kind === 'cut') return entryOf(sounds.cut, ev.cut);
  if (ev.kind === 'device') return entryOf(sounds.device, ev.device);
  return sounds[ev.kind] ?? null;
}

// The whole film as one shot, for a film-level anchor: word and sentence indexes count across the film, in film seconds.
function filmShot(timeline) {
  const shifted = (list, start) => list.map((x) => ({ ...x, start: x.start + start, end: x.end + start }));
  return {
    id: FILM_SHOT_ID,
    duration: timeline.duration,
    words: timeline.shots.flatMap((s) => shifted(s.words, s.start)),
    sentences: timeline.shots.flatMap((s) => shifted(s.sentences, s.start)),
  };
}

const letters = (text) => text.replace(NON_WORD_RE, '').toLowerCase();
const listed = (items, last) => (items.length === 1 ? items[0] : `${items.slice(0, -1).join(', ')} ${last} ${items.at(-1)}`);

// The words across the film matching `text` (whole, else without a trailing offset, as anchors.mjs reads a word anchor),
// each with its film-wide index and shot: { word, offset, hits }.
function wordMatches(text, timeline) {
  const flat = timeline.shots.flatMap((s) => s.words.map((w) => ({ shot: s.id, text: w.text })));
  const tries = [[text, ''], [text.replace(OFFSET_RE, ''), OFFSET_RE.exec(text)?.[0] ?? '']];
  for (const [word, offset] of tries) {
    const wanted = letters(word);
    const hits = wanted === '' ? [] : flat.map((w, index) => ({ ...w, index })).filter((w) => letters(w.text) === wanted);
    if (hits.length > 0) return { word, offset, hits };
  }
  return { word: text, offset: '', hits: [] };
}

// Throws when "word:<text>" names words in more than one shot: the cue cannot tell which is meant. The message names the
// first such word of each shot by its index across the film, the word:<n> form anchors.mjs already reads.
function checkUnambiguous(text, timeline) {
  const { word, offset, hits } = wordMatches(text, timeline);
  const shots = [...new Set(hits.map((h) => h.shot))];
  if (shots.length <= 1) return;
  const choices = shots.map((id) => hits.find((h) => h.shot === id)).map((h) => `word:${h.index}${offset} (in "${h.shot}")`);
  throw new AnchorError(`"${word}" is spoken in more than one shot (${listed(shots.map((s) => `"${s}"`), 'and')}); `
    + `name the one you mean by its place in the film: ${listed(choices, 'or')}`);
}

// The film second an explicit cue's `at` names, before any clamp: a number or an anchor across the whole film
// (filmShot); a word named by its text only when one shot speaks it.
function explicitSeconds(at, timeline, wholeFilm) {
  const word = typeof at === 'string' ? WORD_TEXT_RE.exec(at) : null;
  if (word) checkUnambiguous(word[1], timeline);
  return anchorSeconds(at, wholeFilm);
}

const secondsText = (s) => String(Number(s.toFixed(SECONDS_DECIMALS)));

// The film's own `cues` list as { t, cue, rank }. An anchor more than a frame outside the film is an error naming the
// cue, never moved to the edge; the film end itself is inside (placed holds it on the last frame).
function explicitCues(film, timeline) {
  const wholeFilm = filmShot(timeline);
  const frame = 1 / timeline.fps;
  return film.cues.map((item, i) => {
    checkCue(item?.cue, `cues[${i}].cue`);
    let t;
    try {
      t = explicitSeconds(item.at, timeline, wholeFilm);
    } catch (err) {
      if (err instanceof AnchorError) throw new AnchorError(`cues[${i}].at: ${err.message}`);
      throw err;
    }
    if (t < -frame || t > timeline.duration + frame) {
      throw new RangeError(`cues[${i}].at: "${item.cue}" lands at ${secondsText(t)} s, outside the film (0 to ${secondsText(timeline.duration)} s)`);
    }
    return { t, cue: item.cue, rank: EXPLICIT_RANK };
  });
}

function plannedCues(film, timeline, sounds) {
  return soundEvents(film, timeline)
    .map((ev) => ({ t: ev.t, cue: cueFor(ev, sounds), rank: TIE_RANK[ev.kind] }))
    .filter((c) => c.cue !== null);
}

// Rank first (TIE_RANK, highest first), then time, then name, so the input's order never matters.
const byRank = (a, b) => b.rank - a.rank || a.t - b.t || (a.cue < b.cue ? -1 : a.cue > b.cue ? 1 : 0);

// Held inside the film's frames (a cue on the film end sounds on its last frame), then chosen highest rank first: a cue
// is kept only when no cue already kept lies within MIN_CUE_GAP of it. Returned in time order.
function placed(cues, timeline) {
  const lastFrame = Math.max(0, (timeline.frameCount - 1) / timeline.fps);
  const held = cues.map((c) => ({ ...c, t: Math.min(lastFrame, Math.max(0, c.t)) }));
  const kept = [];
  for (const c of [...held].sort(byRank)) {
    if (kept.every((k) => Math.abs(k.t - c.t) >= MIN_CUE_GAP - GAP_EPSILON)) kept.push(c);
  }
  return kept.sort((a, b) => a.t - b.t);
}

/**
 * The cue list of `film` on `timeline`: [{ t, cue, gainDb, pan }], t in film seconds. Empty when the film says
 * "sound": "off". The film's own `cues` list ([{ at, cue }]) replaces the planned cues and plays in any mode: `at` is
 * film seconds or an anchor across the whole film (word:<n> and sentence:<n> count across it); a word named by its text
 * must be spoken in one shot only, else word:<n> names it. Without one, cues are planned only when the mode's
 * `cues` is true or the film says "sound": "on". Either way the look's sounds are checked. `looks` and `modes` are the
 * registries (default: the shared ones). An unknown cue name is an error listing the known names.
 */
export function planCues(film, timeline, { looks = registries.looks, modes = registries.modes } = {}) {
  const mode = modes.get(film.mode ?? DEFAULT_MODE);
  const explicit = Array.isArray(film.cues); // the author's own list is itself an opt-in, in any mode
  if (film.sound === 'off' || (!explicit && mode.cues !== true && film.sound !== 'on')) return Object.freeze([]);
  const sounds = soundsOf(looks.get(film.look ?? mode.defaultLook));
  const cues = explicit ? explicitCues(film, timeline) : plannedCues(film, timeline, sounds);
  return Object.freeze(placed(cues, timeline).map(({ t, cue }) => Object.freeze({ t, cue, gainDb: CUE_GAIN_DB, pan: CUE_PAN })));
}
