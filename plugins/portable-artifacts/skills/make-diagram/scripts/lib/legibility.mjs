// How large a diagram's text draws when the page fits it on one screen. Built-ins only (no imports), so check.mjs
// can use the same floor in the browser rule that validate.mjs uses as an estimate.
//
// The page fits the drawing into the stage at first paint (template/camera.js: FIT_MARGIN around it, never past
// MAX_FIT_SCALE). validate estimates that from the layout's size against a 1440 px wide stage; check.mjs measures it.
export const STAGE_WIDTH = 1440;
export const STAGE_HEIGHT = 780; // the 900 px viewport less the toolbar and the caption band
export const FIT_MARGIN = 16; // camera.js FIT_MARGIN
export const MAX_FIT_SCALE = 1.25; // camera.js MAX_FIT_SCALE
export const LABEL_PX = 14; // sizes.mjs LABEL_SIZE: a node label's size in diagram units
export const MIN_LABEL_PX = 8; // below this a label is hard to read at fit (a 14 px label at 57% zoom)
export const MIN_STAGE_WIDTH = 1000; // check.mjs applies the rule at the desktop viewport only: a phone fits everything small

/** The scale the page fits a `width` x `height` drawing at in a `stage` (default: the 1440 px desktop stage). */
export function estimateFitScale(width, height, stage = { width: STAGE_WIDTH, height: STAGE_HEIGHT }) {
  const s = Math.min(stage.width / (width + 2 * FIT_MARGIN), stage.height / (height + 2 * FIT_MARGIN));
  return s > 0 && Number.isFinite(s) ? Math.min(s, MAX_FIT_SCALE) : 1;
}

/** How large a node label draws, in px, at fit scale `scale`. */
export const labelPx = (scale) => LABEL_PX * scale;

/** Whether labels drawn at fit scale `scale` are still readable. */
export const isLegible = (scale) => labelPx(scale) >= MIN_LABEL_PX;

/** The same sentence for the validate warning and the check problem: what fits, what it draws at, what to do. */
export function legibilityMessage(scale, where = 'on a 1440 px screen', { direction = true } = {}) {
  const fix = direction ? 'split it into several diagrams, or use fewer nodes in a row (direction down for a long chain)' : 'split it into several diagrams, or use fewer participants and messages';
  return `fits ${where} at ${Math.round(scale * 100)}% zoom, so labels draw about ${labelPx(scale).toFixed(1)} px (the floor is ${MIN_LABEL_PX} px): ${fix}`;
}
