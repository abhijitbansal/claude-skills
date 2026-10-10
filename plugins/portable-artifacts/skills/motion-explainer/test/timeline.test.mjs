import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eases } from 'animejs';
import { buildTimeline, seekTo } from '../template/timeline.mjs';
import { EASES } from '../scripts/lib/spec.mjs';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

function spec(scenes) {
  return { scenes };
}
const text = (id, keyframes, extra = {}) => ({ id, type: 'text', text: id, x: 100, y: 200, keyframes, ...extra });

test('linear midpoint', () => {
  const { timeline, states } = buildTimeline(spec([
    { id: 's1', duration: 4, elements: [text('a', [{ t: 0, x: 0 }, { t: 2, x: 100 }])] },
  ]));
  seekTo(timeline, 1);
  near(states.get('a').x, 50);
});

test('ease is applied (outQuad at 50% is not 0.5)', () => {
  const { timeline, states } = buildTimeline(spec([
    { id: 's1', duration: 4, elements: [text('a', [{ t: 0, x: 0 }, { t: 2, x: 100, ease: 'outQuad' }])] },
  ]));
  seekTo(timeline, 1);
  near(states.get('a').x, 75, 1e-3);
});

test('holds before the first keyframe and after the last', () => {
  const { timeline, states } = buildTimeline(spec([
    { id: 's1', duration: 6, elements: [text('a', [{ t: 1, opacity: 0.2 }, { t: 2, opacity: 1 }])] },
  ]));
  seekTo(timeline, 0);
  near(states.get('a').opacity, 0.2);
  seekTo(timeline, 0.5);
  near(states.get('a').opacity, 0.2);
  seekTo(timeline, 1.5);
  near(states.get('a').opacity, 0.6);
  seekTo(timeline, 5);
  near(states.get('a').opacity, 1);
  seekTo(timeline, 0);
  near(states.get('a').opacity, 0.2);
});

test('prop absent from a middle keyframe interpolates across it', () => {
  const { timeline, states } = buildTimeline(spec([
    { id: 's1', duration: 6, elements: [text('a', [
      { t: 0, x: 0, opacity: 0 },
      { t: 1, opacity: 1 },
      { t: 2, x: 100, opacity: 0 },
    ])] },
  ]));
  seekTo(timeline, 1);
  near(states.get('a').x, 50);
  near(states.get('a').opacity, 1);
  seekTo(timeline, 1.5);
  near(states.get('a').x, 75);
  near(states.get('a').opacity, 0.5);
});

test('multi-segment track survives back and forth seeking', () => {
  const { timeline, states } = buildTimeline(spec([
    { id: 's1', duration: 5, elements: [text('a', [
      { t: 0, x: 0 }, { t: 1, x: 100 }, { t: 2, x: 50 }, { t: 3, x: 200 },
    ])] },
  ]));
  const at = (s) => { seekTo(timeline, s); return states.get('a').x; };
  near(at(0.5), 50);
  near(at(1.5), 75);
  near(at(2.5), 125);
  near(at(4), 200);
  near(at(1), 100);
  near(at(0), 0);
  near(at(2), 50);
  near(at(0.25), 25);
  near(at(10), 200);
});

test('base value used for props no keyframe sets', () => {
  const { timeline, states } = buildTimeline(spec([
    { id: 's1', duration: 2, elements: [text('a', [{ t: 0, opacity: 0 }, { t: 1, opacity: 1 }])] },
  ]));
  seekTo(timeline, 1);
  assert.equal(states.get('a').x, 100);
  assert.equal(states.get('a').y, 200);
  assert.equal(states.get('a').scale, 1);
});

test('second scene offsets shift by the first duration; sceneStarts/sceneOf', () => {
  const { timeline, states, sceneStarts, sceneOf, duration } = buildTimeline(spec([
    { id: 's1', duration: 3, elements: [text('a', [{ t: 0, x: 0 }, { t: 1, x: 10 }])] },
    { id: 's2', duration: 2, elements: [text('b', [{ t: 0, x: 0 }, { t: 1, x: 100 }])] },
  ]));
  assert.deepEqual(sceneStarts, [0, 3]);
  assert.equal(sceneOf.get('b'), 1);
  assert.equal(duration, 5);
  seekTo(timeline, 3.5);
  near(states.get('b').x, 50);
  near(states.get('a').x, 10);
});

test('fade transition drives scene opacity 0 -> 1 over 0.4s', () => {
  const { timeline, states } = buildTimeline(spec([
    { id: 's1', duration: 3, transition: 'fade', elements: [] },
    { id: 's2', duration: 3, elements: [] },
  ]));
  seekTo(timeline, 0);
  near(states.get('scene:s1').opacity, 0);
  seekTo(timeline, 0.2);
  near(states.get('scene:s1').opacity, 0.5);
  seekTo(timeline, 1);
  near(states.get('scene:s1').opacity, 1);
  near(states.get('scene:s2').opacity, 1);
});

test('seek is idempotent', () => {
  const { timeline, states } = buildTimeline(spec([
    { id: 's1', duration: 3, elements: [text('a', [{ t: 0, x: 0, opacity: 0 }, { t: 2, x: 100, opacity: 1, ease: 'inOutCubic' }])] },
  ]));
  const snap = () => JSON.stringify(states.get('a'));
  seekTo(timeline, 1.5); const first = snap();
  seekTo(timeline, 0.2);
  seekTo(timeline, 1.5);
  assert.equal(snap(), first);
});

test('counter value tracks and defaults to from', () => {
  const { timeline, states } = buildTimeline(spec([
    { id: 's1', duration: 4, elements: [
      { id: 'c', type: 'counter', from: 5, to: 20, x: 0, y: 0, keyframes: [{ t: 1, value: 5 }, { t: 3, value: 20 }] },
      { id: 'd', type: 'counter', from: 7, to: 9, x: 0, y: 0 },
    ] },
  ]));
  seekTo(timeline, 2);
  near(states.get('c').value, 12.5);
  seekTo(timeline, 0);
  assert.equal(states.get('d').value, 7);
});

test('counter without value keyframes animates from -> to over min(2, 0.8*duration) with outCubic', () => {
  const mk = (duration) => buildTimeline(spec([
    { id: 's1', duration, elements: [{ id: 'd', type: 'counter', from: 10, to: 110, x: 0, y: 0 }] },
  ]));
  const long = mk(10);
  seekTo(long.timeline, 0);
  near(long.states.get('d').value, 10);
  seekTo(long.timeline, 1);
  near(long.states.get('d').value, 10 + 100 * (1 - 0.5 ** 3), 1e-3); // outCubic at 50%
  seekTo(long.timeline, 2);
  near(long.states.get('d').value, 110);
  seekTo(long.timeline, 9);
  near(long.states.get('d').value, 110);
  const short = mk(1); // 0.8s
  seekTo(short.timeline, 0.8);
  near(short.states.get('d').value, 110);
  seekTo(short.timeline, 0.4);
  near(short.states.get('d').value, 10 + 100 * (1 - 0.5 ** 3), 1e-3);
});

test('every EASES name resolves in anime v4 and animates', () => {
  for (const ease of EASES) {
    const { timeline, states } = buildTimeline(spec([
      { id: 's1', duration: 2, elements: [text('a', [{ t: 0, x: 0 }, { t: 1, x: 100, ease }])] },
    ]));
    seekTo(timeline, 1);
    near(states.get('a').x, 100, 1e-3);
    seekTo(timeline, 0.5);
    const v = states.get('a').x;
    assert.ok(Number.isFinite(v), `${ease} gave ${v}`);
    if (ease !== 'linear') assert.ok(typeof eases[ease] === 'function', `${ease} missing in eases`);
  }
});
