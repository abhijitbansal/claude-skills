// Does an embedded diagram fit the page's column at its floor scale? The slot never draws a diagram below
// --dg-min-scale (template/diagram.css), so a wider one scrolls sideways inside its slot. That is by design, but a
// reader at desktop width then sees a cut-off drawing; this says so at validate time, so the spec can choose a
// top-down layout. Built-ins only: the numbers mirror template/diagram.css and base.css.

/** --dg-pad, the viewer's fit margin on both sides, in diagram units. */
export const DG_PAD = 32;
/** --dg-min-scale: the smallest the slot draws a diagram, so 14-unit labels stay about 10.5 px. */
export const DG_MIN_SCALE = 0.75;
/** --col: the desktop text column, 52rem at 16 px. */
export const COLUMN_PX = 832;

/** The width in px the slot needs to show a diagram `width` units wide whole, at the floor scale. */
export const floorWidthPx = (width) => Math.round((width + DG_PAD) * DG_MIN_SCALE);

/** True when that width is more than the desktop column holds. */
export const exceedsColumn = (width) => Number.isFinite(width) && floorWidthPx(width) > COLUMN_PX;

/** A check warning (never an error) for a diagram too wide for the column at its floor scale, else []. `path` is the section's diagram path. */
export function wideDiagramWarnings(width, path) {
  if (!exceedsColumn(width)) return [];
  return [{
    path,
    message: `the diagram needs ${floorWidthPx(width)} px at its smallest readable size, more than the ${COLUMN_PX} px column, so on a desktop page it scrolls sideways inside its frame; set direction "down" (a top-down layout), use fewer nodes in a row, or split it into two diagrams`,
    warning: true,
  }];
}
