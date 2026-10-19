// heatmap as a surface and donut as an extruded ring.
//
// The heatmap uses the terrain grid convention the runtime's picker reads: each data cell sits on every 5th
// vertex (a one-wide axis pads to two vertices), and the cells in between take their nearest cell's height,
// so a plateau is one cell. Height is value / max, from the floor; a value below zero cannot be drawn on a
// surface (the reader rejects it). The donut is one thick tube arc per segment, in row order from 12 o'clock.
import { displayValue, groupColour } from '../lib/palette.mjs';
import { sortedOf } from './dashboard-data.mjs';
import { AxisError, focusCollector, legendOf, thinned, WIDTH } from './dashboard-frame.mjs';

// A surface carries 25 heights per cell: past this many cells its page is far over the page cap anyway, so refuse
// before building a grid of millions of numbers.
const MAX_CELLS = 20000;
const UPSAMPLE = 5; // the runtime's picker assumes this; see surfaceCellAt in template/runtime/render.js
const RELIEF = 4.5;
const UNIT = 1.5; // world size per data column or row
const X_RANGE = [6, WIDTH];
const Z_RANGE = [4, 9];
const LABEL_GAP = 0.8;
const TICK_LABEL = 0.45;
const TITLE_LABEL = 0.55;
// A sequential ramp that follows the theme: the accent at 25, 45, 70 and 100% over white.
const BANDS = [[0.25, 0.25], [0.5, 0.45], [0.75, 0.7], [1, 1]].map(([below, share]) => ({ below, colour: { base: '#ffffff', tint: 'accent', share } }));

const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));
const gridSize = (n) => (n === 1 ? 2 : (n - 1) * UPSAMPLE + 1);
const cellOf = (vertex, n) => (n === 1 ? 0 : Math.min(n - 1, Math.max(0, Math.round(vertex / UPSAMPLE))));

/** The part for a heatmap: x categories along x, y categories along z, a cell per row. */
export function heatmapPart(model, { units }) {
  const { roles, points } = model;
  const groups = [{ name: roles.value, colour: 'accent' }];
  if (points.length === 0) return { groups, items: [], batches: [], tubes: [], surfaces: [], labels: [], focus: [], categories: { x: true, color: true } };
  const xs = sortedOf(points.map((p) => p.x)); // both axes ascending, as the 2D chart's band scales are
  const ys = sortedOf(points.map((p) => p.y));
  const [T, G] = [xs.length, ys.length];
  if (T * G > MAX_CELLS) throw new AxisError(`${roles.x} has ${T} values and ${roles.y} has ${G}, which makes ${T * G} heatmap cells; a lift takes at most ${MAX_CELLS} (x values times y values); aggregate or filter in SQL`);
  const max = Math.max(0, ...points.map((p) => p.value));
  const cells = new Array(T * G).fill(-1);
  const levels = new Array(T * G).fill(0);
  const items = points.map((p, idx) => {
    const cell = ys.indexOf(p.y) * T + xs.indexOf(p.x);
    cells[cell] = idx;
    levels[cell] = max > 0 ? p.value / max : 0;
    return { id: `i${idx}`, label: `${p.x} · ${p.y}`, group: 0, value: p.value, display: displayValue(p.value, units) };
  });
  const [sx, sz] = [clamp(T * UNIT, X_RANGE), clamp(G * UNIT, Z_RANGE)];
  const [nx, nz] = [gridSize(T), gridSize(G)];
  const heights = Array.from({ length: nx * nz }, (_, v) => levels[cellOf(Math.floor(v / nx), G) * T + cellOf(v % nx, T)]);
  const xAt = (ti) => (T === 1 ? 0 : (ti / (T - 1) - 0.5) * sx);
  const zAt = (gi) => (G === 1 ? 0 : (gi / (G - 1) - 0.5) * sz);
  const [xFocus, yFocus, itemFocus] = [focusCollector(), focusCollector(), focusCollector()];
  points.forEach((p, idx) => {
    const spot = [xAt(xs.indexOf(p.x)), levels[ys.indexOf(p.y) * T + xs.indexOf(p.x)] * RELIEF, zAt(ys.indexOf(p.y))];
    xFocus.add(p.x, spot);
    yFocus.add(p.y, spot);
    itemFocus.add(items[idx].label, spot);
  });
  const labels = [
    ...thinned(xs.map((text, i) => ({ text, x: xAt(i) }))).map((t) => ({ text: t.text, at: [t.x, 0.1, sz / 2 + LABEL_GAP], size: TICK_LABEL })),
    ...ys.map((text, i) => ({ text, at: [-sx / 2 - LABEL_GAP, 0.1, zAt(i)], size: TICK_LABEL })),
    { text: roles.x, at: [0, 0.1, sz / 2 + 2 * LABEL_GAP], size: TITLE_LABEL },
    { text: roles.y, at: [-sx / 2 - 3 * LABEL_GAP, 0.1, 0], size: TITLE_LABEL },
  ];
  return {
    groups,
    items,
    batches: [],
    tubes: [],
    surfaces: [{ id: 's0', nx, nz, size: [sx, sz, RELIEF], heights, bands: BANDS, cells }],
    labels,
    focus: [xFocus.entries(), yFocus.entries(), itemFocus.entries()],
    categories: { x: true, color: true },
  };
}

// ---- donut -----------------------------------------------------------------

const RING_RADIUS = 3.2;
const SEGMENT_RADIUS = 0.55;
const GAP = 0.035; // radians between two segments
const ARC_STEP = 0.2; // radians per tube point
const NAME_RADIUS = RING_RADIUS + SEGMENT_RADIUS + 0.9;
const NAME_LABEL = 0.5;
const FLOOR_THICKNESS = 0.1;
const TAU = Math.PI * 2;

const onRing = (angle, radius, y) => [radius * Math.cos(angle), y, radius * Math.sin(angle)];

// The points of the arc from `a0` to `a1` (radians, at least two).
function arc(a0, a1) {
  const n = Math.max(2, Math.ceil((a1 - a0) / ARC_STEP) + 1);
  return Array.from({ length: n }, (_, k) => onRing(a0 + ((a1 - a0) * k) / (n - 1), RING_RADIUS, SEGMENT_RADIUS));
}

/** The part for a donut: one arc per row, its angle the row's share of the total, in name order. A zero row has no arc. */
export function donutPart(model, { units }) {
  const { points, groupNames } = model;
  const total = points.reduce((n, p) => n + p.y, 0);
  const groupOf = new Map(groupNames.map((n, i) => [n, i]));
  const [xFocus, itemFocus] = [focusCollector(), focusCollector()];
  const tubes = [];
  const labels = [];
  // Items stay in row order; the arcs follow the legend (name) order, rows of one name in row order.
  const arcOrder = points.map((_, idx) => idx).sort((a, b) => groupOf.get(points[a].x) - groupOf.get(points[b].x) || a - b);
  let angle = -Math.PI / 2;
  for (const idx of arcOrder) {
    const p = points[idx];
    const span = total > 0 ? (p.y / total) * TAU : 0;
    if (span > 0) {
      const inset = span > 4 * GAP ? GAP / 2 : 0;
      tubes.push({ id: `t${idx}`, points: arc(angle + inset, angle + span - inset), radius: SEGMENT_RADIUS, colour: groupColour(groupOf.get(p.x)), item: idx });
      const mid = onRing(angle + span / 2, NAME_RADIUS, SEGMENT_RADIUS);
      labels.push({ text: p.x, at: mid, size: NAME_LABEL });
      xFocus.add(p.x, mid);
      itemFocus.add(p.x, mid);
    }
    angle += span;
  }
  const items = points.map((p, idx) => ({ id: `i${idx}`, label: p.x, group: groupOf.get(p.x), value: p.y, display: displayValue(p.y, units) }));
  const side = 2 * (NAME_RADIUS + 0.4);
  const floor = { id: 'b0', shape: 'box', colour: 'line', emissive: null, flat: false, instances: [[0, -FLOOR_THICKNESS / 2, 0, side, FLOOR_THICKNESS, side, -1]] };
  return {
    groups: legendOf(groupNames), items, batches: points.length === 0 ? [] : [floor], tubes, surfaces: [], labels,
    focus: [xFocus.entries(), [], itemFocus.entries()],
    categories: { x: true, color: false },
  };
}
