// Where each tile of a review sheet goes: tiles of the film's shape in rows, a sheet at most 2400 px wide. Pure.
export const MAX_SHEET_WIDTH = 2400;
export const SHEET_GAP = 16;
const LANDSCAPE_COLUMNS = 3;
const PORTRAIT_COLUMNS = 4;
export const CUT_COLUMNS = 5;

/** How many main tiles fit across a sheet of a shot: 3 for a wide or square film, 4 for a tall one. */
export const shotColumns = (canvas) => (canvas.w >= canvas.h ? LANDSCAPE_COLUMNS : PORTRAIT_COLUMNS);

/**
 * @param {{ tiles: { frame: number, label: string, width?: number }[], canvas: { w: number, h: number }, columns: number }} opts
 *   a tile with a `width` (the phone tile) is that wide; the others share the sheet's width across `columns`.
 *   No tile is drawn larger than the frame itself.
 * @returns {{ width: number, height: number, placements: { x: number, y: number, w: number, h: number, frame: number, label: string }[] }}
 */
export function layoutSheet({ tiles, canvas, columns }) {
  const main = Math.min(canvas.w, Math.floor((MAX_SHEET_WIDTH - SHEET_GAP * (columns + 1)) / columns));
  const ratio = canvas.h / canvas.w;
  let x = SHEET_GAP, y = SHEET_GAP, rowHeight = 0, right = 0;
  const placements = tiles.map((tile) => {
    const w = Math.min(canvas.w, tile.width ?? main);
    const h = Math.round(w * ratio);
    if (x > SHEET_GAP && x + w + SHEET_GAP > MAX_SHEET_WIDTH) {
      x = SHEET_GAP;
      y += rowHeight + SHEET_GAP;
      rowHeight = 0;
    }
    const placed = { x, y, w, h, frame: tile.frame, label: tile.label };
    x += w + SHEET_GAP;
    rowHeight = Math.max(rowHeight, h);
    right = Math.max(right, placed.x + w);
    return placed;
  });
  return { width: right + SHEET_GAP, height: y + rowHeight + SHEET_GAP, placements };
}
