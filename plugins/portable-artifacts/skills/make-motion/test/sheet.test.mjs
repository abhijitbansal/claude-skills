import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sheetTimes, sheetLayout, PHONE_WIDTH } from '../scripts/lib/sheet.mjs';

const near = (actual, expected) => {
  assert.equal(actual.length, expected.length, JSON.stringify(actual));
  actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 1e-3, `${i}: ${v} vs ${expected[i]} in ${JSON.stringify(actual)}`));
};
const el = (...ts) => ({ id: 'e', type: 'text', keyframes: ts.map((t) => ({ t, opacity: 1 })) });

test('sheetTimes: a 4 s scene with keyframes at 0 and 0.6 -> 0.1, 0.7, 85 %, last frame (the 0 keyframe dedupes into 0.1)', () => {
  near(sheetTimes({ duration: 4, elements: [el(0, 0.6)] }, 30), [0.1, 0.7, 3.4, 4 - 1 / 30]);
});

test('sheetTimes: a 1 s scene with no keyframes -> 0.1, 85 %, last frame', () => {
  near(sheetTimes({ duration: 1, elements: [] }, 30), [0.1, 0.85, 1 - 1 / 30]);
});

test('sheetTimes: a keyframe landing at the end is capped at duration - 1/fps and merges with the last frame', () => {
  near(sheetTimes({ duration: 1, elements: [el(0.95)] }, 30), [0.1, 0.85, 1 - 1 / 30]);
});

test('sheetTimes: times closer than 0.05 s collapse; the later one wins so the last frame survives', () => {
  near(sheetTimes({ duration: 1, elements: [el(0.84)] }, 30), [0.1, 0.85, 1 - 1 / 30]); // 0.94 is 0.027 s from the last frame
  near(sheetTimes({ duration: 4, elements: [el(3.2)] }, 30), [0.1, 3.3, 3.4, 4 - 1 / 30]);
  near(sheetTimes({ duration: 4, elements: [el(3.27)] }, 30), [0.1, 3.4, 4 - 1 / 30]);
});

test('sheetTimes: keyframes from every element are used, sorted, and fps defaults to 30', () => {
  const times = sheetTimes({ duration: 4, elements: [el(2), el(0.6), el(1)] });
  near(times, [0.1, 0.7, 1.1, 2.1, 3.4, 4 - 1 / 30]);
});

test('sheetTimes: a very short scene never goes past duration - 1/fps', () => {
  for (const t of sheetTimes({ duration: 0.2, elements: [el(0.15)] }, 30)) assert.ok(t <= 0.2 - 1 / 30 + 1e-9 && t >= 0, String(t));
});

test('sheetLayout: three columns of at most 640 px, phone tile at 360 px, exact sheet size', () => {
  const frame = { w: 1920, h: 1080 };
  const tiles = [frame, frame, frame, frame, { ...frame, width: PHONE_WIDTH }];
  const lay = sheetLayout(tiles);
  assert.equal(PHONE_WIDTH, 360);
  assert.equal(lay.cols, 3);
  assert.equal(lay.rows, 2);
  assert.deepEqual(lay.boxes.map((b) => b.w), [640, 640, 640, 640, 360]);
  assert.equal(lay.boxes[4].h, 203); // 360 * 1080 / 1920 = 202.5
  assert.ok(lay.width > 1920 - 1 && lay.height > 0);
});

test('sheetLayout: a frame narrower than 640 px is not upscaled', () => {
  const lay = sheetLayout([{ w: 480, h: 270 }, { w: 480, h: 270 }]);
  assert.deepEqual(lay.boxes.map((b) => b.w), [480, 480]);
  assert.equal(lay.cols, 2);
});
