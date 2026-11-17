// Where the `diagram` kind's parts go (diagram.mjs registers it): four designed arrangements, never a general graph
// layout (a diagram that needs one is make-diagram's). `centres` places n equal boxes in a row, a column, a cycle (on the
// ellipse inside the area, from the top, clockwise) or a hub (the first in the middle, the rest on the ellipse);
// `fitDiagram` picks the one label size for nodes and edge labels: the largest of the look's steps at which every label
// holds in its lines and the boxes fit; `edgeRoutes` runs each edge from box edge to box edge, bowed round any node in its
// way; `labelPlates` puts each edge label on its arrow, clear of every node. Pure and DOM-free: text is measured by the
// `measure` given (the page's, or an estimate in the kind's review).
import { layoutText } from '../text/layout.mjs';
import { sizeAt, setCase, overlaps } from './shared.mjs';

const HALF = 2;
const ROUND = 1000; // edge points rounded to 1/1000 px
const BOW_TRIES = Object.freeze([1, -1, 2, -2, 3, -3]); // bows tried, in node heights off the straight line
const CURVE_SAMPLES = 24; // points along an edge checked against the nodes it must miss
const LABEL_SHIFTS = Object.freeze([0, 1, -1, 2, -2]); // edge label shifts tried, in plate heights off its arrow
const TALL_GAP_SHARE = 0.22; // a column's gap at most this share of the area height (no empty band, look bar 2)
const RING_SHARE = 0.34; // a ring node's label width, as a share of the area width
const COLUMN_SHARE = 0.72; // a column node's label width, as a share of the area width
const EPS = 1e-6;
const NO_WRAP = 1e6; // px: an edge label is one line

const rounded = (v) => Math.round(v * ROUND) / ROUND;

/** Centres of n boxes of size [w, h] in `area` ({ x, y, w, h }) for `layout`; `gap` spaces a row or a column. */
export function centres(layout, n, area, [w, h], gap) {
  const cx = area.x + area.w / HALF, cy = area.y + area.h / HALF;
  if (layout === 'row') {
    const left = cx - (n * w + (n - 1) * gap) / HALF + w / HALF;
    return Array.from({ length: n }, (_, k) => [left + k * (w + gap), cy]);
  }
  if (layout === 'column') {
    const top = cy - (n * h + (n - 1) * gap) / HALF + h / HALF;
    return Array.from({ length: n }, (_, k) => [cx, top + k * (h + gap)]);
  }
  const ring = layout === 'hub' ? n - 1 : n;
  const rx = (area.w - w) / HALF, ry = (area.h - h) / HALF;
  const around = Array.from({ length: ring }, (_, k) => {
    const a = -Math.PI / HALF + (HALF * Math.PI * k) / ring;
    return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)];
  });
  return layout === 'hub' ? [[cx, cy], ...around] : around;
}

/** Where the line from the centre of `box` towards `target` leaves the box, `margin` px further out. */
export function edgePoint([x, y, w, h], [tx, ty], margin) {
  const cx = x + w / HALF, cy = y + h / HALF;
  const dx = tx - cx, dy = ty - cy;
  const len = Math.hypot(dx, dy);
  if (len < EPS) return [rounded(cx), rounded(cy)];
  const t = Math.min(dx === 0 ? Infinity : w / HALF / Math.abs(dx), dy === 0 ? Infinity : h / HALF / Math.abs(dy));
  return [rounded(cx + dx * t + (dx / len) * margin), rounded(cy + dy * t + (dy / len) * margin)];
}

export const boxAt = ([cx, cy], [w, h]) => [cx - w / HALF, cy - h / HALF, w, h];

// The widest a node's label may be set for `layout` in `area` with n nodes and the row gap.
function labelWidth(layout, n, area, gap, pad) {
  if (layout === 'row') return (area.w - (n - 1) * gap) / n - HALF * pad;
  if (layout === 'column') return area.w * COLUMN_SHARE - HALF * pad;
  return area.w * RING_SHARE - HALF * pad;
}

// Does every box of a placement lie inside the area and keep `gap` from every other?
function placementFits(boxes, area, gap) {
  const inside = boxes.every(([x, y, w, h]) => x >= area.x - EPS && y >= area.y - EPS && x + w <= area.x + area.w + EPS && y + h <= area.y + area.h + EPS);
  const grown = boxes.map(([x, y, w, h]) => [x - gap / HALF, y - gap / HALF, w + gap, h + gap]);
  return inside && grown.every((a, i) => grown.every((b, j) => i >= j || !overlaps(a, b)));
}

// The gap a row or a column spreads to: at least `need`, more where the area has room, a column at most
// TALL_GAP_SHARE of the height and a row at most one box.
function spread(layout, n, area, [w, h], need) {
  if (n < HALF) return need;
  if (layout === 'row') return Math.max(need, Math.min((area.w - n * w) / (n - 1), w));
  if (layout === 'column') return Math.max(need, Math.min((area.h - n * h) / (n - 1), TALL_GAP_SHARE * area.h));
  return need;
}

// The sets of every label at `size` px: node labels wrapped to `maxWidth`, edge labels on one line.
function setLabels(shot, env, size, maxWidth) {
  const { look, unit, measure } = env;
  const font = (role) => ({ ...look.fonts[role], size, tracking: look.tracking(size / unit, role) });
  const nodeFont = font('display'), edgeFont = font('text');
  const nodes = shot.nodes.map((n) => layoutText({ text: setCase(look, 'display', n.label), font: nodeFont, maxWidth, measure }));
  const edges = (shot.edges ?? []).map((e) => (e.label === undefined ? null : layoutText({ text: setCase(look, 'text', e.label), font: edgeFont, maxWidth: NO_WRAP, measure })));
  return { nodeFont, edgeFont, nodes, edges };
}

// One try at `size`: the labels, the box size and the centres, and whether it fits (labels in their lines, boxes inside).
function tryAt(shot, env, size) {
  const { data, area, unit, layout } = env;
  const pad = data.pad * unit, minGap = data.gap * unit;
  const n = shot.nodes.length;
  const max = labelWidth(layout, n, area, minGap, pad);
  const sets = setLabels(shot, env, size, Math.max(1, max));
  const held = sets.nodes.every((l) => l.lines.length <= data.maxLines && l.width <= max + EPS);
  const box = [Math.max(...sets.nodes.map((l) => l.width)) + HALF * pad, Math.max(...sets.nodes.map((l) => l.height)) + HALF * pad];
  // an edge label sits on its arrow where the gap holds it and moves off it (beside the nodes) where it does not
  // (labelPlates), so no gap is widened for a label and seven short nodes still fit a row or a column
  const need = minGap;
  const gap = spread(layout, n, area, box, need);
  const at = centres(layout, n, area, box, gap);
  const boxes = at.map((c) => boxAt(c, box));
  return { size, ...sets, box, boxes, gap, fits: held && placementFits(boxes, area, Math.min(gap, need)) };
}

/**
 * The diagram's one label size and its placement: the largest of `steps` (1-based, at or above `floorStep`, and at most
 * `maxSize` px when a title must stay three times it) at which it fits; else the smallest of them, with fits false.
 * env: { look, data, area, unit, measure, layout, steps, floorStep, maxSize }.
 */
export function fitDiagram(shot, env) {
  const sizes = [...new Set(env.steps)].filter((s) => s >= env.floorStep).map((s) => sizeAt(env.look, s, env.unit))
    .filter((s) => s <= env.maxSize + EPS).sort((a, b) => b - a);
  const tries = (sizes.length ? sizes : [sizeAt(env.look, env.floorStep, env.unit)]).map((s) => tryAt(shot, env, s));
  return tries.find((t) => t.fits) ?? tries.at(-1);
}

// A point of the quadratic from p0 through control c to p1 at t.
const quad = (p0, c, p1, t) => [0, 1].map((i) => (1 - t) ** HALF * p0[i] + HALF * (1 - t) * t * c[i] + t ** HALF * p1[i]);

// The edge from box a to box b bowed by `bow` px off the straight line: { from, control, to }.
function bowed(a, b, bow, margin) {
  const ca = [a[0] + a[2] / HALF, a[1] + a[3] / HALF], cb = [b[0] + b[2] / HALF, b[1] + b[3] / HALF];
  const len = Math.hypot(cb[0] - ca[0], cb[1] - ca[1]) || 1;
  const control = [(ca[0] + cb[0]) / HALF - ((cb[1] - ca[1]) / len) * bow, (ca[1] + cb[1]) / HALF + ((cb[0] - ca[0]) / len) * bow];
  const from = edgePoint(a, bow === 0 ? cb : control, margin), to = edgePoint(b, bow === 0 ? ca : control, margin);
  return { from, control: bow === 0 ? null : control.map(rounded), to };
}

const pointsOf = (r) => Array.from({ length: CURVE_SAMPLES + 1 }, (_, i) => (r.control ? quad(r.from, r.control, r.to, i / CURVE_SAMPLES) : [0, 1].map((k) => r.from[k] + ((r.to[k] - r.from[k]) * i) / CURVE_SAMPLES)));
const inBox = ([x, y], [bx, by, bw, bh]) => x > bx && x < bx + bw && y > by && y < by + bh;

/** Each edge as { from, control (null for a straight edge), to, d, mid }: straight where nothing is in its way, else
 *  bowed round the nodes it would cross by the first of BOW_TRIES node heights that clears them. */
export function edgeRoutes(shot, boxes, margin) {
  const index = new Map(shot.nodes.map((n, i) => [n.id, i]));
  return (shot.edges ?? []).map((e) => {
    const [i, j] = [index.get(e.from), index.get(e.to)];
    const others = boxes.filter((_, k) => k !== i && k !== j);
    const clear = (r) => pointsOf(r).every((p) => !others.some((b) => inBox(p, b)));
    const h = boxes[i][3];
    const route = [0, ...BOW_TRIES.map((k) => k * h)].map((bow) => bowed(boxes[i], boxes[j], bow, margin)).find(clear) ?? bowed(boxes[i], boxes[j], 0, margin);
    const fmt = (p) => `${p[0]} ${p[1]}`;
    const d = route.control ? `M${fmt(route.from)}Q${fmt(route.control)} ${fmt(route.to)}` : `M${fmt(route.from)}L${fmt(route.to)}`;
    const mid = route.control ? quad(route.from, route.control, route.to, 1 / HALF) : [(route.from[0] + route.to[0]) / HALF, (route.from[1] + route.to[1]) / HALF];
    return { ...route, d, mid };
  });
}

const insideArea = ([x, y, w, h], a) => x >= a.x - EPS && y >= a.y - EPS && x + w <= a.x + a.w + EPS && y + h <= a.y + a.h + EPS;

/** Each edge label's plate box ([x, y, w, h]: centred on its arrow; else shifted off it across the arrow, by plate
 *  heights and then clear past the nodes beside it) inside `area` and clear of every node and earlier plate, or null: an
 *  edge with no label, or a label no place holds (the caller says it left it out). */
export function labelPlates(routes, sets, boxes, platePad, area) {
  const placed = [];
  return routes.map((r, j) => {
    const l = sets[j];
    if (!l) return null;
    const w = l.width + HALF * platePad, h = l.height + HALF * platePad;
    const dx = r.to[0] - r.from[0], dy = r.to[1] - r.from[1];
    const len = Math.hypot(dx, dy) || 1;
    const [nx, ny] = [-dy / len, dx / len];
    const past = boxes.reduce((m, b) => Math.max(m, Math.abs(nx) * b[2] + Math.abs(ny) * b[3]), 0) / HALF + (Math.abs(nx) * w + Math.abs(ny) * h) / HALF + platePad;
    const shifts = [...LABEL_SHIFTS.map((k) => k * h), past, -past];
    const tries = shifts.map((s) => [r.mid[0] + nx * s - w / HALF, r.mid[1] + ny * s - h / HALF, w, h]);
    const plate = tries.find((p) => insideArea(p, area) && ![...boxes, ...placed].some((b) => overlaps(p, b))) ?? null;
    if (plate) placed.push(plate);
    return plate;
  });
}
