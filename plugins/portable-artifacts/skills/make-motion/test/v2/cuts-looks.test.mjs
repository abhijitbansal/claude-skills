// The look's cut data (transitions plan Task 2): look.cuts (every registered cut: any look may use any cut), look.cutPalette
// (the look's preferred cuts, in order, holding "cut"), look.cutStyle (the look's defaults per cut, checked against each
// cut's own options) and the removal of the boolean look.smear. resolveCut reads cutStyle; --list cuts names the looks
// whose palette holds each cut.
import test from 'node:test';
import assert from 'node:assert/strict';
import '../../scripts/v2/list.mjs';
import { registries } from '../../engine/registry.mjs';
import { validateLook } from '../../engine/looks/index.mjs';
import { resolveCut } from '../../engine/cuts/resolve.mjs';
import { listEntries } from '../../scripts/v2/list.mjs';

const LOOKS = ['desk', 'pop', 'cosmos'];
const desk = () => registries.looks.get('desk');
const withCuts = (fields) => ({ ...desk(), name: 'cuts-test', ...fields });

// a cut parked in a look is left out of its `cuts` (test/v2/cuts-parked.test.mjs): pop parks ripple
const PARKED = { desk: [], pop: ['ripple'], cosmos: [] };
// a cut only a hand look takes (looks-four Task 2: erase wipes the drawing hand's board; desk, pop and cosmos name it
// with a null sound and leave it out of their cuts)
const HAND_ONLY = ['erase'];

test('every shipped look allows every registered cut but the ones parked in it and the hand look\'s erase', () => {
  for (const name of LOOKS) {
    const allowed = registries.cuts.names().filter((cut) => !PARKED[name].includes(cut) && !HAND_ONLY.includes(cut));
    assert.deepEqual([...registries.looks.get(name).cuts].sort(), allowed.sort(), name);
  }
});

test('every shipped look has a palette: a subset of its cuts, never empty, holding the hard cut', () => {
  for (const name of LOOKS) {
    const look = registries.looks.get(name);
    assert.ok(Array.isArray(look.cutPalette) && look.cutPalette.length > 0, name);
    assert.ok(look.cutPalette.includes('cut'), name);
    assert.ok(look.cutPalette.every((cut) => look.cuts.includes(cut)), name);
  }
});

test('the palettes hold the plan\'s starting cuts among those registered, in the look\'s order', () => {
  const registered = (list) => list.filter((cut) => registries.cuts.has(cut));
  assert.deepEqual([...desk().cutPalette], registered(['cut', 'match', 'slide', 'crossfade', 'wipe', 'fade', 'page-curl']));
  assert.deepEqual([...registries.looks.get('pop').cutPalette], registered(['cut', 'punch', 'slide', 'cover', 'zoom', 'polka-dots', 'glitch-memories', 'cross-zoom']));
  assert.deepEqual([...registries.looks.get('cosmos').cutPalette], registered(['cut', 'match', 'crossfade', 'fade', 'iris', 'ripple']));
});

test('no look carries the old boolean smear: cutStyle holds it per cut', () => {
  for (const name of LOOKS) {
    const look = registries.looks.get(name);
    assert.equal(look.smear, undefined, name);
    assert.ok(look.cutStyle !== null && typeof look.cutStyle === 'object' && !Array.isArray(look.cutStyle), name);
  }
  assert.throws(() => validateLook(withCuts({ smear: true })), /look "cuts-test": smear is gone; write cutStyle: \{ slide: \{ smear: true \} \}/);
});

test('validateLook refuses a palette entry the look does not allow, an empty palette and one without the hard cut', () => {
  assert.throws(() => validateLook(withCuts({ cutPalette: ['cut', 'slyde'] })), /look "cuts-test": cutPalette\.1 "slyde" is not one of its cuts/);
  assert.throws(() => validateLook(withCuts({ cutPalette: [] })), /look "cuts-test": cutPalette must be a non-empty list of its cuts holding "cut"/);
  assert.throws(() => validateLook(withCuts({ cutPalette: ['slide'] })), /cutPalette must be a non-empty list of its cuts holding "cut"/);
});

test('validateLook refuses a cuts entry that is not a registered cut', () => {
  assert.throws(() => validateLook(withCuts({ cuts: [...desk().cuts, 'swoosh'] })), /look "cuts-test": cuts\.\d+ "swoosh" is not a registered cut/);
});

test('validateLook refuses a cutStyle key that is not a registered cut, with a did-you-mean', () => {
  assert.throws(() => validateLook(withCuts({ cutStyle: { slyde: { direction: 'up' } } })), /look "cuts-test": cutStyle\.slyde is not a registered cut; did you mean "slide"\?/);
});

test('validateLook refuses a cutStyle direction or duration the cut does not accept', () => {
  assert.throws(() => validateLook(withCuts({ cutStyle: { slide: { direction: 'sideways' } } })), /cutStyle\.slide\.direction: the "slide" cut takes a direction of left, right, up or down \(the way the next shot moves on screen: "left" moves leftward and enters by the right edge/);
  assert.throws(() => validateLook(withCuts({ cutStyle: { match: { direction: 'up' } } })), /cutStyle\.match\.direction: the "match" cut takes no direction/);
  assert.throws(() => validateLook(withCuts({ cutStyle: { slide: { duration: 3 } } })), /cutStyle\.slide\.duration: must be a number of seconds from 0\.1 to 2/);
  assert.throws(() => validateLook(withCuts({ cutStyle: { cut: { duration: 0.5 } } })), /cutStyle\.cut\.duration: a hard cut has no duration/);
  // `ease` is a look's cover option (the lead's ruling on gate-poster-3: poster's steady cover); any other cut refuses it
  assert.throws(() => validateLook(withCuts({ cutStyle: { slide: { ease: 'linear' } } })), /cutStyle\.slide\.ease: the "slide" cut takes no ease; only the cover does/);
});

test('validateLook takes a cover ease that parses and refuses one that does not', () => {
  assert.doesNotThrow(() => validateLook(withCuts({ cutStyle: { cover: { ease: 'inOutQuad' } } })));
  assert.throws(() => validateLook(withCuts({ cutStyle: { cover: { ease: 'wobble' } } })), /cutStyle\.cover\.ease: unknown ease/);
  assert.throws(() => validateLook(withCuts({ cutStyle: { cover: { ease: 3 } } })), /cutStyle\.cover\.ease: must be the name of an ease, got 3/);
});

test('validateLook refuses smear: true on a cut that cannot smear', () => {
  assert.throws(() => validateLook(withCuts({ cutStyle: { match: { smear: true } } })), /cutStyle\.match\.smear: the "match" cut takes no smear/);
  assert.doesNotThrow(() => validateLook(withCuts({ cutStyle: { slide: { smear: true, direction: 'up', duration: 0.6 } } })));
});

test('resolveCut reads cutStyle: a look\'s slide with no option takes the look\'s direction, length and smear', () => {
  const look = withCuts({ cutStyle: { slide: { direction: 'up', duration: 0.6, smear: true } } });
  const cut = resolveCut('slide', { look });
  assert.deepEqual([cut.direction, cut.dur, cut.smear], ['up', 0.6, true]);
  const own = resolveCut({ type: 'slide', direction: 'left', smear: false }, { look });
  assert.deepEqual([own.direction, own.dur, own.smear], ['left', 0.6, false], 'the shot\'s own options win; the look fills the rest');
  assert.deepEqual([resolveCut('slide', { look: registries.looks.get('pop') }).direction, resolveCut('slide', { look: registries.looks.get('pop') }).smear], ['left', true], 'pop smears its slide (Task 6) and keeps the default direction');
});

test('--list cuts names, per cut, the looks whose palette holds it', () => {
  const entries = listEntries('cuts');
  // ledger listed after its gate (looks-four Task 5): its palette is cut, match, fade and wipe
  // poster listed after its gate (looks-four Task 8): its palette is cut, cover, iris, wipe, punch and slide
  assert.deepEqual(entries.find((e) => e.name === 'cut').palettes, [...LOOKS, 'ledger', 'poster', 'keynote', 'marker']);
  assert.deepEqual(entries.find((e) => e.name === 'punch').palettes, ['pop', 'poster']);
  assert.deepEqual(entries.find((e) => e.name === 'match').palettes, ['desk', 'cosmos', 'ledger', 'keynote']);
});
