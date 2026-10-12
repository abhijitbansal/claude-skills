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

test('api.mjs exports buildDiagram, validateSpec and viewerRuntime', () => {
  assert.deepEqual(Object.keys(api).sort(), ['buildDiagram', 'validateSpec', 'viewerRuntime']);
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

test('steps from the spec are passed through, then a final "Everything" step for what no step shows', async () => {
  const spec = example('architecture');
  const { steps, ids } = await buildDiagram(spec);
  assert.deepEqual(steps.slice(0, spec.steps.length), spec.steps);
  assert.notEqual(steps[0], spec.steps[0], 'copies, not the spec objects');
  assert.equal(steps.length, spec.steps.length + 1);
  assert.deepEqual(steps.at(-1), { title: 'Everything', show: ['pay'], focus: ids });
});

test('steps share no arrays with the caller\'s spec', async () => {
  const spec = example('architecture');
  const before = JSON.stringify(spec);
  const { steps } = await buildDiagram(spec);
  for (const s of steps) for (const key of ['show', 'focus', 'highlight']) s[key]?.push('zzz');
  assert.equal(JSON.stringify(spec), before);
  for (const [i, s] of spec.steps.entries()) for (const key of ['show', 'focus', 'highlight']) if (s[key]) assert.notEqual(steps[i][key], s[key], key);
});

const trio = (steps) => ({ title: 't', type: 'architecture', nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }], edges: [{ from: 'a', to: 'b' }], steps });

test('ids named only by focus or highlight count as shown (no "Everything" step)', async () => {
  const { steps } = await buildDiagram(trio([{ title: 'one', show: ['a'], focus: ['b'], highlight: ['c'] }]));
  assert.deepEqual(steps.map((s) => s.title), ['one']);
});

test('a node left out of every step appears in a final "Everything" step', async () => {
  const { steps } = await buildDiagram(trio([{ title: 'one', show: ['a'] }, { title: 'two', show: ['b'], focus: ['b'] }]));
  assert.deepEqual(steps.map((s) => s.title), ['one', 'two', 'Everything']);
  assert.deepEqual(steps[2].show, ['c']);
  assert.deepEqual(steps[2].focus, ['a', 'b', 'c']);
});

test('showing a node counts its ancestor groups as shown', async () => {
  const spec = { title: 't', type: 'architecture', groups: [{ id: 'g1', label: 'G1' }, { id: 'g2', label: 'G2', parent: 'g1' }], nodes: [{ id: 'n', label: 'N', group: 'g2' }], steps: [{ title: 'only', show: ['n'] }] };
  const { steps } = await buildDiagram(spec);
  assert.deepEqual(steps.map((s) => s.title), ['only']);
});

test('an empty group nobody shows is listed in the "Everything" step', async () => {
  const spec = { title: 't', type: 'architecture', groups: [{ id: 'g1', label: 'G1' }], nodes: [{ id: 'n', label: 'N' }], steps: [{ title: 'only', show: ['n'] }] };
  const { steps } = await buildDiagram(spec);
  assert.deepEqual(steps.at(-1).show, ['g1']);
});

test('at the step limit, leftovers join the last step instead of adding a 26th', async () => {
  const nodes = Array.from({ length: 26 }, (_, i) => ({ id: `n${i}`, label: `N${i}` }));
  const steps = nodes.slice(0, 25).map((n) => ({ title: n.label, show: [n.id] }));
  const out = await buildDiagram({ title: 't', type: 'architecture', nodes, steps });
  assert.equal(out.steps.length, 25);
  assert.deepEqual(out.steps[24].show, ['n24', 'n25']);
});

test('a sequence whose steps skip messages gets an "Everything" step with them and the unseen participants', async () => {
  const spec = example('sequence');
  spec.steps = [{ title: 'first', show: ['m1'] }];
  const { steps } = await buildDiagram(spec);
  assert.deepEqual(steps.map((s) => s.title), ['first', 'Everything']);
  assert.ok(steps[1].show.includes('m2') && steps[1].show.includes('psp'));
  assert.ok(!steps[1].show.includes('m1') && !steps[1].show.includes('shopper'), 'm1 and its ends were shown');
});

test('a sequence with no messages still gets one step showing the participants', async () => {
  const { steps } = await buildDiagram({ title: 't', type: 'sequence', participants: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] });
  assert.equal(steps.length, 1);
  assert.deepEqual(steps[0].show, ['a', 'b']);
  assert.deepEqual(steps[0].focus, ['a', 'b']);
});

test('idPrefix must match ^[A-Za-z0-9_-]+$', async () => {
  for (const bad of ['a b', 'a"b', '<x>', '', 'ü']) {
    await assert.rejects(buildDiagram(example('flow'), { idPrefix: bad }), /idPrefix must match \/\^\[A-Za-z0-9_-\]\+\$\//, JSON.stringify(bad));
  }
  const ok = await buildDiagram(example('flow'), { idPrefix: 'My_diagram-2' });
  assert.ok(ok.svg.includes('id="My_diagram-2-title"'));
});

test('viewerRuntime is the page script without toolbar chrome', () => {
  const src = api.viewerRuntime();
  assert.equal(typeof src, 'string');
  assert.ok(src.length > 2000);
  assert.doesNotThrow(() => new Function(src), 'valid JavaScript');
  for (const chrome of ['data-theme-toggle', 'data-export', 'data-act', 'pa-theme', 'paReady', 'localStorage']) assert.ok(!src.includes(chrome), chrome);
  assert.ok(src.includes('PADiagram'));
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

test('auto steps also reveal an empty group (nothing else would): a closing "Everything" step', async () => {
  const spec = { title: 't', type: 'architecture', groups: [{ id: 'empty', label: 'Empty' }], nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], edges: [{ from: 'a', to: 'b' }] };
  const { steps } = await buildDiagram(spec);
  assert.equal(steps.at(-1).title, 'Everything');
  assert.deepEqual(steps.at(-1).show, ['empty']);
  assert.deepEqual(steps.slice(0, -1).flatMap((s) => s.show).sort(), ['a', 'b']);
  const plain = await buildDiagram({ ...spec, groups: [] });
  assert.ok(plain.steps.every((s) => s.title !== 'Everything'), 'no extra step when everything is shown');
});

test('the result carries `data`: what PADiagram.mount needs, and the export filename stem', async () => {
  const spec = example('sequence');
  const out = await buildDiagram(spec);
  assert.deepEqual(Object.keys(out.data).sort(), ['adjacency', 'animate', 'boxes', 'edges', 'frames', 'height', 'ids', 'parents', 'stem', 'steps', 'title', 'type', 'width']);
  assert.equal(out.data.stem, 'checkout-with-payment-retry');
  assert.equal(out.data.steps, out.steps);
  assert.equal(out.data.width, out.width);
  assert.deepEqual(out.data.edges.m1, ['shopper', 'web']);
  assert.equal(out.data.frames.length, spec.frames.length);
  assert.ok(out.data.frames.every((f) => f.messages.length > 0 && f.box.length === 4));
  const flow = await buildDiagram(example('flow'));
  assert.deepEqual(flow.data.frames, []);
  assert.equal((await buildDiagram({ ...spec, title: 'x'.repeat(100) })).data.stem, 'x'.repeat(60));
});
