// The voice and cutout models live in a stable per-user folder, so a plugin update does not download them again (PA-09, part 1).
// No browser, no model: only where the folders are.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { modelsDir } from '../scripts/lib/model-cache.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = () => mkdtempSync(path.join(tmpdir(), 'cd-'));

test('modelsDir: $CLAUDE_PLUGIN_DATA when the host sets it', () => {
  const skillDir = tmp();
  assert.equal(modelsDir(skillDir, { env: { CLAUDE_PLUGIN_DATA: '/data/plugin' }, platform: 'darwin', homedir: '/Users/x' }), path.join('/data/plugin', 'models'));
});

test('modelsDir: else the OS cache folder, outside the versioned skill folder', () => {
  const skillDir = tmp();
  assert.equal(modelsDir(skillDir, { env: {}, platform: 'darwin', homedir: '/Users/x' }), '/Users/x/Library/Caches/portable-artifacts/models');
  assert.equal(modelsDir(skillDir, { env: { XDG_CACHE_HOME: '/xdg' }, platform: 'linux', homedir: '/home/x' }), '/xdg/portable-artifacts/models');
});

test('modelsDir: else <skill>/.cache/models (no home folder, no data folder)', () => {
  const skillDir = tmp();
  assert.equal(modelsDir(skillDir, { env: {}, platform: 'linux', homedir: '' }), path.join(skillDir, '.cache', 'models'));
});

test('modelsDir: an install that already downloaded the models into <skill>/.cache/models keeps using them until the stable folder has its own', () => {
  const skillDir = tmp();
  const home = tmp();
  const stable = path.join(home, 'Library', 'Caches', 'portable-artifacts', 'models');
  const legacy = path.join(skillDir, '.cache', 'models');
  const options = { env: {}, platform: 'darwin', homedir: home };
  assert.equal(modelsDir(skillDir, options), stable, 'nothing downloaded yet: the stable folder');
  mkdirSync(legacy, { recursive: true });
  assert.equal(modelsDir(skillDir, options), legacy, 'models already in the skill folder are reused, not downloaded again');
  mkdirSync(stable, { recursive: true });
  assert.equal(modelsDir(skillDir, options), stable, 'once the stable folder exists it wins');
});

test('voice.mjs and cutout.mjs put their models under that folder', () => {
  const data = tmp();
  mkdirSync(path.join(data, 'models')); // an existing stable folder wins over a legacy <skill>/.cache/models on this machine
  const script = `const v = await import(${JSON.stringify(pathToFileURL(path.join(root, 'scripts/lib/voice.mjs')).href)});
    const c = await import(${JSON.stringify(pathToFileURL(path.join(root, 'scripts/lib/cutout.mjs')).href)});
    process.stdout.write(JSON.stringify({ voice: v.MODEL_CACHE_DIR, cutout: c.MODEL_DIR }));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', env: { ...process.env, CLAUDE_PLUGIN_DATA: data } });
  assert.equal(r.status, 0, r.stderr);
  const dirs = JSON.parse(r.stdout);
  assert.equal(dirs.voice, path.join(data, 'models'));
  assert.equal(dirs.cutout, path.join(data, 'models', 'modnet'));
});
