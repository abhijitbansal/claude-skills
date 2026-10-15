import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { layoutGraph } from '../scripts/lib/layout-graph.mjs';
import {
  nodeSize, edgeLabelSize, groupMinSize, fonts, MAX_TEXT_WIDTH, MAX_WIDENED_TEXT_WIDTH, DIAMOND_PAD, HEXAGON_CUT,
  PARALLELOGRAM_SLANT, CYLINDER_CAP, TILE_SIZE, TILE_GAP, TYPE_GAP, TYPE_TRACK, trackedWidth, NOTE_GAP,
} from '../scripts/lib/sizes.mjs';
import { KINDS } from '../scripts/lib/kinds.mjs';
import { LEGEND_BAND } from '../scripts/lib/legend.mjs';
import { validateSpec } from '../scripts/lib/spec.mjs';
import { loadTheme } from '../shared/theme.mjs';
import { measure, fontFor, lineHeight } from '../shared/text.mjs';

const theme = loadTheme('paper');
const EXAMPLES = ['architecture', 'flow', 'state', 'story'];
const TOL = 1; // px: edge ends on a box border
const MARGIN = 24;
const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const example = (name) => JSON.parse(fs.readFileSync(here(`../references/examples/${name}.diagram.json`), 'utf8'));
const layout = (spec) => layoutGraph(spec, theme);
const kind = (type, k) => KINDS[type].kinds[k];

// ---- geometry helpers ---------------------------------------------------

const right = (b) => b.x + b.width;
const bottom = (b) => b.y + b.height;
const overlaps = (a, b, gap = 0) => a.x < right(b) - gap && right(a) > b.x + gap && a.y < bottom(b) - gap && bottom(a) > b.y + gap;
const within = (inner, outer) => inner.x >= outer.x - 0.05 && inner.y >= outer.y - 0.05 && right(inner) <= right(outer) + 0.05 && bottom(inner) <= bottom(outer) + 0.05;

function onBorder(p, b, tol = TOL) {
  const insideX = p.x >= b.x - tol && p.x <= right(b) + tol;
  const insideY = p.y >= b.y - tol && p.y <= bottom(b) + tol;
  if (!insideX || !insideY) return false;
  return Math.abs(p.x - b.x) <= tol || Math.abs(p.x - right(b)) <= tol || Math.abs(p.y - b.y) <= tol || Math.abs(p.y - bottom(b)) <= tol;
}

// Does the axis-aligned segment a-b run through the interior of box (shrunk by tol)?
function crosses(a, b, box, tol = TOL) {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  return x0 < right(box) - tol && x1 > box.x + tol && y0 < bottom(box) - tol && y1 > box.y + tol;
}

const segments = (points) => points.slice(1).map((p, i) => [points[i], p]);
const boxesById = (g) => new Map([...g.groups, ...g.nodes].map((b) => [b.id, b]));
const labelRect = (n) => n.labelBox;

// The checks every layout must pass, whatever the spec.
function assertSound(g, spec, name) {
  const byId = boxesById(g);
  const rect = { x: 0, y: 0, width: g.width, height: g.height };
  for (const b of [...g.nodes, ...g.groups]) {
    assert.ok(within(b, rect), `${name}: ${b.id} lies inside the canvas`);
    assert.ok(b.x >= MARGIN - 0.05 && b.y >= MARGIN - 0.05, `${name}: ${b.id} keeps the ${MARGIN}px margin`);
  }
  g.nodes.forEach((a, i) => g.nodes.slice(i + 1).forEach((b) => assert.ok(!overlaps(a, b), `${name}: nodes ${a.id} and ${b.id} overlap`)));
  for (const n of g.nodes.filter((x) => x.group)) {
    for (let id = n.group; id !== null; id = g.groups.find((x) => x.id === id).parent) {
      assert.ok(within(n, byId.get(id)), `${name}: node ${n.id} lies inside group ${id}`);
    }
  }
  for (const grp of spec.groups ?? []) {
    if (grp.parent) assert.ok(within(byId.get(grp.id), byId.get(grp.parent)), `${name}: group ${grp.id} lies inside ${grp.parent}`);
  }
  g.edges.forEach((e) => {
    const from = byId.get(e.from);
    const to = byId.get(e.to);
    const first = e.points[0];
    const last = e.points.at(-1);
    assert.ok(onBorder(first, from), `${name}: edge ${e.id} starts on ${e.from}'s border (${JSON.stringify(first)} vs ${JSON.stringify(from)})`);
    assert.ok(onBorder(last, to), `${name}: edge ${e.id} ends on ${e.to}'s border (${JSON.stringify(last)} vs ${JSON.stringify(to)})`);
    for (const [a, b] of segments(e.points)) {
      assert.ok(a.x === b.x || a.y === b.y, `${name}: edge ${e.id} is orthogonal`);
      for (const n of g.nodes.filter((x) => x.id !== e.from && x.id !== e.to)) {
        assert.ok(!crosses(a, b, n), `${name}: edge ${e.id} runs through node ${n.id}`);
      }
    }
    for (const p of e.points) {
      assert.ok(p.x >= 0 && p.x <= g.width && p.y >= 0 && p.y <= g.height, `${name}: edge ${e.id} point ${JSON.stringify(p)} lies inside the canvas`);
    }
    if (e.label) {
      assert.ok(within(e.label, rect), `${name}: label of edge ${e.id} lies inside the canvas`);
      for (const n of g.nodes) assert.ok(!overlaps(e.label, n), `${name}: label of edge ${e.id} overlaps node ${n.id}`);
    }
  });
  const labelled = g.nodes.filter(labelRect);
  labelled.forEach((n, i) => {
    for (const other of g.nodes) assert.ok(!overlaps(labelRect(n), other), `${name}: label of ${n.id} overlaps node ${other.id}`);
    for (const other of labelled.slice(i + 1)) assert.ok(!overlaps(labelRect(n), labelRect(other)), `${name}: labels of ${n.id} and ${other.id} overlap`);
    for (const e of g.edges) {
      for (const [a, b] of segments(e.points)) assert.ok(!crosses(a, b, labelRect(n)), `${name}: edge ${e.id} runs through the label of ${n.id}`);
    }
    assert.ok(within(labelRect(n), rect), `${name}: label of ${n.id} lies inside the canvas`);
  });
}

// ---- inline specs -------------------------------------------------------

const node = (id, extra = {}) => ({ id, label: id.toUpperCase(), ...extra });

// Two sibling top-level groups, each holding a nested group, with edges that
// cross every combination of borders (Review Focus 2).
function nestedSpec(direction) {
  return {
    title: 'Nested', type: 'architecture', ...(direction ? { direction } : {}),
    groups: [
      { id: 'a', label: 'Group A' }, { id: 'a1', label: 'Group A inner', parent: 'a' },
      { id: 'b', label: 'Group B' }, { id: 'b1', label: 'Group B inner', parent: 'b' },
    ],
    nodes: [
      node('client'),
      node('a-top', { group: 'a' }), node('a-deep', { group: 'a1', kind: 'service' }), node('a-db', { group: 'a1', kind: 'database', note: 'primary' }),
      node('b-top', { group: 'b' }), node('b-deep', { group: 'b1' }), node('b-q', { group: 'b1', kind: 'queue' }),
      node('out', { kind: 'external' }),
    ],
    edges: [
      { from: 'client', to: 'a-top', label: 'enter' },
      { from: 'a-top', to: 'a-deep' },
      { from: 'a-deep', to: 'b-deep', label: 'cross' },
      { from: 'a-db', to: 'b-q', style: 'async' },
      { from: 'b-deep', to: 'a-db', both: true },
      { from: 'b-top', to: 'out' },
      { from: 'a1', to: 'b1', style: 'dashed' },
      { from: 'client', to: 'b1' },
      { from: 'a-deep', to: 'a-db', label: 'inside one group' },
      { from: 'out', to: 'client' },
    ],
  };
}

const lone = (type, k) => ({ title: 'Lone', type, nodes: [node('solo', k ? { kind: k } : {})] });
const noEdges = (type) => ({ title: 'No edges', type, nodes: [node('one'), node('two', { note: 'a note' }), node('three')] });

// ---- sizes ----------------------------------------------------------------

test('every size is an even number of px', () => {
  for (const [type, def] of Object.entries(KINDS).filter(([t]) => t !== 'sequence')) {
    for (const [k, info] of Object.entries(def.kinds)) {
      const s = nodeSize({ id: 'x', label: 'A reasonably long label for sizing', note: 'with a note' }, info, theme);
      assert.equal(s.width % 2, 0, `${type}.${k} width`);
      assert.equal(s.height % 2, 0, `${type}.${k} height`);
    }
  }
});

test('labels wrap to two lines at 180 px; longer ones widen the wrap, never past 240 px', () => {
  const info = kind('architecture', 'service');
  const label = { ...fontFor(theme, 'body'), weight: 600, size: 14 };
  const medium = nodeSize({ id: 'x', label: 'Customer notification dispatch service' }, info, theme);
  assert.equal(medium.lines.length, 2);
  for (const l of medium.lines) assert.ok(measure(l, label) <= MAX_TEXT_WIDTH, l);
  // 48 characters, the longest label the spec allows: still two lines, never wider than 240 px.
  for (const text of ['Authentication and authorization gateway service', 'x'.repeat(48), 'Wide Wiring Window Wizard Worker Widget Warden Wh'.slice(0, 48), 'Mixed Media Marketing Management Mobile Mapping']) {
    const s = nodeSize({ id: 'x', label: text }, info, theme);
    assert.ok(s.lines.length <= 2, `${text}: ${s.lines.length} lines`);
    for (const l of s.lines) assert.ok(measure(l, label) <= MAX_WIDENED_TEXT_WIDTH, `${text}: "${l}" is wider than ${MAX_WIDENED_TEXT_WIDTH}`);
    assert.ok(s.width >= Math.max(...s.lines.map((l) => measure(l, label))) + 28, 'box holds the widest line');
  }
  const widened = nodeSize({ id: 'x', label: 'Authentication and authorization gateway service' }, info, theme);
  assert.ok(Math.max(...widened.lines.map((l) => measure(l, label))) > MAX_TEXT_WIDTH, 'this label needed the wider wrap');
  assert.equal(nodeSize({ id: 'x', label: 'a\n\nb\tc' }, info, theme).lines.join('|'), 'a b c');
});

test('text of unusually wide glyphs (CJK, emoji) sizes to a finite box and is never cut', () => {
  const label = '注文確認サービス🙂'.repeat(4);
  const s = nodeSize({ id: 'x', label }, kind('architecture', 'service'), theme);
  assert.ok(Number.isFinite(s.width) && s.width > 80);
  assert.ok(s.lines.length >= 1);
  assert.equal(s.lines.join(''), label, 'every character is still there; the geometry lint reports the third line');
});

test('shape minimums: dots 20x20, small diamond 24x24, cylinder +12 px', () => {
  const dot = nodeSize({ id: 'x', label: 'Begin' }, kind('state', 'start'), theme);
  assert.deepEqual([dot.width, dot.height], [20, 20]);
  assert.deepEqual(Object.keys(dot.labelBox).sort(), ['height', 'width']);
  const ring = nodeSize({ id: 'x', label: 'Finish' }, kind('state', 'end'), theme);
  assert.deepEqual([ring.width, ring.height], [20, 20]);
  const choice = nodeSize({ id: 'x', label: 'Ok?' }, kind('state', 'choice'), theme);
  assert.deepEqual([choice.width, choice.height], [24, 24]);

  const text = { id: 'x', label: 'Orders store for the checkout flow' };
  const box = nodeSize(text, kind('architecture', 'service'), theme);
  const cyl = nodeSize(text, kind('architecture', 'database'), theme);
  assert.ok(cyl.height - box.height >= 10 && cyl.height - box.height <= 14, `cylinder ${cyl.height} vs box ${box.height}`);

  assert.equal(nodeSize({ id: 'x', label: 'Account exists?' }, kind('flow', 'decision'), theme).labelBox, undefined);
});

// ---- text fits inside the drawn outline, not just the bounding box ----------

// The tile + text block (centred in the node box) as local coordinates.
function textBlock(node, size, shape) {
  const f = fonts(theme);
  const text = Math.max(
    ...size.lines.map((l) => measure(l, f.label)),
    size.noteLine ? measure(size.noteLine, f.note) : 0,
    size.typeLine ? trackedWidth(size.typeLine, f.type, TYPE_TRACK) : 0,
  );
  const width = text + (size.icon || size.emoji ? TILE_SIZE + TILE_GAP : 0);
  const height = (size.typeLine ? lineHeight(f.type) + TYPE_GAP : 0) + size.lines.length * lineHeight(f.label) + (size.noteLine ? NOTE_GAP + lineHeight(f.note) : 0);
  const x0 = (size.width - width) / 2;
  const y0 = (size.height - height) / 2;
  return { x0, y0, x1: x0 + width, y1: y0 + height, text, height, shape };
}

const corners = (r) => [[r.x0, r.y0], [r.x1, r.y0], [r.x0, r.y1], [r.x1, r.y1]];

// Is the block inside the outline of the shape as the renderer draws it?
const CONTAINS = {
  diamond: (r, { width: W, height: H }) => corners(r).every(([x, y]) => Math.abs(x - W / 2) / (W / 2) + Math.abs(y - H / 2) / (H / 2) <= 1 + 1e-9),
  'hexagon-rect': (r, { width: W, height: H }) => corners(r).every(([x, y]) => Math.min(x, W - x) + Math.min(y, H - y) >= HEXAGON_CUT),
  parallelogram: (r, { width: W, height: H }) => corners(r).every(([x, y]) => x >= PARALLELOGRAM_SLANT * (1 - y / H) && x <= W - PARALLELOGRAM_SLANT * (y / H)),
  stadium: (r, { width: W, height: H }) => corners(r).every(([x, y]) => {
    const R = H / 2;
    const cx = x < R ? R : x > W - R ? W - R : x;
    return Math.hypot(x - cx, y - R) <= R;
  }),
  cylinder: (r, { height: H }) => r.y0 >= 2 * CYLINDER_CAP && r.y1 <= H - CYLINDER_CAP,
  'rounded-rect': (r, { width: W, height: H }) => r.x0 >= 0 && r.y0 >= 0 && r.x1 <= W && r.y1 <= H,
};

const LABELS = ['Ok', 'Account exists?', 'Is the customer account verified and active?', 'Authentication and authorization gateway service'];

test('the label (1 or 2 lines, with or without a note and icon) fits inside every text-bearing shape', () => {
  const cases = [['flow', 'decision'], ['architecture', 'gateway'], ['flow', 'io'], ['flow', 'start'], ['flow', 'end'], ['architecture', 'database'], ['architecture', 'service'], ['architecture', 'queue']];
  for (const [type, k] of cases) {
    const info = kind(type, k);
    for (const label of LABELS) {
      for (const note of [undefined, 'a short note line']) {
        const node = { id: 'x', label, ...(note ? { note } : {}) };
        const size = nodeSize(node, info, theme);
        const block = textBlock(node, size, info.shape);
        const contains = CONTAINS[info.shape] ?? CONTAINS['rounded-rect'];
        assert.ok(contains(block, size), `${type}.${k} "${label}"${note ? ' + note' : ''} (${size.lines.length} lines) in ${size.width}x${size.height} ${info.shape}`);
      }
    }
  }
});

test('the diamond satisfies the fit inequality (w/W + h/H <= 1) for 1 and 2 line labels', () => {
  const f = fonts(theme);
  for (const label of LABELS) {
    const size = nodeSize({ id: 'x', label }, kind('flow', 'decision'), theme);
    const tw = Math.max(...size.lines.map((l) => measure(l, f.label))) + 2 * DIAMOND_PAD.x;
    const th = size.lines.length * lineHeight(f.label) + 2 * DIAMOND_PAD.y;
    assert.ok(tw / size.width + th / size.height <= 1 + 1e-9, `${label}: ${tw / size.width + th / size.height}`);
  }
  assert.equal(nodeSize({ id: 'x', label: LABELS[2] }, kind('flow', 'decision'), theme).lines.length, 2);
});

test('an icon widens the box only for shapes that have an icon slot', () => {
  const withIcon = nodeSize({ id: 'x', label: 'Checkout API', icon: 'brand:nodedotjs' }, kind('architecture', 'service'), theme);
  const plain = nodeSize({ id: 'x', label: 'Checkout API' }, { shape: 'rounded-rect', icon: null }, theme);
  assert.equal(withIcon.icon, 'brand:nodedotjs');
  assert.equal(plain.icon, null);
  assert.ok(withIcon.width > plain.width);
  assert.equal(nodeSize({ id: 'x', label: 'Fork?' }, kind('flow', 'decision'), theme).icon, null);
});

test('edge labels and group minimums are sized from metrics', () => {
  const small = edgeLabelSize('go', theme);
  const big = edgeLabelSize('a considerably longer edge label', theme);
  assert.ok(big.width > small.width);
  assert.equal(small.height % 2, 0);
  assert.equal(edgeLabelSize(' a   b ', theme).text, 'a b');
  assert.ok(groupMinSize({ label: 'A deliberately long group label' }, theme).width > groupMinSize({ label: 'G' }, theme).width);
});

// ---- ELK facts the layout relies on (probed, so a version bump shows up) ---

test('ELK honours a group minimum size and lays out an empty group', async () => {
  const spec = {
    title: 'Min', type: 'architecture',
    groups: [{ id: 'long', label: 'A deliberately long group label that is wider than its member' }, { id: 'hollow', label: 'Empty' }],
    nodes: [node('m', { group: 'long' }), node('o')],
    edges: [{ from: 'm', to: 'o' }],
  };
  const g = await layout(spec);
  const longGroup = g.groups.find((x) => x.id === 'long');
  assert.ok(longGroup.width >= groupMinSize(spec.groups[0], theme).width, 'group is as wide as its label');
  const hollow = g.groups.find((x) => x.id === 'hollow');
  assert.ok(hollow.width >= 40 && hollow.height >= 64, 'an empty group keeps a real box');
  assertSound(g, spec, 'min');
});

// ---- examples -------------------------------------------------------------

test('the shipped examples are valid specs', async () => {
  for (const name of EXAMPLES) assert.deepEqual((await validateSpec(example(name))).errors, [], name);
});

for (const name of EXAMPLES) {
  test(`${name} example: geometry matches the golden file`, async () => {
    const g = await layout(example(name));
    const file = here(`./golden/${name}.layout.json`);
    if (process.env.PA_WRITE_GOLDEN === '1') {
      fs.mkdirSync(here('./golden'), { recursive: true });
      fs.writeFileSync(file, `${JSON.stringify(g, null, 2)}\n`);
    }
    assert.deepEqual(g, JSON.parse(fs.readFileSync(file, 'utf8')));
  });

  test(`${name} example: lays out soundly`, async () => {
    assertSound(await layout(example(name)), example(name), name);
  });

  test(`${name} example: two runs give identical geometry`, async () => {
    assert.deepEqual(await layout(example(name)), await layout(example(name)));
  });
}

test('coordinates are rounded to 0.1 px', async () => {
  const g = await layout(example('state'));
  const all = [g.width, g.height, ...g.nodes.flatMap((n) => [n.x, n.y, n.width, n.height]), ...g.edges.flatMap((e) => e.points.flatMap((p) => [p.x, p.y]))];
  for (const v of all) assert.equal(Math.round(v * 10) / 10, v);
});

// ---- the Geometry contract ------------------------------------------------

test('geometry carries the contract fields', async () => {
  const g = await layout(example('architecture'));
  assert.deepEqual(Object.keys(g).sort(), ['drawing', 'edges', 'groups', 'height', 'layers', 'legend', 'nodes', 'width']);
  const api = g.nodes.find((n) => n.id === 'api');
  assert.deepEqual(Object.keys(api).sort(), ['emoji', 'group', 'height', 'icon', 'id', 'layer', 'lines', 'noteLine', 'shape', 'tone', 'typeLine', 'width', 'x', 'y']);
  assert.equal(api.shape, 'rounded-rect');
  assert.equal(api.icon, 'brand:nodedotjs');
  assert.equal(api.emoji, null);
  assert.equal(api.typeLine, 'SERVICE');
  assert.equal(api.group, 'vpc');
  assert.equal(api.tone, 'neutral');
  assert.equal(api.noteLine, null);
  assert.deepEqual(g.nodes.find((n) => n.id === 'db').noteLine, 'primary + replica');
  assert.equal(g.nodes.find((n) => n.id === 'pay').tone, 'warn');
  assert.equal(g.nodes.find((n) => n.id === 'web').group, null);
  assert.deepEqual(g.groups.map((x) => [x.id, x.depth, x.label, x.parent]), [['aws', 0, 'AWS us-east-1', null], ['vpc', 1, 'Private VPC', 'aws']]);
  const [e0, , , e3] = g.edges;
  assert.deepEqual([e0.id, e0.from, e0.to, e0.style, e0.both], ['edge-0', 'web', 'api', 'solid', false]);
  assert.equal(e0.label.text, 'POST /checkout');
  assert.deepEqual(Object.keys(e0.label).sort(), ['height', 'text', 'width', 'x', 'y']);
  assert.deepEqual([e3.style, e3.both, e3.label], ['dashed', true, undefined]);
});

test('an explicit edge id is kept; the default is edge-<index>', async () => {
  const spec = { title: 't', type: 'flow', nodes: [node('a'), node('b'), node('c')], edges: [{ from: 'a', to: 'b', id: 'first' }, { from: 'b', to: 'c' }] };
  assert.deepEqual((await layout(spec)).edges.map((e) => e.id), ['first', 'edge-1']);
});

test('default edge ids are edge-<index> and never reuse a node, group or authored edge id', async () => {
  const spec = {
    title: 't', type: 'architecture', groups: [{ id: 'edge-2', label: 'G' }],
    nodes: [node('e0', { group: 'edge-2' }), node('e1'), node('edge-0')],
    edges: [{ from: 'e0', to: 'e1' }, { from: 'e1', to: 'edge-0' }, { from: 'edge-0', to: 'e0' }, { from: 'e0', to: 'edge-0', id: 'edge-3' }, { from: 'e1', to: 'e0' }],
  };
  const g = await layout(spec);
  assert.deepEqual(g.edges.map((e) => e.id), ['edge-0_', 'edge-1', 'edge-2_', 'edge-3', 'edge-4']);
  const all = [...g.nodes, ...g.groups, ...g.edges].map((x) => x.id);
  assert.equal(new Set(all).size, all.length, 'one flat id space');
  assertSound(g, spec, 'unique-ids');
});

// ---- self loops are visible loops ---------------------------------------------

const extent = (points) => {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
};
const MIN_LOOP = 24;

for (const [type, nodeKind, direction] of [['state', 'state', 'right'], ['state', 'state', 'down'], ['flow', 'step', 'down'], ['flow', 'step', 'right'], ['flow', 'decision', 'down'], ['architecture', 'database', 'right'], ['architecture', 'service', 'down']]) {
  test(`a self loop on a ${type} ${nodeKind} (${direction}) is at least ${MIN_LOOP} px each way and its label stays beside it`, async () => {
    const spec = {
      title: 't', type, direction,
      nodes: [node('a', { kind: nodeKind }), node('b')],
      edges: [{ from: 'a', to: 'b' }, { from: 'a', to: 'a', label: 'again' }],
    };
    const g = await layout(spec);
    const a = g.nodes[0];
    const loop = g.edges[1];
    const box = extent(loop.points);
    assert.ok(box.width >= MIN_LOOP - 0.05 && box.height >= MIN_LOOP - 0.05, `loop ${box.width} x ${box.height}`);
    assert.ok(onBorder(loop.points[0], a) && onBorder(loop.points.at(-1), a), 'both ends sit on the node box');
    const label = loop.label;
    assert.ok(!overlaps(label, box), 'the label plate does not sit on the loop');
    const gap = Math.max(box.x - right(label), label.x - right(box), box.y - bottom(label), label.y - bottom(box));
    assert.ok(gap >= 0 && gap <= 12, `label gap to the loop: ${gap}`);
    assertSound(g, spec, 'self-loop');
  });
}

// Two collinear stretches that share more than a point.
function shareStretch([a, b], [c, d]) {
  const horizontal = a.y === b.y && c.y === d.y && a.y === c.y;
  const vertical = a.x === b.x && c.x === d.x && a.x === c.x;
  if (!horizontal && !vertical) return false;
  const axis = horizontal ? 'x' : 'y';
  const lo = Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], d[axis]));
  const hi = Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis]));
  return hi - lo > 0.05;
}

for (const [type, nodeKind, direction] of [['state', 'state', 'right'], ['state', 'state', 'down'], ['flow', 'step', 'down'], ['flow', 'step', 'right'], ['architecture', 'service', 'right']]) {
  test(`two self loops on one ${type} ${nodeKind} (${direction}) do not run over each other and keep their own labels`, async () => {
    const spec = {
      title: 't', type, direction,
      nodes: [node('a', { kind: nodeKind }), node('b')],
      edges: [{ from: 'a', to: 'b' }, { from: 'a', to: 'a', label: 'again' }, { from: 'a', to: 'a', label: 'retry later' }],
    };
    const g = await layout(spec);
    const a = g.nodes[0];
    const [first, second] = g.edges.slice(1);
    for (const loop of [first, second]) {
      assert.ok(onBorder(loop.points[0], a) && onBorder(loop.points.at(-1), a), `${loop.label.text}: both ends sit on the node box`);
    }
    for (const s1 of segments(first.points)) {
      for (const s2 of segments(second.points)) assert.ok(!shareStretch(s1, s2), `the loops share a stretch: ${JSON.stringify(s1)} and ${JSON.stringify(s2)}`);
    }
    for (const [loop, other] of [[first, second], [second, first]]) {
      const box = extent(loop.points);
      assert.ok(!overlaps(loop.label, box), `${loop.label.text}: the plate does not sit on its own loop`);
      assert.ok(!segments(other.points).some(([p, q]) => crosses(p, q, loop.label, 0)), `${loop.label.text}: the plate is not crossed by the other loop`);
      const gap = Math.max(box.x - right(loop.label), loop.label.x - right(box), box.y - bottom(loop.label), loop.label.y - bottom(box));
      assert.ok(gap >= 0 && gap <= 40, `${loop.label.text}: label gap to its loop ${gap}`);
    }
    assertSound(g, spec, 'two-self-loops');
  });
}

test('a self loop on a tiny diamond still leaves the node and returns to it', async () => {
  const spec = { title: 't', type: 'state', nodes: [node('c', { kind: 'choice' }), node('d')], edges: [{ from: 'c', to: 'd' }, { from: 'c', to: 'c' }] };
  const g = await layout(spec);
  const box = extent(g.edges[1].points);
  assert.ok(box.height >= MIN_LOOP - 0.05 && box.width >= 16, `${box.width} x ${box.height}`);
});

test('flow layout follows the model order of edges: the back edge is the one that is reversed', async () => {
  const g = await layout(example('flow'));
  const y = Object.fromEntries(g.nodes.map((n) => [n.id, n.y]));
  assert.ok(y.begin < y.ask && y.ask < y.known && y.known < y.send && y.send < y.wait && y.wait < y.check && y.check < y.done);
  assert.deepEqual(g.layers, [['begin'], ['ask'], ['known'], ['send'], ['wait'], ['check'], ['done']]);
});

test('layer spacing inside a group is the same 72 px as outside it', async () => {
  const flow = await layout(example('flow'));
  const at = (g, id) => g.nodes.find((n) => n.id === id);
  const gap = (a, b) => b.y - (a.y + a.height);
  assert.ok(gap(at(flow, 'send'), at(flow, 'wait')) >= 72 - 0.05, 'send -> wait, both in the Email group');
  assert.ok(gap(at(flow, 'begin'), at(flow, 'ask')) >= 72 - 0.05, 'begin -> ask, both top level');
  const arch = await layout(example('architecture'));
  assert.ok(at(arch, 'db').x - (at(arch, 'api').x + at(arch, 'api').width) >= 72 - 0.05, 'api -> db, both in the VPC group');
});

// ---- Review Focus 2: nested groups, absolute edge coordinates -------------

for (const direction of [undefined, 'down']) {
  test(`nested groups (${direction ?? 'default'}): edges start and end on their boxes, no node is crossed`, async () => {
    const spec = nestedSpec(direction);
    assert.deepEqual((await validateSpec(spec)).errors, []);
    const g = await layout(spec);
    assertSound(g, spec, `nested-${direction ?? 'right'}`);
    assert.equal(g.groups.find((x) => x.id === 'a1').depth, 1);
    const byId = boxesById(g);
    // every edge between different groups starts in the source box's frame, not a container's
    for (const e of g.edges) {
      assert.ok(onBorder(e.points[0], byId.get(e.from)), `${e.id} source`);
      assert.ok(onBorder(e.points.at(-1), byId.get(e.to)), `${e.id} target`);
    }
  });
}

test('edges to a nested group end on the group frame', async () => {
  const g = await layout(nestedSpec());
  const byId = boxesById(g);
  const toGroup = g.edges.find((e) => e.to === 'b1');
  assert.ok(onBorder(toGroup.points.at(-1), byId.get('b1')));
  const groupToGroup = g.edges.find((e) => e.from === 'a1' && e.to === 'b1');
  assert.ok(onBorder(groupToGroup.points[0], byId.get('a1')));
});

// ---- Review Focus 4: one node, no edges -----------------------------------

for (const type of ['architecture', 'flow', 'state']) {
  test(`${type}: a single node lays out`, async () => {
    const spec = lone(type);
    const g = await layout(spec);
    assert.equal(g.nodes.length, 1);
    assert.deepEqual(g.edges, []);
    assert.deepEqual(g.layers, [['solo']]);
    assert.ok(g.width > 0 && g.height > 0 && Number.isFinite(g.width + g.height));
    assert.equal(g.nodes[0].x, MARGIN);
    assert.equal(g.nodes[0].y, MARGIN + LEGEND_BAND, 'below the legend band');
    assertSound(g, spec, `${type}-lone`);
  });

  test(`${type}: several nodes and no edges lay out`, async () => {
    const spec = noEdges(type);
    const g = await layout(spec);
    assert.equal(g.nodes.length, 3);
    assertSound(g, spec, `${type}-noedges`);
    assert.equal(g.layers.flat().length, 3);
  });
}

test('a lone dot, choice and decision lay out with their labels', async () => {
  for (const [type, k] of [['state', 'start'], ['state', 'end'], ['state', 'choice'], ['flow', 'decision'], ['flow', 'start']]) {
    const spec = lone(type, k);
    const g = await layout(spec);
    assertSound(g, spec, `${type}-${k}`);
    assert.ok(g.width > 40 && g.height > 40);
  }
});

test('a lone group holding one node lays out', async () => {
  const spec = { title: 't', type: 'architecture', groups: [{ id: 'g', label: 'Only group' }], nodes: [node('n', { group: 'g' })] };
  const g = await layout(spec);
  assertSound(g, spec, 'lone-group');
  assert.equal(g.groups[0].depth, 0);
});

// ---- dots and choices inside nested groups (probe spec) --------------------

test('state: start and choice nested two groups deep keep absolute label boxes and border-true edges', async () => {
  for (const direction of ['right', 'down']) {
    const spec = {
      title: 'Probe', type: 'state', direction,
      groups: [{ id: 'g', label: 'Outer' }, { id: 'h', label: 'Inner', parent: 'g' }],
      nodes: [
        node('begin', { kind: 'start', group: 'h' }), node('work', { group: 'h' }), node('pick', { kind: 'choice', group: 'h' }),
        node('yes', { group: 'g' }), node('no'), node('stop', { kind: 'end' }),
      ],
      edges: [
        { from: 'begin', to: 'work' }, { from: 'work', to: 'pick' }, { from: 'pick', to: 'yes', label: 'ok' },
        { from: 'pick', to: 'no', label: 'fail', style: 'dashed' }, { from: 'yes', to: 'stop' }, { from: 'no', to: 'stop' },
      ],
    };
    assert.deepEqual((await validateSpec(spec)).errors, []);
    const g = await layout(spec);
    assertSound(g, spec, `probe-${direction}`);
    const h = g.groups.find((x) => x.id === 'h');
    for (const id of ['begin', 'pick']) {
      const n = g.nodes.find((x) => x.id === id);
      assert.ok(n.labelBox, `${id} has a labelBox`);
      assert.ok(within(n, h), `${id} lies inside group h`);
      assert.ok(within(n.labelBox, h), `${id} label lies inside group h (absolute coordinates)`);
    }
    assert.deepEqual(g.groups.map((x) => [x.id, x.parent, x.depth]), [['g', null, 0], ['h', 'g', 1]]);
  }
});

// ---- direction -------------------------------------------------------------

test('direction down puts the first layer at the top; right puts it at the left', async () => {
  for (const name of EXAMPLES) {
    const spec = example(name);
    const down = await layout({ ...spec, direction: 'down' });
    const right = await layout({ ...spec, direction: 'right' });
    const first = (g, axis) => g.layers[0].map((id) => g.nodes.find((n) => n.id === id)[axis]);
    const minOf = (g, axis) => Math.min(...g.nodes.map((n) => n[axis]));
    assert.ok(Math.min(...first(down, 'y')) === minOf(down, 'y'), `${name}: down first layer has the smallest y`);
    assert.ok(Math.min(...first(right, 'x')) === minOf(right, 'x'), `${name}: right first layer has the smallest x`);
    assert.ok(down.layers.length > 1 && right.layers.length > 1);
    // the main axis really swaps: layers are stacked along y when down, along x when right
    const last = (g, axis) => g.layers.at(-1).map((id) => g.nodes.find((n) => n.id === id)[axis]);
    assert.ok(Math.min(...last(down, 'y')) > Math.max(...first(down, 'y')), `${name}: down last layer is below the first`);
    assert.ok(Math.min(...last(right, 'x')) > Math.max(...first(right, 'x')), `${name}: right last layer is right of the first`);
    assertSound(down, { ...spec, direction: 'down' }, `${name}-down`);
    assertSound(right, { ...spec, direction: 'right' }, `${name}-right`);
  }
});

test('flow defaults to down; architecture and state default to right', async () => {
  const flow = await layout(example('flow'));
  assert.ok(flow.layers.length > 1 && flow.nodes.find((n) => n.id === 'done').y > flow.nodes.find((n) => n.id === 'begin').y);
  const arch = await layout(example('architecture'));
  assert.ok(arch.nodes.find((n) => n.id === 'db').x > arch.nodes.find((n) => n.id === 'web').x);
  const state = await layout(example('state'));
  assert.ok(state.nodes.find((n) => n.id === 'finish').x > state.nodes.find((n) => n.id === 'begin').x);
});

// ---- layers ----------------------------------------------------------------

test('layers hold every node once, in cross-axis order', async () => {
  for (const name of EXAMPLES) {
    const spec = example(name);
    const g = await layout(spec);
    assert.deepEqual([...g.layers.flat()].sort(), spec.nodes.map((n) => n.id).sort(), name);
    for (const n of g.nodes) assert.ok(g.layers[n.layer].includes(n.id), `${name}: ${n.id} sits in layer ${n.layer}`);
  }
  const g = await layout(example('state'));
  assert.deepEqual(g.layers[4].map((id) => g.nodes.find((n) => n.id === id).y), g.layers[4].map((id) => g.nodes.find((n) => n.id === id).y).sort((a, b) => a - b));
});

test('ELK exposes no layer id in its result, so layers come from geometry', async () => {
  const { default: ELK } = await import('elkjs/lib/elk.bundled.js');
  const out = await new ELK().layout({
    id: 'root', layoutOptions: { 'elk.algorithm': 'layered', 'elk.layered.layering.layerId': '0' },
    children: [{ id: 'a', width: 10, height: 10 }, { id: 'b', width: 10, height: 10 }], edges: [{ id: 'e', sources: ['a'], targets: ['b'] }],
  });
  for (const c of out.children) assert.equal(JSON.stringify(c).includes('layerId'), false);
});

// ---- external labels on dots ------------------------------------------------

test('dot and choice labels are laid out beside the shape, in both directions', async () => {
  for (const direction of ['right', 'down']) {
    const spec = { ...example('state'), direction };
    const g = await layout(spec);
    assertSound(g, spec, `state-${direction}`);
    for (const id of ['begin', 'ok', 'finish']) {
      const n = g.nodes.find((x) => x.id === id);
      assert.ok(n.labelBox, `${id} has a labelBox`);
      assert.equal(n.labelSide, direction === 'down' ? 'right' : 'bottom');
      assert.ok(n.labelBox.width > 0 && n.labelBox.height > 0);
      if (direction === 'right') assert.ok(n.labelBox.y >= n.y + n.height - 0.05, `${id} label is below its shape`);
      else assert.ok(n.labelBox.x >= n.x + n.width - 0.05, `${id} label is right of its shape`);
    }
    for (const n of g.nodes.filter((x) => x.shape !== 'filled-dot' && x.shape !== 'ringed-dot' && x.shape !== 'small-diamond')) {
      assert.equal(n.labelBox, undefined, `${n.id} draws its label inside`);
    }
  }
});

test('flow start and end are stadiums with their label inside', async () => {
  const g = await layout(example('flow'));
  for (const id of ['begin', 'done']) {
    const n = g.nodes.find((x) => x.id === id);
    assert.equal(n.shape, 'stadium');
    assert.equal(n.labelBox, undefined);
    assert.ok(n.lines.length >= 1);
  }
});

// ---- edge styles and self loops --------------------------------------------

test('a self loop leaves and returns to its own node and keeps its label', async () => {
  const g = await layout(example('state'));
  const loop = g.edges.find((e) => e.from === 'placed' && e.to === 'placed');
  const placed = g.nodes.find((n) => n.id === 'placed');
  assert.ok(onBorder(loop.points[0], placed) && onBorder(loop.points.at(-1), placed));
  assert.equal(loop.label.text, 'retry payment');
  assert.ok(loop.points.length >= 4);
});

test('opposite edges between two nodes both get routed', async () => {
  const spec = { title: 't', type: 'architecture', nodes: [node('a'), node('b')], edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'a', style: 'dashed' }] };
  const g = await layout(spec);
  assertSound(g, spec, 'pair');
  assert.equal(g.edges.length, 2);
});

test('the largest allowed diagram (60 nodes, 120 edges) lays out soundly', async () => {
  const nodes = Array.from({ length: 60 }, (_, i) => node(`n${i}`));
  const edges = Array.from({ length: 120 }, (_, i) => ({ from: `n${i % 60}`, to: `n${(i * 7 + 3) % 60}`, ...(i % 5 === 0 ? { label: `step ${i}` } : {}) }));
  const spec = { title: 'Big', type: 'flow', nodes, edges };
  assert.deepEqual((await validateSpec(spec)).errors, []);
  const g = await layout(spec);
  assert.equal(g.nodes.length, 60);
  assert.equal(g.edges.length, 120);
  g.nodes.forEach((a, i) => g.nodes.slice(i + 1).forEach((b) => assert.ok(!overlaps(a, b), `${a.id}/${b.id}`)));
});
