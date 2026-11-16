// Cutting on the beat: `music: { src, snap: true }` moves the cuts of a film with no narration onto the beats of the
// user's music (detected, or read from music.beats). A narrated film's cuts are fixed by its words, so the validator
// refuses snap there (spec-sound.mjs). Pure: a new timeline is returned, the input is never changed.
import { registries } from '../../../engine/registry.mjs';

/** The shortest a shot may be, as the timeline makes every shot (engine/script/timing.mjs MIN_SHOT_SECONDS). */
export const SNAP_MIN_SHOT_SECONDS = 1;
/** How far a cut may move to reach a beat: a quarter of a second, half a beat at 120 BPM. */
export const SNAP_MAX_SHIFT_SECONDS = 0.25;
const DEFAULT_CUT = 'cut'; // as engine/script/timing.mjs cutErrors names a shot's cut when it gives none

/**
 * The shortest each shot of `film` may become: SNAP_MIN_SHOT_SECONDS, or the length of the cut that opens it when that
 * is longer (a cut runs over the first `dur` seconds of the shot it opens, engine/cuts).
 */
export function shotFloors(film, cuts = registries.cuts) {
  return film.shots.map((shot, index) => {
    const name = shot.cut ?? DEFAULT_CUT;
    const dur = index > 0 && cuts?.has?.(name) ? cuts.get(name).dur ?? 0 : 0;
    return Math.max(SNAP_MIN_SHOT_SECONDS, dur);
  });
}

// The beat nearest `time`, or null for none.
function nearestBeat(beats, time) {
  let best = null;
  for (const beat of beats) if (best === null || Math.abs(beat - time) < Math.abs(best - time)) best = beat;
  return best;
}

// Where cut `k` (the start of shot k) goes, in frames: the nearest beat's frame when it is within `maxFrames`, leaves
// shot k-1 (from `prevStart`) and shot k (to `nextStart`) at least their floors, and is not where the cut already is;
// else null.
function snappedFrame({ beats, fps, from, prevStart, nextStart, floors, k, maxShiftSeconds }) {
  const beat = nearestBeat(beats, from / fps);
  if (beat === null) return null;
  const to = Math.round(beat * fps);
  const fits = (to - prevStart) / fps >= floors[k - 1] - 1e-9 && (nextStart - to) / fps >= floors[k] - 1e-9;
  return to !== from && Math.abs(to - from) / fps <= maxShiftSeconds + 1e-9 && fits ? to : null;
}

/**
 * Moves each cut of `timeline` (in order) to its nearest beat when that is within `maxShiftSeconds` and leaves both
 * shots beside it at least `minShot` long (a number, or one floor per shot: shotFloors); otherwise the cut stays. Cuts
 * land on whole frames. The film's first frame and its last stay where they are, so its length does not change.
 * -> { timeline, moved: [{ shot: the id of the shot the cut opens, from, to }] } (seconds).
 */
export function snapCuts(timeline, beats, { minShot = SNAP_MIN_SHOT_SECONDS, maxShiftSeconds = SNAP_MAX_SHIFT_SECONDS } = {}) {
  const { fps, shots } = timeline;
  const floors = Array.isArray(minShot) ? minShot : shots.map(() => minShot);
  const starts = [...shots.map((s) => Math.round(s.start * fps)), timeline.frameCount];
  const moved = [];
  for (let k = 1; k < shots.length; k++) {
    const to = snappedFrame({ beats, fps, from: starts[k], prevStart: starts[k - 1], nextStart: starts[k + 1], floors, k, maxShiftSeconds });
    if (to === null) continue;
    moved.push({ shot: shots[k].id, from: starts[k] / fps, to: to / fps });
    starts[k] = to;
  }
  const snapped = shots.map((shot, k) => ({ ...shot, start: starts[k] / fps, end: starts[k + 1] / fps, duration: (starts[k + 1] - starts[k]) / fps }));
  return { timeline: { ...timeline, shots: snapped }, moved };
}

/**
 * The timeline a film is drawn with once its music is known: snapped onto `beats` when `film.music.snap` is true, with
 * each shot's floor from shotFloors; else the same `timeline` object and `moved: null`.
 */
export function snapFilm(film, timeline, beats, { cuts = registries.cuts } = {}) {
  if (film.music?.snap !== true) return { timeline, moved: null };
  return snapCuts(timeline, beats, { minShot: shotFloors(film, cuts) });
}
