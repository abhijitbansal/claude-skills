import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromeChanged } from '../template/chrome-change.mjs';

const base = { scenes: [] };

test('chromeChanged: an edit to scenes alone keeps the in-place remount', () => {
  assert.equal(chromeChanged(base, { scenes: [{ id: 'x' }] }), false);
  assert.equal(chromeChanged({ ...base, generatedBy: { model: 'A' } }, { scenes: [1], generatedBy: { model: 'A' } }), false);
});

test('chromeChanged: generatedBy or theme edits force a full reload', () => {
  assert.equal(chromeChanged(base, { ...base, generatedBy: { model: 'A' } }), true);
  assert.equal(chromeChanged({ ...base, generatedBy: { model: 'A' } }, { ...base, generatedBy: { model: 'B' } }), true);
  assert.equal(chromeChanged(base, { ...base, theme: 'ink' }), true);
});

test('chromeChanged: a page opened on an unreadable spec reloads once the spec carries chrome', () => {
  assert.equal(chromeChanged(null, { ...base, generatedBy: { model: 'A' } }), true);
  assert.equal(chromeChanged(null, base), false);
});
