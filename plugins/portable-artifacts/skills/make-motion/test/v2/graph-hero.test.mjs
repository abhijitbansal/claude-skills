// The hero's box in a sampled shot (engine/graph/film.mjs heroBox): its resting box moved however the hero node now
// stands against its rest pose, through page/bounds.mjs localMatrix (fix A round 2: the duplicate matrix is gone).
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { FPS, filmOf, filmFor, CLIP } from './helpers/kinds.mjs';

const scaleOf = (n) => n.scale * n.scaleX;

test('a pushed-in hero\'s box grows with the node\'s scale, about where the camera moves it', () => {
  const shot = CLIP();
  const built = filmFor([shot], 'desk', '16:9');
  const { duration } = buildTimeline(filmOf([shot], 'desk', '16:9'), { fps: FPS }).shots[0];
  const heroAt = (t) => built.sampleShot(0, t).find((n) => n.bbox !== undefined && n.id === 'c.image');
  const [a, b] = [heroAt(0), heroAt(duration - 1 / FPS)];
  assert.ok(a && b, 'the clipping\'s picture is the hero, carrying its box');
  const ratio = scaleOf(b) / scaleOf(a);
  assert.ok(ratio > 1.1, `the camera pushes in (scale ratio ${ratio})`);
  assert.ok(Math.abs(b.bbox[2] / a.bbox[2] - ratio) < 1e-6, `width ${b.bbox[2] / a.bbox[2]} follows the scale ${ratio}`);
  assert.ok(Math.abs(b.bbox[3] / a.bbox[3] - ratio) < 1e-6, 'and so does the height');
});
