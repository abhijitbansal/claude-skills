// Edge geometry for the renderer: ends moved onto the drawn outline, and the
// orthogonal polyline turned into a path with rounded corners (sequence
// messages, self loops) or into Bézier curves (graph edges, curvedRoute).
//
// ELK attaches an edge to the node's bounding box. For shapes that do not fill
// their box (diamond, stadium, dots, hexagon, parallelogram, cylinder) the
// route is extended along its own end segment until it meets the outline.
import { outlineHit } from './shapes.mjs';

export const EDGE_CORNER_RADIUS = 6;
const SIDE_TOLERANCE = 1.5; // an end this close to a box side is attached to it
const AXIS_TOLERANCE = 0.5;
const MIN_MOVE = 0.05;

const round2 = (v) => Math.round(v * 100) / 100;
const num = (v) => String(round2(v));

// Which side of `box` the point sits on, and the unit step into the box from it.
function inwardStep(box, p) {
  const sides = [
    { d: Math.abs(p.x - box.x), dir: { dx: 1, dy: 0 } },
    { d: Math.abs(p.x - (box.x + box.width)), dir: { dx: -1, dy: 0 } },
    { d: Math.abs(p.y - box.y), dir: { dx: 0, dy: 1 } },
    { d: Math.abs(p.y - (box.y + box.height)), dir: { dx: 0, dy: -1 } },
  ];
  const nearest = sides.reduce((a, b) => (b.d < a.d ? b : a));
  return nearest.d <= SIDE_TOLERANCE ? nearest.dir : null;
}

// New end point for `end` (a point on the box), or null when it already sits on the outline.
function anchored(shape, box, end, dir) {
  const hit = outlineHit(shape, box, end, dir);
  if (hit === null || Math.hypot(hit.x - end.x, hit.y - end.y) < MIN_MOVE) return null;
  return { x: round2(hit.x), y: round2(hit.y) };
}

// `end` is the route's first or last point, `next` the one after it (towards the middle).
function moveEnd(points, atStart, shape, box) {
  const end = atStart ? points[0] : points.at(-1);
  const next = atStart ? points[1] : points.at(-2);
  const dir = inwardStep(box, end);
  if (dir === null) return points;
  const hit = anchored(shape, box, end, dir);
  if (hit === null) return points;
  // The end segment normally runs along the step into the box: slide the end along it.
  const along = dir.dx !== 0 ? Math.abs(next.y - end.y) <= AXIS_TOLERANCE : Math.abs(next.x - end.x) <= AXIS_TOLERANCE;
  if (along) return atStart ? [hit, ...points.slice(1)] : [...points.slice(0, -1), hit];
  // Otherwise keep the route and add a short spur from the box side to the outline.
  return atStart ? [hit, ...points] : [...points, hit];
}

/**
 * Edge route with both ends on the drawn outline of their nodes. `ends` is
 * { from, to } = { shape, box } for each end (groups are plain 'rect' boxes).
 */
export function anchorRoute(points, ends) {
  if (points.length < 2) return points;
  const start = moveEnd(points, true, ends.from.shape, ends.from.box);
  return moveEnd(start, false, ends.to.shape, ends.to.box);
}

/** Geometry with every graph edge's route anchored to the outlines. Other fields are shared, not copied. */
export function anchorEdges(geometry) {
  const boxes = new Map([...geometry.groups.map((g) => [g.id, { shape: 'rect', box: g }]), ...geometry.nodes.map((n) => [n.id, { shape: n.shape, box: n }])]);
  return {
    ...geometry,
    edges: geometry.edges.map((e) => ({ ...e, points: anchorRoute(e.points, { from: boxes.get(e.from), to: boxes.get(e.to) }) })),
  };
}

// ---- path data ----------------------------------------------------------------

const unit = (a, b) => {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  return { x: (b.x - a.x) / len, y: (b.y - a.y) / len, len };
};

function dropRepeats(points) {
  return points.filter((p, i) => i === 0 || Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y) > 1e-6);
}

/** SVG path data through `points`, corners rounded with a quadratic curve of radius `r` (shortened on short segments). */
export function roundedPath(points, r = EDGE_CORNER_RADIUS) {
  const pts = dropRepeats(points);
  if (pts.length === 0) return '';
  let d = `M${num(pts[0].x)} ${num(pts[0].y)}`;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    const next = pts[i + 1];
    if (!next) {
      d += `L${num(p.x)} ${num(p.y)}`;
      break;
    }
    const inn = unit(pts[i - 1], p);
    const out = unit(p, next);
    const turns = Math.abs(inn.x * out.y - inn.y * out.x) > 1e-6;
    if (!turns) {
      d += `L${num(p.x)} ${num(p.y)}`;
      continue;
    }
    const cut = Math.min(r, inn.len / 2, out.len / 2);
    d += `L${num(p.x - inn.x * cut)} ${num(p.y - inn.y * cut)}Q${num(p.x)} ${num(p.y)} ${num(p.x + out.x * cut)} ${num(p.y + out.y * cut)}`;
  }
  return d;
}

// ---- Bézier routes ------------------------------------------------------------

export const FALLBACK_CORNER_RADIUS = 24; // corner radius on routes too long for one curve
const BEND_PULL = 0.6; // how far along each leg of an L its control points sit

const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const point = (p) => ({ x: round2(p.x), y: round2(p.y) });
const pair = (p) => `${num(p.x)} ${num(p.y)}`;

function cubicAt(p0, c1, c2, p3, t) {
  const u = 1 - t;
  const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return { x: w[0] * p0.x + w[1] * c1.x + w[2] * c2.x + w[3] * p3.x, y: w[0] * p0.y + w[1] * c1.y + w[2] * c2.y + w[3] * p3.y };
}

// The route without repeated points, nor points in the middle of a straight run.
function corners(points) {
  const pts = dropRepeats(points);
  return pts.filter((p, i) => {
    if (i === 0 || i === pts.length - 1) return true;
    const inn = unit(pts[i - 1], p);
    const out = unit(p, pts[i + 1]);
    return Math.abs(inn.x * out.y - inn.y * out.x) > 1e-6 || inn.x * out.x + inn.y * out.y < 0;
  });
}

// The point half way along the polyline.
function halfway(pts) {
  const lens = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y));
  let left = lens.reduce((a, b) => a + b, 0) / 2;
  for (let i = 0; i < lens.length; i++) {
    if (left <= lens[i]) return lerp(pts[i], pts[i + 1], left / lens[i]);
    left -= lens[i];
  }
  return pts.at(-1);
}

/**
 * Path data for a graph edge's anchored route, drawn as Bézier curves, and
 * `mid`, the point half way along it (where its label plate is centred).
 * A straight run is a line; an L is one cubic bend; a Z is one cubic whose
 * control points are its two inner corners, so it stays inside the channel
 * between the layers; a longer route keeps its waypoints and rounds its
 * corners at FALLBACK_CORNER_RADIUS. Each curve leaves along the first segment
 * and arrives along the last, so the arrow heads keep their direction.
 */
export function curvedRoute(points) {
  const pts = corners(points);
  if (pts.length < 2) return { d: pts.length ? `M${pair(pts[0])}` : '', mid: pts.length ? point(pts[0]) : null };
  const [p0, p1, p2, p3] = pts;
  if (pts.length === 2) return { d: `M${pair(p0)}L${pair(p1)}`, mid: point(lerp(p0, p1, 0.5)) };
  if (pts.length === 3) {
    const c1 = lerp(p0, p1, BEND_PULL);
    const c2 = lerp(p2, p1, BEND_PULL);
    return { d: `M${pair(p0)}C${pair(c1)} ${pair(c2)} ${pair(p2)}`, mid: point(cubicAt(p0, c1, c2, p2, 0.5)) };
  }
  if (pts.length === 4) return { d: `M${pair(p0)}C${pair(p1)} ${pair(p2)} ${pair(p3)}`, mid: point(cubicAt(p0, p1, p2, p3, 0.5)) };
  return { d: roundedPath(pts, FALLBACK_CORNER_RADIUS), mid: point(halfway(pts)) };
}
