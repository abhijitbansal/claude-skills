import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { preflight, doctorCommand } from '../preflight.mjs';
import { PLUGIN_KEY } from '../stale-copy.mjs';

const PREFLIGHT_URL = pathToFileURL(fileURLToPath(new URL('../preflight.mjs', import.meta.url))).href;

// Run preflight in-process with stdout/stderr captured and the exit code restored.
function run(root, opts = {}) {
  let out = '';
  let err = '';
  const w = process.stdout.write.bind(process.stdout);
  const e = process.stderr.write.bind(process.stderr);
  const prev = process.exitCode;
  process.exitCode = undefined;
  process.stdout.write = (s) => { out += s; return true; };
  process.stderr.write = (s) => { err += s; return true; };
  let ok;
  try { ok = preflight(root, { warn: () => {}, ...opts }); } finally { process.stdout.write = w; process.stderr.write = e; }
  const code = process.exitCode ?? 0;
  process.exitCode = prev;
  return { ok, out, err, code };
}

const present = (...dirs) => (p) => dirs.includes(p);
const ROOT = path.resolve('/skills/make-explainer');

test('node_modules present: returns true, prints nothing, leaves the exit code alone', () => {
  const r = run(ROOT, { argv: ['--json'], exists: present(path.join(ROOT, 'node_modules')) });
  assert.deepEqual(r, { ok: true, out: '', err: '', code: 0 });
});

test('node_modules missing: returns false, exit 2, and the one-line hint names the doctor command', () => {
  const r = run(ROOT, { argv: [], exists: present() });
  assert.equal(r.ok, false);
  assert.equal(r.code, 2);
  assert.equal(r.out, '');
  assert.equal(r.err.trim().split('\n').length, 1);
  assert.ok(r.err.includes(`node ${path.join(ROOT, 'scripts', 'doctor.mjs')} --fix node_modules`), r.err);
  assert.match(r.err, /dependencies are not installed/);
});

test('--json: the same miss is one { ok: false, errors } line on stdout', () => {
  const r = run(ROOT, { argv: ['x.json', '--json'], exists: present() });
  assert.equal(r.code, 2);
  assert.equal(r.err, '');
  const j = JSON.parse(r.out);
  assert.equal(j.ok, false);
  assert.deepEqual(Object.keys(j.errors[0]), ['path', 'message']);
  assert.ok(j.errors[0].message.includes('doctor.mjs'));
});

test('the stale-copy warning runs first, also when node_modules is missing', () => {
  const calls = [];
  const r = run(ROOT, { exists: present(), scriptPath: '/some/script.mjs', warn: (p) => calls.push(p) });
  assert.deepEqual(calls, ['/some/script.mjs']);
  assert.equal(r.ok, false);
  const withDeps = run(ROOT, { exists: present(path.join(ROOT, 'node_modules')), scriptPath: '/some/script.mjs', warn: (p) => calls.push(p) });
  assert.equal(withDeps.ok, true);
  assert.equal(calls.length, 2, 'and when everything is installed');
});

test('a path with spaces is quoted in the hint', () => {
  const spaced = path.resolve('/my skills/make-diagram');
  const r = run(spaced, { exists: present() });
  assert.ok(r.err.includes(`'${path.join(spaced, 'scripts', 'doctor.mjs')}'`), r.err);
  assert.equal(doctorCommand(spaced).startsWith('node '), true);
});

// Real child process: the failure shape the owner saw (a link-time crash) cannot happen because the heavy import comes after.
function fixture({ withModules, home }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-preflight-'));
  const skill = path.join(root, 'skill');
  fs.mkdirSync(path.join(skill, 'scripts'), { recursive: true });
  if (withModules) fs.mkdirSync(path.join(skill, 'node_modules'));
  const entry = path.join(skill, 'scripts', 'entry.mjs');
  fs.writeFileSync(entry, [
    `import { preflight } from ${JSON.stringify(PREFLIGHT_URL)};`,
    `if (preflight(${JSON.stringify(skill)})) {`,
    "  const { value } = await import('some-package-that-is-not-installed');",
    "  console.log('ran', value);",
    '}',
    '',
  ].join('\n'));
  return { root, skill, entry, env: { ...process.env, HOME: home ?? root, USERPROFILE: home ?? root } };
}

test('child process: a missing node_modules ends in the hint and exit 2, not ERR_MODULE_NOT_FOUND and exit 1', () => {
  const f = fixture({ withModules: false });
  const r = spawnSync(process.execPath, [f.entry], { encoding: 'utf8', env: f.env });
  assert.equal(r.status, 2);
  assert.doesNotMatch(r.stderr, /ERR_MODULE_NOT_FOUND|Cannot find package/);
  assert.match(r.stderr, /--fix node_modules/);
  const json = spawnSync(process.execPath, [f.entry, '--json'], { encoding: 'utf8', env: f.env });
  assert.equal(json.status, 2);
  assert.equal(JSON.parse(json.stdout).ok, false);
});

test('child process: with node_modules present the guarded import is reached (the guardrail is what stops the crash)', () => {
  const f = fixture({ withModules: true });
  const r = spawnSync(process.execPath, [f.entry], { encoding: 'utf8', env: f.env });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Cannot find package 'some-package-that-is-not-installed'/, 'without the preflight this is what a missing install looked like');
});

// A node_modules folder that exists but lacks a package (an aborted npm ci, one made by another npm install) is the same
// miss as no folder: each package the skill's package.json lists under "dependencies" must resolve.
function partialSkill(installed) {
  const skill = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-preflight-partial-'));
  fs.writeFileSync(path.join(skill, 'package.json'), JSON.stringify({ name: 'x', dependencies: { ajv: '1.0.0', '@scope/pkg': '1.0.0' }, devDependencies: { playwright: '1.0.0' } }));
  for (const name of installed) {
    fs.mkdirSync(path.join(skill, 'node_modules', name), { recursive: true });
    fs.writeFileSync(path.join(skill, 'node_modules', name, 'package.json'), '{}');
  }
  return skill;
}

test('a node_modules that lacks a dependency of the skill is a miss: exit 2, the missing names, the doctor command', () => {
  const skill = partialSkill(['ajv']);
  const r = run(skill, { argv: [] });
  assert.equal(r.ok, false);
  assert.equal(r.code, 2);
  assert.match(r.err, /dependencies are not installed \(node_modules in .* lacks @scope\/pkg\)/);
  assert.ok(r.err.includes('--fix node_modules'), r.err);
  assert.doesNotMatch(r.err, /ajv\b.*lacks|lacks.*\bajv\b/, 'only the missing one is named');
});

test('every dependency present is a pass, and a devDependency that is not installed is not required', () => {
  const r = run(partialSkill(['ajv', '@scope/pkg']), { argv: [] });
  assert.deepEqual(r, { ok: true, out: '', err: '', code: 0 });
});

test('child process: a node_modules holding one package of two ends in the hint and exit 2, not a raw ERR_MODULE_NOT_FOUND', () => {
  const skill = partialSkill(['ajv']);
  const entry = path.join(skill, 'entry.mjs');
  fs.writeFileSync(entry, [
    `import { preflight } from ${JSON.stringify(PREFLIGHT_URL)};`,
    `if (preflight(${JSON.stringify(skill)})) await import('@scope/pkg');`,
    '',
  ].join('\n'));
  const r = spawnSync(process.execPath, [entry], { encoding: 'utf8', env: { ...process.env, HOME: skill, USERPROFILE: skill } });
  assert.equal(r.status, 2, r.stderr);
  assert.doesNotMatch(r.stderr, /ERR_MODULE_NOT_FOUND|Cannot find package/);
  assert.match(r.stderr, /--fix node_modules/);
});

test('child process: an old plugin-cache copy without node_modules still gets the stale-copy warning', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-preflight-home-'));
  const cache = path.join(home, '.claude', 'plugins', 'cache', 'claude-skills', 'portable-artifacts');
  const oldSkill = path.join(cache, '0.8.0', 'skills', 'make-explainer');
  const newCopy = path.join(cache, '1.0.0');
  fs.mkdirSync(path.join(oldSkill, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(home, '.claude', 'plugins'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { [PLUGIN_KEY]: [{ installPath: newCopy }] } }));
  const entry = path.join(oldSkill, 'scripts', 'build.mjs');
  fs.writeFileSync(entry, `import { preflight } from ${JSON.stringify(PREFLIGHT_URL)};\npreflight(${JSON.stringify(oldSkill)});\n`);
  const r = spawnSync(process.execPath, [entry], { encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home } });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /^warning: this script runs from .*0\.8\.0, not the installed copy .*1\.0\.0/m);
  assert.match(r.stderr, /dependencies are not installed/);
});
