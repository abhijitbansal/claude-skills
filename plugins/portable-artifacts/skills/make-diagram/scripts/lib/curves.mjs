// How each graph edge is drawn: a Bézier curve (edges.mjs curvedRoute) with its
// label plate on the curve, but only when that is safe; otherwise exactly the
// old drawing, the orthogonal route with radius-6 corners and ELK's own plate.
// render.mjs draws what this decides and lint.mjs checks the same plates.
//
// A curve is kept only when it stays CLEARANCE px from every node it does not
// join and from every plate, and its plate (if any) finds a place on it, tried
// at PLATE_FRACTIONS of its length, clear of nodes, plates and other wires.
// Edges are decided in index order. An edge not yet decided could still end up
// either way, so it counts with both its wires and with ELK's plate box; that
// way the old drawing an edge falls back to never collides with a decision
// already made.
import { curvedRoute, roundedPath } from './edges.mjs';
import { MARKER_SIZE } from './svg.mjs';

export const CLEARANCE = 4; // px: between a curve or a moved plate and anything it must not touch
export const PLATE_FRACTIONS = [0.5, 0.4, 0.6, 0.3, 0.7]; // of the curve's length, in the order tried
const STEP = 2; // px: the most a sampled wire moves between two samples
const ARROW_ZONE = MARKER_SIZE + 2; // px at an arrowed end that a plate must leave uncovered

const round2 = (v) => Math.round(v * 100) / 100;

// ---- sampling -------------------------------------------------------------------

function bezier(pts, t) {
  let p = pts;
  while (p.length > 1) p = p.slice(1).map((b, i) => ({ x: p[i].x + (b.x - p[i].x) * t, y: p[i].y + (b.y - p[i].y) * t }));
  return p[0];
}

const longestLeg = (pts) => Math.max(...pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y)));

/** A wire's path data (M, L, Q, C) as points at most STEP px apart, with the length run at each point and a bounding box. */
function sampled(d) {
  const pts = [];
  let cur = null;
  for (const [, cmd, args] of d.matchAll(/([MLQC])([^MLQC]*)/g)) {
    const n = args.trim().split(/[\s,]+/).map(Number);
    const ctrl = [];
    for (let i = 0; i < n.length; i += 2) ctrl.push({ x: n[i], y: n[i + 1] });
    if (cmd === 'M') {
      cur = ctrl[0];
      pts.push(cur);
      continue;
    }
    const piece = [cur, ...ctrl];
    // a degree-n Bézier moves at most n times its longest control leg per unit of t
    const k = Math.max(1, Math.ceil(((piece.length - 1) * longestLeg(piece)) / STEP));
    for (let i = 1; i <= k; i++) pts.push(bezier(piece, i / k));
    cur = ctrl.at(-1);
  }
  const run = [0];
  for (let i = 1; i < pts.length; i++) run.push(run[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const bbox = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
  return { pts, run, bbox };
}

function pointAt(wire, fraction) {
  const want = fraction * wire.run.at(-1);
  const i = Math.max(1, wire.run.findIndex((l) => l >= want));
  const span = wire.run[i] - wire.run[i - 1];
  const t = span === 0 ? 0 : (want - wire.run[i - 1]) / span;
  const [a, b] = [wire.pts[i - 1], wire.pts[i]];
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

// ---- geometry tests ---------------------------------------------------------------

const grow = (r, by) => ({ x: r.x - by, y: r.y - by, width: r.width + 2 * by, height: r.height + 2 * by });
const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const strictlyIn = (p, r) => p.x > r.x && p.x < r.x + r.width && p.y > r.y && p.y < r.y + r.height;
const within = (inner, outer) => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;

/** Whether some point of `wire` comes closer than CLEARANCE to `rect`. */
function wireNear(wire, rect) {
  const zone = grow(rect, CLEARANCE);
  return overlaps(wire.bbox, zone) && wire.pts.some((p) => strictlyIn(p, zone));
}

// A node's drawn extent: its box, and for dots and choices the label beside it.
const extents = (n) => (n.labelBox ? [n, n.labelBox] : [n]);

// ---- the decision -------------------------------------------------------------------

function candidates(e) {
  const d = roundedPath(e.points);
  const classic = { d, wire: sampled(d), plate: e.label ?? null, curved: false };
  if (e.from === e.to) return { classic, curve: null }; // a self loop keeps its small corners and its plate beside the loop
  const curve = curvedRoute(e.points).d;
  return { classic, curve: { d: curve, wire: sampled(curve) } };
}

// Where the plate can sit on `wire`, or null when no tried place is clear.
function placePlate(label, wire, both, obstacles) {
  const len = wire.run.at(-1);
  const ends = wire.pts.filter((_, i) => wire.run[i] >= len - ARROW_ZONE || (both && wire.run[i] <= ARROW_ZONE));
  for (const f of PLATE_FRACTIONS) {
    const c = pointAt(wire, f);
    const plate = { ...label, x: round2(c.x - label.width / 2), y: round2(c.y - label.height / 2) };
    const zone = grow(plate, CLEARANCE);
    if (!within(plate, obstacles.canvas)) continue;
    if (ends.some((p) => strictlyIn(p, plate))) continue;
    if (obstacles.rects.some((r) => overlaps(zone, r))) continue;
    if (obstacles.wires.some((w) => overlaps(w.bbox, zone) && w.pts.some((p) => strictlyIn(p, zone)))) continue;
    return plate;
  }
  return null;
}

/**
 * How every edge of `geometry` (routes already anchored, anchorEdges) is drawn,
 * in edge order: { id, d, plate, curved }. `plate` is the label box as drawn
 * (with its text) or null; `curved` is false for the old drawing.
 */
export function drawnEdges(geometry) {
  const canvas = geometry.drawing ?? { x: 0, y: 0, width: geometry.width, height: geometry.height };
  const nodeRects = new Map(geometry.nodes.map((n) => [n.id, extents(n)]));
  const options = geometry.edges.map(candidates);
  const decided = options.map((o) => (o.curve ? null : o.classic)); // self loops are decided from the start

  // What edge `i` must keep clear of: every other edge as decided, or both its drawings and ELK's plate while undecided.
  const others = (i) => {
    const wires = [];
    const plates = [];
    options.forEach((o, k) => {
      if (k === i) return;
      const fixed = decided[k];
      if (fixed) {
        wires.push(fixed.wire);
        if (fixed.plate) plates.push(fixed.plate);
        return;
      }
      wires.push(o.classic.wire, o.curve.wire);
      if (o.classic.plate) plates.push(o.classic.plate);
    });
    return { wires, plates };
  };

  geometry.edges.forEach((e, i) => {
    if (decided[i]) return;
    const { classic, curve } = options[i];
    const { wires, plates } = others(i);
    const foreignNodes = geometry.nodes.filter((n) => n.id !== e.from && n.id !== e.to).flatMap(extents);
    const ownLabels = geometry.nodes.filter((n) => (n.id === e.from || n.id === e.to) && n.labelBox).map((n) => n.labelBox);
    const clear = ![...foreignNodes, ...ownLabels, ...plates].some((r) => wireNear(curve.wire, r));
    let plate = null;
    if (clear && e.label) {
      const rects = [...[...nodeRects.values()].flat(), ...plates];
      plate = placePlate(e.label, curve.wire, e.both, { canvas, rects, wires });
    }
    decided[i] = clear && (plate || !e.label) ? { d: curve.d, wire: curve.wire, plate, curved: true } : classic;
  });

  return geometry.edges.map((e, i) => ({ id: e.id, d: decided[i].d, plate: decided[i].plate, curved: decided[i].curved }));
}
