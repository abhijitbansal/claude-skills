// Where an editorial composition (flush left on grid columns: desk, cosmos) lays out. On the canvas: the look's grid
// and the canvas height, exactly as before. Where the composition rect is the platform safe zone (shared.mjs
// compositionRect safe: a look serving viral, on 9:16, cosmos), inside that rect, whose top and bottom are the look's
// band: twelve columns with the look's gutter across it, and shares of its height. Its own module because
// kinds/shared.mjs may not import the looks index (captions/index -> kinds/shared would load the looks before the
// caption styles they name). Pure and DOM-free.
import { gridSpan } from '../looks/index.mjs';
import { compositionRect, driftReach } from './shared.mjs';

// The safe rect's sides, each moved in by the look's resting camera drift (a drifting camera carries a block set flush
// on the safe edge past it).
function safeSides(ctx, rect) {
  const reach = driftReach(ctx.look, ctx.unit);
  return { left: rect.left + reach, right: rect.left + rect.w - reach };
}

/** Columns `from` to `to` (1 to 12) of an editorial composition as { x, w } in pixels. */
export function editorialSpan(ctx, from, to) {
  const rect = compositionRect(ctx);
  if (!rect.safe) return gridSpan(ctx.look, ctx.canvas, from, to);
  const { columns, gutter } = ctx.look.grid;
  const { left, right } = safeSides(ctx, rect);
  const g = gutter * ctx.unit, column = (right - left - (columns - 1) * g) / columns;
  return { x: left + (from - 1) * (column + g), w: (to - from + 1) * column + (to - from) * g };
}

/** The right edge in pixels of an editorial composition (the right margin edge, or the safe rect's right side). */
export function editorialRight(ctx) {
  const rect = compositionRect(ctx);
  if (!rect.safe) return ctx.canvas.w - ctx.look.grid.margin * ctx.unit;
  return safeSides(ctx, rect).right;
}

/**
 * The vertical room of an editorial composition: at(share) is the y that share of its height falls on, height(share)
 * that share of its height, top and bottom the highest and lowest y text may reach. On the canvas: share * canvas.h
 * and the margins (what the kinds always used); inside the safe rect: its band, so a block centred on `share` sits on
 * the band rather than hanging from the top of a tall frame.
 */
export function editorialBounds(ctx) {
  const rect = compositionRect(ctx);
  const { canvas, look, unit } = ctx;
  if (!rect.safe) {
    return { at: (share) => share * canvas.h, height: (share) => share * canvas.h, top: look.grid.margin * unit, bottom: canvas.h - look.grid.margin * unit, safe: false };
  }
  return { at: (share) => rect.top + share * rect.h, height: (share) => share * rect.h, top: rect.top, bottom: rect.top + rect.h, safe: true };
}
