// The `diagram` kind (plan 2026-11-16-pa2-shot-kinds-b, Task 6): two to seven nodes in one of four designed layouts
// (row, column, cycle, hub), edges that draw on once both ends are on, node and edge labels at one size.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import { sample } from '../../engine/time/track.mjs';
import { centres, edgePoint } from '../../engine/kinds/diagram-layout.mjs';
import { validateFilm } from '../../scripts/v2/spec.mjs';
import { expandIn, filmOf, all, overlaps, canvasOf } from './helpers/kinds.mjs';
import { assertBar } from './helpers/bar.mjs';

const diagram = registries.kinds.get('diagram');
const NODES3 = [{ id: 'client', label: 'Client' }, { id: 'cache', label: 'Cache' }, { id: 'db', label: 'Database' }];
const base = (extra = {}) => ({ id: 'd', show: 'diagram', nodes: NODES3, edges: [{ from: 'client', to: 'cache' }, { from: 'cache', to: 'db' }], ...extra });
const expand = (shot, look = 'desk', format = '16:9') => expandIn(filmOf([shot], look, format));
const errorsOf = (shot) => validateFilm({ version: 2, shots: [shot] }, { specDir: '.' }).errors;
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.05, `${msg}: ${a} vs ${b}`);

// ---- geometry (hand-computed) ----

const AREA = { x: 0, y: 0, w: 1000, h: 400 };
test('centres: a row and a column of three, spaced by the gap and centred in the area', () => {
  const row = centres('row', 3, AREA, [200, 100], 100);
  [[200, 200], [500, 200], [800, 200]].forEach(([x, y], k) => { near(row[k][0], x, `row ${k} x`); near(row[k][1], y, `row ${k} y`); });
  const col = centres('column', 3, { x: 0, y: 0, w: 400, h: 1000 }, [200, 100], 100);
  [[200, 300], [200, 500], [200, 700]].forEach(([x, y], k) => { near(col[k][0], x, `col ${k} x`); near(col[k][1], y, `col ${k} y`); });
});

test('centres: a cycle of three starts at the top and goes clockwise on the ellipse inside the area', () => {
  const c = centres('cycle', 3, AREA, [200, 100], 0);
  [[500, 50], [846.41, 275], [153.59, 275]].forEach(([x, y], k) => { near(c[k][0], x, `cycle ${k} x`); near(c[k][1], y, `cycle ${k} y`); });
});

test('centres: a hub puts the first node in the middle and the rest on the ellipse', () => {
  const h = centres('hub', 4, AREA, [200, 100], 0);
  [[500, 200], [500, 50], [846.41, 275], [153.59, 275]].forEach(([x, y], k) => { near(h[k][0], x, `hub ${k} x`); near(h[k][1], y, `hub ${k} y`); });
});

test('centres: seven nodes in each layout, at both formats', () => {
  for (const format of ['16:9', '9:16']) {
    const { w, h } = canvasOf(format);
    for (const layout of ['row', 'column', 'cycle', 'hub']) {
      const c = centres(layout, 7, { x: 0, y: 0, w, h }, [100, 60], 20);
      assert.equal(c.length, 7, layout);
      c.forEach(([x, y]) => assert.ok(x >= 50 && x <= w - 50 && y >= 30 && y <= h - 30, `${layout} ${format}: ${x},${y} inside`));
    }
  }
});

test('edgePoint: the point where the line from a box centre to a target leaves the box', () => {
  assert.deepEqual(edgePoint([0, 0, 200, 100], [500, 50], 0), [200, 50]);
  assert.deepEqual(edgePoint([0, 0, 200, 100], [100, 400], 0), [100, 100]);
  assert.deepEqual(edgePoint([0, 0, 200, 100], [500, 50], 10), [210, 50]);
});

// ---- validation ----

test('validation: edges to real nodes with did-you-mean, no self edge, unique ids, a cycle of three or more, highlight', () => {
  const has = (shot, path, message) => assert.ok(errorsOf(shot).some((e) => e.path === path && e.message === message), JSON.stringify(errorsOf(shot)));
  has(base({ hold: 2, edges: [{ from: 'client', to: 'cache' }, { from: 'cache', to: 'db' }, { from: 'client', to: 'cahce' }] }), 'shots[0].edges[2].to', 'no node "cahce"; did you mean "cache"? (nodes: client, cache, db)');
  has(base({ hold: 2, edges: [{ from: 'client', to: 'cache' }, { from: 'db', to: 'db' }] }), 'shots[0].edges[1]', 'an edge from a node to itself');
  has(base({ hold: 2, nodes: [...NODES3, { id: 'db', label: 'Again' }] }), 'shots[0].nodes[3].id', '"db" is already the id of nodes[2]');
  has(base({ hold: 2, nodes: NODES3.slice(0, 2), edges: [], layout: 'cycle' }), 'shots[0].layout', 'a cycle needs at least 3 nodes');
  has(base({ hold: 2, highlight: 'cash' }), 'shots[0].highlight', 'no node "cash"; did you mean "cache"? (nodes: client, cache, db)');
  assert.deepEqual(errorsOf(base({ hold: 2, title: 'How a request flows', highlight: 'cache', layout: 'cycle', edges: [{ from: 'client', to: 'cache', label: 'asks' }] })), []);
  assert.ok(errorsOf(base({ hold: 2, nodes: [{ id: 'a', label: 'x'.repeat(25) }, NODES3[1]] })).some((e) => e.path === 'shots[0].nodes[0].label'));
});

// ---- timing ----

test('timing: the first node is whole on frame 0; a node lands on the word naming it, else one per sentence, else evenly; an edge after both ends', () => {
  const named = base({ say: 'A client asks the cache, and the database answers.' });
  const out = expand(named);
  const word = (w) => out.timing.words.find((x) => x.text.toLowerCase().startsWith(w)).start;
  const t = diagram.arrivals(named, out.timing);
  assert.equal(t.nodes[0], 0);
  near(t.nodes[1], word('cache'), 'cache on its word');
  near(t.nodes[2], word('database'), 'database on its word');
  assert.ok(t.edges[1] >= Math.max(t.nodes[1], t.nodes[2]), 'an edge never before its ends');
  const s = base({ say: 'First this. Then that. Then the last one.', nodes: [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }, { id: 'c', label: 'Gamma' }], edges: [] });
  const so = expand(s);
  assert.deepEqual(diagram.arrivals(s, so.timing).nodes, so.timing.sentences.map((x, k) => (k === 0 ? 0 : x.start)));
  const h = base({ hold: 4, nodes: [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }, { id: 'c', label: 'Gamma' }], edges: [] });
  const ht = diagram.arrivals(h, expand(h).timing).nodes;
  assert.ok(ht[0] === 0 && ht[1] > 0 && ht[2] > ht[1] && ht[2] <= 4 - 0.6, `evenly: ${ht}`);
});

test('events: one node event per node after the first, at its arrival', () => {
  const shot = base({ say: 'A client asks the cache, and the database answers.' });
  const out = expand(shot);
  const t = diagram.arrivals(shot, out.timing);
  assert.deepEqual(diagram.events(shot, out.timing), t.nodes.slice(1).map((at) => ({ kind: 'device', device: 'node', t: at })));
  assert.deepEqual(diagram.eventDevices, ['node']);
});

// ---- composition ----

const SEVEN = { id: 'd', show: 'diagram', say: 'Seven parts make one system.',
  nodes: ['Browser', 'Edge', 'Gateway', 'Auth', 'Queue', 'Worker', 'Store'].map((label) => ({ id: label.toLowerCase(), label })),
  edges: [{ from: 'browser', to: 'edge' }, { from: 'edge', to: 'gateway', label: 'routes' }, { from: 'gateway', to: 'auth' }, { from: 'gateway', to: 'queue' }, { from: 'queue', to: 'worker', label: 'jobs' }, { from: 'worker', to: 'store' }, { from: 'browser', to: 'store' }] };

// The node boxes, arrow lines and edge-label plates of an expansion at its last frame, in canvas px (no camera).
function partsOf(out, shot) {
  const nodes = all(out.nodes);
  const boxes = shot.nodes.map((n) => out.boxes[`node:${n.id}`]);
  const lines = nodes.filter((n) => /\.edge\d+\.line$/.test(n.id));
  const labels = shot.edges.flatMap((e, j) => (out.boxes[`label:${j}`] ? [out.boxes[`label:${j}`]] : []));
  return { boxes, lines, labels };
}

for (const look of ['desk', 'pop']) {
  for (const format of ['16:9', '9:16']) {
    for (const layout of ['row', 'column', 'cycle', 'hub']) {
      test(`composition: ${layout} in ${look} at ${format}: boxes apart, arrows start and end on box edges, labels clear of nodes`, () => {
        const shot = { ...base({ say: 'A client asks the cache, and the database answers.', edges: [{ from: 'client', to: 'cache', label: 'asks' }, { from: 'cache', to: 'db', label: 'misses' }, { from: 'client', to: 'db' }] }), layout };
        const out = expand(shot, look, format);
        const { boxes, lines, labels } = partsOf(out, shot);
        boxes.forEach((a, i) => boxes.forEach((b, j) => { if (i < j) assert.ok(!overlaps(a, b), `nodes ${i} and ${j} overlap`); }));
        for (const line of lines) {
          const pts = line.props.d.match(/-?\d+(?:\.\d+)?/g).map(Number);
          const ends = [[pts[0], pts[1]], [pts.at(-2), pts.at(-1)]];
          for (const [x, y] of ends) {
            assert.ok(!boxes.some((b) => x > b[0] + 1 && x < b[0] + b[2] - 1 && y > b[1] + 1 && y < b[1] + b[3] - 1), `${line.id} end ${x},${y} inside a node`);
          }
        }
        for (const l of labels) assert.ok(!boxes.some((b) => overlaps(l, b)), `an edge label crosses a node: ${l}`);
      });
    }
  }
}

test('pop: the node being spoken is in the accent; desk: a highlight dims the other nodes', () => {
  const shot = base({ say: 'A client asks the cache, and the database answers.', highlight: 'cache' });
  const pop = expand(shot, 'pop', '16:9');
  const accent = registries.looks.get('pop').palette.accent;
  const lit = (k) => all(pop.nodes).find((n) => n.id === `d.node${k}.lit`);
  const t = diagram.arrivals(shot, pop.timing).nodes;
  assert.equal(lit(1).props.fill, accent);
  assert.equal(sample(lit(1).tracks.opacity, t[1]), 1, 'cache lit as it is spoken');
  assert.equal(sample(lit(0).tracks.opacity, t[1]), 0, 'client no longer lit');
  assert.equal(sample(lit(1).tracks.opacity, pop.timing.duration), 1, 'the highlighted node stays lit');
  const desk = expand(shot, 'desk', '16:9');
  const other = all(desk.nodes).find((n) => n.id === 'd.node0');
  assert.ok(sample(other.tracks.opacity, desk.timing.duration) < 1, 'an other node is dimmed at the end');
  const kept = all(desk.nodes).find((n) => n.id === 'd.node1');
  assert.equal(sample(kept.tracks.opacity, desk.timing.duration), 1);
});

test('fit: seven 24-character labels in a row at 16:9 give the fit finding at a node label; short labels give none', () => {
  const long = { ...SEVEN, layout: 'row', nodes: SEVEN.nodes.map((n, i) => ({ id: n.id, label: `${'Component number '}${i} xxxx`.slice(0, 24) })) };
  for (const look of ['desk', 'pop']) {
    const findings = diagram.review(long, { look: registries.looks.get(look), canvas: canvasOf('16:9') });
    assert.ok(findings.some((f) => /^nodes\[\d\]\.label$/.test(f.path) && /shorten/.test(f.message)), `${look}: ${JSON.stringify(findings)}`);
    assert.deepEqual(diagram.review(base({ hold: 2 }), { look: registries.looks.get(look), canvas: canvasOf('16:9') }), []);
  }
});

// ---- the bar ----

const full = () => base({ say: 'A client asks the cache, and the database answers.', title: 'How a request flows', highlight: 'cache',
  edges: [{ from: 'client', to: 'cache', label: 'asks' }, { from: 'cache', to: 'db', label: 'misses' }] });
for (const look of ['desk', 'pop']) {
  for (const format of ['16:9', '9:16']) {
    test(`diagram bar: the example in ${look} at ${format}`, () => assertBar('diagram', diagram.example, { look, format }));
    test(`diagram bar: the full fixture in ${look} at ${format}`, () => assertBar('diagram', full(), { look, format }));
    test(`diagram bar: seven nodes in ${look} at ${format}`, () => assertBar('diagram', SEVEN, { look, format }));
  }
}
