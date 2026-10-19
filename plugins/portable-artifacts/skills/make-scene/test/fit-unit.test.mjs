// Camera framing maths: no DOM, no three. A box is framed tightly (in and out) for the viewport's aspect,
// a flat default view is lifted, and a focus bookmark widens for a narrow viewport without passing the overview.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIT_MARGIN, MIN_ELEVATION, boxCorners, fitDistance, focusScale, framePoints, viewDirection, alignToStrip } from '../template/runtime/fit.js';

const FOV = (45 * Math.PI) / 180;

// Project a world point for a camera at target + dir * distance looking at target: NDC x and y.
function ndc(point, target, dir, distance, aspect) {
  const forward = dir.map((c) => -c);
  const right = [forward[2], 0, -forward[0]];
  const rl = Math.hypot(...right);
  const r = right.map((c) => c / rl);
  const u = [forward[1] * r[2] - forward[2] * r[1], forward[2] * r[0] - forward[0] * r[2], forward[0] * r[1] - forward[1] * r[0]];
  const v = point.map((c, i) => c - target[i]);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const depth = distance + dot(v, forward);
  const tanV = Math.tan(FOV / 2);
  return [dot(v, r) / (depth * tanV * aspect), dot(v, u) / (depth * tanV)];
}

const DIR = viewDirection([1, 0.8, 1]);

test('boxCorners lists the 8 corners', () => {
  const corners = boxCorners({ min: [0, 0, 0], max: [1, 2, 3] });
  assert.equal(corners.length, 8);
  assert.equal(new Set(corners.map(String)).size, 8);
});

test('the fitted distance puts the tightest corner at the margin in the limiting axis, and nothing outside', () => {
  const box = { min: [-8, 0, -1], max: [8, 1, 1] };
  const corners = boxCorners(box);
  const target = [0, 0.5, 0];
  for (const aspect of [1.6, 0.5, 1]) {
    const d = fitDistance(corners, target, DIR, { fov: FOV, aspect });
    const reach = Math.max(...corners.flatMap((c) => ndc(c, target, DIR, d, aspect).map(Math.abs)));
    assert.ok(Math.abs(reach - 1 / FIT_MARGIN) < 1e-6, `aspect ${aspect}: the widest corner sits at 1/margin of the half-frame (got ${reach})`);
  }
});

test('a wide flat box needs a nearer camera in a wide viewport than in a narrow one', () => {
  const corners = boxCorners({ min: [-8, 0, -1], max: [8, 1, 1] });
  const wide = fitDistance(corners, [0, 0.5, 0], DIR, { fov: FOV, aspect: 1.6 });
  const narrow = fitDistance(corners, [0, 0.5, 0], DIR, { fov: FOV, aspect: 0.5 });
  assert.ok(wide < narrow);
});

test('fitting dollies in as well as out', () => {
  const small = boxCorners({ min: [-1, 0, -1], max: [1, 1, 1] });
  const big = boxCorners({ min: [-20, 0, -20], max: [20, 5, 20] });
  const a = fitDistance(small, [0, 0.5, 0], DIR, { fov: FOV, aspect: 1.6 });
  const b = fitDistance(big, [0, 2.5, 0], DIR, { fov: FOV, aspect: 1.6 });
  assert.ok(a < 6 && b > 30, `${a} ${b}`);
});

test('viewDirection lifts a flat view to the minimum elevation and leaves a steeper one alone', () => {
  const flat = viewDirection([10, 1, 0]);
  assert.ok(Math.abs(Math.asin(flat[1]) - MIN_ELEVATION) < 1e-9);
  assert.ok(Math.abs(Math.hypot(...flat) - 1) < 1e-9);
  assert.ok(flat[0] > 0 && Math.abs(flat[2]) < 1e-9, 'the azimuth is kept');
  const steep = viewDirection([1, 5, 1]);
  assert.ok(Math.abs(steep[1] - 5 / Math.hypot(1, 5, 1)) < 1e-9);
  assert.deepEqual(viewDirection([0, 0, 0]).length, 3, 'a zero direction falls back to a 3/4 view');
  assert.ok(viewDirection([0, 4, 0])[1] > 0.5);
});

test('focusScale widens a bookmark for a portrait viewport, capped at the overview distance, and never shrinks it', () => {
  assert.equal(focusScale(10, 1.6, 40), 1, 'landscape keeps the authored distance');
  assert.equal(focusScale(10, 0.5, 40), 2);
  assert.equal(focusScale(10, 0.5, 15), 1.5, 'capped at the overview');
  assert.equal(focusScale(30, 0.5, 15), 1, 'a bookmark already past the overview is left alone');
  assert.equal(focusScale(0, 0.5, 15), 1);
});

const graphWith = (extra) => ({ bounds: { min: [0, 0, 0], max: [1, 1, 1] }, batches: [], tubes: [], labels: [], surfaces: [], ...extra });

test('framePoints takes the corners of every instance, a circle for a ring, tube points, label anchors and surfaces', () => {
  const pts = framePoints(graphWith({
    batches: [
      { shape: 'box', instances: [[0, 1, 0, 2, 2, 2, 0]] },
      { shape: 'ring', instances: [[10, 0, 0, 8, 0.02, 8, -1]] },
    ],
    tubes: [{ points: [[5, 5, 5], [6, 6, 6]] }],
    labels: [{ at: [-9, 0, 0] }],
    surfaces: [{ size: [10, 4, 3], heights: [0, 0.5, 1] }],
  }));
  assert.ok(pts.some((p) => p[0] === -1 && p[1] === 0 && p[2] === -1), 'a box corner');
  assert.ok(pts.some((p) => p[0] === 6 && p[1] === 0 && Math.abs(p[2]) < 1e-9), 'the ring circle reaches x = 10 - 4');
  assert.ok(!pts.some((p) => p[0] > 13.9 && Math.abs(p[2]) > 3.9), 'but not the corner of the ring\'s square');
  assert.ok(pts.some((p) => p[0] === -9) && pts.some((p) => p[0] === 6 && p[1] === 6), 'label and tube points');
  assert.ok(pts.some((p) => p[0] === 5 && p[1] === 3 && p[2] === 2), 'a surface corner at the full height');
});

test('framePoints falls back to the bounding box of an empty graph', () => {
  assert.equal(framePoints(graphWith({})).length, 8);
});

test('a ring of systems frames tighter by its points than by its bounding box', () => {
  const ring = Array.from({ length: 4 }, (_, k) => [6 * Math.cos((k * Math.PI) / 2), 0, 6 * Math.sin((k * Math.PI) / 2), 1, 1, 1, -1]);
  const graph = graphWith({ bounds: { min: [-6.5, -0.5, -6.5], max: [6.5, 0.5, 6.5] }, batches: [{ shape: 'sphere', instances: ring }] });
  const options = { fov: FOV, aspect: 1.6 };
  const diagonal = viewDirection([1, 0.8, 1]);
  const byPoints = fitDistance(framePoints(graph), [0, 0, 0], diagonal, options);
  const byBox = fitDistance(boxCorners(graph.bounds), [0, 0, 0], diagonal, options);
  assert.ok(byPoints < byBox * 0.85, `${byPoints} vs ${byBox}`);
});

test('alignToStrip turns a portrait view to look down a flat strip, keeping elevation and the nearer end', () => {
  const strip = boxCorners({ min: [-9, 0, -1.5], max: [9, 1, 1.5] });
  const dir = viewDirection([0.3, 1.2, 1]);
  const turned = alignToStrip(dir, strip, 0.5);
  assert.ok(Math.abs(turned[2]) < 1e-9 && turned[0] > 0, 'now along x, over the +x end (the side it already leaned to)');
  assert.ok(Math.abs(turned[1] - dir[1]) < 1e-9, 'same elevation');
  assert.ok(Math.abs(Math.hypot(...turned) - 1) < 1e-9);
  const behind = alignToStrip(viewDirection([-0.3, 1.2, 1]), strip, 0.5);
  assert.ok(behind[0] < 0, 'the other end when that is the side it leaned to');
  const long = alignToStrip(dir, boxCorners({ min: [-1.5, 0, -9], max: [1.5, 1, 9] }), 0.5);
  assert.ok(Math.abs(long[0]) < 1e-9 && long[2] > 0, 'a strip along z is looked down along z');
  const byView = (d, aspect) => fitDistance(strip, [0, 0.5, 0], d, { fov: FOV, aspect });
  assert.ok(byView(turned, 0.5) < byView(dir, 0.5), 'and that frames it nearer in a portrait viewport');
});

test('alignToStrip leaves wide viewports, compact scenes and tall ones alone', () => {
  const strip = boxCorners({ min: [-9, 0, -1.5], max: [9, 1, 1.5] });
  const dir = viewDirection([0.3, 1.2, 1]);
  assert.deepEqual(alignToStrip(dir, strip, 1.6), dir, 'landscape');
  assert.deepEqual(alignToStrip(dir, boxCorners({ min: [-6, 0, -6], max: [6, 3, 6] }), 0.5), dir, 'square footprint');
  assert.deepEqual(alignToStrip(dir, boxCorners({ min: [-9, 0, -1.5], max: [9, 8, 1.5] }), 0.5), dir, 'a standing chart is not a floor strip');
  assert.deepEqual(alignToStrip(dir, [], 0.5), dir);
});
