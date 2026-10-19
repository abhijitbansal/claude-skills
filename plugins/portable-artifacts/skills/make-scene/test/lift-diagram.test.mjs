// The diagram lift: a make-diagram diagram.json laid flat (architecture, flow, state) or stood up
// (sequence) as a scene graph, its stories as a tour, and its errors reported under lift.diagram.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertGraph } from '../scripts/lib/graph.mjs';
import { buildScene, SceneError, validateSpec } from '../scripts/lib/api.mjs';
import { loadTheme } from '../shared/theme.mjs';
import { liftDiagram, diagramLiftCheck, DIAGRAM_MAX_BYTES } from '../scripts/lifts/diagram.mjs';
import { installCommand } from '../scripts/lib/siblings.mjs';
import { build } from '../scripts/build.mjs';
import { PINNED_ENV, tempDir } from './helpers/scene-fixtures.mjs';

const FIX = fileURLToPath(new URL('./fixtures/', import.meta.url));
const GOLDEN_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'golden');
const THEME = loadTheme('dusk');
const read = (name) => JSON.parse(fs.readFileSync(path.join(FIX, name), 'utf8'));
const lift = (source, extra = {}) => liftDiagram(source, { dir: FIX, theme: THEME, ...extra });
const scene = (extra = {}) => ({ title: 'Lifted', lift: { diagram: 'architecture.diagram.json' }, ...extra });
const errorAt = (result, p) => result.errors.find((e) => e.path === p);
const tubeIds = (g) => g.tubes.map((t) => t.id);
const shapesOf = (g) => g.batches.map((b) => b.shape);

// The golden keeps the geometry and drops the 2D drawing (make-diagram's SVG and CSS are its own contract).
const goldenOf = (g) => ({ ...g, fallback: { kind: g.fallback.kind, columns: g.fallback.columns, rows: g.fallback.rows, svg: null } });
const layout = (g) => `{\n${Object.keys(g).map((k) => ` ${JSON.stringify(k)}: ${JSON.stringify(g[k])}`).join(',\n')}\n}\n`;

for (const [name, file] of [['architecture', 'architecture.diagram.json'], ['sequence', 'sequence.diagram.json']]) {
  test(`${name} golden`, async () => {
    const graph = await lift(file);
    assertGraph(graph);
    assert.equal(graph.kind, 'diagram');
    assert.equal(graph.fallback.kind, 'svg');
    assert.ok(graph.fallback.svg.startsWith('<svg'), 'the 2D drawing ships as the fallback');
    assert.ok(graph.fallback.css.length > 100, 'and its css, once per page');
    const golden = path.join(GOLDEN_DIR, `lift-${name}.json`);
    if (process.env.UPDATE_GOLDEN === '1') {
      fs.mkdirSync(GOLDEN_DIR, { recursive: true });
      fs.writeFileSync(golden, layout(goldenOf(graph)));
    }
    assert.deepEqual(JSON.parse(JSON.stringify(goldenOf(graph))), JSON.parse(fs.readFileSync(golden, 'utf8')));
  });

  test(`${name}: same input same bytes`, async () => {
    assert.equal(JSON.stringify(await lift(file)), JSON.stringify(await lift(file)));
  });
}

test('architecture: kind picks shape, groups are platforms raised by depth, edges are tubes at y 0.3', async () => {
  const g = await lift('architecture.diagram.json');
  assert.ok(shapesOf(g).includes('cylinder'), 'database is a cylinder');
  const platforms = g.batches.find((b) => b.colour === 'line');
  assert.equal(platforms.instances.length, 2, 'two groups, two platforms');
  const [aws, vpc] = platforms.instances;
  assert.ok(vpc[1] > aws[1], 'the nested group stands higher than its parent, so it shows');
  assert.ok(platforms.instances.every((i) => i[6] === -1), 'platforms are decoration');
  assert.equal(g.tubes.length, 4);
  assert.ok(g.tubes.every((t) => t.points.every((p) => p[1] === 0.3)), 'tubes run at y 0.3');
  const byLabel = Object.fromEntries(g.tubes.map((t) => [t.label, t]));
  assert.equal(byLabel['charges card'].colour, 'accent', 'async is the accent colour');
  assert.equal(byLabel['POST /checkout'].colour, 'text', 'solid is the text colour');
  assert.ok(g.tubes.some((t) => t.colour === 'text2'), 'dashed is text2');
  assert.equal(byLabel['POST /checkout'].display, 'Web app → Checkout API');
  assert.deepEqual(tubeIds(g), ['edge-0', 'edge-1', 'edge-2', 'edge-3'], 'tube ids are make-diagram edge ids');
});

test('architecture: nodes are items with label and a display from detail or kind, labels and focus per node', async () => {
  const g = await lift('story.diagram.json');
  const orders = g.items.find((i) => i.label === 'Orders service');
  assert.match(orders.display, /^Owns the order lifecycle/);
  assert.equal(g.items.find((i) => i.label === 'Orders DB').display, 'database');
  assert.ok(g.items.every((i) => i.value === 0 && Number.isInteger(i.group)));
  assert.deepEqual(g.groups.map((x) => x.name), ['user', 'client', 'gateway', 'service', 'database', 'queue', 'external']);
  assert.ok(g.labels.some((l) => l.text === 'Orders service'));
  for (const key of ['shopper', 'orders', 'core', 'edge']) assert.ok(Object.hasOwn(g.focus, key), `focus has ${key}`);
  const queue = g.batches.find((b) => b.shape === 'box' && b.instances.length === 3 && b.instances.every((i) => i[6] === g.items.findIndex((x) => x.label === 'Event bus')));
  assert.ok(queue, 'a queue is three stacked slabs');
});

test('no tube repeats a point (a spline through coincident points is NaN)', async () => {
  for (const file of ['architecture', 'flow', 'state', 'story', 'sequence']) {
    const g = await lift(`${file}.diagram.json`);
    for (const t of g.tubes) {
      t.points.forEach((p, i) => i === 0 || assert.notDeepEqual(p, t.points[i - 1], `${file} ${t.id} repeats ${JSON.stringify(p)}`));
      assert.ok(t.points.length >= 2, `${file} ${t.id} has a route`);
    }
  }
});

test('flow and state: decision and choice are cones, start and end are discs', async () => {
  const flow = await lift('flow.diagram.json');
  assert.ok(shapesOf(flow).includes('cone') && shapesOf(flow).includes('disc'));
  const state = await lift('state.diagram.json');
  assert.ok(shapesOf(state).includes('disc'));
  assertGraph(flow);
  assertGraph(state);
});

test('sequence: participants are pillars along x, messages step down in time', async () => {
  const g = await lift('sequence.diagram.json');
  const spec = read('sequence.diagram.json');
  assert.equal(g.tubes.length, spec.messages.length);
  assert.deepEqual(tubeIds(g), spec.messages.map((m) => m.id));
  const ys = g.tubes.map((t) => t.points[0][1]);
  assert.ok(ys.every((y, i) => i === 0 || y < ys[i - 1]), 'each message sits lower than the one before');
  const pillars = g.items.map((_, i) => g.batches.flatMap((b) => b.instances).filter((x) => x[6] === i)[0]);
  assert.ok(pillars.every((p, i) => i === 0 || p[0] > pillars[i - 1][0]), 'participants run left to right');
  assert.ok(pillars.every((p) => p[4] > 5), 'pillars are tall');
  const self = g.tubes.find((t) => t.id === 'm6');
  assert.ok(self.points.length > 2, 'a self message is a loop');
  assert.equal(g.tubes.find((t) => t.id === 'm5').colour, 'text2', 'a reply is text2');
  assert.equal(g.tubes.find((t) => t.id === 'm4').colour, 'accent', 'async is accent');
  assert.ok(Object.hasOwn(g.focus, 'psp'));
});

test('stories become tour beats with paths', async () => {
  const g = await lift('story.diagram.json');
  assert.equal(g.tour.length, 9);
  const [first, second] = g.tour;
  assert.deepEqual(first, { title: 'The shopper taps Buy', caption: 'The app builds the order from the basket.', focus: 'app', path: 'edge-0', reverse: false });
  assert.deepEqual({ focus: second.focus, path: second.path }, { focus: 'gateway', path: 'place' });
  assert.ok(g.tour.every((b) => b.path === null || tubeIds(g).includes(b.path)), 'every path names a tube');
  assert.ok(g.tour.every((b) => Object.hasOwn(g.focus, b.focus)), 'every focus is a key');
  const last = g.tour.at(-1);
  assert.deepEqual({ focus: last.focus, path: last.path, reverse: last.reverse }, { focus: 'core', path: null, reverse: false });
});

test('reply beat reverses', async () => {
  const g = await lift('story.diagram.json');
  const reply = g.tour.find((b) => b.title === 'The shopper sees a receipt');
  assert.equal(reply.reverse, true);
  assert.equal(reply.path, 'edge-0');
  assert.equal(reply.focus, 'shopper', 'the camera goes to where the light ends up');
  assert.equal(g.tour.find((b) => b.title === '201 goes back').reverse, false, 'a reply with its own edge plays forward');
});

test('a diagram without stories has no tour', async () => {
  assert.deepEqual((await lift('architecture.diagram.json')).tour, []);
});

test('a lift tour is capped at the scene limit', async () => {
  const spec = read('story.diagram.json');
  spec.stories[0].beats = Array.from({ length: 14 }, (_, i) => ({ title: `b${i}`, edge: 'place' }));
  spec.stories[1].beats = [{ title: 'end', focus: ['core'] }];
  const g = await lift(spec);
  assert.equal(g.tour.length, 12);
});

test('tour focus on unknown node id suggests one', async () => {
  const r = await validateSpec(scene({ tour: [{ title: 'Look', focus: ['ap'] }, { title: 'Fine', focus: ['API', 'vpc'] }] }), { dir: FIX });
  assert.equal(r.ok, false);
  assert.equal(errorAt(r, 'tour[0].focus[0]').message, '"ap" is not a node or group id; did you mean "api"?');
  assert.equal(r.errors.length, 1, 'ids match case-insensitively, groups count');
  const seq = await validateSpec({ title: 'S', lift: { diagram: 'sequence.diagram.json' }, tour: [{ title: 'x', focus: ['pps'] }] }, { dir: FIX });
  assert.match(errorAt(seq, 'tour[0].focus[0]').message, /is not a participant id; did you mean "psp"\?/);
});

test('a valid diagram lift passes validateSpec', async () => {
  assert.deepEqual(await validateSpec(scene(), { dir: FIX }), { ok: true, errors: [] });
});

test('invalid diagram reports under lift.diagram', async () => {
  const bad = read('architecture.diagram.json');
  bad.nodes[1].kind = 'databse';
  const r = await validateSpec(scene({ lift: { diagram: bad } }), { dir: FIX });
  assert.equal(r.ok, false);
  const e = errorAt(r, 'lift.diagram.nodes[1].kind');
  assert.match(e.message, /did you mean "database"\?/);
  const empty = await validateSpec(scene({ lift: { diagram: { title: 'x' } } }), { dir: FIX });
  assert.ok(empty.errors.every((x) => x.path.startsWith('lift.diagram')), JSON.stringify(empty.errors));
});

test('an invalid diagram in a file names the file and buildScene throws SceneError with the same paths', async (t) => {
  const dir = tempDir(t);
  const bad = read('architecture.diagram.json');
  bad.edges[0].to = 'nowhere';
  fs.writeFileSync(path.join(dir, 'd.json'), JSON.stringify(bad));
  const spec = scene({ lift: { diagram: 'd.json' } });
  const r = await validateSpec(spec, { dir });
  assert.ok(r.errors.length > 0 && r.errors.every((e) => e.path.startsWith('lift.diagram.edges[0]') && e.message.endsWith('(in d.json)')), JSON.stringify(r.errors));
  await assert.rejects(() => buildScene(spec, { dir, theme: THEME }), (e) => e instanceof SceneError && e.errors[0].path.startsWith('lift.diagram.edges[0]'));
});

test('malformed JSON in a lift file is a lift.diagram error, never a stack', async (t) => {
  const dir = tempDir(t);
  fs.writeFileSync(path.join(dir, 'd.json'), '{ "title": ');
  const r = await validateSpec(scene({ lift: { diagram: 'd.json' } }), { dir });
  assert.match(errorAt(r, 'lift.diagram').message, /not valid JSON/);
});

test('missing make-diagram gives install command', async (t) => {
  const root = tempDir(t); // a folder with no make-diagram in it
  const command = installCommand(['make-diagram']);
  await assert.rejects(
    () => lift('architecture.diagram.json', { siblingRoot: root }),
    (e) => e instanceof SceneError && e.errors[0].path === 'lift.diagram' && e.errors[0].message.includes(command) && e.errors[0].message.includes('next to make-scene'),
  );
  const errors = await diagramLiftCheck(scene(), { dir: FIX }, { siblingRoot: root });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].path, 'lift.diagram');
  assert.ok(errors[0].message.includes(command));
});

test('inline and path sources both work', async () => {
  const fromPath = await lift('architecture.diagram.json');
  const inline = await lift(read('architecture.diagram.json'));
  assert.equal(JSON.stringify(inline), JSON.stringify(fromPath));
});

test('source over 1 MB rejected', async (t) => {
  const dir = tempDir(t);
  const big = { ...read('architecture.diagram.json'), pad: 'x'.repeat(DIAGRAM_MAX_BYTES) };
  fs.writeFileSync(path.join(dir, 'big.json'), JSON.stringify(big));
  const r = await validateSpec(scene({ lift: { diagram: 'big.json' } }), { dir });
  assert.match(errorAt(r, 'lift.diagram').message, /1024 KB/);
  const inline = await validateSpec(scene({ lift: { diagram: big } }), { dir });
  assert.match(errorAt(inline, 'lift.diagram').message, /1024 KB/);
  await assert.rejects(() => lift(big), (e) => e instanceof SceneError && /1024 KB/.test(e.errors[0].message));
});

test('buildScene lifts a diagram: html fragment, fallback svg, css once, spec tour wins over stories', async () => {
  const built = await buildScene(scene({ lift: { diagram: 'story.diagram.json' }, tour: [{ title: 'Just this', focus: ['Orders'] }] }), { dir: FIX, theme: THEME, idPrefix: 'lift' });
  assert.equal(built.graph.kind, 'diagram');
  assert.equal(built.graph.title, 'Lifted', 'the scene spec title wins');
  assert.deepEqual(built.graph.tour, [{ title: 'Just this', caption: '', focus: 'orders', path: null, reverse: false }]);
  assert.match(built.html, /class="sc-fb-svg"><svg/);
  assert.equal(built.html.includes('id="lift"'), true);
  assert.match(built.css, /\.pa-scene/);
  const stories = await buildScene(scene({ lift: { diagram: 'story.diagram.json' } }), { dir: FIX, theme: THEME });
  assert.equal(stories.graph.tour.length, 9, 'with no tour, the stories play');
  assert.ok(stories.html.includes('"path":"edge-0"'));
});

test('svg ids follow the idPrefix, so two lifts can share a page', async () => {
  const a = await buildScene(scene(), { dir: FIX, theme: THEME, idPrefix: 'one' });
  const b = await buildScene(scene(), { dir: FIX, theme: THEME, idPrefix: 'two' });
  const ids = (html) => [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]).filter((id) => id !== 'one' && id !== 'two' && !id.endsWith('-data'));
  const shared = ids(a.html).filter((id) => ids(b.html).includes(id));
  assert.deepEqual(shared, []);
});

test('hostile labels stay text: the graph carries them verbatim', async () => {
  const hostile = '<img src=x onerror=window.PWNED=1>';
  const spec = read('architecture.diagram.json');
  spec.nodes[0].label = hostile.slice(0, 40);
  const g = await lift(spec);
  assert.ok(g.items.some((i) => i.label === hostile.slice(0, 40)));
  const built = await buildScene(scene({ lift: { diagram: spec } }), { dir: FIX, theme: THEME });
  assert.ok(!built.html.includes('<img src=x'), 'no raw markup reaches the page');
});

const writeLift = (t, diagram, extra = {}) => {
  const dir = tempDir(t, 'scene-lift-');
  fs.writeFileSync(path.join(dir, 'd.json'), JSON.stringify(diagram));
  fs.writeFileSync(path.join(dir, 'scene.json'), JSON.stringify({ title: 'Lifted', lift: { diagram: 'd.json' }, ...extra }));
  return { dir, file: path.join(dir, 'scene.json') };
};

test('build.mjs writes a lift page: same spec same bytes, no alternatives table, no other worlds offered', async (t) => {
  const { dir, file } = writeLift(t, read('story.diagram.json'));
  const env = { ...PINNED_ENV, PA_OUTPUT_DIR: dir };
  const one = await build(file, { out: path.join(dir, 'one.html'), env });
  const two = await build(file, { out: path.join(dir, 'two.html'), env });
  assert.equal(one.ok, true, JSON.stringify(one.errors));
  assert.equal(one.world, null);
  assert.deepEqual(one.alternatives, []);
  assert.match(one.table, /^spec authoring ≈ \d+ tokens \(estimated\)$/);
  assert.equal(fs.readFileSync(one.out, 'utf8'), fs.readFileSync(two.out, 'utf8'));
  const html = fs.readFileSync(one.out, 'utf8');
  assert.match(html, /<div class="sc-fb-svg"><svg/);
  assert.match(html, /data-scene-fallback/);
});

test('build.mjs reports an invalid lifted diagram as path errors, and --world is refused for a lift', async (t) => {
  const bad = read('architecture.diagram.json');
  bad.nodes[1].kind = 'databse';
  const { dir, file } = writeLift(t, bad);
  const r = await build(file, { out: path.join(dir, 'x.html'), env: PINNED_ENV });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.path === 'lift.diagram.nodes[1].kind'));
  const w = await build(file, { world: 'city', out: path.join(dir, 'x.html'), env: PINNED_ENV });
  assert.ok(w.errors.some((e) => e.path === 'world'));
});

test('validate.mjs (the CLI) reports lift.diagram errors: the check is registered without importing api.mjs', (t) => {
  const bad = read('architecture.diagram.json');
  bad.nodes[1].kind = 'databse';
  const { file } = writeLift(t, bad);
  const run = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/validate.mjs', import.meta.url)), file], { encoding: 'utf8', env: { ...process.env, EVAL_LOG: '' } });
  assert.equal(run.status, 1, run.stdout + run.stderr);
  assert.match(run.stdout, /^lift\.diagram\.nodes\[1\]\.kind: .*did you mean "database"\?/m);
});
