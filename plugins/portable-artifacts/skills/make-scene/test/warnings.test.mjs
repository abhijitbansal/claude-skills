// PA-24: the validator's warning tier. Rules the docs state and no error enforces, and data the build drops quietly,
// come back as warnings ({ path, message }): exit 0, `ok` unchanged, and nothing at all for a plain valid spec.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateSpec } from '../scripts/lib/spec.mjs';
import { build } from '../scripts/build.mjs';
import { PINNED_ENV, citySpec, tempDir, writeScene } from './helpers/scene-fixtures.mjs';

const VALIDATE = fileURLToPath(new URL('../scripts/validate.mjs', import.meta.url));
const grid = (extra = {}) => ['api', 'web'].flatMap((group, g) => ['2026-W30', '2026-W31'].map((t, i) => ({ group, t, value: 2 + g + i, ...extra })));
const scene = (extra = {}) => ({ title: 'T', data: { rows: grid() }, ...extra });
const warningsOf = async (spec) => (await validateSpec(spec, { dir: process.cwd() })).warnings ?? [];
const only = async (spec, pattern) => (await warningsOf(spec)).filter((w) => pattern.test(w.message));

test('a plain valid scene has no warnings, and the result has no warnings key', async () => {
  const result = await validateSpec(scene({ tour: [{ title: 'W31', focus: ['2026-W31'] }] }), { dir: process.cwd() });
  assert.deepEqual(result, { ok: true, errors: [] });
  assert.deepEqual(await validateSpec(citySpec(), { dir: process.cwd() }), { ok: true, errors: [] });
});

test('links on a scene that is not a galaxy are dropped: warned, still valid', async () => {
  const spec = scene({ world: 'city', links: [{ from: 'api', to: 'web', value: 1 }] });
  const result = await validateSpec(spec, { dir: process.cwd() });
  assert.equal(result.ok, true);
  assert.deepEqual(result.warnings.map((w) => w.path), ['links']);
  assert.match(result.warnings[0].message, /1 link.*only the galaxy draws links.*city.*set world to "galaxy" or remove them/);
  assert.deepEqual(await warningsOf(scene({ world: 'galaxy', links: [{ from: 'api', to: 'web', value: 1 }] })), []);
  assert.deepEqual(await warningsOf(scene({ links: [{ from: 'api', to: 'web', value: 1 }] })), [], 'no world: links make it a galaxy');
});

test('parent on a scene that is not a forest is ignored: warned once, with the count', async () => {
  const rows = [{ group: 'a', value: 1 }, { group: 'b', value: 2, parent: 'a' }, { group: 'c', value: 3, parent: 'a' }];
  const found = await warningsOf({ title: 'T', world: 'city', data: { rows } });
  assert.equal(found.length, 1);
  assert.equal(found[0].path, 'data.rows[1].parent');
  assert.match(found[0].message, /2 rows have a parent.*only the forest draws one.*city/);
  assert.deepEqual(await warningsOf({ title: 'T', world: 'forest', data: { rows } }), []);
});

test('a blank title, subtitle, beat title or caption is warned', async () => {
  const found = await warningsOf(scene({ title: '   ', subtitle: ' ', tour: [{ title: ' ', caption: '  ', focus: ['api'] }] }));
  assert.deepEqual(found.map((w) => w.path).sort(), ['subtitle', 'title', 'tour[0].caption', 'tour[0].title']);
  assert.ok(found.every((w) => /is blank/.test(w.message)));
});

test('groups that differ only by case or spacing read as one thing: warned at the later one', async () => {
  const rows = [{ group: 'API', value: 1 }, { group: 'api ', value: 2 }, { group: 'web', value: 3 }];
  const found = await only({ title: 'T', data: { rows } }, /differs from/);
  assert.equal(found.length, 1);
  assert.equal(found[0].path, 'data.rows[1].group');
  assert.match(found[0].message, /"api " differs from "API" only by case or spacing/);
});

test('every value zero draws nothing worth seeing: warned', async () => {
  const found = await warningsOf({ title: 'T', data: { rows: [{ group: 'a', value: 0 }, { group: 'b', value: 0 }] } });
  assert.equal(found.length, 1);
  assert.match(found[0].message, /every value is 0/);
});

test('a label shared by several rows can focus only the first: warned', async () => {
  const rows = [{ group: 'a', value: 1, label: 'Spike' }, { group: 'b', value: 2, label: 'spike' }];
  const found = await only({ title: 'T', data: { rows } }, /label/);
  assert.equal(found.length, 1);
  assert.equal(found[0].path, 'data.rows[1].label');
  assert.match(found[0].message, /same label as data\.rows\[0\].*a tour focus reaches only the first/);
});

test('500 rows sharing one label give one warning that counts them, not 499', async () => {
  const rows = Array.from({ length: 500 }, (_, i) => ({ group: `g${i % 5}`, t: `2026-${String(i).padStart(3, '0')}`, value: i + 1, label: 'Spike' }));
  const found = await only({ title: 'T', data: { rows } }, /label/);
  assert.equal(found.length, 1);
  assert.equal(found[0].path, 'data.rows[1].label');
  assert.match(found[0].message, /499 rows have the same label as data\.rows\[0\].*a tour focus reaches only the first/);
});

test('shared labels: each repeated label is one warning, however many rows repeat it', async () => {
  const rows = [
    { group: 'a', value: 1, label: 'X' }, { group: 'b', value: 1, label: 'x' }, { group: 'c', value: 1, label: 'X' },
    { group: 'd', value: 1, label: 'Y' }, { group: 'e', value: 1, label: 'Y' },
  ];
  const found = await only({ title: 'T', data: { rows } }, /label/);
  assert.deepEqual(found.map((w) => w.path), ['data.rows[1].label', 'data.rows[4].label']);
  assert.match(found[0].message, /2 rows have the same label as data\.rows\[0\]/);
  assert.match(found[1].message, /this row has the same label as data\.rows\[3\]/);
});

test('many different repeated labels are capped at ten warnings plus one summary', async () => {
  const rows = Array.from({ length: 60 }, (_, i) => ({ group: `g${i % 5}`, t: `2026-${String(i).padStart(3, '0')}`, value: i + 1, label: `L${Math.floor(i / 2)}` }));
  const found = await only({ title: 'T', data: { rows } }, /label/);
  assert.equal(found.length, 11);
  assert.match(found[10].message, /^20 more repeated labels; give each label a name of its own$/);
});

test('warnings come only for a spec with no errors', async () => {
  const result = await validateSpec(scene({ title: '  ', tour: [{ title: 'x', focus: ['nope'] }] }), { dir: process.cwd() });
  assert.equal(result.ok, false);
  assert.equal(result.warnings, undefined);
});

test('a lift has no data warnings, only the text ones', async () => {
  const lift = { diagram: { title: 'x' } };
  assert.equal((await validateSpec({ title: 'T', lift }, { dir: process.cwd() })).warnings, undefined);
  assert.deepEqual((await validateSpec({ title: ' ', lift }, { dir: process.cwd() })).warnings.map((w) => w.path), ['title']);
});

// ---- the CLIs ---------------------------------------------------------------------------------------------------

const WARN_SPEC = { title: 'Warn', world: 'city', data: { file: 'rows.json' }, links: [{ from: 'api', to: 'web', value: 1 }] };

test('validate.mjs prints warnings as "path: warning: message", exits 0, and --json carries them', (t) => {
  const file = writeScene(t, WARN_SPEC);
  const text = spawnSync(process.execPath, [VALIDATE, file], { encoding: 'utf8', env: { ...process.env, ...PINNED_ENV, EVAL_LOG: '' } });
  assert.equal(text.status, 0, text.stdout + text.stderr);
  assert.match(text.stdout, /^links: warning: 1 link/m);
  assert.match(text.stdout, /valid \(1 warning\)$/m);
  const json = spawnSync(process.execPath, [VALIDATE, file, '--json'], { encoding: 'utf8', env: { ...process.env, ...PINNED_ENV, EVAL_LOG: '' } });
  assert.equal(json.status, 0);
  const body = JSON.parse(json.stdout);
  assert.equal(body.ok, true);
  assert.equal(body.warnings[0].path, 'links');
});

test('build.mjs keeps the warnings: on stderr as text, in the result and under --json', async (t) => {
  const file = writeScene(t, WARN_SPEC);
  const out = tempDir(t);
  const built = await build(file, { env: { ...PINNED_ENV, PA_OUTPUT_DIR: out } });
  assert.equal(built.ok, true);
  assert.equal(built.warnings[0].path, 'links');
  const run = spawnSync(process.execPath, [path.join(path.dirname(VALIDATE), 'build.mjs'), file, '--json'], { encoding: 'utf8', env: { ...process.env, ...PINNED_ENV, PA_OUTPUT_DIR: out } });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(JSON.parse(run.stdout).warnings[0].path, 'links');
  const text = spawnSync(process.execPath, [path.join(path.dirname(VALIDATE), 'build.mjs'), file], { encoding: 'utf8', env: { ...process.env, ...PINNED_ENV, PA_OUTPUT_DIR: out } });
  assert.match(text.stderr, /^links: warning: 1 link/m);
  assert.ok(fs.existsSync(built.out));
});
