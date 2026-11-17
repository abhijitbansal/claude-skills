// PA-48 confirmed defects, decided in pure code (no DOM, no three): what Escape closes, and who owns an arrow key
// pressed on the canvas. The browser half (a real key press with the canvas focused) is in runtime-fixes-browser.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrowOwner, escapeAction } from '../template/runtime/keys.js';

test('Escape closes Explore and full screen as before, and now the tour when nothing else is open', () => {
  assert.equal(escapeAction({ exploreOpen: true, fullscreenOn: false, touring: true }), 'panels', 'a panel first: the tour stays');
  assert.equal(escapeAction({ exploreOpen: false, fullscreenOn: true, touring: false }), 'panels');
  assert.equal(escapeAction({ exploreOpen: false, fullscreenOn: false, touring: true }), 'tour');
  assert.equal(escapeAction({ exploreOpen: false, fullscreenOn: false, touring: false }), null, 'nothing open: the key is not ours');
});

test('while the tour is open the left and right arrows step beats, even on the canvas; the other arrows still orbit', () => {
  assert.equal(arrowOwner('ArrowRight', { touring: true }), 'tour');
  assert.equal(arrowOwner('ArrowLeft', { touring: true }), 'tour');
  assert.equal(arrowOwner('ArrowUp', { touring: true }), 'camera');
  assert.equal(arrowOwner('ArrowDown', { touring: true }), 'camera');
});

test('with no tour open every arrow on the canvas orbits the camera, and other keys are nobody\'s here', () => {
  for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) assert.equal(arrowOwner(key, { touring: false }), 'camera', key);
  assert.equal(arrowOwner('e', { touring: true }), null);
  assert.equal(arrowOwner('Escape', { touring: false }), null);
});
