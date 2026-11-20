// The approved frames do not change: every existing kind's example in desk and pop at 16:9 and 9:16, and every shot of
// the approved films (estimated word times), expand to the same nodes, tracks and camera as when the fixture was made
// (fixtures/kinds-frozen.json, generated once from HEAD a5732f5b by .scratch/k3/freeze.mjs; regenerated only in a
// commit that says which visual change it records). Also pins the 3x hero rule as it stands, since another fix owns
// engine/review/frame.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registries } from '../../engine/registry.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { buildFilm, shotContext } from '../../engine/graph/film.mjs';
import { kindContext } from '../../engine/captions/index.mjs';
import { auditFrame } from '../../engine/review/frame.mjs';
import { safeRectFor } from '../../scripts/v2/review.mjs';
import { measure, canvasOf, viralOf } from './helpers/kinds.mjs';
import { frozenEntries, FILMS, frozenEntries2, FILMS_2 } from './helpers/frozen.mjs';
import { prepareFilm } from '../../scripts/v2/prepare/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.resolve(HERE, '../..');
const fixture = JSON.parse(readFileSync(path.join(HERE, 'fixtures/kinds-frozen.json'), 'utf8'));
const films = Object.fromEntries(FILMS.map((name) => [name, JSON.parse(readFileSync(path.join(SKILL, 'references/examples/v2', `${name}.json`), 'utf8'))]));
const engine = { registries, buildTimeline, buildFilm, shotContext, kindContext, measure, canvasOf, viralOf };

test('the frozen fixture names every entry it is checked against', () => {
  assert.equal(Object.keys(fixture.entries).length, 66, '36 examples, 26 film shots and 4 film frame runs');
});

const current = frozenEntries(engine, films);
for (const [entry, digest] of Object.entries(fixture.entries)) {
  test(`frozen: ${entry} expands as approved`, () => {
    assert.equal(current[entry], digest, `${entry} changed: an approved frame moved (see fixtures/kinds-frozen.json)`);
  });
}

// ---- the second fixture (looks-four Task 1): every kind in desk and pop, cosmos's kinds, and the cosmos gate films.
// Generated once from HEAD 6fe364c9 (a `git archive` copy under .scratch/l1/head) by .scratch/l1/freeze2.mjs before
// any engine file changed; regenerated only in a commit that says which visual change it records.

const fixture2 = JSON.parse(readFileSync(path.join(HERE, 'fixtures/kinds-frozen-2.json'), 'utf8'));
const FILM_DIR = path.join(SKILL, 'references/examples/v2');
const films2 = Object.fromEntries(FILMS_2.map((name) => [name, JSON.parse(readFileSync(path.join(FILM_DIR, `${name}.json`), 'utf8'))]));
const current2 = frozenEntries2({ ...engine, prepareFilm, filmDir: FILM_DIR }, films2);

test('the second frozen fixture names every entry it is checked against', () => {
  // desk and pop: 16 kinds x 2 formats each; cosmos: 9 kinds x 2; gate-cosmos 7 shots + frames, gate-cosmos-viral 6 + frames
  assert.equal(Object.keys(fixture2.entries).length, 97, '64 desk and pop examples, 18 cosmos examples, 13 film shots and 2 frame runs');
  const missing = Object.keys(fixture2.entries).filter((entry) => current2[entry] === undefined);
  assert.deepEqual(missing, [], 'every frozen entry is still produced by the working tree');
});

for (const [entry, digest] of Object.entries(fixture2.entries)) {
  test(`frozen 2: ${entry} expands as approved`, () => {
    assert.equal(current2[entry], digest, `${entry} changed: an approved frame moved (see fixtures/kinds-frozen-2.json)`);
  });
}

// ---- the 3x hero rule, as it stands ----

const CANVAS = { w: 1920, h: 1080 };
const ctx = () => {
  const base = { look: registries.looks.get('desk'), canvas: CANVAS, mode: 'pro', shotId: 'hero', shotIndex: 0, t: 1.2 };
  return { safe: safeRectFor(base.canvas, base.look), ...base };
};
// A one-word text as a snapshot reports it (layout in pixels, a canvas bbox): the shape review.test.mjs uses.
function text(id, size, y, role) {
  const width = size * 2;
  return {
    type: 'text', id, depth: 0, props: role === undefined ? {} : { role }, x: 200, y, scale: 1, scaleX: 1, scaleY: 1, rotate: 0, opacity: 1, visible: true, children: [],
    words: [{ opacity: 1, x: 0, y: 0, scale: 1 }],
    layout: { size, width, height: size * 1.15, overflow: false, lines: [{ x: 0, y: size * 0.9, width, words: [{ text: 'word', index: 0, x: 0, width }] }] },
    bbox: [200, y, width, size * 1.15], spread: 0,
  };
}
const heroFindings = (nodes) => auditFrame(nodes, ctx()).filter((f) => f.rule === 'hero');

test('hero rule: a frame set in one size has no hero finding', () => {
  assert.deepEqual(heroFindings([text('a', 72, 100), text('b', 72, 400), text('c', 72, 700)]), []);
});

test('hero rule: two sizes 2.9 times apart give one hero finding', () => {
  assert.equal(heroFindings([text('a', 44 * 2.9, 100), text('b', 44, 600)]).length, 1);
});

test('hero rule: a text with the role tag is left out of the contrast', () => {
  assert.deepEqual(heroFindings([text('a', 44 * 2.9, 100), text('b', 44, 600, 'tag')]), []);
});
