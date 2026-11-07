import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSpec, validateSpec } from '../scripts/lib/spec.mjs';
import { checkSketch, SKETCH_BLOCK_NAMES } from '../scripts/lib/sketch-check.mjs';
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
    `scenes[0].elements[0].block: title-card is not a sketch block; blocks a sketch scene takes: ${SKETCH_BLOCK_NAMES.join(', ')}; ${STANDARD_HINT}`,
  ]);
  assert.deepEqual([...SKETCH_BLOCK_NAMES], ['sketch-diagram', 'sketch-steps', 'sketch-list', 'sketch-compare', 'sketch-callout']);
});

test('sketch-only blocks are told apart by the block list (test-local list: a name that is no block, such as sketch-fake)', () => {
  const written = (style) => ({ scenes: [scene([{ id: 'b', type: 'block', block: 'sketch-fake', x: 0, y: 0, params: {} }], { style })] });
  const run = (spec, sketchBlocks) => { const out = []; checkSketch(spec, out, { sketchBlocks }); return out.map((e) => `${e.path}: ${e.message}`); };
  assert.deepEqual(run(written('sketch'), ['sketch-fake']), []);
  assert.deepEqual(run(written('standard'), ['sketch-fake']), [
    'scenes[0].elements[0].block: sketch-fake is a sketch block; it draws only in a sketch scene (set "style": "sketch" on the scene, or at the root)',
  ]);
  const standardBlock = { scenes: [scene([{ id: 'b', type: 'block', block: 'title-card', x: 0, y: 0, params: {} }], { style: 'sketch' })] };
  assert.deepEqual(run(standardBlock, ['sketch-other', 'sketch-more']), [
    `scenes[0].elements[0].block: title-card is not a sketch block; blocks a sketch scene takes: sketch-other, sketch-more; ${STANDARD_HINT}`,
  ]);
  assert.deepEqual(run(written('sketch'), ['sketch-other']), [], 'a name that is no block at all is left to the block check, which lists the blocks');
});

test('a standard block in a sketch scene is told it does not belong before its params are checked', () => {
  const block = { id: 'b', type: 'block', block: 'title-card', x: 960, y: 540, params: {} };
  const found = errs(sketch([block]));
  assert.equal(found[0], `scenes[0].elements[0].block: title-card is not a sketch block; blocks a sketch scene takes: ${SKETCH_BLOCK_NAMES.join(', ')}; ${STANDARD_HINT}`);
  assert.ok(found.length > 1 && found.slice(1).every((e) => e.startsWith('scenes[0].elements[0].params')), found.join('\n'));
  const unknown = errs(sketch([{ ...block, block: 'no-such-block' }]));
  assert.equal(unknown.length, 1, unknown.join('\n'));
  assert.match(unknown[0], /^scenes\[0\]\.elements\[0\]\.block: unknown block "no-such-block"/);
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

test('to and bow on a standard element that is not a line say "not valid on <type>", as any other stray field; a line still hears about sketch scenes', () => {
  const [onText] = errs(standard([text({ bow: 3 })]));
  assert.match(onText, /^scenes\[0\]\.elements\[0\]\.bow: not valid on text; allowed: id, type, x, y, opacity, scale, rotate, keyframes, hold, text, /);
  assert.doesNotMatch(onText, /horizontal|sketch/);
  const rect = { id: 'r', type: 'shape', shape: 'rect', x: 0, y: 0, width: 200, height: 100, to: { x: 1, y: 2 } };
  assert.match(errs(standard([rect]))[0], /^scenes\[0\]\.elements\[0\]\.to: not valid on shape; allowed: id, type, x, y, /);
  const line = { id: 'l', type: 'shape', shape: 'line', x: 0, y: 0, width: 200, bow: 5 };
  assert.equal(errs(standard([line]))[0], 'scenes[0].elements[0].bow: bow is for sketch scenes (set "style": "sketch" on the scene, or at the root); a standard line is horizontal');
});

test('a colour fill on a rect or an ellipse in a sketch scene is an error at .fill (it would draw nothing); a standard scene keeps it', () => {
  const shape = (kind, fill) => ({ id: 'r', type: 'shape', shape: kind, x: 0, y: 0, width: 200, height: 100, fill });
  const message = 'scenes[0].elements[0].fill: a drawn shape takes no colour fill; use "fill": "scribble" to hatch it';
  for (const kind of ['rect', 'ellipse']) {
    assert.deepEqual(errs(sketch([shape(kind, '#ff0000')])), [message], kind);
    assert.deepEqual(errs(sketch([shape(kind, 'surface')])), [message], `${kind} with a theme token`);
    assert.deepEqual(errs(sketch([shape(kind, 'scribble')])), [], kind);
    assert.deepEqual(errs(sketch([shape(kind, undefined)])), [], `${kind} with no fill`);
    assert.deepEqual(errs(standard([shape(kind, '#ff0000')])), [], `${kind} in a standard scene`);
  }
  const nested = { id: 'g', type: 'group', x: 0, y: 0, children: [shape('rect', '#ff0000')] };
  assert.deepEqual(errs(sketch([nested])), ['scenes[0].elements[0].children[0].fill: a drawn shape takes no colour fill; use "fill": "scribble" to hatch it']);
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
  const ALLOWED = 'id, type, x, y, opacity, hold, drawAt, name, size, color';
  for (const [key, value] of [['keyframes', [{ t: 0, opacity: 0 }]], ['scale', 2], ['rotate', 5], ['typing', true]]) {
    assert.deepEqual(errs(sketch([icon({ name: 'server', size: 80, [key]: value })])), [`scenes[0].elements[0].${key}: not valid on icon; allowed: ${ALLOWED}`], key);
  }
  assert.deepEqual(errs(sketch([icon({ name: 'server', size: 80, opacity: 0.5, hold: true, drawAt: 1 })])), []);
});

test('an old or plain icon name suggests the name the set has now', () => {
  const icon = (name) => ({ id: 'i', type: 'icon', x: 0, y: 0, size: 80, name });
  assert.deepEqual(errs(sketch([icon('home')])), ['scenes[0].elements[0].name: unknown icon "home"; did you mean "house"? (find names: node scripts/sketch-icons.mjs search <word>)']);
  assert.ok(errs(sketch([icon('bar-chart')]))[0].includes('did you mean "chart-column"?'));
  assert.ok(errs(sketch([icon('Alert-Triangle')]))[0].includes('did you mean "triangle-exclamation-point"?'));
  assert.deepEqual(errs(sketch([icon('house'), icon('chart-column')].map((el, i) => ({ ...el, id: `i${i}` })))), []);
});

test('a refused field is reported once, by the check that knows the type: typing on an icon, role on a shape', () => {
  const shape = { id: 'r', type: 'shape', shape: 'rect', x: 0, y: 0, width: 100, height: 50, role: 'title' };
  assert.deepEqual(errs(sketch([shape])).filter((e) => e.startsWith('scenes[0].elements[0].role: ')).length, 1);
  assert.ok(errs(sketch([shape]))[0].startsWith('scenes[0].elements[0].role: not valid on shape; allowed: '));
  const icon = { id: 'i', type: 'icon', name: 'server', size: 80, x: 0, y: 0, typing: true };
  assert.equal(errs(sketch([icon])).length, 1);
});

test('a scene "art" background and a text font or fontWeight are refused in a sketch scene', () => {
  assert.deepEqual(errs(sketch([text()], { background: 'art' })), [
    `scenes[0].background: "art" is not allowed in a sketch scene (the board is its background); use a colour, or ${STANDARD_HINT}`,
  ]);
  assert.deepEqual(errs(sketch([text()], { background: '#ffeecc' })), [], 'a colour still overrides the board');
  assert.deepEqual(errs(standard([text()], { background: 'art' })), [], 'a standard scene keeps its art');
  for (const [key, value] of [['font', 'mono'], ['fontWeight', 700]]) {
    const found = errs(sketch([text({ [key]: value })]));
    assert.equal(found.length, 1, found.join('\n'));
    assert.equal(found[0], `scenes[0].elements[0].${key}: ${key} is not allowed in a sketch scene (handwriting has one face); still valid: opacity, hold, drawAt; ${STANDARD_HINT}`);
    assert.deepEqual(errs(standard([text({ [key]: value })])), []);
  }
});

test('a sketch scene in a viral spec is an error', () => {
  const viral = { mode: 'viral' };
  assert.deepEqual(errs({ ...viral, ...sketch([text()]) }), ['scenes[0].style: a hand-drawn scene is not available in viral mode; use "style": "standard", or drop "mode": "viral"']);
  assert.deepEqual(errs({ ...viral, style: 'sketch', ...standard([text()]) }), ['style: a hand-drawn scene is not available in viral mode; use "style": "standard", or drop "mode": "viral"']);
  assert.deepEqual(errs({ ...viral, ...standard([text()], { style: 'standard' }) }), []);
  assert.deepEqual(errs({ ...viral, style: 'sketch', ...standard([text()], { style: 'standard' }) }), [], 'a root style that no scene takes draws nothing');
  const mixed = errs({ ...viral, style: 'sketch', scenes: [scene([text()], { id: 'a', style: 'standard' }), scene([text({ id: 'u' })], { id: 'b' })] });
  assert.deepEqual(mixed, ['style: a hand-drawn scene is not available in viral mode; use "style": "standard", or drop "mode": "viral"']);
});

test('sketch.hand.tone outside the five names, sketch.hand.scale outside 0.5 to 1.2, sketch.pace outside 0.5 to 2 are errors', () => {
  const ok = { sketch: { hand: { tone: 'dark', scale: 1.2 }, seed: 7, pace: 2 }, ...sketch([text()]) };
  assert.deepEqual(errs(ok), []);
  assert.deepEqual(errs({ sketch: { hand: { tone: 'pink' } }, ...sketch([text()]) }), ['sketch.hand.tone: must be one of "light", "medium", "tan", "brown", "dark"']);
  assert.deepEqual(errs({ sketch: { hand: { tone: 'dar' } }, ...sketch([text()]) }), ['sketch.hand.tone: must be one of "light", "medium", "tan", "brown", "dark"; did you mean "dark"?']);
  assert.deepEqual(errs({ sketch: { hand: { scale: 0.4 } }, ...sketch([text()]) }), ['sketch.hand.scale: must be from 0.5 to 1.2 (got 0.4)']);
  assert.deepEqual(errs({ sketch: { hand: { scale: 1.3 } }, ...sketch([text()]) }), ['sketch.hand.scale: must be from 0.5 to 1.2 (got 1.3)']);
  assert.deepEqual(errs({ sketch: { pace: 0.4 }, ...sketch([text()]) }), ['sketch.pace: must be from 0.5 to 2 (got 0.4)']);
  assert.deepEqual(errs({ sketch: { pace: 2.1 }, ...sketch([text()]) }), ['sketch.pace: must be from 0.5 to 2 (got 2.1)']);
  assert.deepEqual(errs({ sketch: { hand: { scale: 'big' } }, ...sketch([text()]) }), ['sketch.hand.scale: must be number']);
  assert.deepEqual(errs({ sketch: { seed: 1.5 }, ...sketch([text()]) }), ['sketch.seed: must be integer']);
  assert.deepEqual(errs({ sketch: { hand: { tone: 'tan' }, paces: 1 }, ...sketch([text()]) }), ['sketch.paces: unknown property; did you mean "pace"?']);
});

test('drawAt is a number of seconds or "sentence:<n>"', () => {
  assert.deepEqual(errs(sketch([text({ drawAt: 1.5 })])), []);
  // A sentence needs narration to point into: with no voice track it is an error (the voice step's own tests: sketch-voice.test.mjs).
  assert.deepEqual(errs(sketch([text({ drawAt: 'sentence:2' })])), ['scenes[0].elements[0].drawAt: drawAt "sentence:2" needs a voice track: an audio entry with "scene": "s" whose file has a voice sidecar beside it (node scripts/voice.mjs writes one next to the .wav)']);
  const want = 'drawAt must be a number of seconds (0 or more) or "sentence:<n>"';
  for (const bad of ['sentence:x', 'later', true, null]) {
    assert.deepEqual(errs(sketch([text({ drawAt: bad })])), [`scenes[0].elements[0].drawAt: ${want}`], JSON.stringify(bad));
  }
  // 4.9 lies inside the scene, so drawAt accepts it; the drawing then cannot finish in 5s, which is the stroke plan's own error.
  assert.deepEqual(errs(sketch([text({ drawAt: 4.9 })])), ['scenes[0]: this drawing needs a scene of at least 5.7s'], 'the scene lasts 5s');
  for (const out of [-1, 5, 9]) {
    assert.deepEqual(errs(sketch([text({ drawAt: out })])), [
      `scenes[0].elements[0].drawAt: drawAt ${out} is outside scene "s", which lasts 5s; use 0 or more and less than 5, or "sentence:<n>"`,
    ], String(out));
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
