// Contact-sheet helpers: which moments of a scene to capture, and how to tile the frames into one PNG.
// Tiling runs in a second Chromium page (a grid of data-URL <img>), never ffmpeg.

const FIRST_LOOK = 0.1; // seconds into the scene: the first thing a viewer sees
const KEYFRAME_LAG = 0.1; // seconds after a keyframe lands
const CONTACT_POINT = 0.85;
const MIN_GAP = 0.05;
const DEFAULT_FPS = 30;
const EPSILON = 1e-9;

export const PHONE_WIDTH = 360;
const MAX_TILE_WIDTH = 640;
const MAX_COLUMNS = 3;
const PAD = 16;
const GAP = 16;
const CAPTION_HEIGHT = 24;
const SHEET_BACKGROUND = '#0b0d12';
const PNG_WIDTH_OFFSET = 16;
const PNG_HEIGHT_OFFSET = 20;

// Scene-local seconds, sorted, at least 0.05 s apart (the later of two close times wins, so the last frame
// always survives). `fps` caps every time at the scene's last frame, duration - 1/fps.
export function sheetTimes(scene, fps = DEFAULT_FPS) {
  const last = Math.max(0, scene.duration - 1 / fps);
  const keyframes = (scene.elements ?? []).flatMap((el) => (el.keyframes ?? []).map((kf) => kf.t + KEYFRAME_LAG));
  const raw = [FIRST_LOOK, ...keyframes, scene.duration * CONTACT_POINT, last]
    .map((t) => Math.min(Math.max(0, t), last))
    .sort((a, b) => a - b);
  const kept = [];
  for (const t of raw) {
    if (kept.length && t - kept[kept.length - 1] < MIN_GAP - EPSILON) kept[kept.length - 1] = t;
    else kept.push(t);
  }
  return kept;
}

// Positions of every tile in the sheet. `tiles` are {w, h, width?}: natural pixel size and an optional display width.
// Tiles are at most 640 px wide (never upscaled), three to a row, row-major; the sheet size is exact.
export function sheetLayout(tiles) {
  const cellWidth = Math.min(tiles[0].w, MAX_TILE_WIDTH);
  const cols = Math.min(tiles.length, MAX_COLUMNS);
  const rows = Math.ceil(tiles.length / cols);
  const sized = tiles.map((tile) => {
    const w = tile.width ?? cellWidth;
    return { w, h: Math.round((tile.h * w) / tile.w) };
  });
  const rowHeights = Array.from({ length: rows }, (_, r) => Math.max(...sized.slice(r * cols, (r + 1) * cols).map((b) => b.h)) + CAPTION_HEIGHT);
  const rowTops = rowHeights.map((_, r) => PAD + rowHeights.slice(0, r).reduce((a, h) => a + h + GAP, 0));
  const boxes = sized.map((box, i) => ({ ...box, x: PAD + (i % cols) * (cellWidth + GAP), y: rowTops[Math.floor(i / cols)] }));
  return {
    cols, rows, boxes,
    width: 2 * PAD + cols * cellWidth + (cols - 1) * GAP,
    height: 2 * PAD + rowHeights.reduce((a, h) => a + h, 0) + (rows - 1) * GAP,
  };
}

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function sheetHtml(tiles, lay) {
  const cells = tiles.map((tile, i) => {
    const b = lay.boxes[i];
    return `<figure style="left:${b.x}px;top:${b.y}px;width:${b.w}px">`
      + `<img alt="${escapeHtml(tile.label)}" src="data:image/png;base64,${tile.png.toString('base64')}" width="${b.w}" height="${b.h}">`
      + `<figcaption>${escapeHtml(tile.label)}</figcaption></figure>`;
  }).join('');
  return `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;background:${SHEET_BACKGROUND}}
figure{position:absolute;margin:0}
img{display:block}
figcaption{height:${CAPTION_HEIGHT}px;line-height:${CAPTION_HEIGHT}px;font:12px/${CAPTION_HEIGHT}px ui-monospace,Menlo,monospace;color:#9aa3b5;white-space:nowrap;overflow:hidden}
</style>${cells}`;
}

// tiles: [{png: Buffer, label: string, width?: number}] -> one PNG. `width` shows that tile at that many CSS pixels.
export async function tileSheet(browser, tiles) {
  if (!tiles.length) throw new Error('tileSheet needs at least one tile');
  const sizes = tiles.map((t) => ({ w: t.png.readUInt32BE(PNG_WIDTH_OFFSET), h: t.png.readUInt32BE(PNG_HEIGHT_OFFSET), width: t.width }));
  const lay = sheetLayout(sizes);
  const page = await browser.newPage({ viewport: { width: lay.width, height: lay.height }, deviceScaleFactor: 1 });
  try {
    await page.setContent(sheetHtml(tiles, lay));
    await page.evaluate(() => Promise.all([...document.images].map((img) => img.decode())));
    return await page.screenshot({ type: 'png' });
  } finally { await page.close(); }
}
