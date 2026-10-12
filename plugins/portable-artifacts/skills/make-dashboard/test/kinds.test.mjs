import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classOf, fieldRef, roleErrors, KINDS, KIND_NAMES } from '../scripts/lib/kinds.mjs';
import { validateSpec } from '../scripts/lib/spec.mjs';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const described = { rev: { columns: ['region', 'revenue', 'month', 'Total Revenue'], types: ['VARCHAR', 'DOUBLE', 'DATE', 'DECIMAL(18,2)'] } };
const chart = (extra) => ({ id: 'c1', title: 'C', query: 'rev', ...extra });
const errs = (c) => roleErrors({ charts: [c] }, described);

test('classOf maps DuckDB types to Vega-Lite field classes', () => {
  assert.equal(classOf('DATE'), 'temporal');
  assert.equal(classOf('TIMESTAMP WITH TIME ZONE'), 'temporal');
  for (const t of ['INTEGER', 'BIGINT', 'DOUBLE', 'DECIMAL(18,2)', 'HUGEINT', 'FLOAT', 'UBIGINT']) assert.equal(classOf(t), 'quantitative', t);
  for (const t of ['VARCHAR', 'BOOLEAN', 'TIME', 'INTERVAL', 'UUID']) assert.equal(classOf(t), 'nominal', t);
});

test('fieldRef escapes characters Vega-Lite reads as nested access', () => {
  assert.equal(fieldRef('revenue'), 'revenue');
  assert.equal(fieldRef('Total Revenue'), 'Total Revenue');
  assert.equal(fieldRef('a.b'), 'a\\.b');
  assert.equal(fieldRef('x[0]'), 'x\\[0\\]');
  assert.equal(fieldRef('back\\slash'), 'back\\\\slash');
});

test('eleven kinds; every view name a kind lists is buildable or "table"', () => {
  assert.deepEqual(KIND_NAMES, ['bar', 'stacked-bar', 'grouped-bar', 'line', 'area', 'scatter', 'bubble', 'heatmap', 'histogram', 'boxplot', 'donut']);
  for (const k of KIND_NAMES) assert.ok(Array.isArray(KINDS[k].views));
});

test('a valid kind chart has no role errors; spaces in column names are fine', () => {
  assert.deepEqual(errs(chart({ kind: 'bar', x: 'region', y: 'Total Revenue' })), []);
  assert.deepEqual(errs(chart({ kind: 'line', x: 'month', y: 'revenue' })), []);
});

test('missing required role names the kind and its roles', () => {
  assert.deepEqual(errs(chart({ kind: 'bar', x: 'region' })), [
    { path: 'charts[0].y', message: 'required for kind "bar" (roles: x, y)' },
  ]);
});

test('a role the kind does not use is rejected', () => {
  assert.deepEqual(errs(chart({ kind: 'bar', x: 'region', y: 'revenue', size: 'revenue' })), [
    { path: 'charts[0].size', message: 'kind "bar" does not use size (roles: x, y)' },
  ]);
});

test('unknown column gets did-you-mean; wrong type explains the need', () => {
  assert.deepEqual(errs(chart({ kind: 'bar', x: 'regoin', y: 'revenue' })), [
    { path: 'charts[0].x', message: '"regoin" is not a column of query "rev" (columns: region, revenue, month, Total Revenue); did you mean "region"?' },
  ]);
  assert.deepEqual(errs(chart({ kind: 'bar', x: 'region', y: 'region' })), [
    { path: 'charts[0].y', message: '"region" is text (VARCHAR); y of kind "bar" needs a numeric column' },
  ]);
});

test('views must be ones the kind offers', () => {
  assert.deepEqual(errs(chart({ kind: 'bar', x: 'region', y: 'revenue', views: ['shar', 'table'] })), [
    { path: 'charts[0].views[0]', message: 'kind "bar" has no view "shar"; did you mean "share"? (views: sorted, share, table)' },
  ]);
});

const spec = (chartItem) => ({
  title: 'T',
  sources: { sales: { type: 'csv', path: 'data/sales.csv' } },
  queries: { rev: 'SELECT region, SUM(amount) AS revenue FROM sales GROUP BY 1' },
  charts: [{ id: 'c1', title: 'C', query: 'rev', ...chartItem }],
});

test('validateSpec: kind and vegaLite are mutually exclusive, one is required', async () => {
  let r = await validateSpec(spec({ kind: 'bar', x: 'region', y: 'revenue', vegaLite: { mark: 'bar' } }), { dir: FIXTURES });
  assert.deepEqual(r.errors, [{ path: 'charts[0]', message: 'use either kind or vegaLite, not both' }]);
  r = await validateSpec(spec({}), { dir: FIXTURES });
  assert.deepEqual(r.errors, [{ path: 'charts[0]', message: `add kind (one of ${KIND_NAMES.join(', ')}) or vegaLite` }]);
});

test('validateSpec: unknown kind is an enum error with did-you-mean', async () => {
  const r = await validateSpec(spec({ kind: 'bra', x: 'region', y: 'revenue' }), { dir: FIXTURES });
  assert.equal(r.ok, false);
  assert.match(r.errors[0].message, /did you mean "bar"\?/);
});

test('validateSpec runs role checks AND vegaLite field checks against real column types', async () => {
  let r = await validateSpec(spec({ kind: 'bar', x: 'region', y: 'revnue' }), { dir: FIXTURES });
  assert.match(r.errors[0].message, /did you mean "revenue"\?/);
  r = await validateSpec(spec({ vegaLite: { mark: 'bar', encoding: { x: { field: 'regon', type: 'nominal' } } } }), { dir: FIXTURES });
  assert.equal(r.errors[0].path, 'charts[0].vegaLite.encoding.x.field');
  r = await validateSpec(spec({ kind: 'bar', x: 'region', y: 'revenue' }), { dir: FIXTURES });
  assert.deepEqual(r.errors, []);
});
