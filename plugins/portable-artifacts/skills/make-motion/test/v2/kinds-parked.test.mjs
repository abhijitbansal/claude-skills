// Parking a kind per look (look.kinds.<kind>.experimental, engine/looks/index.mjs): a parked kind still validates and
// renders, is left out of the listings and hints, and a film that uses it is told so once and reported. Tested with
// throwaway kinds and looks registered here (each test file runs in its own process).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { registries } from '../../engine/registry.mjs';
import { node } from '../../engine/graph/node.mjs';
import { isParkedKind, kindLooks, listedKinds, kindSupportProblems } from '../../engine/looks/index.mjs';
import { listEntries, formatList } from '../../scripts/v2/list.mjs';
import { validateFilm } from '../../scripts/v2/spec.mjs';
import { experimentalKinds } from '../../scripts/v2/report.mjs';
import { runMake } from '../../scripts/v2/run.mjs';

const desk = registries.looks.get('desk');
const lookWith = (name, kinds) => Object.freeze({ ...desk, name, kinds: { ...desk.kinds, ...kinds } });

// park-one is parked in park-a and shipped in park-b; park-all is parked in both.
for (const [name, kinds] of [
  ['park-a', { 'park-one': { experimental: true }, 'park-all': { experimental: true } }],
  ['park-b', { 'park-one': {}, 'park-all': { experimental: true } }],
  ['park-c', { chart: { ...desk.kinds.chart, experimentalTypes: ['donut'] } }],
]) {
  if (!registries.looks.has(name)) registries.looks.add(name, lookWith(name, kinds));
}
for (const kind of ['park-one', 'park-all']) {
  if (registries.kinds.has(kind)) continue;
  registries.kinds.add(kind, {
    summary: 'A throwaway kind for the parking tests: one plain mark.',
    example: { id: 'k', show: kind, hold: 1 },
    schema: { properties: {} },
    srcFields: [],
    lookData: true,
    validate: (shot, { look } = {}) => kindSupportProblems(kind, look),
    expand: (shot) => ({ nodes: [node('path', `${shot.id}.mark`, { d: 'M0 0H10V10H0Z', fill: '#000000' })] }),
  });
}

test('a kind is parked in a look only by that look data', () => {
  assert.equal(isParkedKind(registries.looks.get('park-a'), 'park-one'), true);
  assert.equal(isParkedKind(registries.looks.get('park-b'), 'park-one'), false);
  assert.equal(isParkedKind(desk, 'park-one'), false, 'a look with no data for it does not park it');
});

test('flagged in one look, the kind is still listed, with looks naming the other', () => {
  assert.deepEqual(kindLooks('park-one'), ['park-b']);
  assert.ok(listedKinds().includes('park-one'));
  assert.deepEqual(listEntries('kinds').find((e) => e.name === 'park-one').looks, ['park-b']);
});

test('a kind that reads no look data is listed in every listed look', () => {
  assert.deepEqual(listEntries('kinds').find((e) => e.name === 'statement').looks, registries.looks.names());
  assert.deepEqual(listEntries('kinds').find((e) => e.name === 'quote').looks, ['desk', 'pop', 'cosmos', 'park-a', 'park-b', 'park-c']);
});

test('flagged in every listed look, it leaves --list kinds and shows under --all marked experimental', () => {
  assert.equal(listedKinds().includes('park-all'), false);
  assert.equal(listEntries('kinds').some((e) => e.name === 'park-all'), false);
  const all = listEntries('kinds', { all: true });
  assert.deepEqual(all.find((e) => e.name === 'park-all'), { ...all.find((e) => e.name === 'park-all'), experimental: true, looks: [] });
  assert.match(formatList('kinds', all), /^park-all {2}\(experimental\) /m);
  assert.ok(registries.kinds.names().includes('park-all'), 'the registry itself stays complete (sound/cues.mjs walks it)');
});

test('the unknown-kind hint and the show error do not offer a parked kind', () => {
  const { errors } = validateFilm({ version: 2, shots: [{ id: 'a', show: 'park-al', hold: 1 }] }, { specDir: '.' });
  const show = errors.find((e) => e.path === 'shots[0].show');
  assert.ok(show, JSON.stringify(errors));
  assert.doesNotMatch(show.message, /park-all/);
  const missing = validateFilm({ version: 2, shots: [{ id: 'a', hold: 1 }] }, { specDir: '.' }).errors.find((e) => e.path === 'shots[0].show');
  assert.doesNotMatch(missing.message, /park-all/);
  assert.match(missing.message, /park-one/);
});

test('kindSupportProblems names only the looks that ship the kind unparked', () => {
  assert.deepEqual(kindSupportProblems('park-one', desk).map((p) => p.message), ['kind "park-one" is not supported by look "desk"; the looks that support it: park-b']);
  assert.deepEqual(kindSupportProblems('park-all', desk).map((p) => p.message), ['kind "park-all" is not supported by look "desk"; the looks that support it: none']);
  assert.deepEqual(kindSupportProblems('park-all', registries.looks.get('park-a')), [], 'a parked kind still validates in the look that parks it');
});

test('a film using a parked kind exits 0 with one stderr line and the report entry, no finding', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mm-v2-parked-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const specPath = path.join(dir, 'film.json');
  writeFileSync(specPath, JSON.stringify({ version: 2, mode: 'pro', look: 'park-a', shots: [{ id: 'a', show: 'park-all', hold: 1 }, { id: 'b', show: 'park-all', hold: 1 }] }));
  const lines = [];
  const { report, exitCode } = await runMake({ specPath, out: null, exact: false, noRender: true, outline: true }, { log: (line) => lines.push(line) });
  assert.equal(exitCode, 0, JSON.stringify(report));
  assert.deepEqual(lines.filter((l) => /experimental/.test(l)), ['make: kind "park-all" is experimental in look "park-a": it renders, but it is not one of the listed kinds and may change']);
  assert.deepEqual(report.kinds, [{ name: 'park-all', look: 'park-a', experimental: true }]);
  assert.deepEqual(report.findings, []);
});

test('a parked chart type is reported the same way', () => {
  const film = { version: 2, mode: 'pro', look: 'park-c', shots: [{ id: 'c', show: 'chart', type: 'donut', hold: 1 }, { id: 'd', show: 'chart', type: 'bar', hold: 1 }] };
  assert.deepEqual(experimentalKinds(film), [{ name: 'chart', type: 'donut', look: 'park-c', experimental: true }]);
  assert.deepEqual(experimentalKinds({ ...film, look: 'desk' }), []);
});
