// What validateFilm checks in a clipping shot beyond its schema: each region's rectangle, and, in a look that cuts to
// region close-ups (a locked camera), the timing of region events and targets that the close-up would hide. Errors
// are { path, message } with paths relative to the shot. Pure and DOM-free.
import { REGION_PREFIX, regionOf, cutsToCloseUp, heroProblems } from './shared.mjs';

const EDGE_EPSILON = 1e-9;

/** Region rectangles: x, y, w, h are fractions of the image; w and h above 0; x + w and y + h at most 1. */
export function regionProblems(shot) {
  return Object.entries(shot.regions ?? {}).flatMap(([name, rect]) => {
    if (!Array.isArray(rect) || rect.length !== 4 || !rect.every(Number.isFinite)) return []; // the schema says what to write
    const [x, y, w, h] = rect;
    const path = `regions.${name}`;
    if (!(w > 0 && h > 0)) return [{ path, message: `region "${name}": w and h must be above 0, got ${w} and ${h}` }];
    if (x + w > 1 + EDGE_EPSILON || y + h > 1 + EDGE_EPSILON) {
      return [{ path, message: `region "${name}" runs past the image: x + w and y + h must be at most 1, got ${x + w} and ${y + h}` }];
    }
    return [];
  });
}

/**
 * In a close-up look: two events on different regions at the same moment (which close-up?) and an event aimed at
 * `image` after the first close-up (the whole picture is gone by then; target the region instead). `at` resolves an
 * anchor to shot seconds; without it (a shot whose length is unknown) the timing rules are skipped.
 */
export function closeUpProblems(shot, look, at) {
  if (!look || !cutsToCloseUp(look) || !at || !Array.isArray(shot.on)) return [];
  const events = shot.on.map((item, j) => ({ item, j, t: safeAt(at, item.at), region: regionOf(item?.target) }))
    .filter((e) => e.t !== null);
  const regional = events.filter((e) => e.region !== null);
  const first = regional.length === 0 ? null : Math.min(...regional.map((e) => e.t));
  return events.flatMap((e) => {
    if (e.region !== null) {
      const clash = regional.find((o) => o.j < e.j && o.t === e.t && o.region !== e.region);
      if (clash) return [{ path: `on.${e.j}.at`, message: `on[${e.j}] cuts to region "${e.region}" at the same time as on[${clash.j}] cuts to region "${clash.region}"; give them different times` }];
      return [];
    }
    if (first !== null && e.item?.target === 'image' && e.t >= first) {
      return [{ path: `on.${e.j}.target`, message: `on[${e.j}] aims at "image" after the shot has cut to a region close-up; target the region instead (${REGION_PREFIX}<name>)` }];
    }
    return [];
  });
}

// An anchor's time, or null when it does not resolve (its own validation error says why).
function safeAt(at, ref) {
  try {
    return at(ref);
  } catch (err) {
    if (err?.name === 'AnchorError') return null;
    throw err;
  }
}

/** The clipping kind's validate hook. */
export function clippingProblems(shot, { look, at } = {}) {
  return [...heroProblems(shot), ...regionProblems(shot), ...closeUpProblems(shot, look, at)];
}
