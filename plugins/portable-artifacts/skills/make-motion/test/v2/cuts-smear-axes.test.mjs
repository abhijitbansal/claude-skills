// The axes a look smears along (lead ruling f4-2; t5 report P2/P3: on pop's condensed type the motion blur of a vertical
// move read as striped bars). cutStyle.<cut>.smearAxes is look data read by engine/cuts/smear.mjs: pop smears its
// horizontal moves only and draws a vertical one as the plain frame; a look that names no axes (desk, cosmos) smears
// along both, as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import '../../engine/cuts/index.mjs';
import { smearsAlong, SMEAR_AXES } from '../../engine/cuts/smear.mjs';
import { stateKey } from '../../engine/graph/sample.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { validateLook } from '../../engine/looks/index.mjs';
import { validateFilm } from '../../scripts/v2/spec.mjs';
import { filmFor, filmOf, FPS } from './helpers/kinds.mjs';

const shots = (cut) => [{ id: 'one', show: 'statement', say: 'Your charts lie.' }, { id: 'two', show: 'statement', say: 'No cloud.', cut }];
const midOf = (cut, look, format) => buildTimeline(filmOf(shots(cut), look, format), { fps: FPS }).shots[1].start + 0.1;
const frameOf = (cut, look, format = '9:16') => filmFor(shots(cut), look, format).frameAt(midOf(cut, look, format));

test('smearsAlong: a move along a named axis smears, one across them does not; no axes named means both; a zoom always', () => {
  assert.deepEqual(SMEAR_AXES, ['x', 'y']);
  assert.equal(smearsAlong([-1, 0], ['x']), true, 'a horizontal move, x named');
  assert.equal(smearsAlong([0, -1], ['x']), false, 'a vertical move, only x named');
  assert.equal(smearsAlong([0, 1], ['y']), true);
  assert.equal(smearsAlong([0, 1], undefined), true, 'no axes named: both');
  assert.equal(smearsAlong(null, ['x']), true, 'a zoom (no vector) is no axis move');
});

for (const [type, direction] of [['slide', 'up'], ['slide', 'down'], ['cover', 'up'], ['cover', 'down']]) {
  test(`pop: a vertical ${type} ${direction} draws no smear, the plain frame of the same cut at that progress`, () => {
    const cut = { type, direction };
    const frame = frameOf(cut, 'pop');
    assert.ok(frame.smear === undefined, `pop ${type} ${direction} smeared (${frame.smear?.layers.length} layers)`);
    const plain = frameOf({ ...cut, smear: false }, 'pop');
    assert.equal(stateKey(frame.sampled), stateKey(plain.sampled), 'the frame is the cut unsmeared, still moving');
    const later = filmFor(shots(cut), 'pop', '9:16').frameAt(midOf(cut, 'pop', '9:16') + 0.1);
    assert.notEqual(stateKey(later.sampled), stateKey(frame.sampled), 'the move still moves');
  });
}

for (const [type, direction] of [['slide', 'left'], ['slide', 'right'], ['cover', 'right']]) {
  test(`pop: a horizontal ${type} ${direction} still smears`, () => {
    const frame = frameOf({ type, direction }, 'pop');
    assert.ok(frame.smear, `pop ${type} ${direction} not smeared`);
    assert.equal(Math.abs(frame.smear.vector[0]), 1);
  });
}

test('desk and cosmos name no axes: their vertical slides and covers still smear', () => {
  for (const look of ['desk', 'cosmos']) {
    assert.equal(Object.values(registries.looks.get(look).cutStyle ?? {}).some((s) => s.smearAxes !== undefined), false, `${look} names axes`);
  }
  assert.ok(frameOf({ type: 'slide', direction: 'up' }, 'desk', '16:9').smear, 'desk slide up');
  assert.ok(frameOf({ type: 'cover', direction: 'down' }, 'desk', '16:9').smear, 'desk cover down');
});

test('pop names x on the cuts that move along an edge (slide, cover); its punch has no axis', () => {
  const style = registries.looks.get('pop').cutStyle;
  assert.deepEqual(style.slide.smearAxes, ['x']);
  assert.deepEqual(style.cover.smearAxes, ['x']);
  assert.equal(style.punch.smearAxes, undefined);
});

test('validateLook checks smearAxes: a non-empty list of x and y, each once, on a cut that smears', () => {
  const desk = registries.looks.get('desk');
  const styled = (cutStyle) => () => validateLook({ ...desk, name: 'axes-test', cutStyle });
  assert.doesNotThrow(styled({ slide: { smear: true, smearAxes: ['x'] } }));
  assert.doesNotThrow(styled({ slide: { smear: true, smearAxes: ['y', 'x'] } }));
  assert.throws(styled({ slide: { smear: true, smearAxes: ['z'] } }), /look "axes-test": cutStyle\.slide\.smearAxes: must be a list of x, y \(each once\), got \["z"\]/);
  assert.throws(styled({ slide: { smear: true, smearAxes: [] } }), /cutStyle\.slide\.smearAxes: must be a list of x, y \(each once\), got \[\]/);
  assert.throws(styled({ slide: { smear: true, smearAxes: ['x', 'x'] } }), /cutStyle\.slide\.smearAxes: must be a list of x, y \(each once\)/);
  assert.throws(styled({ slide: { smear: true, smearAxes: 'x' } }), /cutStyle\.slide\.smearAxes: must be a list of x, y/);
  assert.throws(styled({ wipe: { smearAxes: ['x'] } }), /cutStyle\.wipe\.smearAxes: the "wipe" cut takes no smear/);
});

test('smearAxes is look data: a film\'s cut object may not name it', () => {
  const film = { version: 2, mode: 'viral', look: 'pop', format: '9:16', shots: shots({ type: 'slide', direction: 'up', smearAxes: ['x'] }) };
  const errors = validateFilm(film, { specDir: '.' }).errors;
  assert.ok(errors.some((e) => e.path === 'shots[1].cut.smearAxes' && /unknown option "smearAxes"/.test(e.message)), JSON.stringify(errors));
  assert.equal(errors.filter((e) => e.path === 'shots[1].cut.smearAxes').length, 1, 'one problem, not the unknown key and its check');
});
