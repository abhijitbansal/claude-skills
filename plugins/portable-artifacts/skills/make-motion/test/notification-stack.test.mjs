// notification-stack: a card that moves up (or fades out) when a later card arrives holds still until that arrival begins, then
// moves during its enter window (G-74). Without a keyframe at the start of the move, the card drifted from its slot across the
// whole gap since its own entrance. No browser: the keyframes are read off the expanded block.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandBlocks } from '../template/blocks/index.mjs';
import { ENTER_SECONDS } from '../template/blocks/layout.mjs';
import { flattenElements } from '../template/groups.mjs';
import { validateSpec } from '../scripts/lib/spec.mjs';

const ITEMS = Array.from({ length: 5 }, (_, i) => ({ app: `App ${i + 1}`, title: `Title number ${i + 1}`, body: 'A body line of some length that is read in full' }));
const film = (size, duration = 14, stagger = 1.5) => ({
  size, scenes: [{ id: 's', duration, elements: [{ id: 'n', type: 'block', x: size[0] / 2, y: size[1] / 2, block: 'notification-stack', params: { items: ITEMS, stagger } }] }],
});
const partsOf = (spec) => flattenElements(spec.scenes[0].elements).map(({ el }) => el).filter((el) => el.type !== 'group');
const EPS = 1e-6;

const TALL = [1080, 1920];

test('every y move of a card lasts ENTER_SECONDS (the arrival that pushes it), not the whole gap since its entrance', () => {
  const spec = expandBlocks(film([1920, 1080], 14, 1.5));
  let moves = 0;
  for (const el of partsOf(spec)) {
    const kfs = el.keyframes;
    for (let i = 1; i < kfs.length; i++) {
      if (kfs[i].y === undefined || kfs[i - 1].y === undefined || kfs[i].y === kfs[i - 1].y) continue;
      const entering = i === 1; // the slide in from the right is the first pair, not a move
      if (entering) continue;
      moves++;
      assert.ok(Math.abs(kfs[i].t - kfs[i - 1].t - ENTER_SECONDS) < EPS, `${el.id}: moves over ${(kfs[i].t - kfs[i - 1].t).toFixed(3)}s, not ${ENTER_SECONDS}s: ${JSON.stringify(kfs)}`);
    }
  }
  assert.ok(moves > 0, 'the fixture makes cards move');
});

test('a card that fades out holds at full opacity until the moment the next card starts to arrive', () => {
  const spec = expandBlocks(film([1920, 1080], 14, 1.5));
  const fading = partsOf(spec).filter((el) => el.keyframes.some((kf, i) => i > 0 && kf.opacity === 0)); // the first keyframe is the entrance, from 0
  assert.ok(fading.length > 0, 'at least one card fades out when five do not fit');
  for (const el of fading) {
    const end = el.keyframes.findLast((kf) => kf.opacity === 0);
    const before = el.keyframes[el.keyframes.indexOf(end) - 1];
    assert.equal(before.opacity, 1, `${el.id}: opacity is 1 at the start of the fade`);
    assert.ok(Math.abs(end.t - before.t - ENTER_SECONDS) < EPS, `${el.id}: the fade takes ENTER_SECONDS: ${JSON.stringify(el.keyframes)}`);
  }
});

test('the keyframes stay sorted by time and the block validates, whatever the stagger', () => {
  for (const stagger of [0.2, 0.3, 1.5]) {
    for (const size of [[1920, 1080], TALL]) {
      const spec = film(size, 14, stagger);
      assert.deepEqual(validateSpec(spec).errors, [], `stagger ${stagger} at ${size.join('x')}`);
      for (const el of partsOf(expandBlocks(spec))) {
        el.keyframes.forEach((kf, i) => { if (i > 0) assert.ok(kf.t >= el.keyframes[i - 1].t - EPS, `${el.id} at stagger ${stagger}: ${JSON.stringify(el.keyframes)}`); });
      }
    }
  }
});
