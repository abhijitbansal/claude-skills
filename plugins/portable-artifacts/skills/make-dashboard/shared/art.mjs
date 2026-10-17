// Seeded procedural art: artSvg() returns one inline <svg> string drawn in a
// theme's own tokens. Pure and dependency-free: no Math.random, no Date, so the
// same arguments always give the same bytes (Math.sin/cos are rounded to 0.1,
// which keeps output stable across V8 versions in practice, not by spec).
// Ported from the three specimen sheets: dusk = grainy blobs, duotone orbs and
// wave bands; press = halftone screens and contour lines in overprint; poster =
// halftone gradient, grid warp and registration marks.
//
// Safety contract: the output has no script, no foreignObject, no href and no
// external url(); the only colours interpolated are #rrggbb tokens checked by
// assertHex; the seed text is only ever hashed, never written out. There is no
// xmlns attribute (it would put "http" in the string): the SVG is meant to be
// inlined in HTML; add xmlns yourself to save it as a standalone .svg file.
import { loadTheme, ThemeError } from './theme.mjs';

export { ThemeError };

// Theme name -> generator. Themes without their own style (paper, ink, ...)
// fall back to press, whose print look reads well in any palette.
export const ART_STYLES = Object.freeze({ dusk: 'dusk', press: 'press', poster: 'poster' });
const FALLBACK_STYLE = 'press';
const MODES = ['light', 'dark'];
const HEX = /^#[0-9a-f]{6}$/i;
const TAU = Math.PI * 2;
const MAX_DOTS = 1400; // per halftone layer; keeps 1280x720 well under 60 KB
const RADIUS_LEVELS = 7; // halftone dot sizes are quantised to this many paths

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

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Number -> short SVG token. Throws rather than writing NaN into markup.
function f(n) {
  if (!Number.isFinite(n)) throw new RangeError(`non-finite number in art geometry: ${n}`);
  return String(Math.round(n * 10) / 10);
}
const fi = (n) => f(Math.round(n));
const op = (n) => { f(n); return String(Math.round(n * 100) / 100); }; // opacity, 2 decimals

function mix(a, b, t) {
  const ch = (h, i) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  const out = [0, 1, 2].map((i) => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * t).toString(16).padStart(2, '0'));
  return assertHex(`#${out.join('')}`, 'mix');
}

// Smooth seeded field in roughly [-1, 1], defined on unit-free coordinates.
function noise(r, terms = 5) {
  const p = Array.from({ length: terms }, (_, i) => [r() * 5 + 0.8, r() * 5 + 0.8, r() * TAU, r() * TAU, 0.6 / (i + 1)]);
  return (x, y) => p.reduce((v, [fx, fy, px, py, amp]) => v + Math.sin(x * fx + px) * Math.cos(y * fy + py) * amp, 0);
}

const pick = (r, list) => list[Math.floor(r() * list.length) % list.length];

// ---- shared pieces ---------------------------------------------------------

function grain(ctx, opacity) {
  const { W, H, id, mode } = ctx;
  const filter = `<filter id="${id('grain')}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">`
    + `<feTurbulence type="fractalNoise" baseFrequency=".8" numOctaves="2" seed="${ctx.seedInt % 9973}" stitchTiles="stitch"/>`
    + '<feColorMatrix values="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 0 0 0 0 1"/></filter>';
  const rect = `<rect width="${f(W)}" height="${f(H)}" filter="url(#${id('grain')})" opacity="${op(mode === 'light' ? opacity * 0.7 : opacity)}" style="mix-blend-mode:soft-light"/>`;
  return { defs: filter, layer: rect };
}

// Zero-length round-capped subpaths draw as dots: one <path> per radius level
// keeps thousands of dots to about ten bytes each.
function dots(points, maxR, colour, extra = '') {
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
function screen(ctx, angle, step, value) {
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
      if (x < -step || y < -step || x > W + step || y > H + step) continue;
      out.push([x, y, value(x, y)]);
    }
  }
  return out;
}

const dotStep = (ctx, budget) => Math.max(6, Math.sqrt((ctx.W * ctx.H) / budget));

// Closed smooth curve: quadratic segments through the midpoints of samples.
function ring(cx, cy, radius, shape, points = 28) {
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

function blobPath(r, cx, cy, rad) {
  const ph = Array.from({ length: 4 }, () => r() * TAU);
  const am = ph.map((_, i) => (rad * (0.08 + r() * 0.12)) / (i + 1));
  const shape = (t) => 1 + am.reduce((s, a, j) => s + (a / rad) * Math.sin((j + 2) * t + ph[j]), 0);
  return ring(cx, cy, rad, shape, 18);
}

// ---- dusk: soft modern -----------------------------------------------------

function radial(ctx, key, colour, opacity) {
  return `<radialGradient id="${ctx.id(key)}"><stop offset="0" stop-color="${colour}" stop-opacity="${op(opacity)}"/>`
    + `<stop offset=".55" stop-color="${colour}" stop-opacity="${op(opacity * 0.45)}"/>`
    + `<stop offset="1" stop-color="${colour}" stop-opacity="0"/></radialGradient>`;
}

function haze(ctx, count, strength) {
  const { r, c, W, H, S } = ctx;
  const cols = [c.cat1, ctx.tone(6), c.cat2, c.cat6, ctx.tone(5), c.cat3];
  const cx0 = W * (0.3 + r() * 0.4);
  const cy0 = H * (0.35 + r() * 0.3);
  let defs = '';
  let body = '';
  const offset = Math.floor(r() * cols.length);
  for (let i = 0; i < count; i++) {
    const key = `h${i}`;
    defs += radial(ctx, key, cols[(i + offset) % cols.length], strength * (0.75 + r() * 0.25));
    const rad = S * (0.35 + r() * 0.4);
    const cx = cx0 + (r() - 0.5) * W * 0.7;
    const cy = cy0 + (r() - 0.5) * H * 0.6;
    body += `<ellipse cx="${fi(cx)}" cy="${fi(cy)}" rx="${fi(rad * (1 + r() * 0.5))}" ry="${fi(rad)}" fill="url(#${ctx.id(key)})"/>`;
  }
  return { defs, body };
}

function duskSky(ctx, top, bottom) {
  return {
    defs: `<linearGradient id="${ctx.id('sky')}" x1="0" y1="0" x2=".35" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>`,
    body: `<rect width="${f(ctx.W)}" height="${f(ctx.H)}" fill="url(#${ctx.id('sky')})"/>`,
  };
}

function duskBlobs(ctx) {
  const { c } = ctx;
  const sky = duskSky(ctx, c.page, mix(c.page, c.seq2, 0.6));
  const h = haze(ctx, 6, ctx.mode === 'light' ? 0.75 : 0.9);
  return { defs: sky.defs + h.defs, body: sky.body + h.body, grain: 0.55 };
}

function duskOrbs(ctx) {
  const { r, c, W, H, S, mode } = ctx;
  const sky = duskSky(ctx, c.page, mix(c.page, c.seq2, 0.45));
  const h = haze(ctx, 3, 0.45);
  const pairs = [[c.cat1, ctx.tone(6)], [c.cat6, c.cat3], [c.cat2, c.cat5], [ctx.tone(5), c.cat4]];
  const n = 3 + Math.floor(r() * 2);
  let defs = sky.defs + h.defs;
  let body = sky.body + h.body;
  const anchor = [W * (0.55 + r() * 0.25), H * (0.3 + r() * 0.3)];
  for (let i = 0; i < n; i++) {
    // the anchor orb stays warm (coral or pink); satellites take any pair
    const [c1, c2] = i === 0 ? pairs[Math.floor(r() * 2)] : pairs[(i + Math.floor(r() * 4)) % pairs.length];
    const key = `o${i}`;
    defs += `<linearGradient id="${ctx.id(key)}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>`;
    const rad = i === 0 ? S * (0.3 + r() * 0.12) : S * (0.06 + r() * 0.12);
    const ang = r() * TAU;
    const dist = i === 0 ? 0 : S * (0.25 + r() * 0.35);
    const cx = anchor[0] + Math.cos(ang) * dist * 1.4;
    const cy = anchor[1] + Math.sin(ang) * dist;
    const blend = i === 0 ? '' : ` style="mix-blend-mode:${mode === 'light' ? 'multiply' : 'screen'}"`;
    body += `<circle cx="${fi(cx)}" cy="${fi(cy)}" r="${fi(rad)}" fill="url(#${ctx.id(key)})" opacity="${i ? '.85' : '1'}"${blend}/>`;
  }
  for (let k = 0; k < 2; k++) {
    body += `<circle cx="${fi(anchor[0] + (r() - 0.5) * S * 0.8)}" cy="${fi(anchor[1] + (r() - 0.5) * S * 0.6)}" r="${fi(S * (0.32 + r() * 0.2))}" fill="none" stroke="${c.text}" stroke-width="${f(Math.max(1, S / 480))}" opacity=".35"/>`;
  }
  return { defs, body, grain: 0.5 };
}

function duskWaves(ctx) {
  const { r, c, W, H, S } = ctx;
  const sky = duskSky(ctx, c.page, mix(c.page, ctx.tone(4), 0.5));
  const sunX = W * (0.25 + r() * 0.5);
  const sunY = H * (0.32 + r() * 0.12);
  let defs = sky.defs + radial(ctx, 'sun', ctx.mode === 'dark' ? c.seq6 : c.cat3, 0.95);
  let body = sky.body + `<circle cx="${fi(sunX)}" cy="${fi(sunY)}" r="${fi(S * 0.55)}" fill="url(#${ctx.id('sun')})"/>`;
  const bands = [ctx.tone(5), ctx.tone(4), ctx.tone(3), c.cat6, ctx.tone(2), c.page];
  const stepX = Math.max(6, W / 120);
  bands.forEach((fill, i) => {
    const y = H * (0.42 + i * 0.1);
    const a1 = S * (0.02 + r() * 0.05);
    const f1 = (TAU / W) * (1 + r() * 1.6);
    const a2 = S * (0.008 + r() * 0.02);
    const f2 = (TAU / W) * (3 + r() * 4);
    const ph = r() * TAU;
    let d = `M0 ${f(H)}`;
    for (let x = 0; x <= W + stepX; x += stepX) {
      d += `L${fi(Math.min(x, W))} ${fi(y + Math.sin(x * f1 + ph) * a1 + Math.sin(x * f2 + ph * 2) * a2)}`;
    }
    body += `<path d="${d}L${f(W)} ${f(H)}Z" fill="${fill}" opacity="${op(0.7 + i * 0.06)}"/>`;
  });
  return { defs, body, grain: 0.5 };
}

// ---- press: print editorial ------------------------------------------------

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

// ---- poster: technical poster ----------------------------------------------

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
  const rows = 20;
  const cols = Math.round((rows * W) / H);
  const k = 3.2;
  const pt = (x, y) => {
    const o = n((x / W) * k, (y / H) * k) * amp;
    return `${fi(x + o * 0.6)} ${fi(y + o)}`;
  };
  const width = f(Math.max(0.8, S / 700));
  let ink = '';
  for (let i = 0; i <= rows; i++) {
    let d = '';
    for (let j = 0; j <= cols; j++) d += `${j ? 'L' : 'M'}${pt((j / cols) * W, (i / rows) * H)}`;
    ink += `<path d="${d}"/>`;
  }
  let lime = '';
  for (let j = 0; j <= cols; j += 3) {
    let d = '';
    for (let i = 0; i <= rows; i++) d += `${i ? 'L' : 'M'}${pt((j / cols) * W, (i / rows) * H)}`;
    lime += `<path d="${d}"/>`;
  }
  return `<g fill="none" stroke-width="${width}" opacity="${op(opacity)}"><g stroke="${c.text}">${ink}</g><g stroke="${c.accent}" opacity=".85">${lime}</g></g>`;
}

function posterArt(ctx) {
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

// ---- entry point -----------------------------------------------------------

const GENERATORS = {
  dusk: (ctx) => pick(ctx.r, [duskBlobs, duskOrbs, duskWaves])(ctx),
  press: (ctx) => pick(ctx.r, [pressScreens, pressRiso])(ctx),
  poster: posterArt,
};

function size(name, value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive finite number, got ${JSON.stringify(value)}`);
  }
  return value;
}

// mode defaults to 'dark': the dusk and poster specimens are dark-first.
export function artSvg({ theme, seed, width, height, mode = 'dark' }) {
  const tokens = loadTheme(theme);
  if (!MODES.includes(mode)) throw new TypeError(`mode must be one of ${MODES.join(', ')}, got ${JSON.stringify(mode)}`);
  const W = size('width', width);
  const H = size('height', height);
  const seedInt = seedFrom(seed);
  const style = Object.hasOwn(ART_STYLES, theme) ? ART_STYLES[theme] : FALLBACK_STYLE;
  const c = Object.fromEntries(Object.entries(tokens[mode]).map(([k, v]) => [k, assertHex(v, k)]));
  // ids: a letter, then a hash of every argument, so two different pieces on
  // one page never share an id (identical pieces have identical defs anyway).
  const prefix = `a${seedFrom(`${style}|${theme}|${mode}|${W}x${H}|${seed}`).toString(36)}-`;
  const ctx = {
    W, H, S: Math.min(W, H), L: Math.max(W, H), c, mode, seedInt,
    r: mulberry32(seedInt), blend: mode === 'light' ? 'multiply' : 'screen',
    id: (name) => prefix + name,
    // seq ramps run page -> contrast in both modes, so mirror them to keep
    // "tone(n)" meaning the same hue family: dark seqN is light seq(7-N).
    tone: (n) => assertHex(c[`seq${mode === 'dark' ? n : 7 - n}`], `tone(${n})`),
  };
  const art = GENERATORS[style](ctx);
  const g = grain(ctx, art.grain);
  return `<svg viewBox="0 0 ${f(W)} ${f(H)}" width="${f(W)}" height="${f(H)}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false" data-art="${style}" style="isolation:isolate">`
    + `<defs>${art.defs}${g.defs}</defs>${art.body}${g.layer}</svg>`;
}
