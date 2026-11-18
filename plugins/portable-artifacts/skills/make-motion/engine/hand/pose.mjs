// Where the drawing hand's marker tip is at any moment (looks-four Task 2), a pure lookup over a shot's stroke plan
// (strokes.mjs), as template/sketch/hand.mjs handPose was in version 1 (its pose logic copied and reworked: no idle sway,
// so a resting hand is still and its frames are reused). On a stroke the tip is on the stroke's visible end; between
// strokes it holds, then travels in one eased move; with no stroke for more than look.hand.rest seconds it goes to the
// look's rest point (look.hand.restAt, shares of the canvas per format), clear of the writing. Pure and DOM-free.
import { pointAt } from './geometry.mjs';
import { handOutline } from './shape.mjs';

const HOLD = 0.15; // s the tip stays on a stroke's end before it leaves for the rest point
const TRAVEL_MIN = 0.12; // s: the shortest move
const TRAVEL_SPEED = 3600; // units a second the hand sweeps at, as strokes.mjs times the moves between strokes

const smooth = (p) => p * p * (3 - 2 * p);
const lerp = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];

/** The rest point in px for `canvas` ({ w, h }): look.hand.restAt.wide or .tall as shares of the canvas. */
export function restPoint(look, canvas) {
  const [fx, fy] = canvas.w >= canvas.h ? look.hand.restAt.wide : look.hand.restAt.tall;
  return [fx * canvas.w, fy * canvas.h];
}

// ---- the angle (m5, gate-marker-2 ruling 5: the hand is never cropped by the bottom edge) ----

const BISECT_STEPS = 14;
const BOTTOM_SLACK = 8; // units kept between the lowest point of the hand and the frame's bottom
const outlines = new WeakMap(); // look.hand -> Map(unit -> the hand's outline in px)

// How far below the tip the hand's outline reaches when turned `angle` degrees, in px for `unit`.
function reachBelow(look, unit, angle) {
  if (!outlines.has(look.hand)) outlines.set(look.hand, new Map());
  const known = outlines.get(look.hand);
  if (!known.has(unit)) known.set(unit, handOutline(look, unit));
  const r = (angle * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return Math.max(...known.get(unit).map(([x, y]) => x * s + y * c));
}

/**
 * The angle the hand is turned at with its tip at height `y`: look.hand.angle, turned toward look.hand.minAngle just far enough
 * that no point of the hand is below the frame (the hand lies flatter at the bottom of the board). look.hand.angle when the look
 * names no minAngle. Continuous in y.
 */
export function angleAt(look, y, canvas, unit) {
  const top = look.hand.angle ?? 0, floor = look.hand.minAngle;
  if (floor === undefined || floor >= top) return top;
  const room = canvas.h - y - BOTTOM_SLACK * unit;
  if (room >= reachBelow(look, unit, top)) return top;
  if (room <= reachBelow(look, unit, floor)) return floor;
  // the reach grows with the angle: the flattest angle that still has the room, found by halving
  let [lo, hi] = [floor, top];
  for (let i = 0; i < BISECT_STEPS; i++) {
    const mid = (lo + hi) / 2;
    if (reachBelow(look, unit, mid) <= room) lo = mid; else hi = mid;
  }
  return lo;
}

export const REST_SPEED = 6000; // units a second the hand sweeps to or from its rest point (strokes.mjs times the sweep in the same)

/** Whether the hand starts the shot at its rest point on `canvas`: look.hand.restAtStart is true, or { wide, tall } flags. */
export function startsAtRest(look, canvas) {
  const flag = look.hand.restAtStart;
  return flag === true || (typeof flag === 'object' && flag !== null && flag[canvas.w >= canvas.h ? 'wide' : 'tall'] === true);
}

// the move from `a` to `b`: a sweep to or from the rest point is faster than a move between two strokes
const travelTime = (a, b, unit, rest = null) => {
  const toRest = rest !== null && (a === rest || b === rest);
  return Math.max(TRAVEL_MIN, Math.hypot(a[0] - b[0], a[1] - b[1]) / ((toRest ? REST_SPEED : TRAVEL_SPEED) * unit));
};

// The tip between `from` (left at `t0`) and `to` (needed by `t1`): it holds at `from` for HOLD at most, moves, and waits
// at `to`, over what is not drawn yet rather than over what is finished.
function between(from, to, t0, t1, t, unit, rest = null) {
  const dur = Math.min(t1 - t0, travelTime(from, to, unit, rest));
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
  const out = prev ? t0 + HOLD + travelTime(from, rest, unit, rest) : -Infinity;
  if (prev && t < out) return { ...between(from, rest, t0, out, t, unit, rest), resting: false };
  const back = next ? t1 - travelTime(rest, to, unit, rest) : Infinity;
  if (next && t > back) return { ...between(rest, to, back, t1, t, unit, rest), resting: false };
  return { at: rest, moving: false, resting: true };
}

/**
 * The hand at `t` (shot seconds) by `plan` (strokePlan's): { x, y, angle, down, resting } in canvas px; `down`: the tip
 * is on a stroke; `resting`: at the rest point. `opts`: { canvas, unit }. Pure: the same plan and t give the same pose.
 */
export function handPose(plan, t, look, { canvas, unit = 1, rest: chosen = null }) {
  const drawing = plan.find((s) => s.end > s.start && t >= s.start && t <= s.end);
  if (drawing) {
    const [x, y] = pointAt(drawing, (t - drawing.start) / (drawing.end - drawing.start));
    return { x, y, angle: angleAt(look, y, canvas, unit), down: true, resting: false };
  }
  // look.hand.restAtStart: the first element is on the board when the shot opens, but the hand is not on it: it starts at
  // its rest point, clear of the finished writing (a tall frame's first line is its last, and the tip would sit on it)
  const prev = plan.findLast((s) => s.end <= t && !(s.end <= 0 && startsAtRest(look, canvas)));
  const next = plan.find((s) => s.start > t);
  const { at, resting } = inGap(prev, next, t, look, chosen ?? restPoint(look, canvas), unit);
  return { x: at[0], y: at[1], angle: angleAt(look, at[1], canvas, unit), down: false, resting };
}
