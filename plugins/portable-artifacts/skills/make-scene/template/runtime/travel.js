// The travelling light of a tour beat: which tube it rides, how far along it is, and when it has arrived.
// Pure (no three, no DOM): the caller feeds it the animation clock and places the sphere from the frame.

export const TRAVEL_SECONDS = 1.8;

const smooth = (u) => u * u * (3 - 2 * u);
const clamp01 = (u) => Math.min(1, Math.max(0, u));

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
