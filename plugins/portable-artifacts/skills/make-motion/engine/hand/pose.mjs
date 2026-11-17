// Where the drawing hand's marker tip is at any moment (looks-four Task 2), a pure lookup over a shot's stroke plan
// (strokes.mjs), as template/sketch/hand.mjs handPose was in version 1 (its pose logic copied and reworked: no idle sway,
// so a resting hand is still and its frames are reused). On a stroke the tip is on the stroke's visible end; between
// strokes it holds, then travels in one eased move; with no stroke for more than look.hand.rest seconds it goes to the
// look's rest point (look.hand.restAt, shares of the canvas per format), clear of the writing. Pure and DOM-free.
import { pointAt } from './geometry.mjs';

const HOLD = 0.15; // s the tip stays on a stroke's end before it leaves for the rest point
const TRAVEL_MIN = 0.12; // s: the shortest move
const TRAVEL_SPEED = 2400; // units a second at most, as strokes.mjs times the moves between strokes

const smooth = (p) => p * p * (3 - 2 * p);
const lerp = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];

/** The rest point in px for `canvas` ({ w, h }): look.hand.restAt.wide or .tall as shares of the canvas. */
export function restPoint(look, canvas) {
  const [fx, fy] = canvas.w >= canvas.h ? look.hand.restAt.wide : look.hand.restAt.tall;
  return [fx * canvas.w, fy * canvas.h];
}

const travelTime = (a, b, unit) => Math.max(TRAVEL_MIN, Math.hypot(a[0] - b[0], a[1] - b[1]) / (TRAVEL_SPEED * unit));

// The tip between `from` (left at `t0`) and `to` (needed by `t1`): it holds at `from` for HOLD at most, moves, and waits
// at `to`, over what is not drawn yet rather than over what is finished.
function between(from, to, t0, t1, t, unit) {
  const dur = Math.min(t1 - t0, travelTime(from, to, unit));
  const leave = t0 + Math.min(HOLD, t1 - t0 - dur);
  if (t <= leave) return { at: from, moving: false };
  if (t >= leave + dur) return { at: to, moving: false };
  return { at: lerp(from, to, smooth((t - leave) / dur)), moving: true };
}

// The tip in a gap with no stroke: from `prev` (ended at t0, or null) to `next` (starting at t1, or null).
function inGap(prev, next, t, look, rest, unit) {
  const from = prev ? prev.points.at(-1) : rest;
  const to = next ? next.points[0] : rest;
  const t0 = prev ? prev.end : -Infinity;
  const t1 = next ? next.start : Infinity;
  if (prev && next && t1 - t0 <= look.hand.rest) return { ...between(from, to, t0, t1, t, unit), resting: false };
  // a long gap: hold, go to rest, wait there, come back in time for the next stroke
  const out = prev ? t0 + HOLD + travelTime(from, rest, unit) : -Infinity;
  if (prev && t < out) return { ...between(from, rest, t0, out, t, unit), resting: false };
  const back = next ? t1 - travelTime(rest, to, unit) : Infinity;
  if (next && t > back) return { ...between(rest, to, back, t1, t, unit), resting: false };
  return { at: rest, moving: false, resting: true };
}

/**
 * The hand at `t` (shot seconds) by `plan` (strokePlan's): { x, y, angle, down, resting } in canvas px; `down`: the tip
 * is on a stroke; `resting`: at the rest point. `opts`: { canvas, unit }. Pure: the same plan and t give the same pose.
 */
export function handPose(plan, t, look, { canvas, unit = 1 }) {
  const angle = look.hand.angle ?? 0;
  const drawing = plan.find((s) => s.end > s.start && t >= s.start && t <= s.end);
  if (drawing) {
    const [x, y] = pointAt(drawing, (t - drawing.start) / (drawing.end - drawing.start));
    return { x, y, angle, down: true, resting: false };
  }
  const prev = plan.findLast((s) => s.end <= t);
  const next = plan.find((s) => s.start > t);
  const { at, resting } = inGap(prev, next, t, look, restPoint(look, canvas), unit);
  return { x: at[0], y: at[1], angle, down: false, resting };
}
