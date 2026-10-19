// Contact-sheet helpers: which moments of a scene to capture, and how to tile the frames into one PNG.
// Tiling runs in a second Chromium page (a grid of data-URL <img>), never ffmpeg.

const FIRST_LOOK = 0.1; // seconds into the scene: the first thing a viewer sees
const KEYFRAME_LAG = 0.1; // seconds after a keyframe lands
const CONTACT_POINT = 0.85;
const MIN_GAP = 0.05;
const DEFAULT_FPS = 30;
const EPSILON = 1e-9;

export const PHONE_WIDTH = 360;
export const MAX_FRAMES = 11; // plus the phone tile = 12 tiles
const MAX_TILE_WIDTH = 480;
const LANDSCAPE_COLUMNS = 4;
const PORTRAIT_COLUMNS = 3;
const OUTLINE = '#39404f';
const PAD = 16;
const GAP = 16;
const CAPTION_HEIGHT = 24;
const SHEET_BACKGROUND = '#0b0d12';
const PNG_WIDTH_OFFSET = 16;
const PNG_HEIGHT_OFFSET = 20;

// Scene-local seconds, sorted. A time is kept only when it is at least 0.05 s after the previous kept time (so a
// cluster is anchored on its first member, and the fixed 0.1 first look is never displaced), then the last frame is
// forced in. `fps` caps every time at the scene's last frame, duration - 1/fps.
export function sheetTimes(scene, fps = DEFAULT_FPS) {
  const last = Math.max(0, scene.duration - 1 / fps);
  const keyframes = (scene.elements ?? []).flatMap((el) => (el.keyframes ?? []).map((kf) => kf.t + KEYFRAME_LAG));
  const raw = [FIRST_LOOK, ...keyframes, scene.duration * CONTACT_POINT, last]
    .map((t) => Math.min(Math.max(0, t), last))
    .sort((a, b) => a - b);
  const kept = [];
  for (const t of raw) {
    if (!kept.length || t - kept[kept.length - 1] >= MIN_GAP - EPSILON) kept.push(t);
  }
  if (kept[kept.length - 1] !== last) kept[kept.length - 1] = last; // the tail is within 0.05 s of `last`
  return kept;
}

// The times to capture: all of sheetTimes when they fit in `max`, otherwise the first look, the 85 % point and the
// last frame plus keyframe landings picked evenly by index across the rest. `total` is the uncapped count.
export function sheetMoments(scene, fps = DEFAULT_FPS, max = MAX_FRAMES) {
  const all = sheetTimes(scene, fps);
  if (all.length <= max) return { times: all, total: all.length };
  const target = scene.duration * CONTACT_POINT;
  let mid = 1;
  for (let i = 1; i < all.length - 1; i++) if (Math.abs(all[i] - target) < Math.abs(all[mid] - target)) mid = i;
  const rest = all.filter((_, i) => i !== 0 && i !== mid && i !== all.length - 1);
  const slots = max - 3;
  const picked = new Set(Array.from({ length: slots }, (_, j) => Math.floor(((j + 0.5) * rest.length) / slots)).map((i) => rest[i]));
  return { times: all.filter((t, i) => i === 0 || i === mid || i === all.length - 1 || picked.has(t)), total: all.length };
}

// Positions of every tile in the sheet. `tiles` are {w, h, width?}: natural pixel size and an optional display width.
// Tiles are at most 480 px wide (never upscaled), four to a row (three for portrait frames), row-major; the sheet size is exact.
export function sheetLayout(tiles) {
  const cellWidth = Math.min(tiles[0].w, MAX_TILE_WIDTH);
  const cols = Math.min(tiles.length, tiles[0].h > tiles[0].w ? PORTRAIT_COLUMNS : LANDSCAPE_COLUMNS);
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
img{display:block;outline:1px solid ${OUTLINE}}
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
