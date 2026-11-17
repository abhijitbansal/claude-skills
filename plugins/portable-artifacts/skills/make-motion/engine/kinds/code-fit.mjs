// The reading arithmetic of the `code` kind (plan 2026-11-16-pa2-shot-kinds-b, Task 8). Code is set at one size in the
// look's mono (look.kinds.code.font), whose advance is `advance` em (0.6 for the bundled monos). A line holds
// floor(inner width / (advance x size)) characters and the panel floor(inner height / (lineHeight x size)) rows. The type
// size is the largest of the look's steps (`steps`) at which every shown line and row fits, so short code is set large.
// The panel fills the room the kind composes in (arrivals.mjs roomOf) less `pad` units each side. The review has no
// page, so it rebuilds that room from the platform insets the review passes. Pure and DOM-free.
import { compositionRect, sizeAt } from './shared.mjs';
import { editorialLeft } from './arrivals.mjs';

const HALF = 2;
const REFERENCE_WIDTH = 1080; // units: `platform` sides are measured on a 1080-wide canvas

/** The room the shot composes in without a page (the review), { x, y, w, h } in px: as roomOf does with captions off,
 *  `viralInsets` the platform safe zone the review passes (scripts/v2/review.mjs kindFindings). */
export function reviewRoom(look, canvas, viralInsets, mode) {
  const unit = Math.min(canvas.w, canvas.h) / REFERENCE_WIDTH;
  const margin = look.grid.margin * unit;
  // mode: the film's (a mode object), for a look that keeps the platform zone in a platform mode only (poster)
  const rect = compositionRect({ canvas, look, viralInsets, mode });
  if (rect.safe) return { x: rect.left, y: rect.top, w: rect.w, h: rect.h };
  const left = editorialLeft(look, canvas, unit); // as roomOf: the one left margin of an editorial wide frame
  return { x: left, y: margin, w: canvas.w - HALF * left, h: canvas.h - HALF * margin };
}

/** The panel's inner box in px: the room less `pad` units each side. */
export function innerOf(room, data, unit) {
  const pad = data.pad * unit;
  return { x: room.x + pad, y: room.y + pad, w: room.w - HALF * pad, h: room.h - HALF * pad };
}

/** How many characters a line holds, and how many rows the panel holds, at `size` px. */
export const holds = (inner, data, size) => ({
  chars: Math.floor(inner.w / (data.advance * size) + 1e-9),
  rows: Math.floor(inner.h / (data.lineHeight * size) + 1e-9),
});

/**
 * The size code is set at: as large as a line of `chars` characters and `rows` rows fit `inner`, in whole units, never
 * above the largest of data.steps nor under the smallest. (Between two steps rather than on one: twelve rows that miss a
 * step by a few units would otherwise drop to the smallest and leave the frame empty; seen on pop 16:9.)
 * -> { size, fits, holds } (fits false: not even the smallest step holds them; size is then the smallest step's).
 */
export function fitCode({ chars, rows }, { look, data, unit, inner }) {
  const sizes = data.steps.map((step) => sizeAt(look, step, unit));
  const least = Math.min(...sizes), most = Math.max(...sizes);
  const byChars = chars > 0 ? inner.w / (data.advance * chars) : Infinity;
  const byRows = rows > 0 ? inner.h / (data.lineHeight * rows) : Infinity;
  const whole = Math.floor(Math.min(most, byChars, byRows) / unit + 1e-9) * unit;
  const fits = whole >= least - 1e-9;
  const size = fits ? whole : least;
  return { size, fits, holds: holds(inner, data, size) };
}

/** The panel's height in px for `rows` rows at `size`: the rows and the pads. */
export const panelHeight = (rows, data, size, unit) => rows * data.lineHeight * size + HALF * data.pad * unit;
