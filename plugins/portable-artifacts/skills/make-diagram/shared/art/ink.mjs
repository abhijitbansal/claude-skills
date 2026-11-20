// ink: brush washes. Large translucent washes in overprint, two or three tapered brush strokes and splatter at
// their ends. Colours are the theme's own tokens, used as they are.
import { TAU, f, fi, op, noise, blobPath } from './pieces.mjs';

const STROKE_SAMPLES = 24;

function washes(ctx) {
  const { r, c, W, H, S } = ctx;
  const inks = [c.accent, c.cat2, c.text, c.cat3];
  const offset = Math.floor(r() * inks.length);
  const n = 3 + Math.floor(r() * 2);
  let out = '';
  for (let i = 0; i < n; i++) {
    const cx = W * (0.12 + r() * 0.76);
    const cy = H * (0.18 + r() * 0.64);
    const opacity = (i === 0 ? 0.3 : 0.14 + r() * 0.12) * (ctx.mode === 'light' ? 1 : 1.3);
    out += `<path d="${blobPath(r, cx, cy, S * (0.28 + r() * 0.26))}" fill="${inks[(i + offset) % inks.length]}" opacity="${op(opacity)}" style="mix-blend-mode:${ctx.blend}"/>`;
  }
  return out;
}

// One stroke as a filled outline: a gentle curve whose width swells and tapers, roughened by a seeded field.
function stroke(ctx, n) {
  const { r, W, H, S, L } = ctx;
  const [x0, y0] = [W * (0.08 + r() * 0.3), H * (0.2 + r() * 0.6)];
  const ang = (r() - 0.5) * 0.9 + (W >= H ? 0 : Math.PI / 2);
  const len = L * (0.35 + r() * 0.35);
  const bend = S * (0.08 + r() * 0.12) * (r() < 0.5 ? -1 : 1);
  const w0 = S * (0.025 + r() * 0.035);
  const top = [];
  const bottom = [];
  for (let i = 0; i <= STROKE_SAMPLES; i++) {
    const t = i / STROKE_SAMPLES;
    const along = t * len;
    const off = Math.sin(t * Math.PI) * bend;
    const x = x0 + Math.cos(ang) * along - Math.sin(ang) * off;
    const y = y0 + Math.sin(ang) * along + Math.cos(ang) * off;
    const w = w0 * Math.sin(Math.PI * Math.min(1, t * 1.15)) ** 0.6 * (0.75 + 0.35 * n(t * 3, 0.5));
    top.push(`${fi(x - Math.sin(ang) * w)} ${fi(y + Math.cos(ang) * w)}`);
    bottom.unshift(`${fi(x + Math.sin(ang) * w)} ${fi(y - Math.cos(ang) * w)}`);
  }
  const end = [x0 + Math.cos(ang) * len, y0 + Math.sin(ang) * len];
  return { d: `M${top.join('L')}L${bottom.join('L')}Z`, end };
}

function splatter(ctx, at, count) {
  const { r, S } = ctx;
  let out = '';
  for (let i = 0; i < count; i++) {
    const a = r() * TAU;
    const dist = S * (0.02 + r() * 0.12);
    out += `<circle cx="${fi(at[0] + Math.cos(a) * dist)}" cy="${fi(at[1] + Math.sin(a) * dist)}" r="${f(Math.max(0.6, S * (0.002 + r() * 0.008)))}"/>`;
  }
  return out;
}

export function ink(ctx) {
  const { r, c, W, H } = ctx;
  const n = noise(r, 3);
  let body = `<rect width="${f(W)}" height="${f(H)}" fill="${c.page}"/>${washes(ctx)}`;
  let strokes = '';
  let specks = '';
  const count = 2 + Math.floor(r() * 2);
  for (let i = 0; i < count; i++) {
    const s = stroke(ctx, n);
    strokes += `<path d="${s.d}"/>`;
    specks += splatter(ctx, s.end, 10 + Math.floor(r() * 10));
  }
  body += `<g fill="${c.text}" opacity=".82">${strokes}</g><g fill="${c.text}" opacity=".6">${specks}</g>`;
  return { defs: '', body, grain: 0.45 };
}
