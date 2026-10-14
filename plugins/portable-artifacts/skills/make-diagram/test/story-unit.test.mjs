// PADiagram.story (template/story.js) in Node: a bare `window` with fakes for
// the stage, the svg, the camera and the timers, so call order and durations
// are deterministic (no browser, no clock). camera.js comes along for
// PADiagram.dict; its factory is never called.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = ['camera.js', 'story.js'].map((f) => fs.readFileSync(new URL(`../template/${f}`, import.meta.url), 'utf8')).join('\n');

// An element that records every class added and every attribute set, in order.
function fakeEl() {
  const classes = new Set();
  const log = [];
  const el = {
    log,
    attrs: {},
    path: null,
    classList: {
      add: (...c) => c.forEach((x) => { classes.add(x); log.push(x); }),
      remove: (...c) => c.forEach((x) => classes.delete(x)),
      toggle: (c, on) => { if (on) classes.add(c); else classes.delete(c); },
      contains: (c) => classes.has(c),
    },
    setAttribute(name, value) { el.attrs[name] = value; log.push(name); },
    getAttribute(name) { return el.attrs[name] ?? null; },
    querySelector() { return el.path; },
  };
  return el;
}
// A straight 100-unit edge from (0, 0) to (100, 0).
const straight = { getTotalLength: () => 100, getPointAtLength: (l) => ({ x: l, y: 0 }) };

const beat = (kind, extra) => ({ kind, chapter: 0, title: kind, edge: null, reverse: false, ids: [], reveal: [], highlight: [], ...extra });
const STEPS = {
  type: 'flow', ids: ['a', 'b'], edges: { 'edge-0': ['a', 'b'] }, parents: {}, frames: [],
  beats: [beat('step', { title: 'One', ids: ['a'], reveal: ['a'] }), beat('step', { title: 'Two', ids: ['b'], reveal: ['b'] })],
  chapters: [{ id: 'walkthrough', title: 'Walkthrough', start: 0, end: 2 }],
};
const HOPS = {
  type: 'flow', ids: ['a', 'b'], edges: { 'edge-0': ['a', 'b'] }, parents: {}, frames: [],
  beats: [beat('hop', { title: 'There', edge: 'edge-0', ids: ['a', 'b'] }), beat('hop', { title: 'Back', edge: 'edge-0', reverse: true, ids: ['a', 'b'] })],
  chapters: [{ id: 's', title: 'S', start: 0, end: 2 }],
};

// Loads the modules on a bare window and mounts a story over fakes. Timers and
// animation frames are recorded, never run: a test fires the one it wants.
function load(data) {
  const timers = [];
  const frames = [];
  const moves = [];
  const dot = fakeEl();
  const win = {
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: () => {},
    requestAnimationFrame: (fn) => { frames.push(fn); return frames.length; },
    cancelAnimationFrame: () => {},
    document: { createElementNS: () => dot },
  };
  new Function('window', src)(win);
  const stage = fakeEl();
  const svg = { namespaceURI: 'svg', querySelectorAll: () => [], appendChild: () => {} };
  const edge = fakeEl();
  edge.path = straight;
  const els = { nodes: Object.create(null), groups: Object.create(null), edges: Object.create(null), labels: Object.create(null), lifelines: [], frames: [], notes: [] };
  for (const id of Object.keys(data.edges)) els.edges[id] = edge;
  const camera = {
    reduced: () => false, unfit() {}, fit() {}, glideMs: () => 300,
    fitCamera: () => ({ cx: 0, cy: 0, s: 1 }), cameraFor: () => ({ cx: 0, cy: 0, s: 1 }), boxOf: () => null, unionBox: (a, b) => a || b,
    moveTo: (target, options) => { moves.push(options || {}); },
  };
  const story = win.PADiagram.story(stage, svg, data, els, camera, {});
  return { story, moves, timers, frames, dot };
}

test('a step beat glides at the camera default (300 ms) and a story beat at 600 ms; both divide by the speed', () => {
  const steps = load(STEPS);
  steps.story.present(0);
  assert.deepEqual(steps.moves.at(-1), { ms: 300 }, 'the camera is asked for its own pace');
  assert.equal(steps.timers.at(-1).ms, 300, 'and the beat waits that long before its hold');
  steps.story.setSpeed(2);
  steps.story.goTo(1);
  assert.deepEqual([steps.moves.at(-1), steps.timers.at(-1).ms], [{ ms: 150 }, 150]);

  const hops = load(HOPS);
  hops.story.present(0);
  assert.deepEqual([hops.moves.at(-1), hops.timers.at(-1).ms], [{ ms: 600 }, 600]);
  hops.story.setSpeed(2);
  hops.story.goTo(1);
  assert.deepEqual([hops.moves.at(-1), hops.timers.at(-1).ms], [{ ms: 300 }, 300]);
});

test('the dot is placed on the first point of its edge before it shows, and on the last point for a reverse hop', () => {
  const { story, timers, dot } = load(HOPS);
  story.present(0);
  timers.at(-1).fn(); // the glide is over: the dot sets off
  assert.deepEqual(dot.log.slice(-3), ['cx', 'cy', 'pa-dot-on'], 'position first, then visible');
  assert.deepEqual([dot.attrs.cx, dot.attrs.cy], ['0', '0']);
  story.goTo(1);
  timers.at(-1).fn();
  assert.deepEqual([dot.attrs.cx, dot.attrs.cy], ['100', '0'], 'a reverse hop starts at the far end');
  assert.ok(dot.log.lastIndexOf('pa-dot-on') > dot.log.lastIndexOf('cy'), 'shown only after it moved');
});

test('a timeline with beats but no chapters: prev chapter goes to the first beat, next chapter to the last, nothing throws', () => {
  const { story } = load({ ...HOPS, chapters: [] });
  story.present(1);
  assert.doesNotThrow(() => story.prevChapter());
  assert.equal(story.index(), 0);
  story.nextChapter();
  assert.equal(story.index(), 1);
  assert.equal(story.chapter(), 0);
});
