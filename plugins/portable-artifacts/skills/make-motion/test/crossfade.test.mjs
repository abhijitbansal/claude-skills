// P2: `transition: "crossfade"`: the previous scene stays fully on screen while the new one fades in over it for 0.4 s.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTimeline, seekTo } from '../template/timeline.mjs';
import { validateSpec, withDefaults } from '../scripts/lib/spec.mjs';
import { probed, framed, meanLuma } from './render-probe.mjs';
import { requireRender, BROWSER_ONLY } from './helpers/render.mjs';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);
const label = (id, extra = {}) => ({ id, type: 'text', text: id, x: 240, y: 135, fontSize: 40, ...extra });
const scenes = (second = {}, first = {}) => [
  { id: 's1', duration: 3, elements: [label('a')], ...first },
  { id: 's2', duration: 3, elements: [label('b')], ...second },
];
const errs = (motion) => validateSpec(motion).errors.map((e) => `${e.path}: ${e.message}`);

// ---- timeline ----------------------------------------------------------------------------------

test('crossfade: the new scene fades in over the previous one, which stays at full opacity, for 0.4 s from the cut', () => {
  const { timeline, states, crossfades } = buildTimeline({ scenes: scenes({ transition: 'crossfade' }) });
  assert.deepEqual(crossfades, [{ from: 0, to: 1, start: 3, end: 3.4 }]);
  const at = (sec) => { seekTo(timeline, sec); return [states.get('scene:s1').opacity, states.get('scene:s2').opacity]; };
  assert.deepEqual(at(2.9), [1, 0]);
  const [outgoing, incoming] = at(3.2);
  assert.equal(outgoing, 1, 'fading both layers would let the stage colour show through mid-fade');
  near(incoming, 0.5);
  assert.deepEqual(at(3.5), [1, 1]);
  assert.deepEqual(at(2.9), [1, 0], 'seeking back restores the incoming scene to hidden');
});

test('no transition and fade leave crossfades empty and the opacities as they were', () => {
  const plain = buildTimeline({ scenes: scenes() });
  assert.deepEqual(plain.crossfades, []);
  seekTo(plain.timeline, 3.2);
  assert.equal(plain.states.get('scene:s1').opacity, 1);
  const fade = buildTimeline({ scenes: scenes({ transition: 'fade' }) });
  assert.deepEqual(fade.crossfades, []);
  seekTo(fade.timeline, 3.2);
  assert.equal(fade.states.get('scene:s1').opacity, 1, 'a fade starts from the page background, not over the old scene');
});

test('crossfade on the first scene has nothing to fade from: it draws as a plain cut', () => {
  const { timeline, states, crossfades } = buildTimeline({ scenes: scenes({}, { transition: 'crossfade' }) });
  assert.deepEqual(crossfades, []);
  seekTo(timeline, 0);
  assert.equal(states.get('scene:s1').opacity, 1);
});

test('a crossfade into a scene shorter than 0.4 s lasts that scene', () => {
  const { crossfades } = buildTimeline({ scenes: [...scenes(), { id: 's3', duration: 0.2, transition: 'crossfade', elements: [label('c')] }] });
  assert.deepEqual(crossfades, [{ from: 1, to: 2, start: 6, end: 6.2 }]);
});

// ---- validation and defaults -------------------------------------------------------------------

test('transition accepts crossfade on a scene (not the first) and as a root default', () => {
  assert.deepEqual(errs({ scenes: scenes({ transition: 'crossfade' }) }), []);
  assert.deepEqual(errs({ transition: 'crossfade', scenes: scenes() }), []);
  assert.deepEqual(errs({ transition: 'fade', scenes: scenes() }), []);
});

test('an explicit crossfade on the first scene is an error, a root default is not', () => {
  assert.deepEqual(errs({ scenes: scenes({}, { transition: 'crossfade' }) }), ['scenes[0].transition: crossfade needs a previous scene to fade in over; use "fade" or "none" on the first scene']);
  assert.deepEqual(errs({ transition: 'crossfade', scenes: scenes() }), []);
});

test('an unknown transition is rejected at the root too', () => {
  const e = errs({ transition: 'spin', scenes: scenes() }); // `wipe` was the unknown example until it became a transition
  assert.equal(e.length, 1);
  assert.match(e[0], /^transition: must be one of "none", "fade", "crossfade"/);
});

test('the root transition is the default of every scene that sets none, except the first for a crossfade', () => {
  const d = withDefaults({ transition: 'crossfade', scenes: [...scenes(), { id: 's3', duration: 1, transition: 'none', elements: [label('c')] }] });
  assert.deepEqual(d.scenes.map((s) => s.transition), ['none', 'crossfade', 'none']);
  assert.deepEqual(withDefaults({ transition: 'fade', scenes: scenes() }).scenes.map((s) => s.transition), ['fade', 'fade']);
  assert.deepEqual(withDefaults({ scenes: scenes() }).scenes.map((s) => s.transition), ['none', 'none']);
});

// ---- the page ----------------------------------------------------------------------------------

const layers = () => {
  const stage = document.getElementById('stage');
  const read = () => [...stage.querySelectorAll(':scope > .scene')].map((l) => (getComputedStyle(l).display === 'none' ? null : Number(l.style.opacity)));
  const at = (sec) => { window.__motion.seek(sec); return read(); };
  return { before: at(2.9), mid: at(3.2), after: at(3.5) };
};

test('mid-crossfade frame has both scene layers visible, the old one beneath; before and after show one', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return undefined;
  const found = await probed({ size: [480, 270], scenes: scenes({ transition: 'crossfade' }) }, layers);
  assert.deepEqual(found.before, [1, null]);
  assert.equal(found.mid.length, 2);
  assert.equal(found.mid[0], 1, 'the old scene is at full opacity beneath');
  assert.ok(Math.abs(found.mid[1] - 0.5) < 1e-6, `the new scene is half in: ${found.mid}`);
  assert.deepEqual(found.after, [null, 1]);
  return undefined;
});

test('without a transition the page shows one layer at every moment, as before', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return undefined;
  const found = await probed({ size: [480, 270], scenes: scenes() }, layers);
  assert.deepEqual(found, { before: [1, null], mid: [null, 1], after: [null, 1] });
  return undefined;
});

test('two scenes with the same opaque background keep the same mean luma through the crossfade (no dip to the stage colour)', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return undefined;
  const white = (id, extra = {}) => ({ id, duration: 2, background: '#ffffff', elements: [], ...extra });
  const motion = { size: [160, 90], scenes: [white('a'), white('b', { transition: 'crossfade' })] };
  const luma = [];
  for (const sec of [1.5, 2.1, 2.2, 2.3, 2.6]) luma.push(await meanLuma(await framed(motion, sec)));
  assert.ok(luma.every((l) => Math.abs(l - 255) < 1), `mean luma through the window: ${luma}`);
  return undefined;
});
