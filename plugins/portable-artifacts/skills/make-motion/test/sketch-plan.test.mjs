import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import lucide from '../template/sketch/lucide.mjs';
import metrics from '../template/sketch/caveat-metrics.mjs';
import { PALETTE } from '../template/sketch/style.mjs';
import { planScene } from '../template/sketch/plan.mjs';
import * as planApi from '../template/sketch/plan.mjs';
import { pointAt, unit, wobble, bowedLine, makeRng, hashSeed } from '../template/sketch/geometry.mjs';
import { HAND_EXIT, HAND_LEAD, travelSeconds } from '../template/sketch/timing.mjs';
import { expandSpec, COLOR_TOKENS, DEFAULT_SHAPE_SIZE } from '../template/defaults.mjs'; // before layout.mjs: the two import each other, and defaults.mjs must load first
import { unit as layoutUnit } from '../template/blocks/layout.mjs';
import { validateSpec } from '../scripts/lib/spec.mjs';
import { checkSketchDuration } from '../scripts/lib/sketch-check.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SIZE = [1920, 1080];
const ctx = (extra = {}) => ({ size: SIZE, seed: 1, pace: 1, icons: lucide, startAfter: 0, ...extra });
const text = (id, extra = {}) => ({ id, type: 'text', text: 'hello world', x: 960, y: 540, fontSize: 80, ...extra });
const rect = (id, extra = {}) => ({ id, type: 'shape', shape: 'rect', x: 960, y: 540, width: 400, height: 240, ...extra });
const scene = (elements, extra = {}) => ({ id: 's', duration: 30, style: 'sketch', elements, ...extra });
const plan = (elements, extra, sceneExtra) => planScene(scene(elements, sceneExtra), ctx(extra));
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const strokesOf = (p, at) => p.strokes.filter((s) => s.path === at);
const advance = (ch, fs) => (metrics.advance[ch] / metrics.unitsPerEm) * fs;
const LINE_EM = (metrics.ascent - metrics.descent) / metrics.unitsPerEm; // descent is negative, as in the font's hhea table

const BOARD = [
  text('title', { y: 170, fontSize: 110, text: 'How a request flows' }),
  rect('box', { x: 380, y: 560, width: 370, height: 300 }),
  { id: 'ic', type: 'icon', name: 'monitor', size: 112, x: 380, y: 510 },
  { id: 'arr', type: 'shape', shape: 'line', arrow: 'end', x: 668, y: 560, width: 155 },
];

test('the same scene and seed give the same plan, deepEqual; another seed gives another wobble', () => {
  const a = plan(BOARD);
  const b = plan(structuredClone(BOARD));
  assert.deepEqual(a, b);
  assert.deepEqual(JSON.parse(JSON.stringify(a.strokes)), a.strokes, 'plain numbers and strings: no NaN, no undefined');
  const other = plan(BOARD, { seed: 2 });
  assert.notDeepEqual(other.strokes[1].points, a.strokes[1].points);
});

test('inserting an element does not change another element\'s wobble', () => {
  const before = plan(BOARD);
  const after = plan([text('newcomer', { y: 40 }), ...BOARD]);
  BOARD.forEach((el, i) => {
    const was = strokesOf(before, `elements[${i}]`);
    const now = strokesOf(after, `elements[${i + 1}]`);
    assert.ok(was.length > 0, el.id);
    assert.deepEqual(now.map((s) => s.points), was.map((s) => s.points), el.id);
  });
});

test('elements draw in document order, with no overlap between strokes', () => {
  const p = plan(BOARD);
  p.strokes.forEach((s, i) => {
    assert.ok(s.t1 > s.t0, `stroke ${i} lasts`);
    if (i > 0) assert.ok(s.t0 >= p.strokes[i - 1].t1, `stroke ${i} starts after stroke ${i - 1} ends`);
  });
  const order = p.strokes.map((s) => Number(/elements\[(\d+)\]/.exec(s.path)[1]));
  assert.deepEqual(order, [...order].sort((x, y) => x - y));
  assert.deepEqual([...new Set(order)], [0, 1, 2, 3]);
});

test('pace 2 halves stroke durations; pace 0.5 doubles them', () => {
  const one = plan(BOARD);
  for (const [pace, factor] of [[2, 0.5], [0.5, 2]]) {
    const other = plan(BOARD, { pace });
    assert.equal(other.strokes.length, one.strokes.length);
    one.strokes.forEach((s, i) => near((other.strokes[i].t1 - other.strokes[i].t0) / (s.t1 - s.t0), factor));
  }
});

test('stroke speeds are the spike\'s: lines 2700 px/s, icons 2000, fills 9000, writing 22 characters/s', () => {
  const lineStroke = plan([{ id: 'l', type: 'shape', shape: 'line', x: 960, y: 540, width: 1200 }]).strokes[0];
  near(lineStroke.t1 - lineStroke.t0, lineStroke.total / 2700);
  const icon = plan([{ id: 'i', type: 'icon', name: 'server', size: 400, x: 960, y: 540 }]).strokes[0];
  near(icon.t1 - icon.t0, Math.max(0.06, icon.total / 2000));
  const filled = plan([rect('r', { fill: 'scribble' })]).strokes;
  const hatch = filled.find((s) => s.kind === 'fill');
  near(hatch.t1 - hatch.t0, Math.max(0.08, hatch.total / 9000));
  const written = plan([text('w', { text: 'eleven char' })]).strokes[0];
  near(written.t1 - written.t0, 11 / 22);
});

test('the hand: it enters from the lower right, travel is min(0.3, 0.04 + dist/3600), and a stroke starts after it', () => {
  near(travelSeconds([0, 0], [0, 0], 1), 0);
  near(travelSeconds([0, 0], [3, 0], 1), 0, 1e-12);
  near(travelSeconds([0, 0], [360, 0], 1), 0.14);
  near(travelSeconds([0, 0], [3600, 0], 1), 0.3);
  near(travelSeconds([0, 0], [360, 0], 0.5), 0.24, 1e-9); // distances shrink with the canvas, so travel stretches
  const p = plan([rect('r')]);
  assert.ok(p.strokes[0].t0 > HAND_LEAD, 'lead, then the hand comes in from off canvas');
  near(p.strokes[0].t0, HAND_LEAD + 0.3);
  const later = plan([rect('r')], { startAfter: 1.5 });
  near(later.strokes[0].t0 - p.strokes[0].t0, 1.5);
});

test('needs equals drawEnd + HAND_EXIT; an empty scene needs nothing', () => {
  const p = plan(BOARD);
  assert.equal(HAND_EXIT, 0.65);
  assert.equal(p.drawEnd, p.strokes.at(-1).t1);
  near(p.needs, p.drawEnd + HAND_EXIT);
  assert.deepEqual([plan([]).drawEnd, plan([]).needs], [0, 0]);
});

test('glyph x positions come from the metrics table: "AV" is the advance sum, with no kerning', () => {
  const p = plan([text('t', { text: 'AV', fontSize: 100, anchor: 'left', x: 200 })]);
  const { glyphs, fontSize } = p.elements.get('elements[0]');
  assert.equal(fontSize, 100);
  assert.deepEqual(glyphs.map((g) => g.char), ['A', 'V']);
  near(glyphs[0].x, 200);
  near(glyphs[1].x - glyphs[0].x, advance('A', 100));
  const box = p.elements.get('elements[0]').box;
  near(box.width, advance('A', 100) + advance('V', 100));
  assert.equal(glyphs[0].y, glyphs[1].y);
  const spaced = plan([text('t', { text: 'A V', fontSize: 100, anchor: 'left', x: 200 })]).elements.get('elements[0]');
  assert.deepEqual(spaced.glyphs.map((g) => g.char), ['A', 'V'], 'a space moves the pen but is not a glyph to draw');
  near(spaced.glyphs[1].x - 200, advance('A', 100) + advance(' ', 100));
});

test('text is centred on x, y by default; anchor left and right put the edge on x', () => {
  const centre = plan([text('t', { text: 'AV', fontSize: 100 })]).elements.get('elements[0]').box;
  near(centre.x + centre.width / 2, 960);
  near(centre.y + centre.height / 2, 540);
  const left = plan([text('t', { text: 'AV', fontSize: 100, anchor: 'left' })]).elements.get('elements[0]').box;
  near(left.x, 960);
  const right = plan([text('t', { text: 'AV', fontSize: 100, anchor: 'right' })]).elements.get('elements[0]').box;
  near(right.x + right.width, 960);
});

test('text wraps at maxWidth and stays inside its box', () => {
  const sentence = 'The quick brown fox jumps over the lazy dog and keeps running';
  const p = plan([text('t', { text: sentence, fontSize: 80, maxWidth: 500 })]);
  const el = p.elements.get('elements[0]');
  assert.ok(el.box.width <= 500 + 1e-9, `box ${el.box.width}`);
  const rows = [...new Set(el.glyphs.map((g) => g.y))];
  assert.ok(rows.length >= 3, `wrapped onto ${rows.length} lines`);
  assert.equal(p.strokes.length, rows.length, 'one writing stroke per line');
  near(el.box.height, rows.length * 80 * LINE_EM);
  for (const g of el.glyphs) {
    assert.ok(g.x >= el.box.x - 1e-9 && g.x + advance(g.char, 80) <= el.box.x + el.box.width + 1e-9, `${g.char} inside the box`);
  }
  assert.deepEqual(p.problems, []);
  for (const s of p.strokes) for (const [x, y] of s.points) assert.ok(x >= el.box.x - 1 && x <= el.box.x + el.box.width + 1 && y >= el.box.y && y <= el.box.y + el.box.height, 'the pen stays in the box');
});

test('the default maxWidth is 80% of the canvas width, from the metrics; a newline starts a line', () => {
  const long = 'word '.repeat(60).trim();
  const el = plan([text('t', { text: long, fontSize: 80 })]).elements.get('elements[0]');
  assert.ok(el.box.width <= 0.8 * 1920 + 1e-9 && el.box.width > 0.6 * 1920, `box ${el.box.width}`);
  const two = plan([text('t', { text: 'one\ntwo', fontSize: 80 })]).elements.get('elements[0]');
  assert.equal(new Set(two.glyphs.map((g) => g.y)).size, 2);
});

test('a word wider than maxWidth is a problem that names the element; so is a character the font lacks', () => {
  const wide = plan([text('t', { text: 'extraordinary', fontSize: 80, maxWidth: 100 })]);
  assert.equal(wide.problems.length, 1);
  assert.equal(wide.problems[0].path, 'elements[0]');
  assert.match(wide.problems[0].message, /wider than maxWidth 100/);
  const missing = plan([text('t', { text: 'go 🚀' })]);
  assert.equal(missing.problems.length, 1);
  assert.match(missing.problems[0].message, /🚀/);
});

test('"Café" with a combining accent lays out like "Café"', () => {
  const composed = 'Café';
  const decomposed = 'Café';
  assert.notEqual(composed, decomposed);
  const a = plan([text('t', { text: composed })]);
  const b = plan([text('t', { text: decomposed })]);
  assert.deepEqual(b, a);
  assert.equal(a.elements.get('elements[0]').glyphs.length, 4);
  assert.deepEqual(a.problems, []);
});

test('a group\'s children are planned in canvas coordinates, nested groups summed', () => {
  const inner = { id: 'inner', type: 'group', x: 50, y: 20, children: [rect('r', { x: 10, y: 5, width: 100, height: 60 })] };
  const outer = { id: 'outer', type: 'group', x: 500, y: 300, children: [inner] };
  const p = plan([outer]);
  const box = p.elements.get('elements[0].children[0].children[0]').box;
  assert.deepEqual(box, { x: 560 - 50, y: 325 - 30, width: 100, height: 60 });
  const all = p.elements.get('elements[0]').box;
  assert.deepEqual(all, box, 'a group\'s box is its children\'s union');
  const xs = p.strokes.map((s) => s.points.map((pt) => pt[0])).flat();
  assert.ok(Math.min(...xs) > 490 && Math.max(...xs) < 640, 'the outline is drawn near x 560, not near 10');
  assert.ok(p.strokes.every((s) => s.path === 'elements[0].children[0].children[0]'));
});

test('static opacity carries to strokes, groups multiply it', () => {
  const g = { id: 'g', type: 'group', x: 0, y: 0, opacity: 0.5, children: [rect('r', { opacity: 0.4 }), text('t', { opacity: 1 })] };
  const p = plan([g]);
  assert.deepEqual([...new Set(p.strokes.map((s) => s.opacity))].sort(), [0.2, 0.5]);
  assert.equal(plan([rect('r')]).strokes[0].opacity, 1);
});

test('drawAt delays an element; earlier ones are unaffected, later ones follow it', () => {
  const base = plan([rect('a'), rect('b', { x: 400 }), rect('c', { x: 1500 })]);
  const delayed = plan([rect('a'), rect('b', { x: 400, drawAt: 12 }), rect('c', { x: 1500 })]);
  assert.deepEqual(strokesOf(delayed, 'elements[0]'), strokesOf(base, 'elements[0]'));
  const b = strokesOf(delayed, 'elements[1]');
  near(b[0].t0, 12);
  assert.ok(strokesOf(delayed, 'elements[2]')[0].t0 >= b.at(-1).t1);
  assert.deepEqual(b.map((s) => s.points), strokesOf(base, 'elements[1]').map((s) => s.points), 'only the times move');
  const early = plan([rect('a'), rect('b', { x: 400, drawAt: 0.1 })]);
  assert.deepEqual(early.strokes, plan([rect('a'), rect('b', { x: 400 })]).strokes, 'a drawAt already passed changes nothing');
  const group = plan([{ id: 'g', type: 'group', x: 0, y: 0, drawAt: 9, children: [rect('a')] }]);
  assert.ok(group.strokes[0].t0 >= 9, 'a group\'s drawAt delays its first child');
  const words = plan([rect('a', { drawAt: 'sentence:1' })]);
  assert.ok(words.strokes[0].t0 < 2, 'a sentence window is not planned yet: it draws at natural pace');
});

test('pointAt at 0 and 1 returns the first and last points; between, it follows the arc length', () => {
  const s = plan([{ id: 'l', type: 'shape', shape: 'line', x: 960, y: 540, width: 1000 }]).strokes[0];
  assert.deepEqual(pointAt(s, 0), s.points[0]);
  assert.deepEqual(pointAt(s, 1), s.points.at(-1));
  assert.deepEqual(pointAt(s, -3), s.points[0]);
  assert.deepEqual(pointAt(s, 7), s.points.at(-1));
  assert.equal(s.lengths.length, s.points.length);
  assert.equal(s.lengths[0], 0);
  near(s.lengths.at(-1), s.total);
  const mid = pointAt(s, 0.5);
  const k = s.lengths.findIndex((l) => l >= s.total / 2);
  assert.ok(mid[0] >= s.points[k - 1][0] - 1e-9 && mid[0] <= s.points[k][0] + 1e-9);
  const fresh = pointAt(s, 0);
  fresh[0] = -999;
  assert.notEqual(s.points[0][0], -999, 'a result is a copy');
});

test('a 1080x1920 canvas scales speeds and widths by the short side', () => {
  const small = planScene(scene([rect('r', { x: 270, y: 480, width: 200, height: 120 })]), ctx({ size: [540, 960] }));
  const big = planScene(scene([rect('r', { x: 540, y: 960, width: 400, height: 240 })]), ctx({ size: [1080, 1920] }));
  const land = planScene(scene([rect('r', { x: 960, y: 540, width: 400, height: 240 })]), ctx({ size: [1920, 1080] }));
  near(big.strokes[0].width, 5.5);
  near(small.strokes[0].width, 2.75);
  near(land.strokes[0].width, 5.5);
  const dur = (p) => p.strokes[0].t1 - p.strokes[0].t0;
  near(dur(big), dur(small), 1e-6);
  near(big.strokes[0].total / small.strokes[0].total, 2, 0.02);
  const w = (size) => planScene(scene([text('t', { fontSize: 100 * size[0] / 1080 })]), ctx({ size })).strokes[0].width;
  near(w([1080, 1920]) / w([540, 960]), 2, 1e-9);
});

test('shape strokes: a box is ink at the spike\'s width, a scribble fill goes under it, a colour fill draws nothing', () => {
  const p = plan([rect('r', { fill: 'scribble' })]);
  assert.deepEqual(p.strokes.map((s) => [s.kind, s.layer]), [['fill', 'under'], ['line', 'ink']]);
  const [fill, outline] = p.strokes;
  assert.equal(fill.color, PALETTE.accent);
  assert.equal(fill.width, 20);
  assert.equal(fill.opacity, 0.17);
  assert.equal(outline.color, PALETTE.ink);
  assert.equal(outline.width, 5.5);
  assert.ok(fill.t1 <= outline.t0, 'the hatch is drawn before its outline');
  const plain = plan([rect('r', { fill: '#ff0000' })]);
  assert.deepEqual(plain.strokes.map((s) => s.kind), ['line']);
  const dim = plan([rect('r', { fill: 'scribble', opacity: 0.5 })]);
  near(dim.strokes[0].opacity, 0.085);
  const closes = outline.points;
  assert.ok(Math.hypot(closes.at(-1)[0] - closes[0][0], closes.at(-1)[1] - closes[0][1]) > 8, 'the outline overshoots its start instead of closing exactly');
});

test('an ellipse is outlined and hatched inside itself; a stroke colour and width are the element\'s', () => {
  const el = { id: 'e', type: 'shape', shape: 'ellipse', x: 600, y: 400, width: 300, height: 200, fill: 'scribble', stroke: 'accent', strokeWidth: 9 };
  const p = plan([el]);
  const [fill, outline] = p.strokes;
  assert.equal(outline.color, PALETTE.accent);
  assert.equal(outline.width, 9);
  for (const [x, y] of fill.points) assert.ok(((x - 600) / 150) ** 2 + ((y - 400) / 100) ** 2 <= 1.05, 'hatch stays inside the ellipse');
  const xs = outline.points.map((pt) => pt[0]);
  assert.ok(Math.min(...xs) > 440 && Math.max(...xs) < 760);
});

test('a line with arrow "end" adds two head strokes at its end; cap changes nothing', () => {
  const arrow = { id: 'a', type: 'shape', shape: 'line', arrow: 'end', x: 668, y: 560, width: 155 };
  const p = plan([arrow]);
  assert.equal(p.strokes.length, 3);
  const [line, ...heads] = p.strokes;
  const tip = line.points.at(-1);
  for (const h of heads) assert.ok(Math.hypot(h.points.at(-1)[0] - tip[0], h.points.at(-1)[1] - tip[1]) < 1, 'a barb ends on the tip, give or take its own wobble');
  assert.ok(heads.every((h) => h.total > 20 && h.total < 40 && h.width === 5.5));
  assert.ok(tip[0] > 668 + 60 && tip[0] < 668 + 90, 'the tip is at the line\'s right end');
  assert.deepEqual(plan([{ ...arrow, cap: 'round' }]), p);
  assert.equal(plan([{ ...arrow, arrow: undefined }]).strokes.length, 1);
});

test('an icon draws one stroke per Lucide polyline, scaled to its size; an unknown icon is a problem', () => {
  const p = plan([{ id: 'i', type: 'icon', name: 'monitor', size: 112, x: 380, y: 510, color: 'accent' }]);
  assert.equal(p.strokes.length, lucide.monitor.length);
  for (const s of p.strokes) {
    assert.equal(s.width, 4.5);
    assert.equal(s.color, PALETTE.accent);
    for (const [x, y] of s.points) assert.ok(x > 380 - 56 - 8 && x < 380 + 56 + 8 && y > 510 - 56 - 8 && y < 510 + 56 + 8);
  }
  assert.deepEqual(p.elements.get('elements[0]').box, { x: 324, y: 454, width: 112, height: 112 });
  const bad = plan([{ id: 'i', type: 'icon', name: 'no-such-icon', size: 112, x: 380, y: 510 }]);
  assert.equal(bad.strokes.length, 0);
  assert.equal(bad.problems.length, 1);
  assert.match(bad.problems[0].message, /no-such-icon/);
  assert.match(plan([{ id: 'i', type: 'icon', name: 'monitor', size: 10, x: 0, y: 0 }], { icons: undefined }).problems[0].message, /monitor/);
});

test('element plans carry their time window and paths use the scene index', () => {
  const p = plan(BOARD, { sceneIndex: 3 });
  assert.deepEqual([...p.elements.keys()], ['scenes[3].elements[0]', 'scenes[3].elements[1]', 'scenes[3].elements[2]', 'scenes[3].elements[3]']);
  const first = p.elements.get('scenes[3].elements[0]');
  near(first.t0, p.strokes[0].t0);
  near(first.t1, p.strokes.filter((s) => s.path === 'scenes[3].elements[0]').at(-1).t1);
  assert.ok(p.strokes.every((s) => s.path.startsWith('scenes[3].elements[')));
  assert.equal(unit([1080, 1920]), layoutUnit([1080, 1920]));
  assert.equal(unit([1920, 1080]), layoutUnit([1920, 1080]));
});

test('a type the pencil cannot draw is a problem, not a crash', () => {
  const p = plan([{ id: 'c', type: 'counter', to: 5, x: 0, y: 0 }, rect('r')]);
  assert.equal(p.problems.length, 1);
  assert.match(p.problems[0].message, /counter/);
  assert.equal(p.strokes.length, 1);
  assert.throws(() => planScene(scene([]), { seed: 1 }), /ctx\.size/);
});

test('the plan modules are pure: no Node imports, no DOM, no Math.random', () => {
  for (const file of ['geometry.mjs', 'plan.mjs', 'timing.mjs']) {
    const source = readFileSync(path.join(root, 'template/sketch', file), 'utf8');
    assert.ok(!/from\s+['"]node:/.test(source), `${file}: node: import`);
    assert.ok(!/\b(document|window|getPointAtLength|getTotalLength|Math\.random|process\.)\b/.test(source.replace(/\/\/.*$/gm, '')), `${file}: DOM, Node or random`);
    for (const [, spec] of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) assert.ok(spec.startsWith('.'), `${file}: ${spec} is not a relative import`);
    assert.ok(!/lucide\.mjs/.test(source.replace(/\/\/.*$/gm, '')), `${file}: icons come in through ctx.icons`);
  }
});

test('expandSpec keeps a block\'s drawAt on its group, and a block without one gets none', () => {
  const block = (extra) => ({ id: 'b', type: 'block', block: 'title-card', x: 960, y: 540, params: { title: 'Hi' }, ...extra });
  const spec = (el) => ({ scenes: [{ id: 's', duration: 5, elements: [el] }] });
  const withAt = expandSpec(spec(block({ drawAt: 2.5 }))).scenes[0].elements[0];
  assert.equal(withAt.type, 'group');
  assert.equal(withAt.drawAt, 2.5);
  const without = expandSpec(spec(block({}))).scenes[0].elements[0];
  assert.deepEqual(Object.keys(without), ['id', 'type', 'x', 'y', 'children']);
  assert.equal(Object.hasOwn(without, 'drawAt'), false);
});

function sketchSpec(elements, duration, extra = {}) {
  return { scenes: [{ id: 's', duration, style: 'sketch', elements }], ...extra };
}
const errorsOf = (spec) => validateSpec(spec, { dir: root }).errors.map((e) => `${e.path}: ${e.message}`);

test('a scene shorter than the drawing needs is a validation error with the seconds', () => {
  const elements = [text('a', { text: 'a line of handwriting that takes a while to write out' }), rect('b'), text('c', { y: 800, text: 'and one more' })];
  const expanded = expandSpec(sketchSpec(elements, 30));
  const { needs } = planScene(expanded.scenes[0], ctx({ size: [1920, 1080] }));
  const asked = Math.ceil(needs * 10) / 10;
  assert.ok(asked > 3 && asked < 29, `needs ${asked}`);
  assert.deepEqual(errorsOf(sketchSpec(elements, 30)), []);
  assert.deepEqual(errorsOf(sketchSpec(elements, asked)), [], 'a scene of exactly the stated length is enough');
  assert.deepEqual(errorsOf(sketchSpec(elements, asked - 0.2)), [`scenes[0]: this drawing needs a scene of at least ${asked}s`]);
});

test('the required-duration error follows the spec\'s pace and seed settings, and a standard scene needs nothing', () => {
  const elements = [text('a', { text: 'a line of handwriting that takes a while to write out' }), rect('b')];
  const slow = errorsOf(sketchSpec(elements, 5, { sketch: { pace: 0.5 } }));
  const fast = errorsOf(sketchSpec(elements, 5, { sketch: { pace: 2 } }));
  assert.equal(slow.length, 1);
  assert.deepEqual(fast, []);
  const standard = { scenes: [{ id: 's', duration: 0.5, elements }] };
  assert.deepEqual(errorsOf(standard), []);
});

test('when the last element is a block the error sits under its first required param; otherwise at the scene', () => {
  // No sketch block exists yet, so a standard one stands in (validateSpec would refuse it first: this calls the check alone).
  const block = { id: 'b', type: 'block', block: 'title-card', x: 960, y: 540, params: { title: 'A fairly long title for a card' } };
  const run = (elements) => {
    const written = sketchSpec(elements, 0.5);
    const errors = [];
    checkSketchDuration(written, expandSpec(written), errors);
    return errors.map((e) => `${e.path}: ${e.message}`);
  };
  const [onBlock] = run([text('a'), block]);
  assert.match(onBlock, /^scenes\[0\]\.elements\[1\]\.params\.title: this drawing needs a scene of at least \d+(\.\d)?s$/);
  const [onText] = run([block, text('a')]);
  assert.match(onText, /^scenes\[0\]: this drawing needs a scene of at least /);
});

test('a spec with other errors gets those alone: the length is checked once everything else is valid', () => {
  const found = errorsOf(sketchSpec([text('a', { text: 'a line of handwriting that takes a while' }), { id: 'i', type: 'icon', name: 'sever', size: 80, x: 0, y: 0 }], 0.5));
  assert.equal(found.length, 1, found.join('\n'));
  assert.match(found[0], /unknown icon "sever"/);
});

test('a plan of malformed input reports a problem instead of throwing', () => {
  const p = plan([{ id: 'i', type: 'icon', name: 'server', x: 10, y: 10 }, { id: 'r', type: 'shape', shape: 'rect', x: 'left', y: 10 }, rect('ok')]);
  assert.equal(p.problems.length, 2);
  assert.equal(p.strokes.length, 1);
  assert.ok(Number.isFinite(p.needs));
});

// ---- fix round 1 ----------------------------------------------------------------------------------------------------

const line = (id, extra = {}) => ({ id, type: 'shape', shape: 'line', x: 400, y: 300, ...extra });
const tipOf = (p) => p.strokes[0].points.at(-1);
const barbsOf = (p) => p.strokes.slice(1);

test('a scribble shape too small for a hatch is drawn without one, in the plan and in validateSpec', () => {
  for (const el of [
    { id: 'e', type: 'shape', shape: 'ellipse', x: 300, y: 300, width: 40, height: 30, fill: 'scribble' },
    { id: 'r', type: 'shape', shape: 'rect', x: 300, y: 300, width: 20, height: 20, fill: 'scribble' },
    { id: 'z', type: 'shape', shape: 'rect', x: 300, y: 300, width: 0, height: 0, fill: 'scribble' },
  ]) {
    const p = plan([el]);
    assert.deepEqual(p.strokes.map((s) => s.kind), ['line'], el.id);
    assert.deepEqual(p.problems, [], el.id);
    assert.deepEqual(errorsOf(sketchSpec([el], 30)), [], el.id);
  }
});

test('a line with `to` runs from x, y to `to`; width is not needed; without `to` it stays horizontal', () => {
  const down = plan([line('v', { arrow: 'end', to: { x: 400, y: 600 } })]);
  const [tx, ty] = tipOf(down);
  assert.ok(Math.abs(tx - 400) < 12 && Math.abs(ty - 600) < 6, `tip ${tx},${ty}`);
  const [sx, sy] = down.strokes[0].points[0];
  assert.ok(Math.abs(sx - 400) < 12 && Math.abs(sy - 300) < 6, `start ${sx},${sy}`);
  const flat = plan([line('h', { width: 200 })]);
  assert.ok(flat.strokes[0].points.every(([, y]) => Math.abs(y - 300) < 5), 'horizontal as before');
  const grouped = plan([{ id: 'g', type: 'group', x: 100, y: 100, children: [line('v', { x: 10, y: 10, to: { x: 10, y: 110 } })] }]);
  const gp = grouped.strokes[0].points;
  assert.ok(Math.abs(gp[0][0] - 110) < 12 && Math.abs(gp[0][1] - 110) < 6 && Math.abs(gp.at(-1)[1] - 210) < 6, '`to` is in the element\'s own frame');
});

test('a line without an arrow wobbles as the spike\'s underline (amp 3, wave 90); an arrow keeps its own (amp 1.3, wave 60)', () => {
  const [from, to] = [[100, 300], [900, 300]];
  const wobbled = (id, bow, shape) => wobble(bowedLine(from, to, bow), makeRng(hashSeed(1, id)), { ...shape, u: 1 });
  const underline = plan([line('u', { x: 100, y: 300, to: { x: 900, y: 300 }, bow: -30 })]);
  assert.deepEqual(underline.strokes[0].points, wobbled('u', -30, { amp: 3, wave: 90 }));
  const arrow = plan([line('a', { x: 100, y: 300, to: { x: 900, y: 300 }, bow: -30, arrow: 'end' })]);
  assert.deepEqual(arrow.strokes[0].points, wobbled('a', -30, { amp: 1.3, wave: 60 }));
});

test('a barb ends on the tip and starts behind it, along the line\'s end direction, whichever way the arrow goes', () => {
  const cases = { down: { x: 400, y: 600 }, up: { x: 400, y: 0 }, left: { x: 100, y: 300 }, right: { x: 700, y: 300 }, diagonal: { x: 650, y: 550 } };
  for (const [name, to] of Object.entries(cases)) {
    const p = plan([line('a', { arrow: 'end', to })]);
    assert.equal(p.strokes.length, 3, name);
    const tip = tipOf(p);
    const dir = [to.x - 400, to.y - 300].map((c) => c / Math.hypot(to.x - 400, to.y - 300));
    for (const barb of barbsOf(p)) {
      const [bx, by] = barb.points[0];
      const back = (bx - tip[0]) * dir[0] + (by - tip[1]) * dir[1]; // negative: behind the tip
      assert.ok(back < -10, `${name}: barb starts behind the tip (${back.toFixed(1)})`);
      assert.ok(Math.hypot(barb.points.at(-1)[0] - tip[0], barb.points.at(-1)[1] - tip[1]) < 1, `${name}: ends on the tip`);
    }
  }
});

test('bow bends a line sideways (positive: to the left of the way it runs); a box includes the bow and the barbs', () => {
  const straight = plan([line('s', { to: { x: 700, y: 300 }, bow: 0 })]);
  assert.ok(straight.strokes[0].points.every(([, y]) => Math.abs(y - 300) < 5));
  const left = plan([line('l', { to: { x: 700, y: 300 }, bow: 60 })]);
  const right = plan([line('r', { to: { x: 700, y: 300 }, bow: -60 })]);
  assert.ok(Math.min(...left.strokes[0].points.map((pt) => pt[1])) < 300 - 20, 'positive bow bends a rightward line upwards');
  assert.ok(Math.max(...right.strokes[0].points.map((pt) => pt[1])) > 300 + 20);
  const box = left.elements.get('elements[0]').box;
  assert.ok(box.y <= Math.min(...left.strokes[0].points.map((pt) => pt[1])) + 1e-9, 'the box reaches the top of the bow');
  const arrow = plan([line('a', { arrow: 'end', to: { x: 400, y: 600 } })]);
  const ab = arrow.elements.get('elements[0]').box;
  for (const s of arrow.strokes) for (const [x, y] of s.points) assert.ok(x >= ab.x - 1e-9 && x <= ab.x + ab.width + 1e-9 && y >= ab.y - 1e-9 && y <= ab.y + ab.height + 1e-9, 'every stroke point is inside the box');
  assert.ok(ab.width > 20, 'the barbs widen a vertical arrow\'s box');
});

test('to and bow are for line shapes in sketch scenes; width is not needed with `to`', () => {
  const to = { x: 400, y: 600 };
  assert.deepEqual(errorsOf(sketchSpec([line('a', { arrow: 'end', to, bow: 20 })], 30)), []);
  const standard = errorsOf({ scenes: [{ id: 's', duration: 5, elements: [line('a', { to })] }] });
  assert.equal(standard.length, 1, standard.join('\n'));
  assert.match(standard[0], /^scenes\[0\]\.elements\[0\]\.to: to is for sketch scenes/);
  const bowOnly = errorsOf({ scenes: [{ id: 's', duration: 5, elements: [line('a', { bow: 5 })] }] });
  assert.match(bowOnly[0], /^scenes\[0\]\.elements\[0\]\.bow: bow is for sketch scenes/);
  const onRect = errorsOf(sketchSpec([rect('r', { to })], 30));
  assert.deepEqual(onRect, ['scenes[0].elements[0].to: to is only valid on a line shape']);
  const onText = errorsOf(sketchSpec([text('t', { bow: 3 })], 30));
  assert.deepEqual(onText, ['scenes[0].elements[0].bow: bow is only valid on a line shape']);
  assert.ok(errorsOf(sketchSpec([line('a', { to: { x: 1 } })], 30)).length > 0, 'to needs x and y');
  assert.ok(errorsOf(sketchSpec([line('a', { to, bow: 'wide' })], 30)).length > 0, 'bow is a number');
});

test('text is checked as NFC: a letter that only exists decomposed is refused, one that composes into the font is not', () => {
  const tilde = errorsOf(sketchSpec([text('t', { text: 'ṽ' })], 30)); // NFC "ṽ" (U+1E7D) is not in the font: it would vanish
  assert.deepEqual(tilde, ['scenes[0].elements[0].text: "ṽ" is not in the handwriting font; remove it or use a standard scene']);
  assert.deepEqual(errorsOf(sketchSpec([text('t', { text: 'Ångström' })], 30)), [], 'U+212B is NFC "Å", which the font has');
  assert.deepEqual(errorsOf(sketchSpec([text('t', { text: 'Café' })], 30)), []);
  const p = plan([text('t', { text: 'Å' })]);
  assert.deepEqual(p.elements.get('elements[0]').glyphs.map((g) => g.char), ['Å']);
});

test('plan problems are validation errors at their paths: a word wider than maxWidth', () => {
  const found = errorsOf(sketchSpec([text('t', { text: 'extraordinary', fontSize: 80, maxWidth: 100 })], 30));
  assert.equal(found.length, 1, found.join('\n'));
  assert.match(found[0], /^scenes\[0\]\.elements\[0\]: a word is wider than maxWidth 100; /);
  const inGroup = errorsOf(sketchSpec([{ id: 'g', type: 'group', x: 0, y: 0, children: [text('t', { text: 'extraordinary', fontSize: 80, maxWidth: 100 })] }], 30));
  assert.match(inGroup[0], /^scenes\[0\]\.elements\[0\]\.children\[0\]: a word is wider/);
  assert.deepEqual(errorsOf(sketchSpec([text('t', { text: 'extraordinary', fontSize: 80, maxWidth: 900 })], 30)), []);
});

test('the plan carries size, unit and the hand\'s moves: enter, travel, exit', () => {
  const p = plan(BOARD, { startAfter: 1 });
  assert.deepEqual(p.size, SIZE);
  assert.equal(p.unit, 1);
  const kinds = p.moves.map((m) => m.kind);
  assert.equal(kinds[0], 'enter');
  assert.equal(kinds.at(-1), 'exit');
  assert.ok(kinds.slice(1, -1).every((k) => k === 'travel'));
  assert.ok(p.moves[0].t0 >= 1 + HAND_LEAD - 1e-9, 'the hand waits for startAfter and the lead');
  assert.ok(p.moves[0].from[0] > SIZE[0] && p.moves[0].from[1] > SIZE[1], 'it enters from beyond the lower right');
  near(p.moves[0].t1, p.strokes[0].t0);
  p.moves.forEach((m, i) => {
    assert.ok(m.t1 >= m.t0);
    if (i > 0) assert.ok(m.t0 >= p.moves[i - 1].t1 - 1e-9, 'moves do not overlap');
  });
  const travel = p.moves.filter((m) => m.kind === 'travel');
  for (const m of travel) assert.ok(p.strokes.some((s) => Math.abs(s.t0 - m.t1) < 1e-9 && s.points[0][0] === m.to[0]), 'a travel ends where a stroke starts, when it does');
  const exit = p.moves.at(-1);
  near(exit.t0, p.drawEnd);
  near(exit.t1 - exit.t0, HAND_EXIT);
  near(exit.t1, p.needs);
  assert.deepEqual(exit.from, p.strokes.at(-1).points.at(-1));
  assert.ok(exit.to[0] > SIZE[0] && exit.to[1] > SIZE[1], 'the hand is off canvas at a scene of exactly needs');
  assert.deepEqual(plan([]).moves, []);
  assert.equal(plan(BOARD, { size: [540, 960] }).unit, 0.5);
});

test('Stroke.color is final: accent is the accent, surface the board, every other theme token ink, CSS colours pass through', () => {
  const colourOfRect = (stroke) => plan([rect('r', { stroke })]).strokes[0].color;
  for (const token of COLOR_TOKENS) {
    const want = token === 'accent' ? PALETTE.accent : token === 'surface' ? PALETTE.board : PALETTE.ink;
    assert.equal(colourOfRect(token), want, token);
  }
  assert.equal(colourOfRect('#ff0000'), '#ff0000');
  assert.equal(colourOfRect('rebeccapurple'), 'rebeccapurple');
  assert.equal(plan([text('t', { color: 'text2' })]).strokes[0].color, PALETTE.ink);
  assert.equal(plan([{ id: 'i', type: 'icon', name: 'server', size: 50, x: 0, y: 0, color: 'cat3' }]).strokes[0].color, PALETTE.ink);
});

test('needs includes startAfter even with nothing to draw', () => {
  assert.equal(plan([], { startAfter: 1.5 }).needs, 1.5);
  assert.equal(plan([text('t', { text: '' })], { startAfter: 2 }).needs, 2);
  assert.equal(plan([]).needs, 0);
});

test('a text box is as tall as the font\'s ascent minus descent, per line', () => {
  const one = plan([text('t', { text: 'hi', fontSize: 100 })]).elements.get('elements[0]').box;
  near(one.height, 100 * LINE_EM);
  assert.ok(LINE_EM > 1.2 && LINE_EM < 1.3);
  const two = plan([text('t', { text: 'hi\nyo', fontSize: 100 })]).elements.get('elements[0]');
  near(two.box.height, 200 * LINE_EM);
  near(two.glyphs.find((g) => g.char === 'y').y - two.glyphs[0].y, 100 * LINE_EM);
  assert.ok(two.glyphs[0].y > two.box.y && two.glyphs[0].y < two.box.y + 100 * LINE_EM, 'the baseline is inside its line');
});

test('adding a scribble fill does not change the outline\'s wobble', () => {
  const plain = plan([rect('r')]).strokes[0];
  const filled = plan([rect('r', { fill: 'scribble' })]);
  assert.deepEqual(filled.strokes.find((s) => s.kind === 'line').points, plain.points);
  const ellipse = (extra) => plan([{ id: 'e', type: 'shape', shape: 'ellipse', x: 600, y: 400, width: 300, height: 200, ...extra }]).strokes.find((s) => s.kind === 'line');
  assert.deepEqual(ellipse({ fill: 'scribble' }).points, ellipse({}).points);
});

test('a no-break space is not a place to wrap and not a glyph', () => {
  const p = plan([text('t', { text: 'one two three', fontSize: 100, maxWidth: 300 })]);
  const el = p.elements.get('elements[0]');
  const rows = [...new Set(el.glyphs.map((g) => g.y))];
  assert.equal(rows.length, 2, 'wraps after "one two", not inside it');
  assert.ok(!el.glyphs.some((g) => g.char === ' '));
  const joined = plan([text('t', { text: 'one two', fontSize: 100, maxWidth: 200 })]);
  assert.equal(joined.problems.length, 1, 'the two words are one word that is too wide');
  assert.match(joined.problems[0].message, /wider than maxWidth/);
});

test('DEFAULT_SHAPE_SIZE does not drift from the standard shape\'s', () => {
  const box = plan([{ id: 'r', type: 'shape', shape: 'rect', x: 300, y: 300 }]).elements.get('elements[0]').box;
  assert.deepEqual([box.width, box.height], [DEFAULT_SHAPE_SIZE, DEFAULT_SHAPE_SIZE]);
  const flat = plan([line('l')]).strokes[0].points;
  assert.ok(Math.abs(flat.at(-1)[0] - flat[0][0] - DEFAULT_SHAPE_SIZE) < 8, 'a line without width or `to` is as long as the standard one');
});

// ---- fix round 2 ----------------------------------------------------------------------------------------------------

test('THEME_TOKENS is exactly COLOR_TOKENS: an entry missing from either list fails', () => {
  assert.deepEqual([...(planApi.THEME_TOKENS ?? [])].sort(), [...COLOR_TOKENS].sort());
});

test('a counter\'s `to` is still a number: a string, an object and null are errors, as before sketch mode', () => {
  const counter = (to) => ({ scenes: [{ id: 's', duration: 5, elements: [{ id: 'c', type: 'counter', x: 960, y: 540, to }] }] });
  for (const bad of ['abc', { x: 1, y: 2 }, null, [1], true]) {
    const found = errorsOf(counter(bad));
    assert.ok(found.length > 0, `to ${JSON.stringify(bad)} must be an error`);
    assert.ok(found.every((e) => e.startsWith('scenes[0].elements[0].to: ')), found.join('\n'));
    assert.ok(found.some((e) => e.endsWith('must be number')), `${JSON.stringify(bad)}: ${found.join(' | ')}`);
  }
  assert.deepEqual(errorsOf(counter(100)), []);
  assert.deepEqual(errorsOf(counter(0)), []);
  const withVar = { vars: { count: { type: 'number', default: 100 } }, ...counter('{{count}}') };
  assert.deepEqual(errorsOf(withVar), [], 'a number var substitutes before the schema runs');
});

test('a line\'s `to` is a point: a standard line with one is an error, and so is a sketch line with a number or a string', () => {
  const standard = errorsOf({ scenes: [{ id: 's', duration: 5, elements: [line('a', { to: { x: 1, y: 2 } })] }] });
  assert.equal(standard.length, 1, standard.join('\n'));
  assert.match(standard[0], /^scenes\[0\]\.elements\[0\]\.to: to is for sketch scenes/);
  for (const bad of ['abc', 5, {}, { x: 'a', y: 1 }, [1, 2], null]) {
    const found = errorsOf(sketchSpec([line('a', { to: bad })], 30));
    assert.ok(found.length > 0 && found.every((e) => e.startsWith('scenes[0].elements[0].to: ')), `${JSON.stringify(bad)}: ${found.join(' | ')}`);
  }
});

test('a plan of a line with a malformed `to` reports a problem instead of throwing', () => {
  for (const bad of ['abc', 5, {}, { x: 'a', y: 1 }, [1, 2], null, { x: NaN, y: 1 }]) {
    const p = plan([line('a', { to: bad, arrow: 'end' }), rect('ok')]);
    assert.equal(p.problems.length, 1, JSON.stringify(bad));
    assert.equal(p.problems[0].path, 'elements[0]');
    assert.match(p.problems[0].message, /\bto\b/);
    assert.deepEqual(p.strokes.map((s) => s.path), ['elements[1]', 'elements[1]'].slice(0, p.strokes.length), 'only the rect is drawn');
    assert.ok(p.strokes.length >= 1 && Number.isFinite(p.needs));
  }
});

// ---- voiced scenes: pace, and a transition in front (Task 13; Task 12 left both uncovered) ---------------------------------

// One rect (one stroke) over `narration` ([{ start, end }], scene seconds), at `pace`, `startAfter` seconds after the scene begins.
const voicedRect = (narration, extra = {}) => plan([rect('r')], extra, { narration });
const lasts = (p) => p.strokes[0].t1 - p.strokes[0].t0;
const FIRST = plan([rect('r')]).strokes[0]; // unvoiced, at pace 1: where the pencil first touches down, and for how long
const START = FIRST.t0;
const LENGTH = FIRST.t1 - FIRST.t0;

test('voiced, pace: a roomy window stretches the paced drawing to twice its length, a snug one fits it exactly, at any pace', () => {
  for (const pace of [0.5, 1, 2]) {
    const natural = LENGTH / pace;
    near(lasts(plan([rect('r')], { pace })), natural);
    near(lasts(voicedRect([{ start: 0, end: 30 }], { pace })), 2 * natural);
    const snug = voicedRect([{ start: 0, end: START + 0.6 * natural }], { pace });
    near(lasts(snug), 0.6 * natural);
    assert.equal(snug.overruns.length, 0, `pace ${pace}`);
  }
});

test('voiced, pace: what cannot fit "at twice the pace" is measured against the pace the film runs at', () => {
  const during = (share) => [{ start: 0, end: START + share * LENGTH }]; // a sentence that lasts `share` drawings (at pace 1) after the pencil touches down
  assert.equal(voicedRect(during(0.4), { pace: 1 }).overruns.length, 1, 'guardrail: at pace 1 a sentence of 0.4 drawings is too short');
  const quick = voicedRect(during(0.4), { pace: 2 });
  assert.equal(quick.overruns.length, 0, 'at pace 2 the same sentence is enough');
  near(lasts(quick), 0.4 * LENGTH, 1e-9); // and the drawing fills it
  assert.equal(voicedRect(during(0.7), { pace: 1 }).overruns.length, 0);
  const slow = voicedRect(during(0.7), { pace: 0.5 });
  assert.equal(slow.overruns.length, 1, 'at pace 0.5 a window that suited pace 1 is too short');
  assert.match(slow.overruns[0].message, /^shape "r" cannot be drawn during the narration it is matched to, even at twice the pace: that lasts \d+(\.\d+)?s and the drawing needs \d+\.\ds;/);
  near(lasts(slow), 0.5 * (LENGTH / 0.5), 1e-9); // drawn at the fastest it goes: half its paced length
});

test('voiced, startAfter: nothing is drawn before the transition is over and the hand has led in, though the sentence began earlier', () => {
  const sentence = [{ start: 0, end: 3 }];
  const held = voicedRect(sentence, { startAfter: 0.8 });
  const cut = voicedRect(sentence);
  assert.ok(held.strokes[0].t0 >= 0.8 + HAND_LEAD - 1e-9, `drawing starts at ${held.strokes[0].t0}`);
  assert.ok(held.moves[0].t0 >= 0.8 + HAND_LEAD - 1e-9, 'and so does the hand');
  assert.ok(held.strokes[0].t0 > cut.strokes[0].t0);
  assert.equal(held.overruns.length, 0);
  assert.ok(held.strokes[0].t1 <= 3 + 1e-9, 'it still ends with the sentence');
  near(held.needs, held.drawEnd + HAND_EXIT);
});

test('voiced, startAfter: a later sentence still starts with its own sentence; only the one the transition overlaps is held back', () => {
  const sentences = [{ start: 0, end: 2.5 }, { start: 2.5, end: 5 }];
  const both = [rect('a', { x: 600 }), rect('b', { x: 1300 })];
  const p = plan(both, { startAfter: 0.8 }, { narration: sentences });
  const cut = plan(both, {}, { narration: sentences });
  assert.ok(strokesOf(p, 'elements[0]')[0].t0 >= 1.05 - 1e-9, 'the first waits for the transition');
  assert.ok(strokesOf(cut, 'elements[0]')[0].t0 < 1.05, 'guardrail: with no transition it does not');
  near(strokesOf(cut, 'elements[1]')[0].t0, 2.5);
  const second = strokesOf(p, 'elements[1]')[0].t0;
  assert.ok(second >= 2.5 - 1e-9 && second <= 2.5 + 0.3, `the second starts with its sentence, or the hand's travel after it: ${second}`); // the first one ran on a little (it started later), so the hand has to travel
  assert.equal(p.overruns.length, 0);
});

test('voiced, startAfter: a sentence that no longer fits once the transition has gone is an overrun naming the element, and the cut it replaces had none', () => {
  const snug = [{ start: 0, end: START + 0.7 * LENGTH }];
  assert.equal(voicedRect(snug).overruns.length, 0, 'guardrail: with no transition the sentence is enough');
  const held = voicedRect(snug, { startAfter: 0.8 });
  assert.equal(held.overruns.length, 1);
  assert.equal(held.overruns[0].path, 'elements[0]');
  assert.match(held.overruns[0].message, /^shape "r" cannot be drawn during the narration it is matched to, even at twice the pace: /);
  assert.deepEqual(held.problems, [], 'check.mjs reports it; validation does not');
  assert.ok(held.strokes[0].t0 >= 0.8 + HAND_LEAD - 1e-9, 'it is still drawn, after the transition');
  const over = voicedRect([{ start: 0, end: 0.5 }], { startAfter: 0.8 }); // the sentence is over before the transition is
  assert.equal(over.overruns.length, 1);
  assert.ok(over.strokes[0].t0 >= 1.05 - 1e-9);
});
