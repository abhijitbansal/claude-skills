import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sheetTimes, sheetMoments, sheetLayout, drawingMoments, PHONE_WIDTH, MAX_FRAMES } from '../scripts/lib/sheet.mjs';
import { loadSpec, withDefaults } from '../scripts/lib/spec.mjs';
import { sketchPlans } from '../scripts/lib/sketch-plans.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

test('sheetTimes: a time within 0.05 s of the cluster anchor is dropped; the last frame is always forced', () => {
  near(sheetTimes({ duration: 1, elements: [el(0.84)] }, 30), [0.1, 0.85, 1 - 1 / 30]); // 0.94 is 0.027 s from the last frame
  near(sheetTimes({ duration: 4, elements: [el(3.2)] }, 30), [0.1, 3.3, 3.4, 4 - 1 / 30]);
  near(sheetTimes({ duration: 4, elements: [el(3.27)] }, 30), [0.1, 3.37, 4 - 1 / 30]); // 3.4 is 0.03 s after 3.37: the cluster anchor wins
});

test('sheetTimes: keyframes from every element are used, sorted, and fps defaults to 30', () => {
  const times = sheetTimes({ duration: 4, elements: [el(2), el(0.6), el(1)] });
  near(times, [0.1, 0.7, 1.1, 2.1, 3.4, 4 - 1 / 30]);
});

test('sheetTimes: a very short scene never goes past duration - 1/fps', () => {
  for (const t of sheetTimes({ duration: 0.2, elements: [el(0.15)] }, 30)) assert.ok(t <= 0.2 - 1 / 30 + 1e-9 && t >= 0, String(t));
});

test('sheetTimes: a 0.04 s stagger keeps the 0.1 first look and every landing 0.05 s or more after the previous kept one', () => {
  const stagger = Array.from({ length: 20 }, (_, i) => el(i * 0.04)); // landings 0.1, 0.14, 0.18 ... 0.86
  const times = sheetTimes({ duration: 3, elements: stagger }, 30);
  assert.equal(times[0], 0.1, 'first look survives');
  assert.ok(times.length > 8, `run not collapsed: ${JSON.stringify(times)}`);
  for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= 0.05 - 1e-9 || i === times.length - 1, `gap before ${times[i]}`);
  assert.ok(Math.abs(times.at(-1) - (3 - 1 / 30)) < 1e-9, 'last frame is forced');
});

test('sheetTimes: a keyframe at 0.03 does not displace the fixed 0.1 first look', () => {
  assert.equal(sheetTimes({ duration: 4, elements: [el(0.03)] }, 30)[0], 0.1);
});

test('sheetTimes: fps 60 caps at duration - 1/60; identical keyframe times collapse; duration < 1/fps gives [0]', () => {
  near(sheetTimes({ duration: 1, elements: [el(0.9)] }, 60), [0.1, 0.85, 1 - 1 / 60]);
  near(sheetTimes({ duration: 3, elements: [el(1, 1, 1)] }, 30), [0.1, 1.1, 2.55, 3 - 1 / 30]);
  near(sheetTimes({ duration: 0.02, elements: [] }, 30), [0]);
});

// 24 keyframes landing at 0.4, 0.7 ... 7.3, plus 0.1, 85 % (8.5) and the last frame (9.967) = 27 moments.
const busy = { duration: 10, elements: [{ id: 'x', keyframes: Array.from({ length: 24 }, (_, i) => ({ t: 0.3 * (i + 1) })) }] };

test('sheetMoments: caps a 27-moment scene at 11 frames (12 tiles with the phone tile), keeping 0.1, 85 % and the last frame', () => {
  assert.equal(MAX_FRAMES, 11);
  assert.equal(sheetTimes(busy, 30).length, 27);
  const { times, total } = sheetMoments(busy, 30);
  assert.equal(total, 27);
  // the 24 keyframe times are picked evenly by index (1, 4, 7 ... 22): 0.7, 1.6 ... 7.0
  near(times, [0.1, 0.7, 1.6, 2.5, 3.4, 4.3, 5.2, 6.1, 7.0, 8.5, 10 - 1 / 30]);
});

test('sheetMoments: a scene within the cap is returned untouched', () => {
  const scene = { duration: 4, elements: [el(0, 0.6)] };
  assert.deepEqual(sheetMoments(scene, 30), { times: sheetTimes(scene, 30), total: 4 });
});

test('sheetLayout: four columns for landscape, 480 px cells, phone tile at 360 px, exact sheet size', () => {
  const frame = { w: 1920, h: 1080 };
  const tiles = [...Array(11).fill(frame), { ...frame, width: PHONE_WIDTH }];
  const lay = sheetLayout(tiles);
  assert.equal(PHONE_WIDTH, 360);
  assert.equal(lay.cols, 4);
  assert.equal(lay.rows, 3);
  assert.deepEqual(lay.boxes.map((b) => b.w), [...Array(11).fill(480), 360]);
  assert.equal(lay.boxes[11].h, 203); // 360 * 1080 / 1920 = 202.5
  assert.equal(lay.width, 2 * 16 + 4 * 480 + 3 * 16);
});

test('sheetLayout: portrait frames get three columns', () => {
  assert.equal(sheetLayout(Array(6).fill({ w: 1080, h: 1920 })).cols, 3);
});

test('sheetLayout: a frame narrower than 480 px is not upscaled', () => {
  const lay = sheetLayout([{ w: 320, h: 180 }, { w: 320, h: 180 }]);
  assert.deepEqual(lay.boxes.map((b) => b.w), [320, 320]);
  assert.equal(lay.cols, 2);
});

// ---- a drawing in progress (PA-41, G-69) ---------------------------------------------------------------------------------

test('sheetTimes: marks are exact moments, clamped to the last frame and merged within 0.05 s of an earlier one', () => {
  near(sheetTimes({ duration: 4, elements: [] }, 30, [], [1, 2]), [0.1, 1, 2, 3.4, 4 - 1 / 30]);
  near(sheetTimes({ duration: 4, elements: [] }, 30, [], [1, 1.03, 9]), [0.1, 1, 3.4, 4 - 1 / 30]);
});

test('drawingMoments: no plan gives nothing; a plan gives each element\'s end and 25, 50 and 75 % of the drawing time', () => {
  assert.deepEqual(drawingMoments(null), {});
  const plan = { drawEnd: 5, elements: new Map([['a', { t0: 1, t1: 2 }], ['b', { t0: 2, t1: 5 }]]) };
  const { landings, marks } = drawingMoments(plan);
  assert.deepEqual(landings, [2, 5]);
  near(marks, [2, 3, 4]); // the drawing runs from the first stroke (1 s) to the last (5 s)
  assert.deepEqual(drawingMoments({ drawEnd: 0, elements: new Map() }), {});
});

test('sheetMoments: a drawn scene shows 25, 50 and 75 % of its drawing between the blank board and the finished one', () => {
  const scene = { duration: 8, elements: [] };
  const plan = { drawEnd: 5, elements: new Map([['a', { t0: 1, t1: 5 }]]) };
  const { times } = sheetMoments(scene, 30, 11, drawingMoments(plan));
  for (const mark of [2, 3, 4]) assert.ok(times.some((t) => Math.abs(t - mark) < 1e-6), `a tile at ${mark}s in ${JSON.stringify(times)}`);
  assert.equal(times[0], 0.1, 'the blank board stays first');
  assert.ok(Math.abs(times.at(-1) - (8 - 1 / 30)) < 1e-9, 'the finished board stays last');
});

test('sheetMoments: past the cap the marks are kept before the evenly picked landings', () => {
  const elements = new Map(Array.from({ length: 30 }, (_, i) => [`e${i}`, { t0: i * 0.3, t1: i * 0.3 + 0.25 }]));
  const plan = { drawEnd: 9, elements };
  const drawing = drawingMoments(plan);
  const { times, total } = sheetMoments({ duration: 10, elements: [] }, 30, 11, drawing);
  assert.ok(total > 11);
  assert.equal(times.length, 11);
  for (const mark of drawing.marks) assert.ok(times.some((t) => Math.abs(t - mark) < 0.05), `mark ${mark} survives the cap in ${JSON.stringify(times)}`);
});

test('a real drawn scene (the sketch-board fixture): the sheet has tiles while the hand is still drawing', async () => {
  const { spec } = loadSpec(path.join(root, 'test/fixtures/sketch-board.json'));
  const full = withDefaults(spec);
  const [plan] = await sketchPlans(full);
  assert.ok(plan, 'the fixture is a drawn scene');
  const { times } = sheetMoments(full.scenes[0], full.fps, 11, drawingMoments(plan));
  const mid = times.filter((t) => t > 0.5 && t < plan.drawEnd - 0.5);
  assert.ok(mid.length >= 3, `tiles between the blank board and the finished one: ${JSON.stringify(times)} (drawing ends ${plan.drawEnd})`);
  const without = sheetMoments(full.scenes[0], full.fps).times;
  assert.ok(without.filter((t) => t > 0.5 && t < plan.drawEnd - 0.5).length < mid.length, 'the control: without the plan there are fewer');
});
