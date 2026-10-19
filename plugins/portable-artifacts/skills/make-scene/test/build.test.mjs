// build.mjs: world switching, recommendation, the alternatives table, output location, the cap, exit codes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build, resolveScenePath } from '../scripts/build.mjs';
import { WORLDS } from '../scripts/worlds/index.mjs';
import { MAX_PAGE_BYTES } from '../scripts/lib/bundle.mjs';
import { PINNED_ENV, ROWS, tempDir, writeScene } from './helpers/scene-fixtures.mjs';

const BUILD_CLI = fileURLToPath(new URL('../scripts/build.mjs', import.meta.url));
const SKILL = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const BASE = { title: 'Commits per folder', units: 'commits', data: { file: 'rows.json' } };

const read = (file) => fs.readFileSync(file, 'utf8');
const env = (dir) => ({ ...PINNED_ENV, PA_OUTPUT_DIR: dir });

function cli(args, { home, extraEnv = {} } = {}) {
  const clean = { ...process.env, ...PINNED_ENV, ...extraEnv };
  delete clean.PA_OUTPUT_DIR;
  if (extraEnv.PA_OUTPUT_DIR) clean.PA_OUTPUT_DIR = extraEnv.PA_OUTPUT_DIR;
  if (home) clean.HOME = home;
  return spawnSync(process.execPath, [BUILD_CLI, ...args], { encoding: 'utf8', env: clean });
}

test('--world rewrites only the world field', async (t) => {
  const file = writeScene(t, { ...BASE, subtitle: 'two services', world: 'city', tour: [{ title: 'API', focus: ['api'] }] });
  const before = JSON.parse(read(file));
  const result = await build(file, { world: 'forest', env: env(tempDir(t)) });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const raw = read(file);
  const after = JSON.parse(raw);
  assert.deepEqual({ ...after, world: before.world }, before, 'nothing but world changed');
  assert.equal(after.world, 'forest');
  assert.deepEqual(Object.keys(after), Object.keys(before), 'key order is kept');
  assert.equal(raw, `${JSON.stringify(after, null, 2)}\n`, '2-space JSON with a final newline');
  assert.equal(result.world, 'forest');
  assert.equal(result.rewroteSpec, true);
});

test('--world appends the field when the spec had none, without leaking --theme or provenance', async (t) => {
  const file = writeScene(t, BASE);
  const result = await build(file, { world: 'galaxy', theme: 'paper', model: 'haiku', env: env(tempDir(t)) });
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(read(file)), { ...BASE, world: 'galaxy' });
});

test('--world to an ineligible world leaves scene.json unchanged', async (t) => {
  const rows = [{ group: 'api', value: 3 }, { group: 'web', value: 4 }]; // no t: terrain needs it
  const file = writeScene(t, { ...BASE, world: 'city' }, { rows });
  const before = read(file);
  const out = tempDir(t);
  const result = await build(file, { world: 'terrain', env: env(out) });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].path, 'world');
  assert.match(result.errors[0].message, /terrain/);
  assert.equal(read(file), before, 'byte-identical');
  assert.deepEqual(fs.readdirSync(out), [], 'no page was written either');
});

test('an unknown --world is a spec error that offers the real ones', async (t) => {
  const file = writeScene(t, BASE);
  const result = await build(file, { world: 'forrest', env: env(tempDir(t)) });
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.errors), /forest/);
});

test('no world uses top recommendation', async (t) => {
  const withLinks = writeScene(t, BASE, { links: [{ from: 'api', to: 'web', value: 3 }] });
  const linked = await build(withLinks, { env: env(tempDir(t)) });
  assert.equal(linked.world, 'galaxy', 'links -> galaxy');
  assert.equal(JSON.parse(read(withLinks)).world, undefined, 'a plain build does not write the world back');
  const grid = writeScene(t, BASE);
  assert.equal((await build(grid, { env: env(tempDir(t)) })).world, 'terrain', 'a filled group x t grid -> terrain');
  const plain = writeScene(t, BASE, { rows: [{ group: 'api', value: 3 }, { group: 'web', value: 4 }] });
  assert.equal((await build(plain, { env: env(tempDir(t)) })).world, 'city', 'rows without a time -> city');
});

test('a world named in the spec is used as written', async (t) => {
  const file = writeScene(t, { ...BASE, world: 'forest' }, { links: [{ from: 'api', to: 'web' }] });
  const result = await build(file, { env: env(tempDir(t)) });
  assert.equal(result.world, 'forest');
  assert.equal(result.rewroteSpec, false);
});

test('over-cap page is an error with both sizes', async (t) => {
  const file = writeScene(t, BASE);
  const out = tempDir(t);
  const result = await build(file, { maxBytes: 2048, env: env(out) });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].path, '');
  assert.match(result.errors[0].message, /the page is \d+ KB; the limit is 2 KB/);
  assert.deepEqual(fs.readdirSync(out), []);
  assert.equal(typeof MAX_PAGE_BYTES, 'number');
});

test('default output is PA_OUTPUT_DIR or ~/.agent/scenes', async (t) => {
  const file = writeScene(t, BASE);
  const dir = tempDir(t);
  const result = await build(file, { env: env(dir) });
  assert.equal(result.out, path.join(dir, 'commits-per-folder.html'));
  assert.ok(fs.existsSync(result.out));
  assert.equal(resolveScenePath({ title: 'Commits per folder', env: {}, home: '/home/x' }), '/home/x/.agent/scenes/commits-per-folder.html');
  assert.equal(resolveScenePath({ title: 'T', out: '/tmp/a.html', env: { PA_OUTPUT_DIR: '/p' }, home: '/h' }), '/tmp/a.html');
  assert.equal(resolveScenePath({ title: 'T', out: '/tmp/dir', env: {}, home: '/h' }), '/tmp/dir/t.html');
  assert.equal(resolveScenePath({ title: '!!!', env: { PA_OUTPUT_DIR: '/p' }, home: '/h' }), '/p/scene.html');

  const home = tempDir(t);
  const run = cli([file], { home });
  assert.equal(run.status, 0, run.stderr);
  assert.ok(fs.existsSync(path.join(home, '.agent', 'scenes', 'commits-per-folder.html')), run.stdout);
});

test('same spec same bytes', async (t) => {
  const file = writeScene(t, BASE);
  const a = await build(file, { env: env(tempDir(t)) });
  const b = await build(file, { env: env(tempDir(t)) });
  assert.equal(read(a.out), read(b.out));
  assert.equal(a.bytes, Buffer.byteLength(read(a.out)));
});

test('the alternatives table names every world, the current one, and the exact switch command', async (t) => {
  const rows = [{ group: 'api', value: 3 }, { group: 'web', value: 4 }];
  const file = writeScene(t, BASE, { rows });
  const result = await build(file, { env: env(tempDir(t)) });
  assert.deepEqual(result.alternatives.map((a) => a.world).sort(), ['city', 'forest', 'galaxy', 'terrain']);
  const terrain = result.alternatives.find((a) => a.world === 'terrain');
  assert.equal(terrain.eligible, false);
  assert.match(result.table, /terrain.*not available: needs t on every row/);
  assert.match(result.table, /city \(current\)/);
  assert.ok(result.table.includes(`node ${SKILL}/scripts/build.mjs ${file} --world forest`), result.table);
  assert.doesNotMatch(result.table.split('\n').find((l) => l.startsWith('terrain')), /--world/);
  assert.match(result.table, /spec authoring ≈ \d+ tokens \(estimated\)/);
  const forest = result.alternatives.find((a) => a.world === 'forest');
  assert.ok(forest.estBytes > 0 && ['light', 'medium', 'heavy'].includes(forest.weight));
  assert.ok(forest.reason.length > 0);
});

test('alternative page sizes are measured: current page minus its fragment plus theirs', async (t) => {
  const file = writeScene(t, { ...BASE, world: 'city' });
  const first = await build(file, { env: env(tempDir(t)) });
  const forest = first.alternatives.find((a) => a.world === 'forest');
  const switched = await build(file, { world: 'forest', env: env(tempDir(t)) });
  assert.equal(forest.estBytes, switched.bytes, 'the estimate equals what switching then builds');
});

test('CLI: prints wrote / open / world note / table; --json is one object', async (t) => {
  const file = writeScene(t, { ...BASE, world: 'city' });
  const out = tempDir(t);
  const text = cli([file, '--world', 'forest'], { extraEnv: { PA_OUTPUT_DIR: out } });
  assert.equal(text.status, 0, text.stderr);
  const lines = text.stdout.split('\n');
  assert.equal(lines[0], 'scene.json: world set to forest');
  assert.equal(lines[1], `wrote ${path.join(out, 'commits-per-folder.html')}`);
  assert.match(lines[2], /^open: file:\/\//);
  assert.match(text.stdout, /\nworld\s+\| fit/);

  const json = cli([file, '--json', '--theme', 'paper'], { extraEnv: { PA_OUTPUT_DIR: out } });
  assert.equal(json.status, 0, json.stderr);
  const parsed = JSON.parse(json.stdout);
  assert.deepEqual(Object.keys(parsed), ['ok', 'out', 'bytes', 'world', 'alternatives']);
  assert.equal(parsed.world, 'forest');
  assert.equal(parsed.alternatives.length, 4);
});

test('CLI exit codes: 1 for a spec error, 2 for usage and IO', async (t) => {
  const bad = writeScene(t, { ...BASE, theme: 'nope' });
  const spec = cli([bad]);
  assert.equal(spec.status, 1);
  assert.match(spec.stderr + spec.stdout, /unknown theme/);
  assert.equal(cli(['missing.json']).status, 2);
  assert.equal(cli([]).status, 2);
  const flag = cli([bad, '--wrld', 'city']);
  assert.equal(flag.status, 2);
  assert.match(flag.stderr, /did you mean '--world'/);
});

test('--allow-outside passes through to validation', async (t) => {
  const dir = tempDir(t);
  const inner = path.join(dir, 'spec');
  fs.mkdirSync(inner);
  fs.writeFileSync(path.join(dir, 'rows.json'), JSON.stringify({ rows: ROWS }));
  const file = path.join(inner, 'scene.json');
  fs.writeFileSync(file, JSON.stringify({ title: 'Outside', data: { file: '../rows.json' } }));
  const refused = await build(file, { env: env(tempDir(t)) });
  assert.equal(refused.ok, false);
  assert.match(refused.errors[0].message, /outside the spec folder/);
  const allowed = await build(file, { allowOutside: true, env: env(tempDir(t)) });
  assert.equal(allowed.ok, true, JSON.stringify(allowed.errors));
});

test('a lift spec is a clear error until its module exists', async (t) => {
  const file = writeScene(t, { title: 'Lift', lift: { dashboard: 'rows.json', chart: 'c1' } });
  const result = await build(file, { env: env(tempDir(t)) });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].path, 'lift');
  assert.match(result.errors[0].message, /not available yet/);
});

test('a world that fails to build is a "not available" row; the page is still written and the build succeeds', async (t) => {
  const file = writeScene(t, { ...BASE, world: 'city' });
  const out = tempDir(t);
  const real = WORLDS.forest;
  WORLDS.forest = () => {
    throw new Error('forest exploded\nsecond line');
  };
  t.after(() => {
    WORLDS.forest = real;
  });
  const result = await build(file, { env: env(out) });
  assert.equal(result.ok, true);
  assert.ok(fs.existsSync(result.out), 'the page exists');
  const forest = result.alternatives.find((a) => a.world === 'forest');
  assert.equal(forest.eligible, false);
  assert.match(result.table, /forest\s+\| not available: forest exploded\s+\| 0\s+\| —/);
  assert.doesNotMatch(result.table.split('\n').find((l) => l.startsWith('forest')), /--world|second line/);
  assert.ok(result.alternatives.find((a) => a.world === 'galaxy').eligible, 'the other worlds are unaffected');
});
