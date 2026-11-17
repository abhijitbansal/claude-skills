// The `erase` cut and cue (looks-four Task 2): registered with its options, the outgoing frame at progress 0 and the
// incoming at 1, three overlapping passes between, a sound named for it by every look, and the cue's samples.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import '../../engine/kinds/index.mjs';
import { allLookNames } from '../../engine/looks/index.mjs';
import { ERASE, passAt } from '../../engine/cuts/erase.mjs';
import { KNOWN_CUES, cueSamples } from '../../scripts/v2/sound/synth.mjs';
import { fakeSampled } from './helpers/kinds.mjs';
import { handLook } from './helpers/hand-look.mjs';

const PEAK = 0.5;
const CANVAS = { w: 1920, h: 1080 };
const look = registries.looks.get('desk');
const frames = () => ({ from: [fakeSampled('old', 400)], to: [fakeSampled('new', 600)] });

test('erase is registered, with its options', () => {
  const cut = registries.cuts.get('erase');
  assert.equal(cut.family, 'node');
  assert.equal(cut.dur, ERASE.dur);
  assert.equal(cut.directions, null, 'no direction: it always wipes left to right, top first');
  assert.equal(cut.smearable, false);
  assert.equal(cut.example, 'erase');
  assert.ok(registries.cuts.names().at(-1) === 'erase', 'registered after the cuts already listed, which keep their order');
});

test('at progress 0 the frame is the outgoing shot, at 1 the incoming', () => {
  const cut = registries.cuts.get('erase');
  const { from, to } = frames();
  assert.equal(cut.apply({ from, to, p: 0, canvas: CANVAS, look }), from);
  assert.equal(cut.apply({ from, to, p: 1, canvas: CANVAS, look }), to);
});

test('between, three overlapping passes wipe left to right, the top one first, in opaque paper and a mixed smear', () => {
  const cut = registries.cuts.get('erase');
  const { from, to } = frames();
  const mid = cut.apply({ from, to, p: 0.5, canvas: CANVAS, look });
  const wipes = mid.filter((n) => n.id.startsWith('erase.wipe'));
  assert.equal(wipes.length, 2, 'at half way the top two passes have started and the third is about to');
  assert.ok(passAt(0, 0.5) > passAt(1, 0.5) && passAt(1, 0.5) > passAt(2, 0.5), 'the top pass leads');
  assert.ok(mid.filter((n) => n.id.startsWith('erase.')).every((n) => n.opacity === 1), 'nothing translucent');
  assert.equal(wipes[0].props.fill, look.palette.paper);
  assert.ok(mid.some((n) => n.id === 'old'), 'the outgoing board is still there where it is not wiped');
  assert.ok(passAt(2, 1) >= 1, 'the last pass reaches the right edge by the end');
});

test('every look names a sound for erase: null in desk, pop and cosmos, the erase cue in the hand look', () => {
  handLook();
  for (const name of allLookNames()) assert.ok(Object.hasOwn(registries.looks.get(name).sounds.cut, 'erase'), `${name} names a sound for erase`);
  for (const name of ['desk', 'pop', 'cosmos']) {
    assert.equal(registries.looks.get(name).sounds.cut.erase, null, `${name}: silent`);
    assert.equal(registries.looks.get(name).cuts.includes('erase'), false, `${name}: erase is not one of its cuts`);
  }
  assert.equal(registries.looks.get('hand-test').sounds.cut.erase, 'erase');
  assert.ok(registries.looks.get('hand-test').cuts.includes('erase'));
});

test('KNOWN_CUES holds erase and its samples are finite, peak at or under the limit, same for a seed', () => {
  assert.ok(KNOWN_CUES.includes('erase'));
  const a = cueSamples('erase', { seed: 3 });
  assert.ok(a.length > 0 && a.every(Number.isFinite), 'finite samples');
  assert.ok(a.reduce((m, x) => Math.max(m, Math.abs(x)), 0) <= PEAK + 1e-6, 'peak at or under the limit');
  assert.deepEqual(cueSamples('erase', { seed: 3 }), a, 'the same for a seed');
  assert.notDeepEqual(cueSamples('erase', { seed: 4 }), a, 'another seed, other noise');
});
