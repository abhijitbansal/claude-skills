// What a chart's title (its claim) names in the chart's own rows: a category on the x axis, or one month of a
// monthly series. Pure functions; the views use them to accent the claimed bar and annotate the claimed month.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { namedCategories, namedMonth } from '../scripts/lib/claim.mjs';

const REGIONS = ['East', 'South', 'West', 'North'];
const months = (year) => Array.from({ length: 12 }, (_, i) => Date.UTC(year, i, 1));

test('a category the title names as a whole word is claimed', () => {
  assert.deepEqual(namedCategories('East earns the most revenue', REGIONS), ['East']);
});

test('a title that names no category claims nothing', () => {
  assert.deepEqual(namedCategories('Revenue by region', REGIONS), []);
});

test('every category the title names is claimed, in the rows\' order', () => {
  assert.deepEqual(namedCategories('West overtakes East in Q4', REGIONS), ['East', 'West']);
});

test('a category inside a longer word is not claimed: East is not in Northeast', () => {
  assert.deepEqual(namedCategories('Northeast trails the rest', ['East', 'Northeast', 'South']), ['Northeast']);
});

test('only values present in the rows are claimed, matched by case', () => {
  assert.deepEqual(namedCategories('gadget and Widget', ['Gadget', 'Widget', 'Gizmo']), ['Widget']);
  assert.deepEqual(namedCategories('Gadget sells the most units', ['Gadget', '', null, 7]), ['Gadget']);
});

test('a value with regex characters is matched literally', () => {
  assert.deepEqual(namedCategories('C++ (beta) leads', ['C++ (beta)', 'C+++', 'Rust']), ['C++ (beta)']);
});

test('a month the title names is found in a monthly series, full name or short', () => {
  assert.equal(namedMonth('August is the peak revenue month', months(2025)), Date.UTC(2025, 7, 1));
  assert.equal(namedMonth('Revenue dips in Feb', months(2025)), Date.UTC(2025, 1, 1));
});

test('"may" the verb is not the month; "May" the month is', () => {
  assert.equal(namedMonth('Revenue may fall next year', months(2025)), null);
  assert.equal(namedMonth('May is the quietest month', months(2025)), Date.UTC(2025, 4, 1));
});

test('no month, a month missing from the rows, or one that occurs twice claims nothing', () => {
  assert.equal(namedMonth('Revenue by month', months(2025)), null);
  assert.equal(namedMonth('August is the peak', months(2025).slice(0, 6)), null);
  assert.equal(namedMonth('August is the peak', [...months(2024), ...months(2025)]), null, 'two Augusts: ambiguous');
});

test('a month inside a longer word is not claimed: Mar is not in Market', () => {
  assert.equal(namedMonth('Market share by month', months(2025)), null);
});
