// DOM-free tests for the preview audio controller, driven with fake media elements.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { audioController } from '../template/preview-audio.mjs';

const HAVE_FUTURE_DATA = 3;

function domError(name) { const e = new Error(name); e.name = name; return e; }

function fakeEl({ rejectPlay = false, rejectWith = 'NotSupportedError' } = {}) {
  const el = {
    paused: true, currentTime: 0, muted: false, volume: 1, ended: false, duration: 10, seeking: false,
    readyState: HAVE_FUTURE_DATA, plays: 0, seeks: 0,
    play() { this.plays++; if (rejectPlay) return Promise.reject(domError(rejectWith)); this.paused = false; return Promise.resolve(); },
    pause() { this.paused = true; },
  };
  return new Proxy(el, { set(target, key, value) { if (key === 'currentTime') target.seeks++; target[key] = value; return true; } });
}
const track = (el, extra = {}) => ({ el, start: 0, end: 10, volume: 1, fadeIn: 0, fadeOut: 0, ...extra });

test('a track whose play() is rejected is not retried on every frame', async () => {
  const el = fakeEl({ rejectPlay: true });
  const ctl = audioController(() => [track(el)]);
  ctl.update(0, true);
  await Promise.resolve();
  ctl.update(0.1, true);
  ctl.update(0.2, true);
  assert.equal(el.plays, 1);
});

test('drift re-sync waits while the element is seeking or has no future data', () => {
  const el = fakeEl();
  const ctl = audioController(() => [track(el)]);
  ctl.update(0, true);
  assert.equal(el.paused, false);
  el.seeking = true;
  ctl.update(2, true); // 2 s of drift, but the element is still seeking
  assert.equal(el.seeks, 1, 'no re-seek while seeking');
  el.seeking = false;
  el.readyState = HAVE_FUTURE_DATA - 1;
  ctl.update(3, true);
  assert.equal(el.seeks, 1, 'no re-seek while buffering');
  el.readyState = HAVE_FUTURE_DATA;
  ctl.update(4, true);
  assert.equal(el.seeks, 2, 're-seeks once data is available');
});

test('a NotAllowedError (no user gesture yet) is retried, so the next real Play still works', async () => {
  const el = fakeEl({ rejectPlay: true, rejectWith: 'NotAllowedError' });
  const ctl = audioController(() => [track(el)]);
  ctl.update(0, true);
  await Promise.resolve();
  ctl.update(0.1, true);
  assert.equal(el.plays, 2);
});

test('a track that reports ended is not restarted every frame when the browser over-reports its duration', async () => {
  const el = fakeEl();
  const t = track(el, { start: 0, end: 6 });
  const ctl = audioController(() => [t]);
  ctl.update(0, true);
  await Promise.resolve();
  el.paused = true; el.ended = true; el.duration = 5.5; // decodable audio ended at 2 s, header says 5.5
  for (const time of [2.0, 2.1, 2.2, 2.3, 2.4]) ctl.update(time, true);
  assert.equal(el.plays, 1, 'no restart churn after ended');
  ctl.update(1.0, true); // user scrubbed back into the clip
  assert.equal(el.plays, 2, 'rewinding restarts the clip');
});
