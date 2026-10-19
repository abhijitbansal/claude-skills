import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyGraph, round3, finalizeGraph, assertGraph, tableFallback } from '../scripts/lib/graph.mjs';
import { groupColour, itemsFrom, compareT } from '../scripts/lib/palette.mjs';
import { InternalError } from '../scripts/lib/internal-error.mjs';

const sample = () => {
  const g = emptyGraph('city', { title: 'T', units: 'commits' });
  g.items = [{ id: 'i0', label: 'a', group: 0, value: 1, display: '1 commits' }];
  g.groups = [{ name: 'A', colour: 'cat1' }];
  g.batches = [{ id: 'b0', shape: 'box', colour: 'cat1', emissive: null, flat: false, instances: [[0, 1, 0, 2, 2, 2, 0]] }];
  g.focus = { API: { position: [1, 2, 3], target: [0, 0, 0] } };
  return g;
};

test('round3 rounds to three decimals and never returns negative zero', () => {
  assert.equal(round3(1.23456), 1.235);
  assert.equal(round3(-0.0001), 0);
  assert.ok(Object.is(round3(-0.0001), 0));
});

test('emptyGraph has every contract field', () => {
  const g = emptyGraph('forest', { title: 'T' });
  for (const k of ['v', 'kind', 'title', 'units', 'bounds', 'camera', 'env', 'groups', 'items', 'batches', 'tubes', 'surfaces', 'labels', 'anim', 'focus', 'tour', 'fallback']) {
    assert.ok(k in g, k);
  }
  assert.equal(g.v, 1);
  assert.equal(g.units, '');
});

test('finalizeGraph computes bounds from instances and a camera that looks at the centre', () => {
  const g = finalizeGraph(sample());
  assert.deepEqual(g.bounds, { min: [-1, 0, -1], max: [1, 2, 1] });
  assert.deepEqual(g.camera.target, [0, 1, 0]);
  const [x, y, z] = g.camera.position;
  assert.ok(x > 1 && y > 1 && z > 1, 'camera sits outside the bounds on the +x +y +z side');
});

test('finalizeGraph keeps a camera the world already set', () => {
  const g = sample();
  g.camera = { position: [9, 9, 9], target: [1, 1, 1] };
  assert.deepEqual(finalizeGraph(g).camera, { position: [9, 9, 9], target: [1, 1, 1] });
});

test('finalizeGraph lowercases focus keys and rounds numbers', () => {
  const g = sample();
  g.batches[0].instances[0][0] = 1.23456;
  const out = finalizeGraph(g);
  assert.deepEqual(Object.keys(out.focus), ['api']);
  assert.equal(out.batches[0].instances[0][0], 1.235);
});

test('finalizeGraph does not mutate its input', () => {
  const g = sample();
  g.batches[0].instances[0][0] = 1.23456;
  finalizeGraph(g);
  assert.equal(g.batches[0].instances[0][0], 1.23456);
  assert.deepEqual(Object.keys(g.focus), ['API']);
});

test('finalizeGraph names the path of a non-finite number', () => {
  const g = sample();
  g.batches[0].instances[0][4] = NaN;
  assert.throws(() => finalizeGraph(g), (e) => e instanceof InternalError && /batches\[0\]\.instances\[0\]\[4\]/.test(e.message));
});

test('finalizeGraph bounds include tubes and surfaces', () => {
  const g = emptyGraph('terrain', { title: 'T' });
  g.surfaces = [{ id: 's0', nx: 2, nz: 2, size: [10, 6, 4], heights: [0, 0, 0, 0], bands: [], cells: [-1] }];
  g.tubes = [{ id: 'e0', points: [[8, 0, 0], [9, 1, 0]], radius: 0.5, colour: 'line', item: null }];
  const out = finalizeGraph(g);
  assert.deepEqual(out.bounds, { min: [-5, -0.5, -3], max: [9.5, 4, 3] });
});

test('assertGraph accepts a finalized graph and rejects structural breakage', () => {
  const ok = finalizeGraph(sample());
  assert.doesNotThrow(() => assertGraph(ok));
  const badItem = structuredClone(ok);
  badItem.batches[0].instances[0][6] = 5;
  assert.throws(() => assertGraph(badItem), /batches\[0\]\.instances\[0\]/);
  const badShape = structuredClone(ok);
  badShape.batches[0].shape = 'torus';
  assert.throws(() => assertGraph(badShape), /batches\[0\]\.shape/);
  const badHeights = structuredClone(ok);
  badHeights.surfaces = [{ id: 's0', nx: 2, nz: 2, size: [1, 1, 1], heights: [0], bands: [], cells: [] }];
  assert.throws(() => assertGraph(badHeights), /surfaces\[0\]\.heights/);
  const badKind = structuredClone(ok);
  badKind.kind = 'moon';
  assert.throws(() => assertGraph(badKind), /kind/);
});

test('groupColour maps 0-7 to cat tokens and lightens past eight', () => {
  assert.equal(groupColour(0), 'cat1');
  assert.equal(groupColour(7), 'cat8');
  assert.deepEqual(groupColour(8), { base: '#ffffff', tint: 'cat1', share: 0.6 });
  assert.deepEqual(groupColour(10), { base: '#ffffff', tint: 'cat3', share: 0.6 });
});

test('itemsFrom builds label, group index and display with en-US grouping', () => {
  const rows = [
    { group: 'api', t: '2026-W30', value: 12345.6789 },
    { group: 'web', value: 2, label: 'Web' },
    { group: 'api', t: 3, value: 0 },
  ];
  const items = itemsFrom(rows, 'commits');
  assert.deepEqual(items.map((i) => i.group), [0, 1, 0]);
  assert.deepEqual(items.map((i) => i.id), ['i0', 'i1', 'i2']);
  assert.equal(items[0].display, '12,345.6789 commits');
  assert.equal(items[0].label, 'api · 2026-W30');
  assert.equal(items[1].label, 'Web');
  assert.equal(items[2].t, '3');
  assert.equal(itemsFrom([{ group: 'a', value: 1 }], '')[0].display, '1');
});

test('compareT orders numbers numerically, then strings, with t-less rows last', () => {
  const ts = ['b', 10, 2, 'a', undefined].sort(compareT);
  assert.deepEqual(ts, [2, 10, 'a', 'b', undefined]);
});

test('tableFallback lists every row as strings', () => {
  const fb = tableFallback([{ group: 'api', t: 3, value: 1.5 }, { group: 'web', value: 2 }]);
  assert.deepEqual(fb, { kind: 'table', columns: ['group', 't', 'value'], rows: [['api', '3', '1.5'], ['web', '', '2']], svg: null });
});

test('groupColour: 24 groups give 24 pairwise-distinct ColourRefs (lighter step, then darker step)', () => {
  const refs = Array.from({ length: 24 }, (_, i) => JSON.stringify(groupColour(i)));
  assert.equal(new Set(refs).size, 24);
  assert.deepEqual(groupColour(8), { base: '#ffffff', tint: 'cat1', share: 0.6 });
  assert.deepEqual(groupColour(16), { base: '#000000', tint: 'cat1', share: 0.6 });
  assert.deepEqual(groupColour(23), { base: '#000000', tint: 'cat8', share: 0.6 });
});

test('finalizeGraph keeps focus keys that are Object.prototype names, including __proto__', () => {
  const g = sample();
  g.focus = Object.fromEntries([
    ['constructor', { position: [1, 1, 1], target: [0, 0, 0] }],
    ['__proto__', { position: [2, 2, 2], target: [0, 0, 0] }],
    ['toString', { position: [3, 3, 3], target: [0, 0, 0] }],
  ]);
  const out = finalizeGraph(g);
  assert.deepEqual(Object.keys(out.focus), ['constructor', '__proto__', 'tostring']);
  assert.ok(Object.hasOwn(out.focus, '__proto__'));
  assert.equal(Object.getPrototypeOf(out.focus), Object.prototype);
  assert.deepEqual(out.focus['__proto__'].position, [2, 2, 2]);
  assert.doesNotThrow(() => assertGraph(out));
});

test('finalizeGraph does not round items[].value and display keeps the exact value', () => {
  const g = sample();
  g.items = [{ id: 'i0', label: 'a', group: 0, value: 0.0002, display: '0.0002 u' }];
  g.batches = [];
  const out = finalizeGraph(g);
  assert.equal(out.items[0].value, 0.0002);
  assert.equal(out.items[0].display, '0.0002 u');
  const bad = sample();
  bad.items[0].value = Infinity;
  assert.throws(() => finalizeGraph(bad), /items\[0\]\.value/);
});

test('itemsFrom display shows the exact value with en-US grouping', () => {
  const [a, b, c] = itemsFrom([{ group: 'g', value: 0.0002 }, { group: 'g', value: 1234567.891234 }, { group: 'g', value: 0.1 + 0.2 }], 'u');
  assert.equal(a.display, '0.0002 u');
  assert.equal(b.display, '1,234,567.891234 u');
  assert.equal(c.display, '0.30000000000000004 u');
});

test('assertGraph rejects a surface size without exactly 3 finite numbers; finalizeGraph never defaults sy', () => {
  const ok = finalizeGraph(sample());
  for (const size of [[1, 1], [1, 1, 1, 1], [1, 1, NaN], 'big']) {
    const bad = structuredClone(ok);
    bad.surfaces = [{ id: 's0', nx: 2, nz: 2, size, heights: [0, 0, 0, 0], bands: [], cells: [] }];
    assert.throws(() => assertGraph(bad), /surfaces\[0\]\.size/, JSON.stringify(size));
  }
  const raw = emptyGraph('terrain', { title: 'T' });
  raw.surfaces = [{ id: 's0', nx: 2, nz: 2, size: [10, 6], heights: [0, 0, 0, 0], bands: [], cells: [] }];
  assert.throws(() => finalizeGraph(raw), /surfaces\[0\]\.size/);
});

test('finalizeGraph bounds include every orbit disc (centre +/- max r in x and z)', () => {
  const g = sample();
  g.anim = { sway: [], orbits: [{ batch: 'b0', center: [4, 1, -2], r: [1.5, 6], phase: [0, 1], speed: [1, 1] }] };
  const out = finalizeGraph(g);
  assert.equal(out.bounds.max[0], 10);
  assert.equal(out.bounds.min[0], -2);
  assert.equal(out.bounds.max[2], 4);
  assert.equal(out.bounds.min[2], -8);
  assert.equal(out.bounds.max[1], 2, 'orbits are flat: y is untouched');
});

test('assertGraph checks optional tube label/display and fallback.links', () => {
  const ok = finalizeGraph({ ...sample(), tubes: [{ id: 'e0', points: [[0, 0, 0], [1, 0, 0]], radius: 0.05, colour: 'text2', item: null, label: 'a → b', display: '3 commits' }],
    fallback: { ...tableFallback([]), links: { columns: ['from', 'to', 'value'], rows: [['a', 'b', '3 commits']] } } });
  assert.doesNotThrow(() => assertGraph(ok));
  const tube = (extra) => ({ ...ok, tubes: [{ ...ok.tubes[0], ...extra }] });
  assert.throws(() => assertGraph(tube({ label: 5 })), /tubes\[0\]\.label/);
  assert.throws(() => assertGraph(tube({ display: 5 })), /tubes\[0\]\.display/);
  assert.throws(() => assertGraph({ ...ok, fallback: { ...ok.fallback, links: { columns: ['from', 'to', 'value'], rows: [['a', 'b']] } } }), /fallback\.links\.rows\[0\]/);
  assert.throws(() => assertGraph({ ...ok, fallback: { ...ok.fallback, links: { columns: ['x'], rows: [] } } }), /fallback\.links\.columns/);
  assert.doesNotThrow(() => assertGraph({ ...ok, tubes: [{ ...ok.tubes[0], label: undefined, display: undefined }], fallback: tableFallback([]) }));
});
