// The scene canvas as a decoded PNG, for check.mjs and the browser tests (one definition, so both measure the same thing).
// A Playwright element screenshot, never an in-page readback: the canvas has no preserveDrawingBuffer, so readPixels is black.
// The toolbar, legend, labels and tooltip are DOM laid over the canvas and a screenshot captures them too, so they are
// hidden (visibility only: no layout change, no resize wake-up) for the shot. What is left is the canvas alone.
import { decodePng } from './png.mjs';

export const GRID = 32; // samples per side
// Distinct colours on the grid below which the canvas counts as blank. Measured with the chrome hidden: a blank canvas
// sees 1; valid sparse pages (one-row city, all-zero galaxy, 3-system galaxy, one-row terrain) see 4 to 10 at 1440 px.
// 3 leaves margin on both sides.
export const MIN_COLOURS = 3;

const CANVAS_ONLY = '[data-pa-scene] > :not(.sc-stage), .sc-stage > :not(canvas) { visibility: hidden !important }';

/** { width, height, pixel(x, y) } of the page's first canvas with the chrome over it hidden. */
export async function canvasPng(page, { timeout } = {}) {
  const style = await page.addStyleTag({ content: CANVAS_ONLY });
  try {
    return decodePng(await page.locator('canvas').first().screenshot({ timeout }));
  } finally {
    await style.evaluate((el) => el.remove()).catch(() => {});
  }
}
