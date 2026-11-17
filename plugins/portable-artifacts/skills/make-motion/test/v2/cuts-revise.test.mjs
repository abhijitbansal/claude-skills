// Look review gate-cuts-1, lead ruling 3, the pure half: the layer recipes clear the outgoing picture by mid-cut; the
// shader wrapper's clear windows and ground are identity unless a module asks; the pop cover keyline is drawn sharp
// over the smear; the punch's zoom and ease and the smear's shutter are look data. Pure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import '../../engine/cuts/index.mjs';
import { SHADER_MODULES, shaderUniforms, CLEAR_NONE } from '../../engine/cuts/shaders/index.mjs';
import { smearPlan, SMEAR_SHUTTER } from '../../engine/cuts/smear.mjs';
import { validateLook } from '../../engine/looks/index.mjs';
import '../../engine/looks/desk.mjs';
import '../../engine/looks/pop.mjs';

const CANVAS = { w: 1920, h: 1080 };
const LEGIBLE = 0.2;
const MIDDLE = [0.34, 0.4, 0.5, 0.6, 0.66];
const smoothstep = (lo, hi, v) => {
  const x = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
  return x * x * (3 - 2 * x);
};

// What shows of the outgoing picture where the incoming one lies over it: its own opacity times what the incoming lets
// through (the incoming drawn over it, both opaque pictures).
for (const name of ['crossfade', 'zoom', 'blur']) {
  test(`${name}: in the middle third only one picture reads (the outgoing one is cleared before the incoming one is up)`, () => {
    const cut = registries.cuts.get(name);
    for (const p of MIDDLE) {
      const r = cut.layers({ p, direction: cut.directions?.[0] ?? null, canvas: CANVAS });
      const shown = { from: r.from.opacity * (1 - r.to.opacity), to: r.to.opacity };
      assert.ok(Math.min(shown.from, shown.to) <= LEGIBLE, `${name} p ${p}: outgoing ${shown.from.toFixed(3)}, incoming ${shown.to.toFixed(3)}`);
    }
  });
}

test('iris dims the outgoing picture once it opens, so the circle\'s edge reads on paper of one colour', () => {
  const iris = registries.cuts.get('iris');
  assert.equal(iris.layers({ p: 0, direction: 'in', canvas: CANVAS }).from.dim ?? 0, 0, 'p 0 is the outgoing picture exactly');
  assert.ok(iris.layers({ p: 0.4, direction: 'in', canvas: CANVAS }).from.dim >= 0.2);
});

test('shader uniforms: the clear windows are identity and the ground is the incoming background unless a module asks', () => {
  const plain = shaderUniforms(SHADER_MODULES['cross-zoom'], { p: 0.5, canvas: CANVAS, ground: '#ff8000' });
  assert.deepEqual([plain.uClearFrom, plain.uClearTo], [CLEAR_NONE.from, CLEAR_NONE.to]);
  assert.deepEqual(plain.uGround, [1, 128 / 255, 0]);
  assert.ok(smoothstep(...CLEAR_NONE.from, 1) === 0 && smoothstep(...CLEAR_NONE.to, 0) === 1, 'never clears at any progress');
  for (const name of ['ripple', 'polka-dots', 'glitch-memories', 'water-drop', 'cross-warp', 'window-slices', 'wind', 'page-curl']) {
    const u = shaderUniforms(SHADER_MODULES[name], { p: 0.5, canvas: CANVAS, ground: '#000000' });
    const fromLeft = 1 - smoothstep(...u.uClearFrom, 0.5), toUp = smoothstep(...u.uClearTo, 0.5);
    assert.ok(Math.min(fromLeft, toUp) <= LEGIBLE, `${name} at p 0.5: outgoing ${fromLeft}, incoming ${toUp}`);
  }
});

test('the pop cover keyline is drawn over the smear, sharp, at the sheet\'s edge for this frame', () => {
  const pop = registries.looks.get('pop');
  const field = Object.freeze({ type: 'path', id: 'f', depth: 1, props: Object.freeze({ d: '', fill: '#000' }), x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotate: 0, opacity: 1, draw: 1, reveal: 1, blur: 0, visible: true, children: Object.freeze([]) });
  const parts = registries.cuts.get('cover').parts({ from: [field], to: [field], p: 0.5, canvas: CANVAS, look: pop, background: '#000000', direction: 'left' });
  assert.ok(parts.over.some((n) => n.id === 'cover.edge.line'), 'the keyline is in over');
  assert.ok(!parts.moving(0.5).some((n) => n.id.startsWith('cover.edge')), 'and not in the smeared layers');
  const sheet = parts.moving(0.5).find((n) => n.id === 'cover.backdrop');
  assert.equal(parts.over.find((n) => n.id === 'cover.edge.line').x, sheet.x, 'riding with the sheet at p');
});

test('punch: the look gives the zoom and the ease; pop lands at least 1.2 times its size with an overshoot', () => {
  const pop = registries.looks.get('pop');
  const node = Object.freeze({ type: 'path', id: 'b', depth: 0, props: Object.freeze({ d: '' }), x: 1460, y: 540, scale: 1, scaleX: 1, scaleY: 1, rotate: 0, opacity: 1, draw: 1, reveal: 1, blur: 0, visible: true, children: Object.freeze([]) });
  const punch = registries.cuts.get('punch');
  const scaleAt = (p, look) => punch.parts({ from: [], to: [node], p, canvas: CANVAS, look }).moving(p)[0].scale;
  assert.ok(scaleAt(1e-6, pop) >= 1.2, `starts at ${scaleAt(1e-6, pop)}`);
  assert.ok(scaleAt(1 / 6, pop) >= 1.08, `still punched in a frame later: ${scaleAt(1 / 6, pop)}`);
  assert.ok(Math.min(...[0.4, 0.5, 0.6, 0.7].map((p) => scaleAt(p, pop))) < 1, 'it overshoots below full size before settling');
  assert.equal(scaleAt(1e-6, null).toFixed(4), '1.1500', 'no look: the registry default');
});

test('smear shutter: look data halves the streak; the default stays half a frame', () => {
  const travel = (q0, q1) => (q1 - q0) * 1000;
  const full = smearPlan({ p: 0.5, frame: 0.1, travel });
  const half = smearPlan({ p: 0.5, frame: 0.1, travel, shutter: SMEAR_SHUTTER / 2 });
  assert.ok(Math.abs(full.samples.at(-1) - full.samples[0]) > 1.9 * Math.abs(half.samples.at(-1) - half.samples[0]));
  assert.ok(registries.looks.get('pop').cutMotion.smearShutter < SMEAR_SHUTTER);
  assert.equal(registries.looks.get('desk').cutMotion?.smearShutter, undefined, 'desk keeps the default');
});

test('validateLook checks cutMotion: numbers in range and nothing else', () => {
  const base = registries.looks.get('pop');
  assert.throws(() => validateLook({ ...base, name: 'cm-test', cutMotion: { punchZoom: 0.9 } }), /cutMotion\.punchZoom/);
  assert.throws(() => validateLook({ ...base, name: 'cm-test', cutMotion: { smearShutter: 2 } }), /cutMotion\.smearShutter/);
  assert.throws(() => validateLook({ ...base, name: 'cm-test', cutMotion: { punchEase: 'nope' } }), /cutMotion\.punchEase/);
  assert.throws(() => validateLook({ ...base, name: 'cm-test', cutMotion: { zoomy: 1 } }), /cutMotion\.zoomy is not a field/);
});
