// Task 14: the five sketch blocks (sketch-diagram, sketch-steps, sketch-list, sketch-compare, sketch-callout). Each is a normal
// block that expands to plain text, shape, icon and group parts and draws only in a sketch scene. blocks.test.mjs runs them through
// the generic table (examples, goldens, extremes); this file holds what is specific to drawing by hand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BLOCKS, BLOCK_NAMES, expandBlocks } from '../template/blocks/index.mjs'; // first: it loads defaults.mjs before layout.mjs
import { MIN_TEXT, unit } from '../template/blocks/layout.mjs';
import { expandSpec } from '../template/defaults.mjs';
import { canvasSize, safeMargin, captionZone, FORMATS, FORMAT_NAMES } from '../template/formats.mjs';
import { flattenElements } from '../template/groups.mjs';
import lucide from '../template/sketch/lucide.mjs';
import { planScene } from '../template/sketch/plan.mjs';
import { planContext } from '../template/sketch/plan-context.mjs';
import { validateSpec } from '../scripts/lib/spec.mjs';
import { resolveSpecBeats } from '../scripts/lib/beats-file.mjs';
import { SKETCH_BLOCK_NAMES } from '../scripts/lib/sketch-check.mjs';
import { writeWav } from './helpers/wav.mjs';
import { requireRender, BROWSER_ONLY } from './helpers/render.mjs';
import { SKETCH_NAMES, sketchExtremes, longestParams } from './helpers/sketch-block-params.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = path.join(root, 'scripts/check.mjs');
const CLI = path.join(root, 'scripts/blocks.mjs');
const EXAMPLES = path.join(root, 'references/examples/blocks');
const SCENE_SECONDS = 60; // a scene's longest: the longest params of every block draw in it
const PART_TYPES = ['text', 'shape', 'icon', 'group'];
const TOO_MUCH_FOR_THE_CANVAS = new Set(['sketch-diagram 1:1']); // the longest params at this format: see the safe-area test

const block = (name, params, extra = {}) => ({ id: 'b', type: 'block', x: 960, y: 451, block: name, params, ...extra });
const sketchSpec = (elements, root_ = {}, scene = {}) => ({ ...root_, scenes: [{ id: 's', style: 'sketch', duration: SCENE_SECONDS, elements, ...scene }] });
const errs = (motion, dir = EXAMPLES) => validateSpec(motion, { dir }).errors.map((e) => `${e.path}: ${e.message}`);
const partsOf = (motion) => flattenElements(expandBlocks(motion).scenes[0].elements).map(({ el }) => el).filter((el) => el.type !== 'group');
const childrenOf = (motion) => expandBlocks(motion).scenes[0].elements[0].children;

// The stroke plan of scene `index` of the expanded `motion`, as the page and the validator draw it.
function planOf(motion, index = 0) {
  const expanded = expandSpec(motion);
  const size = canvasSize(expanded);
  const scene = expanded.scenes[index];
  return { expanded, size, scene, plan: planScene(scene, planContext(expanded, scene, index, { size, icons: lucide })) };
}
const exampleOf = (name, root_ = {}) => sketchSpec([block(name, BLOCKS[name].example)], root_);

// ---- registry ---------------------------------------------------------------------------------------------------------------

test('the five sketch blocks are registered, sketchOnly, and the only blocks a sketch scene takes', () => {
  assert.deepEqual([...SKETCH_BLOCK_NAMES].sort(), [...SKETCH_NAMES].sort());
  for (const name of SKETCH_NAMES) {
    assert.ok(BLOCK_NAMES.includes(name), name);
    assert.equal(BLOCKS[name].sketchOnly, true, name);
  }
  assert.equal(BLOCKS['title-card'].sketchOnly, undefined, 'a standard block says nothing');
});

test('nodes come first in the diagram\'s required params, so a scene too short for the drawing is reported at params.nodes', () => {
  assert.deepEqual(BLOCKS['sketch-diagram'].params.required.slice(0, 2), ['nodes', 'edges']);
  const short = sketchSpec([block('sketch-diagram', BLOCKS['sketch-diagram'].example)], {}, { duration: 1 });
  assert.deepEqual(errs(short).map((line) => line.replace(/\d+(\.\d+)?s$/, 'Ns')), ['scenes[0].elements[0].params.nodes: this drawing needs a scene of at least Ns']);
});

// ---- expansion --------------------------------------------------------------------------------------------------------------

test('each block expands only to text, shape, icon and group, with part ids <blockId>/<part>', () => {
  for (const name of SKETCH_NAMES) {
    const expanded = expandBlocks(exampleOf(name)).scenes[0].elements[0];
    assert.equal(expanded.type, 'group', name);
    const all = flattenElements(expanded.children).map(({ el }) => el);
    assert.ok(all.length >= 2, `${name} draws something`);
    for (const el of all) {
      assert.ok(PART_TYPES.includes(el.type), `${name}: ${el.id} is a ${el.type}`);
      assert.ok(el.id.startsWith('b/'), `${name}: ${el.id}`);
    }
    for (const el of all) for (const key of ['keyframes', 'scale', 'rotate', 'typing', 'role', 'exit', 'font', 'fontWeight']) assert.equal(el[key], undefined, `${name}: ${el.id} sets ${key}, which a sketch scene refuses`);
    assert.deepEqual(errs(exampleOf(name)), [], name);
  }
});

test('a block\'s drawAt stays on its group and the plan holds the whole block back', () => {
  const late = sketchSpec([block('sketch-callout', BLOCKS['sketch-callout'].example, { drawAt: 2.5 })]);
  assert.equal(expandBlocks(late).scenes[0].elements[0].drawAt, 2.5);
  assert.deepEqual(errs(late), []);
  const { plan } = planOf(late);
  assert.ok(Math.min(...plan.strokes.map((s) => s.t0)) >= 2.5 - 1e-9, 'nothing draws before 2.5 s');
});

test('every example plans with no problems and fits a 16:9 scene of its own length', () => {
  for (const name of SKETCH_NAMES) {
    const { plan } = planOf(exampleOf(name));
    assert.deepEqual(plan.problems, [], name);
    assert.ok(plan.needs > 1 && plan.needs < 30, `${name} needs ${plan.needs}s`);
  }
});

// ---- sketch-diagram ---------------------------------------------------------------------------------------------------------

const DIAGRAM = BLOCKS['sketch-diagram'].example;
const idOf = (el) => el.id.slice(2);

test('a node with fill draws its scribble before its outline', () => {
  const motion = exampleOf('sketch-diagram');
  const { plan } = planOf(motion);
  const kids = childrenOf(motion);
  const k = kids.findIndex((el) => el.id === 'b/box-2');
  const path_ = `scenes[0].elements[0].children[${k}]`;
  assert.equal(kids[k].fill, 'scribble', 'the node that says fill: true');
  assert.equal(kids.find((el) => el.id === 'b/box-1').fill, undefined, 'a node without it is drawn plain');
  const own = plan.strokes.filter((s) => s.path === path_);
  assert.deepEqual(own.map((s) => s.kind), ['fill', 'line']);
  assert.ok(own[0].t1 <= own[1].t0 + 1e-9, 'the scribble is finished before the outline starts');
});

test('an arrow with a label draws the label after the arrow, and an arrow without one has no label part', () => {
  const motion = exampleOf('sketch-diagram');
  const { plan } = planOf(motion);
  const kids = childrenOf(motion);
  const timeOf = (id) => {
    const k = kids.findIndex((el) => el.id === `b/${id}`);
    assert.ok(k >= 0, id);
    const strokes = plan.strokes.filter((s) => s.path === `scenes[0].elements[0].children[${k}]`);
    return { k, t0: Math.min(...strokes.map((s) => s.t0)), t1: Math.max(...strokes.map((s) => s.t1)) };
  };
  for (const j of [1, 2]) {
    const [arrow, label] = [timeOf(`arrow-${j}`), timeOf(`edge-${j}`)];
    assert.ok(label.k > arrow.k && label.t0 >= arrow.t1 - 1e-9, `edge ${j}: the label comes after the arrow`);
  }
  const bare = { nodes: DIAGRAM.nodes, edges: [{ from: 'web', to: 'api' }] };
  const ids = partsOf(sketchSpec([block('sketch-diagram', bare)])).map((el) => idOf(el));
  assert.ok(ids.includes('arrow-1') && !ids.includes('edge-1'));
});

test('each box is drawn before its icon and label, and an edge after the node it leaves', () => {
  const kids = childrenOf(exampleOf('sketch-diagram')).map(idOf);
  for (const k of [1, 2, 3]) {
    assert.ok(kids.indexOf(`box-${k}`) < kids.indexOf(`icon-${k}`) && kids.indexOf(`icon-${k}`) < kids.indexOf(`label-${k}`), `node ${k}`);
  }
  assert.ok(kids.indexOf('label-1') < kids.indexOf('arrow-1') && kids.indexOf('arrow-1') < kids.indexOf('box-2'), 'the arrow leaves node 1 before node 2 is drawn');
});

test('edges run from box edge to box edge as lines with `to`, bowed, and never through a centre', () => {
  const kids = childrenOf(exampleOf('sketch-diagram'));
  const box = (k) => kids.find((el) => el.id === `b/box-${k}`);
  const arrow = kids.find((el) => el.id === 'b/arrow-1');
  assert.equal(arrow.shape, 'line');
  assert.equal(arrow.arrow, 'end');
  assert.ok(Number.isFinite(arrow.bow) && arrow.bow > 0, 'bowed to the left of the way it runs, as the spike\'s');
  const [a, b] = [box(1), box(2)];
  assert.ok(arrow.x > a.x + a.width / 2 && arrow.x < b.x - b.width / 2, 'starts outside the first box');
  assert.ok(arrow.to.x < b.x - b.width / 2 && arrow.to.x > a.x + a.width / 2, 'ends outside the second box, at its edge');
  assert.ok(Math.abs(arrow.y - a.y) < 1 && Math.abs(arrow.to.y - b.y) < 1, 'level with the box centres in a row');
});

test('an edge across the nodes between arches clear of them', () => {
  const nodes = ['a', 'b', 'c', 'd'].map((id) => ({ id, label: id.toUpperCase(), icon: 'server' }));
  const kids = childrenOf(sketchSpec([block('sketch-diagram', { nodes, edges: [{ from: 'a', to: 'd' }], layout: 'row' })]));
  const arrow = kids.find((el) => el.id === 'b/arrow-1');
  const boxes = kids.filter((el) => /^b\/box-/.test(el.id));
  const [x0, y0, x1, y1] = [arrow.x, arrow.y, arrow.to.x, arrow.to.y];
  const [nx, ny] = [(y1 - y0), -(x1 - x0)].map((c) => c / Math.hypot(x1 - x0, y1 - y0));
  const [cx, cy] = [(x0 + x1) / 2 + nx * arrow.bow * unit([1920, 1080]), (y0 + y1) / 2 + ny * arrow.bow * unit([1920, 1080])];
  for (const t of [0.25, 0.4, 0.5, 0.6, 0.75]) {
    const [px, py] = [(1 - t) ** 2 * x0 + 2 * (1 - t) * t * cx + t * t * x1, (1 - t) ** 2 * y0 + 2 * (1 - t) * t * cy + t * t * y1];
    for (const mid of boxes.slice(1, 3)) assert.ok(Math.abs(px - mid.x) > mid.width / 2 || Math.abs(py - mid.y) > mid.height / 2, `the arrow at ${t} runs through ${mid.id}`);
  }
});

// The pairs of drawn texts whose boxes overlap, as check.mjs judges (OVERLAP_TOLERANCE_PX: a thinner intersection is a shared edge),
// as "<part>~<part>" with the size of the overlap.
const OVERLAP_TOLERANCE_PX = 2;
function textOverlaps(motion) {
  const { plan, expanded } = planOf(motion);
  const kids = expanded.scenes[0].elements[0].children;
  const texts = kids.flatMap((el, k) => (el.type === 'text' ? [{ id: el.id.slice(el.id.indexOf('/') + 1), box: plan.elements.get(`scenes[0].elements[0].children[${k}]`).box }] : []));
  const found = [];
  texts.forEach((a, i) => texts.slice(i + 1).forEach((b) => {
    const [w, h] = [Math.min(a.box.x + a.box.width, b.box.x + b.box.width) - Math.max(a.box.x, b.box.x), Math.min(a.box.y + a.box.height, b.box.y + b.box.height) - Math.max(a.box.y, b.box.y)];
    if (w > OVERLAP_TOLERANCE_PX && h > OVERLAP_TOLERANCE_PX) found.push(`${a.id}~${b.id} ${Math.round(w)}x${Math.round(h)}`);
  }));
  return found;
}

test('no two texts of a diagram overlap: an edge label keeps off the node labels and the other edge labels', () => {
  const nodes = ['n1', 'n2', 'n3', 'n4', 'n5', 'n6'].map((id, i) => ({ id, label: ['Browser', 'Gateway', 'Auth', 'Cache', 'Queue', 'Worker'][i], icon: 'server' }));
  const oneDiagonal = sketchSpec([block('sketch-diagram', { nodes, edges: [{ from: 'n1', to: 'n4', label: 'miss' }], layout: 'grid' })]);
  assert.deepEqual(textOverlaps(oneDiagonal), [], 'a 6-node grid with one diagonal labelled edge');
  const chained = sketchSpec([block('sketch-diagram', { nodes, edges: nodes.slice(1).map((n, i) => ({ from: nodes[i].id, to: n.id, label: 'step' })).concat([{ from: 'n6', to: 'n1', label: 'report back' }, { from: 'n2', to: 'n5', label: 'skip' }]) })]);
  assert.deepEqual(textOverlaps(chained), [], 'a chain with a way back and a skip');
  for (const format of ['16:9', '9:16']) {
    for (const [variant, params] of Object.entries(sketchExtremes('sketch-diagram')).filter(([key]) => key !== 'small')) {
      const size = FORMATS[format].size;
      const { x, y } = BLOCKS['sketch-diagram'].place(size, format);
      assert.deepEqual(textOverlaps(sketchSpec([block('sketch-diagram', params, { x, y })], { format })), [], `longest params (${variant}) at ${format}`);
    }
  }
});

test('the layout: row on a wide canvas, column on a tall one, the one asked for, and a row that does not fit becomes a grid', () => {
  const boxesOf = (motion) => childrenOf(motion).filter((el) => /^b\/box-/.test(el.id));
  const rowOf = (boxes) => new Set(boxes.map((el) => el.y)).size;
  const colOf = (boxes) => new Set(boxes.map((el) => el.x)).size;
  const wide = boxesOf(sketchSpec([block('sketch-diagram', DIAGRAM)]));
  assert.deepEqual([rowOf(wide), colOf(wide)], [1, 3], '16:9: one row');
  const tall = boxesOf(sketchSpec([block('sketch-diagram', DIAGRAM, { x: 540, y: 960 })], { format: '9:16' }));
  assert.deepEqual([rowOf(tall), colOf(tall)], [3, 1], '9:16: one column');
  const asked = boxesOf(sketchSpec([block('sketch-diagram', { ...DIAGRAM, layout: 'column' })]));
  assert.deepEqual([rowOf(asked), colOf(asked)], [3, 1], 'column asked for on 16:9');
  const grid = boxesOf(sketchSpec([block('sketch-diagram', { ...DIAGRAM, layout: 'grid' })]));
  assert.ok(rowOf(grid) >= 2 && colOf(grid) >= 2, 'grid');
  const crowded = boxesOf(sketchSpec([block('sketch-diagram', { ...longestParams('sketch-diagram'), layout: 'row' })]));
  assert.ok(rowOf(crowded) >= 2, 'eight long labels do not fit one row: a grid');
});

test('sketch-diagram on 9:16 lays out as a column, stays in the safe area, and check.mjs reports no problems', async (t) => {
  const diagram = block('sketch-diagram', { ...DIAGRAM, nodes: [...DIAGRAM.nodes, { id: 'cache', label: 'Cache', icon: 'zap' }], edges: [...DIAGRAM.edges, { from: 'api', to: 'cache', label: 'hit' }] }, { x: 540, y: 960 });
  const film = (duration) => ({ format: '9:16', fps: 30, scenes: [{ id: 'flow', style: 'sketch', duration, elements: [diagram] }] });
  const { plan, size } = planOf(film(SCENE_SECONDS));
  const motion = film(Math.ceil(plan.needs) + 1); // long enough to draw it, short enough that the finished board is not a dead stretch
  const boxes = childrenOf(motion).filter((el) => /^b\/box-/.test(el.id));
  assert.equal(new Set(boxes.map((el) => el.x)).size, 1, 'one column');
  assert.deepEqual(boxes.map((el) => el.y), [...boxes.map((el) => el.y)].sort((a, b) => a - b), 'top to bottom in node order');
  assert.deepEqual(plan.problems, []);
  const m = safeMargin(size);
  const group = plan.elements.get('scenes[0].elements[0]').box;
  assert.ok(group.x >= m && group.y >= m && group.x + group.width <= size[0] - m && group.y + group.height <= size[1] - m, `the diagram ${JSON.stringify(group)} leaves the safe area`);
  assert.deepEqual(errs(motion), []);
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'sketch-col-')), 'm.json');
  writeFileSync(file, JSON.stringify(motion));
  const r = spawnSync(process.execPath, [CHECK, file], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^check: ok \(\d+ scenes?, \d+ moments\)\n$/);
});

// ---- validation, end to end -------------------------------------------------------------------------------------------------

const AT = 'scenes[0].elements[0].params';
const web = { id: 'web', label: 'Web' };
const api = { id: 'api', label: 'API' };

test('an edge naming an unknown node is an error listing the node ids, reported by validateSpec at the edge', () => {
  const found = errs(sketchSpec([block('sketch-diagram', { nodes: [web, api], edges: [{ from: 'web', to: 'api' }, { from: 'api', to: 'dbb' }, { from: 'cache', to: 'web' }] })]));
  assert.deepEqual(found, [`${AT}.edges[1].to: unknown node "dbb"; nodes: web, api`, `${AT}.edges[2].from: unknown node "cache"; nodes: web, api`]);
  assert.doesNotThrow(() => expandBlocks(sketchSpec([block('sketch-diagram', { nodes: [web, api], edges: [{ from: 'api', to: 'dbb' }] })])), 'expansion skips the edge and never throws');
});

test('a duplicate node id is an error at the second one; an edge from a node to itself is an error', () => {
  assert.deepEqual(errs(sketchSpec([block('sketch-diagram', { nodes: [web, { id: 'web', label: 'Again' }], edges: [] })])), [`${AT}.nodes[1].id: duplicate node id "web" (first used at nodes[0].id)`]);
  assert.deepEqual(errs(sketchSpec([block('sketch-diagram', { nodes: [web, api], edges: [{ from: 'api', to: 'api' }] })])), [`${AT}.edges[0].to: an edge cannot join node "api" to itself`]);
  const clash = sketchSpec([block('sketch-diagram', { nodes: [web, { id: 'web', label: 'Again' }, api], edges: [{ from: 'web', to: 'api' }] })]);
  assert.doesNotThrow(() => planOf(clash), 'expansion lays out even duplicate ids');
});

test('a duplicate edge is an error at the second one; the way back between two nodes is another edge and stays valid', () => {
  assert.deepEqual(errs(sketchSpec([block('sketch-diagram', { nodes: [web, api], edges: [{ from: 'web', to: 'api' }, { from: 'api', to: 'web' }, { from: 'web', to: 'api', label: 'again' }] })])), [`${AT}.edges[2]: duplicate of edges[0]`]);
  assert.deepEqual(errs(sketchSpec([block('sketch-diagram', { nodes: [web, api], edges: [{ from: 'web', to: 'api', label: 'go' }, { from: 'api', to: 'web', label: 'back' }] })])), []);
});

test('params the schema refuses are reported at params.<field>, for every sketch block', () => {
  assert.deepEqual(errs(sketchSpec([block('sketch-diagram', { nodes: [web], edges: [] })])), [`${AT}.nodes: must NOT have fewer than 2 items`]);
  assert.deepEqual(errs(sketchSpec([block('sketch-diagram', { nodes: [{ id: 'a', label: 'x'.repeat(25) }, web], edges: [] })])), [`${AT}.nodes[0].label: must NOT have more than 24 characters`]);
  assert.deepEqual(errs(sketchSpec([block('sketch-diagram', { nodes: [web, api], edges: [{ from: 'web', to: 'api', label: 'x'.repeat(17) }] })])), [`${AT}.edges[0].label: must NOT have more than 16 characters`]);
  assert.deepEqual(errs(sketchSpec([block('sketch-diagram', { nodes: [web, api], edges: [], layout: 'ring' })])), [`${AT}.layout: must be one of "row", "column", "grid"`]);
  assert.deepEqual(errs(sketchSpec([block('sketch-steps', { steps: ['one'] })])), [`${AT}.steps: must NOT have fewer than 2 items`]);
  assert.deepEqual(errs(sketchSpec([block('sketch-steps', { steps: ['a', 'x'.repeat(33)] })])), [`${AT}.steps[1]: must NOT have more than 32 characters`]);
  assert.deepEqual(errs(sketchSpec([block('sketch-list', { items: [{ text: 'a' }] })])), [`${AT}.items: must NOT have fewer than 2 items`]);
  assert.deepEqual(errs(sketchSpec([block('sketch-list', { title: 'x'.repeat(41), items: [{ text: 'a' }, { text: 'b' }] })])), [`${AT}.title: must NOT have more than 40 characters`]);
  assert.deepEqual(errs(sketchSpec([block('sketch-compare', { left: { title: 'a', points: [] }, right: { title: 'b', points: ['c'] } })])), [`${AT}.left.points: must NOT have fewer than 1 items`]);
  assert.deepEqual(errs(sketchSpec([block('sketch-callout', { text: 'a', mark: 'box' })])), [`${AT}.mark: must be one of "underline", "circle"`]);
  assert.deepEqual(errs(sketchSpec([block('sketch-callout', { text: 'x'.repeat(41) })])), [`${AT}.text: must NOT have more than 40 characters`]);
});

test('a character the handwriting font lacks in any block param is an error at that param', () => {
  const lacks = (what) => `${what} is not in the handwriting font; remove it or use a standard scene`;
  const cases = [
    [block('sketch-diagram', { nodes: [web, { id: 'x', label: 'Ship 🚀' }], edges: [{ from: 'web', to: 'x', label: 'go ✓' }] }), [`${AT}.nodes[1].label: ${lacks('"🚀"')}`, `${AT}.edges[0].label: ${lacks('"✓"')}`]],
    [block('sketch-steps', { steps: ['Plan', 'Ship 🚀'] }), [`${AT}.steps[1]: ${lacks('"🚀"')}`]],
    [block('sketch-list', { title: '日本', items: [{ text: 'ok' }, { text: 'Done ✓' }] }), [`${AT}.title: "日", "本" are not in the handwriting font; remove them or use a standard scene`, `${AT}.items[1].text: ${lacks('"✓"')}`]],
    [block('sketch-compare', { left: { title: 'Old ✗', points: ['fine'] }, right: { title: 'New', points: ['a', 'b 🚀'] } }), [`${AT}.left.title: ${lacks('"✗"')}`, `${AT}.right.points[1]: ${lacks('"🚀"')}`]],
    [block('sketch-callout', { text: 'Ship it 🚀' }), [`${AT}.text: ${lacks('"🚀"')}`]],
  ];
  // The errors come in the order the parts are drawn (an arrow leaves its node before the next node is drawn), so compare as sets.
  for (const [el, want] of cases) assert.deepEqual(errs(sketchSpec([el])).sort(), [...want].sort(), el.block);
  assert.deepEqual(errs(sketchSpec([block('sketch-callout', { text: 'Café résumé — “ok”' })])), [], 'accents, dashes and curly quotes are in the font');
  assert.doesNotThrow(() => planOf(sketchSpec([block('sketch-callout', { text: 'Ship it 🚀' })])), 'expansion measures a missing glyph as a space and never throws');
});

test('an icon name that is not in the set is an error at that param, with a did-you-mean; every block takes icons', () => {
  const sever = `unknown icon "sever"; did you mean "server"? (find names: node scripts/sketch-icons.mjs search <word>)`;
  assert.deepEqual(errs(sketchSpec([block('sketch-diagram', { nodes: [web, { id: 'x', label: 'X', icon: 'sever' }], edges: [] })])), [`${AT}.nodes[1].icon: ${sever}`]);
  assert.deepEqual(errs(sketchSpec([block('sketch-list', { items: [{ text: 'a', icon: 'sever' }, { text: 'b', icon: 'server' }] })])), [`${AT}.items[0].icon: ${sever}`]);
  assert.deepEqual(errs(sketchSpec([block('sketch-callout', { text: 'Hi', icon: 'sever' })])), [`${AT}.icon: ${sever}`]);
  assert.deepEqual(errs(sketchSpec([block('sketch-callout', { text: 'Hi', icon: 'qqqqqqqqqq' })])), [`${AT}.icon: unknown icon "qqqqqqqqqq"; find names: node scripts/sketch-icons.mjs search <word>`]);
});

test('a sketch block in a standard scene is refused with the fix; a standard block in a sketch scene lists the sketch blocks', () => {
  const standard = { scenes: [{ id: 's', duration: 6, elements: [block('sketch-callout', { text: 'Hi' })] }] };
  assert.deepEqual(errs(standard), ['scenes[0].elements[0].block: sketch-callout is a sketch block; it draws only in a sketch scene (set "style": "sketch" on the scene, or at the root)']);
  // A filled node and an icon are scribble and icon parts: in a standard scene they would each be refused again, in words about parts
  // the author never wrote. The block error alone is reported.
  const filled = { scenes: [{ id: 's', duration: 6, elements: [block('sketch-diagram', { nodes: [{ id: 'a', label: 'A', icon: 'server', fill: true }, web], edges: [{ from: 'a', to: 'web', label: 'go' }] })] }] };
  assert.deepEqual(errs(filled), ['scenes[0].elements[0].block: sketch-diagram is a sketch block; it draws only in a sketch scene (set "style": "sketch" on the scene, or at the root)']);
  const root = { style: 'sketch', scenes: [{ id: 's', duration: 6, elements: [block('sketch-callout', { text: 'Hi' })] }] };
  assert.deepEqual(errs(root), [], 'the root style counts');
  const wrong = errs(sketchSpec([block('title-card', { title: 'Hi' })]));
  assert.equal(wrong.length, 1, wrong.join('\n'));
  assert.ok(wrong[0].includes(`blocks a sketch scene takes: ${SKETCH_BLOCK_NAMES.join(', ')};`), wrong[0]);
});

// ---- inside a sketch scene --------------------------------------------------------------------------------------------------

test('a sketch block beside text, a group of sketch elements and another block validates and plans without problems', () => {
  const title = { id: 'title', type: 'text', text: 'How a request flows', x: 960, y: 120, fontSize: 110 };
  const card = { id: 'card', type: 'group', x: 300, y: 800, children: [
    { id: 'frame', type: 'shape', shape: 'rect', x: 0, y: 0, width: 360, height: 200, fill: 'scribble' },
    { id: 'icon', type: 'icon', name: 'lock', size: 80, x: 0, y: -30 },
    { id: 'note', type: 'text', text: 'secure', x: 0, y: 50, fontSize: 60 },
    { id: 'pointer', type: 'shape', shape: 'line', arrow: 'end', x: 200, y: 0, to: { x: 420, y: -60 }, bow: 20 },
  ] };
  const motion = sketchSpec([title, block('sketch-diagram', DIAGRAM, { id: 'flow', y: 500 }), card, block('sketch-callout', { text: 'Only the API talks to the database', icon: 'lightbulb' }, { id: 'tip', y: 950 })]);
  assert.deepEqual(errs(motion), []);
  const { plan } = planOf(motion);
  assert.deepEqual(plan.problems, []);
  assert.deepEqual([...plan.elements.keys()].filter((key) => /^scenes\[0\]\.elements\[\d\]$/.test(key)).length, 4);
  const order = plan.strokes.map((s) => /^scenes\[0\]\.elements\[(\d)\]/.exec(s.path)[1]);
  assert.deepEqual([...new Set(order)], ['0', '1', '2', '3'], 'element after element in document order');
});

test('a sketch block with drawAt "sentence:1" passes validateSpec in a voiced scene and draws in that sentence', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sketch-block-voice-'));
  mkdirSync(path.join(dir, 'voice'));
  writeWav(path.join(dir, 'voice/intro.wav'), { seconds: 0.2 });
  const sidecar = path.join(root, 'test/fixtures/voice/five.json');
  copyFileSync(sidecar, path.join(dir, 'voice/intro.json'));
  const { sentences } = JSON.parse(readFileSync(sidecar, 'utf8'));
  const text = (id, x) => ({ id, type: 'text', text: 'hello', x, y: 200, fontSize: 80 });
  const written = { size: [1920, 1080], fps: 30, style: 'sketch', audio: [{ src: 'voice/intro.wav', scene: 's' }],
    scenes: [{ id: 's', duration: 12, elements: [text('a', 300), block('sketch-callout', { text: 'Draw it by hand', icon: 'pencil' }, { drawAt: 'sentence:1' }), { ...text('c', 1500), drawAt: 'sentence:2' }] }] };
  assert.deepEqual(validateSpec(written, { dir }).errors, [], 'the pin survives validation and the block is one element for the voice windows');
  const { spec } = resolveSpecBeats(written, dir);
  assert.deepEqual(spec.scenes[0].elements[1].drawAt, { sentence: 1 });
  const { plan } = planOf(spec);
  const [start, end] = [sentences[1].start, sentences[1].end];
  const kids = [...plan.elements.keys()].filter((key) => key.startsWith('scenes[0].elements[1].children['));
  assert.ok(kids.length >= 3, 'the block\'s parts');
  for (const key of kids) {
    const { t0, t1 } = plan.elements.get(key);
    assert.ok(t0 >= start - 1e-6 && t1 <= end + 1e-6, `${key} draws ${t0.toFixed(2)}-${t1.toFixed(2)} s, outside sentence 1 (${start}-${end} s)`);
  }
  assert.deepEqual(plan.overruns, []);
});

// ---- text size, the safe area, every format ---------------------------------------------------------------------------------

test('no text below MIN_TEXT at 1920x1080 at the longest allowed values, and every font size is a whole number', () => {
  for (const name of SKETCH_NAMES) {
    for (const [variant, params] of Object.entries(sketchExtremes(name))) {
      const texts = partsOf(sketchSpec([block(name, params)])).filter((el) => el.type === 'text');
      assert.ok(texts.length > 0, `${name} ${variant}`);
      for (const el of texts) {
        assert.ok(el.fontSize >= MIN_TEXT, `${name} ${variant}: ${el.id} is ${el.fontSize} px`);
        assert.ok(Number.isInteger(el.fontSize) && el.maxWidth >= 1, `${name} ${variant}: ${el.id}`);
      }
    }
  }
});

test('no text below 40 px at 1080 on the short side at 9:16 and 1:1 either, and the plan finds no problem in any of them', () => {
  for (const name of SKETCH_NAMES) {
    for (const format of ['9:16', '1:1']) {
      const floor = Math.round((MIN_TEXT * Math.min(...FORMATS[format].size)) / 1080);
      const motion = sketchSpec([block(name, longestParams(name), { x: FORMATS[format].size[0] / 2, y: FORMATS[format].size[1] / 2 })], { format });
      for (const el of partsOf(motion).filter((part) => part.type === 'text')) assert.ok(el.fontSize >= floor, `${name} ${format}: ${el.id} is ${el.fontSize} px`);
      assert.deepEqual(planOf(motion).plan.problems, [], `${name} ${format}`);
    }
  }
});

test('at its place() every block, at the longest and smallest params, plans with no problems and stays inside the safe area, above the caption zone with captions, at every format', () => {
  for (const name of SKETCH_NAMES) {
    for (const [variant, params] of Object.entries(sketchExtremes(name))) {
      for (const format of FORMAT_NAMES) {
        for (const captions of [false, true]) {
          const size = FORMATS[format].size;
          const { x, y } = BLOCKS[name].place(size, format);
          const motion = sketchSpec([block(name, params, { x, y })], { format, ...(captions ? { captions: [{ src: 'c.srt' }] } : {}) });
          const where = `${name} ${variant} ${format}${captions ? ' with captions' : ''}`;
          const { plan } = planOf(motion);
          assert.deepEqual(plan.problems, [], where);
          const m = safeMargin(size);
          const floor = captions ? captionZone(size, format).top : size[1] - m;
          const box = plan.elements.get('scenes[0].elements[0]').box;
          if (TOO_MUCH_FOR_THE_CANVAS.has(`${name} ${format}`) && variant !== 'small' && variant !== 'example') {
            // Eight 24-character labels, eleven 16-character edge labels and a text floor of 40 px do not fit a square 1080 canvas
            // inside the safe area across: the drawing stays on the canvas, still keeps to the room down (below the safe top, above
            // the caption floor), and check.mjs names the text that leaves the safe area (the next test, as for blocks.test.mjs's
            // 1:1 checklist of long items).
            assert.ok(box.x >= 0 && box.x + box.width <= size[0], `${where}: ${JSON.stringify(box)} leaves the canvas`);
            assert.ok(box.y >= m - 0.5 && box.y + box.height <= floor + 0.5, `${where}: ${JSON.stringify(box)} leaves the room down (${m}..${floor})`);
            continue;
          }
          assert.ok(box.x >= m - 0.5 && box.x + box.width <= size[0] - m + 0.5, `${where}: ${JSON.stringify(box)} leaves the safe area across`);
          assert.ok(box.y >= m - 0.5 && box.y + box.height <= floor + 0.5, `${where}: ${JSON.stringify(box)} leaves the room down (${m}..${floor})`);
        }
      }
    }
  }
});

test('what a block cannot fit is named by check.mjs: the longest diagram on 1:1 leaves the safe area, and check says which param to shorten', async (t) => {
  assert.ok(TOO_MUCH_FOR_THE_CANVAS.has('sketch-diagram 1:1'));
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const [x, y] = [540, 451];
  const film = (duration) => ({ format: '1:1', fps: 30, scenes: [{ id: 's', style: 'sketch', duration, elements: [block('sketch-diagram', longestParams('sketch-diagram'), { x, y })] }] });
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'sketch-1x1-')), 'm.json');
  writeFileSync(file, JSON.stringify(film(Math.ceil(planOf(film(SCENE_SECONDS)).plan.needs) + 1)));
  const r = spawnSync(process.execPath, [CHECK, file], { encoding: 'utf8' });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /leaves the safe area \((left|right|top|bottom)[^)]*\) at [\d.]+s \(block "sketch-diagram", part "(label|edge)-\d+"\); (shorten|move) /, r.stdout);
  assert.match(r.stdout, /params\.(nodes|edges)\[\d+\]/, 'it names the param to change');
});

test('the longest params of every block need a scene no longer than the longest scene allows', () => {
  for (const name of SKETCH_NAMES) {
    for (const [variant, params] of Object.entries(sketchExtremes(name))) {
      const { plan } = planOf(sketchSpec([block(name, params)]));
      assert.ok(plan.needs <= SCENE_SECONDS, `${name} ${variant} needs ${plan.needs}s`);
    }
  }
});

// ---- the callout, the compare and the list ----------------------------------------------------------------------------------

test('the callout\'s underline is the spike\'s: a 9 px accent stroke with a bow, drawn after the phrase; a circle is an accent oval round it', () => {
  const kids = childrenOf(sketchSpec([block('sketch-callout', { text: 'Only the API talks to the database', icon: 'lightbulb' })]));
  const underline = kids.find((el) => el.id === 'b/mark');
  assert.equal(underline.shape, 'line');
  assert.equal(underline.stroke, 'accent');
  assert.equal(underline.strokeWidth, 9);
  const icon = kids.find((el) => el.id === 'b/icon');
  assert.ok(underline.x > icon.x + icon.size / 2, 'the underline starts clear of the icon: it runs under the phrase only');
  assert.ok(underline.bow < 0, 'it sags a little, as the spike\'s');
  assert.ok(kids.indexOf(underline) === kids.length - 1, 'the mark comes last');
  const text = kids.find((el) => el.id === 'b/text');
  assert.ok(underline.y > text.y && underline.x < text.x && underline.to.x > text.x, 'under the phrase');
  const circled = childrenOf(sketchSpec([block('sketch-callout', { text: 'Only the API talks to the database', mark: 'circle' })]));
  const oval = circled.find((el) => el.id === 'b/mark');
  assert.deepEqual([oval.shape, oval.stroke], ['ellipse', 'accent']);
  const phrase = circled.find((el) => el.id === 'b/text');
  assert.ok(oval.width > phrase.maxWidth * 0.5 && oval.height > phrase.fontSize, 'round the phrase');
});

test('no label is accent-coloured, and a label inside a scribble fill is ink on the hatch (12.82:1; accent on it is 2.92:1), at the example, longest and smallest params', () => {
  for (const name of SKETCH_NAMES) {
    for (const [variant, params] of Object.entries(sketchExtremes(name))) {
      const parts = partsOf(sketchSpec([block(name, params)]));
      const hatched = parts.filter((el) => el.type === 'shape' && el.fill === 'scribble');
      if (variant === 'example' && name === 'sketch-diagram') assert.ok(hatched.length > 0, 'the example has a filled node');
      for (const el of parts.filter((part) => part.type === 'text')) {
        assert.notEqual(el.color, 'accent', `${name} ${variant}: ${el.id} is an accent label`);
        const inside = hatched.filter((box) => Math.abs(el.x - box.x) <= box.width / 2 && Math.abs(el.y - box.y) <= box.height / 2);
        for (const box of inside) assert.ok(el.color === undefined || el.color === 'text', `${name} ${variant}: ${el.id} sits in the hatch of ${box.id} in ${el.color}`);
      }
    }
  }
  const [labelsInHatch] = [partsOf(exampleOf('sketch-diagram')).filter((el) => el.type === 'text' && /label-2/.test(el.id))];
  assert.equal(labelsInHatch.length, 1, 'the filled node of the example has its label: the check above looked at it');
});

test('sketch-compare: two titled columns side by side on a wide canvas, stacked on a tall one, each point after its title', () => {
  const params = BLOCKS['sketch-compare'].example;
  const place = (motion) => { const kids = childrenOf(motion).filter((el) => el.type === 'text'); return (id) => kids.find((el) => el.id === `b/${id}`); };
  const wide = place(sketchSpec([block('sketch-compare', params)]));
  assert.ok(wide('left-title').x < wide('right-title').x && wide('left-title').y === wide('right-title').y, 'side by side');
  const tall = place(sketchSpec([block('sketch-compare', params, { x: 540, y: 960 })], { format: '9:16' }));
  assert.ok(tall('left-title').y < tall('right-title').y && Math.abs(tall('left-title').x - tall('right-title').x) < 1, 'stacked');
  const ids = childrenOf(sketchSpec([block('sketch-compare', params)])).map(idOf);
  assert.ok(ids.indexOf('left-title') < ids.indexOf('left-1') && ids.indexOf('left-1') < ids.indexOf('right-title'), 'the left column, then the right');
});

test('sketch-steps: every arrow is at least 1.5 arrow heads long, at every format and step count, in a row and in a column', () => {
  const ARROW_HEAD = 30; // px at 1080: the plan's arrow head
  for (const format of FORMAT_NAMES) {
    for (const count of [2, 4, 6]) {
      const size = FORMATS[format].size;
      const { x, y } = BLOCKS['sketch-steps'].place(size, format);
      const steps = Array.from({ length: count }, (_, i) => ['Write the spec', 'Validate', 'Preview the film', 'Render', 'Check it', 'Share it'][i]);
      const kids = childrenOf(sketchSpec([block('sketch-steps', { steps }, { x, y })], { format }));
      const arrows = kids.filter((el) => /^b\/arrow-/.test(el.id));
      assert.equal(arrows.length, count - 1);
      for (const arrow of arrows) {
        const length = Math.hypot(arrow.to.x - arrow.x, arrow.to.y - arrow.y);
        assert.ok(length >= 1.5 * ARROW_HEAD * unit(size) - 1, `${format}, ${count} steps: ${arrow.id} is ${length.toFixed(1)} px, its head ${ARROW_HEAD * unit(size)}`);
      }
      assert.deepEqual(planOf(sketchSpec([block('sketch-steps', { steps }, { x, y })], { format })).plan.problems, []);
    }
  }
});

test('sketch-steps: each step is drawn box, circle, number, label, then the arrow to the next', () => {
  const ids = childrenOf(sketchSpec([block('sketch-steps', { steps: ['One', 'Two', 'Three'] })])).map(idOf);
  assert.deepEqual(ids, ['box-1', 'circle-1', 'num-1', 'label-1', 'arrow-1', 'box-2', 'circle-2', 'num-2', 'label-2', 'arrow-2', 'box-3', 'circle-3', 'num-3', 'label-3']);
  const { plan } = planOf(sketchSpec([block('sketch-steps', { steps: ['One', 'Two', 'Three'] })]));
  const t0 = (k) => Math.min(...plan.strokes.filter((s) => s.path === `scenes[0].elements[0].children[${k}]`).map((s) => s.t0));
  ids.slice(1).forEach((_, k) => assert.ok(t0(k + 1) >= t0(k) - 1e-9, `${ids[k + 1]} is drawn after ${ids[k]}`));
});

test('sketch-list: the title first, then each row\'s icon before its text', () => {
  const ids = childrenOf(sketchSpec([block('sketch-list', BLOCKS['sketch-list'].example)])).map(idOf);
  assert.equal(ids[0], 'title');
  const items = BLOCKS['sketch-list'].example.items;
  items.forEach((_, i) => assert.ok(ids.indexOf(`icon-${i + 1}`) < ids.indexOf(`item-${i + 1}`), `row ${i + 1}`));
  const bare = childrenOf(sketchSpec([block('sketch-list', { items: [{ text: 'one' }, { text: 'two' }] })])).map(idOf);
  assert.ok(!bare.includes('title'), 'no title, no title part');
  assert.ok(bare.includes('bullet-1') && !bare.includes('icon-1'), 'a row without an icon gets a bullet');
});

// ---- how the blocks are loaded and shown ------------------------------------------------------------------------------------

test('the sketch blocks load only layout.mjs, style.mjs, the font metrics and each other: no plan, geometry, timing or icon module reaches a standard page', () => {
  const allowed = /^(\.\/(layout|sketch-layout)\.mjs|\.\.\/sketch\/(style|caveat-metrics)\.mjs)$/;
  for (const file of ['sketch-layout', ...SKETCH_NAMES]) {
    const source = readFileSync(path.join(root, 'template/blocks', `${file}.mjs`), 'utf8');
    for (const [, spec] of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) assert.match(spec, allowed, `${file}: imports ${spec}`);
  }
});

test('blocks.mjs lists and shows every sketch block', () => {
  const list = spawnSync(process.execPath, [CLI, 'list'], { encoding: 'utf8' });
  for (const name of SKETCH_NAMES) assert.ok(list.stdout.includes(`${name}  params: `), name);
  for (const name of SKETCH_NAMES) {
    const show = spawnSync(process.execPath, [CLI, 'show', name], { encoding: 'utf8' });
    assert.equal(show.status, 0, show.stderr);
    assert.match(show.stdout, new RegExp(`^${name}: `));
    assert.match(show.stdout, /hand-drawn scene/, 'the summary says where it draws');
    const json = JSON.parse(show.stdout.slice(show.stdout.indexOf('\n{\n') + 1)); // the params table has braces of its own
    assert.deepEqual(json.params, BLOCKS[name].example);
  }
});

test('every param of every sketch block is described, and every example validates in a sketch scene', () => {
  for (const name of SKETCH_NAMES) {
    for (const key of Object.keys(BLOCKS[name].params.properties)) assert.equal(typeof BLOCKS[name].describe[key], 'string', `${name}.${key}`);
    assert.deepEqual(errs(exampleOf(name)), [], name);
  }
  assert.ok(MIN_TEXT === 40 && unit([1920, 1080]) === 1);
});
