// The tall-board path audit (looks-four Task 13, m2 carry-over): a stroke the hand draws that runs past the frame's edge is a
// mechanical finding, at either format. The `free` example's bar ran off the right of a 9:16 frame and no rule said so.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import { handFindings } from '../../engine/hand/index.mjs';
import { makeStroke } from '../../engine/hand/geometry.mjs';
import { handLook } from './helpers/hand-look.mjs';

const LOOK = registries.looks.get(handLook('hand-audit-test', { width: { line: 7, write: 6, fill: 5 }, maxSpeed: 2600 }));
const stroke = (node, points, start) => ({ ...makeStroke(points, { kind: 'line', lesser: false }), id: `${node}#0`, node, sentence: 0, start, end: start + 1, speed: 100 });
const audit = (canvas, strokes) => handFindings(strokes, LOOK, [], { canvas, unit: canvas.w >= canvas.h ? canvas.h / 1080 : canvas.w / 1080, duration: 4 })
  .filter((f) => f.rule === 'stroke-edge').map((f) => [f.kind, f.node]);

test('a stroke past the right edge of a 9:16 frame is a mechanical finding naming it', () => {
  const canvas = { w: 1080, h: 1920 };
  assert.deepEqual(audit(canvas, [stroke('bar', [[160, 300], [1400, 300]], 1)]), [['mechanical', 'bar']]);
});

test('a stroke past the bottom edge of a 16:9 frame is a finding; strokes inside either frame are not', () => {
  const canvas = { w: 1920, h: 1080 };
  assert.deepEqual(audit(canvas, [stroke('low', [[200, 900], [200, 1200]], 1)]), [['mechanical', 'low']]);
  assert.deepEqual(audit(canvas, [stroke('in', [[200, 200], [1700, 900]], 1)]), []);
  assert.deepEqual(audit({ w: 1080, h: 1920 }, [stroke('in', [[100, 100], [980, 1800]], 1)]), []);
});

test('a stroke on the board from frame 0 (frame furniture, start 0) is judged too, once per node', () => {
  const canvas = { w: 1080, h: 1920 };
  const found = audit(canvas, [stroke('a', [[900, 100], [1200, 100]], 0), stroke('a2', [[1000, 400], [1300, 400]], 1), { ...stroke('a', [[900, 200], [1200, 200]], 2), id: 'a#1' }]);
  assert.deepEqual(found, [['mechanical', 'a'], ['mechanical', 'a2']]);
});
