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
function load(data, hooks) {
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
  const story = win.PADiagram.story(stage, svg, data, els, camera, hooks || {});
  return { story, moves, timers, frames, dot };
}

test('a step beat glides at the camera default (300 ms) and a story beat at 450 ms; both divide by the speed', () => {
  const steps = load(STEPS);
  steps.story.present(0);
  assert.deepEqual(steps.moves.at(-1), { ms: 300 }, 'the camera is asked for its own pace');
  assert.equal(steps.timers.at(-1).ms, 300, 'and the beat waits that long before its hold');
  steps.story.setSpeed(2);
  steps.story.goTo(1);
  assert.deepEqual([steps.moves.at(-1), steps.timers.at(-1).ms], [{ ms: 150 }, 150]);

  const hops = load(HOPS);
  hops.story.present(0);
  assert.deepEqual([hops.moves.at(-1), hops.timers.at(-1).ms], [{ ms: 450 }, 450]);
  hops.story.setSpeed(2);
  hops.story.goTo(1);
  assert.deepEqual([hops.moves.at(-1), hops.timers.at(-1).ms], [{ ms: 225 }, 225]);
});

// The ms the hold timer is armed with for one step beat (no dot, so one fired timer reaches the hold).
function holdArmedFor(caption, speed) {
  const data = { ...STEPS, beats: [beat('step', { title: 'One', ids: ['a'], reveal: ['a'], ...(caption === null ? {} : { caption }) })] };
  const { story, timers } = load(data);
  story.setSpeed(speed);
  story.present(0);
  story.play();
  timers.at(-1).fn(); // the glide is over: a step beat goes straight to its hold
  return timers.at(-1).ms;
}

test('a caption holds 1800 + 30 ms per character: none 1800, 50 chars 3300, both divided by the speed', () => {
  assert.equal(holdArmedFor(null, 1), 1800, 'no caption: HOLD_MS alone');
  assert.equal(holdArmedFor('x'.repeat(50), 1), 3300, '1800 + 30*50, under the cap');
  assert.equal(holdArmedFor('x'.repeat(50), 2), 1650, 'at 2x the hold halves');
});

test('a 160-character caption hits the 4500 ms hold cap at 1x, and 2250 at 2x', () => {
  assert.equal(holdArmedFor('x'.repeat(160), 1), 4500, '1800 + 30*160 = 6600, capped');
  assert.equal(holdArmedFor('x'.repeat(160), 2), 2250);
});

test('the dot travels a hop for 900 ms at 1x and 450 ms at 2x, and the hold starts when it lands', () => {
  for (const [speed, ms] of [[1, 900], [2, 450]]) {
    const { story, timers, frames } = load(HOPS);
    story.setSpeed(speed);
    story.present(0);
    timers.at(-1).fn(); // the glide is over: the dot sets off
    const armed = timers.length;
    const first = frames.length - 1;
    frames[first](0); // t0
    frames[first + 1](ms - 1);
    assert.equal(timers.length, armed, `${ms - 1} ms in, the dot is still travelling`);
    frames[first + 2](ms);
    assert.equal(timers.length, armed + 1, `at ${ms} ms the dot lands and the hold timer is armed`);
  }
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

test('reframe keeps the running beat: the camera glides to the same target again and no timer restarts', () => {
  const { story, moves, timers } = load(HOPS);
  story.play(); // goTo(0): one glide move, one timer waiting for the glide
  const before = timers.length;
  story.reframe();
  assert.equal(timers.length, before, 'no new timer: the beat under way keeps its clock');
  assert.equal(moves.length, 2, 'one more camera move');
  assert.deepEqual(moves.at(-1), { ms: 450 }, 'a story beat re-glides at its own pace (a jump would cut the entry glide short)');
  assert.equal(story.isPlaying(), true);
  assert.equal(story.index(), 0);
  const steps = load(STEPS);
  steps.story.setSpeed(2);
  steps.story.present(1);
  steps.story.reframe();
  assert.deepEqual(steps.moves.at(-1), { ms: 150 }, 'a step beat re-glides at the camera pace over the speed');
  const idle = load(HOPS);
  idle.story.reframe();
  assert.deepEqual(idle.moves, [], 'outside Play there is nothing to reframe');
});

// ---- hold hooks: onHold(ms) / onHoldEnd() ---------------------------------------------------
// A step beat has no dot, so one fired timer (the glide) reaches the hold.
// `calls` holds the hold hooks only; `order` also records onStep (the transport repaint).
function holdHarness(data, speed) {
  const calls = [];
  const order = [];
  const h = load(data, {
    onHold: (ms) => { calls.push(['hold', ms]); order.push('hold'); },
    onHoldEnd: () => { calls.push(['end']); order.push('end'); },
    onStep: () => order.push('step'),
  });
  if (speed) h.story.setSpeed(speed);
  return { ...h, calls, order };
}
const captioned = (n) => ({ ...STEPS, beats: [
  beat('step', { title: 'One', ids: ['a'], reveal: ['a'], caption: 'x'.repeat(n) }),
  beat('step', { title: 'Two', ids: ['b'], reveal: ['b'], caption: 'x'.repeat(n) }),
] });

test('play fires onHold once with 1800+30*chars divided by speed', () => {
  const { story, timers, calls } = holdHarness(captioned(50));
  story.play();
  assert.deepEqual(calls, [], 'the glide comes first: no hold yet');
  timers.at(-1).fn(); // glide over: the hold is armed
  assert.deepEqual(calls, [['hold', 3300]]);
});

test('speed 2x halves the reported ms', () => {
  const { story, timers, calls } = holdHarness(captioned(50), 2);
  story.play();
  timers.at(-1).fn();
  assert.deepEqual(calls, [['hold', 1650]]);
});

test('pause during a hold fires onHoldEnd before anything else', () => {
  const { story, timers, calls, order } = holdHarness(captioned(50));
  story.play();
  timers.at(-1).fn();
  calls.length = 0;
  order.length = 0;
  story.pause();
  assert.deepEqual(order, ['end', 'step'], 'the hold ends before the transport repaints');
  assert.deepEqual(calls, [['end']]);
  story.pause();
  assert.deepEqual(calls, [['end']], 'a second pause is a no-op: the hold ended exactly once');
});

test('goTo during a hold fires onHoldEnd then onHold for the new beat', () => {
  const { story, timers, calls } = holdHarness(captioned(50));
  story.play();
  timers.at(-1).fn();
  calls.length = 0;
  story.goTo(1);
  assert.deepEqual(calls, [['end']], 'the old hold ends at once; the new beat glides before it holds');
  timers.at(-1).fn();
  assert.deepEqual(calls, [['end'], ['hold', 3300]]);
});

test('goTo while paused fires neither hook', () => {
  const { story, timers, calls } = holdHarness(captioned(50));
  story.present(0);
  timers.at(-1).fn(); // the hold timer is armed while paused
  story.goTo(1);
  timers.at(-1).fn();
  story.exit();
  assert.deepEqual(calls, []);
});

test('the last beat with loop off fires onHold then onHoldEnd when the hold expires', () => {
  const { story, timers, calls } = holdHarness(captioned(50));
  story.play();
  timers.at(-1).fn();
  timers.at(-1).fn(); // hold expires: beat 1 (still not last)
  assert.deepEqual(calls, [['hold', 3300], ['end']], 'expiring into the next beat ends the hold once');
  calls.length = 0;
  timers.at(-1).fn(); // beat 1's glide over: its hold
  assert.deepEqual(calls, [['hold', 3300]]);
  timers.at(-1).fn(); // last beat, loop off: the hold expires into pause()
  assert.equal(story.isPlaying(), false);
  assert.deepEqual(calls, [['hold', 3300], ['end']], 'ended exactly once, not once for expiry and again for pause');
});

test('exit during a hold fires onHoldEnd once', () => {
  const { story, timers, calls } = holdHarness(captioned(50));
  story.play();
  timers.at(-1).fn();
  calls.length = 0;
  story.exit();
  assert.deepEqual(calls, [['end']]);
  story.exit();
  assert.deepEqual(calls, [['end']], 'a second exit is a no-op');
});

test('the last beat with loop on: the hold ends at expiry, then beat 0 holds after its glide', () => {
  const { story, timers, calls } = holdHarness(captioned(50));
  story.setLoop(true);
  story.play();
  timers.at(-1).fn(); // beat 0 hold
  timers.at(-1).fn(); // expiry into beat 1
  timers.at(-1).fn(); // beat 1 glide over: its hold
  calls.length = 0;
  timers.at(-1).fn(); // the last beat's hold expires into goTo(0)
  assert.deepEqual(calls, [['end']], 'ended at once; beat 0 is still gliding');
  assert.equal(story.index(), 0);
  timers.at(-1).fn(); // beat 0's glide over
  assert.deepEqual(calls, [['end'], ['hold', 3300]]);
});

test('a hold armed while paused reports nothing; play() on that beat reports exactly one hold and the stale timer does nothing', () => {
  const { story, timers, calls } = holdHarness(captioned(50));
  story.present(0);
  timers.at(-1).fn(); // paused: the hold timer is armed
  const stale = timers.at(-1);
  assert.deepEqual(calls, []);
  story.play();
  assert.deepEqual(calls, [], 'play re-runs the beat from its glide');
  timers.at(-1).fn();
  assert.deepEqual(calls, [['hold', 3300]]);
  stale.fn();
  assert.deepEqual(calls, [['hold', 3300]], 'the stale paused timer is dead');
  assert.equal(story.index(), 0);
});

test('setSpeed mid-hold fires nothing; the next beat reports the new ms', () => {
  const { story, timers, calls } = holdHarness(captioned(50));
  story.play();
  timers.at(-1).fn();
  calls.length = 0;
  story.setSpeed(2);
  assert.deepEqual(calls, [], 'the hold under way keeps its clock');
  timers.at(-1).fn(); // expiry into beat 1
  assert.deepEqual(calls, [['end']]);
  assert.equal(timers.at(-1).ms, 150, 'beat 1 glides at the new speed');
  timers.at(-1).fn();
  assert.deepEqual(calls, [['end'], ['hold', 1650]]);
});

test('a hop beat reports its hold after the dot lands, not before', () => {
  const { story, timers, frames, calls } = holdHarness(HOPS);
  story.play();
  timers.at(-1).fn(); // glide over: the dot sets off
  assert.deepEqual(calls, [], 'no hold while the dot travels');
  const first = frames.length - 1;
  frames[first](0);
  frames[first + 1](899);
  assert.deepEqual(calls, []);
  frames[first + 2](900);
  assert.deepEqual(calls, [['hold', 1800]]);
});

test('a dot frame that outlives its run reports no hold', () => {
  const { story, timers, frames, calls } = holdHarness(HOPS);
  story.play();
  timers.at(-1).fn(); // the dot sets off
  const first = frames.length - 1;
  frames[first](0);
  story.goTo(1); // a new run; the fake cancelAnimationFrame cancels nothing
  frames[first + 1](900); // the old dot lands anyway
  assert.deepEqual(calls, [], 'a stale landing neither reports a hold nor leaves one open');
  story.pause();
  assert.deepEqual(calls, [], 'and pausing has no hold to end');
});

test('a throwing onHold still leaves the hold timer armed', () => {
  const h = load(captioned(50), { onHold: () => { throw new Error('hook'); } });
  h.story.play();
  const before = h.timers.length;
  assert.throws(() => h.timers.at(-1).fn(), /hook/);
  assert.equal(h.timers.length, before + 1, 'the timer was armed before the hook ran');
});
