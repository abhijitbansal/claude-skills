// World ranking from the data shape, and the render-weight bucket the cost
// table prints. Eligibility is Task 3's single source of truth; re-exported here.
import { eligibility, WORLDS } from './eligibility.mjs';

export { eligibility, WORLDS };

export const TERRAIN_FILL = 0.6;
export const LIGHT_MAX = 3000;
export const MEDIUM_MAX = 15000;

// 2026, 2026-07, 2026-07-01, 2026-W30, 2026W30, 2026-Q3, optionally with a time part.
const TIME_LIKE = /^\d{4}(-\d{2}(-\d{2})?|-?W\d{1,2}|-?Q[1-4])?([T ].+)?$/i;

/** "terrain needs t on every row" -> "not available: needs t on every row". */
export function notAvailable(needs) {
  return `not available: needs ${needs.replace(/^\w+ needs /, '')}`;
}

// A calendar or sequence label (2026-07-14, 2026-W30): reads as time, so a block per row (city) fits it best.
function isCalendar(t) {
  return typeof t === 'string' && TIME_LIKE.test(t);
}

function isTimeLike(t) {
  if (typeof t === 'number') return Number.isFinite(t);
  return typeof t === 'string' && (TIME_LIKE.test(t) || /^-?\d+(\.\d+)?$/.test(t));
}

// Every row has a plain number for t (not a date or week): a surface over two numeric axes.
function hasNumericT(rows) {
  const plain = (t) => (typeof t === 'number' ? Number.isFinite(t) : typeof t === 'string' && /^-?\d+(\.\d+)?$/.test(t) && !isCalendar(t));
  return rows.length > 0 && rows.every((r) => plain(r.t));
}

/** Share of the group x t grid that has a row, or null when no row has a time. */
function gridFill(rows) {
  if (rows.length === 0 || !rows.every((r) => r.t !== undefined && isTimeLike(r.t))) return null;
  const groups = new Set(rows.map((r) => r.group));
  const times = new Set(rows.map((r) => r.t));
  const cells = new Set(rows.map((r) => `${r.group}\u0000${r.t}`));
  return cells.size / (groups.size * times.size);
}

function pickFirst({ rows, links }, elig) {
  if (links.length > 0) return 'galaxy';
  if (rows.some((r) => r.parent !== undefined)) return 'forest';
  const fill = gridFill(rows);
  // Dates and weeks always read as time: city first, terrain stays listed when eligible. Terrain leads only for a dense numeric grid.
  if (fill !== null && fill >= TERRAIN_FILL && elig.terrain.ok && hasNumericT(rows)) return 'terrain';
  return 'city';
}

function reasonFor(world, { rows, links }, elig, first) {
  if (!elig[world].ok) return notAvailable(elig[world].needs);
  const fill = gridFill(rows);
  const pct = fill === null ? null : Math.round(fill * 100);
  const hasT = rows.some((r) => r.t !== undefined);
  if (world === 'galaxy') return links.length > 0 ? 'rows are linked: a graph of nodes and edges' : 'nodes without links drift as a cluster';
  if (world === 'forest') {
    return rows.some((r) => r.parent !== undefined) ? 'rows have parents: a hierarchy of trees' : 'no parents: every row stands as its own tree';
  }
  if (world === 'terrain') {
    // Eligible terrain with no fill: t is text (or there are no rows), so the columns simply follow text order.
    if (fill === null) return rows.length > 0 ? 't is text: columns follow text order' : 'a surface needs t to be numeric or time-like, so the grid has no order';
    return `group x t grid is ${pct}% filled${first === 'terrain' ? ': a surface fits' : ''}`;
  }
  if (first === 'city') return hasT ? 'time or sequence: one block per row' : 'default: one block per row';
  return 'one block per row';
}

/**
 * @param {{ rows: object[], links: object[] }} data
 * @returns {{ ranked: string[], reasons: Record<string, string> }}
 */
export function recommend(data) {
  const elig = eligibility(data);
  const first = pickFirst(data, elig);
  const eligible = WORLDS.filter((w) => w !== first && elig[w].ok);
  const ineligible = WORLDS.filter((w) => !elig[w].ok);
  const ranked = [first, ...eligible, ...ineligible];
  const reasons = Object.fromEntries(ranked.map((w) => [w, reasonFor(w, data, elig, first)]));
  return { ranked, reasons };
}

/** Bucket a scene graph v1 by what the GPU draws: instances + tube segments + surface data cells. */
export function renderWeight(graph) {
  const instances = (graph.batches ?? []).reduce((n, b) => n + b.instances.length, 0);
  const segments = (graph.tubes ?? []).reduce((n, t) => n + Math.max(0, t.points.length - 1), 0);
  const cells = (graph.surfaces ?? []).reduce((n, s) => n + s.cells.length, 0);
  const total = instances + segments + cells;
  if (total < LIGHT_MAX) return 'light';
  if (total < MEDIUM_MAX) return 'medium';
  return 'heavy';
}
