import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sparklineSvg, trendValues } from '../scripts/lib/sparkline.mjs';

const SIZE = { width: 120, height: 28 };

test('same values give the same svg, and it is one path plus an end dot with no script', () => {
  const a = sparklineSvg([3, 1, 4, 1, 5], SIZE);
  assert.equal(a, sparklineSvg([3, 1, 4, 1, 5], SIZE));
  assert.match(a, /^<svg [^>]*aria-hidden="true"[^>]*>/);
  assert.equal(a.match(/<path /g)?.length, 1);
  assert.equal(a.match(/<circle /g)?.length, 1);
  assert.doesNotMatch(a, /<script|on[a-z]+=|href|url\(/i);
});

test('the path uses numbers only and stays inside the box', () => {
  const svg = sparklineSvg([10, 20, 15, 30], SIZE);
  const d = /<path [^>]*d="([^"]+)"/.exec(svg)[1];
  assert.match(d, /^M[\d. ,L-]+$/);
  const nums = d.replace(/[ML]/g, ' ').trim().split(/[ ,]+/).map(Number);
  for (let i = 0; i < nums.length; i += 2) {
    assert.ok(nums[i] >= 0 && nums[i] <= SIZE.width, `x ${nums[i]}`);
    assert.ok(nums[i + 1] >= 0 && nums[i + 1] <= SIZE.height, `y ${nums[i + 1]}`);
  }
});

test('one value or none gives no sparkline', () => {
  assert.equal(sparklineSvg([], SIZE), '');
  assert.equal(sparklineSvg([7], SIZE), '');
  assert.equal(sparklineSvg([7, Number.NaN], SIZE), '', 'one finite value is still one value');
});

test('a non-finite value is skipped, never written', () => {
  const svg = sparklineSvg([1, Number.NaN, Infinity, 2, -Infinity, 3], SIZE);
  assert.doesNotMatch(svg, /NaN|Infinity/, 'no NaN or Infinity in the svg');
  assert.equal(/<path [^>]*d="([^"]+)"/.exec(svg)[1].split('L').length, 3, 'three finite points');
});

test('a flat series draws a level line in the middle, not a division by zero', () => {
  const svg = sparklineSvg([5, 5, 5], SIZE);
  assert.doesNotMatch(svg, /NaN|Infinity/);
  const ys = [...svg.matchAll(/[ML][\d.]+,([\d.]+)/g)].map((m) => Number(m[1]));
  assert.equal(new Set(ys).size, 1);
});

test('trendValues reads the field in query order, wide decimals as numbers, NULL and text skipped', () => {
  const rows = [{ v: 1 }, { v: '2.5' }, { v: null }, { v: 'n/a' }, { v: 4n }];
  assert.deepEqual(trendValues(rows, 'v'), [1, 2.5, 4]);
  assert.deepEqual(trendValues(undefined, 'v'), []);
});
