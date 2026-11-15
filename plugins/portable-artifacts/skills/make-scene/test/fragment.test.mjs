// PA-26: build --fragment writes the embeddable scene (what api.mjs already assembles) instead of a whole page:
// the scene CSS, the host div with its data, the runtime and the one mount call. Whether it mounts in a host
// page is a browser check (lift-browser / scene-browser); this file pins what is written and how.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from '../scripts/build.mjs';
import { PINNED_ENV, tempDir, writeScene } from './helpers/scene-fixtures.mjs';

const BUILD_CLI = fileURLToPath(new URL('../scripts/build.mjs', import.meta.url));
const BASE = { title: 'Commits per folder', data: { file: 'rows.json' }, tour: [{ title: 'W31', focus: ['2026-W31'] }] };
const env = (dir) => ({ ...PINNED_ENV, PA_OUTPUT_DIR: dir });

test('--fragment writes <slug>.fragment.html: the scene css, the host, the runtime and one mount call, no document', async (t) => {
  const file = writeScene(t, BASE);
  const dir = tempDir(t);
  const result = await build(file, { fragment: true, env: env(dir) });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.out, path.join(dir, 'commits-per-folder.fragment.html'));
  const text = fs.readFileSync(result.out, 'utf8');
  assert.doesNotMatch(text, /<!doctype|<html|<head|<body/i, 'a fragment, not a page');
  assert.match(text, /^<!-- make-scene fragment/);
  assert.match(text, /<style id="pa-scene-css">/);
  assert.match(text, /<div class="pa-scene" id="sc" data-pa-scene/);
  assert.match(text, /<script type="application\/json" id="sc-data">/);
  assert.match(text, /PAScene\.initAll\(\{ embedded: true \}\)/);
  assert.equal(text.split('<script>').length - 1, 2, 'the runtime and the mount call, nothing else');
  assert.equal(fs.readdirSync(dir).length, 1, 'only the fragment was written');
});

test('a fragment carries the same graph a page would, tour included', async (t) => {
  const file = writeScene(t, BASE);
  const frag = await build(file, { fragment: true, env: env(tempDir(t)) });
  const page = await build(file, { env: env(tempDir(t)) });
  const graphOf = (html) => JSON.parse(/<script type="application\/json" id="sc-data">([\s\S]*?)<\/script>/.exec(html)[1].replaceAll('\\u003c', '<'));
  assert.deepEqual(graphOf(fs.readFileSync(frag.out, 'utf8')), graphOf(fs.readFileSync(page.out, 'utf8')));
});

test('--fragment with --out file.html writes exactly that file; the same spec gives the same bytes', async (t) => {
  const file = writeScene(t, BASE);
  const out = path.join(tempDir(t), 'embed.html');
  const a = await build(file, { fragment: true, out, env: env(tempDir(t)) });
  assert.equal(a.out, out);
  const first = fs.readFileSync(out, 'utf8');
  await build(file, { fragment: true, out, env: env(tempDir(t)) });
  assert.equal(fs.readFileSync(out, 'utf8'), first);
});

test('--fragment never rewrites scene.json and offers no alternatives table', async (t) => {
  const file = writeScene(t, BASE);
  const before = fs.readFileSync(file, 'utf8');
  const result = await build(file, { fragment: true, env: env(tempDir(t)) });
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.deepEqual(result.alternatives, []);
});

test('CLI: --fragment prints wrote, then the file:// URL on its own line', (t) => {
  const file = writeScene(t, BASE);
  const dir = tempDir(t);
  const run = spawnSync(process.execPath, [BUILD_CLI, file, '--fragment'], { encoding: 'utf8', env: { ...process.env, ...PINNED_ENV, PA_OUTPUT_DIR: dir } });
  assert.equal(run.status, 0, run.stderr);
  const page = path.join(dir, 'commits-per-folder.fragment.html');
  const lines = run.stdout.split('\n');
  assert.equal(lines[0], `wrote ${page}`);
  assert.equal(lines[1], pathToFileURL(page).href);
  const json = spawnSync(process.execPath, [BUILD_CLI, file, '--fragment', '--json'], { encoding: 'utf8', env: { ...process.env, ...PINNED_ENV, PA_OUTPUT_DIR: dir } });
  assert.equal(JSON.parse(json.stdout).fragment, true);
});
