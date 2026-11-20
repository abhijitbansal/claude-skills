// poster: technical poster. Halftone gradient, grid warp and registration marks (ported from the poster specimen sheet).
import { MAX_DOTS, WARP_LINES, f, fi, op, noise, dots, screen, dotStep } from './pieces.mjs';

function registration(ctx, x, y, size) {
  const { c } = ctx;
  const w = f(Math.max(1, size / 14));
  const s = size;
  return `<g fill="none" stroke="${c.text}" stroke-width="${w}"><circle cx="${fi(x)}" cy="${fi(y)}" r="${f(s * 0.55)}"/>`
    + `<circle cx="${fi(x)}" cy="${fi(y)}" r="${f(s * 0.25)}" fill="${c.text}"/>`
    + `<path d="M${fi(x - s)} ${fi(y)}H${fi(x + s)}M${fi(x)} ${fi(y - s)}V${fi(y + s)}"/></g>`;
}

function posterFrame(ctx) {
  const { c, W, H, S, r } = ctx;
  const m = S * 0.06;
  const size = S * 0.035;
  let out = '';
  const crop = S * 0.045;
  const w = f(Math.max(1, S / 520));
  for (const [x, y, sx, sy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]]) {
    out += `<path d="M${fi(x - sx * crop * 0.4)} ${fi(y)}h${fi(-sx * crop)}M${fi(x)} ${fi(y - sy * crop * 0.4)}v${fi(-sy * crop)}" stroke="${c.text}" stroke-width="${w}" fill="none"/>`;
  }
  out += registration(ctx, W / 2, m * 0.9, size) + registration(ctx, W / 2, H - m * 0.9, size);
  // colour bar: the theme's categorical inks as press-check swatches
  const sw = S * 0.028;
  const bar = [c.cat1, c.cat2, c.cat3, c.cat4, c.cat5, c.text];
  const left = r() < 0.5;
  const bx = left ? m * 1.6 : W - m * 1.6 - sw;
  bar.forEach((col, i) => { out += `<rect x="${fi(bx)}" y="${fi(H / 2 - (bar.length / 2 - i) * sw)}" width="${fi(sw)}" height="${fi(sw)}" fill="${col}"/>`; });
  return out;
}

function posterField(ctx, sparse) {
  const { r, c, W, H } = ctx;
  const n = noise(r);
  const cx = W * (0.2 + r() * 0.6);
  const cy = H * (0.2 + r() * 0.6);
  const step = dotStep(ctx, sparse ? MAX_DOTS * 0.7 : MAX_DOTS);
  const reach = Math.hypot(W, H) * (sparse ? 0.38 : 0.48);
  const value = (x, y) => {
    const v = 1 - Math.hypot(x - cx, y - cy) / reach + n((x / W) * 3, (y / H) * 3) * 0.3;
    return sparse ? v * 1.2 - 0.1 : v;
  };
  return {
    body: dots(screen(ctx, 0, step, value), step * 0.5, c.cat2),
    hot: [cx, cy],
  };
}

function posterWarp(ctx, opacity) {
  const { r, c, W, H, S } = ctx;
  const n = noise(r);
  const amp = S * (0.05 + r() * 0.04);
  // line counts follow the aspect ratio but stay within [2, WARP_LINES], and
  // every line has the same number of samples, so bytes are bounded
  const lines = (side) => Math.max(2, Math.min(WARP_LINES, Math.round((WARP_LINES * side) / ctx.L)));
  const rows = lines(H);
  const cols = lines(W);
  const samples = WARP_LINES;
  const k = 3.2;
  const pt = (x, y) => {
    const o = n((x / W) * k, (y / H) * k) * amp;
    return `${fi(x + o * 0.6)} ${fi(y + o)}`;
  };
  const width = f(Math.max(0.8, S / 700));
  let ink = '';
  for (let i = 0; i <= rows; i++) {
    let d = '';
    for (let j = 0; j <= samples; j++) d += `${j ? 'L' : 'M'}${pt((j / samples) * W, (i / rows) * H)}`;
    ink += `<path d="${d}"/>`;
  }
  let lime = '';
  for (let j = 0; j <= cols; j += 3) {
    let d = '';
    for (let i = 0; i <= samples; i++) d += `${i ? 'L' : 'M'}${pt((j / cols) * W, (i / samples) * H)}`;
    lime += `<path d="${d}"/>`;
  }
  return `<g fill="none" stroke-width="${width}" opacity="${op(opacity)}"><g stroke="${c.text}">${ink}</g><g stroke="${c.accent}" opacity=".85">${lime}</g></g>`;
}

export function poster(ctx) {
  const { r, c, W, H, S } = ctx;
  const warpFirst = r() < 0.5;
  let body = `<rect width="${f(W)}" height="${f(H)}" fill="${c.page}"/>`;
  const field = posterField(ctx, warpFirst);
  if (warpFirst) body += posterWarp(ctx, 0.9) + field.body;
  else body += field.body + posterWarp(ctx, 0.28);
  // the hotspot gets an accent target: dot, ring and crosshair
  const [hx, hy] = field.hot;
  const t = S * 0.05;
  body += `<g stroke="${c.accent}" stroke-width="${f(Math.max(1.2, S / 360))}" fill="none"><circle cx="${fi(hx)}" cy="${fi(hy)}" r="${f(t * 0.6)}"/>`
    + `<path d="M${fi(hx - t)} ${fi(hy)}H${fi(hx + t)}M${fi(hx)} ${fi(hy - t)}V${fi(hy + t)}"/></g>`
    + `<circle cx="${fi(hx)}" cy="${fi(hy)}" r="${f(Math.max(3, S * 0.014))}" fill="${c.accent}"/>`;
  body += posterFrame(ctx);
  return { defs: '', body, grain: 0.25 };
}
