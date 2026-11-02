// Task 26 (part): comparison-split, before-after and notification-stack. The table-driven suite in blocks.test.mjs covers
// their examples and limits; these cover what is particular to each.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLOCKS, expandBlocks } from '../template/blocks/index.mjs';
import { flattenElements } from '../template/groups.mjs';

const block = (name, params, extra = {}) => ({ id: 'b', type: 'block', x: 960, y: 451, block: name, params, ...extra });
const oneScene = (elements, extra = {}, duration = 6) => ({ ...extra, scenes: [{ id: 's', duration, elements }] });
const partsOf = (spec) => flattenElements(spec.scenes[0].elements).map(({ el }) => el).filter((el) => el.type !== 'group');
const part = (spec, id) => partsOf(spec).find((el) => el.id === id);

test('comparison-split: side by side on 16:9, stacked on 9:16, the right card in the accent colour', () => {
  const params = BLOCKS['comparison-split'].example;
  const wide = expandBlocks(oneScene([block('comparison-split', params)]));
  assert.equal(part(wide, 'b/left-card').y, part(wide, 'b/right-card').y, 'the same row');
  assert.ok(part(wide, 'b/left-card').x < part(wide, 'b/right-card').x);
  const tall = expandBlocks(oneScene([block('comparison-split', params, { x: 540, y: 721 })], { format: '9:16' }));
  assert.equal(part(tall, 'b/left-card').x, part(tall, 'b/right-card').x, 'the same column');
  assert.ok(part(tall, 'b/left-card').y < part(tall, 'b/right-card').y);
  assert.equal(part(wide, 'b/right-card').stroke, 'accent');
  assert.equal(part(wide, 'b/left-card').height, part(wide, 'b/right-card').height, 'the cards match in height');
  assert.equal(part(wide, 'b/right-point-3').text, params.right.points[2]);
});

test('before-after: the after number counts up from the before number, and both share their decimals', () => {
  const spec = expandBlocks(oneScene([block('before-after', { before: { label: 'Before', value: 94, suffix: 's' }, after: { label: 'After', value: 12.5, suffix: 's' } })]));
  const before = part(spec, 'b/before-value');
  const after = part(spec, 'b/after-value');
  assert.deepEqual([before.from, before.to, after.from, after.to], [0, 94, 94, 12.5]);
  assert.deepEqual([before.decimals, after.decimals, after.suffix], [1, 1, 's']);
  assert.ok(after.keyframes[0].t > before.keyframes[0].t, 'the after card comes in later');
  assert.equal(part(spec, 'b/arrow').arrow, 'end');
});

test('notification-stack: five long cards that cannot all fit fade the oldest out where it is, and each arrives in turn', () => {
  const long = (i) => ({ app: `Application ${i}`, title: `A fairly long notification title ${i}`, body: 'The body text runs on for a good while so that it wraps over several lines' });
  const params = { items: [1, 2, 3, 4, 5].map(long), stagger: 0.4 };
  const spec = expandBlocks(oneScene([block('notification-stack', params, { x: 960, y: 451 })], { format: '1:1', size: [1080, 1080] }, 8));
  const first = part(spec, 'b/card-1');
  assert.equal(first.keyframes.at(-1).opacity, 0, 'the oldest card ends hidden');
  const last = part(spec, 'b/card-5');
  assert.equal(last.keyframes.at(-1).opacity, 1, 'the newest card stays');
  const starts = [1, 2, 3, 4, 5].map((k) => part(spec, `b/card-${k}`).keyframes[0].t);
  assert.deepEqual(starts.map((t, i) => Math.abs(t - i * 0.4) < 1e-9), [true, true, true, true, true], 'one every stagger');
  // When they all fit nothing moves after its entrance.
  const small = expandBlocks(oneScene([block('notification-stack', { items: [long(1), long(2)] })]));
  assert.ok(partsOf(small).every((el) => el.keyframes.length === 2));
});
