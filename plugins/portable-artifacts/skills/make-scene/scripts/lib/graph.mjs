// Scene graph v1 helpers shared by every world: an empty skeleton, rounding,
// finalizing (bounds, default camera, lowercase focus keys, finite numbers)
// and a structural check. The contract is in references/scene-graph.md.
import { InternalError } from './internal-error.mjs';

export const KINDS = ['city', 'forest', 'galaxy', 'terrain', 'diagram', 'chart'];
export const SHAPES = ['box', 'cylinder', 'sphere', 'icosa', 'cone', 'disc', 'ring'];
export const ARROWS = ['end', 'both'];

const DECIMALS = 1000;
const CAMERA_DIRECTION = [1, 0.8, 1];
const CAMERA_FIT = 2.4; // distance = FIT * bounds radius: a 45 degree lens frames the whole scene
const MIN_RADIUS = 1;
// items[].value is the data itself: checked for finiteness, never rounded.
const ITEM_VALUE_PATH = /^graph\.items\[\d+\]\.value$/;

/** Round to 3 decimals; never returns negative zero. */
export function round3(n) {
  const r = Math.round(n * DECIMALS) / DECIMALS;
  return r === 0 ? 0 : r;
}

/** Every contract field present; the world fills what it uses. */
export function emptyGraph(kind, { title, units } = {}) {
  return {
    v: 1,
    kind,
    title: String(title ?? ''),
    units: String(units ?? ''),
    bounds: { min: [0, 0, 0], max: [0, 0, 0] },
    camera: null,
    env: { sky: 'theme', ground: null, fog: true, stars: false, water: null, nightLights: false },
    groups: [],
    items: [],
    batches: [],
    tubes: [],
    surfaces: [],
    labels: [],
    anim: { sway: [], orbits: [] },
    focus: {},
    tour: [],
    fallback: { kind: 'table', columns: ['group', 't', 'value'], rows: [], svg: null },
  };
}

/** The accessible table every data world ships: group, t, value as strings. */
export function tableFallback(rows) {
  return {
    kind: 'table',
    columns: ['group', 't', 'value'],
    rows: rows.map((r) => [r.group, r.t === undefined ? '' : String(r.t), String(r.value)]),
    svg: null,
  };
}

function boundsOf(g) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const grow = (p, half) => {
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], p[a] - half[a]);
      max[a] = Math.max(max[a], p[a] + half[a]);
    }
  };
  for (const b of g.batches) for (const i of b.instances) grow(i, [i[3] / 2, i[4] / 2, i[5] / 2]);
  for (const t of g.tubes) for (const p of t.points) grow(p, [t.radius, t.radius, t.radius]);
  // Orbiting instances sweep a flat disc around the centre; take the widest one.
  for (const o of g.anim?.orbits ?? []) {
    const reach = o.r.reduce((m, r) => Math.max(m, r), 0);
    grow(o.center, [reach, 0, reach]);
  }
  g.surfaces.forEach((s, i) => {
    if (!isSize(s.size)) fail(`surfaces[${i}].size`, 'expected [sx, sz, sy]: exactly 3 finite numbers');
    const [sx, sz, sy] = s.size;
    grow([0, sy / 2, 0], [sx / 2, sy / 2, sz / 2]);
  });
  return min[0] === Infinity ? { min: [0, 0, 0], max: [0, 0, 0] } : { min, max };
}

function defaultCamera({ min, max }) {
  const centre = min.map((lo, a) => (lo + max[a]) / 2);
  const radius = Math.max(MIN_RADIUS, Math.hypot(...min.map((lo, a) => (max[a] - lo) / 2)));
  const length = Math.hypot(...CAMERA_DIRECTION);
  return {
    position: centre.map((c, a) => c + (CAMERA_DIRECTION[a] / length) * radius * CAMERA_FIT),
    target: centre,
  };
}

// Copy with every number checked and rounded; throws InternalError naming the path.
function cleaned(value, at) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new InternalError(`scene graph has a non-finite number at ${at}`);
    return ITEM_VALUE_PATH.test(at) ? value : round3(value);
  }
  if (Array.isArray(value)) return value.map((v, i) => cleaned(v, `${at}[${i}]`));
  if (value && typeof value === 'object') {
    // fromEntries defines own properties, so a key named __proto__ survives.
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, cleaned(v, `${at}.${k}`)]),
    );
  }
  return value;
}

// Lowercase keys, first wins; a Map keeps names like "constructor" and "__proto__" safe.
function lowercasedFocus(focus) {
  const out = new Map();
  for (const [key, view] of Object.entries(focus)) {
    const lower = key.toLowerCase();
    if (!out.has(lower)) out.set(lower, view);
  }
  return Object.fromEntries(out);
}

/** A new, finished graph: bounds, default camera, lowercase focus keys, rounded finite numbers. */
export function finalizeGraph(g) {
  const base = cleaned({ ...g, focus: lowercasedFocus(g.focus ?? {}) }, 'graph');
  const bounds = cleaned(boundsOf(base), 'graph.bounds');
  return { ...base, bounds, camera: base.camera ?? cleaned(defaultCamera(bounds), 'graph.camera') };
}

function fail(at, message) {
  throw new InternalError(`scene graph invalid at ${at}: ${message}`);
}

const isFinite3 = (v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
const isSize = isFinite3;
const isView = (v) => v && isFinite3(v.position) && isFinite3(v.target);

function checkBatches(g) {
  g.batches.forEach((b, bi) => {
    if (!SHAPES.includes(b.shape)) fail(`batches[${bi}].shape`, `${JSON.stringify(b.shape)} is not one of ${SHAPES.join(', ')}`);
    b.instances.forEach((inst, ii) => {
      const at = `batches[${bi}].instances[${ii}]`;
      if (!Array.isArray(inst) || inst.length !== 7 || !inst.every(Number.isFinite)) fail(at, 'expected 7 finite numbers');
      if (!Number.isInteger(inst[6]) || inst[6] < -1 || inst[6] >= g.items.length) fail(at, `item index ${inst[6]} is outside -1..${g.items.length - 1}`);
    });
  });
}

function checkSurfaces(g) {
  g.surfaces.forEach((s, si) => {
    const at = `surfaces[${si}]`;
    if (!Number.isInteger(s.nx) || !Number.isInteger(s.nz) || s.nx < 2 || s.nz < 2) fail(`${at}.nx`, 'nx and nz must be integers >= 2');
    if (!isSize(s.size)) fail(`${at}.size`, 'expected [sx, sz, sy]: exactly 3 finite numbers');
    if (s.heights.length !== s.nx * s.nz) fail(`${at}.heights`, `expected ${s.nx * s.nz} values, got ${s.heights.length}`);
    s.cells.forEach((c, ci) => {
      if (!Number.isInteger(c) || c < -1 || c >= g.items.length) fail(`${at}.cells[${ci}]`, `item index ${c} is outside -1..${g.items.length - 1}`);
    });
  });
}

function checkTubes(g) {
  g.tubes.forEach((t, i) => {
    for (const k of ['label', 'display']) {
      if (t[k] !== undefined && typeof t[k] !== 'string') fail(`tubes[${i}].${k}`, 'expected a string when present');
    }
    if (t.arrow !== undefined && !ARROWS.includes(t.arrow)) fail(`tubes[${i}].arrow`, `${JSON.stringify(t.arrow)} is not one of ${ARROWS.join(', ')}`);
  });
}

const LINK_COLUMNS = ['from', 'to', 'value'];

function checkLinkTable(links) {
  if (links === undefined) return;
  if (JSON.stringify(links.columns) !== JSON.stringify(LINK_COLUMNS)) fail('fallback.links.columns', `expected ${JSON.stringify(LINK_COLUMNS)}`);
  if (!Array.isArray(links.rows)) fail('fallback.links.rows', 'expected an array');
  links.rows.forEach((row, i) => {
    if (!Array.isArray(row) || row.length !== LINK_COLUMNS.length || !row.every((c) => typeof c === 'string')) {
      fail(`fallback.links.rows[${i}]`, 'expected [from, to, value] as 3 strings');
    }
  });
}

/** Structural check of a finished graph; throws InternalError naming the path. */
export function assertGraph(g) {
  if (g?.v !== 1) fail('v', 'expected 1');
  if (!KINDS.includes(g.kind)) fail('kind', `${JSON.stringify(g.kind)} is not one of ${KINDS.join(', ')}`);
  for (const k of ['groups', 'items', 'batches', 'tubes', 'surfaces', 'labels', 'tour']) {
    if (!Array.isArray(g[k])) fail(k, 'expected an array');
  }
  if (!isFinite3(g.bounds?.min) || !isFinite3(g.bounds?.max)) fail('bounds', 'min and max must be 3 finite numbers');
  if (!isView(g.camera)) fail('camera', 'position and target must be 3 finite numbers');
  g.items.forEach((it, i) => {
    if (!Number.isInteger(it.group) || it.group < 0 || it.group >= g.groups.length) fail(`items[${i}].group`, 'not a group index');
    if (!Number.isFinite(it.value)) fail(`items[${i}].value`, 'not finite');
  });
  checkBatches(g);
  checkSurfaces(g);
  checkTubes(g);
  for (const [key, view] of Object.entries(g.focus ?? {})) {
    if (key !== key.toLowerCase()) fail(`focus.${key}`, 'key is not lowercase');
    if (!isView(view)) fail(`focus.${key}`, 'position and target must be 3 finite numbers');
  }
  if (!Array.isArray(g.fallback?.rows)) fail('fallback.rows', 'expected an array');
  checkLinkTable(g.fallback.links);
}
