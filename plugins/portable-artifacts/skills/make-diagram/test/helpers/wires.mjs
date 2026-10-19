// Shared by the render and curve tests: read the drawn wires and plates out of
// an SVG and sample the path data from the Bézier equations, independently of
// scripts/lib/curves.mjs, so the drawn picture is checked, not the code's view of it.

export const STEP = 2; // px: the most a sampled wire moves between two samples

const attr = (tag, name) => tag.match(new RegExp(` ${name}="([^"]*)"`))?.[1];

// de Casteljau: a line, a quadratic or a cubic at t
export function bezier(pts, t) {
  let p = pts;
  while (p.length > 1) p = p.slice(1).map((b, i) => ({ x: p[i].x + (b.x - p[i].x) * t, y: p[i].y + (b.y - p[i].y) * t }));
  return p[0];
}

const longestLeg = (pts) => Math.max(...pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y)));

/** Points along path data made of M, L, Q and C, at most STEP px apart (a degree-n Bézier moves at most n times its longest control leg per unit t). */
export function sampleWire(d) {
  const out = [];
  let cur = null;
  for (const [, cmd, args] of d.matchAll(/([MLQC])([^MLQC]*)/g)) {
    const n = args.trim().split(/[\s,]+/).map(Number);
    const ctrl = [];
    for (let i = 0; i < n.length; i += 2) ctrl.push({ x: n[i], y: n[i + 1] });
    if (cmd === 'M') { cur = ctrl[0]; out.push(cur); continue; }
    const pts = [cur, ...ctrl];
    const k = Math.max(1, Math.ceil(((pts.length - 1) * longestLeg(pts)) / STEP));
    for (let i = 1; i <= k; i++) out.push(bezier(pts, i / k));
    cur = ctrl.at(-1);
  }
  return out;
}

/** Cumulative length at each sample. */
export function lengths(pts) {
  const at = [0];
  for (let i = 1; i < pts.length; i++) at.push(at[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  return at;
}

/** The point `fraction` of the way along a sampled wire, by length. */
export function along(pts, fraction) {
  const at = lengths(pts);
  const want = fraction * at.at(-1);
  const i = Math.max(1, at.findIndex((l) => l >= want));
  const t = at[i] === at[i - 1] ? 0 : (want - at[i - 1]) / (at[i] - at[i - 1]);
  return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t };
}

export const inside = (p, r) => p.x > r.x && p.x < r.x + r.width && p.y > r.y && p.y < r.y + r.height;
export const rectsOverlap = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
export const rectDist = (p, r) => Math.hypot(Math.max(r.x - p.x, 0, p.x - (r.x + r.width)), Math.max(r.y - p.y, 0, p.y - (r.y + r.height)));

const tagsOf = (svg, re) => [...svg.matchAll(re)].map((m) => m[0]);

/** Every edge wire in the SVG: { id, d }. */
export const wires = (svg) => tagsOf(svg, /<g class="pa-edge [^>]*><path class="pa-wire" d="[^"]*"/g).map((t) => ({ id: attr(t, 'data-id'), d: t.match(/ d="([^"]*)"/)[1] }));

/** Every drawn label plate, by edge id: { x, y, width, height }. */
export const plates = (svg) => new Map(tagsOf(svg, /<g class="pa-edge-label" data-edge="[^"]*"><rect [^>]*>/g).map((t) => [attr(t, 'data-edge'), ['x', 'y', 'width', 'height'].reduce((r, k) => ({ ...r, [k]: Number(attr(t.slice(t.indexOf('<rect')), k)) }), {})]));

// Distance between segments ab and cd (0 when they cross).
function segDist(a, b, c, d) {
  const cross = (o, p, q) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  const toSeg = (p, s, e) => {
    const dx = e.x - s.x;
    const dy = e.y - s.y;
    const len = dx * dx + dy * dy;
    const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - s.x) * dx + (p.y - s.y) * dy) / len));
    return Math.hypot(p.x - (s.x + t * dx), p.y - (s.y + t * dy));
  };
  return Math.min(toSeg(a, c, d), toSeg(b, c, d), toSeg(c, a, b), toSeg(d, a, b));
}

/** The least distance between two sampled polylines, segment to segment. */
export function polylineDistance(p, q) {
  let best = Infinity;
  for (let i = 1; i < p.length; i++) for (let j = 1; j < q.length; j++) best = Math.min(best, segDist(p[i - 1], p[i], q[j - 1], q[j]));
  return best;
}

/** The stretch of a sampled wire between 20 % and 80 % of its length. */
export function middle(pts) {
  const at = lengths(pts);
  const len = at.at(-1);
  return pts.filter((_, i) => at[i] >= 0.2 * len && at[i] <= 0.8 * len);
}
