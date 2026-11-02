// Task 23: the `race` block, a bar chart race. Rows of { period, name, value } become one bar, label and counter per
// name that is ever in the top N, with a keyframe per period; the table-driven suite in blocks.test.mjs covers the
// example (valid, golden sheet, byte-identical twice, check.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BLOCKS, expandBlocks } from '../template/blocks/index.mjs';
import { rankByPeriod } from '../template/blocks/race.mjs';
import { flattenElements } from '../template/groups.mjs';
import { validateSpec } from '../scripts/lib/spec.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLES = path.join(root, 'references/examples/blocks');
const EPSILON = 1e-9;

const block = (params, extra = {}) => ({ id: 'r', type: 'block', x: 960, y: 540, block: 'race', params, ...extra });
const oneScene = (elements, extra = {}, duration = 6) => ({ ...extra, scenes: [{ id: 's', duration, elements }] });
const errs = (motion) => validateSpec(motion, { dir: EXAMPLES }).errors.map((e) => `${e.path}: ${e.message}`);
const partsOf = (spec) => flattenElements(spec.scenes[0].elements).map(({ el }) => el).filter((el) => el.type !== 'group');
const part = (spec, id) => partsOf(spec).find((el) => el.id === id);

// Three periods, four names. D (2) is outside the top three at P1 and P2, and takes C's place at P3.
const ROWS = [
  { period: 'P1', name: 'A', value: 10 }, { period: 'P1', name: 'B', value: 8 }, { period: 'P1', name: 'C', value: 6 }, { period: 'P1', name: 'D', value: 2 },
  { period: 'P2', name: 'A', value: 12 }, { period: 'P2', name: 'B', value: 11 }, { period: 'P2', name: 'C', value: 7 }, { period: 'P2', name: 'D', value: 5 },
  { period: 'P3', name: 'A', value: 13 }, { period: 'P3', name: 'B', value: 12 }, { period: 'P3', name: 'C', value: 9 }, { period: 'P3', name: 'D', value: 10 },
];
const PARAMS = { rows: ROWS, top: 3, periodSeconds: 1 };

test('rankByPeriod: periods in order of first appearance, each its top N by value desc, ranks from 0', () => {
  assert.deepEqual(rankByPeriod(ROWS, 3), [
    { period: 'P1', ranked: [{ name: 'A', value: 10, rank: 0 }, { name: 'B', value: 8, rank: 1 }, { name: 'C', value: 6, rank: 2 }] },
    { period: 'P2', ranked: [{ name: 'A', value: 12, rank: 0 }, { name: 'B', value: 11, rank: 1 }, { name: 'C', value: 7, rank: 2 }] },
    { period: 'P3', ranked: [{ name: 'A', value: 13, rank: 0 }, { name: 'B', value: 12, rank: 1 }, { name: 'D', value: 10, rank: 2 }] },
  ]);
});

test('rankByPeriod: ties break by name, a repeated name in one period keeps its last row, rows are not mutated', () => {
  const rows = [
    { period: '1', name: 'Zed', value: 5 }, { period: '1', name: 'Amy', value: 5 }, { period: '1', name: 'Bob', value: 5 },
    { period: '2', name: 'Amy', value: 1 }, { period: '2', name: 'Amy', value: 9 },
  ];
  const copy = structuredClone(rows);
  const [first, second] = rankByPeriod(rows, 3);
  assert.deepEqual(first.ranked.map((r) => r.name), ['Amy', 'Bob', 'Zed']);
  assert.deepEqual(second.ranked, [{ name: 'Amy', value: 9, rank: 0 }]);
  assert.deepEqual(rows, copy);
});

test('a name entering the top 3 at period 3 has opacity 0 before it and 1 once it is in', () => {
  const spec = expandBlocks(oneScene([block(PARAMS)], {}, 3));
  const d = part(spec, 'r/bar-4');
  const at = (t) => d.keyframes.find((kf) => Math.abs(kf.t - t) < EPSILON);
  assert.equal(at(1).opacity, 0, 'out of the top at P2');
  assert.equal(at(2).opacity, 1, 'in the top at P3');
  assert.ok(d.keyframes.every((kf) => kf.t >= 1 - EPSILON), 'nothing before the keyframe that holds it hidden');
  const c = part(spec, 'r/bar-3');
  assert.equal(c.keyframes.find((kf) => Math.abs(kf.t - 2) < EPSILON).opacity, 0, 'C drops out at P3');
  // Out of the top it waits one row below the last: the row of rank 3.
  const rowH = part(spec, 'r/bar-2').keyframes[0].y - part(spec, 'r/bar-1').keyframes[0].y;
  assert.equal(at(1).y, part(spec, 'r/bar-1').keyframes[0].y + 3 * rowH);
  assert.equal(at(2).ease, 'move');
});

test('bars are shape lines whose strokeWidth is 0.7 of the row and whose draw is value / the largest value of any row', () => {
  const spec = expandBlocks(oneScene([block(PARAMS)], {}, 3));
  const a = part(spec, 'r/bar-1');
  const b = part(spec, 'r/bar-2');
  const rowH = b.keyframes[0].y - a.keyframes[0].y;
  assert.deepEqual([a.type, a.shape], ['shape', 'line']);
  assert.ok(Math.abs(a.strokeWidth - 0.7 * rowH) <= 1, `strokeWidth ${a.strokeWidth} vs row ${rowH}`);
  assert.deepEqual(a.keyframes.map((kf) => kf.draw), [10 / 13, 12 / 13, 1].map((n) => Number(n.toFixed(4))));
  assert.deepEqual(b.keyframes.map((kf) => kf.draw), [8 / 13, 11 / 13, 12 / 13].map((n) => Number(n.toFixed(4))));
  assert.deepEqual([a.stroke, b.stroke, part(spec, 'r/bar-3').stroke, part(spec, 'r/bar-4').stroke], ['cat1', 'cat2', 'cat3', 'cat4']);
  assert.ok(a.width > 0 && a.width === b.width, 'every bar has the full length; draw sets how much shows');
});

test('counters carry the value, labels the name, and the rank sets the row', () => {
  const spec = expandBlocks(oneScene([block(PARAMS)], {}, 3));
  const value = part(spec, 'r/value-1');
  assert.equal(value.type, 'counter');
  assert.deepEqual(value.keyframes.map((kf) => kf.value), [10, 12, 13]);
  assert.equal(part(spec, 'r/name-4').text, 'D');
  const ys = ['bar-1', 'bar-2', 'bar-3'].map((id) => part(spec, `r/${id}`).keyframes[0].y);
  assert.ok(ys[0] < ys[1] && ys[1] < ys[2], 'rank 0 on top');
  assert.equal(part(spec, 'r/name-1').keyframes[0].y, ys[0], 'a label sits on its bar row');
});

test('one text per period: it fades in at its period and out at the next, and the last one stays', () => {
  const spec = expandBlocks(oneScene([block(PARAMS)], {}, 3));
  const labels = [1, 2, 3].map((i) => part(spec, `r/period-${i}`));
  assert.deepEqual(labels.map((el) => el.text), ['P1', 'P2', 'P3']);
  for (const [i, el] of labels.entries()) {
    const opacity = el.keyframes.filter((kf) => kf.opacity !== undefined);
    const shown = opacity.find((kf) => kf.opacity === 1);
    assert.ok(Math.abs(shown.t - i) < 0.5 + EPSILON && shown.t >= i - EPSILON, `period ${i + 1} is in by ${shown.t}`);
    if (i < 2) assert.equal(opacity.at(-1).opacity, 0, `period ${i + 1} is out again`);
    else assert.equal(opacity.at(-1).opacity, 1, 'the last period stays');
  }
});

test('a scene shorter than periods x periodSeconds is one error at params.periodSeconds, with the fix in the text', () => {
  const six = ['a', 'b', 'c', 'd', 'e', 'f'].flatMap((period) => ['W', 'X', 'Y', 'Z'].map((name, i) => ({ period, name, value: 10 - i })));
  assert.deepEqual(errs(oneScene([block({ rows: six })], {}, 5)), ['scenes[0].elements[0].params.periodSeconds: 6 periods × 1s need a scene of at least 6s']);
  assert.deepEqual(errs(oneScene([block({ rows: six, periodSeconds: 1.5 })], {}, 8)), ['scenes[0].elements[0].params.periodSeconds: 6 periods × 1.5s need a scene of at least 9s']);
  assert.deepEqual(errs(oneScene([block({ rows: six })], {}, 6)), []);
  assert.equal(BLOCKS.race.minDuration({ rows: six }), 6);
});

test('params limits: 4 to 200 rows, top 3 to 10, periodSeconds 0.5 to 4, names up to 24 characters', () => {
  const e = (params) => errs(oneScene([block(params)], {}, 6));
  assert.deepEqual(e({ rows: ROWS.slice(0, 3) }), ['scenes[0].elements[0].params.rows: must NOT have fewer than 4 items']);
  assert.deepEqual(e({ rows: ROWS, top: 2 }), ['scenes[0].elements[0].params.top: must be >= 3']);
  assert.deepEqual(e({ rows: ROWS, top: 11 }), ['scenes[0].elements[0].params.top: must be <= 10']);
  assert.deepEqual(e({ rows: ROWS, periodSeconds: 0.4 }), ['scenes[0].elements[0].params.periodSeconds: must be >= 0.5']);
  assert.deepEqual(e({ rows: ROWS, periodSeconds: 5 }), ['scenes[0].elements[0].params.periodSeconds: must be <= 4']);
  assert.deepEqual(e({ rows: [{ ...ROWS[0], name: 'x'.repeat(25) }, ...ROWS.slice(1)] }), ['scenes[0].elements[0].params.rows[0].name: must NOT have more than 24 characters']);
  assert.deepEqual(e({ rows: Array.from({ length: 201 }, () => ROWS[0]) }), ['scenes[0].elements[0].params.rows: must NOT have more than 200 items']);
});

test('200 rows stay small: keyframes exist only where a name is in the top or enters or leaves it, and nothing lands after the scene', () => {
  const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  const rows = Array.from({ length: 25 }, (_, p) => names.map((name, i) => ({ period: `Y${p}`, name, value: ((i * 7 + p * (i % 3 + 1)) % 40) + 1 }))).flat();
  assert.equal(rows.length, 200);
  const motion = oneScene([block({ rows, top: 5, periodSeconds: 0.5 })], {}, 12.5);
  assert.deepEqual(errs(motion), []);
  const parts = partsOf(expandBlocks(motion));
  const keyframes = parts.flatMap((el) => el.keyframes ?? []);
  assert.ok(keyframes.length < 25 * 8 * 3 + 100, `${keyframes.length} keyframes`);
  assert.ok(keyframes.every((kf) => kf.t <= 12.5 + EPSILON));
  const ids = parts.map((el) => el.id);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
});

test('a spec with one name and one period (smallest valid params, all values 0) expands without dividing by zero', () => {
  const rows = [0, 1, 2, 3].map(() => ({ period: 'Go', name: 'Go', value: 0 }));
  const spec = expandBlocks(oneScene([block({ rows })], {}, 1));
  const bar = part(spec, 'r/bar-1');
  assert.ok(Number.isFinite(bar.keyframes?.[0]?.draw ?? 0));
  assert.deepEqual(errs(oneScene([block({ rows })], {}, 1)), []);
});
