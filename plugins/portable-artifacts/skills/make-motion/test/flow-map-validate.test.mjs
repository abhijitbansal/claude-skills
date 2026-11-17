// flow-map on the US map: an end outside the United States projects to nothing, so its arc would be missing from the film with no
// error (G-74). validate names the end, in map-highlight's style. No browser. The atlas packages are not needed: the block's
// own validate reads the params only, and through validateSpec only the errors about a flow end are looked at.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSpec } from '../scripts/lib/spec.mjs';
import { blockDef } from '../template/blocks/index.mjs';

const NY = { lon: -74, lat: 40.7 };
const LA = { lon: -118.2, lat: 34.05 };
const ANCHORAGE = { lon: -149.9, lat: 61.2 };
const HONOLULU = { lon: -157.9, lat: 21.3 };
const LONDON = { lon: -0.13, lat: 51.5 };
const DELHI = { lon: 77.2, lat: 28.6 };
const validate = (params) => blockDef('flow-map').validate(params).map((e) => `${e.path}: ${e.message}`);

test('a US map takes flows whose ends are in the lower 48, Alaska and Hawaii', () => {
  assert.deepEqual(validate({ map: 'us', flows: [{ from: NY, to: LA }, { from: LA, to: ANCHORAGE }, { from: ANCHORAGE, to: HONOLULU }] }), []);
});

test('a US map with an end abroad is an error at that end, naming the place and the two ways out', () => {
  assert.deepEqual(validate({ map: 'us', flows: [{ from: NY, to: LA }, { from: LA, to: LONDON }] }), [
    'flows[1].to: lon -0.13, lat 51.5 is not inside the United States, which the US map draws (the lower 48, Alaska and Hawaii); set "map": "world" to draw a flow outside it, or move the end',
  ]);
});

test('both ends of a flow are checked, each on its own path', () => {
  assert.deepEqual(validate({ map: 'us', flows: [{ from: LONDON, to: DELHI }] }).map((e) => e.split(': ')[0]), ['flows[0].from', 'flows[0].to']);
});

test('the world map takes the same flows without a word', () => {
  assert.deepEqual(validate({ map: 'world', flows: [{ from: LONDON, to: DELHI }] }), []);
  assert.deepEqual(validate({ flows: [{ from: LONDON, to: DELHI }] }), [], 'world is the default');
});

test('through validateSpec the error lands on the block param path', () => {
  const spec = { scenes: [{ id: 's', duration: 8, elements: [{ id: 'f', type: 'block', x: 960, y: 540, block: 'flow-map', params: { map: 'us', flows: [{ from: NY, to: LONDON }] } }] }] };
  const own = validateSpec(spec).errors.filter((e) => e.path.includes('flows['));
  assert.deepEqual(own.map((e) => e.path), ['scenes[0].elements[0].params.flows[0].to']);
});
