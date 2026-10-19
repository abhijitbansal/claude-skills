// Unit checks for the runtime fixes F10 and F12 (no DOM, no three): the zoom floor, the tour's hold, the loop's viewable signal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { minDistanceFor } from '../template/runtime/controls.js';
import { nearestFocusDistance } from '../template/runtime/fit.js';
import { createLoop } from '../template/runtime/loop.js';
import { createTour, dwellFor } from '../template/runtime/chrome/tour.js';

test('F10: the zoom floor is 0.15 overviews for a small scene and stays clear of the nearest authored view in a big one', () => {
  assert.equal(minDistanceFor(40, Infinity), 6);
  assert.equal(minDistanceFor(40, 20), 6, 'no focus view closer than the floor: the old rule');
  assert.ok(Math.abs(minDistanceFor(155.8, 10.15) - 9.135) < 1e-9, 'a focus view at 10.15 can be reached');
  assert.equal(minDistanceFor(155.8, 0), 0.2, 'a degenerate view still leaves a small floor');
});

test('F10: nearestFocusDistance reads the closest authored view and ignores empty ones', () => {
  const focus = { a: { position: [0, 0, 10], target: [0, 0, 0] }, b: { position: [3, 4, 0], target: [0, 0, 0] }, c: { position: [1, 1, 1], target: [1, 1, 1] } };
  assert.equal(nearestFocusDistance(focus), 5);
  assert.equal(nearestFocusDistance({}), Infinity);
  assert.equal(nearestFocusDistance(undefined), Infinity);
});

const BEATS = [{ title: 'one', caption: '', focus: 'a' }, { title: 'two', caption: '', focus: 'b' }, { title: 'three', caption: '', focus: 'c' }];
function heldTour() {
  let time = 0;
  let pending = null;
  const entered = [];
  const tour = createTour(BEATS, {
    now: () => time,
    schedule: (fn, ms) => { pending = { fn, ms, at: time }; return pending; },
    cancel: (id) => { if (pending === id) pending = null; },
    onBeat: (beat) => entered.push(beat.title),
  });
  return { tour, entered, advance: (ms) => { time += ms; }, get pending() { return pending; }, fire() { const { fn } = pending; pending = null; fn(); } };
}

test('F12: hold(true) cancels the dwell timer and keeps the tour playing; hold(false) runs out the time that was left', () => {
  const w = heldTour();
  w.tour.play();
  assert.equal(w.pending.ms, dwellFor(BEATS[0]));
  w.advance(1500);
  w.tour.hold(true);
  assert.equal(w.pending, null, 'no timer while held');
  assert.equal(w.tour.state.playing, true, 'still playing');
  w.advance(60000);
  assert.equal(w.entered.length, 1, 'nothing advanced');
  w.tour.hold(false);
  assert.equal(w.pending.ms, dwellFor(BEATS[0]) - 1500, 'the beat gets what it had left');
  w.fire();
  assert.deepEqual(w.entered, ['one', 'two']);
});

test('F12: a tour held before it plays starts its first beat full length once released; hold is idempotent', () => {
  const w = heldTour();
  w.tour.hold(true);
  w.tour.hold(true);
  w.tour.play();
  assert.equal(w.pending, null, 'held: no timer even though playing');
  w.tour.hold(false);
  w.tour.hold(false);
  assert.equal(w.pending.ms, dwellFor(BEATS[0]));
});

test('F12: the loop reports when it becomes viewable or not, once per change', () => {
  const loop = createLoop({ render: () => false, now: () => 0, raf: () => 1, caf: () => {}, visible: false });
  const seen = [];
  const off = loop.onViewable((on) => seen.push(on));
  assert.equal(loop.viewable(), false, 'an observer that has not reported is not seen');
  loop.setVisible(true);
  loop.setVisible(true);
  loop.setActive(false);
  loop.setVisible(false);
  loop.setActive(true);
  loop.setVisible(true);
  assert.deepEqual(seen, [true, false, true]);
  off();
  loop.setActive(false);
  assert.deepEqual(seen, [true, false, true], 'unsubscribed');
});
