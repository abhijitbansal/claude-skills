import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { layoutGraph } from '../scripts/lib/layout-graph.mjs';
import { nodeSize, edgeLabelSize, groupMinSize, MAX_TEXT_WIDTH } from '../scripts/lib/sizes.mjs';
import { KINDS } from '../scripts/lib/kinds.mjs';
import { validateSpec } from '../scripts/lib/spec.mjs';
import { loadTheme } from '../shared/theme.mjs';
import { measure, fontFor } from '../shared/text.mjs';

const theme = loadTheme('paper');
const EXAMPLES = ['architecture', 'flow', 'state'];
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
    for (let id = n.group; id; id = g.groups.find((x) => x.id === id).parent) {
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
    if (e.label) {
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

test('labels wrap to two lines at 180 px; longer ones widen the box instead of adding a line', () => {
  const info = kind('architecture', 'service');
  const label = { ...fontFor(theme, 'body'), weight: 600, size: 14 };
  const medium = nodeSize({ id: 'x', label: 'Customer notification dispatch service' }, info, theme);
  assert.equal(medium.lines.length, 2);
  for (const l of medium.lines) assert.ok(measure(l, label) <= MAX_TEXT_WIDTH, l);
  const long = nodeSize({ id: 'x', label: 'Authentication and authorization gateway for internal admin tools' }, info, theme);
  assert.equal(long.lines.length, 2);
  assert.ok(long.width >= Math.max(...long.lines.map((l) => measure(l, label))) + 28, 'box holds the widest line');
  const unbroken = nodeSize({ id: 'x', label: 'x'.repeat(48) }, info, theme);
  assert.ok(unbroken.lines.length <= 2);
  assert.equal(nodeSize({ id: 'x', label: 'a\n\nb\tc' }, info, theme).lines.join('|'), 'a b c');
});

test('CJK and emoji labels still size to a finite, non-empty box', () => {
  const s = nodeSize({ id: 'x', label: '注文確認サービス🙂'.repeat(4) }, kind('architecture', 'service'), theme);
  assert.ok(Number.isFinite(s.width) && s.width > 80);
  assert.ok(s.lines.length >= 1 && s.lines.length <= 2);
});

test('shape minimums: dots 20x20, small diamond 24x24, cylinder +12 px, diamond is the text box times sqrt 2', () => {
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

  const decision = nodeSize({ id: 'x', label: 'Account exists?' }, kind('flow', 'decision'), theme);
  const font = { ...fontFor(theme, 'body'), weight: 600, size: 14 };
  assert.ok(decision.width >= Math.ceil(measure('Account exists?', font) * Math.SQRT2), 'diamond width covers text x sqrt 2');
  assert.equal(decision.labelBox, undefined);
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
  assert.deepEqual(Object.keys(g).sort(), ['edges', 'groups', 'height', 'layers', 'nodes', 'width']);
  const api = g.nodes.find((n) => n.id === 'api');
  assert.deepEqual(Object.keys(api).sort(), ['group', 'height', 'icon', 'id', 'layer', 'lines', 'noteLine', 'shape', 'tone', 'width', 'x', 'y']);
  assert.equal(api.shape, 'rounded-rect');
  assert.equal(api.icon, 'brand:nodedotjs');
  assert.equal(api.group, 'vpc');
  assert.equal(api.tone, 'neutral');
  assert.equal(api.noteLine, null);
  assert.deepEqual(g.nodes.find((n) => n.id === 'db').noteLine, 'primary + replica');
  assert.equal(g.nodes.find((n) => n.id === 'pay').tone, 'warn');
  assert.equal(g.nodes.find((n) => n.id === 'web').group, null);
  assert.deepEqual(g.groups.map((x) => [x.id, x.depth, x.label]), [['aws', 0, 'AWS us-east-1'], ['vpc', 1, 'Private VPC']]);
  const [e0, , , e3] = g.edges;
  assert.deepEqual([e0.id, e0.from, e0.to, e0.style, e0.both], ['e0', 'web', 'api', 'solid', false]);
  assert.equal(e0.label.text, 'POST /checkout');
  assert.deepEqual(Object.keys(e0.label).sort(), ['height', 'text', 'width', 'x', 'y']);
  assert.deepEqual([e3.style, e3.both, e3.label], ['dashed', true, undefined]);
});

test('an explicit edge id is kept; the default is e<index>', async () => {
  const spec = { title: 't', type: 'flow', nodes: [node('a'), node('b'), node('c')], edges: [{ from: 'a', to: 'b', id: 'first' }, { from: 'b', to: 'c' }] };
  assert.deepEqual((await layout(spec)).edges.map((e) => e.id), ['first', 'e1']);
});

test('a node, group and edge may share an id', async () => {
  const spec = {
    title: 't', type: 'architecture', groups: [{ id: 'x', label: 'G' }],
    nodes: [node('y', { group: 'x' }), node('z')], edges: [{ id: 'y', from: 'y', to: 'z' }, { id: 'x', from: 'z', to: 'y' }],
  };
  const g = await layout(spec);
  assert.deepEqual(g.edges.map((e) => e.id), ['y', 'x']);
  assertSound(g, spec, 'shared-ids');
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
    assert.equal(g.nodes[0].y, MARGIN);
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
