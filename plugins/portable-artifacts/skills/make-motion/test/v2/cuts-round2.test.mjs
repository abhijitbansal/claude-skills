// The transitions revision, round 2 (lead ruling 3, look review gate-cuts-1 D8): the iris opens from a clear point the
// look names (look.cutMotion.irisAt, fractions of the canvas), not from the middle of the outgoing words, and its circle
// still reaches every corner. Pure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import '../../engine/cuts/index.mjs';
import '../../engine/looks/index.mjs';
import { validateLook } from '../../engine/looks/index.mjs';

const CANVAS = { w: 1920, h: 1080 };
const iris = (p, look, direction = 'in') => registries.cuts.get('iris').layers({ p, direction, canvas: CANVAS, look });
const desk = () => registries.looks.get('desk');

test('iris in opens from the look\'s clear point; desk names one right of its text column', () => {
  const [fx, fy] = desk().cutMotion.irisAt;
  assert.ok(fx >= 0.7, `desk opens the iris right of its flush-left text: ${fx}`);
  const [cx, cy] = iris(0.3, desk()).to.clip.circle;
  assert.deepEqual([cx, cy], [fx * CANVAS.w, fy * CANVAS.h]);
});

test('iris from a corner-side point still uncovers the whole frame by the end, and closes the same way out', () => {
  const look = desk();
  const [cx, cy] = [look.cutMotion.irisAt[0] * CANVAS.w, look.cutMotion.irisAt[1] * CANVAS.h];
  const far = Math.max(...[[0, 0], [CANVAS.w, 0], [0, CANVAS.h], [CANVAS.w, CANVAS.h]].map(([x, y]) => Math.hypot(x - cx, y - cy)));
  const [, , r] = iris(0.9999, look).to.clip.circle;
  assert.ok(r >= 0.999 * far, `radius ${r} reaches the far corner ${far}`);
  const [ox, oy] = iris(0.5, look, 'out').from.clip.circle;
  assert.deepEqual([ox, oy], [cx, cy]);
});

test('a look that names no point opens the iris from the centre, as before', () => {
  const [cx, cy] = iris(0.3, null).to.clip.circle;
  assert.deepEqual([cx, cy], [CANVAS.w / 2, CANVAS.h / 2]);
});

test('window slices is a slatted wipe: no clear window (the pictures keep their own paper), a narrow band of slats in flight', async () => {
  const { SHADER_MODULES, shaderUniforms } = await import('../../engine/cuts/shaders/index.mjs');
  const u = shaderUniforms(SHADER_MODULES['window-slices'] ?? SHADER_MODULES.windowSlices, { p: 0.5, canvas: CANVAS });
  assert.ok(u.uClearFrom[0] > 1 && u.uClearTo[1] < 0, `identity clear windows: ${u.uClearFrom} ${u.uClearTo}`);
  assert.ok(u.smoothness <= 0.25, `at most a quarter of the frame in flight: ${u.smoothness}`);
});

test('validateLook refuses an irisAt that is not two fractions', () => {
  const base = desk();
  const withAt = (irisAt) => ({ ...base, cutMotion: { ...base.cutMotion, irisAt } });
  assert.throws(() => validateLook(withAt([1.2, 0.5])), /cutMotion\.irisAt must be two numbers from 0 to 1/);
  assert.throws(() => validateLook(withAt('right')), /cutMotion\.irisAt must be two numbers from 0 to 1/);
});
