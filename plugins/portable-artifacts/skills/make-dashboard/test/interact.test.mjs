import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addTooltips, enhanceRaw } from '../scripts/lib/interact.mjs';

test('addTooltips turns string marks into objects with tooltip, keeps explicit choices', () => {
  assert.deepEqual(addTooltips({ mark: 'bar' }), { mark: { type: 'bar', tooltip: true } });
  assert.deepEqual(addTooltips({ mark: { type: 'line', tooltip: false } }), { mark: { type: 'line', tooltip: false } });
  assert.deepEqual(addTooltips({ layer: [{ mark: 'rule' }] }), { layer: [{ mark: { type: 'rule', tooltip: true } }] });
});

test('enhanceRaw adds a legend filter for a nominal colour when the spec has no params', () => {
  const vl = enhanceRaw({ mark: 'bar', encoding: { x: { field: 'q' }, y: { field: 'r' }, color: { field: 'region', type: 'nominal' } } }, { region: 'nominal' });
  assert.deepEqual(vl.params, [{ name: 'pa_legend', select: { type: 'point', fields: ['region'] }, bind: 'legend' }]);
  assert.deepEqual(vl.encoding.opacity, { condition: { param: 'pa_legend', empty: true, value: 1 }, value: 0.2 });
});

test('enhanceRaw leaves specs with their own params alone, and zooms unit point charts', () => {
  const own = { params: [{ name: 'mine', value: 1 }], mark: 'bar', encoding: { color: { field: 'region', type: 'nominal' } } };
  assert.deepEqual(enhanceRaw(own, { region: 'nominal' }).params, own.params);
  const pts = enhanceRaw({ mark: 'point', encoding: { x: { field: 'a', type: 'quantitative' }, y: { field: 'b', type: 'quantitative' } } }, {});
  assert.deepEqual(pts.params, [{ name: 'pa_zoom', select: { type: 'interval' }, bind: 'scales' }]);
});
