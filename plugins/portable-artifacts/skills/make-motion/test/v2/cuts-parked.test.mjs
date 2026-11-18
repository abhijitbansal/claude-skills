// Parking a cut in one look (look review gate-cuts-3: pop's `ripple` never showed rings). A look's `cuts` is the list of
// cuts a film in it may name, so a parked cut is left out of that list: a film that names it is refused with the looks
// that do support it, and the other looks keep it. Pure: no browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import '../../scripts/v2/list.mjs'; // registers the looks, kinds, devices and cuts, as make.mjs does
import { validateFilm } from '../../scripts/v2/spec.mjs';

const MODES = { desk: 'pro', pop: 'viral', cosmos: 'pro' };
const filmIn = (look, cut) => ({
  version: 2, mode: MODES[look], look,
  shots: [{ id: 'a', show: 'statement', say: 'One.' }, { id: 'b', show: 'statement', say: 'Two.', cut }],
});
const errorsOf = (look, cut) => validateFilm(filmIn(look, cut), { specDir: '.' }).errors;

test('pop does not list ripple, and desk and cosmos still do', () => {
  assert.equal(registries.looks.get('pop').cuts.includes('ripple'), false);
  assert.equal(registries.looks.get('desk').cuts.includes('ripple'), true);
  assert.equal(registries.looks.get('cosmos').cuts.includes('ripple'), true);
});

test('a pop film naming ripple is refused, and the message names the looks that support it', () => {
  const [error, ...rest] = errorsOf('pop', 'ripple');
  assert.deepEqual(rest, []);
  assert.equal(error.path, 'shots[1].cut');
  assert.match(error.message, /^look "pop" has no cut "ripple"; /);
  assert.match(error.message, /; the looks that support it: desk, cosmos, ledger, poster$/);
});

test('the object form of the cut is refused the same way', () => {
  const [error] = errorsOf('pop', { type: 'ripple' });
  assert.equal(error.path, 'shots[1].cut.type');
  assert.match(error.message, /the looks that support it: desk, cosmos, ledger, poster$/);
});

test('a desk film and a cosmos film naming ripple still validate', () => {
  assert.deepEqual(errorsOf('desk', 'ripple'), []);
  assert.deepEqual(errorsOf('cosmos', 'ripple'), []);
});

test('a cut no look has gets no looks hint, and one pop keeps validates', () => {
  assert.doesNotMatch(errorsOf('pop', 'swoosh')[0].message, /the looks that support it/);
  assert.deepEqual(errorsOf('pop', 'crossfade'), []);
});
