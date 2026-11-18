// PADiagram.camera (template/camera.js) in Node: the easing of a glide. A story beat asks for
// `ease: 'in-out'` (the camera eases in as well as out: it does not open at full speed); every
// other glide (Fit, Home, a pan cue) keeps the ease-out it always had.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../template/camera.js', import.meta.url), 'utf8');

function load() {
  const frames = [];
  const win = { requestAnimationFrame: (fn) => { frames.push(fn); return frames.length; }, cancelAnimationFrame() {} };
  new Function('window', src)(win);
  const stage = { getBoundingClientRect: () => ({ width: 800, height: 400, left: 0, top: 0, right: 800, bottom: 400 }), querySelector: () => null, setAttribute() {} };
  const attrs = {};
  const svg = { setAttribute: (name, value) => { attrs[name] = value; } };
  const camera = win.PADiagram.camera(stage, svg, { width: 800, height: 400, boxes: {} }, {});
  camera.refit();
  const centreX = () => { const [x, , w] = attrs.viewBox.split(' ').map(Number); return x + w / 2; };
  return { camera, frames, centreX };
}

// How far (0 to 1) a 100 ms glide of the centre has travelled at `at` ms.
function progressAt(options, at) {
  const { camera, frames, centreX } = load();
  const from = centreX();
  camera.moveTo({ cx: from + 300, cy: 200, s: camera.fitScale(camera.size()) }, { ms: 100, ...options });
  frames.at(-1)(0); // the first frame sets t0
  frames.at(-1)(at);
  return (centreX() - from) / 300;
}

test('an in-out glide eases in: a quarter of the way through it has covered under a quarter of the distance', () => {
  const inOut = progressAt({ ease: 'in-out' }, 25);
  assert.ok(inOut < 0.25, `in-out is slow to start, got ${inOut}`);
  assert.ok(Math.abs(progressAt({ ease: 'in-out' }, 50) - 0.5) < 0.01, 'and is half done at half time');
});

test('a glide with no ease option is the ease-out it always was: most of the distance in the first quarter', () => {
  const out = progressAt({}, 25);
  assert.ok(out > 0.5, `ease-out opens fast, got ${out}`);
});

test('an in-out glide ends exactly on its target', () => {
  assert.equal(progressAt({ ease: 'in-out' }, 100), 1);
});

// ---- moving() and whenStill(fn): the camera says when it has stopped (the story's caption waits for it) ----

function glide(options = {}) {
  const h = load();
  const from = h.centreX();
  h.camera.moveTo({ cx: from + 300, cy: 200, s: h.camera.fitScale(h.camera.size()) }, { ms: 100, ...options });
  return h;
}

test('whenStill runs at once when no glide is running', () => {
  const { camera } = load();
  const calls = [];
  assert.equal(camera.moving(), false);
  camera.whenStill(() => calls.push('now'));
  assert.deepEqual(calls, ['now']);
});

test('whenStill waits for the glide to land, whatever the clock: a frame that arrives late still ends it, and only then does the callback run', () => {
  const { camera, frames } = glide();
  const calls = [];
  assert.equal(camera.moving(), true, 'a glide is running before its first frame');
  camera.whenStill(() => calls.push('still'));
  frames.at(-1)(1000); // the first frame sets t0, however late it comes
  frames.at(-1)(1050);
  assert.deepEqual(calls, [], 'half way: the camera is still moving');
  assert.equal(camera.moving(), true);
  frames.at(-1)(1100);
  assert.deepEqual(calls, ['still'], 'it lands, then the callback runs');
  assert.equal(camera.moving(), false);
});

test('whenStill callbacks run once; a glide that replaces another keeps them waiting for the new landing', () => {
  const { camera, frames } = glide();
  const calls = [];
  camera.whenStill(() => calls.push('still'));
  frames.at(-1)(0);
  camera.moveTo({ cx: 0, cy: 0, s: 1 }, { ms: 100 }); // a reframe replaces the glide under way
  assert.deepEqual(calls, [], 'replacing a glide is not stopping');
  frames.at(-1)(10);
  frames.at(-1)(110);
  assert.deepEqual(calls, ['still']);
  frames.at(-1)?.(200);
  assert.deepEqual(calls, ['still'], 'not run again');
});

test('whenStill runs when the reader stops the glide (a pan or a zoom) and when a move is instant', () => {
  const panned = glide();
  const calls = [];
  panned.camera.whenStill(() => calls.push('pan'));
  panned.camera.panBy(10, 0);
  assert.deepEqual(calls, ['pan'], 'a pan cancels the glide: the camera is still');
  const jumped = glide();
  jumped.camera.whenStill(() => calls.push('jump'));
  jumped.camera.moveTo({ cx: 0, cy: 0, s: 1 }, { instant: true });
  assert.deepEqual(calls, ['pan', 'jump']);
});
