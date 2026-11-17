// mono: a dot-matrix raster. Square dots on a fixed pitch, set by a seeded field in two tones, with dim scan rows
// and one accent run like a cursor. Colours are the theme's own tokens, used as they are.
import { MAX_DOTS, f, fi, noise, screen, dotStep } from './pieces.mjs';

const SCAN_EVERY = 4; // every fourth row is a dim scan row

// Zero-length square-capped subpaths: each one draws as a square dot of the stroke width.
function squares(points, size, colour, extra = '') {
  if (!points.length) return '';
  const d = points.map(([x, y]) => `M${fi(x)} ${fi(y)}h.1`).join('');
  return `<path d="${d}" fill="none" stroke="${colour}" stroke-width="${f(size)}" stroke-linecap="square"${extra}/>`;
}

export function mono(ctx) {
  const { r, c, W, H, S } = ctx;
  const n = noise(r, 4);
  const step = dotStep(ctx, MAX_DOTS);
  const k = 2.2 / S;
  const bias = 0.15 + r() * 0.2;
  const strong = [];
  const soft = [];
  const scan = [];
  for (const [x, y] of screen(ctx, 0, step, () => 0)) {
    const v = 0.5 + n(x * k, y * k) * 0.6 - bias * (y / H);
    const row = Math.round(y / step);
    if (row % SCAN_EVERY === 0) {
      if (v > 0.3) scan.push([x, y]);
    } else if (v > 0.62) strong.push([x, y]);
    else if (v > 0.42) soft.push([x, y]);
  }
  const size = step * 0.62;
  // the cursor: a short run of accent dots on one seeded row
  const cy = Math.round((H * (0.25 + r() * 0.5)) / step) * step;
  const run = Math.max(3, Math.min(12, Math.floor((W * 0.25) / step)));
  const cx0 = Math.round((W * (0.1 + r() * 0.5)) / step) * step;
  const cursor = Array.from({ length: run }, (_, i) => [cx0 + i * step, cy]).filter(([x]) => x <= W);
  const body = `<rect width="${f(W)}" height="${f(H)}" fill="${c.page}"/>`
    + squares(scan, size, c.text3, ' opacity=".35"') + squares(soft, size, c.text3) + squares(strong, size, c.text)
    + squares(cursor, size, c.accent);
  return { defs: '', body, grain: 0.12 };
}
