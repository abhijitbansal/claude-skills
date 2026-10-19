// Terrain: a (group x t) grid of values, upsampled 5x with Catmull-Rom (clamped to 0..1; it passes through every data
// cell) into one height-field surface. The data sits inside a ring of empty cells at height 0, so the land slopes down
// to the sea on every side and reads as an island. Heights are normalized to 0..1 (the largest value is 1); bands and
// sea level are in the same units.
import { emptyGraph, finalizeGraph, tableFallback } from '../lib/graph.mjs';
import { compareT, groupIndex, groupsFrom, itemsFrom } from '../lib/palette.mjs';
import { InternalError } from '../lib/internal-error.mjs';
import { clearPosition, ringCandidates } from '../lib/views.mjs';

export const UPSAMPLE = 5;
export const SEA_LEVEL = 0.12;
export const BANDS = [
  { below: 0.2, colour: '#d8c38a' }, // sand
  { below: 0.55, colour: '#6b9a4f' }, // grass
  { below: 0.82, colour: '#8a8178' }, // rock
  { below: 1, colour: '#f4f6f8' }, // snow (heights at or above the last `below` use the last band)
];
const RELIEF = 4.5; // world height of normalized 1
const UNIT = 1.5; // world size per data column or row...
const X_RANGE = [6, 20]; // ...of the data, kept within these
const Z_RANGE = [4, 14];
const MAX_PITCH = 2.5; // a tiny grid does not stretch its cells past this
const LABEL_SIZE = 0.6;
const LABEL_INSET = 0.4; // of a cell pitch, in from the edge of the surface
const MAX_T_LABELS = 6;
const FOCUS_MIN = 12;
const FOCUS_PER_UNIT = 1.05; // of the surface's width: authored for a square viewport
const CELL_FOCUS = 9;
const FOCUS_ELEVATIONS = [30, 40, 50, 60, 70]; // degrees above the floor, lowest first
const FOCUS_SKEW = 0.3;

const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));
const keyOfT = (t) => `${typeof t}:${t}`;
const pitchOf = (n, range) => Math.min(MAX_PITCH, clamp(n * UNIT, range) / Math.max(n - 1, 1));

// Uniform Catmull-Rom through p1 (t = 0) and p2 (t = 1); exactly p1 at t = 0.
const spline = (p0, p1, p2, p3, t) => p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));

// Bicubic Catmull-Rom sample of a rows x cols grid at (gz, tx) in cell units, indices clamped at the edges.
function sample(values, rows, cols, gz, tx) {
  const x1 = Math.min(Math.floor(tx), cols - 1);
  const z1 = Math.min(Math.floor(gz), rows - 1);
  const fx = tx - x1;
  const fz = gz - z1;
  const at = (z, x) => values[Math.min(rows - 1, Math.max(0, z)) * cols + Math.min(cols - 1, Math.max(0, x))];
  const across = (z) => spline(at(z, x1 - 1), at(z, x1), at(z, x1 + 1), at(z, x1 + 2), fx);
  return spline(across(z1 - 1), across(z1), across(z1 + 1), across(z1 + 2), fz);
}

function upsample(values, rows, cols) {
  const nx = (cols - 1) * UPSAMPLE + 1;
  const nz = (rows - 1) * UPSAMPLE + 1;
  const heights = new Array(nx * nz);
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      heights[iz * nx + ix] = Math.min(1, Math.max(0, sample(values, rows, cols, iz / UPSAMPLE, ix / UPSAMPLE)));
    }
  }
  return { nx, nz, heights };
}

// values and cells over the padded grid: (groups + 2) rows by (ts + 2) columns, data cell (gi, ti) at (gi + 1, ti + 1);
// the ring round it has value 0 and no item.
function place(rows, groupCount, ts) {
  const cols = ts.length + 2;
  const tIndex = new Map(ts.map((t, i) => [keyOfT(t), i]));
  const gi = groupIndex(rows);
  const values = new Array((groupCount + 2) * cols).fill(0);
  const cells = new Array((groupCount + 2) * cols).fill(-1);
  rows.forEach((r, i) => {
    if (r.t === undefined) throw new InternalError('terrain needs t on every row');
    const cell = (gi.get(r.group) + 1) * cols + tIndex.get(keyOfT(r.t)) + 1;
    if (cells[cell] !== -1) throw new InternalError('terrain needs exactly one row per group and t');
    cells[cell] = i;
    values[cell] = r.value;
  });
  return { values, cells };
}

// World position of data column ti and data row gi: the surface is (columns + 1) pitches wide, the data one pitch in.
function frame(groupCount, T, [sx, sz]) {
  return {
    xOf: (ti) => ((ti + 1) / (T + 1) - 0.5) * sx,
    zOf: (gi) => ((gi + 1) / (groupCount + 1) - 0.5) * sz,
    pitchX: sx / (T + 1),
    pitchZ: sz / (groupCount + 1),
  };
}

function buildLabels(groups, ts, size) {
  const [sx, sz] = size;
  const { xOf, zOf, pitchX, pitchZ } = frame(groups.length, ts.length, size);
  const out = groups.map((g, i) => ({ text: g.name, at: [-sx / 2 + LABEL_INSET * pitchX, 0.1, zOf(i)], size: LABEL_SIZE }));
  const shown = Math.min(ts.length, MAX_T_LABELS);
  for (let k = 0; k < shown; k++) {
    const ti = shown === 1 ? 0 : Math.round((k * (ts.length - 1)) / (shown - 1));
    out.push({ text: String(ts[ti]), at: [xOf(ti), 0.1, sz / 2 - LABEL_INSET * pitchZ], size: LABEL_SIZE });
  }
  return out;
}

// Views from the open side (the near edge for a front row, the far one for a back row), then down the rows from either
// end, lowest elevation first; the first whose line of sight crosses no cell but those `skip` leaves out.
function buildFocus(rows, groups, ts, values, cells, size) {
  const T = ts.length;
  const cols = T + 2;
  const { xOf, zOf, pitchX, pitchZ } = frame(groups.length, T, size);
  const cellBoxes = [];
  for (let gi = 0; gi < groups.length; gi++) {
    for (let ti = 0; ti < T; ti++) {
      const height = values[(gi + 1) * cols + ti + 1] * RELIEF;
      const [x, z] = [xOf(ti), zOf(gi)];
      cellBoxes.push({ gi, ti, box: { min: [x - pitchX / 2, 0, z - pitchZ / 2], max: [x + pitchX / 2, height, z + pitchZ / 2] } });
    }
  }
  const viewOf = (target, distance, open, skip) => {
    const headings = [[FOCUS_SKEW, open], [-FOCUS_SKEW, open], [1, FOCUS_SKEW * open], [-1, FOCUS_SKEW * open], [0, open], [0, -open]];
    const blockers = cellBoxes.filter((c) => !skip(c)).map((c) => c.box);
    return { position: clearPosition(target, ringCandidates(target, headings, FOCUS_ELEVATIONS, distance), blockers), target };
  };
  const focus = new Map();
  const addFocus = (key, view) => {
    if (!focus.has(key)) focus.set(key, view);
  };
  groups.forEach((g, gi) => {
    const z = zOf(gi);
    addFocus(g.name, viewOf([0, RELIEF * 0.3, z], Math.max(FOCUS_MIN, FOCUS_PER_UNIT * size[0]), z < 0 ? -1 : 1, (c) => c.gi === gi));
  });
  cells.forEach((item, cell) => {
    const label = item === -1 ? null : rows[item].label;
    if (typeof label !== 'string' || label === '') return;
    const [gi, ti] = [Math.floor(cell / cols) - 1, (cell % cols) - 1];
    const target = [xOf(ti), values[cell] * RELIEF * 0.8, zOf(gi)];
    addFocus(label, viewOf(target, CELL_FOCUS, zOf(gi) < 0 ? -1 : 1, (c) => c.gi === gi && c.ti === ti));
  });
  return Object.fromEntries(focus);
}

/** build(data, spec) -> scene graph v1 for the terrain world. */
export function build({ rows }, spec = {}) {
  if (rows.length === 0) throw new InternalError('terrain needs at least one row');
  const groups = groupsFrom(rows);
  const ts = [...new Map(rows.filter((r) => r.t !== undefined).map((r) => [keyOfT(r.t), r.t])).values()].sort(compareT);
  if (ts.length === 0) throw new InternalError('terrain needs t on every row');
  const { values, cells } = place(rows, groups.length, ts);
  const max = rows.reduce((m, r) => Math.max(m, r.value), 0);
  const normalized = values.map((v) => (max > 0 ? v / max : 0));
  const { nx, nz, heights } = upsample(normalized, groups.length + 2, ts.length + 2);
  const size = [
    pitchOf(ts.length, X_RANGE) * (ts.length + 1),
    pitchOf(groups.length, Z_RANGE) * (groups.length + 1),
    RELIEF,
  ];
  const g = emptyGraph('terrain', spec);
  g.env = { ...g.env, water: { y: SEA_LEVEL } };
  g.groups = groups;
  g.items = itemsFrom(rows, spec.units);
  g.surfaces = [{ id: 's0', nx, nz, size, heights, bands: BANDS.map((b) => ({ ...b })), cells }];
  g.labels = buildLabels(groups, ts, size);
  g.focus = buildFocus(rows, groups, ts, normalized, cells, size);
  g.fallback = tableFallback(rows);
  return finalizeGraph(g);
}
