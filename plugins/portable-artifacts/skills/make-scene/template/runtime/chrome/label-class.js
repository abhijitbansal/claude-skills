// Which shared type classes a scene label carries, and where its box sits. Pure (no DOM), so node:test can import it.
//   numbers (ticks, years, shares)  -> pa-num: tabular, lining figures, so stacked ticks line up; centred on their point
//   every other label               -> pa-caps: caps with the shared tracking, one style for every label set
const NUMERIC = /^[\p{Sc}+\-−]?\d[\d.,:/\-\s]*[%kKMBT]?$/u;

/** The clear space, in px, between a label's box and the edge of the frame. */
export const EDGE_MARGIN = 16;

export const MIN_PX = 11; // no label, caps or not, is set smaller than this: a phone must still read it
export const MAX_PX = 22;
/** Caps with tracking are about a third wider than lower case at the same size, so they are set this much smaller (never under MIN_PX), and labels do not start to hide each other. */
export const CAPS_SIZE_SHARE = 0.8;

/** The font size in px for a label whose size and depth ask for `raw` px: kept between MIN_PX and MAX_PX, caps a share smaller. */
export function fontPx(raw, caps) {
  const share = caps ? CAPS_SIZE_SHARE : 1;
  return Math.max(MIN_PX, Math.min(MAX_PX * share, raw * share));
}

export const isNumericLabel = (text) => NUMERIC.test(String(text).trim());

/** One class string per label, in order. */
export function labelClasses(labels) {
  return labels.map((l) => (isNumericLabel(l.text) ? 'sc-label pa-num' : 'sc-label pa-caps'));
}

/**
 * The centre x for a box `width` wide whose anchor is at `x`, kept `margin` clear of both edges of a frame `frame` wide.
 * An anchor outside the frame is left alone (a label sliding in from off screen), and so is a box too wide to fit.
 */
export function keepInside(x, width, frame, margin = EDGE_MARGIN) {
  if (!(frame > 0) || x < 0 || x > frame || width > frame - 2 * margin) return x;
  return Math.min(Math.max(x, margin + width / 2), frame - margin - width / 2);
}
