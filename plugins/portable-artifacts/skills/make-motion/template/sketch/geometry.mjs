// Browser-safe and DOM-free: the geometry of the hand-drawn style. Outlines are built as dense polylines (no path syntax, no
// getPointAtLength), then `wobble` resamples them along their length and bends them with smooth noise, as the approved
// spike (.scratch/sketch-spike/spike.html, `sample`) does. The sizes of the look (TAPER, HATCH_INSET and the `amp`, `wave`,
// `step` that callers pass) are px at 1080 on the canvas's short side and are multiplied by `u` (see `unit`) when used.
// ELLIPSE_STEP, CORNER_STEPS and CURVE_STEPS only set how densely an outline is sampled before `wobble` resamples it: they
// are canvas px and point counts, and are not scaled.
const TAU = Math.PI * 2;
const REFERENCE_SIDE = 1080;
const CORNER_STEPS = 6; // points on a quarter-round corner of a box
const ELLIPSE_STEP = 6; // canvas px between the points of an ellipse before it is wobbled
const CURVE_STEPS = 24; // points on a bowed line before it is wobbled
const TAPER = 30; // px over which the wobble grows from the end of a stroke to its full size
const TAPER_FLOOR = 0.35; // a stroke's very end still wobbles by this share of the full size
const SECOND_WAVE = 0.37; // the second, finer wave is this share of the first one's length
const SECOND_AMP = 0.5;
const HATCH_INSET = 10; // px between a hatch and the outline it fills

/** One px at 1080 on the short side, in canvas px (the same formula as unit() in blocks/layout.mjs, which this file may not import). */
export const unit = (size) => Math.min(size[0], size[1]) / REFERENCE_SIDE;

// ---- seeded noise ------------------------------------------------------------------------------------------------------

/** A 32-bit seed from the film's seed and an element id (FNV-1a), so one element's wobble never depends on another's. */
export function hashSeed(seed, id) {
  let h = 0x811c9dc5;
  for (const ch of `${seed}:${id}`) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A random-number function from a 32-bit seed (mulberry32, the spike's generator): [0, 1), the same sequence for the same seed. */
export function makeRng(seed) {
  let state = seed | 0;
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- polylines and strokes ---------------------------------------------------------------------------------------------

/** True for `{ x, y }` with finite numbers: what a line's `to` must be. */
export const isPoint = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && Number.isFinite(v.x) && Number.isFinite(v.y);

/** The running length at each point of `points` (the first is 0) and the total. */
export function measure(points) {
  const lengths = [0];
  for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  return { lengths, total: lengths.at(-1) ?? 0 };
}

/** A stroke without its times: `attrs` (path, kind, color, width, opacity, layer) plus the points and their lengths. */
export function makeStroke(points, attrs) {
  const { lengths, total } = measure(points);
  return { ...attrs, points, lengths, total };
}

/** The point `progress` (0 to 1, clamped) of the way along `stroke` by length: its first point at 0, its last at 1. A copy. */
export function pointAt(stroke, progress) {
  const { points, lengths, total } = stroke;
  if (!(progress > 0) || total <= 0) return [...points[0]];
  if (progress >= 1) return [...points.at(-1)];
  const target = progress * total;
  let low = 1;
  let high = lengths.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (lengths[mid] < target) low = mid + 1;
    else high = mid;
  }
  const span = lengths[low] - lengths[low - 1];
  const k = span > 0 ? (target - lengths[low - 1]) / span : 0;
  const [x0, y0] = points[low - 1];
  const [x1, y1] = points[low];
  return [x0 + (x1 - x0) * k, y0 + (y1 - y0) * k];
}

/**
 * `points` resampled every `step` px along their length and displaced by smooth noise that grows from the ends: the spike's
 * `sample`. Draws four numbers from `rng` for the phases. `amp`, `wave` (the noise's length) and `step` are px at 1080.
 * No points give no points.
 */
export function wobble(input, rng, { amp, wave, step = 7, u }) {
  if (input.length === 0) return [];
  const points = input.length < 2 ? [input[0], input[0]] : input;
  const { lengths, total } = measure(points);
  const [phaseA, phaseB, secondA, secondB] = [rng() * TAU, rng() * TAU, rng() * TAU, rng() * TAU];
  const count = Math.max(2, Math.ceil(total / (step * u)));
  const size = amp * u;
  const long = wave * u;
  const noise = (s, first, second) => Math.sin(s / long + first) + SECOND_AMP * Math.sin(s / (long * SECOND_WAVE) + second);
  const out = [];
  let seg = 1; // points[seg - 1] to points[seg] is the piece that holds s
  for (let i = 0; i <= count; i++) {
    const s = (i / count) * total;
    while (seg < points.length - 1 && lengths[seg] < s) seg++;
    const [a, b] = [points[seg - 1], points[seg]];
    const span = lengths[seg] - lengths[seg - 1];
    const k = span > 0 ? Math.min(1, Math.max(0, (s - lengths[seg - 1]) / span)) : 0;
    const ends = Math.min(1, Math.min(s, total - s) / (TAPER * u) + TAPER_FLOOR);
    out.push([a[0] + (b[0] - a[0]) * k + ends * size * noise(s, phaseA, secondA), a[1] + (b[1] - a[1]) * k + ends * size * noise(s, phaseB, secondB)]);
  }
  return out;
}

// ---- outlines (base polylines, canvas px) ------------------------------------------------------------------------------

function quad(p0, c, p1, steps) {
  const out = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const m = 1 - t;
    out.push([m * m * p0[0] + 2 * m * t * c[0] + t * t * p1[0], m * m * p0[1] + 2 * m * t * c[1] + t * t * p1[1]]);
  }
  return out;
}

/**
 * A quadratic curve from `p0` to `p1` whose control point is `bow` px to the left of the way it runs (the left of a person
 * walking from `p0` to `p1` on the screen: up for a line that runs rightwards; negative: right), as the spike's arrows.
 */
export function bowedLine(p0, p1, bow) {
  const [dx, dy] = [p1[0] - p0[0], p1[1] - p0[1]];
  const len = Math.hypot(dx, dy);
  const [nx, ny] = len > 0 ? [dy / len, -dx / len] : [0, 0];
  const control = [(p0[0] + p1[0]) / 2 + nx * bow, (p0[1] + p1[1]) / 2 + ny * bow];
  return [p0, ...quad(p0, control, p1, CURVE_STEPS)];
}

/**
 * A box centred on (cx, cy) with round corners of radius `r`, drawn from the top edge clockwise and carrying on `over` px
 * past where it started (the spike's `sketchBox`: the closing overshoot).
 */
export function boxOutline(cx, cy, w, h, r, over) {
  const x = cx - w / 2;
  const y = cy - h / 2;
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  const corner = (from, control, to) => quad(from, control, to, CORNER_STEPS);
  const pts = [[x + rr, y], [x + w - rr, y]];
  pts.push(...corner([x + w - rr, y], [x + w, y], [x + w, y + rr]), [x + w, y + h - rr]);
  pts.push(...corner([x + w, y + h - rr], [x + w, y + h], [x + w - rr, y + h]), [x + rr, y + h]);
  pts.push(...corner([x + rr, y + h], [x, y + h], [x, y + h - rr]), [x, y + rr]);
  pts.push(...corner([x, y + rr], [x, y], [x + rr, y]));
  pts.push([Math.min(x + rr + over, x + w - rr), y]);
  return pts;
}

/** An ellipse from its top, clockwise, carrying on `over` px past where it started. */
export function ellipseOutline(cx, cy, rx, ry, over) {
  const perimeter = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)));
  const sweep = TAU * (1 + (perimeter > 0 ? over / perimeter : 0));
  const count = Math.max(24, Math.ceil(perimeter / ELLIPSE_STEP));
  const out = [];
  for (let i = 0; i <= Math.ceil(count * (sweep / TAU)); i++) {
    const theta = Math.min(sweep, (i / count) * TAU);
    out.push([cx + rx * Math.sin(theta), cy - ry * Math.cos(theta)]);
  }
  return out;
}

// A zig-zag of diagonal strokes `gap` apart, each running from one side of the shape to the other, joined end to end (the
// spike's `hatch`). `chord(c)` is the segment [a, b] of the diagonal u + v = c inside the shape, or null.
function zigzag(extent, gap, chord) {
  const out = [];
  let up = false;
  for (let i = 0; i < extent / gap; i++) {
    const seg = chord(i * gap);
    if (!seg) continue;
    const [a, b] = seg;
    out.push(...(up ? [a, b] : [b, a]));
    up = !up;
  }
  return out;
}

/** The hatch of a box w by h centred on (cx, cy), inset a little so it stays inside the outline. */
export function boxHatch(cx, cy, w, h, gap, u) {
  const inset = HATCH_INSET * u;
  const [bw, bh] = [Math.max(0, w - 2 * inset), Math.max(0, h - 2 * inset)];
  const [x0, y0] = [cx - bw / 2, cy - bh / 2];
  return zigzag(bw + bh, gap, (c) => [[x0 + Math.min(c, bw), y0 + Math.max(0, c - bw)], [x0 + Math.max(0, c - bh), y0 + Math.min(c, bh)]]);
}

/** The same hatch clipped to an ellipse of semi-axes rx, ry. */
export function ellipseHatch(cx, cy, rx, ry, gap, u) {
  const [a, b] = [Math.max(0, rx - HATCH_INSET * u), Math.max(0, ry - HATCH_INSET * u)];
  if (a === 0 || b === 0) return [];
  return zigzag(2 * (a + b), gap, (c) => {
    const k = c - a - b; // the diagonal is px + py = k, measured from the centre
    const qa = 1 / (a * a) + 1 / (b * b);
    const qb = (-2 * k) / (b * b);
    const disc = qb * qb - 4 * qa * ((k * k) / (b * b) - 1);
    if (disc <= 0) return null;
    const [t0, t1] = [(-qb - Math.sqrt(disc)) / (2 * qa), (-qb + Math.sqrt(disc)) / (2 * qa)];
    return [[cx + t1, cy + k - t1], [cx + t0, cy + k - t0]];
  });
}

/** The two barbs of an arrow head at `tip`, as 2-point segments ending on it; `from` is a point behind the tip on the line. */
export function arrowBarbs(tip, from, length, spread) {
  const angle = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
  return [spread, -spread].map((off) => [[tip[0] + length * Math.cos(angle + off), tip[1] + length * Math.sin(angle + off)], [...tip]]);
}
