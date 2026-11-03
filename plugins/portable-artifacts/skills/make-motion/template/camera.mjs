// A scene camera, browser-safe and pure. A scene's `camera` is { keyframes?: [{ t, zoom?, x?, y?, rotate?, ease? }],
// shake?: { amount, hz?, seed? } }. The renderer wraps the scene's elements in a `.camera` node and sets the transform
// cameraTransform returns on every seek; the timeline tweens the keyframed pose (template/timeline.mjs). The shake is not
// tweened: it is a pure function of the scene time and the seed.

import { mulberry32 } from './seeded.mjs';

export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 3;
export const MAX_SHAKE_AMOUNT = 100; // px
export const MAX_SHAKE_HZ = 60;
export const SHAKE_HZ = 8;
export const SHAKE_SEED = 1;
// The y noise of seed s is the generator of seed s + AXIS_SEED_STRIDE, so seeds up to the stride minus 1 never share a
// stream (the schema bounds `seed` to 0..MAX_SHAKE_SEED).
export const MAX_SHAKE_SEED = 7918;
export const CAMERA_PROPS = Object.freeze(['zoom', 'x', 'y', 'rotate']);
export const CAMERA_REST = Object.freeze({ zoom: 1, x: 0, y: 0, rotate: 0 });

const AXIS_SEED_STRIDE = 7919; // the y noise is the x noise's generator seeded this far along
const PRECISION = 4;
const fixed = (v) => String(+v.toFixed(PRECISION)); // no float noise, no "-0"

// The noise of one axis as a stream of values in [-1, 1) that grows as far as it is read, so the value at index i is the
// same whichever order the indices are asked in.
const streams = new Map();
function noise(key, i) {
  let stream = streams.get(key);
  if (!stream) {
    stream = { next: mulberry32(key), values: [] };
    streams.set(key, stream);
  }
  while (stream.values.length <= i) stream.values.push(stream.next() * 2 - 1);
  return stream.values[i];
}

/**
 * The shake's offset in px at scene time `t`: { sx, sy }. `amount` x a straight blend between the noise at step i = floor(t x
 * hz) and at i + 1, per axis, the noise of an axis being the seeded stream in [-1, 1) (x: seed, y: seed + 7919), so the same seed always
 * shakes the same way. No shake gives { sx: 0, sy: 0 }.
 */
export function shakeOffset(shake, t) {
  if (!shake) return { sx: 0, sy: 0 };
  const { amount, hz = SHAKE_HZ, seed = SHAKE_SEED } = shake;
  const at = Math.max(0, t) * hz;
  const i = Math.floor(at);
  const frac = at - i;
  const axis = (n) => {
    const key = seed + n * AXIS_SEED_STRIDE;
    return amount * (noise(key, i) * (1 - frac) + noise(key, i + 1) * frac);
  };
  return { sx: axis(0) + 0, sy: axis(1) + 0 }; // + 0: an amount of 0 gives 0, not -0
}

/** The CSS transform of the camera node: the shake, then the zoom about the canvas centre, then the pan, then the roll. */
export function cameraTransform(pose, shake, t) {
  const { zoom, x, y, rotate } = { ...CAMERA_REST, ...pose };
  const { sx, sy } = shakeOffset(shake, t);
  return `translate(${fixed(sx)}px, ${fixed(sy)}px) scale(${fixed(zoom)}) translate(${fixed(-x)}px, ${fixed(-y)}px) rotate(${fixed(rotate)}deg)`;
}

/**
 * Scene-second spans [from, to] in which a camera property of `props` (default all four; check.mjs asks in element terms,
 * so `scale` reads as `zoom` and `opacity` is not a camera property) goes from one value to another between two
 * consecutive keyframes that set it. Two equal values are a hold, not a move, whatever the ease.
 */
export function cameraTweens(camera, props = CAMERA_PROPS) {
  return props.flatMap((asked) => {
    const prop = asked === 'scale' ? 'zoom' : asked;
    if (!CAMERA_PROPS.includes(prop)) return [];
    const set = (camera?.keyframes ?? []).filter((kf) => kf[prop] !== undefined);
    return set.slice(1).flatMap((kf, i) => (kf[prop] !== set[i][prop] ? [[set[i].t, kf.t]] : []));
  });
}

/** Scene-second spans [from, to] over which the camera changes the frame: each move, and the whole scene for a shake. */
export function cameraSpans(camera, sceneDuration) {
  if (!camera) return [];
  const spans = cameraTweens(camera);
  if (camera.shake && camera.shake.amount > 0) spans.push([0, sceneDuration]);
  return spans;
}
