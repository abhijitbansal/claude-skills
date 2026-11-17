// The kinds' camera (split out of shared.mjs): the look's resting drift, the push onto a box (a deliberate close-up),
// and the establishing view a region event waits for. Pure and DOM-free.
import { resolveCut } from '../cuts/resolve.mjs';
import { FIELD_BLEED, compositionRect, cutsToCloseUp, regionOf } from './shared.mjs';

// the region fills `share` of the width (look review 2: at 0.58 the payoff was too small on the phone), at most `tall`
// of the height when a caption card needs room under or over it, else `full` of it
const PUSH = Object.freeze({ share: 0.72, tall: 0.36, full: 0.7, min: 1.2, max: 3.2, dur: 0.9 });
const PUSH_OVERSHOOT = 1.2; // a spring ease can carry the push this far past its target; the pan limit allows for it
const HALF = 2;

const drifts = (look) => look.camera.style === 'desk' && look.camera.drift > 0;

/** How far the look's resting camera drift moves a depth-0 node either way across, in px (0 where nothing drifts). */
export const driftReach = (look, unit) => (drifts(look) ? (look.camera.drift * unit) / HALF : 0);

/** The look's resting camera as layers of keys: desk drifts half a drift either way, alternating by shot. */
export function defaultCamera(look, timing, unit) {
  if (!drifts(look)) return [];
  const half = (look.camera.drift * unit) / HALF;
  const dir = timing.index % HALF === 0 ? 1 : -1;
  return [[{ t: 0, x: -half * dir }, { t: timing.duration, x: half * dir }]];
}

// The drift's camera x at shot time t (linear, as defaultCamera keys it).
function driftAt(look, timing, unit, t) {
  if (!drifts(look)) return 0;
  const half = (look.camera.drift * unit) / HALF;
  const dir = timing.index % HALF === 0 ? 1 : -1;
  return -half * dir + (HALF * half * dir * t) / timing.duration;
}

// The largest pan at full push that keeps the depth-1 field over the canvas. At push progress f (0 to the ease's
// overshoot F) the field pans f * pan / 2 and zooms 1 + (zoom - 1) f / 2 about the centre, and it reaches
// FIELD_BLEED past each edge: |pan| <= (2 bleed - drift) / F + (zoom - 1)(centre + bleed) - drift keeps it covered.
function panLimit(size, zoom, drift) {
  const centre = size / HALF;
  const bleed = FIELD_BLEED * size;
  return (HALF * bleed - drift) / PUSH_OVERSHOOT + (zoom - 1) * (centre + bleed) - drift;
}

const clampAbs = (v, limit) => Math.min(limit, Math.max(-limit, v));
const clampTo = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * A camera layer for a deliberate close-up on `box` (canvas pixels): the zoom that makes the box PUSH.share of the
 * composition width and at most PUSH.tall of its height (clamped to PUSH.min..PUSH.max), its top kept under `below`, panned so the box centre sits on the composition centre (as far
 * as the field allows), easing with the look's enter ease over PUSH.dur and landing on `at`. A node at depth 0 moves
 * to c + (x - c) zoom - pan, so pan = c + (boxCentre - c) zoom - target; the drift's own pan at the landing time is
 * taken off, since the camera adds the layers.
 */
export function pushLayer(ctx, box, at, { below = -Infinity, caption = false } = {}) {
  const { look, canvas, unit, timing } = ctx;
  const rect = compositionRect(ctx);
  const zoom = clampTo(Math.min((PUSH.share * rect.w) / box[2], ((caption ? PUSH.tall : PUSH.full) * rect.h) / box[3]), PUSH.min, PUSH.max);
  const drift = driftReach(look, unit);
  const pan = (centre, boxCentre, target) => centre + (boxCentre - centre) * zoom - target;
  const x = pan(canvas.w / HALF, box[0] + box[2] / HALF, rect.cx) - driftAt(look, timing, unit, at);
  // the pushed box's top stays under `below` (a slug card's bottom), moving its centre down from the composition's
  const y = pan(canvas.h / HALF, box[1] + box[3] / HALF, Math.max(rect.cy, below + (box[3] * zoom) / HALF));
  return [
    { t: Math.max(0, at - PUSH.dur), x: 0, y: 0, zoom: 1 },
    { t: at, x: clampAbs(x, panLimit(canvas.w, zoom, drift)), y: clampAbs(y, panLimit(canvas.h, zoom, drift)), zoom, ease: look.moves.enter.ease },
  ];
}

// ---- an establishing view ----

const ESTABLISH = 0.6; // seconds of the whole picture, after the incoming cut has ended, before a region is singled out

/** When the incoming cut of a shot ends, in shot seconds: 0 for the first shot and for a hard cut. */
export function cutEnd(shot, timing) {
  if (timing.index === 0) return 0;
  return resolveCut(shot.cut, { shotDuration: timing.duration }).dur;
}

/**
 * The earliest shot second a region event may land on, so the whole picture is seen first: the push (or, in a locked
 * look, the close-up switch) may not start before the incoming cut has ended plus ESTABLISH. A push starts PUSH.dur
 * before it lands; a close-up switch starts where it lands.
 */
export function regionFloor(shot, { look, timing }) {
  const quiet = cutEnd(shot, timing) + ESTABLISH;
  return cutsToCloseUp(look) ? quiet : quiet + PUSH.dur;
}

/** `shot` with every event aimed at a region moved to no earlier than regionFloor (its anchor replaced by seconds). */
export function withEstablishingView(shot, ctx) {
  if (!Array.isArray(shot.on)) return shot;
  const floor = regionFloor(shot, ctx);
  const on = shot.on.map((item) => (regionOf(item.target) !== null && ctx.at(item.at) < floor ? { ...item, at: Math.min(floor, ctx.timing.duration) } : item));
  return { ...shot, on };
}
