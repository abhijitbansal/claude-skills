import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertNoDroppedShapes } from '../vendor-sketch-assets.mjs';

const nodes = { 'circle-divide': [['circle', {}], ['line', {}], ['line', {}], ['line', {}]], minus: [['path', {}]] };
const line = [[0, 0], [1, 1]];

test('assertNoDroppedShapes passes when every shape has a polyline and the counts agree', () => {
  assert.doesNotThrow(() => assertNoDroppedShapes({
    'circle-divide': { lines: [line, line, line, line], expected: 4 },
    minus: { lines: [line], expected: 1 },
  }, nodes));
});

test('guardrail proof: an icon that lost a shape (the two dots of a divide sign) fails loudly, naming it', () => {
  assert.throws(() => assertNoDroppedShapes({
    'circle-divide': { lines: [line, line], expected: 4 },
    minus: { lines: [line], expected: 1 },
  }, nodes), /1 icon\(s\) lost a shape while flattening: circle-divide \(2 polylines, 4 shapes, 4 expected\)/);
});

test('guardrail proof: fewer polylines than source shapes fails even when the page counted fewer drawn ones', () => {
  assert.throws(() => assertNoDroppedShapes({ 'circle-divide': { lines: [line, line, line], expected: 3 }, minus: { lines: [line], expected: 1 } }, nodes), /circle-divide \(3 polylines, 4 shapes, 3 expected\)/);
});
