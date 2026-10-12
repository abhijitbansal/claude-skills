import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { layoutGraph } from '../scripts/lib/layout-graph.mjs';
import { layoutSequence } from '../scripts/lib/layout-sequence.mjs';
import { lintGeometry } from '../scripts/lib/lint.mjs';
import { validateSpec } from '../scripts/lib/spec.mjs';
import { loadTheme } from '../shared/theme.mjs';

const theme = loadTheme('paper');
const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const read = (rel) => JSON.parse(fs.readFileSync(here(rel), 'utf8'));
const example = (name) => read(`../references/examples/${name}.diagram.json`);
const lint = (g) => lintGeometry(g, { theme });
const graph = (name) => layoutGraph(example(name), theme);
const sequence = () => layoutSequence(example('sequence'), theme);
const clone = structuredClone;
const only = (errors) => errors.map((e) => `${e.path}: ${e.message}`);

for (const name of ['architecture', 'flow', 'state']) {
  test(`${name} example lints clean`, async () => {
    assert.deepEqual(lint(await graph(name)), []);
  });
}

test('sequence example and fixture lint clean', () => {
  assert.deepEqual(lint(sequence()), []);
  assert.deepEqual(lint(layoutSequence(read('./fixtures/sequence.diagram.json'), theme)), []);
});

test('lintGeometry needs a theme', async () => {
  const g = await graph('flow');
  assert.throws(() => lintGeometry(g), /needs \{ theme \}/);
});

// ---- RED proofs: injected bad geometry must be reported -------------------------

test('overlapping nodes are reported with both ids and the later spec path', async () => {
  const g = clone(await graph('flow'));
  const [, a, b] = g.nodes; // two ungrouped nodes
  g.nodes[1] = { ...a, x: b.x + 4, y: b.y + 4 };
  const errors = lint(g);
  assert.equal(errors.length, 1, only(errors).join('\n'));
  assert.equal(errors[0].path, 'nodes[2]');
  assert.ok(errors[0].message.includes(`"${a.id}"`) && errors[0].message.includes(`"${b.id}"`), errors[0].message);
  assert.match(errors[0].message, /overlaps node/);
});

test('the label of a dot counts as part of the dot: a node on top of it overlaps', async () => {
  const g = clone(await graph('state'));
  const dot = g.nodes.find((n) => n.labelBox);
  const other = g.nodes.find((n) => n !== dot && !n.labelBox);
  const idx = g.nodes.indexOf(other);
  g.nodes[idx] = { ...other, x: dot.labelBox.x, y: dot.labelBox.y };
  assert.ok(lint(g).some((e) => e.path === `nodes[${Math.max(idx, g.nodes.indexOf(dot))}]`), only(lint(g)).join('\n'));
});

test('an edge label over a node is reported at the edge', async () => {
  const g = clone(await graph('architecture'));
  const i = g.edges.findIndex((e) => e.label);
  const target = g.nodes[0];
  g.edges[i].label = { ...g.edges[i].label, x: target.x + 2, y: target.y + 2 };
  const errors = lint(g);
  assert.equal(errors.length, 1, only(errors).join('\n'));
  assert.equal(errors[0].path, `edges[${i}].label`);
  assert.match(errors[0].message, new RegExp(`overlaps node "${target.id}"`));
});

test('text wider than its box is reported with both widths', async () => {
  const g = clone(await graph('architecture'));
  const i = g.nodes.findIndex((n) => n.id === 'api');
  g.nodes[i].lines = ['A label far longer than the box that the layout reserved for it'];
  const [error, ...rest] = lint(g);
  assert.equal(rest.length, 0);
  assert.equal(error.path, `nodes[${i}].label`);
  assert.match(error.message, /^text is \d+ px wide; the box fits \d+ px — shorten the label$/);
  const [, wide, fits] = error.message.match(/is (\d+) px wide; the box fits (\d+) px/);
  assert.ok(Number(wide) > Number(fits));
});

test('a note wider than its box is reported at the note', async () => {
  const g = clone(await graph('architecture'));
  const i = g.nodes.findIndex((n) => n.id === 'db');
  g.nodes[i].noteLine = 'a note that is much longer than the box was sized for, by far';
  assert.deepEqual(lint(g).map((e) => e.path), [`nodes[${i}].note`]);
});

test('a label of three lines is reported with the pinned message', async () => {
  const g = clone(await graph('architecture'));
  g.nodes[0].lines = ['one', 'two', 'three'];
  assert.deepEqual(lint(g), [{ path: 'nodes[0].label', message: 'wraps to 3 lines in a 240 px box; shorten it (48 characters of ordinary text fit)' }]);
});

test('a node outside its group, and a group outside its parent, are reported', async () => {
  const g = clone(await graph('architecture'));
  const i = g.nodes.findIndex((n) => n.id === 'api');
  g.nodes[i].y -= 200;
  const j = g.groups.findIndex((x) => x.id === 'vpc');
  g.groups[j].x += 400;
  const errors = lint(g);
  assert.ok(errors.some((e) => e.path === `nodes[${i}].group` && /lies outside its group/.test(e.message)), only(errors).join('\n'));
  assert.ok(errors.some((e) => e.path === `groups[${j}].parent` && /outside its parent "aws"/.test(e.message)), only(errors).join('\n'));
});

test('sequence: overlapping participants, an oversized note and a label outside its lifelines are reported', () => {
  const g = clone(sequence());
  g.participants[1] = { ...g.participants[1], x: g.participants[0].x + 4 };
  g.notes[0].lines = ['a note line that is far wider than the note box that holds it, surely'];
  g.messages[0].label = { ...g.messages[0].label, x: g.messages[0].label.x + 400 };
  const errors = lint(g);
  assert.ok(errors.some((e) => e.path === 'participants[1]'), only(errors).join('\n'));
  assert.ok(errors.some((e) => e.path === 'notes[0].text' && /shorten the note/.test(e.message)), only(errors).join('\n'));
  assert.ok(errors.some((e) => e.path === 'messages[0].label' && /between its lifelines/.test(e.message)), only(errors).join('\n'));
});

test('sequence: a frame label wider than its frame is reported', () => {
  const g = clone(sequence());
  g.frames[0].labelBox = { ...g.frames[0].labelBox, width: g.frames[0].width };
  assert.deepEqual(lint(g).map((e) => e.path), ['frames[0].label']);
});

// ---- the real thing: wide glyphs go through validateSpec (Review Focus 3) -----------

const WIDE = '注文確認サービス🙂'.repeat(4);

test('a CJK/emoji label that wraps to three lines is caught by validateSpec', async () => {
  const spec = { title: 'wide', type: 'architecture', nodes: [{ id: 'a', label: WIDE }, { id: 'b', label: 'Fine' }], edges: [{ from: 'a', to: 'b' }] };
  const { ok, errors } = await validateSpec(spec);
  assert.equal(ok, false);
  assert.equal(errors.length, 1, only(errors).join('\n'));
  assert.equal(errors[0].path, 'nodes[0].label');
  assert.match(errors[0].message, /^wraps to \d+ lines in a 240 px box; shorten it \(48 characters of ordinary text fit\)$/);
});

test('the same wide label passes with layout: false (the semantic checks alone)', async () => {
  const spec = { title: 'wide', type: 'architecture', nodes: [{ id: 'a', label: WIDE }] };
  assert.equal((await validateSpec(spec, { layout: false })).ok, true);
});

test('a wide participant label in a sequence diagram is caught too', async () => {
  const spec = { title: 'wide', type: 'sequence', participants: [{ id: 'a', label: WIDE }, { id: 'b', label: 'B' }], messages: [{ id: 'm1', from: 'a', to: 'b' }] };
  const { errors } = await validateSpec(spec);
  assert.deepEqual(errors.map((e) => e.path), ['participants[0].label']);
});

test('an ordinary 48-character label is not flagged', async () => {
  const spec = { title: 'ok', type: 'flow', nodes: [{ id: 'a', label: 'Authentication and authorization gateway service' }, { id: 'b', label: 'x'.repeat(48) }], edges: [{ from: 'a', to: 'b' }] };
  assert.deepEqual((await validateSpec(spec)).errors, []);
});
