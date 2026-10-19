// Terrain: a (group x t) grid of values, upsampled 5x with bilinear
// interpolation into one height-field surface. Heights are normalized to 0..1
// (the largest value is 1); bands and sea level are in the same units.
import { emptyGraph, finalizeGraph, tableFallback } from '../lib/graph.mjs';
import { compareT, groupIndex, groupsFrom, itemsFrom } from '../lib/palette.mjs';
import { InternalError } from '../lib/internal-error.mjs';

export const UPSAMPLE = 5;
export const SEA_LEVEL = 0.12;
export const BANDS = [
  { below: 0.2, colour: '#d8c38a' }, // sand
  { below: 0.55, colour: '#6b9a4f' }, // grass
  { below: 0.82, colour: '#8a8178' }, // rock
  { below: 1, colour: '#f4f6f8' }, // snow (heights at or above the last `below` use the last band)
];
const RELIEF = 4.5; // world height of normalized 1
const UNIT = 1.5; // world size per data column or row
const X_RANGE = [6, 20];
const Z_RANGE = [4, 14];
const LABEL_SIZE = 0.6;
const LABEL_GAP = 0.8;
const MAX_T_LABELS = 6;
const FOCUS_BACK = 0.8;

const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));
const keyOfT = (t) => `${typeof t}:${t}`;
const gridSize = (n) => (n === 1 ? 2 : (n - 1) * UPSAMPLE + 1);

// Bilinear sample of the data grid (clamped at the edges, so a 1-wide grid is flat).
function sample(values, G, T, gz, tx) {
  const z0 = Math.min(Math.floor(gz), G - 1);
  const x0 = Math.min(Math.floor(tx), T - 1);
  const z1 = Math.min(z0 + 1, G - 1);
  const x1 = Math.min(x0 + 1, T - 1);
  const fz = gz - z0;
  const fx = tx - x0;
  const top = values[z0 * T + x0] * (1 - fx) + values[z0 * T + x1] * fx;
  const bottom = values[z1 * T + x0] * (1 - fx) + values[z1 * T + x1] * fx;
  return top * (1 - fz) + bottom * fz;
}

function upsample(values, G, T) {
  const nx = gridSize(T);
  const nz = gridSize(G);
  const heights = new Array(nx * nz);
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) heights[iz * nx + ix] = sample(values, G, T, iz / UPSAMPLE, ix / UPSAMPLE);
  }
  return { nx, nz, heights };
}

function place(rows, groupCount, ts) {
  const T = ts.length;
  const tIndex = new Map(ts.map((t, i) => [keyOfT(t), i]));
  const gi = groupIndex(rows);
  const values = new Array(groupCount * T).fill(0);
  const cells = new Array(groupCount * T).fill(-1);
  rows.forEach((r, i) => {
    if (r.t === undefined) throw new InternalError('terrain needs t on every row');
    const cell = gi.get(r.group) * T + tIndex.get(keyOfT(r.t));
    if (cells[cell] !== -1) throw new InternalError('terrain needs exactly one row per group and t');
    cells[cell] = i;
    values[cell] = r.value;
  });
  return { values, cells };
}

function buildLabels(groups, ts, [sx, sz]) {
  const zOf = (i) => (groups.length === 1 ? 0 : (i / (groups.length - 1) - 0.5) * sz);
  const out = groups.map((g, i) => ({ text: g.name, at: [-sx / 2 - LABEL_GAP, 0.1, zOf(i)], size: LABEL_SIZE }));
  const shown = Math.min(ts.length, MAX_T_LABELS);
  for (let k = 0; k < shown; k++) {
    const ti = shown === 1 ? 0 : Math.round((k * (ts.length - 1)) / (shown - 1));
    const x = ts.length === 1 ? 0 : (ti / (ts.length - 1) - 0.5) * sx;
    out.push({ text: String(ts[ti]), at: [x, 0.1, sz / 2 + LABEL_GAP], size: LABEL_SIZE });
  }
  return out;
}

function buildFocus(rows, groups, ts, cells, [sx, sz]) {
  const T = ts.length;
  const xOf = (ti) => (T === 1 ? 0 : (ti / (T - 1) - 0.5) * sx);
  const zOf = (g) => (groups.length === 1 ? 0 : (g / (groups.length - 1) - 0.5) * sz);
  const focus = new Map();
  const addFocus = (key, view) => {
    if (!focus.has(key)) focus.set(key, view);
  };
  groups.forEach((g, i) => {
    addFocus(g.name, { position: [0, RELIEF + 2, zOf(i) + sz * FOCUS_BACK], target: [0, RELIEF * 0.3, zOf(i)] });
  });
  cells.forEach((item, cell) => {
    const label = item === -1 ? null : rows[item].label;
    if (typeof label !== 'string' || label === '') return;
    const x = xOf(cell % T);
    const z = zOf(Math.floor(cell / T));
    addFocus(label, { position: [x + 3, RELIEF + 3, z + 5], target: [x, RELIEF * 0.3, z] });
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
  const { nx, nz, heights } = upsample(normalized, groups.length, ts.length);
  const size = [clamp(ts.length * UNIT, X_RANGE), clamp(groups.length * UNIT, Z_RANGE), RELIEF];
  const g = emptyGraph('terrain', spec);
  g.env = { ...g.env, water: { y: SEA_LEVEL } };
  g.groups = groups;
  g.items = itemsFrom(rows, spec.units);
  g.surfaces = [{ id: 's0', nx, nz, size, heights, bands: BANDS.map((b) => ({ ...b })), cells }];
  g.labels = buildLabels(groups, ts, size);
  g.focus = buildFocus(rows, groups, ts, cells, size);
  g.fallback = tableFallback(rows);
  return finalizeGraph(g);
}
