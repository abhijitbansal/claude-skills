// The travelling light's state machine: no DOM, no three, a clock the test drives.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTravel, easeFlight, TRAVEL_SECONDS } from '../template/runtime/travel.js';

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

// The light's position at `seconds` into a run that started on clock 0.
function atSeconds(seconds, options) {
  const travel = createTravel();
  travel.start('e0', options);
  travel.tick(0);
  return travel.tick(seconds).at;
}

test('the eased position is 0 at 0 and 1 at 1 and never leaves [0, 1]', () => {
  assert.equal(atSeconds(0), 0);
  assert.equal(atSeconds(TRAVEL_SECONDS), 1);
  for (const reverse of [false, true]) {
    for (let s = -1; s <= TRAVEL_SECONDS * 2; s += TRAVEL_SECONDS / 40) {
      const at = atSeconds(s, { reverse });
      assert.ok(at >= 0 && at <= 1, `at ${at} outside [0, 1] at ${s} s (reverse ${reverse})`);
    }
  }
});

test('speed is zero at both ends: the light eases out of its start and into its end', () => {
  const dt = 1e-3; // seconds
  const meanSpeed = 1 / TRAVEL_SECONDS;
  const startSpeed = (atSeconds(dt) - atSeconds(0)) / dt;
  const endSpeed = (atSeconds(TRAVEL_SECONDS) - atSeconds(TRAVEL_SECONDS - dt)) / dt;
  assert.ok(startSpeed < meanSpeed * 0.01, `start speed ${startSpeed}`);
  assert.ok(endSpeed < meanSpeed * 0.01, `end speed ${endSpeed}`);
  const midSpeed = (atSeconds(TRAVEL_SECONDS / 2 + dt) - atSeconds(TRAVEL_SECONDS / 2)) / dt;
  assert.ok(midSpeed > meanSpeed, 'and it is fastest in the middle');
});

test('reverse mirrors forward at every instant', () => {
  for (let s = 0; s <= TRAVEL_SECONDS; s += TRAVEL_SECONDS / 24) {
    assert.ok(Math.abs(atSeconds(s, { reverse: true }) - (1 - atSeconds(s))) < 1e-12, `at ${s} s`);
  }
});

// Camera flight ease (the duration rule is in tour-unit.test.mjs).
test('the camera flight ease is 0 at 0 and 1 at 1, stays in [0, 1], and clamps outside', () => {
  assert.equal(easeFlight(0), 0);
  assert.equal(easeFlight(1), 1);
  assert.equal(easeFlight(-3), 0);
  assert.equal(easeFlight(7), 1);
  for (let k = 0; k <= 1; k += 0.01) assert.ok(easeFlight(k) >= 0 && easeFlight(k) <= 1);
});

test('the camera flight ease is at rest at both ends, never goes backwards, and mirrors itself', () => {
  const dk = 1e-3;
  assert.ok((easeFlight(dk) - easeFlight(0)) / dk < 0.01, 'at rest at the start');
  assert.ok((easeFlight(1) - easeFlight(1 - dk)) / dk < 0.01, 'at rest at the end');
  assert.ok((easeFlight(0.5 + dk) - easeFlight(0.5)) / dk > 1.5, 'quick in the middle');
  let last = 0;
  for (let k = 0; k <= 1; k += 0.01) {
    assert.ok(easeFlight(k) >= last - 1e-12, `non-decreasing at ${k}`);
    assert.ok(Math.abs(easeFlight(k) + easeFlight(1 - k) - 1) < 1e-12, `mirror at ${k}`);
    last = easeFlight(k);
  }
});
