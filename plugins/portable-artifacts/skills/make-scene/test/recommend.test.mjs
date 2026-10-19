import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recommend, renderWeight, eligibility, TERRAIN_FILL, LIGHT_MAX, MEDIUM_MAX } from '../scripts/lib/recommend.mjs';

const GROUPS = ['a', 'b', 'c', 'd'];
const grid = (ts, skip = () => false) =>
  GROUPS.flatMap((group, gi) => ts.flatMap((t, ti) => (skip(gi, ti) ? [] : [{ group, t, value: gi + ti + 1 }])));
const WEEKS = ['2026-W01', '2026-W02', '2026-W03', '2026-W04', '2026-W05'];

test('links rank galaxy first', () => {
  const rows = [{ group: 'a', value: 1 }, { group: 'b', value: 2 }];
  const { ranked } = recommend({ rows, links: [{ from: 'a', to: 'b' }] });
  assert.equal(ranked[0], 'galaxy');
});

test('links win over parent and a dense grid', () => {
  const rows = grid(WEEKS).map((r) => ({ ...r, parent: 'a' }));
  assert.equal(recommend({ rows, links: [{ from: 'a', to: 'b' }] }).ranked[0], 'galaxy');
});

test('parent ranks forest first', () => {
  const rows = [{ group: 'root', value: 1 }, { group: 'kid', value: 2, parent: 'root' }];
  assert.equal(recommend({ rows, links: [] }).ranked[0], 'forest');
});

test('dense grid ranks terrain first', () => {
  const { ranked, reasons } = recommend({ rows: grid(WEEKS), links: [] });
  assert.equal(ranked[0], 'terrain');
  assert.match(reasons.terrain, /grid/);
});

test('numeric t counts as time-like for terrain', () => {
  assert.equal(recommend({ rows: grid([1, 2, 3, 4]), links: [] }).ranked[0], 'terrain');
});

test('sparse grid does not pick terrain', () => {
  // 4 groups x 5 weeks, keep 8 of 20 cells (40%)
  const rows = grid(WEEKS, (gi, ti) => (gi + ti) % 5 >= 2);
  assert.ok(rows.length / 20 < TERRAIN_FILL);
  const { ranked } = recommend({ rows, links: [] });
  assert.equal(ranked[0], 'city');
});

test('grid exactly at the fill threshold picks terrain', () => {
  // 3 groups x 5 ts = 15 cells; keep 9 = 60%
  const rows = ['a', 'b', 'c'].flatMap((group, gi) => [1, 2, 3, 4, 5].flatMap((t, ti) => ((gi * 5 + ti) % 5 < 3 ? [{ group, t, value: 1 }] : [])));
  assert.equal(rows.length / 15, TERRAIN_FILL);
  assert.equal(recommend({ rows, links: [] }).ranked[0], 'terrain');
});

test('non-time-like t does not pick terrain', () => {
  const rows = grid(['alpha', 'beta', 'gamma']);
  const { ranked } = recommend({ rows, links: [] });
  assert.equal(ranked[0], 'city');
});

test('no t: terrain not available', () => {
  const rows = [{ group: 'a', value: 1 }, { group: 'b', value: 2 }];
  const { ranked, reasons } = recommend({ rows, links: [] });
  assert.equal(ranked[0], 'city');
  assert.equal(ranked.at(-1), 'terrain');
  assert.match(reasons.terrain, /^not available: needs t on every row$/);
  assert.equal(eligibility({ rows, links: [] }).terrain.ok, false);
});

test('t without a dense grid falls to city, rest in fixed order', () => {
  const rows = [{ group: 'a', t: '2026-W01', value: 1 }, { group: 'b', t: '2026-W02', value: 2 }];
  const { ranked } = recommend({ rows, links: [] });
  assert.deepEqual(ranked, ['city', 'forest', 'galaxy', 'terrain']);
});

test('remaining eligible worlds follow in fixed order, ineligible last', () => {
  const rows = [{ group: 'a', value: 1 }, { group: 'b', value: 2 }];
  assert.deepEqual(recommend({ rows, links: [{ from: 'a', to: 'b' }] }).ranked, ['galaxy', 'city', 'forest', 'terrain']);
});

test('every ranked world has a reason', () => {
  const { ranked, reasons } = recommend({ rows: grid(WEEKS), links: [] });
  for (const w of ranked) assert.equal(typeof reasons[w], 'string');
  assert.deepEqual(Object.keys(reasons).sort(), [...ranked].sort());
});

test('duplicate group x t cells make terrain ineligible even when dense', () => {
  const rows = [...grid(WEEKS), { group: 'a', t: '2026-W01', value: 9 }];
  const { ranked } = recommend({ rows, links: [] });
  assert.notEqual(ranked[0], 'terrain');
  assert.equal(ranked.at(-1), 'terrain');
});

test('weights at thresholds', () => {
  const g = (instances) => ({ batches: [{ instances: Array.from({ length: instances }, () => [0, 0, 0, 1, 1, 1, 0]) }] });
  assert.equal(renderWeight(g(LIGHT_MAX - 1)), 'light');
  assert.equal(renderWeight(g(LIGHT_MAX)), 'medium');
  assert.equal(renderWeight(g(MEDIUM_MAX - 1)), 'medium');
  assert.equal(renderWeight(g(MEDIUM_MAX)), 'heavy');
});

test('weight sums instances, tube segments and surface cells', () => {
  const graph = {
    batches: [{ instances: new Array(1000).fill([]) }, { instances: new Array(500).fill([]) }],
    tubes: [{ points: new Array(701).fill([]) }, { points: new Array(1).fill([]) }],
    surfaces: [{ nx: 11, nz: 81, cells: new Array(800).fill(0) }],
  };
  // 1500 + 700 + 0 + 800 = 3000
  assert.equal(renderWeight(graph), 'medium');
  graph.surfaces[0].cells.pop(); // 2999
  assert.equal(renderWeight(graph), 'light');
});

test('weight tolerates missing arrays', () => {
  assert.equal(renderWeight({}), 'light');
});

test('weight counts a surface by its data cells, not its vertices', () => {
  // 55x55 vertices = 3025 (would be medium); 54x54 cells = 2916 (light)
  const surfaces = [{ nx: 55, nz: 55, cells: new Array(54 * 54).fill(0) }];
  assert.equal(renderWeight({ surfaces }), 'light');
});

test('terrain reason says so when t is not numeric or time-like', () => {
  const rows = [{ group: 'a', t: 'alpha', value: 1 }, { group: 'b', t: 'beta', value: 2 }];
  const { reasons } = recommend({ rows, links: [] });
  assert.equal(reasons.terrain, 'a surface needs t to be numeric or time-like, so the grid has no order');
});

test('terrain reason with no rows has no null in it', () => {
  const { reasons } = recommend({ rows: [], links: [] });
  assert.doesNotMatch(reasons.terrain, /null|NaN|undefined/);
  assert.match(reasons.terrain, /numeric or time-like/);
});

test('terrain reason reports the fill percentage for a time grid', () => {
  assert.equal(recommend({ rows: grid(WEEKS), links: [] }).reasons.terrain, 'group x t grid is 100% filled: a surface fits');
});
