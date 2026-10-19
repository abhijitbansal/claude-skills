import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IDLE_MS, createLoop, isBusy, pixelRatio } from '../template/runtime/loop.js';

// A manual clock and rAF: step() runs the one queued frame at the next 16 ms tick.
function harness(renderResult = false) {
  let time = 0;
  let nextId = 1;
  let queued = null;
  const calls = { render: 0, cancelled: 0 };
  const state = { busy: renderResult };
  const loop = createLoop({
    render: () => {
      calls.render += 1;
      return state.busy;
    },
    now: () => time,
    raf: (cb) => {
      queued = { id: nextId, cb };
      nextId += 1;
      return queued.id;
    },
    caf: (id) => {
      if (queued?.id === id) queued = null;
      calls.cancelled += 1;
    },
  });
  return {
    loop,
    calls,
    state,
    get running() { return queued !== null; },
    step(ms = 16) {
      time += ms;
      const frame = queued;
      queued = null;
      frame?.cb(time);
    },
    advance(ms) {
      for (let waited = 0; waited < ms && queued; waited += 16) this.step(16);
    },
  };
}

test('loop sleeps after idle and wakes on input', () => {
  const h = harness(false);
  assert.equal(h.running, false, 'nothing queued before the first wake');
  h.loop.wake('input');
  assert.equal(h.running, true);
  h.advance(IDLE_MS - 100);
  assert.equal(h.running, true, 'still inside the idle window');
  h.advance(400);
  assert.equal(h.running, false, 'asleep once idle for IDLE_MS');
  const rendered = h.calls.render;
  h.loop.wake('input');
  assert.equal(h.running, true);
  h.step();
  assert.equal(h.calls.render, rendered + 1);
});

test('a wake inside render (OrbitControls fires change from update) never double-schedules', () => {
  let loop;
  let scheduled = 0;
  let queued = null;
  loop = createLoop({
    render: () => {
      loop.wake('change');
      return true;
    },
    now: () => 0,
    raf: (cb) => {
      scheduled += 1;
      queued = cb;
      return scheduled;
    },
    caf: () => {},
  });
  loop.wake('start');
  for (let i = 0; i < 5; i++) {
    const cb = queued;
    queued = null;
    const before = scheduled;
    cb();
    assert.equal(scheduled - before, 1, `frame ${i} queued exactly one follow-up`);
  }
});

test('wake while running restarts the idle window', () => {
  const h = harness(false);
  h.loop.wake('input');
  h.advance(IDLE_MS - 100);
  h.loop.wake('input');
  h.advance(IDLE_MS - 100);
  assert.equal(h.running, true);
  h.advance(400);
  assert.equal(h.running, false);
});

test('loop pauses when hidden or offscreen', () => {
  const h = harness(true);
  h.loop.wake('start');
  h.step();
  h.loop.setVisible(false);
  assert.equal(h.running, false, 'offscreen: cancelled even though busy');
  h.loop.wake('input');
  assert.equal(h.running, false, 'wake does not run an offscreen scene');
  h.loop.setVisible(true);
  assert.equal(h.running, true, 'back on screen: renders again');
  h.loop.setActive(false);
  assert.equal(h.running, false, 'hidden tab: cancelled');
  h.loop.wake('input');
  assert.equal(h.running, false);
  h.loop.setActive(true);
  assert.equal(h.running, true);
  const rendered = h.calls.render;
  h.step();
  assert.equal(h.calls.render, rendered + 1);
});

test('loop keeps running while render reports busy, and sleep() stops it', () => {
  const h = harness(true);
  h.loop.wake('start');
  h.advance(IDLE_MS * 4);
  assert.equal(h.running, true, 'a busy render (orbit, tween, damping) is never idle');
  h.state.busy = false;
  h.advance(IDLE_MS + 100);
  assert.equal(h.running, false);
  h.loop.wake('input');
  h.loop.sleep();
  assert.equal(h.running, false);
});

test('loop keeps running while orbits animate unless reduced motion', () => {
  assert.equal(isBusy({ animated: true }), true);
  assert.equal(isBusy({ animated: true, reducedMotion: true }), false);
  assert.equal(isBusy({ animated: false }), false);
  assert.equal(isBusy({ damping: true }), true, 'damping settles even under reduced motion');
  assert.equal(isBusy({ tween: true, reducedMotion: true }), true);
  assert.equal(isBusy({ autoRotate: true }), true);
  assert.equal(isBusy({}), false);
});

test('pixel ratio is capped at 2, or 1.5 on coarse pointers', () => {
  assert.equal(pixelRatio(3, false), 2);
  assert.equal(pixelRatio(3, true), 1.5);
  assert.equal(pixelRatio(1, false), 1);
  assert.equal(pixelRatio(1.25, true), 1.25);
  assert.equal(pixelRatio(0, false), 1, 'a missing ratio falls back to 1');
  assert.equal(pixelRatio(undefined, true), 1);
});

test('no Math.random in runtime or build sources', () => {
  const skill = fileURLToPath(new URL('..', import.meta.url));
  const hits = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(m?js|cjs)$/.test(entry.name) && /Math\s*\.\s*random/.test(fs.readFileSync(full, 'utf8'))) hits.push(path.relative(skill, full));
    }
  };
  walk(path.join(skill, 'template', 'runtime'));
  walk(path.join(skill, 'scripts'));
  assert.deepEqual(hits, [], 'determinism: seed with seedFrom, never Math.random');
});
