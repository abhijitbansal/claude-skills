// W2P-M04: opening the Explore panel narrows the stage; the camera must not rescale or jump under the
// pointer. PADiagram.camera (template/camera.js) in Node over a fake stage and svg: no browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../template/camera.js', import.meta.url), 'utf8');

const PANEL_PX = 300;

function load() {
  const win = {};
  new Function('window', src)(win);
  const rect = { width: 1200, height: 700, left: 0, top: 0, right: 1200, bottom: 700 };
  const stage = {
    getBoundingClientRect: () => ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height }),
    querySelector: () => null,
    setAttribute() {},
  };
  const attrs = {};
  const svg = { setAttribute: (name, value) => { attrs[name] = value; } };
  const data = { width: 800, height: 400, boxes: { n: [380, 180, 40, 40] }, drawing: [0, 0, 800, 400] };
  const camera = win.PADiagram.camera(stage, svg, data, {});
  // Where a diagram point is drawn, in stage px, from the viewBox (the svg fills the stage).
  const screenX = (wx) => {
    const [vx, , vw] = attrs.viewBox.split(' ').map(Number);
    return ((wx - vx) / vw) * rect.width;
  };
  const scale = () => { const [, , vw] = attrs.viewBox.split(' ').map(Number); return rect.width / vw; };
  return { camera, rect, screenX, scale };
}

const openPanel = (rect) => () => { rect.width -= PANEL_PX; };
const closePanel = (rect) => () => { rect.width += PANEL_PX; };

test('opening the panel keeps every diagram point where it was drawn, and the scale', () => {
  const { camera, rect, screenX, scale } = load();
  camera.refit();
  const before = { x: screenX(380), s: scale() };
  camera.holdView(openPanel(rect));
  camera.apply(); // what the ResizeObserver would run after the layout change
  assert.ok(Math.abs(screenX(380) - before.x) < 0.01, `the node moved from ${before.x} to ${screenX(380)}`);
  assert.ok(Math.abs(scale() - before.s) < 1e-9, 'the camera rescaled');
});

test('closing the panel puts the view back', () => {
  const { camera, rect, screenX } = load();
  camera.refit();
  const start = screenX(380);
  camera.holdView(openPanel(rect));
  camera.holdView(closePanel(rect));
  camera.apply();
  assert.ok(Math.abs(screenX(380) - start) < 0.01, `${screenX(380)} vs ${start}`);
});

test('without holdView a fitted camera refits on the resize, so the drawing rescales (the bug this fixes)', () => {
  const { camera, rect, screenX, scale } = load();
  camera.refit();
  const before = { x: screenX(380), s: scale() };
  openPanel(rect)();
  camera.onResize();
  assert.ok(Math.abs(scale() - before.s) > 1e-6 || Math.abs(screenX(380) - before.x) > 1, 'a plain resize must move or rescale it');
});

test('after holdView the ResizeObserver callback does not refit (the view is no longer fitted)', () => {
  const { camera, rect, screenX } = load();
  camera.refit();
  camera.holdView(openPanel(rect));
  const x = screenX(380);
  camera.onResize();
  assert.ok(Math.abs(screenX(380) - x) < 0.01);
  assert.equal(camera.isFitted(), false);
});

test('a change that does not resize the stage leaves a fitted camera fitted', () => {
  const { camera } = load();
  camera.refit();
  camera.holdView(() => {});
  assert.equal(camera.isFitted(), true);
});
