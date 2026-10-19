// The travelling light's state machine: no DOM, no three, a clock the test drives.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTravel, TRAVEL_SECONDS } from '../template/runtime/travel.js';

test('nothing travels until a path starts', () => {
  const travel = createTravel();
  assert.equal(travel.frame(), null);
  assert.equal(travel.active, false);
  assert.equal(travel.tick(5), null);
});

test('a path runs from its start to its end over TRAVEL_SECONDS, eased', () => {
  const travel = createTravel();
  assert.deepEqual(travel.start('e0'), { id: 'e0', at: 0, done: false });
  assert.equal(travel.active, true);
  assert.deepEqual(travel.tick(10), { id: 'e0', at: 0, done: false }, 'the first tick starts the clock');
  const mid = travel.tick(10 + TRAVEL_SECONDS / 2);
  assert.ok(Math.abs(mid.at - 0.5) < 1e-9 && mid.done === false, 'smoothstep is 0.5 at the middle');
  assert.deepEqual(travel.tick(10 + TRAVEL_SECONDS + 1), { id: 'e0', at: 1, done: true });
  assert.equal(travel.active, false, 'a finished light stops asking for frames');
  assert.deepEqual(travel.tick(99), { id: 'e0', at: 1, done: true }, 'and stays at the end');
});

test('a reversed path runs end to start', () => {
  const travel = createTravel();
  assert.deepEqual(travel.start('e0', { reverse: true }), { id: 'e0', at: 1, done: false });
  travel.tick(0);
  assert.equal(travel.tick(TRAVEL_SECONDS).at, 0);
  assert.equal(travel.frame().done, true);
});

test('instant jumps to the end of the path (reduced motion): the far end, or the start when reversed', () => {
  const travel = createTravel();
  assert.deepEqual(travel.start('e0', { instant: true }), { id: 'e0', at: 1, done: true });
  assert.equal(travel.active, false);
  assert.deepEqual(travel.start('e1', { reverse: true, instant: true }), { id: 'e1', at: 0, done: true });
});

test('a new path restarts the clock; no path hides the light', () => {
  const travel = createTravel();
  travel.start('e0');
  travel.tick(100);
  travel.start('e1');
  assert.deepEqual(travel.tick(200), { id: 'e1', at: 0, done: false }, 'a fresh clock');
  assert.equal(travel.start(null), null);
  assert.equal(travel.active, false);
  assert.equal(travel.tick(300), null);
});

test('finish settles a running light at its end', () => {
  const travel = createTravel();
  travel.start('e0');
  travel.tick(1);
  assert.deepEqual(travel.finish(), { id: 'e0', at: 1, done: true });
  assert.equal(travel.finish() && travel.active, false);
  const none = createTravel();
  assert.equal(none.finish(), null);
});

test('a clock that runs backwards never leaves 0..1', () => {
  const travel = createTravel();
  travel.start('e0');
  travel.tick(50);
  const early = travel.tick(10);
  assert.equal(early.at, 0);
});
