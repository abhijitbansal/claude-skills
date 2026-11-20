// The tour state machine: no DOM, no three, a fake scheduler.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from 'three';
import { createControls } from '../template/runtime/controls.js';
import { createTour, dwellFor, BASE_DWELL_MS } from '../template/runtime/chrome/tour.js';
import { flightMsFor, FLY_MIN_MS, FLY_MAX_MS } from '../template/runtime/travel.js'; // the camera flight rule lives beside the travelling light

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

test('a beat\'s flight time grows with distance and is capped', () => {
  assert.ok(FLY_MIN_MS > 0 && FLY_MIN_MS < FLY_MAX_MS, 'a floor below a cap');
  assert.equal(flightMsFor(0), FLY_MIN_MS, 'no move still settles for the floor');
  const spans = [0.1, 0.25, 0.5, 1];
  const times = spans.map((span) => flightMsFor(span));
  for (let i = 1; i < times.length; i += 1) assert.ok(times[i] > times[i - 1], `${spans[i]} takes longer than ${spans[i - 1]}`);
  assert.ok(times.every((ms) => ms >= FLY_MIN_MS && ms <= FLY_MAX_MS));
  assert.equal(flightMsFor(1000), FLY_MAX_MS, 'a very long hop is capped');
  assert.equal(flightMsFor(Infinity), FLY_MAX_MS);
  assert.equal(flightMsFor(Number.NaN), FLY_MIN_MS, 'a span that is not a number reads as no move');
  assert.equal(flightMsFor(-4), FLY_MIN_MS, 'a negative span is no move');
});

test('the camera flies for the time its span asks for: a near hop lands early, a far one runs to the cap', () => {
  const root = { addEventListener() {}, removeEventListener() {} };
  const dom = { ...root, style: {}, getRootNode: () => root, ownerDocument: root };
  const fly = (to) => {
    const camera = new PerspectiveCamera(45, 1, 0.1, 1000);
    camera.position.set(0, 0, 10);
    const api = createControls({ camera, dom, target: new Vector3(0, 0, 0), polarMax: Math.PI, distance: 10, reducedMotion: () => false, onInput() {} });
    api.flyTo({ position: to, target: [0, 0, 0] });
    api.update(1000, 0.016); // the first frame fixes the flight's zero
    return (afterMs) => api.update(1000 + afterMs, 0.016).tween;
  };
  const near = fly([0, 0, 10.5]); // span 0.05 view distances
  assert.equal(near(FLY_MIN_MS - 100), true, 'still flying before the floor is up');
  assert.equal(near(flightMsFor(0.05) + 1), false, 'landed once its time is up');
  const far = fly([0, 0, -20]); // span 3: capped
  assert.equal(far(flightMsFor(0.05) + 1), true, 'a far hop is still flying when a near one has landed');
  assert.equal(far(FLY_MAX_MS - 1), true);
  assert.equal(far(FLY_MAX_MS + 1), false, 'and lands at the cap');
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
