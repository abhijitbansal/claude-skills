// PADiagram.route (template/route.js) is DOM-free: it loads here with a bare
// `window`, in this realm (so deepEqual compares plain objects, not vm ones).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildDiagram } from '../scripts/lib/api.mjs';

const src = ['camera.js', 'route.js'].map((f) => fs.readFileSync(new URL(`../template/${f}`, import.meta.url), 'utf8')).join('\n');
const load = () => { const win = {}; new Function('window', src)(win); return win.PADiagram; };
const example = (name) => JSON.parse(fs.readFileSync(new URL(`../references/examples/${name}.diagram.json`, import.meta.url), 'utf8'));

// a -> b -> c and a -> c, with the undirected adjacency viewerData would build; d stands alone.
const triangle = {
  edges: { e1: ['a', 'b'], e2: ['b', 'c'], e3: ['a', 'c'] },
  directed: { a: ['e1', 'e3'], b: ['e2'] },
  adjacency: { a: { nodes: ['b', 'c'], edges: ['e1', 'e3'] }, b: { nodes: ['a', 'c'], edges: ['e1', 'e2'] }, c: { nodes: ['b', 'a'], edges: ['e2', 'e3'] }, d: { nodes: [], edges: [] } },
};

test('a directed route follows the arrows and takes the fewest hops', () => {
  const PAD = load();
  assert.deepEqual(PAD.route(triangle, 'a', 'c'), { from: 'a', to: 'c', hops: [{ edge: 'e3', from: 'a', to: 'c' }], directed: true });
  assert.deepEqual(PAD.route(triangle, 'a', 'b').hops, [{ edge: 'e1', from: 'a', to: 'b' }]);
  assert.deepEqual(PAD.route(triangle, 'b', 'c').hops, [{ edge: 'e2', from: 'b', to: 'c' }]);
});

test('against the arrows it falls back to ignoring direction and says so; nothing joining them gives no hops', () => {
  const PAD = load();
  assert.deepEqual(PAD.route(triangle, 'c', 'a'), { from: 'c', to: 'a', hops: [{ edge: 'e3', from: 'c', to: 'a' }], directed: false });
  assert.deepEqual(PAD.route(triangle, 'a', 'd'), { from: 'a', to: 'd', hops: [], directed: false });
  assert.deepEqual(PAD.route(triangle, 'b', 'b'), { from: 'b', to: 'b', hops: [], directed: true });
});

test('a route passes through a group an edge ends at, and a two-headed edge is walked from both ends', () => {
  const PAD = load();
  const grouped = { edges: { e1: ['a', 'g'], e2: ['g', 'b'], e3: ['b', 'c'] }, directed: { a: ['e1'], g: ['e2'], b: ['e3'], c: ['e3'] }, adjacency: {} };
  assert.deepEqual(PAD.route(grouped, 'a', 'c').hops, [{ edge: 'e1', from: 'a', to: 'g' }, { edge: 'e2', from: 'g', to: 'b' }, { edge: 'e3', from: 'b', to: 'c' }]);
  assert.deepEqual(PAD.route(grouped, 'c', 'b'), { from: 'c', to: 'b', hops: [{ edge: 'e3', from: 'c', to: 'b' }], directed: true });
});

test('a self edge is never a hop, and ids named like Object.prototype members work', () => {
  const PAD = load();
  const proto = {
    edges: { loop: ['constructor', 'constructor'], e: ['constructor', 'b'] },
    directed: { constructor: ['loop', 'e'] },
    adjacency: { constructor: { nodes: ['b'], edges: ['loop', 'e'] }, b: { nodes: ['constructor'], edges: ['e'] } },
  };
  assert.deepEqual(PAD.route(proto, 'constructor', 'b'), { from: 'constructor', to: 'b', hops: [{ edge: 'e', from: 'constructor', to: 'b' }], directed: true });
  assert.deepEqual(PAD.route(proto, 'b', 'constructor'), { from: 'b', to: 'constructor', hops: [{ edge: 'e', from: 'b', to: 'constructor' }], directed: false });
  assert.deepEqual(PAD.route({ edges: {}, directed: {}, adjacency: {} }, 'toString', 'valueOf').hops, [], 'empty data answers for nothing');
});

test('on the architecture example: web reaches db in two hops along the arrows; pay reaches web only ignoring them; web reaches the vpc group', async () => {
  const PAD = load();
  const { data } = await buildDiagram(example('architecture'));
  assert.deepEqual(PAD.route(data, 'web', 'db'), { from: 'web', to: 'db', hops: [{ edge: 'edge-0', from: 'web', to: 'api' }, { edge: 'edge-1', from: 'api', to: 'db' }], directed: true });
  assert.deepEqual(PAD.route(data, 'pay', 'web'), { from: 'pay', to: 'web', hops: [{ edge: 'edge-2', from: 'pay', to: 'api' }, { edge: 'edge-0', from: 'api', to: 'web' }], directed: false });
  assert.deepEqual(PAD.route(data, 'web', 'vpc'), { from: 'web', to: 'vpc', hops: [{ edge: 'edge-3', from: 'web', to: 'vpc' }], directed: true });
  assert.deepEqual(PAD.route(data, 'pay', 'vpc').hops.map((h) => h.edge), ['edge-2', 'edge-0', 'edge-3']);
});
