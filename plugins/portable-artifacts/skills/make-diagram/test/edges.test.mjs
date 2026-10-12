import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { layoutGraph } from '../scripts/lib/layout-graph.mjs';
import { anchorEdges, anchorRoute, roundedPath } from '../scripts/lib/edges.mjs';
import { shapeParts, polyline, pathD, outlineHit, CORNER_RADIUS, RECT_RADIUS, STACK_RADIUS } from '../scripts/lib/shapes.mjs';
import { HEXAGON_CUT, PARALLELOGRAM_SLANT, CYLINDER_CAP } from '../scripts/lib/sizes.mjs';
import { KINDS } from '../scripts/lib/kinds.mjs';
import { loadTheme } from '../shared/theme.mjs';

const theme = loadTheme('paper');
const TOL = 1; // px: an arrow tip lies on the drawn outline
const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const example = (name) => JSON.parse(fs.readFileSync(here(`../references/examples/${name}.diagram.json`), 'utf8'));

// ---- distance to the outline, computed here from the shape equations ---------
// (not from shapes.mjs, so the anchoring is checked against an independent description)

const segDist = (p, a, b) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};
const polyDist = (p, pts) => Math.min(...pts.map((a, i) => segDist(p, a, pts[(i + 1) % pts.length])));
const pt = (x, y) => ({ x, y });

function ellipseDist(p, cx, cy, rx, ry, from, to) {
  let best = Infinity;
  for (let i = 0; i <= 4000; i++) {
    const a = from + ((to - from) * i) / 4000;
    best = Math.min(best, Math.hypot(p.x - (cx + rx * Math.cos(a)), p.y - (cy + ry * Math.sin(a))));
  }
  return best;
}

function roundedBoxDist(p, b, r) {
  const hx = b.width / 2 - r;
  const hy = b.height / 2 - r;
  const qx = Math.abs(p.x - (b.x + b.width / 2)) - hx;
  const qy = Math.abs(p.y - (b.y + b.height / 2)) - hy;
  return Math.abs(Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r);
}

function outlineDistance(shape, b, p) {
  const { x, y, width: w, height: h } = b;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const r = x + w;
  const bt = y + h;
  switch (shape) {
    case 'diamond':
    case 'small-diamond':
      return polyDist(p, [pt(cx, y), pt(r, cy), pt(cx, bt), pt(x, cy)]);
    case 'hexagon-rect': {
      const c = HEXAGON_CUT;
      return polyDist(p, [pt(x + c, y), pt(r - c, y), pt(r, y + c), pt(r, bt - c), pt(r - c, bt), pt(x + c, bt), pt(x, bt - c), pt(x, y + c)]);
    }
    case 'parallelogram':
      return polyDist(p, [pt(x + PARALLELOGRAM_SLANT, y), pt(r, y), pt(r - PARALLELOGRAM_SLANT, bt), pt(x, bt)]);
    case 'filled-dot':
    case 'ringed-dot':
      return Math.abs(Math.hypot(p.x - cx, p.y - cy) - w / 2);
    case 'stadium': {
      const R = h / 2;
      return Math.abs(segDist(p, pt(x + R, cy), pt(r - R, cy)) - R);
    }
    case 'cylinder':
      return Math.min(
        ellipseDist(p, cx, y + CYLINDER_CAP, w / 2, CYLINDER_CAP, Math.PI, 2 * Math.PI),
        ellipseDist(p, cx, bt - CYLINDER_CAP, w / 2, CYLINDER_CAP, 0, Math.PI),
        segDist(p, pt(x, y + CYLINDER_CAP), pt(x, bt - CYLINDER_CAP)),
        segDist(p, pt(r, y + CYLINDER_CAP), pt(r, bt - CYLINDER_CAP)),
      );
    case 'rect':
    case 'double-bar-rect':
      return roundedBoxDist(p, b, RECT_RADIUS);
    case 'stacked-rect':
      return roundedBoxDist(p, b, STACK_RADIUS);
    default:
      return roundedBoxDist(p, b, CORNER_RADIUS);
  }
}

// ---- a spec holding one node of every kind, with an edge into and out of each ----

function allKinds(type, direction) {
  const kinds = Object.keys(KINDS[type].kinds);
  const nodes = [{ id: 'src', label: 'Source' }, ...kinds.map((k) => ({ id: `k-${k}`, label: `Kind ${k}`, kind: k })), { id: 'dst', label: 'Sink' }];
  const edges = kinds.flatMap((k) => [{ from: 'src', to: `k-${k}` }, { from: `k-${k}`, to: 'dst' }]);
  return { title: `all ${type}`, type, direction, nodes, edges, ...(type === 'state' ? {} : {}) };
}

const SHAPED = new Set(['diamond', 'small-diamond', 'stadium', 'filled-dot', 'ringed-dot', 'hexagon-rect', 'parallelogram', 'cylinder']);

async function assertTipsOnOutline(spec, name) {
  const g = await layoutGraph(spec, theme);
  const a = anchorEdges(g);
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  let checked = 0;
  a.edges.forEach((e) => {
    for (const [end, p] of [[e.from, e.points[0]], [e.to, e.points.at(-1)]]) {
      const node = byId.get(end);
      if (!node) continue; // a group: a plain box, the layout test covers it
      const d = outlineDistance(node.shape, node, p);
      assert.ok(d <= TOL, `${name}: edge ${e.id} end at ${JSON.stringify(p)} is ${d.toFixed(2)} px off the ${node.shape} outline of ${end}`);
      if (SHAPED.has(node.shape)) checked++;
    }
    e.points.slice(1).forEach((q, i) => assert.ok(q.x === e.points[i].x || q.y === e.points[i].y || Math.abs(q.x - e.points[i].x) < 1e-6 || Math.abs(q.y - e.points[i].y) < 1e-6, `${name}: ${e.id} stays orthogonal`));
  });
  return checked;
}

for (const [type, direction] of [['architecture', 'right'], ['architecture', 'down'], ['flow', 'down'], ['flow', 'right'], ['state', 'right'], ['state', 'down']]) {
  test(`${type} (${direction}): every arrow tip and start lies on the drawn outline of every kind`, async () => {
    const checked = await assertTipsOnOutline(allKinds(type, direction), `${type}/${direction}`);
    assert.ok(checked > 0, 'the spec has shapes that fill less than their box');
  });
}

for (const name of ['architecture', 'flow', 'state']) {
  test(`${name} example: arrow tips lie on the drawn outlines`, async () => {
    await assertTipsOnOutline(example(name), name);
  });
}

test('anchoring moves ends of shaped nodes and leaves boxes alone', async () => {
  const g = await layoutGraph(example('flow'), theme);
  const a = anchorEdges(g);
  const moved = a.edges.filter((e, i) => JSON.stringify(e.points) !== JSON.stringify(g.edges[i].points));
  assert.ok(moved.length > 0, 'some edge end sits off the outline in the raw ELK route');
  // a box-to-box edge keeps the raw route (wait -> check: step to subprocess, both rectangles)
  const plain = a.edges.findIndex((e) => e.from === 'send' && e.to === 'wait');
  assert.deepEqual(a.edges[plain].points, g.edges[plain].points);
  // layout geometry itself is not mutated
  assert.deepEqual(g, await layoutGraph(example('flow'), theme));
});

test('a route that does not run along the step into the box keeps its points and gains a spur', () => {
  const box = { x: 0, y: 0, width: 100, height: 100 };
  const out = anchorRoute([{ x: 60, y: 0 }, { x: 80, y: 0 }, { x: 80, y: -30 }], { from: { shape: 'diamond', box }, to: { shape: 'rect', box: { x: 70, y: -80, width: 40, height: 50 } } });
  assert.equal(out.length, 4);
  assert.deepEqual(out[1], { x: 60, y: 0 });
});

test('a ray that passes beside the shape leaves the end alone', () => {
  const box = { x: 0, y: 0, width: 20, height: 20 };
  assert.equal(outlineHit('filled-dot', box, { x: 0, y: 25 }, { dx: 1, dy: 0 }), null);
  const kept = anchorRoute([{ x: 0, y: 25 }, { x: -20, y: 25 }], { from: { shape: 'filled-dot', box }, to: { shape: 'rect', box: { x: -60, y: 10, width: 40, height: 30 } } });
  assert.deepEqual(kept[0], { x: 0, y: 25 });
});

test('roundedPath rounds corners with a 6 px radius, shortened on short segments', () => {
  assert.equal(roundedPath([{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }]), 'M0 0L34 0Q40 0 40 6L40 40');
  assert.equal(roundedPath([{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 40 }]), 'M0 0L4 0Q8 0 8 4L8 40');
  assert.equal(roundedPath([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }]), 'M0 0L10 0L20 0');
  assert.equal(roundedPath([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 20, y: 0 }]), 'M0 0L20 0');
});

test('shape path data is closed, finite and built from the shared constants', () => {
  const box = { x: 10, y: 20, width: 120, height: 44 };
  for (const shape of ['rounded-rect', 'rect', 'stacked-rect', 'double-bar-rect', 'stadium', 'diamond', 'hexagon-rect', 'parallelogram', 'cylinder', 'dashed-rounded-rect']) {
    const { outline } = shapeParts(shape, box);
    const d = pathD(outline);
    assert.match(d, /^M[^M]*Z$/, shape);
    assert.ok(!/NaN|Infinity/.test(d), shape);
    for (const p of polyline(outline)) assert.ok(p.x >= box.x - 1e-6 && p.x <= box.x + box.width + 1e-6 && p.y >= box.y - 1e-6 && p.y <= box.y + box.height + 1e-6, `${shape} stays in its box`);
  }
  assert.throws(() => shapeParts('blob', box), /unknown shape/);
});
