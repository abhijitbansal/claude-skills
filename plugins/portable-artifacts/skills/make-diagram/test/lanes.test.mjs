// stretchLanes (scripts/lib/lanes.mjs): stacked top-level groups read as lanes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stretchLanes } from '../scripts/lib/lanes.mjs';
import { layoutDiagram } from '../scripts/lib/layout.mjs';
import { lintGeometry } from '../scripts/lib/lint.mjs';
import { loadTheme } from '../shared/theme.mjs';

const theme = loadTheme('blueprint');
const group = (id, x, y, width, height, parent = null) => ({ id, x, y, width, height, label: id, depth: parent ? 1 : 0, parent });
const geometry = (groups, edges = []) => ({ width: 400, height: 400, nodes: [], edges, layers: [], groups });

test('two top-level groups stacked vertically stretch to a common left and right; the input is untouched', () => {
  const g = geometry([group('a', 24, 24, 150, 100), group('b', 60, 160, 300, 100)]);
  const out = stretchLanes(g);
  assert.deepEqual(out.groups.map((x) => [x.x, x.width]), [[24, 336], [24, 336]]);
  assert.deepEqual(out.groups.map((x) => [x.y, x.height]), [[24, 100], [160, 100]], 'heights and tops stay');
  assert.equal(g.groups[0].width, 150, 'a new geometry, not a mutation');
  assert.notEqual(out, g);
});

test('groups beside each other, a single group, or a nested group: nothing moves', () => {
  const beside = geometry([group('a', 24, 24, 150, 100), group('b', 200, 50, 100, 100)]);
  assert.equal(stretchLanes(beside), beside, 'the same object back');
  const single = geometry([group('a', 24, 24, 150, 100)]);
  assert.equal(stretchLanes(single), single);
  const nested = geometry([group('a', 24, 24, 300, 200), group('c', 40, 60, 100, 50, 'a'), group('b', 24, 240, 100, 50)]);
  const out = stretchLanes(nested);
  assert.deepEqual(out.groups.map((x) => [x.id, x.x, x.width]), [['a', 24, 300], ['c', 40, 100], ['b', 24, 300]], 'top-level a and b become lanes; nested c keeps its box');
});

test('no stretching when an edge ends at a top-level group: its arrow would land inside the lane', () => {
  const g = geometry([group('a', 24, 24, 150, 100), group('b', 60, 160, 300, 100)], [{ id: 'e', from: 'x', to: 'b', points: [] }]);
  assert.equal(stretchLanes(g), g);
});

test('through layoutDiagram: a down-flow with two groups becomes two lanes and still lints; two groups beside each other do not', async () => {
  const flow = {
    title: 't', type: 'flow', direction: 'down',
    groups: [{ id: 'in', label: 'Intake' }, { id: 'out', label: 'A much longer fulfilment lane label' }],
    nodes: [{ id: 'a', label: 'A', group: 'in' }, { id: 'b', label: 'B', group: 'out' }],
    edges: [{ from: 'a', to: 'b' }],
  };
  const g = await layoutDiagram(flow, theme);
  const [i, o] = g.groups;
  assert.equal(i.x, o.x);
  assert.equal(i.width, o.width);
  assert.ok(i.y + i.height <= o.y, 'stacked');
  assert.deepEqual(lintGeometry(g, { theme }), []);
  const arch = {
    title: 't', type: 'architecture',
    groups: [{ id: 'l', label: 'Left' }, { id: 'r', label: 'Right' }],
    nodes: [{ id: 'a', label: 'A', group: 'l' }, { id: 'b', label: 'B', group: 'r' }],
    edges: [{ from: 'a', to: 'b' }],
  };
  const h = await layoutDiagram(arch, theme);
  assert.ok(h.groups[0].x + h.groups[0].width <= h.groups[1].x, 'beside each other: not lanes');
});

const node = (id, x, y, group = null) => ({ id, x, y, width: 80, height: 40, group, lines: [id] });

test('no stretching when an ungrouped node sits in the band a lane would grow into', () => {
  const g = { ...geometry([group('a', 24, 24, 150, 100), group('b', 24, 160, 300, 100)]), nodes: [node('m', 40, 40, 'a'), node('f', 200, 40), node('n', 40, 180, 'b')] };
  assert.equal(stretchLanes(g), g, 'f lies where lane a would reach; lanes would claim it');
});

test('no stretching when a node of another lane lies in the grown band; member nodes do not block', () => {
  const nested = [group('a', 24, 24, 150, 100), group('c', 30, 30, 100, 60, 'a'), group('b', 24, 160, 300, 100)];
  const ok = { ...geometry(nested), nodes: [node('m', 40, 40, 'c'), node('n', 40, 180, 'b')] };
  assert.notEqual(stretchLanes(ok), ok, 'only members: still stretches');
  const bad = { ...geometry(nested), nodes: [node('m', 40, 40, 'c'), node('n', 200, 40, 'b')] };
  assert.equal(stretchLanes(bad), bad);
});

test('lint: a node outside a group may not lie inside its box', () => {
  const g = { ...geometry([group('a', 24, 24, 300, 100)]), nodes: [node('f', 200, 40), node('m', 40, 40, 'a')] };
  const errs = lintGeometry({ ...g, nodes: g.nodes.map((n) => ({ ...n, shape: 'rect', noteLine: null, icon: null, emoji: null })) }, { theme });
  assert.ok(errs.some((e) => /not in group/.test(e.message) && e.path === 'nodes[0]'), JSON.stringify(errs));
});

test('through layoutDiagram: two groups plus an ungrouped node never lint-fail from lane stretching', async () => {
  const spec = {
    title: 't', type: 'flow', direction: 'down',
    groups: [{ id: 'g1', label: 'One' }, { id: 'g2', label: 'Two' }],
    nodes: [{ id: 'a', label: 'A', group: 'g1' }, { id: 'b', label: 'B', group: 'g2' }, { id: 'c', label: 'C' }, { id: 'd', label: 'D', group: 'g1' }],
    edges: [{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }, { from: 'c', to: 'd' }],
  };
  const g = await layoutDiagram(spec, theme);
  assert.deepEqual(lintGeometry(g, { theme }), []);
});
