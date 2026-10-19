// Forest: every root group (no parent) is a tree on a ring. Its rows are
// branches that spiral up the trunk in t order (row order without t); each
// branch ends in an icosahedron leaf cluster sized by value. A group with a
// parent grows as a smaller sub-tree on a limb of its parent's trunk.
// Trunks and branches are decoration (item -1); no rotation, so a branch is a
// short chain of small spheres from the trunk out to its leaf cluster, rising as it goes. Each leaf cluster is
// ringed by two lower puffs of the same colour (decoration, in a foliage batch per group): a fuller crown that
// grows with the cluster, so the silhouette still tracks the value.
import { emptyGraph, finalizeGraph, tableFallback } from '../lib/graph.mjs';
import { compareT, groupIndex, groupsFrom, itemsFrom, groupColour } from '../lib/palette.mjs';
import { ringSlots } from '../lib/ring.mjs';

export const LEAF_MIN = 0.25;
export const LEAF_SPAN = 1.4; // leaf size = LEAF_MIN + value / max * LEAF_SPAN
export const TRUNK_RADIUS = 0.28;
export const BRANCH_LEN = 1.1;
const WOOD = '#6b4f3a';
const MEADOW = { base: '#4f8a46', tint: 'surface', share: 0.3 };
const DEPTH_SCALE = 0.7; // each nesting level is this much smaller
const STEM_BASE = 2.4;
const STEM_PER_ROW = 0.5;
const STEM_MAX = 11;
const BRANCH_START = 1.2; // first branch height above the stem base
const BRANCH_TOP_GAP = 0.2;
const BRANCH_TOP_SHARE = 0.2; // the highest branch is this share of the longest: its cluster crowns the trunk, the lower ones fan out
const BRANCH_STEPS = 6;
const BRANCH_THICK = 0.24;
const BRANCH_RISE = 0.55; // a branch climbs this far (before depth scale) from trunk to leaf cluster
const PUFFS_PER_LEAF = 2;
const PUFF_SIZE = 0.68; // of the leaf cluster's diameter
const PUFF_REACH = 0.38; // centre offset, in cluster diameters
const PUFF_DROP = 0.15; // puffs sit this much (in cluster diameters) below the cluster's centre, never over its top
export const LIMB_LEN = 1.3;
const LIMB_STEPS = 4;
const LIMB_THICK = 0.18;
const LIMB_RISE = 0.25;
const LIMB_SPAN = [0.3, 0.55]; // child limbs sit this fraction up the parent stem
const GOLDEN_ANGLE = 2.399963;
const TREE_GAP = 1.2;
const LABEL_OUT = 0.8;
const FOCUS_DISTANCE = 3.5;
const FOCUS_RISE = 1.5;

const leafSize = (value, max) => LEAF_MIN + (max > 0 ? value / max : 0) * LEAF_SPAN;
const stemHeight = (rows, scale) => scale * Math.min(STEM_MAX, STEM_BASE + rows * STEM_PER_ROW);

// Rows of each group in branch order: by t, rows without t last, ties by row.
function rowsByGroup(rows) {
  const byGroup = new Map();
  rows.forEach((r, index) => {
    if (!byGroup.has(r.group)) byGroup.set(r.group, []);
    byGroup.get(r.group).push({ ...r, index });
  });
  for (const list of byGroup.values()) list.sort((a, b) => compareT(a.t, b.t) || a.index - b.index);
  return byGroup;
}

// group -> its parent group (the first row naming one; the validator keeps them consistent).
function parentsOf(rows) {
  const parents = new Map();
  for (const r of rows) if (r.parent !== undefined && !parents.has(r.group)) parents.set(r.group, r.parent);
  return parents;
}

// How far a tree reaches from its trunk axis: its own branches or a child's limb plus that child's reach.
function reach(group, depth, children) {
  const scale = DEPTH_SCALE ** depth;
  const own = scale * (TRUNK_RADIUS + BRANCH_LEN) + LEAF_MIN + LEAF_SPAN / 2;
  const kids = (children.get(group) ?? []).map((c) => scale * LIMB_LEN + reach(c, depth + 1, children));
  return Math.max(own, ...kids);
}

/** build(data, spec) -> scene graph v1 for the forest world. */
export function build({ rows }, spec = {}) {
  const gi = groupIndex(rows);
  const groups = groupsFrom(rows);
  const byGroup = rowsByGroup(rows);
  const parents = parentsOf(rows);
  const children = new Map();
  for (const name of gi.keys()) {
    const parent = parents.get(name);
    if (parent === undefined) continue;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(name);
  }
  const roots = [...gi.keys()].filter((name) => !parents.has(name));
  const max = rows.reduce((m, r) => Math.max(m, r.value), 0);

  const trunks = []; // by group index, so stems list in group order whatever the growth order
  const branches = [];
  const leaves = groups.map(() => []);
  const puffs = groups.map(() => []);
  const labels = [];
  const views = new Map(); // group views; row-label views are added after, so a group wins a name clash
  const labelViews = [];

  function grow(name, base, depth, outward) {
    const scale = DEPTH_SCALE ** depth;
    const list = byGroup.get(name);
    const g = gi.get(name);
    const [bx, by, bz] = base;
    const stem = stemHeight(list.length, scale);
    const radius = TRUNK_RADIUS * scale;
    trunks[g] = [bx, by + stem / 2, bz, radius * 2, stem, radius * 2, -1];
    const first = scale * BRANCH_START;
    const span = Math.max(0, stem - first - scale * BRANCH_TOP_GAP);
    const thick = scale * BRANCH_THICK;
    list.forEach((row, k) => {
      const climb = list.length === 1 ? 1 : k / (list.length - 1); // 0 at the lowest branch, 1 at the top
      const length = scale * BRANCH_LEN * (1 - (1 - BRANCH_TOP_SHARE) * climb);
      const y = by + first + (list.length === 1 ? 0 : climb * span);
      const angle = outward + k * GOLDEN_ANGLE;
      const [dx, dz] = [Math.cos(angle), Math.sin(angle)];
      for (let j = 1; j <= BRANCH_STEPS; j++) {
        const f = j / BRANCH_STEPS;
        const out = radius + length * f;
        const d = thick * (1 - 0.4 * f);
        branches.push([bx + dx * out, y + scale * BRANCH_RISE * f, bz + dz * out, d, d, d, -1]);
      }
      const size = leafSize(row.value, max);
      const tip = [bx + dx * (radius + length), y + scale * BRANCH_RISE + size * 0.25, bz + dz * (radius + length)];
      leaves[g].push([...tip, size, size, size, row.index]);
      for (let n = 0; n < PUFFS_PER_LEAF; n++) {
        const a = GOLDEN_ANGLE * (row.index * PUFFS_PER_LEAF + n + 1);
        puffs[g].push([
          tip[0] + Math.cos(a) * PUFF_REACH * size, tip[1] - PUFF_DROP * size, tip[2] + Math.sin(a) * PUFF_REACH * size,
          PUFF_SIZE * size, PUFF_SIZE * size, PUFF_SIZE * size, -1,
        ]);
      }
      if (typeof row.label === 'string' && row.label !== '') {
        labelViews.push([row.label, { position: [tip[0] + dx * FOCUS_DISTANCE, tip[1] + FOCUS_RISE, tip[2] + dz * FOCUS_DISTANCE], target: tip }]);
      }
    });
    const kids = children.get(name) ?? [];
    kids.forEach((kid, j) => {
      const angle = outward + GOLDEN_ANGLE * (j + 0.5);
      const [dx, dz] = [Math.cos(angle), Math.sin(angle)];
      const y = by + stem * (LIMB_SPAN[0] + (LIMB_SPAN[1] - LIMB_SPAN[0]) * ((j + 0.5) / kids.length));
      const limb = scale * LIMB_LEN;
      const d = scale * LIMB_THICK;
      for (let i = 0; i <= LIMB_STEPS; i++) {
        const f = i / LIMB_STEPS;
        const out = radius + limb * f;
        branches.push([bx + dx * out, y + scale * LIMB_RISE * f, bz + dz * out, d, d, d, -1]);
      }
      const tip = [bx + dx * (radius + limb), y + scale * LIMB_RISE, bz + dz * (radius + limb)];
      grow(kid, tip, depth + 1, angle);
    });
    const centre = [bx, by + stem * 0.55, bz];
    const distance = reach(name, depth, children) + FOCUS_DISTANCE * scale;
    views.set(name, {
      position: [bx + Math.cos(outward) * distance, centre[1] + stem * 0.4 + FOCUS_RISE, bz + Math.sin(outward) * distance],
      target: centre,
    });
    const at = depth === 0
      ? [bx + Math.cos(outward) * (radius + LABEL_OUT), 0.1, bz + Math.sin(outward) * (radius + LABEL_OUT)]
      : [bx, by + stem + scale * 0.5, bz];
    labels.push({ text: name, at, size: 0.6 * Math.max(scale, 0.7) });
  }

  const spacing = 2 * Math.max(0, ...roots.map((name) => reach(name, 0, children))) + TREE_GAP;
  ringSlots(roots.length, spacing).forEach((slot, i) => grow(roots[i], [slot.x, 0, slot.z], 0, slot.angle));

  const g = emptyGraph('forest', spec);
  g.env = { ...g.env, ground: MEADOW };
  g.groups = groups;
  g.items = itemsFrom(rows, spec.units);
  g.batches = [
    { id: 'b0', shape: 'cylinder', colour: WOOD, emissive: null, flat: false, instances: trunks },
    { id: 'b1', shape: 'sphere', colour: WOOD, emissive: null, flat: false, instances: branches },
    ...leaves.map((instances, n) => ({
      id: `b${n + 2}`, shape: 'icosa', colour: groupColour(n), emissive: null, flat: false, instances,
    })),
    ...puffs.map((instances, n) => ({
      id: `b${leaves.length + n + 2}`, shape: 'sphere', colour: groupColour(n), emissive: null, flat: false, instances,
    })).filter((batch) => batch.instances.length > 0),
  ];
  g.anim = { sway: leaves.map((_, n) => `b${n + 2}`), orbits: [] };
  g.labels = labels;
  for (const [key, view] of labelViews) if (!views.has(key)) views.set(key, view);
  g.focus = Object.fromEntries(views);
  g.fallback = tableFallback(rows);
  return finalizeGraph(g);
}
