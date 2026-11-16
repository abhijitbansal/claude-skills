// The prepare seam (scripts/v2/prepare/index.mjs): a kind that needs a Node-only library declares `prepared: true`, a
// preparer turns its shot into plain JSON before the page is opened, and the kind reads it as ctx.prepared. Tested with a
// throwaway kind and a fake preparer; the map and code preparers have their own tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { registries } from '../../engine/registry.mjs';
import { node } from '../../engine/graph/node.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { buildFilm } from '../../engine/graph/film.mjs';
import { prepareFilm } from '../../scripts/v2/prepare/index.mjs';
import { loadFilm } from '../../scripts/v2/pipeline.mjs';
import { startV2Server } from '../../scripts/v2/server.mjs';
import { measure, canvasOf, filmOf, FPS } from './helpers/kinds.mjs';

const KIND = 'prep-test';
if (!registries.kinds.has(KIND)) {
  registries.kinds.add(KIND, {
    summary: 'A throwaway kind that reads prepared data, for the prepare seam tests.',
    example: { id: 'p', show: KIND, hold: 1, word: 'hello' },
    schema: { properties: { word: { type: 'string' } } },
    srcFields: [],
    prepared: true,
    expand: (shot, ctx) => ({ nodes: [node('path', `${shot.id}.mark`, { d: 'M0 0H10V10H0Z', fill: '#000000', data: ctx.prepared.echo })] }),
  });
}

// A fake preparer: echoes the shot's word upper-cased, with a problem when the word is "bad".
const preparers = {
  [KIND]: (shot) => (shot.word === 'bad'
    ? { data: null, problems: [{ path: 'word', message: 'the word "bad" cannot be prepared' }] }
    : { data: { echo: shot.word.toUpperCase(), n: [3, 1, 2] }, problems: [] }),
};

const SHOT = { id: 'p', show: KIND, hold: 1, word: 'hello' };

test('a film with no prepared kind prepares to {} with no problems', () => {
  const film = filmOf([{ id: 'a', show: 'statement', hold: 1, text: 'Hi' }]);
  assert.deepEqual(prepareFilm(film, { filmDir: '.', preparers }), { prepared: {}, problems: [] });
});

test('a preparer output reaches ctx.prepared through buildFilm', () => {
  const film = filmOf([SHOT]);
  const { prepared } = prepareFilm(film, { filmDir: '.', preparers });
  assert.deepEqual(prepared, { p: { echo: 'HELLO', n: [3, 1, 2] } });
  const built = buildFilm({ film, timeline: buildTimeline(film, { fps: FPS }), measure, canvas: canvasOf('16:9'), prepared });
  assert.equal(built.sampleAt(0).find((n) => n.id === 'p.mark').props.data, 'HELLO');
});

test('a prepared kind with no entry throws naming the shot and the kind', () => {
  const film = filmOf([SHOT]);
  assert.throws(() => buildFilm({ film, timeline: buildTimeline(film, { fps: FPS }), measure, canvas: canvasOf('16:9') }),
    /^Error: shot "p": kind "prep-test" needs prepared data and got none \(scripts\/v2\/prepare\)$/m);
});

test('the same film prepares to byte-identical JSON twice', () => {
  const film = filmOf([SHOT, { ...SHOT, id: 'q', word: 'world' }]);
  const once = JSON.stringify(prepareFilm(film, { filmDir: '.', preparers }));
  assert.equal(JSON.stringify(prepareFilm(film, { filmDir: '.', preparers })), once);
});

test('a preparer problem comes back with its full path', () => {
  const film = filmOf([{ id: 'a', show: 'statement', hold: 1, text: 'Hi' }, { ...SHOT, word: 'bad' }]);
  assert.deepEqual(prepareFilm(film, { filmDir: '.', preparers }).problems, [{ path: 'shots[1].word', message: 'the word "bad" cannot be prepared' }]);
});

test('a prepared kind with no preparer in the table is an error naming it', () => {
  assert.throws(() => prepareFilm(filmOf([SHOT]), { filmDir: '.', preparers: {} }), /kind "prep-test" needs prepared data, but scripts\/v2\/prepare has no preparer for it/);
});

test('loadFilm prepares the film and the server sends the prepared data with it', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mm-v2-prepare-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'film.json');
  writeFileSync(file, JSON.stringify({ version: 2, shots: [{ id: 'a', show: 'statement', hold: 1, text: 'Hi' }] }));
  const loaded = loadFilm(file);
  assert.deepEqual(loaded.prepared, {});
  const server = await startV2Server({ ...loaded, prepared: { a: { echo: 'X' } } });
  t.after(() => server.close());
  const payload = await (await fetch(`${server.url}film.json`)).json();
  assert.deepEqual(payload.prepared, { a: { echo: 'X' } });
});
