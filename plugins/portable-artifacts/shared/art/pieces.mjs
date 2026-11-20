// Shared pieces of the seeded art styles (shared/art.mjs is the entry point). Pure: no Math.random, no Date.
// Every number written into markup goes through f/fi/op, which round and throw on a non-finite value.

export const TAU = Math.PI * 2;
export const MAX_DOTS = 1400; // per halftone layer; keeps every accepted size under 60 KB
export const WARP_LINES = 36; // grid-warp lines along the long side; the short side scales down
const RADIUS_LEVELS = 7; // halftone dot sizes are quantised to this many paths
const HEX = /^#[0-9a-f]{6}$/i;

export function assertHex(value, key) {
  if (typeof value !== 'string' || !HEX.test(value)) {
    throw new TypeError(`theme token ${key} must be a #rrggbb colour, got ${JSON.stringify(value)}`);
  }
  return value.toLowerCase();
}

// FNV-1a over the UTF-8 bytes: a stable, non-negative 32-bit integer.
export function seedFrom(text) {
  if (typeof text !== 'string') throw new TypeError(`seed must be a string, got ${typeof text}`);
  let h = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text)) h = Math.imul(h ^ byte, 0x01000193);
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Number -> short SVG token. Throws rather than writing NaN into markup.
export function f(n) {
  if (!Number.isFinite(n)) throw new RangeError(`non-finite number in art geometry: ${n}`);
  return String(Math.round(n * 10) / 10);
}
export const fi = (n) => f(Math.round(n));
export const op = (n) => { f(n); return String(Math.round(n * 100) / 100); }; // opacity, 2 decimals

export function mix(a, b, t) {
  const ch = (h, i) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  const out = [0, 1, 2].map((i) => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * t).toString(16).padStart(2, '0'));
  return assertHex(`#${out.join('')}`, 'mix');
}

// Smooth seeded field in roughly [-1, 1], defined on unit-free coordinates.
export function noise(r, terms = 5) {
  const p = Array.from({ length: terms }, (_, i) => [r() * 5 + 0.8, r() * 5 + 0.8, r() * TAU, r() * TAU, 0.6 / (i + 1)]);
  return (x, y) => p.reduce((v, [fx, fy, px, py, amp]) => v + Math.sin(x * fx + px) * Math.cos(y * fy + py) * amp, 0);
}

export const pick = (r, list) => list[Math.floor(r() * list.length) % list.length];

export function grain(ctx, opacity) {
  const { W, H, id, mode } = ctx;
  const filter = `<filter id="${id('grain')}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">`
    + `<feTurbulence type="fractalNoise" baseFrequency=".8" numOctaves="2" seed="${ctx.seedInt % 9973}" stitchTiles="stitch"/>`
    + '<feColorMatrix values="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 0 0 0 0 1"/></filter>';
  const rect = `<rect width="${f(W)}" height="${f(H)}" filter="url(#${id('grain')})" opacity="${op(mode === 'light' ? opacity * 0.7 : opacity)}" style="mix-blend-mode:soft-light"/>`;
  return { defs: filter, layer: rect };
}

// Zero-length round-capped subpaths draw as dots: one <path> per radius level
// keeps thousands of dots to about ten bytes each.
export function dots(points, maxR, colour, extra = '') {
  const levels = Array.from({ length: RADIUS_LEVELS }, () => []);
  for (const [x, y, v] of points) {
    const level = Math.round(Math.min(1, Math.max(0, v)) * RADIUS_LEVELS);
    if (level > 0) levels[level - 1].push(`M${fi(x)} ${fi(y)}h.1`);
  }
  const paths = levels.map((d, i) => (d.length
    ? `<path d="${d.join('')}" stroke-width="${f((2 * maxR * (i + 1)) / RADIUS_LEVELS)}"/>` : '')).join('');
  return `<g fill="none" stroke="${colour}" stroke-linecap="round"${extra}>${paths}</g>`;
}

// Grid of sample points rotated by `angle` degrees, clipped to the canvas.
export function screen(ctx, angle, step, value) {
  const { W, H } = ctx;
  const a = (angle * Math.PI) / 180;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const n = Math.ceil(Math.hypot(W, H) / step / 2) + 1;
  const out = [];
  for (let u = -n; u <= n; u++) {
    for (let v = -n; v <= n; v++) {
      const x = W / 2 + u * step * ca - v * step * sa;
      const y = H / 2 + u * step * sa + v * step * ca;
      if (x < -step / 2 || y < -step / 2 || x > W + step / 2 || y > H + step / 2) continue;
      out.push([x, y, value(x, y)]);
    }
  }
  return out;
}

// Pitch s such that the clipped grid, (W + s)(H + s) / s^2 cells, holds at
// most `budget` dots whatever the aspect ratio.
export function dotStep(ctx, budget) {
  const { W, H } = ctx;
  const b = budget - 1;
  return Math.max(6, (W + H + Math.sqrt((W + H) ** 2 + 4 * b * W * H)) / (2 * b));
}

// Closed smooth curve: quadratic segments through the midpoints of samples.
export function ring(cx, cy, radius, shape, points = 28) {
  const pts = Array.from({ length: points }, (_, j) => {
    const t = (j / points) * TAU;
    const rr = radius * shape(t);
    return [cx + rr * Math.cos(t), cy + rr * Math.sin(t)];
  });
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const start = mid(pts[points - 1], pts[0]);
  let d = `M${fi(start[0])} ${fi(start[1])}`;
  pts.forEach((p, j) => {
    const m = mid(p, pts[(j + 1) % points]);
    d += `Q${fi(p[0])} ${fi(p[1])} ${fi(m[0])} ${fi(m[1])}`;
  });
  return `${d}Z`;
}

export function blobPath(r, cx, cy, rad) {
  const ph = Array.from({ length: 4 }, () => r() * TAU);
  const am = ph.map((_, i) => (rad * (0.08 + r() * 0.12)) / (i + 1));
  const shape = (t) => 1 + am.reduce((s, a, j) => s + (a / rad) * Math.sin((j + 2) * t + ph[j]), 0);
  return ring(cx, cy, rad, shape, 18);
}

export function radial(ctx, key, colour, opacity) {
  return `<radialGradient id="${ctx.id(key)}"><stop offset="0" stop-color="${colour}" stop-opacity="${op(opacity)}"/>`
    + `<stop offset=".55" stop-color="${colour}" stop-opacity="${op(opacity * 0.45)}"/>`
    + `<stop offset="1" stop-color="${colour}" stop-opacity="0"/></radialGradient>`;
}

// A count that grows with `side / spacing` but never past `cap`, so long thin canvases stay bounded in bytes.
export const bounded = (side, spacing, cap) => Math.max(1, Math.min(cap, Math.floor(side / spacing)));
