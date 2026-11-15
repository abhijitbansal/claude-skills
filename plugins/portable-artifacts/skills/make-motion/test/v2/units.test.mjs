// The design unit: 1 unit = short side / 1080 px. One definition, used by the stage and by the fields.
import test from 'node:test';
import assert from 'node:assert/strict';
import { unitOf, REFERENCE_SIDE } from '../../engine/units.mjs';
import { checkInput } from '../../engine/fields/shared.mjs';

test('unitOf is the short side over 1080', () => {
  assert.equal(REFERENCE_SIDE, 1080);
  assert.equal(unitOf({ w: 1920, h: 1080 }), 1);
  assert.equal(unitOf({ w: 1080, h: 1920 }), 1);
  assert.equal(unitOf({ w: 1080, h: 1350 }), 1);
  assert.equal(unitOf({ w: 3840, h: 2160 }), 2);
  assert.equal(unitOf({ w: 540, h: 960 }), 0.5);
});

test('unitOf refuses a canvas that is not positive finite numbers', () => {
  for (const bad of [{ w: 0, h: 10 }, { w: 10, h: -1 }, { w: Number.NaN, h: 10 }, { w: 10 }, null]) {
    assert.throws(() => unitOf(bad), /canvas/, JSON.stringify(bad));
  }
});

test('the fields take their default unit from unitOf, so the two cannot drift', () => {
  const palette = Object.fromEntries(['paper', 'ink', 'ink2', 'accent', 'accent2', 'rule'].map((k) => [k, '#112233']));
  for (const [w, h] of [[1920, 1080], [1080, 1920], [3840, 2160], [540, 960]]) {
    assert.equal(checkInput({ w, h, seed: 1, palette }).unit, unitOf({ w, h }), `${w}x${h}`);
  }
});
