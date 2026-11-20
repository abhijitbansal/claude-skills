import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHex, mix, rgba } from '../../engine/fields/color.mjs';

test('parseHex reads #rrggbb in either case into 0-255 channels', () => {
  assert.deepEqual(parseHex('#ff8000'), [255, 128, 0]);
  assert.deepEqual(parseHex('#AbCdEf'), [171, 205, 239]);
});

test('parseHex rejects anything that is not #rrggbb', () => {
  for (const bad of ['red', '#fff', '#12345', '#gggggg', 'ff8000', '', 7, null, undefined]) {
    assert.throws(() => parseHex(bad), /colour must be #rrggbb/);
  }
});

test('mix returns the first colour at 0, the second at 1 and the rounded midpoint between', () => {
  assert.equal(mix('#102030', '#ffffff', 0), '#102030');
  assert.equal(mix('#102030', '#ffffff', 1), '#ffffff');
  assert.equal(mix('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(mix('#ff0000', '#0000ff', 0.25), '#bf0040');
});

test('mix returns lowercase #rrggbb whatever the input case', () => {
  assert.equal(mix('#ABCDEF', '#ABCDEF', 0.5), '#abcdef');
});

test('mix rejects a weight outside 0..1 or not a number', () => {
  assert.throws(() => mix('#000000', '#ffffff', -0.1), /mix weight must be a number in \[0, 1\]/);
  assert.throws(() => mix('#000000', '#ffffff', 1.1), /mix weight must be a number in \[0, 1\]/);
  assert.throws(() => mix('#000000', '#ffffff', NaN), /mix weight must be a number in \[0, 1\]/);
  assert.throws(() => mix('#000000', '#ffffff', '0.5'), /mix weight must be a number in \[0, 1\]/);
});

test('mix names the bad colour', () => {
  assert.throws(() => mix('nope', '#ffffff', 0.5), /colour must be #rrggbb/);
  assert.throws(() => mix('#ffffff', '#12', 0.5), /colour must be #rrggbb/);
});

test('rgba turns a hex colour and an alpha into a canvas colour string', () => {
  assert.equal(rgba('#ff8000', 0.5), 'rgba(255, 128, 0, 0.5)');
  assert.equal(rgba('#000000', 0), 'rgba(0, 0, 0, 0)');
  assert.equal(rgba('#ffffff', 1), 'rgba(255, 255, 255, 1)');
});

test('rgba rejects an alpha outside 0..1', () => {
  assert.throws(() => rgba('#000000', 1.5), /alpha must be a number in \[0, 1\]/);
  assert.throws(() => rgba('#000000', -1), /alpha must be a number in \[0, 1\]/);
  assert.throws(() => rgba('#000000', undefined), /alpha must be a number in \[0, 1\]/);
});
