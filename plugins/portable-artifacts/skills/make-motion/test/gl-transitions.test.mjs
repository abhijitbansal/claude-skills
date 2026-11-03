// Task 29 (ship path): gl-ripple and gl-cube. The names, the uniform maths and the shader sources are pure
// (template/gl-transitions.mjs); a render draws the two scene layers separately and a software-GL page composes them
// (scripts/lib/gl-composite.mjs). The spike (webgl-spike.test.mjs) showed the swiftshader frame hashes the same on macOS and
// Ubuntu; these tests hold the transitions to the same standard: byte-identical twice and across --workers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { GL_TRANSITIONS, isGlTransition, glDirections, glFallback, glUniforms, glFragment, GL_VERTEX, usesGl } from '../template/gl-transitions.mjs';
import { TRANSITIONS, normalizeTransition, directionsOf, comesInOver, windowSeconds, layerStyles } from '../template/transitions.mjs';
import { buildTimeline, seekTo } from '../template/timeline.mjs';
import { validateSpec, withDefaults, loadSpec } from '../scripts/lib/spec.mjs';
import { createCompositor, takeFrame } from '../scripts/lib/gl-composite.mjs';
import { launchBrowser } from '../scripts/lib/browser.mjs';
import { startServer } from '../scripts/lib/server.mjs';
import { requireRender, renderHash, assertRendersIdentically, BROWSER_ONLY } from './helpers/render.mjs';
import { makePng } from './helpers/png.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLE = path.join(root, 'references/examples/gl-transitions.json');
const RENDER = path.join(root, 'scripts/render.mjs');
const CHECK = path.join(root, 'scripts/check.mjs');
const VALIDATE = path.join(root, 'scripts/validate.mjs');
const SMALL = ['--fps', '10', '--size', '320x180'];
const label = (id, extra = {}) => ({ id, type: 'text', text: id, x: 240, y: 135, fontSize: 40, ...extra });
const pair = (second = {}, first = {}) => [
  { id: 's1', duration: 3, elements: [label('a')], ...first },
  { id: 's2', duration: 3, elements: [label('b')], ...second },
];
const errs = (motion) => validateSpec(motion).errors.map((e) => `${e.path}: ${e.message}`);

// ---- the pure pieces ---------------------------------------------------------------------------

test('GL_TRANSITIONS names gl-ripple and gl-cube; TRANSITIONS stays the nine CSS names', () => {
  assert.deepEqual([...GL_TRANSITIONS], ['gl-ripple', 'gl-cube']);
  assert.deepEqual([...TRANSITIONS], ['none', 'fade', 'crossfade', 'push', 'slide', 'wipe', 'zoom', 'blur', 'iris']);
  assert.equal(isGlTransition('gl-cube'), true);
  assert.equal(isGlTransition('push'), false);
  assert.equal(isGlTransition('constructor'), false);
});

test('normalizeTransition reads the GL names: gl-ripple takes no direction, gl-cube an edge (left by default)', () => {
  assert.deepEqual(normalizeTransition('gl-ripple'), { type: 'gl-ripple', direction: null, duration: 0.4 });
  assert.deepEqual(normalizeTransition({ type: 'gl-ripple', direction: 'left', duration: 1 }), { type: 'gl-ripple', direction: null, duration: 1 });
  assert.deepEqual(normalizeTransition('gl-cube'), { type: 'gl-cube', direction: 'left', duration: 0.4 });
  assert.deepEqual(normalizeTransition({ type: 'gl-cube', direction: 'down', duration: 0.8 }), { type: 'gl-cube', direction: 'down', duration: 0.8 });
  assert.equal(normalizeTransition({ type: 'gl-cube', direction: 'in' }).direction, 'left', 'an unknown direction falls back to the default');
  assert.deepEqual(directionsOf('gl-cube'), ['left', 'right', 'up', 'down']);
  assert.equal(directionsOf('gl-ripple'), null);
  assert.deepEqual(glDirections('gl-cube'), ['left', 'right', 'up', 'down']);
  assert.equal(glDirections('push'), null);
});

test('a GL transition comes in over the previous scene, and its window is its duration capped at the scene', () => {
  for (const type of GL_TRANSITIONS) assert.equal(comesInOver(type), true, type);
  assert.equal(windowSeconds({ transition: { type: 'gl-ripple', duration: 0.8 }, duration: 3 }, 1), 0.8);
  assert.equal(windowSeconds({ transition: 'gl-cube', duration: 0.2 }, 1), 0.2);
  assert.equal(windowSeconds({ transition: 'gl-cube', duration: 3 }, 0), 0, 'the first scene cuts');
});

test('usesGl: a scene after the first with a GL transition, by name or object, and not the first scene', () => {
  assert.equal(usesGl({ scenes: pair({ transition: 'gl-ripple' }) }), true);
  assert.equal(usesGl({ scenes: pair({ transition: { type: 'gl-cube', direction: 'up' } }) }), true);
  assert.equal(usesGl({ scenes: pair({ transition: 'push' }) }), false);
  assert.equal(usesGl({ scenes: pair({}, { transition: 'gl-ripple' }) }), false);
  assert.equal(usesGl({ scenes: pair() }), false);
  assert.equal(usesGl(withDefaults({ transition: 'gl-cube', scenes: pair() })), true, 'a root default reaches every scene after the first');
});

test('glUniforms: the cube turns 0 to 90 degrees with progress, backs away at the middle and shades the faces', () => {
  const at = (p, direction = 'left', size = [320, 180]) => glUniforms({ type: 'gl-cube', direction, p }, size);
  const start = at(0);
  assert.deepEqual([start.uSin, start.uCos, start.uPull, start.uShadeFrom, start.uShadeTo], [0, 1, 0, 1, 0.55]);
  const end = at(1);
  assert.equal(end.uSin, 1);
  assert.ok(Math.abs(end.uCos) < 1e-12 && Math.abs(end.uPull) < 1e-12);
  assert.ok(Math.abs(end.uShadeFrom - 0.55) < 1e-12 && Math.abs(end.uShadeTo - 1) < 1e-12);
  const middle = at(0.5);
  assert.ok(Math.abs(middle.uSin - Math.SQRT1_2) < 1e-12 && Math.abs(middle.uCos - Math.SQRT1_2) < 1e-12);
  assert.ok(Math.abs(middle.uPull - 0.5) < 1e-12, 'the largest pull is at the middle of the turn');
  assert.deepEqual([at(0.5, 'left').uSwap, at(0.5, 'left').uFlip], [0, 0]);
  assert.deepEqual([at(0.5, 'right').uSwap, at(0.5, 'right').uFlip], [0, 1]);
  assert.deepEqual([at(0.5, 'up').uSwap, at(0.5, 'up').uFlip], [1, 0]);
  assert.deepEqual([at(0.5, 'down').uSwap, at(0.5, 'down').uFlip], [1, 1]);
  assert.equal(at(0.5, 'left').uRatio, 180 / 320);
  assert.equal(at(0.5, 'up').uRatio, 320 / 180, 'turning about the other axis, the face is wider than it is tall');
});

test('glUniforms: progress outside 0 to 1 is clamped, and a name that is not a GL transition is refused', () => {
  assert.equal(glUniforms({ type: 'gl-ripple', direction: null, p: -3 }, [320, 180]).uP, 0);
  assert.equal(glUniforms({ type: 'gl-ripple', direction: null, p: 7 }, [320, 180]).uP, 1);
  assert.equal(glUniforms({ type: 'gl-cube', direction: 'left', p: 9 }, [320, 180]).uSin, 1);
  assert.throws(() => glUniforms({ type: 'push', direction: 'left', p: 0.5 }, [320, 180]), /"push" is not a GL transition \(gl-ripple, gl-cube\)/);
  assert.throws(() => glFragment('wipe'), /"wipe" is not a GL transition/);
});

test('every uniform glUniforms returns is declared by the fragment shader of its type (a typo would be a silent no-op)', () => {
  for (const type of GL_TRANSITIONS) {
    const source = glFragment(type);
    assert.match(source, /void main\(\)/, type);
    assert.match(source, /uniform sampler2D uFrom;/, type);
    assert.match(source, /uniform sampler2D uTo;/, type);
    assert.match(source, /uniform vec2 uRes;/, type);
    for (const name of Object.keys(glUniforms({ type, direction: normalizeTransition(type).direction, p: 0.5 }, [320, 180]))) {
      assert.match(source, new RegExp(`uniform float ${name};`), `${type} declares ${name}`);
    }
  }
  assert.match(GL_VERTEX, /gl_Position/);
});

test('layerStyles: the preview and check.mjs pose a gl-cube as a push and a gl-ripple as a crossfade of the opaque layers', () => {
  const none = { opacity: null, transform: null, clipPath: null, filter: null };
  assert.deepEqual(glFallback('gl-cube'), 'push');
  assert.deepEqual(glFallback('gl-ripple'), 'crossfade');
  assert.equal(glFallback('push'), null);
  for (const direction of ['left', 'right', 'up', 'down']) {
    assert.deepEqual(layerStyles({ type: 'gl-cube', direction }, 0.25, [480, 270]), layerStyles({ type: 'push', direction }, 0.25, [480, 270]), direction);
  }
  assert.deepEqual(layerStyles('gl-ripple', 0.3, [480, 270]), { incoming: { ...none, opacity: 0.3 }, outgoing: none });
});

// ---- validation and defaults -------------------------------------------------------------------

test('both GL names validate on a scene (not the first) and as the root default, by name and in the object form', () => {
  for (const name of GL_TRANSITIONS) {
    assert.deepEqual(errs({ scenes: pair({ transition: name }) }), [], name);
    assert.deepEqual(errs({ transition: name, scenes: pair() }), [], `root ${name}`);
    assert.deepEqual(errs({ scenes: pair({ transition: { type: name, duration: 0.8 } }) }), [], `${name} as an object`);
  }
  assert.deepEqual(errs({ scenes: pair({ transition: { type: 'gl-cube', direction: 'down', duration: 1.2 } }) }), []);
});

test('an unknown GL name is an error with a did-you-mean, and the list still starts with the nine names', () => {
  for (const [wrong, right] of [['gl-rippel', 'gl-ripple'], ['gl_cube', 'gl-cube'], ['gl-cub', 'gl-cube']]) {
    const e = errs({ scenes: pair({ transition: wrong }) });
    assert.equal(e.length, 1, wrong);
    assert.match(e[0], /^scenes\[1\]\.transition: must be one of "none", "fade", "crossfade", "push", "slide", "wipe", "zoom", "blur", "iris", "gl-ripple", "gl-cube"/, wrong);
    assert.ok(e[0].endsWith(`; did you mean "${right}"?`), `${wrong}: ${e[0]}`);
  }
  const object = errs({ scenes: pair({ transition: { type: 'gl-rippel' } }) });
  assert.match(object[0], /^scenes\[1\]\.transition\.type: must be one of .*; did you mean "gl-ripple"\?$/);
});

test('gl-cube takes an edge and says which; gl-ripple takes no direction and says to remove it', () => {
  assert.deepEqual(errs({ scenes: pair({ transition: { type: 'gl-cube', direction: 'in' } }) }),
    ['scenes[1].transition.direction: must be one of "left", "right", "up", "down" for gl-cube; got "in"']);
  assert.deepEqual(errs({ transition: { type: 'gl-cube', direction: 'sideways' }, scenes: pair() }),
    ['transition.direction: must be one of "left", "right", "up", "down" for gl-cube; got "sideways"']);
  assert.deepEqual(errs({ scenes: pair({ transition: { type: 'gl-ripple', direction: 'left' } }) }),
    ['scenes[1].transition.direction: gl-ripple takes no direction; remove it']);
  assert.equal(errs({ scenes: pair({ transition: { type: 'gl-cube', direction: 'constructor' } }) }).length, 1);
});

test('the duration of a GL transition is held to the same range as the others, and the message names the bound', () => {
  assert.match(errs({ scenes: pair({ transition: { type: 'gl-cube', duration: 0.05 } }) }).join('\n'), /scenes\[1\]\.transition\.duration: must be >= 0\.1/);
  assert.match(errs({ scenes: pair({ transition: { type: 'gl-ripple', duration: 3 } }) }).join('\n'), /scenes\[1\]\.transition\.duration: must be <= 2/);
  assert.match(errs({ scenes: pair({ transition: { type: 'gl-ripple', ease: 'linear' } }) }).join('\n'), /scenes\[1\]\.transition\.ease: unknown property/);
});

test('a GL transition on the first scene is the "needs a previous scene" error; a root default is not', () => {
  for (const name of GL_TRANSITIONS) {
    const e = errs({ scenes: pair({}, { transition: name }) });
    assert.equal(e.length, 1, name);
    assert.match(e[0], new RegExp(`^scenes\\[0\\]\\.transition: ${name} needs a previous scene to come in over; use "fade" or "none" on the first scene$`), name);
    assert.deepEqual(errs({ transition: name, scenes: pair() }), [], `root ${name}`);
  }
});

test('the root transition object is the default of every later scene, and the first scene cuts', () => {
  const root = { type: 'gl-cube', direction: 'up', duration: 0.6 };
  const d = withDefaults({ transition: root, scenes: [...pair(), { id: 's3', duration: 1, elements: [label('c')] }] });
  assert.deepEqual(d.scenes.map((s) => s.transition), ['none', root, root]);
});

// ---- timeline ----------------------------------------------------------------------------------

test('overlaps carries a GL window with its type; its progress runs 0 to 1 with inOutCubic and the opacity stays 1', () => {
  const built = buildTimeline({ scenes: pair({ transition: { type: 'gl-ripple', duration: 1 } }) });
  assert.deepEqual(built.overlaps, [{ from: 0, to: 1, start: 3, end: 4, type: 'gl-ripple' }]);
  assert.deepEqual(built.crossfades, []);
  const at = (sec) => { seekTo(built.timeline, sec); const s = built.states.get('scene:s2'); return [s.p, s.opacity]; };
  assert.deepEqual(at(3), [0, 1]);
  assert.ok(Math.abs(at(3.5)[0] - 0.5) < 1e-6);
  assert.deepEqual(at(4), [1, 1]);
});

// ---- the page ----------------------------------------------------------------------------------

// A render page on `motion` (a spec object with a size), as render.mjs opens one; `done()` closes it.
async function openPage(motion, { dir = mkdtempSync(path.join(tmpdir(), 'gl-')) } = {}) {
  const file = path.join(dir, 'm.json');
  writeFileSync(file, JSON.stringify(motion));
  const server = await startServer({ specPath: file, mode: 'render' });
  const browser = await launchBrowser({ quiet: true });
  const done = async () => { await browser.close(); await server.close(); };
  try {
    const page = await browser.newPage({ viewport: { width: motion.size[0], height: motion.size[1] }, deviceScaleFactor: 1 });
    const problems = [];
    page.on('pageerror', (e) => problems.push(e.message));
    await page.goto(server.url);
    await page.waitForFunction(() => window.__motion);
    await page.evaluate(() => window.__motion.ready);
    return { page, problems, done };
  } catch (e) { await done(); throw e; }
}

// The largest difference in any channel between two PNGs, decoded in a page (Infinity for different sizes).
async function maxDiff(a, b) {
  const browser = await launchBrowser({ quiet: true });
  try {
    const page = await browser.newPage();
    return await page.evaluate(async ([x, y]) => {
      const decode = async (b64) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        return { w: img.width, h: img.height, data: ctx.getImageData(0, 0, img.width, img.height).data };
      };
      const [p, q] = [await decode(x), await decode(y)];
      if (p.w !== q.w || p.h !== q.h) return Infinity;
      let worst = 0;
      for (let i = 0; i < p.data.length; i++) worst = Math.max(worst, Math.abs(p.data[i] - q.data[i]));
      return worst;
    }, [a.toString('base64'), b.toString('base64')]);
  } finally { await browser.close(); }
}

const SIZE = [480, 270];
const glScenes = (transition) => [
  { id: 'a', duration: 1, background: '#10243a', elements: [label('first', { x: 240, y: 90, fontSize: 36 })] },
  { id: 'b', duration: 1.5, background: '#3a1f33', transition, elements: [label('second', { x: 240, y: 180, fontSize: 36 })] },
];

test('glState is null outside a GL window and names the transition and its progress inside one; seek(sec, layer) shows that layer alone', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const { page, problems, done } = await openPage({ size: SIZE, scenes: glScenes({ type: 'gl-cube', direction: 'right', duration: 1 }) });
  try {
    const read = (sec, layer) => page.evaluate(async ([s, role]) => {
      await window.__motion.seek(s, role ?? undefined);
      const layers = [...document.getElementById('stage').querySelectorAll(':scope > .scene')].map((l) => (getComputedStyle(l).display === 'none' ? null : [l.style.opacity, l.style.transform, l.style.zIndex]));
      return { gl: window.__motion.glState(), layers };
    }, [sec, layer ?? null]);
    assert.equal((await read(0.5)).gl, null, 'before the window');
    assert.equal((await read(2.5)).gl, null, 'after the window');
    const mid = await read(1.5);
    assert.equal(mid.gl.type, 'gl-cube');
    assert.equal(mid.gl.direction, 'right');
    assert.ok(Math.abs(mid.gl.p - 0.5) < 1e-6, `p at the middle: ${mid.gl.p}`);
    assert.deepEqual(mid.layers, [['1', 'translate(-240px, 0px)', ''], ['1', 'translate(240px, 0px)', '']], 'the stand-in push from the right, both layers up');
    assert.deepEqual((await read(1.5, 'outgoing')).layers, [['1', '', ''], null], 'the outgoing layer alone, unposed');
    assert.deepEqual((await read(1.5, 'incoming')).layers, [null, ['1', '', '']], 'the incoming layer alone, unposed');
    assert.deepEqual((await read(1.5)).layers, mid.layers, 'a plain seek restores the stand-in');
    assert.equal((await read(0.5, 'incoming')).gl, null, 'a layer asked for outside a window changes nothing');
    assert.deepEqual(problems, []);
  } finally { await done(); }
});

// ---- the compositor ----------------------------------------------------------------------------

const CSIZE = [64, 36];
const gradient = (r, g, b) => makePng(CSIZE[0], CSIZE[1], (x, y) => [(r + x * 3) % 256, (g + y * 5) % 256, (b + x * y) % 256]);
const FROM = gradient(10, 60, 200);
const TO = gradient(200, 30, 90);

test('compositor: progress 0 is the outgoing image and progress 1 the incoming one, for the ripple and the cube from every edge', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const blocked = [];
  const compositor = createCompositor({ size: CSIZE, onBlock: (url) => blocked.push(url) });
  try {
    for (const [type, direction] of [['gl-ripple', null], ['gl-cube', 'left'], ['gl-cube', 'right'], ['gl-cube', 'up'], ['gl-cube', 'down']]) {
      const first = await compositor.composite(0, FROM, TO, { type, direction, p: 0 });
      assert.ok(await maxDiff(first, FROM) <= 1, `${type} ${direction} at 0 should be the outgoing image`);
      const last = await compositor.composite(0, FROM, TO, { type, direction, p: 1 });
      assert.ok(await maxDiff(last, TO) <= 1, `${type} ${direction} at 1 should be the incoming image`);
    }
    assert.deepEqual(blocked, [], 'the GL page makes no request outside the page');
  } finally { await compositor.close(); }
});

test('compositor: the middle of each transition is neither image, is the same bytes on every call and on every worker page', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const compositor = createCompositor({ size: CSIZE });
  try {
    for (const [type, direction] of [['gl-ripple', null], ['gl-cube', 'left'], ['gl-cube', 'down']]) {
      const state = { type, direction, p: 0.5 };
      const one = await compositor.composite(0, FROM, TO, state);
      assert.ok(await maxDiff(one, FROM) > 20, `${type} ${direction} is not the outgoing image at 0.5`);
      assert.ok(await maxDiff(one, TO) > 20, `${type} ${direction} is not the incoming image at 0.5`);
      assert.ok(one.equals(await compositor.composite(0, FROM, TO, state)), `${type} ${direction}: twice on one page`);
      assert.ok(one.equals(await compositor.composite(1, FROM, TO, state)), `${type} ${direction}: on another page`);
      process.stdout.write(`gl-frame: ${process.platform} ${type} ${direction ?? '-'} ${createHash('sha256').update(one).digest('hex')}\n`); // the same on every runner is the CI evidence
      assert.ok(one.equals(await compositor.composite(0, FROM, TO, { ...state, p: 0.3 })) === false, 'a different progress is a different frame');
    }
  } finally { await compositor.close(); }
});

test('compositor: the cube at its middle shows both faces and the backdrop; the ripple at its middle mixes the two images', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const compositor = createCompositor({ size: CSIZE });
  const red = makePng(CSIZE[0], CSIZE[1], () => [255, 0, 0]);
  const blue = makePng(CSIZE[0], CSIZE[1], () => [0, 0, 255]);
  const browser = await launchBrowser({ quiet: true });
  try {
    const page = await browser.newPage();
    const counts = async (png) => page.evaluate(async (b64) => {
      const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, img.width, img.height).data;
      const out = { red: 0, blue: 0, black: 0, mixed: 0 };
      for (let i = 0; i < d.length; i += 4) {
        const [r, g, b] = [d[i], d[i + 1], d[i + 2]];
        if (r < 8 && g < 8 && b < 8) out.black++;
        else if (r > 60 && b < 20) out.red++;
        else if (b > 60 && r < 20) out.blue++;
        else out.mixed++;
      }
      return out;
    }, png.toString('base64'));
    const cube = await counts(await compositor.composite(0, red, blue, { type: 'gl-cube', direction: 'left', p: 0.5 }));
    assert.ok(cube.red > 100 && cube.blue > 100, `both faces show: ${JSON.stringify(cube)}`);
    assert.ok(cube.black > 50, `the backdrop shows round the turning cube: ${JSON.stringify(cube)}`);
    const ripple = await counts(await compositor.composite(0, red, blue, { type: 'gl-ripple', direction: null, p: 0.5 }));
    assert.ok(ripple.mixed > CSIZE[0] * CSIZE[1] * 0.9, `the images are mixed: ${JSON.stringify(ripple)}`);
  } finally { await browser.close(); await compositor.close(); }
});

test('compositor: a browser without WebGL is a clear error that names the fix, and close() works when nothing was launched', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const idle = createCompositor({ size: CSIZE });
  await idle.close();
  const broken = createCompositor({ size: CSIZE, args: ['--disable-gpu', '--disable-3d-apis', '--disable-webgl'] });
  try {
    await assert.rejects(broken.composite(0, FROM, TO, { type: 'gl-ripple', direction: null, p: 0.5 }),
      /WebGL is not available in this browser.*gl-ripple and gl-cube need it; use push or crossfade instead/s);
  } finally { await broken.close(); }
});

// ---- takeFrame: which pictures a frame is made of ------------------------------------------------

// A fake page and compositor: the page's evaluate says which layer is up, screenshot returns a Buffer naming it.
function fakes(stateAt) {
  const calls = [];
  let shown = 'plain';
  const page = {
    evaluate: async (fn, [sec, layer, text]) => {
      assert.match(String(fn), /\.seek\(/, 'boundPage tracks the time through the .seek( call');
      shown = layer ?? 'plain';
      calls.push([sec, layer ?? null, text ?? null]);
      return stateAt(sec);
    },
    screenshot: async () => Buffer.from(shown),
  };
  const compositor = { composite: async (k, from, to, state) => { calls.push(['composite', k, from.toString(), to.toString(), state.p]); return Buffer.from(`${from}+${to}`); } };
  return { page, compositor, calls };
}

test('takeFrame: a frame outside any window is the plain screenshot', async () => {
  const { page, compositor, calls } = fakes(() => null);
  assert.equal((await takeFrame({ page, compositor, k: 0 }, 0.5)).toString(), 'plain');
  assert.deepEqual(calls, [[0.5, null, null]]);
});

test('takeFrame: progress 0 is the outgoing layer alone and progress 1 the incoming layer alone, with no composite', async () => {
  const start = fakes(() => ({ type: 'gl-ripple', direction: null, p: 0 }));
  assert.equal((await takeFrame({ page: start.page, compositor: start.compositor, k: 0 }, 1)).toString(), 'outgoing');
  assert.deepEqual(start.calls, [[1, null, null], [1, 'outgoing', null]]);
  const end = fakes(() => ({ type: 'gl-ripple', direction: null, p: 1 }));
  assert.equal((await takeFrame({ page: end.page, compositor: end.compositor, k: 2 }, 1.5)).toString(), 'incoming');
  assert.deepEqual(end.calls, [[1.5, null, null], [1.5, 'incoming', null]]);
});

test('takeFrame: inside a window it shoots the outgoing layer, then the incoming one, then composes them on its own page', async () => {
  const { page, compositor, calls } = fakes(() => ({ type: 'gl-cube', direction: 'left', p: 0.4 }));
  assert.equal((await takeFrame({ page, compositor, k: 3 }, 1.2)).toString(), 'outgoing+incoming');
  assert.deepEqual(calls, [[1.2, null, null], [1.2, 'outgoing', null], [1.2, 'incoming', null], ['composite', 3, 'outgoing', 'incoming', 0.4]]);
});

test('takeFrame: a contact-sheet stamp is set on a plain frame and left off a composed one', async () => {
  const plain = fakes(() => null);
  await takeFrame({ page: plain.page, compositor: plain.compositor, k: 0 }, 0.5, 's · 0.50s');
  assert.deepEqual(plain.calls, [[0.5, null, 's · 0.50s']]);
});

// ---- the frames --------------------------------------------------------------------------------

test('frames of a real window: the edges are the plain scenes pixel for pixel, the middle is neither, and any page draws the same frame', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const spec = { size: SIZE, fps: 10, scenes: glScenes({ type: 'gl-ripple', duration: 1 }) };
  const onlyA = { size: SIZE, fps: 10, scenes: [spec.scenes[0]] };
  const onlyB = { size: SIZE, fps: 10, scenes: [{ ...spec.scenes[1], transition: 'none' }] };
  const compositor = createCompositor({ size: SIZE });
  const main = await openPage(spec);
  const other = await openPage(spec);
  const lone = await openPage(onlyA);
  const second = await openPage(onlyB);
  try {
    const plain = async (opened, sec) => { await opened.page.evaluate((s) => window.__motion.seek(s), sec); return opened.page.screenshot({ type: 'png' }); };
    const frame = (opened, k, sec) => takeFrame({ page: opened.page, compositor, k }, sec);
    assert.equal(await maxDiff(await frame(main, 0, 1), await plain(lone, 1)), 0, 'the first frame of the window is the outgoing scene');
    assert.equal(await maxDiff(await frame(main, 0, 2), await plain(second, 1)), 0, 'the first frame after the window is the incoming scene');
    assert.equal(await maxDiff(await frame(main, 0, 0.5), await plain(lone, 0.5)), 0, 'before the window it is the plain screenshot');
    const mid = await frame(main, 0, 1.5);
    assert.ok(await maxDiff(mid, await plain(lone, 1)) > 20, 'the middle is not the outgoing scene');
    assert.ok(await maxDiff(mid, await plain(second, 0.5)) > 20, 'the middle is not the incoming scene');
    assert.ok(mid.equals(await frame(other, 1, 1.5)), 'a second page draws the same bytes');
    assert.ok(mid.equals(await frame(main, 0, 1.5)), 'the same page draws them again');
    await frame(main, 0, 1.9);
    assert.ok(mid.equals(await frame(main, 0, 1.5)), 'a walk through the window does not change a frame');
    assert.deepEqual([...main.problems, ...other.problems], []);
  } finally {
    await Promise.all([main.done(), other.done(), lone.done(), second.done()]);
    await compositor.close();
  }
});

// ---- renders -----------------------------------------------------------------------------------

test('the example: a motion spec of 15 s or less with all three GL kinds', () => {
  const spec = loadSpec(EXAMPLE).spec;
  assert.deepEqual(validateSpec(spec, { dir: path.dirname(EXAMPLE) }).errors, []);
  assert.ok(spec.scenes.reduce((a, s) => a + s.duration, 0) <= 15);
  assert.deepEqual(spec.scenes.slice(1).map((s) => normalizeTransition(s.transition)).map(({ type, direction }) => [type, direction]),
    [['gl-ripple', null], ['gl-cube', 'left'], ['gl-cube', 'down']]);
  assert.equal(usesGl(spec), true);
});

test('the example passes check.mjs with no output on stderr (the audits judge the stand-in layers)', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const r = spawnSync(process.execPath, [CHECK, EXAMPLE], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.stderr, '');
});

const checkScenes = (scenes) => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'gl-check-')), 'm.json');
  writeFileSync(file, JSON.stringify({ size: [1920, 1080], fps: 30, scenes }));
  return spawnSync(process.execPath, [CHECK, file], { encoding: 'utf8' });
};
const word = (id, extra = {}) => ({ id, type: 'text', text: id, x: 960, y: 540, fontSize: 64, ...extra });

test('check: a 0.6 s GL window counts as motion for the dead-stretch audit, as every other window does; a cut does not', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const still = (transition) => [{ id: 'a', duration: 2, elements: [word('first', { y: 300 })] },
    { id: 'b', duration: 3.4, transition, elements: [word('second', { y: 760 })] },
    { id: 'c', duration: 3.2, elements: [word('third', { y: 300 })] }];
  for (const transition of [{ type: 'gl-ripple', duration: 0.6 }, { type: 'gl-cube', duration: 0.6 }]) {
    const r = checkScenes(still(transition));
    assert.equal(r.status, 0, `${transition.type}: ${r.stdout}${r.stderr}`);
  }
  const cut = checkScenes(still('none'));
  assert.equal(cut.status, 1, 'guardrail: with no window the same spec is a dead stretch');
});

test('check: texts over each other in a ripple window are the overlap warning, which names the type; a cube never overlaps them', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const scenes = (transition) => [{ id: 'a', duration: 2, elements: [word('first')] }, { id: 'b', duration: 2, transition, elements: [word('second')] }];
  const ripple = checkScenes(scenes('gl-ripple'));
  assert.equal(ripple.status, 0, ripple.stdout + ripple.stderr);
  assert.match(ripple.stderr, /^warning: scenes\[1\]\.elements\[0\]: text "second" overlaps text "first" of the outgoing scene "a" during the gl-ripple at \d\.\d\ds; move one of them, or let the outgoing text exit first\n$/);
  const cube = checkScenes(scenes({ type: 'gl-cube', duration: 1 }));
  assert.equal(cube.status, 0, cube.stdout + cube.stderr);
  assert.equal(cube.stderr, '');
});

test('check: a real problem in the incoming scene is still reported inside a GL window', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const r = checkScenes([{ id: 'a', duration: 2, elements: [word('first')] },
    { id: 'b', duration: 2, transition: { type: 'gl-cube', duration: 1 }, elements: [word('one', { y: 300 }), word('two', { y: 300 })] }]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^scenes\[1\]\.elements\[1\]: text "two" overlaps text "one"/m);
});

const glSpecFile = (transition, extra = {}) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'gl-render-'));
  const file = path.join(dir, 'm.json');
  writeFileSync(file, JSON.stringify({ size: [320, 180], fps: 30, scenes: [
    { id: 'a', duration: 1, background: '#10243a', elements: [label('first', { x: 160, y: 60, fontSize: 28 })] },
    { id: 'b', duration: 1.2, background: '#3a1f33', transition, elements: [label('second', { x: 160, y: 120, fontSize: 28 })] }], ...extra }));
  return file;
};

for (const [name, transition] of [['gl-ripple', { type: 'gl-ripple', duration: 0.6 }], ['gl-cube left', { type: 'gl-cube', direction: 'left', duration: 0.6 }], ['gl-cube up', { type: 'gl-cube', direction: 'up', duration: 0.6 }]]) {
  test(`${name}: two renders are byte-identical`, async (t) => {
    if (!(await requireRender(t))) return;
    await assertRendersIdentically(t, glSpecFile(transition), SMALL);
  });
}

test('the example renders byte-identical twice, and the same with --workers 1 and --workers 4', async (t) => {
  if (!(await requireRender(t))) return;
  const first = await renderHash(EXAMPLE, [...SMALL, '--workers', '1']);
  const second = await renderHash(EXAMPLE, [...SMALL, '--workers', '1']);
  const four = await renderHash(EXAMPLE, [...SMALL, '--workers', '4']);
  assert.equal(second.sha256, first.sha256, 'twice with one worker');
  assert.equal(four.sha256, first.sha256, 'four workers give the bytes of one');
  process.stdout.write(`gl-transitions: ${process.platform} ${first.sha256}\n`);
});

test('a GL render says how many frames it composed, blocks no request, and a render with no GL launches no GL browser', async (t) => {
  if (!(await requireRender(t))) return;
  const out = path.join(mkdtempSync(path.join(tmpdir(), 'gl-out-')), 'v.mp4');
  const r = spawnSync(process.execPath, [RENDER, glSpecFile({ type: 'gl-ripple', duration: 0.6 }), '--out', out, ...SMALL], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stderr, /blocked network request/);
  assert.match(r.stderr, /^webgl: 5 frames composed in software$/m, 'a 0.6 s window at 10 fps is 6 frames; the first is the outgoing scene itself, so 5 are composed');
  const plainOut = path.join(mkdtempSync(path.join(tmpdir(), 'gl-out-')), 'v.mp4');
  const plain = spawnSync(process.execPath, [RENDER, glSpecFile({ type: 'push', duration: 0.6 }), '--out', plainOut, ...SMALL], { encoding: 'utf8' });
  assert.equal(plain.status, 0, plain.stdout + plain.stderr);
  assert.doesNotMatch(plain.stderr, /webgl/);
});

test('--workers 4 on a GL window with fewer frames than workers still renders the same bytes as one worker', async (t) => {
  if (!(await requireRender(t))) return;
  const file = glSpecFile({ type: 'gl-cube', direction: 'right', duration: 0.3 });
  const args = ['--fps', '10', '--size', '320x180'];
  assert.equal((await renderHash(file, [...args, '--workers', '4'])).sha256, (await renderHash(file, [...args, '--workers', '1'])).sha256);
});

test('--quality draft on a GL spec composes at the half size and is byte-identical twice', async (t) => {
  if (!(await requireRender(t))) return;
  const file = glSpecFile({ type: 'gl-cube', direction: 'down', duration: 0.6 });
  const first = await renderHash(file, [...SMALL, '--quality', 'draft']);
  assert.equal((await renderHash(file, [...SMALL, '--quality', 'draft'])).sha256, first.sha256);
  assert.match(first.stdout, /10 frames? @ 10 fps, 160x90|frames @ 10 fps, 160x90/);
});

test('--contact-sheet on a GL spec draws the transition tiles through the compositor and writes the sheets', async (t) => {
  if (!(await requireRender(t))) return;
  const out = mkdtempSync(path.join(tmpdir(), 'gl-sheet-'));
  const r = spawnSync(process.execPath, [RENDER, EXAMPLE, '--contact-sheet', '--out', out, '--size', '640x360'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(readdirSync(path.join(out, 'contact')).sort(), ['cube-down.png', 'cube.png', 'open.png', 'ripple.png']);
  assert.doesNotMatch(r.stderr, /blocked network request/);
});

// ---- validate says what the preview shows ------------------------------------------------------

test('validate.mjs notes on stderr that the preview and check.mjs stand in for a GL transition; a spec without one is silent; --json is unchanged', () => {
  const r = spawnSync(process.execPath, [VALIDATE, EXAMPLE], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /valid\n$/);
  assert.match(r.stderr, /^note: scenes\[1\]\.transition: gl-ripple is drawn by WebGL in a render; the preview and check\.mjs show a crossfade instead\n/m);
  assert.match(r.stderr, /^note: scenes\[2\]\.transition: gl-cube is drawn by WebGL in a render; the preview and check\.mjs show a push \(direction "left"\) instead\n/m);
  assert.match(r.stderr, /^note: scenes\[3\]\.transition: gl-cube is drawn by WebGL in a render; the preview and check\.mjs show a push \(direction "down"\) instead\n/m);
  const json = spawnSync(process.execPath, [VALIDATE, EXAMPLE, '--json'], { encoding: 'utf8' });
  assert.equal(json.stderr, '');
  assert.deepEqual(JSON.parse(json.stdout), { ok: true, errors: [] });
  const none = spawnSync(process.execPath, [VALIDATE, path.join(root, 'references/examples/transitions.json')], { encoding: 'utf8' });
  assert.equal(none.stderr, '');
});
