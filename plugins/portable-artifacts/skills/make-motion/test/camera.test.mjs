// Task 13: a scene camera with keyframed zoom, pan and rotate, and a seeded shake. The camera is a `.camera` node inside the
// scene layer that holds the elements; the layer keeps the transition styles and the background, captions and the lens
// overlays (grain, vignette) are outside it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { shakeOffset, cameraTransform, cameraTweens, cameraSpans, MIN_ZOOM, MAX_ZOOM, SHAKE_HZ, SHAKE_SEED } from '../template/camera.mjs';
import { buildTimeline, seekTo } from '../template/timeline.mjs';
import { validateSpec, withDefaults, loadSpec } from '../scripts/lib/spec.mjs';
import { changeGaps } from '../template/viral.mjs';
import { sheetTimes } from '../scripts/lib/sheet.mjs';
import { startServer } from '../scripts/lib/server.mjs';
import { launchBrowser } from '../scripts/lib/browser.mjs';
import { probed, framed } from './render-probe.mjs';
import { requireRender, assertRendersIdentically, BROWSER_ONLY } from './helpers/render.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLE = path.join(root, 'references/examples/camera-push-in.json');
const CHECK = path.join(root, 'scripts/check.mjs');
const SIZE = [480, 270];
const label = (id, extra = {}) => ({ id, type: 'text', text: id, x: 240, y: 135, fontSize: 40, ...extra });
const scene = (camera, extra = {}) => ({ id: 's1', duration: 4, elements: [label('a')], camera, ...extra });
const errs = (motion) => validateSpec(motion).errors.map((e) => `${e.path}: ${e.message}`);

// A temp folder holding motion.json and `files` (name -> text); returns the motion.json path.
function specFile(motion, files = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'camera-'));
  for (const [name, body] of Object.entries(files)) writeFileSync(path.join(dir, name), body);
  const file = path.join(dir, 'motion.json');
  writeFileSync(file, JSON.stringify(motion));
  return file;
}
const runCheck = (motion, files) => spawnSync(process.execPath, [CHECK, specFile(motion, files), '--json'], { encoding: 'utf8' });
const verdict = (motion, files) => JSON.parse(runCheck(motion, files).stdout);
const messages = (list = []) => list.map((e) => `${e.path}: ${e.message}`);
const NOTHING = 'this camera does nothing; give a keyframe that sets zoom, x, y or rotate away from rest (zoom 1, x 0, y 0, rotate 0), or a shake with an amount above 0';

// ---- the pure pieces ---------------------------------------------------------------------------

test('shakeOffset is identical across two calls, in any order, and differs across seeds', () => {
  const shake = { amount: 12, hz: 8, seed: 5 };
  const first = [0, 0.3, 1.07, 2.5].map((t) => shakeOffset(shake, t));
  const second = [2.5, 1.07, 0.3, 0].map((t) => shakeOffset(shake, t)).reverse();
  assert.deepEqual(second, first);
  const other = [0, 0.3, 1.07, 2.5].map((t) => shakeOffset({ ...shake, seed: 6 }, t));
  assert.notDeepEqual(other, first);
  assert.notDeepEqual(first[1], first[2], 'the shake moves');
});

test('shakeOffset: no shake is still, amount scales the offset, it never exceeds amount, and a step is a blend of two noise values', () => {
  assert.deepEqual(shakeOffset(undefined, 3), { sx: 0, sy: 0 });
  assert.deepEqual(shakeOffset({ amount: 0 }, 1.3), { sx: 0, sy: 0 });
  const small = shakeOffset({ amount: 5, seed: 3 }, 0.9);
  const big = shakeOffset({ amount: 10, seed: 3 }, 0.9);
  assert.ok(Math.abs(big.sx - 2 * small.sx) < 1e-9 && Math.abs(big.sy - 2 * small.sy) < 1e-9);
  for (let t = 0; t < 20; t += 0.0937) {
    const { sx, sy } = shakeOffset({ amount: 30, hz: 12, seed: 9 }, t);
    assert.ok(Math.abs(sx) <= 30 && Math.abs(sy) <= 30, `${t}: ${sx}, ${sy}`);
  }
  // At hz 2 the step is 0.5 s: at the half step the offset is the mean of the two ends, and the ends are the noise values.
  const hz2 = { amount: 10, hz: 2, seed: 4 };
  const a = shakeOffset(hz2, 1);
  const b = shakeOffset(hz2, 1.25);
  const c = shakeOffset(hz2, 1.5);
  assert.ok(Math.abs(b.sx - (a.sx + c.sx) / 2) < 1e-9 && Math.abs(b.sy - (a.sy + c.sy) / 2) < 1e-9);
  assert.notEqual(a.sx, a.sy, 'x and y use different noise');
});

test('shakeOffset: the defaults are hz 8 and seed 1; the x and y noise are different generators', () => {
  assert.equal(SHAKE_HZ, 8);
  assert.equal(SHAKE_SEED, 1);
  assert.deepEqual(shakeOffset({ amount: 9 }, 0.77), shakeOffset({ amount: 9, hz: 8, seed: 1 }, 0.77));
  assert.notDeepEqual(shakeOffset({ amount: 9 }, 0.77), shakeOffset({ amount: 9, hz: 4 }, 0.77));
});

test('cameraTransform: rest, a pose, the pan and roll order, and the shake in front', () => {
  assert.equal(cameraTransform({}, undefined, 0), 'translate(0px, 0px) scale(1) translate(0px, 0px) rotate(0deg)');
  assert.equal(cameraTransform({ zoom: 1.5, x: 40, y: -20, rotate: 3 }, undefined, 2), 'translate(0px, 0px) scale(1.5) translate(-40px, 20px) rotate(3deg)');
  const { sx, sy } = shakeOffset({ amount: 7, seed: 2 }, 0.6);
  const shaken = cameraTransform({ zoom: 1 }, { amount: 7, seed: 2 }, 0.6);
  assert.equal(shaken, `translate(${+sx.toFixed(4)}px, ${+sy.toFixed(4)}px) scale(1) translate(0px, 0px) rotate(0deg)`);
});

test('the zoom range is 0.5 to 3', () => {
  assert.deepEqual([MIN_ZOOM, MAX_ZOOM], [0.5, 3]);
});

test('cameraTweens lists the spans in which a property changes value (zoom as scale); equal values are no motion; cameraSpans adds the whole scene for a shake', () => {
  const camera = { keyframes: [{ t: 0, zoom: 1, x: 0 }, { t: 1, y: 5 }, { t: 2, zoom: 1.2, x: 40 }] };
  assert.deepEqual(cameraTweens(camera), [[0, 2], [0, 2]], 'zoom, then x');
  assert.deepEqual(cameraTweens(camera, ['scale']), [[0, 2]]);
  assert.deepEqual(cameraTweens(camera, ['x', 'y', 'scale', 'rotate', 'opacity']), [[0, 2], [0, 2]], 'x and scale; y has one keyframe, rotate none, opacity is not a camera property');
  assert.deepEqual(cameraTweens({ keyframes: [{ t: 0, zoom: 1.1 }, { t: 9, zoom: 1.1 }] }), [], 'equal values do not move');
  assert.deepEqual(cameraTweens({ keyframes: [{ t: 0, zoom: 1.1 }, { t: 3, zoom: 1.1 }, { t: 5, zoom: 1.4 }] }), [[3, 5]], 'only the span that changes');
  assert.deepEqual(cameraTweens({ shake: { amount: 4 } }), []);
  assert.deepEqual(cameraTweens(undefined), []);
  assert.deepEqual(cameraSpans(camera, 4), [[0, 2], [0, 2]]);
  assert.deepEqual(cameraSpans({ keyframes: [{ t: 0, zoom: 1.1 }, { t: 3, zoom: 1.1 }] }, 4), []);
  assert.deepEqual(cameraSpans({ shake: { amount: 4 } }, 4), [[0, 4]]);
  assert.deepEqual(cameraSpans({ shake: { amount: 0 } }, 4), []);
  assert.deepEqual(cameraSpans(undefined, 4), []);
});

// ---- timeline ----------------------------------------------------------------------------------

test('the camera pose is tweened per scene: its midpoint gives the transform string, seeking back restores it, defaults are zoom 1 and no pan', () => {
  const camera = { keyframes: [{ t: 0, zoom: 1, x: 0, y: 0, rotate: 0 }, { t: 2, zoom: 1.4, x: 100, y: -60, rotate: 10 }] };
  const { timeline, states } = buildTimeline({ scenes: [scene(camera), { id: 's2', duration: 2, elements: [label('b')] }] });
  const at = (sec) => { seekTo(timeline, sec); return cameraTransform(states.get('camera:s1'), undefined, sec); };
  assert.equal(at(1), 'translate(0px, 0px) scale(1.2) translate(-50px, 30px) rotate(5deg)');
  assert.equal(at(0), 'translate(0px, 0px) scale(1) translate(0px, 0px) rotate(0deg)');
  assert.equal(at(3), 'translate(0px, 0px) scale(1.4) translate(-100px, 60px) rotate(10deg)', 'held after the last keyframe');
  assert.equal(at(1), 'translate(0px, 0px) scale(1.2) translate(-50px, 30px) rotate(5deg)', 'seeking back restores the midpoint');
  assert.equal(states.has('camera:s2'), false, 'a scene without a camera has no camera state');
  const partial = buildTimeline({ scenes: [scene({ keyframes: [{ t: 0.5, zoom: 2 }] })] });
  assert.deepEqual({ ...partial.states.get('camera:s1') }, { zoom: 2, x: 0, y: 0, rotate: 0 });
  assert.deepEqual({ ...buildTimeline({ scenes: [scene({ shake: { amount: 3 } })] }).states.get('camera:s1') }, { zoom: 1, x: 0, y: 0, rotate: 0 });
});

test('camera keyframes use their ease', () => {
  const { timeline, states } = buildTimeline({ scenes: [scene({ keyframes: [{ t: 0, zoom: 1 }, { t: 2, zoom: 2, ease: 'inQuad' }] })] });
  seekTo(timeline, 1);
  assert.ok(Math.abs(states.get('camera:s1').zoom - 1.25) < 1e-6, `inQuad(0.5) = 0.25, got ${states.get('camera:s1').zoom}`);
});

// ---- validation --------------------------------------------------------------------------------

test('a valid camera (keyframes, shake, both, or shake alone) validates', () => {
  assert.deepEqual(errs({ scenes: [scene({ keyframes: [{ t: 0, zoom: 1 }, { t: 3, zoom: 1.3, x: 20, y: -10, rotate: 2, ease: 'inOutCubic' }], shake: { amount: 6, hz: 10, seed: 7 } })] }), []);
  assert.deepEqual(errs({ scenes: [scene({ shake: { amount: 100 } })] }), []);
  assert.deepEqual(errs({ scenes: [scene({ keyframes: [{ t: 4, zoom: 0.5 }] })] }), [], 't equal to the scene end is allowed, as for elements; zoom 0.5 is the lower bound');
  assert.deepEqual(errs({ scenes: [scene({ keyframes: [{ t: 0, zoom: 3 }] })] }), []);
});

test('zoom outside 0.5 to 3 is an error that says the range', () => {
  assert.deepEqual(errs({ scenes: [scene({ keyframes: [{ t: 0, zoom: 0.4 }] })] }), ['scenes[0].camera.keyframes[0].zoom: must be >= 0.5']);
  assert.deepEqual(errs({ scenes: [scene({ keyframes: [{ t: 0, zoom: 1 }, { t: 1, zoom: 3.5 }] })] }), ['scenes[0].camera.keyframes[1].zoom: must be <= 3']);
});

test('unsorted keyframe t and t past the scene end name the fix', () => {
  assert.deepEqual(errs({ scenes: [scene({ keyframes: [{ t: 2, zoom: 1 }, { t: 1, zoom: 1.2 }] })] }),
    ['scenes[0].camera.keyframes[1].t: 1 is before previous keyframe t=2; keyframes must be sorted by t']);
  assert.deepEqual(errs({ scenes: [scene({ keyframes: [{ t: 0, zoom: 1 }, { t: 4.5, zoom: 1.2 }] })] }),
    ['scenes[0].camera.keyframes[1].t: 4.5 exceeds scene duration 4']);
});

test('an unknown key at any level lists what is allowed', () => {
  assert.match(errs({ scenes: [scene({ keyframes: [{ t: 0 }], zoomm: 2 })] }).join('\n'), /^scenes\[0\]\.camera\.zoomm: unknown property; allowed: keyframes, shake$/);
  assert.match(errs({ scenes: [scene({ keyframes: [{ t: 0, zom: 2 }] })] }).join('\n'), /scenes\[0\]\.camera\.keyframes\[0\]\.zom: unknown property; did you mean "zoom"\?/);
  assert.match(errs({ scenes: [scene({ shake: { amount: 4, strength: 3 } })] }).join('\n'), /scenes\[0\]\.camera\.shake\.strength: unknown property; allowed: amount, hz, seed/);
});

test('the shake is checked: amount is required and 0 to 100, hz above 0, seed an integer; a camera needs keyframes or a shake', () => {
  assert.match(errs({ scenes: [scene({ shake: {} })] }).join('\n'), /scenes\[0\]\.camera\.shake\.amount: required/);
  assert.match(errs({ scenes: [scene({ shake: { amount: 101 } })] }).join('\n'), /scenes\[0\]\.camera\.shake\.amount: must be <= 100/);
  assert.match(errs({ scenes: [scene({ shake: { amount: -1 } })] }).join('\n'), /scenes\[0\]\.camera\.shake\.amount: must be >= 0/);
  assert.match(errs({ scenes: [scene({ shake: { amount: 5, hz: 0 } })] }).join('\n'), /scenes\[0\]\.camera\.shake\.hz: /);
  assert.match(errs({ scenes: [scene({ shake: { amount: 5, seed: 1.5 } })] }).join('\n'), /scenes\[0\]\.camera\.shake\.seed: must be integer/);
  for (const idle of [{}, { keyframes: [] }, { shake: { amount: 0 } }, { keyframes: [{ t: 0 }] }, { keyframes: [{ t: 0, ease: 'linear' }], shake: { amount: 0, hz: 4 } },
    { keyframes: [{ t: 0, zoom: 1 }] }, { keyframes: [{ t: 0, x: 0 }] }, { keyframes: [{ t: 0, zoom: 1, x: 0, y: 0, rotate: 0 }, { t: 3, zoom: 1, rotate: 0 }] },
    { keyframes: [{ t: 0, zoom: 1 }], shake: { amount: 0 } }]) {
    assert.deepEqual(errs({ scenes: [scene(idle)] }), [`scenes[0].camera: ${NOTHING}`], JSON.stringify(idle));
  }
  assert.deepEqual(errs({ scenes: [scene({ keyframes: [{ t: 0 }], shake: { amount: 2 } })] }), [], 'a shake alone is enough');
  assert.deepEqual(errs({ scenes: [scene({ keyframes: [{ t: 0, x: 1 }] })] }), [], 'a keyframe that sets a property away from rest is enough');
  assert.deepEqual(errs({ scenes: [scene({ keyframes: [{ t: 0, zoom: 1.1 }] })] }), [], 'so is a held crop');
  assert.deepEqual(errs({ scenes: [scene({ keyframes: [{ t: 0, zoom: 1 }, { t: 3, zoom: 1.2 }] })] }), [], 'or a move that leaves rest later');
  assert.match(errs({ scenes: [scene({ keyframes: [{ t: 0, ease: 'bouncy' }] })] }).join('\n'), /scenes\[0\]\.camera\.keyframes\[0\]\.ease: must be one of/);
});

test('the seed is 0 to 7918, so no seed shares a noise stream with another (the y stream of seed s is the x stream of seed s + 7919)', () => {
  assert.deepEqual(errs({ scenes: [scene({ shake: { amount: 5, seed: 0 } })] }), []);
  assert.deepEqual(errs({ scenes: [scene({ shake: { amount: 5, seed: 7918 } })] }), []);
  assert.match(errs({ scenes: [scene({ shake: { amount: 5, seed: 7919 } })] }).join('\n'), /scenes\[0\]\.camera\.shake\.seed: must be <= 7918/);
  assert.match(errs({ scenes: [scene({ shake: { amount: 5, seed: -1 } })] }).join('\n'), /scenes\[0\]\.camera\.shake\.seed: must be >= 0/);
  const xs = new Set();
  for (let seed = 0; seed <= 7918; seed += 97) { const { sx, sy } = shakeOffset({ amount: 10, seed }, 0.3); xs.add(sx); xs.add(sy); }
  assert.equal(xs.size, 2 * Math.ceil(7919 / 97), 'every seed and axis gives its own value');
});

test('element keyframe errors keep their order: each keyframe\'s own errors, then the next keyframe\'s', () => {
  const text = (keyframes) => ({ id: 'x', type: 'text', text: 'x', x: 10, y: 10, keyframes });
  const e = errs({ scenes: [{ id: 's', duration: 4, elements: [text([{ t: 2 }, { t: 1, value: 3 }, { t: 3, value: 4 }])] }] });
  assert.deepEqual(e.map((m) => m.split(':')[0]), ['scenes[0].elements[0].keyframes[1].value', 'scenes[0].elements[0].keyframes[1].t', 'scenes[0].elements[0].keyframes[2].value']);
});

test('withDefaults keeps the camera as written and a spec without one is unchanged', () => {
  const camera = { keyframes: [{ t: 0, zoom: 1.1 }], shake: { amount: 2 } };
  assert.deepEqual(withDefaults({ scenes: [scene(camera)] }).scenes[0].camera, camera);
  assert.equal('camera' in withDefaults({ scenes: [{ id: 's', duration: 1, elements: [label('a')] }] }).scenes[0], false);
});

// ---- the sheet and the viral change rule -------------------------------------------------------

test('the contact sheet samples a camera keyframe landing like an element keyframe', () => {
  const plain = { id: 's', duration: 4, elements: [label('a')] };
  assert.equal(sheetTimes(plain, 30).some((t) => Math.abs(t - 1.6) < 1e-6), false);
  assert.ok(sheetTimes({ ...plain, camera: { keyframes: [{ t: 0, zoom: 1 }, { t: 1.5, zoom: 1.2 }] } }, 30).some((t) => Math.abs(t - 1.6) < 1e-6));
});

test('viral change gaps: a camera tween or a shake is change all through its span', () => {
  const still = { id: 's', duration: 8, elements: [label('a')] };
  assert.deepEqual(changeGaps({ scenes: [still] }), [{ from: 0, to: 8 }]);
  assert.deepEqual(changeGaps({ scenes: [{ ...still, camera: { keyframes: [{ t: 0, zoom: 1 }, { t: 8, zoom: 1.1 }] } }] }), []);
  assert.deepEqual(changeGaps({ scenes: [{ ...still, camera: { shake: { amount: 3 } } }] }), []);
  assert.deepEqual(changeGaps({ scenes: [{ ...still, camera: { keyframes: [{ t: 0, zoom: 1.1 }] } }] }), [{ from: 0, to: 8 }], 'a held camera is not change');
  assert.deepEqual(changeGaps({ scenes: [{ ...still, camera: { keyframes: [{ t: 0, zoom: 1.1 }, { t: 8, zoom: 1.1 }] } }] }), [{ from: 0, to: 8 }], 'nor is one held with two equal keyframes');
});

// ---- the page ----------------------------------------------------------------------------------

// Runs in the page: for each of `secs`, [layer transform, camera transform] of every scene layer (null camera: none).
const READ_CAMERAS = async (secs) => {
  const out = [];
  for (const sec of secs) {
    await window.__motion.seek(sec);
    out.push([...document.getElementById('stage').querySelectorAll(':scope > .scene')].map((layer) => {
      const camera = layer.querySelector(':scope > .camera');
      return [layer.style.transform, camera ? camera.style.transform : null];
    }));
  }
  return out;
};
const camerasAt = (motion, ...secs) => probed(motion, `(${READ_CAMERAS})(${JSON.stringify(secs)})`);

// Runs in the page: the structure the camera must keep.
const READ_STRUCTURE = () => {
  const stage = document.getElementById('stage');
  const layer = stage.querySelector(':scope > .scene');
  const camera = layer.querySelector(':scope > .camera');
  const count = (selector) => document.querySelectorAll(selector).length;
  return {
    cameraInLayer: camera !== null,
    elsInCamera: camera ? camera.querySelectorAll(':scope > .el').length : 0,
    elsInLayer: layer.querySelectorAll(':scope > .el').length,
    artInCamera: camera ? camera.querySelectorAll(':scope > .art').length : 0,
    artInLayer: layer.querySelectorAll(':scope > .art').length,
    grainOutside: stage.querySelectorAll(':scope > .grain').length,
    grainInside: count('.camera .grain'),
    vignetteOutside: stage.querySelectorAll(':scope > .vignette').length,
    vignetteInside: count('.camera .vignette'),
    captionsInside: count('.camera .captions'),
    cameraWillChange: camera ? getComputedStyle(camera).willChange : null,
    elWillChange: getComputedStyle(document.querySelector('.el')).willChange,
    layerOverflow: getComputedStyle(layer).overflow,
  };
};

test('a scene with a camera holds its elements in a .camera node inside the layer; one without has no such node', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const camera = await probed({ size: SIZE, scenes: [scene({ keyframes: [{ t: 0, zoom: 1.2 }] })] }, `(${READ_STRUCTURE})()`);
  assert.equal(camera.cameraInLayer, true);
  assert.equal(camera.elsInCamera, 1);
  assert.equal(camera.elsInLayer, 0);
  assert.equal(camera.layerOverflow, 'hidden', 'a zoomed camera never spills out of its layer (a pushed layer would show it)');
  const plain = await probed({ size: SIZE, scenes: [scene(undefined)] }, `(${READ_STRUCTURE})()`);
  assert.equal(plain.cameraInLayer, false);
  assert.equal(plain.elsInLayer, 1);
  assert.equal(plain.layerOverflow, 'visible');
});

test('render mode adds no will-change for the camera; grain and vignette sit outside it; a background plate stays on the layer', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const spec = { size: SIZE, texture: { grain: 0.05, vignette: true }, scenes: [scene({ keyframes: [{ t: 0, zoom: 1.2 }] }), { id: 's2', duration: 2, background: 'art', camera: { shake: { amount: 4 } }, elements: [label('b')] }] };
  const first = await probed(spec, `(${READ_STRUCTURE})()`);
  assert.equal(first.cameraWillChange, 'auto');
  assert.equal(first.elWillChange, 'auto');
  assert.equal(first.grainInside, 0);
  assert.equal(first.vignetteInside, 0);
  assert.equal(first.grainOutside, 2);
  assert.equal(first.vignetteOutside, 1);
  const art = await probed({ ...spec, scenes: [spec.scenes[1]] }, `(${READ_STRUCTURE})()`);
  assert.equal(art.artInCamera, 0, 'the art plate is the scene background: it stays on the layer, so the camera never uncovers the stage colour');
  assert.equal(art.artInLayer, 1);
  const still = await probed({ size: SIZE, scenes: [{ id: 'a', duration: 2, background: 'art', elements: [label('b')] }] }, `(${READ_STRUCTURE})()`);
  assert.equal(still.artInLayer, 1, 'without a camera the plate is where it always was');
});

test('the camera and a transition act on different nodes: the layer keeps the transition transform, the camera node its own', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const spec = { size: SIZE, scenes: [
    { id: 'a', duration: 3, elements: [label('a')] },
    { id: 'b', duration: 3, transition: { type: 'slide', direction: 'left', duration: 1 }, camera: { keyframes: [{ t: 0, zoom: 1.4 }, { t: 3, zoom: 1.4 }] }, elements: [label('b')] }] };
  const [mid, later] = await camerasAt(spec, 3.5, 5);
  assert.deepEqual(mid, [['', null], ['translate(-240px, 0px)', 'translate(0px, 0px) scale(1.4) translate(0px, 0px) rotate(0deg)']]);
  assert.deepEqual(later, [['', null], ['', 'translate(0px, 0px) scale(1.4) translate(0px, 0px) rotate(0deg)']]);
});

test('the camera node is posed from the tween and the shake at the scene time, and is the same when seeked back', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const spec = { size: SIZE, scenes: [{ id: 'a', duration: 3, elements: [label('a')] },
    scene({ keyframes: [{ t: 0, zoom: 1 }, { t: 2, zoom: 1.4 }], shake: { amount: 6, seed: 3 } }, { id: 'b' })] };
  const [a, b, c] = await camerasAt(spec, 4, 4, 5);
  assert.deepEqual(a, b);
  const sceneT = (sec) => sec - 3;
  const expect = (sec, zoom) => cameraTransform({ zoom }, { amount: 6, seed: 3 }, sceneT(sec));
  assert.equal(a[1][1], expect(4, 1.2));
  assert.equal(c[1][1], expect(5, 1.4));
});

// RGB at each [x, y] of a PNG buffer, decoded in a browser page.
async function pixelsOf(png, points) {
  const browser = await launchBrowser({ quiet: true });
  try {
    const page = await browser.newPage();
    return await page.evaluate(async ([url, spots]) => {
      const img = new Image();
      img.src = url;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      return spots.map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data].slice(0, 3));
    }, [`data:image/png;base64,${png.toString('base64')}`, points]);
  } finally { await browser.close(); }
}
const CORNERS = [[2, 2], [SIZE[0] - 3, 2], [2, SIZE[1] - 3], [SIZE[0] - 3, SIZE[1] - 3]];
const BLUE = [51, 102, 153];

test('zooming out below 1 or panning never shows a gap: the scene background stays on the layer', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const out = await framed({ size: SIZE, background: '#000000', scenes: [{ id: 's', duration: 2, background: '#336699', camera: { keyframes: [{ t: 0, zoom: 0.6 }] }, elements: [label('a')] }] }, 1);
  assert.deepEqual(await pixelsOf(out, CORNERS), CORNERS.map(() => BLUE), 'zoom 0.6');
  const pan = await framed({ size: SIZE, background: '#000000', scenes: [{ id: 's', duration: 2, background: '#336699', camera: { keyframes: [{ t: 0, zoom: 1, x: 300, y: -120, rotate: 20 }] }, elements: [label('a')] }] }, 1);
  assert.deepEqual(await pixelsOf(pan, CORNERS), CORNERS.map(() => BLUE), 'pan and roll');
  const spec = { size: SIZE, background: '#000000', scenes: [
    { id: 'a', duration: 3, background: '#aa0000', elements: [label('a')] },
    { id: 'b', duration: 3, background: '#336699', transition: { type: 'slide', direction: 'left', duration: 1 }, camera: { keyframes: [{ t: 0, zoom: 0.6 }] }, elements: [label('b')] }] };
  const mid = await framed(spec, 3.5); // b covers the left half, its zoomed content in the middle of its own layer
  assert.deepEqual(await pixelsOf(mid, [[230, 4], [230, SIZE[1] - 4], [400, 4]]), [BLUE, BLUE, [170, 0, 0]], 'inside a slide window');
  const bare = await framed({ size: SIZE, background: '#000000', scenes: [{ id: 'b', duration: 2, camera: { keyframes: [{ t: 0, zoom: 0.6 }] }, elements: [label('b')] }] }, 1);
  assert.deepEqual((await pixelsOf(bare, [[2, 2]]))[0], [0, 0, 0], 'with no scene background the stage colour shows, as it always did');
});

// The edge and corner pixels of a canvas of SIZE, inset by 2: the places a gap would show first.
const EDGES = [...CORNERS, [SIZE[0] / 2, 2], [SIZE[0] / 2, SIZE[1] - 3], [2, SIZE[1] / 2], [SIZE[0] - 3, SIZE[1] / 2]];
const MAGENTA = [255, 0, 255];

test('an art background with a camera never shows the stage colour at the edges, whatever the pan, roll, zoom out or shake', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const art = (camera) => ({ size: SIZE, background: '#ff00ff', scenes: [{ id: 's', duration: 4, background: 'art', camera, elements: [label('a')] }] });
  const cameras = {
    pan: { keyframes: [{ t: 0, x: 200 }] },
    shake: { shake: { amount: 30, hz: 6, seed: 2 } },
    'zoom out': { keyframes: [{ t: 0, zoom: 0.6 }] },
    roll: { keyframes: [{ t: 0, rotate: 25 }] },
    'everything': { keyframes: [{ t: 0, zoom: 0.7, x: 150, y: -90, rotate: 15 }, { t: 3, zoom: 1.2, x: -150, y: 90, rotate: -15 }], shake: { amount: 30, hz: 6, seed: 2 } },
  };
  for (const [name, camera] of Object.entries(cameras)) {
    for (const sec of [0.4, 1.7, 3.2]) {
      const hits = (await pixelsOf(await framed(art(camera), sec), EDGES)).filter((rgb) => rgb.join() === MAGENTA.join());
      assert.equal(hits.length, 0, `${name} at ${sec}s shows the stage colour at ${hits.length} edge points`);
    }
  }
  // Inside a slide window the incoming art layer must not let the outgoing scene (red) or the stage show through either.
  const window = { size: SIZE, background: '#ff00ff', scenes: [
    { id: 'a', duration: 3, background: '#aa0000', elements: [label('a')] },
    { id: 'b', duration: 3, background: 'art', transition: { type: 'slide', direction: 'left', duration: 1 }, camera: { keyframes: [{ t: 0, zoom: 0.6, x: 100 }] }, elements: [label('b')] }] };
  const [left] = await pixelsOf(await framed(window, 3.5), [[230, 4]]);
  assert.notDeepEqual(left, MAGENTA);
  assert.notDeepEqual(left, [170, 0, 0]);
});

test('captions are outside the camera: they stay put while it moves', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const dir = mkdtempSync(path.join(tmpdir(), 'camera-cap-'));
  const spec = { size: SIZE, captions: [{ src: 'c.srt' }], scenes: [scene({ keyframes: [{ t: 0, zoom: 1, x: 0 }, { t: 3, zoom: 1.6, x: 120 }], shake: { amount: 20 } })] };
  writeFileSync(path.join(dir, 'motion.json'), JSON.stringify(spec));
  writeFileSync(path.join(dir, 'c.srt'), '1\n00:00:00,000 --> 00:00:04,000\nHello camera\n');
  const server = await startServer({ specPath: path.join(dir, 'motion.json'), mode: 'render' });
  const browser = await launchBrowser({ quiet: true });
  try {
    const page = await browser.newPage({ viewport: { width: SIZE[0], height: SIZE[1] }, deviceScaleFactor: 1 });
    await page.goto(server.url);
    await page.waitForFunction(() => window.__motion);
    await page.evaluate(() => window.__motion.ready);
    const read = (sec) => page.evaluate(async (s) => {
      await window.__motion.seek(s);
      const node = document.querySelector('#stage > .captions');
      const r = node.getBoundingClientRect();
      return { box: [r.left, r.top, r.right, r.bottom], inside: document.querySelectorAll('.camera .captions').length, camera: document.querySelector('.camera').style.transform };
    }, sec);
    const [early, late] = [await read(0.5), await read(2.5)];
    assert.notEqual(early.camera, late.camera, 'the camera moved');
    assert.deepEqual(late.box, early.box);
    assert.equal(early.inside, 0);
  } finally { await browser.close(); await server.close(); }
});

// ---- check.mjs: the boxes include the camera ---------------------------------------------------

const wide = (elements, camera, extra = {}) => ({ size: [1920, 1080], fps: 30, scenes: [{ id: 's', duration: 4, elements, ...(camera ? { camera } : {}), ...extra }] });
const nearTop = (extra = {}) => ({ id: 'top', type: 'text', text: 'Near the top', x: 960, y: 93, fontSize: 40, ...extra }); // its box starts about 70 px from the top

test('check: a text 70 px from the top is fine until a held zoom of 1.2 pushes it out of the safe area (top)', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const plain = verdict(wide([nearTop(), label('mid', { x: 960, y: 540, hold: true })], undefined));
  assert.deepEqual(messages(plain.errors), [], 'without a camera the text is inside the safe area');
  const zoomed = verdict(wide([nearTop(), label('mid', { x: 960, y: 540, hold: true })], { keyframes: [{ t: 0, zoom: 1.2 }] }));
  assert.equal(zoomed.ok, false);
  assert.match(messages(zoomed.errors).join('\n'), /text "top" leaves the safe area \(top\) at \d\.\d\ds/);
});

test('check: a camera push-in that clips the text only mid-move is not a finding (the camera moving counts as the element moving)', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  // At zoom 1.25 the text's top edge is 47 px above the canvas but its bottom edge is still on it (clipped, not gone).
  const out = [{ t: 0, zoom: 1 }, { t: 2, zoom: 1.25 }, { t: 4, zoom: 1 }];
  const pushed = verdict(wide([nearTop(), label('mid', { x: 960, y: 540, hold: true })], { keyframes: out }));
  assert.equal(pushed.ok, true, messages(pushed.errors).join('\n'));
  // The same text with the zoom held at the peak is flagged, so the rule did see it there.
  const held = verdict(wide([nearTop(), label('mid', { x: 960, y: 540, hold: true })], { keyframes: [{ t: 0, zoom: 1.25 }, { t: 4, zoom: 1.25 }] }));
  assert.match(messages(held.errors).join('\n'), /leaves the safe area \(top\)/);
});

test('check: two texts that only overlap while the camera rolls are not an overlap; the same roll held is', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  // Two wide lines 60 px apart (boxes 46 px tall) clear each other at rest; rolled 25 degrees about the canvas centre
  // their axis-aligned boxes cross.
  const line = (id, y) => label(id, { text: 'a wide line of words', x: 960, y, fontSize: 40, hold: true });
  const pair = [line('one', 500), line('two', 560)];
  const rolled = verdict(wide(pair, { keyframes: [{ t: 0, rotate: 0 }, { t: 2, rotate: 25 }, { t: 4, rotate: 0 }] }));
  assert.equal(rolled.ok, true, messages(rolled.errors).join('\n'));
  const held = verdict(wide(pair, { keyframes: [{ t: 0, rotate: 25 }, { t: 4, rotate: 25 }] }));
  assert.match(messages(held.errors).join('\n'), /text "two" overlaps text "one"/);
});

test('check: a camera pan or a shake over still elements is change, not a dead stretch', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const still = [label('mid', { x: 960, y: 540, fontSize: 60 })];
  const base = (camera) => ({ size: [1920, 1080], fps: 30, scenes: [{ id: 's', duration: 9, elements: still, ...(camera ? { camera } : {}) }] });
  assert.match(messages(verdict(base()).errors).join('\n'), /nothing changes from 0\.00s to /);
  const pan = verdict(base({ keyframes: [{ t: 0, x: -100 }, { t: 8, x: 0 }] }));
  assert.equal(pan.ok, true, messages(pan.errors).join('\n'));
  const shake = verdict(base({ shake: { amount: 8 } }));
  assert.equal(shake.ok, true, messages(shake.errors).join('\n'));
  const held = verdict(base({ keyframes: [{ t: 0, zoom: 1.1 }] }));
  assert.match(messages(held.errors).join('\n'), /nothing changes from 0\.00s to /, 'a held camera is not change');
});

test('check: a scene that is only an art plate under a panning camera is moving, not a dead stretch; a held camera over it still is', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const art = (camera) => ({ size: [1920, 1080], fps: 30, scenes: [{ id: 's', duration: 9, background: 'art', elements: [], camera }] });
  const pan = verdict(art({ keyframes: [{ t: 0, x: -100 }, { t: 8, x: 0 }] }));
  assert.equal(pan.ok, true, messages(pan.errors).join('\n'));
  const shake = verdict(art({ shake: { amount: 8 } }));
  assert.equal(shake.ok, true, messages(shake.errors).join('\n'));
  assert.match(messages(verdict(art({ keyframes: [{ t: 0, zoom: 1.1 }] })).errors).join('\n'), /nothing changes from 0\.00s to /);
});

test('check: small text under a slow push-in is still judged by the text floor at the size it is drawn', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const fine = label('fine', { x: 960, y: 540, fontSize: 18, hold: true });
  const plain = verdict(wide([fine], undefined));
  assert.match(messages(plain.errors).join('\n'), /text "fine" is 18px \(below 28px at 1080\); shown 4\.00s/);
  const pushed = verdict(wide([fine], { keyframes: [{ t: 0, zoom: 1 }, { t: 4, zoom: 1.05 }] }));
  assert.match(messages(pushed.errors).join('\n'), /text "fine" is 1[89]px \(below 28px at 1080\); shown 4\.00s/);
});

test('check: a camera move is exempt while it runs, as an element\'s own move is: a reveal pan or a push out from a tight zoom is not a finding where it starts part-way clipped, but where it settles is', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  // At zoom 1.3 the text (box 127-173 px from the top at zoom 1) sits about 5 px from the top edge: on canvas, inside the margin.
  const text = [label('top', { x: 960, y: 150, fontSize: 40, hold: true })];
  const opening = verdict(wide(text, { keyframes: [{ t: 0, zoom: 1.3 }, { t: 3.5, zoom: 1, ease: 'inOutQuad' }] }));
  assert.equal(opening.ok, true, 'a push out that starts clipped: ' + messages(opening.errors).join('\n'));
  const settled = verdict(wide(text, { keyframes: [{ t: 0, zoom: 1 }, { t: 3.5, zoom: 1.3, ease: 'inOutQuad' }] }));
  assert.match(messages(settled.errors).join('\n'), /text "top" leaves the safe area \(top\) at 3\.[6-9]\ds/, 'once the camera settles, as before');
  const mid = verdict(wide(text, { keyframes: [{ t: 0, zoom: 1 }, { t: 2, zoom: 1.3 }, { t: 4, zoom: 1 }] }));
  assert.equal(mid.ok, true, 'an excursion between two clean poses: ' + messages(mid.errors).join('\n'));
  // A reveal pan: a label on the right starts part-way in frame (right edge past the safe margin) and the pan lands it
  // inside; the same label where the pan ends clipped is a finding.
  const ship = [label('ship', { x: 1440, y: 540, fontSize: 56, hold: true })];
  const reveal = verdict(wide(ship, { keyframes: [{ t: 0, x: -420 }, { t: 2.5, x: 0, ease: 'outCubic' }] }));
  assert.equal(reveal.ok, true, 'a reveal pan: ' + messages(reveal.errors).join('\n'));
  const short = verdict(wide(ship, { keyframes: [{ t: 0, x: -420 }, { t: 2.5, x: -400, ease: 'outCubic' }] }));
  assert.match(messages(short.errors).join('\n'), /text "ship" leaves the safe area \(right\)/);
  // The element's own entrance from the same place is exempt in the same way (the rule this one matches).
  const own = verdict(wide([label('ship', { x: 1440, y: 540, fontSize: 56, hold: true, keyframes: [{ t: 0, x: 1860 }, { t: 2.5, x: 1440, ease: 'outCubic' }] })], undefined));
  assert.equal(own.ok, true, 'the element\'s own move: ' + messages(own.errors).join('\n'));
});

test('check: a camera held with equal-value keyframes is held, not moving: a dead stretch is still reported and the held pose is judged from the first moment', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const equal = [{ t: 0, zoom: 1.1 }, { t: 9, zoom: 1.1 }];
  const text = [label('mid', { x: 960, y: 540, fontSize: 60 })];
  const still = verdict({ size: [1920, 1080], fps: 30, scenes: [{ id: 's', duration: 9, elements: text, camera: { keyframes: equal } }] });
  assert.match(messages(still.errors).join('\n'), /nothing changes from 0\.00s to /, 'still text');
  const art = verdict({ size: [1920, 1080], fps: 30, scenes: [{ id: 's', duration: 9, background: 'art', elements: [], camera: { keyframes: equal } }] });
  assert.match(messages(art.errors).join('\n'), /nothing changes from 0\.00s to /, 'art only');
  const pan = verdict({ size: [1920, 1080], fps: 30, scenes: [{ id: 's', duration: 9, background: 'art', elements: [], camera: { keyframes: [{ t: 0, x: 0 }, { t: 2, x: 0 }, { t: 8, x: -100 }] } }] });
  assert.equal(pan.ok, true, 'a hold followed by a real pan is moving from the pan on, and the hold is under 3 s: ' + messages(pan.errors).join('\n'));
  // The held pose is judged where it is, not only at the last frame.
  const clipped = verdict(wide([nearTop(), label('mid', { x: 960, y: 540, hold: true })], { keyframes: [{ t: 0, zoom: 1.25 }, { t: 4, zoom: 1.25 }] }));
  assert.match(messages(clipped.errors).join('\n'), /text "top" leaves the safe area \(top\) at 0\.10s/);
});

test('check: the camera on the first scene of a viral spec keeps the hook at frame 0 (no hook warning, exit 0)', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const hook = { id: 'hook', type: 'text', text: 'Watch this one trick', x: 502, y: 600, fontSize: 72, fontWeight: 700 };
  const spec = { mode: 'viral', fps: 30, scenes: [
    { id: 'a', duration: 2.5, camera: { keyframes: [{ t: 0, zoom: 1.3 }, { t: 2.2, zoom: 1 }] }, elements: [hook] },
    { id: 'b', duration: 2, elements: [{ ...hook, id: 'again', keyframes: [{ t: 0, x: 480 }, { t: 1.9, x: 520 }] }] }] };
  const result = runCheck(spec);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const said = messages(JSON.parse(result.stdout).warnings);
  // The camera starts at zoom 1.3; it must not hide the hook or make the scene blank.
  assert.deepEqual(said.filter((m) => /no hook text|has \d+ words|thumbnail/.test(m)), []);
});

// ---- the example -------------------------------------------------------------------------------

test('references/examples/camera-push-in.json validates, uses zoom, pan, roll and shake, and passes check with no output on stderr', async (t) => {
  const spec = loadSpec(EXAMPLE).spec;
  assert.deepEqual(validateSpec(spec, { dir: path.dirname(EXAMPLE) }).errors, []);
  const cameras = spec.scenes.map((s) => s.camera).filter(Boolean);
  const props = new Set(cameras.flatMap((c) => (c.keyframes ?? []).flatMap((kf) => Object.keys(kf))));
  for (const prop of ['zoom', 'x', 'rotate']) assert.ok(props.has(prop), `the example moves ${prop}`);
  assert.ok(cameras.some((c) => c.shake), 'the example shakes');
  assert.ok(spec.scenes.reduce((n, s) => n + s.duration, 0) <= 15);
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const r = spawnSync(process.execPath, [CHECK, EXAMPLE], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.stderr, '');
});

test('camera-push-in.json renders byte-identical twice', async (t) => {
  if (!(await requireRender(t))) return;
  await assertRendersIdentically(t, EXAMPLE, ['--fps', '10', '--size', '320x180']);
});

test('a camera together with a slide transition, grain and a vignette renders byte-identical twice', async (t) => {
  if (!(await requireRender(t))) return;
  const file = specFile({ size: [320, 180], fps: 30, texture: { grain: 0.05, vignette: true }, scenes: [
    { id: 'a', duration: 1, background: '#10243a', camera: { keyframes: [{ t: 0, zoom: 1 }, { t: 1, zoom: 1.3, rotate: 4 }], shake: { amount: 5 } }, elements: [label('first', { x: 160, y: 60, fontSize: 28 })] },
    { id: 'b', duration: 1.2, background: '#3a1f33', transition: { type: 'slide', direction: 'left', duration: 0.6 }, camera: { keyframes: [{ t: 0, zoom: 0.7, x: 40 }, { t: 1, zoom: 1 }] }, elements: [label('second', { x: 160, y: 120, fontSize: 28 })] }] });
  await assertRendersIdentically(t, file, ['--fps', '10', '--size', '320x180']);
});
