import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findTokens, bindWithNbsp, TOKEN_PATTERN } from '../nowrap.mjs';

const NBSP = ' ';

test('findTokens matches number-plus-unit tokens', () => {
  for (const text of ['87%', '+12 %', '1,204 ms', '$4.2k', '3×', '120ms', '−5 %', '2.5 GB', '5s']) {
    const found = findTokens(text);
    assert.equal(found.length, 1, text);
    assert.equal(found[0].text, text);
    assert.equal(found[0].start, 0);
    assert.equal(found[0].end, text.length);
  }
});

test('findTokens ignores ordinary nouns, versions, names and spaced single-letter units', () => {
  for (const text of ['12 files', '3 options', 'v1.2.3', 'H2O', 'Q4', '5 s', 'a 4 x 3 grid']) {
    assert.deepEqual(findTokens(text), [], text);
  }
});

test('findTokens reports offsets inside a sentence', () => {
  const text = 'up 1,204 ms and 87 %.';
  assert.deepEqual(findTokens(text), [
    { start: 3, end: 11, text: '1,204 ms' },
    { start: 16, end: 20, text: '87 %' },
  ]);
});

test('bindWithNbsp swaps the space inside each token and nothing else', () => {
  assert.equal(bindWithNbsp('up 1,204 ms and 87 %'), `up 1,204${NBSP}ms and 87${NBSP}%`);
  assert.equal(bindWithNbsp('12 files and 87%'), '12 files and 87%');
  assert.equal(bindWithNbsp(bindWithNbsp('2.5 GB')), `2.5${NBSP}GB`);
});

test('TOKEN_PATTERN is a source and flags pair that rebuilds the finder regex', () => {
  const re = new RegExp(TOKEN_PATTERN.source, TOKEN_PATTERN.flags);
  assert.ok(re.global);
  assert.equal('took 120ms'.match(re)[0], '120ms');
});
