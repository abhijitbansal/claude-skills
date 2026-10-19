// City: one district (row of buildings) per group, buildings along x by t,
// height = value (zero-based). Window light density is bucketed by value so
// the runtime can keep one emissive setting per batch.
import { emptyGraph, finalizeGraph, tableFallback } from '../lib/graph.mjs';
import { compareT, groupIndex, groupsFrom, itemsFrom, groupColour } from '../lib/palette.mjs';
import { clearPosition, ringCandidates } from '../lib/views.mjs';

export const MAX_HEIGHT = 9; // H: the tallest building is FLOOR + H
export const FLOOR = 0.15;
export const MARKER_HEIGHT = 0.05; // zero values still draw this flat slab
const FOOTPRINT = 0.8;
const SLOT_PITCH = 1.0;
const ROW_PITCH = 1.8;
const LIGHT_LEVELS = 4;
const LABEL_GAP = 1.4;
const LABEL_SIZE = 0.6;
const FOCUS_MIN = 12; // a focus view is at least this far from its target...
const FOCUS_PER_UNIT = 1.4; // ...and this many times a district's width (+ FOCUS_MARGIN): authored for a square viewport
const FOCUS_MARGIN = 5;
const BUILDING_FOCUS = 9;
const FOCUS_SKEW = 0.4; // a view leans off the street's axis, so a district reads in 3/4, not head-on
const FOCUS_ELEVATIONS = [32, 42, 52, 62, 72]; // degrees above the floor, lowest first

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

// A view of `target` from the open side of the city (the near edge for a front district, the far edge for a back one),
// lowest elevation first, taking the first whose line of sight crosses no building but those `skip` leaves out.
function viewOfDistrict(target, distance, { placed, openSide, skip }) {
  const blockers = placed.filter((p) => !skip(p)).map((p) => ({
    min: [p.x - FOOTPRINT / 2, 0, p.z - FOOTPRINT / 2],
    max: [p.x + FOOTPRINT / 2, p.height, p.z + FOOTPRINT / 2],
  }));
  // The open side first; then down the street from either end (the other districts run beside it, not across it).
  const headings = [[FOCUS_SKEW, openSide], [-FOCUS_SKEW, openSide], [1, FOCUS_SKEW * openSide], [-1, FOCUS_SKEW * openSide], [0, openSide], [0, -openSide]];
  return { position: clearPosition(target, ringCandidates(target, headings, FOCUS_ELEVATIONS, distance), blockers), target };
}

function buildFocus(placed, groups) {
  const focus = new Map();
  const addFocus = (key, view) => {
    if (!focus.has(key)) focus.set(key, view);
  };
  const openSideOf = (z) => (z < 0 ? -1 : 1);
  groups.forEach((g, gi) => {
    const mine = placed.filter((p) => p.group === gi);
    const x0 = Math.min(...mine.map((p) => p.x));
    const x1 = Math.max(...mine.map((p) => p.x));
    const tall = Math.max(...mine.map((p) => p.height));
    const z = mine[0].z;
    const target = [(x0 + x1) / 2, tall * 0.4, z];
    const distance = Math.max(FOCUS_MIN, FOCUS_PER_UNIT * (x1 - x0 + FOOTPRINT + FOCUS_MARGIN) + tall * 0.3);
    addFocus(g.name, viewOfDistrict(target, distance, { placed, openSide: openSideOf(z), skip: (p) => p.group === gi }));
  });
  for (const p of placed) {
    if (p.label) {
      const target = [p.x, p.height / 2, p.z];
      addFocus(p.label, viewOfDistrict(target, BUILDING_FOCUS + p.height * 0.5, { placed, openSide: openSideOf(p.z), skip: (q) => q === p }));
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
