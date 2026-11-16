// The cue plan: which cue sounds when, as data for the cue renderer (synth.mjs). Planned from the film's own events
// (events.mjs), each asking the film's look which cue it makes (look.sounds), or taken from the film's own `cues` list.
// Whether any cue plays is the mode's data (`cues`) and the film's `sound`. Pure: no clock, no randomness.
import { registries } from '../../../engine/registry.mjs';
import '../../../engine/looks/index.mjs';
import '../../../engine/modes/index.mjs';
import { resolveAnchor, AnchorError } from '../../../engine/script/anchors.mjs';
import { soundEvents } from './events.mjs';
import { KNOWN_CUES } from './synth.mjs';

export const CUE_GAIN_DB = -12; // dB relative to the voice bus
export const MIN_CUE_GAP = 0.12; // seconds: a cue closer than this to the last one kept is dropped
const GAP_EPSILON = 1e-9; // so two cues exactly MIN_CUE_GAP apart are not split by float noise
const CUE_PAN = 0;
// Which cue wins when two fall within MIN_CUE_GAP: the more specific event (a number landing, then a device, then an
// emphasis, then a cut); between equal ranks the earlier one stays. An explicit list's cues all rank the same.
const TIE_RANK = Object.freeze({ cut: 0, emphasis: 1, device: 2, land: 3 });
const EXPLICIT_RANK = 0;
const DEFAULT_MODE = 'pro';
const FILM_SHOT_ID = 'film';

const knownList = () => KNOWN_CUES.join(', ');

// Throws `<where>: unknown cue ...` listing the known names when `cue` is not one of them.
function checkCue(cue, where) {
  if (!KNOWN_CUES.includes(cue)) throw new RangeError(`${where}: unknown cue ${JSON.stringify(cue)}; known cues: ${knownList()}`);
}

// The look's sounds, every cue it names checked against the synth's names.
function soundsOf(look) {
  const { sounds } = look;
  if (sounds === null || typeof sounds !== 'object') throw new RangeError(`look "${look.name}" has no sounds; a look must name the cue each event makes`);
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

// The film's own `cues` list as { t, cue }, each anchor resolved against the whole film.
function explicitCues(film, timeline) {
  const shot = filmShot(timeline);
  return film.cues.map((item, i) => {
    checkCue(item?.cue, `cues[${i}].cue`);
    try {
      return { t: resolveAnchor(item.at, shot), cue: item.cue, rank: EXPLICIT_RANK };
    } catch (err) {
      if (err instanceof AnchorError) throw new AnchorError(`cues[${i}].at: ${err.message}`);
      throw err;
    }
  });
}

function plannedCues(film, timeline, look) {
  const sounds = soundsOf(look);
  return soundEvents(film, timeline)
    .map((ev) => ({ t: ev.t, cue: cueFor(ev, sounds), rank: TIE_RANK[ev.kind] }))
    .filter((c) => c.cue !== null);
}

// Sorted (stable), held inside the film's frames (a cue on the film end sounds on its last frame), and thinned: a cue
// closer than MIN_CUE_GAP to the last one kept replaces it when it ranks higher (TIE_RANK), else is dropped.
function placed(cues, timeline) {
  const lastFrame = Math.max(0, (timeline.frameCount - 1) / timeline.fps);
  const sorted = cues.map((c) => ({ ...c, t: Math.min(lastFrame, Math.max(0, c.t)) })).sort((a, b) => a.t - b.t);
  const kept = [];
  for (const c of sorted) {
    const last = kept.at(-1);
    if (last === undefined || c.t - last.t >= MIN_CUE_GAP - GAP_EPSILON) kept.push(c);
    else if (c.rank > last.rank) kept[kept.length - 1] = c;
  }
  return kept;
}

/**
 * The cue list of `film` on `timeline`: [{ t, cue, gainDb, pan }], t in film seconds. Empty when the film says
 * "sound": "off". The film's own `cues` list ([{ at, cue }], anchors resolved across the whole film) replaces the
 * planned cues and plays in any mode; without one, cues are planned only when the mode's `cues` is true or the film
 * says "sound": "on". `looks` and `modes` are the
 * registries (default: the shared ones). An unknown cue name is an error listing the known names.
 */
export function planCues(film, timeline, { looks = registries.looks, modes = registries.modes } = {}) {
  const mode = modes.get(film.mode ?? DEFAULT_MODE);
  const explicit = Array.isArray(film.cues); // the author's own list is itself an opt-in, in any mode
  if (film.sound === 'off' || (!explicit && mode.cues !== true && film.sound !== 'on')) return Object.freeze([]);
  const cues = explicit ? explicitCues(film, timeline) : plannedCues(film, timeline, looks.get(film.look ?? mode.defaultLook));
  return Object.freeze(placed(cues, timeline).map(({ t, cue }) => Object.freeze({ t, cue, gainDb: CUE_GAIN_DB, pan: CUE_PAN })));
}
