// End to end: a build run from an old plugin-cache copy warns on stderr and still builds. The temp HOME keeps the
// test off the real ~/.claude.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN = path.resolve(ROOT, '../..');
const SPEC = path.join(ROOT, 'references', 'examples', 'concept.explainer.json');
const PLUGIN_KEY = 'portable-artifacts@claude-skills';

let home;
let cache;
let canLink = true;

before(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'stale-copy-'));
  cache = path.join(home, '.claude', 'plugins', 'cache', 'claude-skills', 'portable-artifacts');
  fs.mkdirSync(cache, { recursive: true });
  try {
    fs.symlinkSync(PLUGIN, path.join(cache, '0.8.0'), 'dir');
  } catch (e) {
    if (e.code !== 'EPERM') throw e;
    canLink = false;
  }
});

after(() => fs.rmSync(home, { recursive: true, force: true }));

function install(installPath) {
  fs.writeFileSync(path.join(home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { [PLUGIN_KEY]: [{ installPath }] } }));
}

function build(script) {
  const out = path.join(home, 'page.html');
  fs.rmSync(out, { force: true });
  const r = spawnSync(process.execPath, [script, SPEC, '--out', out], { encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home, EVAL_LOG: '' } });
  return { r, out };
}

test('a build run from a stale cache copy warns on stderr, exits 0 and writes the page', (t) => {
  if (!canLink) return t.skip('symlinks need a privilege here');
  install(path.join(cache, '1.0.0'));
  const { r, out } = build(path.join(cache, '0.8.0', 'skills', 'make-explainer', 'scripts', 'build.mjs'));
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.ok(fs.existsSync(out));
  assert.ok(r.stdout.includes('wrote '), r.stdout);
  assert.equal(r.stderr.trim(), `warning: this script runs from ${path.join(cache, '0.8.0')}, not the installed copy ${path.join(cache, '1.0.0')}; run npm ci in ${path.join(cache, '1.0.0', 'skills', 'make-explainer')} (or node ${path.join(cache, '1.0.0', 'skills', 'make-explainer', 'scripts', 'doctor.mjs')} --fix node_modules), then use that copy`);
});

test('the same build from the installed copy is silent', (t) => {
  if (!canLink) return t.skip('symlinks need a privilege here');
  install(path.join(cache, '0.8.0'));
  const { r, out } = build(path.join(cache, '0.8.0', 'skills', 'make-explainer', 'scripts', 'build.mjs'));
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.ok(fs.existsSync(out));
  assert.equal(r.stderr, '');
});

test('a build run from the repo checkout is silent even when installed_plugins.json names another folder', () => {
  install(path.join(cache, '1.0.0'));
  const { r } = build(path.join(ROOT, 'scripts', 'build.mjs'));
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(r.stderr, '');
});
