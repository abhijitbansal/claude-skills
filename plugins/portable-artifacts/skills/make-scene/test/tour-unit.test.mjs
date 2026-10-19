// The tour state machine: no DOM, no three, a fake scheduler.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTour, dwellFor, BASE_DWELL_MS } from '../template/runtime/chrome/tour.js';

const BEATS = [
  { title: 'one', caption: '', focus: 'api' },
  { title: 'two', caption: 'x'.repeat(100), focus: 'web' },
  { title: 'three', caption: '', focus: 'db' },
];

// A scheduler the test drives by hand: fire() runs the one pending callback.
function fakeClock() {
  let pending = null;
  let nextId = 1;
  return {
    schedule: (fn, ms) => {
      pending = { id: nextId++, fn, ms };
      return pending.id;
    },
    cancel: (id) => {
      if (pending?.id === id) pending = null;
    },
    get delay() {
      return pending?.ms ?? null;
    },
    fire() {
      const { fn } = pending;
      pending = null;
      fn();
    },
  };
}

function make(options = {}) {
  const clock = fakeClock();
  const entered = [];
  const tour = createTour(BEATS, { ...clock, onBeat: (beat, info) => entered.push({ title: beat.title, ...info }), ...options });
  return { tour, clock, entered };
}

test('tour starts before the first beat, not playing', () => {
  const { tour, entered } = make();
  assert.deepEqual(tour.state, { index: -1, playing: false, count: 3 });
  assert.deepEqual(entered, []);
});

test('tour play/next/prev/go bounds', () => {
  const { tour } = make();
  tour.go(99);
  assert.equal(tour.state.index, 2, 'go() clamps to the last beat');
  tour.go(-5);
  assert.equal(tour.state.index, 0, 'go() clamps to the first beat');
  tour.go(1.5);
  tour.go(Number.NaN);
  tour.go('1');
  assert.equal(tour.state.index, 0, 'a non-integer is ignored');
  tour.prev();
  assert.equal(tour.state.index, 0, 'prev stays on the first beat');
  tour.next();
  tour.next();
  tour.next();
  assert.equal(tour.state.index, 2, 'next stays on the last beat');
  assert.equal(tour.state.playing, false);
});

test('play starts on beat 1 and advances after the dwell, then stops at the last beat', () => {
  const { tour, clock, entered } = make();
  tour.play();
  assert.deepEqual(tour.state, { index: 0, playing: true, count: 3 });
  assert.equal(clock.delay, BASE_DWELL_MS);
  clock.fire();
  assert.equal(tour.state.index, 1);
  assert.equal(clock.delay, dwellFor(BEATS[1]), 'a long caption stays longer');
  assert.ok(clock.delay > BASE_DWELL_MS);
  clock.fire();
  assert.equal(tour.state.index, 2);
  clock.fire();
  assert.deepEqual(tour.state, { index: 2, playing: false, count: 3 }, 'the end of the tour pauses it there');
  assert.equal(clock.delay, null, 'no timer left running');
  assert.deepEqual(entered.map((e) => e.title), ['one', 'two', 'three']);
});

test('pause cancels the timer; toggle flips; play at the end starts over', () => {
  const { tour, clock } = make();
  tour.toggle();
  assert.equal(tour.state.playing, true);
  tour.toggle();
  assert.equal(tour.state.playing, false);
  assert.equal(clock.delay, null);
  tour.go(2);
  tour.play();
  assert.deepEqual(tour.state, { index: 0, playing: true, count: 3 });
});

test('stepping while playing restarts the dwell for the new beat', () => {
  const { tour, clock } = make();
  tour.play();
  tour.next();
  assert.equal(tour.state.index, 1);
  assert.equal(clock.delay, dwellFor(BEATS[1]));
});

test('reduced motion tour cuts', () => {
  let reduced = true;
  const { tour, clock, entered } = make({ reducedMotion: () => reduced });
  tour.play();
  clock.fire();
  tour.next();
  assert.deepEqual(entered.map((e) => e.instant), [true, true, true], 'every beat, timed or stepped, is an instant cut');
  reduced = false;
  tour.prev();
  assert.equal(entered.at(-1).instant, false, 'reduced motion is read live: the next beat flies');
});

test('an empty tour does nothing and never throws', () => {
  const tour = createTour([]);
  tour.play();
  tour.next();
  tour.prev();
  tour.go(0);
  tour.toggle();
  assert.deepEqual(tour.state, { index: -1, playing: false, count: 0 });
});

test('onChange reports every change with the new state', () => {
  const seen = [];
  const { tour } = make({ onChange: (s) => seen.push(`${s.index}${s.playing ? '>' : '|'}`) });
  tour.play();
  tour.next();
  tour.pause();
  assert.deepEqual(seen, ['0>', '1>', '1|']);
});
