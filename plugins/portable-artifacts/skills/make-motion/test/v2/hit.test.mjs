// hit.mjs: the preview's click-to-copy, the top-most drawn node under a point of a frame's snapshot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hitTest, copyLine } from '../../engine/page/hit.mjs';

const leaf = (type, id, bbox, extra = {}) => ({ type, id, bbox, opacity: 1, children: [], ...extra });
const group = (id, children, extra = {}) => ({ type: 'group', id, bbox: [0, 0, 0, 0], opacity: 1, children, ...extra });
const SHOTS = ['intro', 'price'];

test('the top-most of two overlapping nodes wins', () => {
  const snap = [group('price', [leaf('image', 'price.picture.image', [0, 0, 100, 100]), leaf('text', 'price.hero', [10, 10, 50, 20])])];
  assert.equal(hitTest(snap, 20, 15, SHOTS).node, 'price.hero');
  assert.equal(hitTest(snap, 80, 80, SHOTS).node, 'price.picture.image');
});

test('a point outside every box is null, and a field (the background) is never hit', () => {
  const snap = [leaf('field', 'price.field', [0, 0, 1920, 1080]), leaf('text', 'price.hero', [10, 10, 50, 20])];
  assert.equal(hitTest(snap, 500, 500, SHOTS), null);
});

test('a caption and a fixed overlay drawn after the picture are hit before it', () => {
  const snap = [
    group('price', [leaf('image', 'price.picture.image', [0, 0, 1920, 1080])]),
    leaf('text', 'price.captions.line0', [100, 900, 400, 60]),
  ];
  const hit = hitTest(snap, 150, 920, SHOTS);
  assert.equal(hit.node, 'price.captions.line0');
});

test('a hidden node, or a node under a hidden parent, is not hit', () => {
  const snap = [
    leaf('image', 'price.picture.image', [0, 0, 100, 100]),
    leaf('text', 'price.gone', [0, 0, 100, 100], { opacity: 0 }),
    group('price.card', [leaf('path', 'price.card.plate', [0, 0, 100, 100])], { opacity: 0 }),
  ];
  assert.equal(hitTest(snap, 50, 50, SHOTS).node, 'price.picture.image');
});

test('the path names the shot index and the id the author wrote', () => {
  const hit = hitTest([leaf('text', 'price.hero', [0, 0, 10, 10])], 5, 5, SHOTS);
  assert.deepEqual(hit, { shot: 1, path: 'shots[1]', id: 'price', node: 'price.hero' });
  assert.equal(copyLine(hit), 'shots[1]  id=price  node=price.hero');
});

test('a node whose id names no shot (a free shot\'s own ids) belongs to the shot on screen', () => {
  const hit = hitTest([leaf('path', 'bar', [0, 0, 10, 10])], 5, 5, SHOTS, { current: 1 });
  assert.deepEqual(hit, { shot: 1, path: 'shots[1]', id: 'price', node: 'bar' });
});

test('a node whose id names no shot is still hit, with no shot', () => {
  const hit = hitTest([leaf('text', 'loose', [0, 0, 10, 10])], 5, 5, SHOTS);
  assert.deepEqual(hit, { shot: null, path: null, id: null, node: 'loose' });
  assert.equal(copyLine(hit), 'node=loose');
});
