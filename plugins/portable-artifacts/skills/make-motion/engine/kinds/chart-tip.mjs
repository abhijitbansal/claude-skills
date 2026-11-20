// Where a drawn line's tip is (gate-ledger-1 ruling 3, ledger): a line draws on by its length (the `draw` track), so
// its tip's x does not move linearly with the draw. An area fill revealed by x on the same track trailed the tip; these
// helpers turn the line's draw track into the fill's reveal track and into the time the tip reaches each point, so
// a fill edge and a point's value label land exactly with the line. Pure and DOM-free.
import { track, sample } from '../time/track.mjs';

const TIP_SAMPLES = 60; // samples of the draw track over its run: 1/60 of a short draw is under a frame
const HALF = 2;

// The x of the point `share` (0..1) of the way along `points` by length.
function xAlong(points, share) {
  const segs = points.slice(1).map((q, k) => Math.hypot(q[0] - points[k][0], q[1] - points[k][1]));
  let left = Math.min(1, Math.max(0, share)) * segs.reduce((a, b) => a + b, 0);
  for (let k = 0; k < segs.length; k++) {
    if (left <= segs[k] && segs[k] > 0) return points[k][0] + (points[k + 1][0] - points[k][0]) * (left / segs[k]);
    left -= segs[k];
  }
  return points.at(-1)[0];
}

// [t, tip x] pairs over the draw track's run, `end` the time it has drawn whole.
function tipSamples(points, draw, end) {
  return Array.from({ length: TIP_SAMPLES + 1 }, (_, i) => {
    const t = (end * i) / TIP_SAMPLES;
    return [t, xAlong(points, sample(draw, t))];
  });
}

/** The reveal track (the left share of the fill's box, which spans the line's first to last x) that keeps an area
 *  fill's edge on the line's tip: linear between TIP_SAMPLES samples of the line's draw track, done by `end`. */
export function tipReveal(points, draw, end) {
  const x0 = points[0][0], span = points.at(-1)[0] - x0;
  if (span <= 0 || end <= 0) return draw;
  return track(tipSamples(points, draw, end).map(([t, x]) => ({ t, v: (x - x0) / span })));
}

/** The time the line's tip reaches each of `points` (the first at 0): the first sample at or past its x. */
export function tipTimes(points, draw, end) {
  const samples = tipSamples(points, draw, end);
  return points.map(([x], k) => (k === 0 ? 0 : (samples.find(([, tx]) => tx >= x - 1 / HALF) ?? samples.at(-1))[0]));
}
