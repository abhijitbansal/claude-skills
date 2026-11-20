// press: print editorial. Halftone screens and contour lines in overprint (ported from the press specimen sheet).
import { TAU, MAX_DOTS, f, fi, op, noise, pick, dots, screen, dotStep, ring, blobPath } from './pieces.mjs';

function pressContours(ctx, centres, rings, colour, opacity, at) {
  const { r, c, W, H, S } = ctx;
  const width = Math.max(0.8, S / 600);
  let out = '';
  for (let i = 0; i < centres; i++) {
    const cx = at && i === 0 ? at[0] : W * (0.15 + r() * 0.7);
    const cy = at && i === 0 ? at[1] : H * (0.15 + r() * 0.7);
    const ph = [r() * TAU, r() * TAU, r() * TAU];
    for (let k = 1; k <= rings; k++) {
      const base = k * S * 0.05;
      const shape = (t) => 1 + 0.18 * Math.sin(2 * t + ph[0]) + 0.1 * Math.sin(3 * t + ph[1]) + 0.06 * Math.sin(5 * t + ph[2]) + k * 0.004 * Math.sin(7 * t);
      const accent = k % 4 === 0;
      out += `<path d="${ring(cx, cy, base, shape)}" stroke="${accent ? c.accent : colour}" stroke-width="${f(accent ? width * 2.2 : width)}"/>`;
    }
  }
  return `<g fill="none" opacity="${op(opacity)}">${out}</g>`;
}

function pressScreens(ctx) {
  const { r, c, W, H, L } = ctx;
  const n = noise(r, 4);
  const cx = W * (0.3 + r() * 0.4);
  const cy = H * (0.3 + r() * 0.4);
  const step = dotStep(ctx, MAX_DOTS);
  const maxR = step * 0.5;
  const k = 2.4 / L;
  const dist = (x, y) => Math.hypot(x - cx, y - cy) / Math.hypot(W, H);
  const field = (x, y) => Math.max(0, Math.min(1, 0.5 + n(x * k, y * k) * 0.55));
  const blend = ` style="mix-blend-mode:${ctx.blend}"`;
  let body = `<rect width="${f(W)}" height="${f(H)}" fill="${c.page}"/>`;
  body += dots(screen(ctx, 15, step, (x, y) => field(x, y) ** 1.3 * (1.15 - dist(x, y) * 1.2)), maxR, c.accent, blend);
  body += dots(screen(ctx, 45, step * 1.05, (x, y) => (1 - field(y * 1.3, x * 0.8)) ** 1.7 * Math.min(1, dist(x, y) * 2)), maxR, c.cat2, `${blend} opacity=".92"`);
  body += pressContours(ctx, 1, 9, c.text, 0.55, [cx, cy]);
  return { defs: '', body, grain: 0.22 };
}

function pressRiso(ctx) {
  const { r, c, W, H, S } = ctx;
  const blend = ` style="mix-blend-mode:${ctx.blend}"`;
  let body = `<rect width="${f(W)}" height="${f(H)}" fill="${c.page}"/>`;
  const inks = [c.accent, c.cat3, c.cat4, c.cat2];
  const offset = Math.floor(r() * inks.length);
  const n = 2 + Math.floor(r() * 2);
  const anchor = [W * (0.35 + r() * 0.3), H * (0.4 + r() * 0.2)];
  for (let i = 0; i < n; i++) {
    const ink = inks[(i + offset) % inks.length];
    const cx = anchor[0] + (r() - 0.5) * S * 0.9;
    const cy = anchor[1] + (r() - 0.5) * S * 0.5;
    body += `<path d="${blobPath(r, cx, cy, S * (0.2 + r() * 0.14))}" fill="${ink}" opacity=".9"${blend}/>`;
  }
  body += pressContours(ctx, 1, 10, c.text, 0.75);
  let specks = '';
  for (let i = 0; i < 70; i++) specks += `<circle cx="${fi(r() * W)}" cy="${fi(r() * H)}" r="${f((0.8 + r() * 2.4) * Math.max(1, S / 500))}"/>`;
  body += `<g fill="${c.text}" opacity=".7">${specks}</g>`;
  const nf = noise(r, 3);
  const hx = W * (r() < 0.5 ? 0.12 : 0.88);
  const hy = H * (0.2 + r() * 0.6);
  const step = dotStep(ctx, MAX_DOTS * 0.8);
  const reach = Math.hypot(W, H) * 0.42;
  body += dots(screen(ctx, 30, step, (x, y) => (1 - Math.hypot(x - hx, y - hy) / reach) * (0.75 + nf(x / S * 3, y / S * 3) * 0.4)), step * 0.5, c.cat3, `${blend} opacity=".9"`);
  return { defs: '', body, grain: 0.22 };
}

export const press = (ctx) => pick(ctx.r, [pressScreens, pressRiso])(ctx);
