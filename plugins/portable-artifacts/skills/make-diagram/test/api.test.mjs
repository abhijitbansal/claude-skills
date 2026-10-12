import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as api from '../scripts/lib/api.mjs';
import { buildDiagram } from '../scripts/lib/api.mjs';
import { loadTheme } from '../shared/theme.mjs';

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const example = (name) => JSON.parse(fs.readFileSync(here(`../references/examples/${name}.diagram.json`), 'utf8'));
const NAMES = ['architecture', 'flow', 'state', 'sequence'];

test('api.mjs exports buildDiagram and nothing else in this task', () => {
  assert.deepEqual(Object.keys(api), ['buildDiagram']);
});

for (const name of NAMES) {
  test(`${name}: buildDiagram returns svg, css, size, steps and ids`, async () => {
    const spec = example(name);
    const out = await buildDiagram(spec);
    for (const key of ['svg', 'css', 'width', 'height', 'steps', 'ids']) assert.ok(key in out, key);
    assert.match(out.svg, /^<svg [^>]*viewBox="0 0 [\d.]+ [\d.]+"/);
    assert.ok(out.width > 0 && out.height > 0);
    assert.ok(out.svg.includes(`viewBox="0 0 ${out.width} ${out.height}"`));
    assert.ok(!/@font-face|<style/.test(out.svg + out.css), 'no fonts and no style block: the page supplies them');
    assert.ok(out.css.includes('.pa-node'));
    assert.ok(Array.isArray(out.steps) && out.steps.length > 0);
    // every id a step names is a drawable id
    const known = new Set(out.ids);
    for (const s of out.steps) for (const id of [...s.show, ...(s.focus ?? [])]) assert.ok(known.has(id), `${name}: ${id}`);
    assert.deepEqual(await buildDiagram(spec), await buildDiagram(spec), 'deterministic');
  });
}

test('ids: groups then nodes for graphs, participants then messages for sequences', async () => {
  assert.deepEqual((await buildDiagram(example('architecture'))).ids, ['aws', 'vpc', 'web', 'api', 'db', 'pay']);
  assert.deepEqual((await buildDiagram(example('sequence'))).ids.slice(0, 7), ['shopper', 'web', 'orders', 'db', 'psp', 'm1', 'm2']);
});

test('steps from the spec are passed through', async () => {
  const spec = example('architecture');
  const { steps } = await buildDiagram(spec);
  assert.deepEqual(steps, spec.steps);
  assert.notEqual(steps[0], spec.steps[0], 'copies, not the spec objects');
});

test('without steps a graph gets one step per layer, titled by the layer\'s first node', async () => {
  const spec = example('flow');
  const { steps, geometry } = await buildDiagram(spec);
  assert.equal(steps.length, geometry.layers.length);
  const label = new Map(spec.nodes.map((n) => [n.id, n.label]));
  steps.forEach((s, i) => {
    const layer = geometry.layers[i];
    assert.deepEqual(s.show, layer);
    assert.deepEqual(s.focus, layer);
    assert.equal(s.title, layer.length === 1 ? label.get(layer[0]) : `${label.get(layer[0])} and ${layer.length - 1} more`);
  });
  assert.deepEqual(steps.flatMap((s) => s.show).sort(), spec.nodes.map((n) => n.id).sort(), 'every node appears once');
});

test('a wide layer is titled "<Label> and N more"', async () => {
  const spec = { title: 't', type: 'architecture', nodes: [{ id: 'a', label: 'Root' }, { id: 'b', label: 'Left' }, { id: 'c', label: 'Middle' }, { id: 'd', label: 'Right' }], edges: [{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }, { from: 'a', to: 'd' }] };
  const { steps, geometry } = await buildDiagram(spec);
  const first = spec.nodes.find((n) => n.id === geometry.layers[1][0]).label; // the top-most node of the layer
  assert.deepEqual(steps.map((s) => s.title), ['Root', `${first} and 2 more`]);
});

test('without steps a sequence gets one step per message, the first also showing every participant', async () => {
  const spec = example('sequence');
  delete spec.steps;
  const { steps } = await buildDiagram(spec);
  assert.equal(steps.length, spec.messages.length);
  assert.deepEqual(steps[0].show, [...spec.participants.map((p) => p.id), 'm1']);
  assert.deepEqual(steps[1].show, ['m2']);
  assert.equal(steps[0].title, 'press Pay');
  assert.deepEqual(steps[2].focus, ['m3', 'orders', 'db']);
});

test('a sequence with more messages than the step limit is chunked to at most 25 steps', async () => {
  const messages = Array.from({ length: 60 }, (_, i) => ({ id: `m${i + 1}`, from: i % 2 ? 'b' : 'a', to: i % 2 ? 'a' : 'b' }));
  const { steps } = await buildDiagram({ title: 't', type: 'sequence', participants: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], messages });
  assert.ok(steps.length <= 25);
  assert.equal(steps.flatMap((s) => s.show).filter((id) => id.startsWith('m')).length, 60);
  assert.match(steps[0].title, /^A to B and 2 more$/);
});

test('theme: a name, a loaded theme, the spec theme, or the default', async () => {
  const spec = example('flow');
  const byName = await buildDiagram(spec, { theme: 'paper' });
  assert.deepEqual(await buildDiagram(spec, { theme: loadTheme('paper') }), byName);
  assert.deepEqual(await buildDiagram(spec), byName);
  const editorial = await buildDiagram({ ...spec, theme: 'editorial' });
  assert.notEqual(editorial.width, undefined);
  await assert.rejects(buildDiagram(spec, { theme: 'nope' }), /unknown theme "nope"/);
});

test('an invalid spec throws DiagramError carrying the validator errors', async () => {
  const spec = example('flow');
  spec.edges[0].to = 'nowhere';
  await assert.rejects(buildDiagram(spec), (e) => {
    assert.equal(e.name, 'DiagramError');
    assert.deepEqual(e.errors.map((x) => x.path), ['edges[0].to']);
    assert.match(e.message, /edges\[0\]\.to: "nowhere" not found/);
    return true;
  });
});

test('a layout that fails the geometry lint throws DiagramError with the lint errors', async () => {
  const spec = { title: 't', type: 'flow', nodes: [{ id: 'a', label: '注文確認サービス🙂'.repeat(4) }] };
  await assert.rejects(buildDiagram(spec), (e) => {
    assert.equal(e.name, 'DiagramError');
    assert.deepEqual(e.errors.map((x) => x.path), ['nodes[0].label']);
    return true;
  });
});

test('two diagrams on one page do not share ids when given different prefixes', async () => {
  const a = await buildDiagram(example('flow'), { idPrefix: 'one' });
  const b = await buildDiagram(example('flow'), { idPrefix: 'two' });
  const idsOf = (svg) => [...svg.matchAll(/ id="([^"]*)"/g)].map((m) => m[1]);
  assert.equal(idsOf(a.svg).filter((id) => idsOf(b.svg).includes(id)).length, 0);
});

test('hostile text survives the whole pipeline as text', async () => {
  const { svg } = await buildDiagram({ title: '<b>&"x"', type: 'state', nodes: [{ id: 'a', label: '<b>&"x"' }, { id: 'b', label: 'B' }], edges: [{ from: 'a', to: 'b', label: '<i>' }] });
  assert.ok(!svg.includes('<b>') && !svg.includes('<i>'));
  assert.ok(svg.includes('&lt;b&gt;&amp;&quot;x&quot;'));
});
