// Which worlds a set of rows can feed. One source of truth: the validator
// rejects an explicit `world` the data fails, and recommend.mjs (Task 4)
// ranks the eligible ones and prints "not available: needs ..." for the rest.
export const WORLDS = ['city', 'forest', 'galaxy', 'terrain'];

const NEEDS_T = 'terrain needs t on every row';
const NEEDS_UNIQUE = 'terrain needs exactly one row per group and t';

function terrainNeeds(rows) {
  if (rows.some((r) => r.t === undefined)) return NEEDS_T;
  const seen = new Set();
  for (const r of rows) {
    const key = `${r.group}\u0000${r.t}`;
    if (seen.has(key)) return NEEDS_UNIQUE;
    seen.add(key);
  }
  return null;
}

/** @returns {Record<'city'|'forest'|'galaxy'|'terrain', { ok: boolean, needs?: string }>} */
export function eligibility({ rows }) {
  const needs = terrainNeeds(rows);
  return {
    city: { ok: true },
    forest: { ok: true },
    galaxy: { ok: true },
    terrain: needs === null ? { ok: true } : { ok: false, needs },
  };
}
