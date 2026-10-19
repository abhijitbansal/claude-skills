// Galaxy: one star per group on a ring; each row is a planet orbiting its
// group's star at r = 1.4 + rank * pitch (pitch 0.32, squeezed so no orbit passes r = 8), rank by t (value, largest first,
// when t is absent), size = 0.06 + value / max * 0.32. A planet is stored at
// its orbit position for time 0: centre + r * (cos phase, 0, sin phase); the
// runtime advances phase by speed * time. Links are arcs between star centres.
import { emptyGraph, finalizeGraph, tableFallback } from '../lib/graph.mjs';
import { compareT, groupIndex, groupsFrom, itemsFrom, groupColour, displayValue } from '../lib/palette.mjs';
import { InternalError } from '../lib/internal-error.mjs';
import { ringSlots } from '../lib/ring.mjs';
import { seedFrom } from '../../shared/art.mjs';

export const ORBIT_BASE = 1.4;
export const ORBIT_PITCH = 0.32;
export const ORBIT_MAX = 8; // the outermost orbit of any system
export const PLANET_MIN = 0.06;
export const PLANET_SPAN = 0.32;
export const SPEED_K = 0.9; // speed = SPEED_K / sqrt(r)
export const ARC_LIFT = 1; // apex rise = ARC_LIFT + distance * ARC_LIFT_PER_DISTANCE
export const ARC_LIFT_PER_DISTANCE = 0.15;
const STAR_SIZE = 0.9;
const STAR_GAP = 1.2;
const ARC_SEGMENTS = 16;
const TUBE_MIN = 0.03;
const TUBE_SPAN = 0.07;
const TUBE_PLAIN = 0.05;
const LINK_COLOUR = { base: '#c8d0e0', tint: 'accent', share: 0.3 }; // space is dark in both modes: a pale link with a hint of the theme accent
const LABEL_RISE = 0.4;
const LABEL_SIZE = 0.6;
const FOCUS_DIRECTION = [0.5, 0.8, 0.9];
const FOCUS_FIT = 2.2;
const FOCUS_MARGIN = 3;
const PHASE_RANGE = 2 ** 32;

const planetSize = (value, max) => PLANET_MIN + (max > 0 ? value / max : 0) * PLANET_SPAN;
const pitchFor = (planets) => Math.min(ORBIT_PITCH, (ORBIT_MAX - ORBIT_BASE) / Math.max(1, planets - 1));
const orbitRadius = (rank, pitch) => ORBIT_BASE + rank * pitch;
const unit = (v) => v.map((c) => c / Math.hypot(...v));

// Rows of each group in orbit order: by t, then value (largest first), then row.
function rowsByGroup(rows) {
  const byGroup = new Map();
  rows.forEach((r, index) => {
    if (!byGroup.has(r.group)) byGroup.set(r.group, []);
    byGroup.get(r.group).push({ ...r, index });
  });
  for (const list of byGroup.values()) {
    list.sort((a, b) => compareT(a.t, b.t) || b.value - a.value || a.index - b.index);
  }
  return byGroup;
}

// Quadratic arc between two star centres; the apex rises ARC_LIFT + distance * ARC_LIFT_PER_DISTANCE.
function arc(from, to) {
  const distance = Math.hypot(to[0] - from[0], to[2] - from[2]);
  const apex = ARC_LIFT + distance * ARC_LIFT_PER_DISTANCE;
  const control = [(from[0] + to[0]) / 2, 2 * apex, (from[2] + to[2]) / 2]; // a quadratic peaks at half its control height
  return Array.from({ length: ARC_SEGMENTS + 1 }, (_, k) => {
    const t = k / ARC_SEGMENTS;
    const [a, b, c] = [(1 - t) ** 2, 2 * (1 - t) * t, t ** 2];
    return [a * from[0] + b * control[0] + c * to[0], b * control[1], a * from[2] + b * control[2] + c * to[2]];
  });
}

// { tubes, table }: one tube per link between two different groups, and the same links as text rows.
function tubesFrom(links, centres, gi, units) {
  const peak = links.reduce((m, l) => Math.max(m, l.value ?? 0), 0);
  const tubes = [];
  const table = [];
  for (const l of links) {
    const [from, to] = [gi.get(l.from), gi.get(l.to)];
    if (from === undefined || to === undefined) throw new InternalError(`link ${l.from} -> ${l.to} names a group that has no rows`);
    if (from === to) continue; // an arc from a star to itself has nothing to span
    const share = l.value !== undefined && peak > 0 ? l.value / peak : null;
    const text = l.value === undefined ? '' : displayValue(l.value, units);
    tubes.push({
      id: `e${tubes.length}`,
      points: arc(centres[from], centres[to]),
      radius: share === null ? TUBE_PLAIN : TUBE_MIN + TUBE_SPAN * share,
      colour: LINK_COLOUR,
      item: null,
      label: `${l.from} → ${l.to}`,
      ...(text === '' ? {} : { display: text }),
    });
    table.push([l.from, l.to, text]);
  }
  return { tubes, table };
}

/** build(data, spec) -> scene graph v1 for the galaxy world. */
export function build({ rows, links = [] }, spec = {}) {
  const gi = groupIndex(rows);
  const groups = groupsFrom(rows);
  const byGroup = rowsByGroup(rows);
  const max = rows.reduce((m, r) => Math.max(m, r.value), 0);
  const pitches = groups.map((grp) => pitchFor(byGroup.get(grp.name).length));
  const reachOf = groups.map((grp, n) => orbitRadius(byGroup.get(grp.name).length - 1, pitches[n]) + PLANET_MIN + PLANET_SPAN / 2);
  const widest = Math.max(STAR_SIZE, ...reachOf);
  const slots = ringSlots(groups.length, 2 * (widest + STAR_GAP));
  const centres = slots.map((s) => [s.x, 0, s.z]);

  const planetBatches = [];
  const orbits = [];
  groups.forEach((grp, n) => {
    const [cx, cy, cz] = centres[n];
    const batch = { id: `b${groups.length + n}`, shape: 'sphere', colour: groupColour(n), emissive: null, flat: false, instances: [] };
    const orbit = { batch: batch.id, center: [cx, cy, cz], r: [], phase: [], speed: [] };
    byGroup.get(grp.name).forEach((row, rank) => {
      const r = orbitRadius(rank, pitches[n]);
      const phase = (seedFrom(`${grp.name}|${row.index}`) / PHASE_RANGE) * 2 * Math.PI;
      const d = planetSize(row.value, max);
      batch.instances.push([cx + r * Math.cos(phase), cy, cz + r * Math.sin(phase), d, d, d, row.index]);
      orbit.r.push(r);
      orbit.phase.push(phase);
      orbit.speed.push(SPEED_K / Math.sqrt(r));
    });
    planetBatches.push(batch);
    orbits.push(orbit);
  });

  const g = emptyGraph('galaxy', spec);
  g.env = { ...g.env, sky: 'space', stars: true, fog: false };
  g.groups = groups;
  g.items = itemsFrom(rows, spec.units);
  g.batches = [
    ...groups.map((_, n) => ({
      id: `b${n}`, shape: 'sphere', colour: groupColour(n), emissive: { colour: groupColour(n), density: 1 }, flat: false,
      instances: [[...centres[n], STAR_SIZE, STAR_SIZE, STAR_SIZE, -1]],
    })),
    ...planetBatches,
  ];
  const { tubes, table } = tubesFrom(links, centres, gi, spec.units);
  g.tubes = tubes;
  g.anim = { sway: [], orbits };
  g.labels = groups.map((grp, n) => ({ text: grp.name, at: [centres[n][0], STAR_SIZE / 2 + LABEL_RISE, centres[n][2]], size: LABEL_SIZE }));
  // Planets move, so a row label flies to its star like its group does.
  const views = new Map();
  groups.forEach((grp, n) => {
    const distance = reachOf[n] * FOCUS_FIT + FOCUS_MARGIN;
    const dir = unit(FOCUS_DIRECTION);
    views.set(grp.name, { position: centres[n].map((c, a) => c + dir[a] * distance), target: centres[n] });
  });
  rows.forEach((r) => {
    if (typeof r.label === 'string' && r.label !== '' && !views.has(r.label)) views.set(r.label, views.get(r.group));
  });
  g.focus = Object.fromEntries(views);
  g.fallback = {
    ...tableFallback(rows),
    ...(table.length ? { links: { columns: ['from', 'to', 'value'], rows: table } } : {}),
  };
  return finalizeGraph(g);
}
