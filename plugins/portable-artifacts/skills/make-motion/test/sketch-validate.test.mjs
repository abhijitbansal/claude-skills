import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSpec, validateSpec } from '../scripts/lib/spec.mjs';
import { checkSketch } from '../scripts/lib/sketch-check.mjs';
import { isSketchScene, specHasSketch, PALETTE, HAND_TONES } from '../template/sketch/style.mjs';
import { specHasVideo } from '../scripts/lib/video.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exDir = path.join(root, 'references/examples');
const errs = (spec) => validateSpec(spec, { dir: root }).errors.map((e) => `${e.path}: ${e.message}`);
const text = (extra = {}) => ({ id: 't', type: 'text', text: 'hi', x: 960, y: 540, ...extra });
const scene = (elements, extra = {}) => ({ id: 's', duration: 5, elements, ...extra });
const sketch = (elements, extra = {}) => ({ scenes: [scene(elements, { style: 'sketch', ...extra })] });
const standard = (elements, extra = {}) => ({ scenes: [scene(elements, extra)] });

const SKETCH_ALLOWED = 'allowed: text, shape, icon, group, block (sketch blocks only)';
const STANDARD_HINT = 'put it in a standard scene (omit "style" on the scene, or set "style": "standard")';

test('style.mjs: the scene style wins over the root; the palette and hand tones are the spec\'s', () => {
  assert.equal(isSketchScene({}, {}), false);
  assert.equal(isSketchScene({ style: 'sketch' }, {}), true);
  assert.equal(isSketchScene({ style: 'sketch' }, { style: 'standard' }), false);
  assert.equal(isSketchScene({ style: 'standard' }, { style: 'sketch' }), true);
  assert.equal(specHasSketch({ scenes: [{}, { style: 'sketch' }] }), true);
  assert.equal(specHasSketch({ style: 'sketch', scenes: [{ style: 'standard' }] }), false);
  assert.equal(specHasSketch({ scenes: [{}] }), false);
  assert.deepEqual({ ...PALETTE }, { board: '#fdfcf8', ink: '#1d2330', accent: '#e8590c' });
  assert.deepEqual([...HAND_TONES], ['light', 'medium', 'tan', 'brown', 'dark']);
});

test('style accepts standard and sketch at root and scene; a scene overrides the root', () => {
  assert.deepEqual(errs(sketch([text()])), []);
  assert.deepEqual(errs({ style: 'sketch', ...standard([text()]) }), []);
  assert.deepEqual(errs({ style: 'standard', ...standard([text()], { style: 'sketch' }) }), []);
  // a standard scene under a sketch root takes everything a standard scene takes
  const chart = { id: 'c', type: 'chart', x: 0, y: 0, width: 400, height: 300, vegaLite: { mark: 'bar', data: { values: [{ a: 1 }] }, encoding: { x: { field: 'a' } } } };
  assert.deepEqual(errs({ style: 'sketch', ...standard([chart], { style: 'standard' }) }), []);
  // and a sketch root refuses it in a scene that does not override
  assert.ok(errs({ style: 'sketch', ...standard([chart]) }).some((e) => e.startsWith('scenes[0].elements[0].type: ')));
});

test('an unknown style names the two styles and suggests the near one', () => {
  assert.deepEqual(errs(sketch([text()], { style: 'sketchy' })), ['scenes[0].style: must be one of "standard", "sketch"; did you mean "sketch"?']);
  assert.deepEqual(errs({ style: 'handdrawn', ...standard([text()]) }), ['style: must be one of "standard", "sketch"']);
});

const NOT_DRAWN = {
  chart: { vegaLite: { mark: 'bar', data: { values: [{ a: 1 }] }, encoding: { x: { field: 'a' } } }, width: 400, height: 300 },
  image: { src: 'nope.png', width: 100, height: 100 },
  video: { src: 'nope.mp4', width: 100, height: 100 },
  lottie: { src: 'nope.json', width: 100, height: 100 },
  code: { code: 'x = 1', lang: 'js', width: 400 },
  counter: { to: 5 },
};

test('a chart, image, video, lottie, code or counter in a sketch scene is an error pointing to a standard scene', () => {
  for (const [type, fields] of Object.entries(NOT_DRAWN)) {
    const found = errs(sketch([{ id: 'e', type, x: 100, y: 100, ...fields }]));
    const want = `scenes[0].elements[0].type: ${type} is not drawn in a sketch scene; ${SKETCH_ALLOWED}; ${STANDARD_HINT}`;
    assert.ok(found.includes(want), `${type}:\n${found.join('\n')}`);
  }
});

test('a standard block in a sketch scene is an error that lists the sketch blocks', () => {
  const block = { id: 'b', type: 'block', block: 'title-card', x: 960, y: 540, params: { title: 'Hi' } };
  assert.deepEqual(errs(sketch([block])), [
    `scenes[0].elements[0].block: title-card is not a sketch block; blocks a sketch scene takes: none yet; ${STANDARD_HINT}`,
  ]);
});

test('sketch-only blocks are told apart by the block list (test-local list: no sketch block exists yet)', () => {
  const written = (style) => ({ scenes: [scene([{ id: 'b', type: 'block', block: 'sketch-fake', x: 0, y: 0, params: {} }], { style })] });
  const run = (spec, sketchBlocks) => { const out = []; checkSketch(spec, out, { sketchBlocks }); return out.map((e) => `${e.path}: ${e.message}`); };
  assert.deepEqual(run(written('sketch'), ['sketch-fake']), []);
  assert.deepEqual(run(written('standard'), ['sketch-fake']), [
    'scenes[0].elements[0].block: sketch-fake is a sketch block; it draws only in a sketch scene (set "style": "sketch" on the scene, or at the root)',
  ]);
  assert.deepEqual(run(written('sketch'), ['sketch-other', 'sketch-more']), [
    `scenes[0].elements[0].block: sketch-fake is not a sketch block; blocks a sketch scene takes: sketch-other, sketch-more; ${STANDARD_HINT}`,
  ]);
});

const REFUSED = {
  keyframes: [{ t: 0, opacity: 0 }, { t: 1, opacity: 1 }],
  typing: true,
  role: 'title',
  exit: true,
  scale: 1.5,
  rotate: 10,
};

test('keyframes, typing, role, exit, scale and rotate on an element in a sketch scene are errors; camera on the scene is too', () => {
  for (const [key, value] of Object.entries(REFUSED)) {
    const found = errs(sketch([text({ [key]: value })]));
    const at = `scenes[0].elements[0].${key}: `;
    const hit = found.find((e) => e.startsWith(at));
    assert.ok(hit, `${key}:\n${found.join('\n')}`);
    assert.ok(hit.includes(`${key} is not allowed in a sketch scene`) && hit.includes('still valid: opacity, hold, drawAt') && hit.includes(STANDARD_HINT), hit);
  }
  const camera = errs(sketch([text()], { camera: { shake: { amount: 4 } } }));
  assert.deepEqual(camera, [`scenes[0].camera: camera is not allowed in a sketch scene (the board does not move); ${STANDARD_HINT}`]);
});

test('scale and rotate say why: the hand follows world coordinates', () => {
  const hit = errs(sketch([text({ scale: 2 })])).find((e) => e.startsWith('scenes[0].elements[0].scale: '));
  assert.ok(hit.includes('the hand follows world coordinates'), hit);
});

test('opacity and hold stay valid in a sketch scene, at any depth in a group', () => {
  const group = { id: 'g', type: 'group', x: 0, y: 0, children: [text({ id: 'inner', opacity: 0.5, hold: true })] };
  assert.deepEqual(errs(sketch([text({ opacity: 0.4, hold: true }), group])), []);
  const bad = { id: 'g', type: 'group', x: 0, y: 0, children: [text({ id: 'inner', rotate: 3 })] };
  assert.ok(errs(sketch([bad])).some((e) => e.startsWith('scenes[0].elements[0].children[0].rotate: ')));
});

test('an element or block named in a standard scene is unaffected: every example validates unchanged', () => {
  const files = readdirSync(exDir).filter((f) => f.endsWith('.json'));
  assert.ok(files.length >= 3);
  for (const f of files) {
    const { spec, dir } = loadSpec(path.join(exDir, f));
    if (specHasVideo(spec)) continue; // needs ffprobe; validate.test.mjs covers it
    assert.deepEqual(validateSpec(spec, { dir }).errors, [], f);
  }
  const busy = text({ typing: true, role: 'title', exit: true, scale: 2, rotate: 5, keyframes: [{ t: 0, opacity: 0 }, { t: 1, opacity: 1 }] });
  assert.deepEqual(errs(standard([busy, { id: 'cam', type: 'counter', to: 5, x: 0, y: 0 }], { camera: { shake: { amount: 4 } } })), []);
});

test('icon, drawAt and a scribble fill belong to sketch scenes; a standard scene refuses them', () => {
  const icon = { id: 'i', type: 'icon', name: 'server', size: 120, x: 100, y: 100 };
  assert.deepEqual(errs(sketch([icon])), []);
  assert.deepEqual(errs(standard([icon])), [`scenes[0].elements[0].type: icon is drawn only in a sketch scene; set "style": "sketch" on the scene, or at the root`]);
  assert.deepEqual(errs(standard([text({ drawAt: 1 })])), ['scenes[0].elements[0].drawAt: drawAt is for sketch scenes (set "style": "sketch" on the scene, or at the root); a standard scene starts elements with keyframes']);
  const rect = { id: 'r', type: 'shape', shape: 'rect', x: 0, y: 0, width: 200, height: 100, fill: 'scribble' };
  assert.deepEqual(errs(sketch([rect])), []);
  assert.deepEqual(errs(sketch([{ id: 'g', type: 'group', x: 0, y: 0, children: [rect] }])), []);
  const refused = errs(standard([rect]));
  assert.equal(refused.length, 1, refused.join('\n'));
  assert.ok(refused[0].startsWith('scenes[0].elements[0].fill: must be a CSS colour') && refused[0].includes('"scribble" is only valid as the fill of a shape in a sketch scene'), refused[0]);
});

test('scribble is a shape fill only: not a text colour, not a line fill', () => {
  const colour = errs(sketch([text({ color: 'scribble' })]));
  assert.ok(colour.some((e) => e.startsWith('scenes[0].elements[0].color: must be a CSS colour')), colour.join('\n'));
  const line = { id: 'l', type: 'shape', shape: 'line', x: 0, y: 0, width: 200, fill: 'scribble' };
  assert.deepEqual(errs(sketch([line])), ['scenes[0].elements[0].fill: "scribble" hatches a rect or an ellipse; a line has no inside']);
});

test('icon: size and name are required; the name must exist, with a did-you-mean', () => {
  const icon = (extra) => ({ id: 'i', type: 'icon', x: 0, y: 0, ...extra });
  assert.deepEqual(errs(sketch([icon({ name: 'server', size: 80, color: 'accent' })])), []);
  assert.ok(errs(sketch([icon({ size: 80 })])).includes('scenes[0].elements[0].name: required for type icon'));
  assert.ok(errs(sketch([icon({ name: 'server' })])).includes('scenes[0].elements[0].size: required for type icon'));
  assert.deepEqual(errs(sketch([icon({ name: 'sever', size: 80 })])), [
    'scenes[0].elements[0].name: unknown icon "sever"; did you mean "server"? (find names: node scripts/sketch-icons.mjs search <word>)',
  ]);
  assert.deepEqual(errs(sketch([icon({ name: 'qqqqqqqqqq', size: 80 })])), [
    'scenes[0].elements[0].name: unknown icon "qqqqqqqqqq"; find names: node scripts/sketch-icons.mjs search <word>',
  ]);
  assert.ok(errs(sketch([icon({ name: 'server', size: 80, keyframes: [{ t: 0, opacity: 0 }] })])).some((e) => e.startsWith('scenes[0].elements[0].keyframes: ')), 'an icon with keyframes is refused, not a crash');
});

test('a sketch scene in a viral spec is an error', () => {
  const viral = { mode: 'viral' };
  assert.deepEqual(errs({ ...viral, ...sketch([text()]) }), ['scenes[0].style: a hand-drawn scene is not available in viral mode; use "style": "standard", or drop "mode": "viral"']);
  assert.deepEqual(errs({ ...viral, style: 'sketch', ...standard([text()]) }), ['style: a hand-drawn scene is not available in viral mode; use "style": "standard", or drop "mode": "viral"']);
  assert.deepEqual(errs({ ...viral, ...standard([text()], { style: 'standard' }) }), []);
});

test('sketch.hand.tone outside the five names, sketch.hand.scale outside 0.5 to 1.2, sketch.pace outside 0.5 to 2 are errors', () => {
  const ok = { sketch: { hand: { tone: 'dark', scale: 1.2 }, seed: 7, pace: 2 }, ...sketch([text()]) };
  assert.deepEqual(errs(ok), []);
  assert.deepEqual(errs({ sketch: { hand: { tone: 'pink' } }, ...sketch([text()]) }), ['sketch.hand.tone: must be one of "light", "medium", "tan", "brown", "dark"']);
  assert.deepEqual(errs({ sketch: { hand: { tone: 'dar' } }, ...sketch([text()]) }), ['sketch.hand.tone: must be one of "light", "medium", "tan", "brown", "dark"; did you mean "dark"?']);
  assert.deepEqual(errs({ sketch: { hand: { scale: 0.4 } }, ...sketch([text()]) }), ['sketch.hand.scale: must be >= 0.5']);
  assert.deepEqual(errs({ sketch: { hand: { scale: 1.3 } }, ...sketch([text()]) }), ['sketch.hand.scale: must be <= 1.2']);
  assert.deepEqual(errs({ sketch: { pace: 0.4 }, ...sketch([text()]) }), ['sketch.pace: must be >= 0.5']);
  assert.deepEqual(errs({ sketch: { pace: 2.1 }, ...sketch([text()]) }), ['sketch.pace: must be <= 2']);
  assert.deepEqual(errs({ sketch: { seed: 1.5 }, ...sketch([text()]) }), ['sketch.seed: must be integer']);
  assert.deepEqual(errs({ sketch: { hand: { tone: 'tan' }, paces: 1 }, ...sketch([text()]) }), ['sketch.paces: unknown property; did you mean "pace"?']);
});

test('drawAt is a number of seconds or "sentence:<n>"', () => {
  assert.deepEqual(errs(sketch([text({ drawAt: 1.5 })])), []);
  assert.deepEqual(errs(sketch([text({ drawAt: 'sentence:2' })])), []);
  const want = 'drawAt must be a number of seconds (0 or more) or "sentence:<n>"';
  for (const bad of [-1, 'sentence:x', 'later', true, null]) {
    assert.deepEqual(errs(sketch([text({ drawAt: bad })])), [`scenes[0].elements[0].drawAt: ${want}`], JSON.stringify(bad));
  }
});

test('handwritten text with a character the font lacks is an error naming it', () => {
  assert.deepEqual(errs(sketch([text({ text: 'Ship it 🚀' })])), ['scenes[0].elements[0].text: "🚀" is not in the handwriting font; remove it or use a standard scene']);
  assert.deepEqual(errs(sketch([text({ text: 'Done ✓ and ✗' })])), ['scenes[0].elements[0].text: "✓", "✗" are not in the handwriting font; remove them or use a standard scene']);
  assert.deepEqual(errs(sketch([{ id: 'g', type: 'group', x: 0, y: 0, children: [text({ text: '日本' })] }])), [
    'scenes[0].elements[0].children[0].text: "日", "本" are not in the handwriting font; remove them or use a standard scene',
  ]);
  assert.deepEqual(errs(sketch([text({ text: 'Café résumé' })])), []);
  assert.deepEqual(errs(sketch([text({ text: 'Don’t — “stop”…\n€5 ™' })])), [], 'curly quotes, dashes, euro, trademark and a line break are in the font');
  assert.deepEqual(errs(standard([text({ text: 'Ship it 🚀' })])), [], 'a standard scene keeps its own fonts');
});

test('a text with no text field in a sketch scene is reported as required, not a crash', () => {
  const { text: _omitted, ...bare } = text();
  assert.deepEqual(errs(sketch([bare])), ['scenes[0].elements[0].text: required for type text']);
});
