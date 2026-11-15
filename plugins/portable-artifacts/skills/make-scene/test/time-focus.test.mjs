// PA-47: inline rows with an all-numeric text t order as numbers (as the CSV path already does), and a tour beat may
// focus a t value (a week) next to a group or a label. The validator and every world agree on what a beat can name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSpec } from '../scripts/lib/spec.mjs';
import { buildScene } from '../scripts/lib/api.mjs';
import { loadData, focusKeys } from '../scripts/lib/rows.mjs';
import { recommend } from '../scripts/lib/recommend.mjs';

const WORLDS = ['city', 'forest', 'galaxy', 'terrain'];
const weeks = ['2026-W30', '2026-W31', '2026-W32'];
const gridRows = () => ['api', 'web'].flatMap((group, g) => weeks.map((t, i) => ({ group, t, value: 3 + g + i })));
const scene = (extra = {}) => ({ title: 'T', data: { rows: gridRows() }, ...extra });
const validate = (spec) => validateSpec(spec, { dir: process.cwd() });

test('inline rows with t "1", "2", "10" order as 1, 2, 10, and the spec is left as written', () => {
  const spec = { title: 'T', data: { rows: [{ group: 'a', t: '10', value: 1 }, { group: 'a', t: '2', value: 2 }, { group: 'a', t: '1', value: 3 }] } };
  const before = JSON.stringify(spec);
  const { rows } = loadData(spec, process.cwd());
  assert.deepEqual(rows.map((r) => r.t), [10, 2, 1], 'numbers, in the order given');
  assert.equal(JSON.stringify(spec), before, 'the caller\'s rows are not retyped');
});

test('a city of numeric-string t puts t "10" after t "2"', async () => {
  const rows = ['1', '2', '10'].map((t, i) => ({ group: 'a', t, value: i + 1 }));
  const { graph } = await buildScene({ title: 'T', world: 'city', data: { rows } }, { dir: process.cwd() });
  const xOf = (t) => graph.batches.flatMap((b) => b.instances).find((i) => graph.items[i[6]].t === t)[0];
  assert.ok(xOf('1') < xOf('2') && xOf('2') < xOf('10'), `x of 1, 2, 10: ${xOf('1')}, ${xOf('2')}, ${xOf('10')}`);
});

test('a t column that is not all numbers stays text', () => {
  const rows = [{ group: 'a', t: '1', value: 1 }, { group: 'a', t: 'W2', value: 1 }];
  assert.deepEqual(loadData({ title: 'T', data: { rows } }, process.cwd()).rows.map((r) => r.t), ['1', 'W2']);
});

test('t "01", "02" keeps its text, so a beat may focus "01" as written', async () => {
  const rows = ['01', '02'].map((t, i) => ({ group: 'a', t, value: i + 1 }));
  const { rows: loaded } = loadData({ title: 'T', data: { rows } }, process.cwd());
  assert.deepEqual(loaded.map((r) => r.t), ['01', '02'], 'a value that would not print back as written stays text');
  const r = await validate({ title: 'T', data: { rows }, tour: [{ title: 'One', focus: ['01'] }] });
  assert.deepEqual(r, { ok: true, errors: [] });
});

test('loading rows never changes which world is recommended: year strings and numeric strings rank as written', () => {
  const cases = { years: ['2024', '2025', '2026'], numbers: ['1', '2', '3'], padded: ['01', '02', '03'], decimals: ['1.50', '2.50', '3.50'] };
  for (const [name, ts] of Object.entries(cases)) {
    const rows = ['api', 'web'].flatMap((group) => ts.map((t, i) => ({ group, t, value: i + 1 })));
    const loaded = loadData({ title: 'T', data: { rows } }, process.cwd());
    assert.deepEqual(recommend(loaded), recommend({ rows, links: [] }), name);
  }
  const years = ['api', 'web'].flatMap((group) => ['2024', '2025', '2026'].map((t, i) => ({ group, t, value: i + 1 })));
  assert.equal(recommend(loadData({ title: 'T', data: { rows: years } }, process.cwd())).ranked[0], 'city', 'a column of years reads as time');
});

test('focusKeys lists the t values next to groups and labels', () => {
  const keys = focusKeys([{ group: 'API', t: '2026-W30', value: 1, label: 'Spike' }, { group: 'API', t: 3, value: 1 }]);
  assert.deepEqual([...keys].sort(), ['2026-w30', '3', 'api', 'spike']);
});

test('a tour beat may focus a week; a week that is not in the data is refused with a suggestion', async () => {
  assert.deepEqual(await validate(scene({ tour: [{ title: 'W31', focus: ['2026-W31'] }] })), { ok: true, errors: [] });
  const r = await validate(scene({ tour: [{ title: 'W', focus: ['2026-W33'] }] }));
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].path, 'tour[0].focus[0]');
  assert.match(r.errors[0].message, /^"2026-W33" is not a group, label or t value; did you mean "2026-w3\d"\?$/);
});

test('without any t the refusal still says group or label', async () => {
  const r = await validate({ title: 'T', data: { rows: [{ group: 'api', value: 1 }] }, tour: [{ title: 'W', focus: ['wbe'] }] });
  assert.match(r.errors[0].message, /^"wbe" is not a group or label; /);
});

for (const world of WORLDS) {
  test(`${world}: a beat that names a week resolves to a view in the graph, so the camera moves`, async () => {
    const spec = scene({ world, tour: [{ title: 'Week 31', caption: 'the busy one', focus: ['2026-W31'] }] });
    assert.equal((await validate(spec)).ok, true);
    const { graph } = await buildScene(spec, { dir: process.cwd() });
    assert.ok(Object.hasOwn(graph.focus, '2026-w31'), `focus keys: ${Object.keys(graph.focus).join(', ')}`);
    assert.equal(graph.tour[0].focus, '2026-w31');
  });
}

test('city: a week view looks at the middle of that week\'s column, not at one district', async () => {
  const spec = scene({ world: 'city', tour: [{ title: 'Week 32', focus: ['2026-W32'] }] });
  const { graph } = await buildScene(spec, { dir: process.cwd() });
  const column = graph.batches.flatMap((b) => b.instances).filter((i) => graph.items[i[6]].t === '2026-W32');
  assert.equal(column.length, 2);
  const [x, , z] = graph.focus['2026-w32'].target;
  assert.ok(Math.abs(x - column[0][0]) < 0.01, 'the target is over the column');
  const [lo, hi] = [Math.min(...column.map((i) => i[2])), Math.max(...column.map((i) => i[2]))];
  assert.ok(z > lo && z < hi, `the target z ${z} is between the two districts (${lo}..${hi})`);
});

test('a group or label that is also a t value keeps its own view', async () => {
  const rows = [{ group: '2026-W31', t: '2026-W31', value: 5 }, { group: 'web', t: '2026-W31', value: 2 }];
  const { graph } = await buildScene({ title: 'T', world: 'city', data: { rows }, tour: [{ title: 'W', focus: ['2026-W31'] }] }, { dir: process.cwd() });
  const district = graph.batches.flatMap((b) => b.instances).find((i) => graph.items[i[6]].group === 0);
  assert.ok(Math.abs(graph.focus['2026-w31'].target[2] - district[2]) < 0.01, 'the district named 2026-W31 wins');
});
