import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { diffShared, syncShared, GENERATED_NOTE } from '../sync-shared.mjs';

const PLUGIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(PLUGIN, 'bin/sync-shared.mjs');

// A throwaway plugin: shared/ with a file, a subfolder, a test dir and a README; two skills.
function fakePlugin() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-sync-'));
  fs.mkdirSync(path.join(dir, 'shared/themes'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'shared/test'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'shared/a.mjs'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(dir, 'shared/themes/t.json'), '{}\n');
  fs.writeFileSync(path.join(dir, 'shared/test/a.test.mjs'), '// not synced\n');
  fs.writeFileSync(path.join(dir, 'shared/README.md'), '# source\n');
  for (const s of ['one', 'two']) {
    fs.mkdirSync(path.join(dir, 'skills', s), { recursive: true });
    fs.writeFileSync(path.join(dir, 'skills', s, 'SKILL.md'), '---\nname: x\n---\n');
  }
  fs.mkdirSync(path.join(dir, 'skills/not-a-skill'), { recursive: true });
  return dir;
}

test('sync copies shared/ into every skill, minus test/ and README.md, plus GENERATED.md', () => {
  const dir = fakePlugin();
  syncShared(dir);
  for (const s of ['one', 'two']) {
    const copy = path.join(dir, 'skills', s, 'shared');
    assert.equal(fs.readFileSync(path.join(copy, 'a.mjs'), 'utf8'), 'export const a = 1;\n');
    assert.ok(fs.existsSync(path.join(copy, 'themes/t.json')));
    assert.ok(!fs.existsSync(path.join(copy, 'test')));
    assert.ok(!fs.existsSync(path.join(copy, 'README.md')));
    assert.equal(fs.readFileSync(path.join(copy, 'GENERATED.md'), 'utf8'), GENERATED_NOTE);
  }
  assert.ok(!fs.existsSync(path.join(dir, 'skills/not-a-skill/shared')));
  assert.deepEqual(diffShared(dir), []);
});

test('diff reports a hand-edited copy, a missing file and an extra file', () => {
  const dir = fakePlugin();
  syncShared(dir);
  fs.writeFileSync(path.join(dir, 'skills/one/shared/a.mjs'), 'export const a = 2;\n');
  fs.rmSync(path.join(dir, 'skills/two/shared/themes/t.json'));
  fs.writeFileSync(path.join(dir, 'skills/two/shared/stray.mjs'), '');
  assert.deepEqual(diffShared(dir), [
    { skill: 'one', file: 'a.mjs', problem: 'changed' },
    { skill: 'two', file: 'stray.mjs', problem: 'extra' },
    { skill: 'two', file: 'themes/t.json', problem: 'missing' },
  ]);
  syncShared(dir);
  assert.deepEqual(diffShared(dir), [], 'sync repairs every kind of drift');
});

test('CLI: --check exits 1 listing drift, an unknown flag exits 2 naming the accepted one', () => {
  const dir = fakePlugin();
  syncShared(dir);
  fs.writeFileSync(path.join(dir, 'skills/one/shared/a.mjs'), 'drift\n');
  let r = spawnSync(process.execPath, [SCRIPT, '--check', '--plugin', dir], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /skills\/one\/shared\/a\.mjs: changed/);
  r = spawnSync(process.execPath, [SCRIPT, '--bogus'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /accepted: --check, --plugin <dir>/);
});

test('the real plugin is in sync (CI guard)', () => {
  assert.deepEqual(diffShared(PLUGIN), []);
});
