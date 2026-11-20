// The pacing rule: a picture that sits still longer than the mode's `maxStillSeconds` is a creative finding. The
// caller reports, for every frame, whether it equals the one before it (the 2D state key is the same); this finds the
// runs. The film's final shot may rest, so a stretch that starts in it is not reported. Pure and DOM-free.
const EPSILON = 1e-6;

/** The timeline entry of the shot frame `frame` belongs to: the last shot that has started by then. */
export const shotAtFrame = (timeline, frame) => timeline.shots.findLast((s) => Math.round(s.start * timeline.fps) <= frame);

// Runs of equal frames as { first, last } frame indices: a run starts at the frame before the first `held` one.
function runsOf(held) {
  const runs = [];
  let open = null;
  held.forEach((same, frame) => {
    if (same && open === null) open = { first: frame - 1, last: frame };
    else if (same) open.last = frame;
    else if (open !== null) { runs.push(open); open = null; }
  });
  if (open !== null) runs.push(open);
  return runs;
}

/**
 * @param {{ held: boolean[], timeline: { fps: number, shots: { id: string, start: number }[] }, maxStillSeconds: number }} opts
 *   held[i]: frame i has the same 2D state key as frame i - 1 (held[0] is false)
 * @returns {{ shot: string, startFrame: number, start: number, seconds: number }[]} one per stretch over the limit
 */
export function stillStretches({ held, timeline, maxStillSeconds }) {
  const { fps, shots } = timeline;
  const last = shots.at(-1);
  const lastStart = Math.round(last.start * fps);
  return runsOf(held).flatMap(({ first, last: end }) => {
    // The final shot may rest, so a stretch that runs on into it is counted only up to where it starts.
    const frames = Math.min(end, lastStart - 1) - first + 1;
    const shot = shotAtFrame(timeline, first);
    if (frames <= maxStillSeconds * fps + EPSILON || shot === undefined || shot === last) return [];
    return [{ shot: shot.id, startFrame: first, start: first / fps, seconds: frames / fps }];
  });
}
