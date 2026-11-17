// Digit grouping on counters is opt-in (PA-41): `group: true` on a counter, and on the kpi-counter block that draws one. A spec
// without it keeps its bytes. No browser: formatCounter is the one function the page calls to print a value.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSpec, withDefaults } from '../scripts/lib/spec.mjs';
import { formatCounter } from '../template/counter-format.mjs';
import { flattenElements } from '../template/groups.mjs';
import { expandSpec } from '../template/defaults.mjs';

const film = (counter) => ({ scenes: [{ id: 's', duration: 3, elements: [{ id: 'c', type: 'counter', x: 960, y: 540, from: 0, to: 48200, ...counter }] }] });
const errs = (spec) => validateSpec(spec).errors.map((e) => `${e.path}: ${e.message}`);

test('formatCounter: no group prints as it always did', () => {
  assert.equal(formatCounter(48200, {}), '48200');
  assert.equal(formatCounter(1234.5, { decimals: 1, prefix: '$', suffix: 'M' }), '$1234.5M');
});

test('formatCounter: group puts a comma every three digits, with the same decimals, prefix and suffix', () => {
  assert.equal(formatCounter(48200, { group: true }), '48,200');
  assert.equal(formatCounter(1234567.891, { group: true, decimals: 2 }), '1,234,567.89');
  assert.equal(formatCounter(-9876543, { group: true, prefix: '$' }), '$-9,876,543');
  assert.equal(formatCounter(999, { group: true }), '999');
  assert.equal(formatCounter(0, { group: true, decimals: 1, suffix: '%' }), '0.0%');
});

test('formatCounter: group is the same on every machine (no locale from the environment)', () => {
  assert.equal(formatCounter(1000000, { group: true }), '1,000,000');
});

test('a counter takes group: true; a non-boolean is an error and a text does not take the field', () => {
  assert.deepEqual(errs(film({ group: true })), []);
  assert.ok(errs(film({ group: 'yes' })).some((e) => e.startsWith('scenes[0].elements[0].group: must be boolean')), errs(film({ group: 'yes' })).join('|'));
  const text = { scenes: [{ id: 's', duration: 3, elements: [{ id: 't', type: 'text', text: 'x', x: 0, y: 0, group: true }] }] };
  assert.ok(errs(text).some((e) => e.startsWith('scenes[0].elements[0].group: not valid on text')), errs(text).join('|'));
});

test('kpi-counter takes group: true and hands it to the counter it draws; without it the counter has no group field', () => {
  const block = (params) => ({ scenes: [{ id: 's', duration: 4, elements: [{ id: 'k', type: 'block', x: 960, y: 540, block: 'kpi-counter', params: { label: 'Users', to: 48200, ...params } }] }] });
  assert.deepEqual(errs(block({ group: true })), []);
  const counterOf = (spec) => flattenElements(expandSpec(withDefaults(spec)).scenes[0].elements).map(({ el }) => el).find((el) => el.type === 'counter');
  assert.equal(counterOf(block({ group: true })).group, true);
  assert.equal('group' in counterOf(block({})), false);
});
