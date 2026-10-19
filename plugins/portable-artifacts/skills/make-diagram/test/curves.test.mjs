import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { layoutDiagram } from '../scripts/lib/layout.mjs';
import { renderSvg } from '../scripts/lib/render.mjs';
import { lintGeometry } from '../scripts/lib/lint.mjs';
import { roundedPath, curvedRoute } from '../scripts/lib/edges.mjs';
import { drawnEdges } from '../scripts/lib/curves.mjs';
import { sampleWire, along, inside, rectsOverlap, rectDist, wires, plates } from './helpers/wires.mjs';
import { loadTheme } from '../shared/theme.mjs';

const theme = loadTheme('paper');
const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));

// ---- the per-edge decision, on a hand-made geometry --------------------------

const box = (id, x, y, width, height) => ({ id, x, y, width, height });
const ROUTE = [{ x: 140, y: 128 }, { x: 164, y: 128 }, { x: 164, y: 370 }, { x: 579, y: 370 }];
const LABEL = { text: 'calls', x: 400, y: 376, width: 40, height: 20 };
const geometryWith = (nodes) => ({
  width: 800, height: 500,
  nodes: [box('a', 40, 100, 100, 56), box('b', 579, 340, 100, 60), ...nodes],
  groups: [],
  edges: [{ id: 'edge-0', from: 'a', to: 'b', points: ROUTE, style: 'solid', both: false, label: LABEL }],
});

test('a route whose curve would enter a node keeps its old drawing: radius-6 corners and ELK\'s plate', () => {
  const blocker = box('c', 190, 230, 120, 60);
  assert.ok(sampleWire(curvedRoute(ROUTE).d).some((p) => inside(p, blocker)), 'the curve does cross the blocker');
  const [edge] = drawnEdges(geometryWith([blocker]));
  assert.equal(edge.curved, false);
  assert.equal(edge.d, roundedPath(ROUTE));
  assert.equal(edge.d, 'M140 128L158 128Q164 128 164 134L164 364Q164 370 170 370L579 370');
  assert.deepEqual(edge.plate, LABEL);
});

test('a curve that passes closer than 4 px to a node keeps the old drawing too', () => {
  // a small box whose nearest corner sits 2 px off the curve, on the outside of its bend
  const pts = sampleWire(curvedRoute(ROUTE).d);
  const i = Math.floor(pts.length / 2);
  const t = { x: pts[i + 1].x - pts[i - 1].x, y: pts[i + 1].y - pts[i - 1].y };
  const len = Math.hypot(t.x, t.y);
  const n = { x: t.y / len, y: -t.x / len };
  const c = { x: pts[i].x + 2 * n.x, y: pts[i].y + 2 * n.y };
  const near = box('c', n.x > 0 ? c.x : c.x - 10, n.y > 0 ? c.y : c.y - 10, 10, 10);
  assert.ok(!pts.some((p) => inside(p, near)), 'the curve does not enter the box');
  assert.ok(Math.min(...pts.map((p) => rectDist(p, near))) < 4, 'but passes within 4 px of it');
  const [edge] = drawnEdges(geometryWith([near]));
  assert.equal(edge.curved, false);
  assert.equal(edge.d, roundedPath(ROUTE));
});

test('a clear route keeps its curve and centres its plate half way along it', () => {
  const [edge] = drawnEdges(geometryWith([]));
  assert.equal(edge.curved, true);
  assert.equal(edge.d, curvedRoute(ROUTE).d);
  const mid = along(sampleWire(edge.d), 0.5);
  assert.ok(Math.hypot(edge.plate.x + 20 - mid.x, edge.plate.y + 10 - mid.y) <= 0.5, JSON.stringify({ plate: edge.plate, mid }));
  assert.equal(edge.plate.width, 40);
  assert.equal(edge.plate.text, 'calls');
});

test('a self loop is never curved: it keeps its radius-6 corners and ELK\'s plate beside the loop', () => {
  // out of a's right side, over the top and back down into it; open space all round, so a curve would be clear
  const loop = [{ x: 140, y: 118 }, { x: 170, y: 118 }, { x: 170, y: 70 }, { x: 110, y: 70 }, { x: 110, y: 100 }];
  const plate = { text: 'retry', x: 176, y: 80, width: 40, height: 20 };
  const geometry = { ...geometryWith([]), edges: [{ id: 'edge-0', from: 'a', to: 'a', points: loop, style: 'solid', both: false, label: plate }] };
  const [edge] = drawnEdges(geometry);
  assert.equal(edge.curved, false);
  assert.equal(edge.d, roundedPath(loop));
  assert.deepEqual(edge.plate, plate);
});

test('a plate that cannot sit half way moves along the curve before the edge gives up its curve', () => {
  const pts = sampleWire(curvedRoute(ROUTE).d);
  const half = along(pts, 0.5);
  // a node up and right of the half-way point: over where the plate would sit, but clear of the curve
  const beside = box('c', half.x + 12, half.y - 36, 30, 30);
  assert.ok(rectsOverlap(beside, { x: half.x - 20, y: half.y - 10, width: 40, height: 20 }), 'the half-way plate would cover the node');
  assert.ok(Math.min(...pts.map((p) => rectDist(p, beside))) >= 4, 'the curve keeps 4 px from it');
  const [edge] = drawnEdges(geometryWith([beside]));
  assert.equal(edge.curved, true);
  const centre = { x: edge.plate.x + 20, y: edge.plate.y + 10 };
  assert.ok([0.4, 0.6, 0.3, 0.7].some((f) => Math.hypot(centre.x - along(pts, f).x, centre.y - along(pts, f).y) <= 0.5), JSON.stringify(centre));
  assert.ok(!rectsOverlap(edge.plate, beside));
});

// ---- generated graphs: every edge as drawn ----------------------------------

// mulberry32: a tiny seeded PRNG, so the generated set is the same on every run
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const KINDS = ['service', 'database', 'client', 'queue', 'external'];
const WORDS = ['calls', 'writes order', 'emits event', 'reads'];
const GENERATED = 40;

/** Architecture graphs: 5-10 nodes, a random tree plus up to 3 skip edges, about 60 % labelled, half right and half down. */
function generated() {
  const rnd = prng(20261019);
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  return Array.from({ length: GENERATED }, (_, s) => {
    const n = 5 + Math.floor(rnd() * 6);
    const nodes = Array.from({ length: n }, (__, i) => ({ id: `n${i}`, label: rnd() < 0.3 ? `Node ${i} with a longer two line label` : `Node ${i}`, kind: pick(KINDS) }));
    const edges = [];
    const seen = new Set();
    for (let i = 1; i < n; i++) {
      const from = Math.floor(rnd() * i);
      seen.add(`${from}-${i}`);
      edges.push({ from: `n${from}`, to: `n${i}`, ...(rnd() < 0.6 ? { label: pick(WORDS) } : {}) });
    }
    for (let k = 0; k < 3; k++) {
      const a = Math.floor(rnd() * n);
      const b = Math.floor(rnd() * n);
      if (a >= b || seen.has(`${a}-${b}`)) continue;
      seen.add(`${a}-${b}`);
      edges.push({ from: `n${a}`, to: `n${b}`, ...(rnd() < 0.6 ? { label: pick(WORDS) } : {}) });
    }
    return { title: `generated ${s}`, type: 'architecture', direction: s % 2 === 0 ? 'right' : 'down', nodes, edges };
  });
}

// Everything wrong with one spec as drawn, as messages (empty = fine).
async function drawnProblems(spec) {
  const geometry = await layoutDiagram(spec, theme);
  const svg = renderSvg(geometry, spec, { theme });
  const problems = lintGeometry(geometry, { theme }).map((e) => `lint: ${e.path}: ${e.message}`);
  const drawn = wires(svg).map((w) => ({ ...w, pts: sampleWire(w.d), edge: geometry.edges.find((e) => e.id === w.id) }));
  const byEdge = plates(svg);
  for (const w of drawn) {
    for (const n of geometry.nodes.filter((x) => x.id !== w.edge.from && x.id !== w.edge.to)) {
      const hit = w.pts.find((p) => inside(p, n));
      if (hit) problems.push(`wire ${w.id} (${w.edge.from} -> ${w.edge.to}) enters node ${n.id} at ${hit.x.toFixed(1)},${hit.y.toFixed(1)}`);
    }
  }
  const all = [...byEdge];
  all.forEach(([id, plate], i) => {
    for (const n of geometry.nodes) if (rectsOverlap(plate, n)) problems.push(`plate of ${id} overlaps node ${n.id}`);
    for (const [other, p2] of all.slice(i + 1)) if (rectsOverlap(plate, p2)) problems.push(`plates of ${id} and ${other} overlap`);
    for (const w of drawn) {
      if (w.id === id) continue;
      const hit = w.pts.find((p) => inside(p, plate));
      if (hit) problems.push(`wire ${w.id} crosses the plate of ${id} at ${hit.x.toFixed(1)},${hit.y.toFixed(1)}`);
    }
  });
  return problems;
}

test('the review repro (probe 18) draws no wire through a node and lints clean', async () => {
  const spec = JSON.parse(fs.readFileSync(here('./fixtures/probe-18.diagram.json'), 'utf8'));
  assert.deepEqual(await drawnProblems(spec), []);
});

test('generated graphs: no wire enters a node, no plate covers a node, a plate or another wire, and lint agrees with the drawing', async () => {
  const specs = generated();
  assert.equal(specs.filter((s) => s.direction === 'down').length, GENERATED / 2);
  const found = [];
  for (const spec of specs) for (const p of await drawnProblems(spec)) found.push(`${spec.title} (${spec.direction}): ${p}`);
  assert.deepEqual(found, []);
});
