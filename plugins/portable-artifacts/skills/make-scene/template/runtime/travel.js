// The travelling light of a tour beat: which tube it rides, how far along it is, and when it has arrived.
// Pure (no three, no DOM): the caller feeds it the animation clock and places the sphere from the frame.

export const TRAVEL_SECONDS = 1.8;

// The camera's flight to a beat's view. Time follows distance: a hop to a neighbouring view settles quickly, a long one
// takes longer, and none takes longer than the cap (a tour must not make the viewer wait on the camera).
export const FLY_MIN_MS = 450; // the floor: even a tiny move eases in and out over this long
export const FLY_MAX_MS = 1400; // the cap
export const FLY_MS_PER_SPAN = 650; // added per unit of span, up to the cap

const smooth = (u) => u * u * (3 - 2 * u);
const clamp01 = (u) => Math.min(1, Math.max(0, u));

/** The flight's progress at share k (0..1) of its time: cubic ease-in-out, at rest at both ends, mirrored, clamped. */
export function easeFlight(k) {
  const u = clamp01(k);
  return u < 0.5 ? 4 * u * u * u : 1 - ((-2 * u + 2) ** 3) / 2;
}

/**
 * How long a flight takes. `span` is how far the camera and its target move, in camera-to-target distances
 * (so it does not depend on the scene's size). NaN or a negative span reads as no move; Infinity as the cap.
 */
export function flightMsFor(span) {
  const s = span > 0 ? span : 0;
  return Math.min(FLY_MAX_MS, FLY_MIN_MS + s * FLY_MS_PER_SPAN);
}

/**
 * createTravel() -> { start(id, { reverse, instant }), tick(clock), finish(), frame(), active }
 *
 * A frame is { id, at, done }: `at` (0..1) is how far along the tube's own direction the light is, so a
 * reversed run goes 1 -> 0. start(null) clears the light. `instant` places it at its destination at once
 * (reduced motion). The first tick after start() fixes the run's zero, so the animation clock may be paused
 * between runs. `active` is true while a run still needs frames.
 */
export function createTravel() {
  let run = null; // { id, reverse, zero, u }

  const frame = () => (run === null ? null : { id: run.id, at: run.reverse ? 1 - smooth(run.u) : smooth(run.u), done: run.u >= 1 });

  return {
    start(id, { reverse = false, instant = false } = {}) {
      run = id === null || id === undefined ? null : { id, reverse, zero: null, u: instant ? 1 : 0 };
      return frame();
    },
    tick(clock) {
      if (run === null || run.u >= 1) return frame();
      if (run.zero === null) run.zero = clock;
      run.u = clamp01((clock - run.zero) / TRAVEL_SECONDS);
      return frame();
    },
    finish() {
      if (run !== null) run.u = 1;
      return frame();
    },
    frame,
    get active() {
      return run !== null && run.u < 1;
    },
  };
}
