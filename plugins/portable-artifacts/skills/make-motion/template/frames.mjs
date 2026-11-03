// Browser-safe (no imports): the render's frame grid, the one source render.mjs and every cut-off check share. render.mjs
// draws frameCount(total, fps) frames, frame i at i / fps seconds, and a frame on a scene boundary belongs to the next
// scene (renderer.mjs activeScene). So the last frame a scene gets can come up to 1.5 frames before its end, not 1: a
// typing line, a terminal's last output line or a block's last entrance must land by that frame to be seen whole.

export const SCENE_EDGE_EPSILON = 1e-9; // renderer.mjs SCENE_END_EPSILON: a frame this close to a scene start is that scene's
const CENTISECONDS = 100;
const MAX_SCENE_CENTISECONDS = 6000; // a scene lasts at most 60 s (spec.mjs)

/** How many frames render.mjs draws for a video of `totalSeconds` at `fps`. */
export const frameCount = (totalSeconds, fps) => Math.round(totalSeconds * fps);

// Scene start times, summed in order exactly as the timeline does (so the floats agree).
function startsOf(durations) {
  let cursor = 0;
  return durations.map((d) => {
    const start = cursor;
    cursor += d;
    return start;
  });
}

/**
 * The scene-local second of the last frame scene `index` of a video with scene lengths `durations` shows at `fps`, or null
 * when it shows none.
 */
export function lastFrameAt(durations, index, fps) {
  const starts = startsOf(durations);
  const total = starts.at(-1) + durations.at(-1);
  let i = frameCount(total, fps) - 1;
  if (index < durations.length - 1) {
    const next = starts[index + 1] - SCENE_EDGE_EPSILON; // the first moment that is the next scene's
    while (i >= 0 && i / fps >= next) i--;
  }
  if (i < 0 || i / fps < starts[index] - SCENE_EDGE_EPSILON) return null;
  return i / fps - starts[index];
}

/**
 * The frame grid a check runs on, from a block validate's or expand's context: `durations` and `index` (every scene's
 * length and this one's place) when the caller knows them, else a video of this one scene.
 */
export const gridOf = ({ sceneDuration, fps, durations, index = 0 }) => ({ fps, index, durations: durations ? durations.map((d, i) => (i === index ? sceneDuration : d)) : [sceneDuration] });

/** Whether scene second `t` is on screen at or before the scene's last frame on `grid` (gridOf). */
export function showsBy(t, grid) {
  const last = lastFrameAt(grid.durations, grid.index, grid.fps);
  return last !== null && last + SCENE_EDGE_EPSILON >= t;
}

/**
 * The shortest scene length in whole centiseconds, from `from` up (the other scenes unchanged), at which `passes(grid)`
 * holds: what a cut-off error recommends, so the length it names is one that passes. Null past 60 s.
 */
export function shortestPassing(grid, from, passes) {
  for (let cs = Math.max(1, Math.ceil(from * CENTISECONDS - 1e-6)); cs <= MAX_SCENE_CENTISECONDS; cs++) {
    const durations = grid.durations.map((d, i) => (i === grid.index ? cs / CENTISECONDS : d));
    if (passes({ ...grid, durations })) return cs / CENTISECONDS;
  }
  return null;
}

/**
 * The cut-off rule every timed thing shares: a scene on `grid` passes when it is at least `minimum` long (less
 * `tolerance`, for a rule written with one) and its last frame comes at or after scene second `end` (a number, or a
 * function of the scene's length for a schedule that depends on it). -> null when it passes, else the shortest
 * centisecond length that does (from `minimum` up), the one an error should name.
 */
export function frameCutoff(grid, { end, minimum, tolerance = 0 }) {
  const endOf = typeof end === 'function' ? end : () => end;
  const passes = (g) => g.durations[g.index] + tolerance >= minimum && showsBy(endOf(g.durations[g.index]), g);
  if (passes(grid)) return null;
  return shortestPassing(grid, minimum, passes) ?? Math.ceil(minimum * CENTISECONDS) / CENTISECONDS;
}

/**
 * The exact shortest length of a scene alone in its video at which second `t` is shown by its last frame at `fps`: the
 * threshold a block's minDuration states (a lone scene at least this long passes showsBy, a shorter one does not).
 */
export const loneSceneShowing = (t, fps) => (Math.ceil(t * fps - SCENE_EDGE_EPSILON) + 0.5) / fps + SCENE_EDGE_EPSILON;
