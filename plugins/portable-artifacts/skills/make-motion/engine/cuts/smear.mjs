// The sample plan of a cut's motion blur. A smeared cut (slide, cover, punch with `smear`) is drawn as the true mean of
// pictures of its moving nodes at progress values spread over the shutter, SMEAR_SHUTTER of one frame centred on the
// frame's own progress. The samples sit at the middles of equal slices of the shutter, as many as keep neighbouring
// copies at most SMEAR_GAP_PX apart, between SMEAR_MIN_SAMPLES and SMEAR_MAX_SAMPLES. When the cap binds, the page
// box-filters the mean along the motion over one slice (engine/page/accumulate.mjs), which turns the copies into one
// continuous streak: the slices tile the shutter, so the streak is exactly as long as the travel. Pure and DOM-free.

/** The share of one frame the shutter is open for: half a frame, as film's 180 degree shutter. */
export const SMEAR_SHUTTER = 0.5;
/** The widest gap, in pixels, between neighbouring copies that the mean is left to show without the box filter. */
export const SMEAR_GAP_PX = 1;
/** The fewest samples a smeared frame takes. */
export const SMEAR_MIN_SAMPLES = 2;
/** The most samples a smeared frame takes; past it the box filter fills the gaps. */
export const SMEAR_MAX_SAMPLES = 32;

/** The axes a look may smear along (cutStyle.<cut>.smearAxes): x across the frame, y down it. */
export const SMEAR_AXES = Object.freeze(['x', 'y']);

const HALF = 2;
const COUNT_EPSILON = 1e-9; // keeps 10.000000000000009 px of travel at 10 samples
const clamp01 = (v) => Math.min(1, Math.max(0, v));

/**
 * Does a cut moving along `vector` (its parts' unit vector; null for a zoom) smear in a look whose cutStyle names
 * `axes` for it? A look that names none smears along both; a zoom moves along no axis and always smears. Pop names x
 * alone: on its condensed type the blur of a vertical move read as striped bars (t5 P2/P3, lead ruling f4-2), so a
 * vertical move draws its plain frame.
 * @param {number[] | null} vector
 * @param {string[] | undefined} axes
 */
export function smearsAlong(vector, axes) {
  if (axes === undefined || vector === null) return true;
  return axes.includes(Math.abs(vector[0]) >= Math.abs(vector[1]) ? 'x' : 'y');
}

/**
 * @param {{ p: number, frame: number, travel: (q0: number, q1: number) => number, shutter?: number }} options the frame's
 *   progress, how far progress moves in one frame, the largest distance in pixels a moving point covers between two
 *   progress values, and the share of a frame the shutter is open (the look's cutMotion.smearShutter; SMEAR_SHUTTER)
 * @returns {{ samples: number[], gapPx: number }} the progress of each sample (inside 0..1, in order) and the distance
 *   between neighbouring copies in pixels: the width of the box filter the page applies when it is over SMEAR_GAP_PX
 */
export function smearPlan({ p, frame, travel, shutter = SMEAR_SHUTTER }) {
  if (!Number.isFinite(p) || !(frame > 0)) throw new Error(`smearPlan: p must be a number and frame > 0, got p ${p}, frame ${frame}`);
  const q0 = clamp01(p - (frame * shutter) / HALF), q1 = clamp01(p + (frame * shutter) / HALF);
  const span = Math.max(0, travel(q0, q1));
  const count = Math.min(SMEAR_MAX_SAMPLES, Math.max(SMEAR_MIN_SAMPLES, Math.ceil(span / SMEAR_GAP_PX - COUNT_EPSILON)));
  const samples = Array.from({ length: count }, (_, k) => q0 + ((q1 - q0) * (k + 1 / HALF)) / count);
  return Object.freeze({ samples: Object.freeze(samples), gapPx: span / count });
}
