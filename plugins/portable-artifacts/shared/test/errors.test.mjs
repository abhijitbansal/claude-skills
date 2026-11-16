// formatAjvErrors over an anyOf of object shapes (branch review B, I9): only the closest branch's errors are reported, so
// a misspelled key gives one did-you-mean, not contradictory lines from the other shapes. The errors below are Ajv's own
// (allErrors, verbose), printed for a column chart's `data: [{ label: 'Q1', vale: 12 }]` against item, point and series
// shapes (.scratch/fixA/anyof-probe.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatAjvErrors } from '../errors.mjs';

const ITEM = { type: 'object', additionalProperties: false, required: ['label', 'value'], properties: { label: { type: 'string' }, value: { type: 'number' } } };
const POINT = { type: 'object', additionalProperties: false, required: ['x', 'y'], properties: { x: { type: 'number' }, y: { type: 'number' } } };
const err = (keyword, instancePath, schemaPath, params, parentSchema) => ({ keyword, instancePath, schemaPath, params, ...(parentSchema ? { parentSchema } : {}), message: keyword === 'type' ? `must be ${params.type}` : undefined });
const MISSPELLED = Object.freeze([
  err('required', '/data/0', '#/properties/data/anyOf/0/items/required', { missingProperty: 'value' }),
  err('additionalProperties', '/data/0', '#/properties/data/anyOf/0/items/additionalProperties', { additionalProperty: 'vale' }, ITEM),
  err('required', '/data/0', '#/properties/data/anyOf/1/items/required', { missingProperty: 'x' }),
  err('required', '/data/0', '#/properties/data/anyOf/1/items/required', { missingProperty: 'y' }),
  err('additionalProperties', '/data/0', '#/properties/data/anyOf/1/items/additionalProperties', { additionalProperty: 'label' }, POINT),
  err('additionalProperties', '/data/0', '#/properties/data/anyOf/1/items/additionalProperties', { additionalProperty: 'vale' }, POINT),
  err('type', '/data', '#/properties/data/anyOf/2/type', { type: 'object' }),
  err('anyOf', '/data', '#/properties/data/anyOf', {}),
]);

test('a misspelled key in an anyOf of shapes gives one did-you-mean from the closest shape, nothing from the others', () => {
  assert.deepEqual(formatAjvErrors(MISSPELLED), [{ path: 'data[0].vale', message: 'unknown property; did you mean "value"?' }]);
});

test('a branch that fails on the value\'s own type is the farthest, even with the fewest errors', () => {
  // the series shape (one error: data must be object) is not where an array of items was meant
  const lines = formatAjvErrors(MISSPELLED);
  assert.ok(!lines.some((l) => l.path === 'data' && /must be object/.test(l.message)), JSON.stringify(lines));
});

test('of branches with as many errors, the first is kept', () => {
  const tie = [
    err('required', '/v', '#/properties/v/anyOf/0/required', { missingProperty: 'a' }),
    err('required', '/v', '#/properties/v/anyOf/1/required', { missingProperty: 'b' }),
    err('anyOf', '/v', '#/properties/v/anyOf', {}),
  ];
  assert.deepEqual(formatAjvErrors(tie), [{ path: 'v.a', message: 'required' }]);
});

test('each item of an array is judged by its own closest branch', () => {
  const two = [
    err('required', '/d/0', '#/properties/d/items/anyOf/0/required', { missingProperty: 'a' }),
    err('required', '/d/0', '#/properties/d/items/anyOf/1/required', { missingProperty: 'b' }),
    err('required', '/d/0', '#/properties/d/items/anyOf/1/required', { missingProperty: 'c' }),
    err('anyOf', '/d/0', '#/properties/d/items/anyOf', {}),
    err('required', '/d/1', '#/properties/d/items/anyOf/0/required', { missingProperty: 'a' }),
    err('required', '/d/1', '#/properties/d/items/anyOf/0/required', { missingProperty: 'z' }),
    err('required', '/d/1', '#/properties/d/items/anyOf/1/required', { missingProperty: 'b' }),
    err('anyOf', '/d/1', '#/properties/d/items/anyOf', {}),
  ];
  assert.deepEqual(formatAjvErrors(two), [{ path: 'd[0].a', message: 'required' }, { path: 'd[1].b', message: 'required' }]);
});

test('errors outside any anyOf, and errors without a schemaPath, are kept as before', () => {
  const plain = [err('required', '', '#/required', { missingProperty: 'title' }), { keyword: 'type', instancePath: '/n', params: { type: 'number' }, message: 'must be number' }];
  assert.deepEqual(formatAjvErrors(plain), [{ path: 'title', message: 'required' }, { path: 'n', message: 'must be number' }]);
});
