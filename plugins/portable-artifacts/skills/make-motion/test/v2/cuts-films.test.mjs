// Transitions Task 9: the two cut films (references/examples/v2/cuts-desk.json and cuts-pop.json) between them name every
// registered cut, so a cut added later cannot be left out of them; with every direction of slide and wipe, a duration
// override, a root cut, a voice and sound on. Pure: no browser (the renders are the controller's gate).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { registries } from '../../engine/registry.mjs';
import '../../scripts/v2/list.mjs'; // registers the looks, kinds, devices and cuts, as make.mjs does
import { resolveShotCut } from '../../engine/cuts/resolve.mjs';
import { validateFilm } from '../../scripts/v2/spec.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { cutWindowFindings } from '../../scripts/v2/review.mjs';

const DIR = fileURLToPath(new URL('../../references/examples/v2/', import.meta.url));
const FILMS = ['cuts-desk.json', 'cuts-pop.json'].map((name) => ({ name, film: JSON.parse(readFileSync(`${DIR}${name}`, 'utf8')) }));
const cutsOf = (film) => film.shots.slice(1).map((_, i) => resolveShotCut(film, i + 1));

test('both cut films validate', () => {
  for (const { name, film } of FILMS) assert.deepEqual(validateFilm(film, { specDir: DIR }).errors, [], name);
});

test('between them the two cut films name every registered cut', () => {
  const named = new Set(FILMS.flatMap(({ film }) => cutsOf(film).map((cut) => cut.name)));
  assert.deepEqual(registries.cuts.names().filter((name) => !named.has(name)), []);
});

test('every direction of slide and wipe appears, and so do a duration override and a root cut each film uses', () => {
  const cuts = FILMS.flatMap(({ film }) => cutsOf(film));
  for (const name of ['slide', 'wipe']) {
    const used = new Set(cuts.filter((cut) => cut.name === name).map((cut) => cut.direction));
    assert.deepEqual(registries.cuts.get(name).directions.filter((d) => !used.has(d)), [], name);
  }
  assert.ok(FILMS.some(({ film }) => film.shots.some((shot) => typeof shot.cut === 'object' && shot.cut.duration !== undefined)), 'a duration override');
  for (const { name, film } of FILMS) {
    assert.ok(film.cut !== undefined, `${name} has a root cut`);
    assert.ok(film.shots.slice(1).some((shot) => shot.cut === undefined), `${name}: a shot takes the root cut`);
  }
});

test('both films are voiced with sound on', () => {
  for (const { name, film } of FILMS) {
    assert.equal(typeof film.voice?.name, 'string', name);
    const mode = registries.modes.get(film.mode);
    assert.ok(film.sound === 'on' || (mode.cues === true && film.sound !== 'off'), `${name}: cues play`);
  }
});

test('on the estimated timeline no cut takes more than half its shot', () => {
  for (const { name, film } of FILMS) assert.deepEqual(cutWindowFindings(film, buildTimeline(film, { fps: 30 })).map((f) => f.message), [], name);
});
