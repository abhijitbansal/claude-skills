// City: one district (row of buildings) per group, buildings along x by t,
// height = value (zero-based). Window light density is bucketed by value so
// the runtime can keep one emissive setting per batch.
import { emptyGraph, finalizeGraph, tableFallback } from '../lib/graph.mjs';
import { compareT, groupIndex, groupsFrom, itemsFrom, groupColour } from '../lib/palette.mjs';

export const MAX_HEIGHT = 9; // H: the tallest building is FLOOR + H
export const FLOOR = 0.15;
export const MARKER_HEIGHT = 0.05; // zero values still draw this flat slab
const FOOTPRINT = 0.8;
const SLOT_PITCH = 1.0;
const ROW_PITCH = 1.8;
const LIGHT_LEVELS = 4;
const LABEL_GAP = 1.4;
const LABEL_SIZE = 0.6;
const FOCUS_BACK = 9;
const FOCUS_RISE = 4;

const keyOfT = (t) => `${typeof t}:${t}`;

// Slot (x position index) of every row: rows with t share a global column per
// distinct t (so districts line up); duplicates of one (group, t) take
// neighbouring sub-slots; rows without t follow, tallest first, per group.
function slotsFor(rows, gi) {
  const withT = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.t !== undefined);
  const keys = [...new Map(withT.map(({ r }) => [keyOfT(r.t), r.t])).entries()].sort((a, b) => compareT(a[1], b[1]));
  const crowd = new Map();
  const seen = new Map();
  const occurrence = new Array(rows.length).fill(0);
  for (const { r, i } of withT) {
    const cell = `${gi.get(r.group)}|${keyOfT(r.t)}`;
    occurrence[i] = seen.get(cell) ?? 0;
    seen.set(cell, occurrence[i] + 1);
    crowd.set(keyOfT(r.t), Math.max(crowd.get(keyOfT(r.t)) ?? 0, occurrence[i] + 1));
  }
  const start = new Map();
  let width = 0;
  for (const [key] of keys) {
    start.set(key, width);
    width += crowd.get(key);
  }
  const slot = new Array(rows.length).fill(0);
  for (const { r, i } of withT) slot[i] = start.get(keyOfT(r.t)) + occurrence[i];
  const tail = new Map();
  rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.t === undefined)
    .sort((a, b) => b.r.value - a.r.value || a.i - b.i)
    .forEach(({ r, i }) => {
      const g = gi.get(r.group);
      slot[i] = width + (tail.get(g) ?? 0);
      tail.set(g, (tail.get(g) ?? 0) + 1);
    });
  const total = width + Math.max(0, ...tail.values());
  return { slot, total };
}

const heightOf = (value, max) => (value > 0 ? FLOOR + (value / max) * MAX_HEIGHT : MARKER_HEIGHT);
const lightLevel = (value, max) => (value > 0 ? Math.min(LIGHT_LEVELS, Math.ceil((LIGHT_LEVELS * value) / max)) : 0);

function buildBatches(placed, groupCount) {
  const byKey = new Map();
  for (const p of placed) {
    const key = p.group * (LIGHT_LEVELS + 1) + p.level;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push([p.x, p.height / 2, p.z, FOOTPRINT, p.height, FOOTPRINT, p.index]);
  }
  return [...byKey.keys()]
    .sort((a, b) => a - b)
    .map((key, n) => {
      const group = Math.floor(key / (LIGHT_LEVELS + 1));
      const level = key % (LIGHT_LEVELS + 1);
      return {
        id: `b${n}`,
        shape: 'box',
        colour: groupColour(group),
        emissive: level === 0 ? null : { colour: 'glow', density: level / LIGHT_LEVELS },
        flat: false,
        instances: byKey.get(key),
      };
    });
}

function buildFocus(placed, groups) {
  const focus = new Map();
  const addFocus = (key, view) => {
    if (!focus.has(key)) focus.set(key, view);
  };
  groups.forEach((g, gi) => {
    const mine = placed.filter((p) => p.group === gi);
    const x0 = Math.min(...mine.map((p) => p.x));
    const x1 = Math.max(...mine.map((p) => p.x));
    const tall = Math.max(...mine.map((p) => p.height));
    const z = mine[0].z;
    const cx = (x0 + x1) / 2;
    addFocus(g.name, {
      position: [cx + 6, tall + FOCUS_RISE, z + FOCUS_BACK + (x1 - x0) * 0.25],
      target: [cx, tall * 0.4, z],
    });
  });
  for (const p of placed) {
    if (p.label) {
      addFocus(p.label, {
        position: [p.x + 3, p.height + 3, p.z + 5],
        target: [p.x, p.height / 2, p.z],
      });
    }
  }
  return Object.fromEntries(focus);
}

/** build(data, spec) -> scene graph v1 for the city world. */
export function build({ rows }, spec = {}) {
  const gi = groupIndex(rows);
  const groups = groupsFrom(rows);
  const max = rows.reduce((m, r) => Math.max(m, r.value), 0);
  const { slot, total } = slotsFor(rows, gi);
  const placed = rows.map((r, index) => {
    const height = heightOf(r.value, max);
    return {
      index,
      group: gi.get(r.group),
      level: lightLevel(r.value, max),
      height,
      x: (slot[index] - (total - 1) / 2) * SLOT_PITCH,
      z: (gi.get(r.group) - (groups.length - 1) / 2) * ROW_PITCH,
      label: typeof r.label === 'string' && r.label !== '' ? r.label : null,
    };
  });
  const g = emptyGraph('city', spec);
  g.env = { ...g.env, ground: 'surface', nightLights: true };
  g.groups = groups;
  g.items = itemsFrom(rows, spec.units);
  g.batches = buildBatches(placed, groups.length);
  g.labels = groups.map((grp, i) => ({
    text: grp.name,
    at: [-(total / 2) * SLOT_PITCH - LABEL_GAP, 0.1, (i - (groups.length - 1) / 2) * ROW_PITCH],
    size: LABEL_SIZE,
  }));
  g.focus = rows.length === 0 ? {} : buildFocus(placed, groups);
  g.fallback = tableFallback(rows);
  return finalizeGraph(g);
}
