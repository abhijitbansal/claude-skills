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

/** The smallest zoom a push takes (PUSH.min). */
export const PUSH_MIN = PUSH.min;

/** The drift's camera x at shot time t (linear, as defaultCamera keys it). */
export function driftAt(look, timing, unit, t) {
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

/** The zoom a push on `box` would take with no cap: PUSH.share of the composition width, at most PUSH.full (or, over
 *  captions, PUSH.tall) of its height, clamped to PUSH.min..PUSH.max. */
export function pushZoom(ctx, box, { caption = false } = {}) {
  const rect = compositionRect(ctx);
  return clampTo(Math.min((PUSH.share * rect.w) / box[2], ((caption ? PUSH.tall : PUSH.full) * rect.h) / box[3]), PUSH.min, PUSH.max);
}

// A push that keeps a whole box in the frame (`keep`, keynote's screen card: look.kinds.screen.pushFrame): the box stays
// this far inside each edge, room for the resting drift to carry on after the landing (it moves a full drift across the
// shot) and the look's keyline.
const keepPad = (look, unit) => HALF * driftReach(look, unit) + (look.keyline ?? 0) * unit;

// The largest zoom at which the box still fits the frame inside the pad.
const keepZoom = ([, , w, h], canvas, pad) => Math.min((canvas.w - HALF * pad) / w, (canvas.h - HALF * pad) / h);

// A pan along `axis` (0 across, 1 down) moved, as little as it takes, so the box zoomed lies inside the pad. A depth-0
// point p lands at c + (p - c) zoom - pan, so the box's near edge wants pan <= c + (near - c) zoom - pad and its far edge
// pan >= c + (far - c) zoom - size + pad.
function keepPan(pan, keep, canvas, zoom, pad, axis) {
  const size = axis === 0 ? canvas.w : canvas.h;
  const c = size / HALF;
  const near = keep[axis], far = keep[axis] + keep[axis + HALF];
  const most = c + (near - c) * zoom - pad, least = c + (far - c) * zoom - size + pad;
  return least > most ? (least + most) / HALF : clampTo(pan, least, most);
}

/**
 * A camera layer for a deliberate close-up on `box` (canvas pixels): the zoom that makes the box PUSH.share of the
 * composition width and at most PUSH.tall of its height (clamped to PUSH.min..PUSH.max), its top kept under `below`, panned so the box centre sits on the composition centre (as far
 * as the field allows), easing with the look's enter ease over PUSH.dur and landing on `at`. A node at depth 0 moves
 * to c + (x - c) zoom - pan, so pan = c + (boxCentre - c) zoom - target; the drift's own pan at the landing time is
 * taken off, since the camera adds the layers. `max` caps the zoom (a picture's own resolution: a push past it is a soft
 * upscale), never under 1. `keep` (a box, or null) caps the zoom and moves the pan so that whole box stays in the frame
 * (keepPad inside each edge): nothing at its border is sliced by the frame's edge.
 */
// `pad` (px, or undefined for keepPad) and `centre` (true: the kept box, not `box`, lands on the frame's centre; keynote's
// pushPad, gate-keynote-1 ruling 2: panned toward a region at the card's right, the card hugged the left edge and left
// the right 29 percent of the frame empty) refine `keep`.
export function pushLayer(ctx, box, at, { below = -Infinity, caption = false, max = Infinity, keep = null, pad: keepAt, centre = false } = {}) {
  const { look, canvas, unit, timing } = ctx;
  const rect = compositionRect(ctx);
  const pad = keep === null ? 0 : Math.max(keepAt ?? 0, keepPad(look, unit));
  const zoom = Math.min(pushZoom(ctx, box, { caption }), Math.max(1, max), keep === null ? Infinity : keepZoom(keep, canvas, pad));
  const drift = driftReach(look, unit);
  const pan = (centre, boxCentre, target) => centre + (boxCentre - centre) * zoom - target;
  const kept = (value, axis) => (keep === null ? value : keepPan(value, keep, canvas, zoom, pad, axis));
  const aim = keep !== null && centre ? keep : box;
  const x = kept(pan(canvas.w / HALF, aim[0] + aim[2] / HALF, centre ? canvas.w / HALF : rect.cx), 0) - driftAt(look, timing, unit, at);
  // the pushed box's top stays under `below` (a slug card's bottom), moving its centre down from the composition's
  const y = kept(pan(canvas.h / HALF, aim[1] + aim[3] / HALF, centre ? canvas.h / HALF : Math.max(rect.cy, below + (aim[3] * zoom) / HALF)), 1);
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
