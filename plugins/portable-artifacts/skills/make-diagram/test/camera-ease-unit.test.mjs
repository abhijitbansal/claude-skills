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
