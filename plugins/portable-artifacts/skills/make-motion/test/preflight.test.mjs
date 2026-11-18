// A copy of the skill with no node_modules: the cut-out tool prints the doctor's command and exits 2 (PA-08), not a raw
// ERR_MODULE_NOT_FOUND stack with exit 1. The entry script checks for node_modules with Node built-ins, then imports the rest.
// No browser: none of these gets past the preflight. (Version 1's validate, preview, render, check and voice entries had the
// same check; they were deleted at cut-over. make.mjs has no node_modules preflight of its own.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// scripts and shared only: no node_modules, no sister skills.
function bareCopy() {
  const copy = path.join(mkdtempSync(path.join(tmpdir(), 'pf-')), 'make-motion');
  mkdirSync(copy, { recursive: true });
  for (const dir of ['scripts', 'shared']) cpSync(path.join(root, dir), path.join(copy, dir), { recursive: true });
  writeFileSync(path.join(copy, 'package.json'), '{ "type": "module" }');
  assert.equal(existsSync(path.join(copy, 'node_modules')), false);
  return copy;
}
const run = (copy, script, args) => spawnSync(process.execPath, [path.join(copy, 'scripts', script), ...args], { encoding: 'utf8' });
const FIX = (copy) => `scripts/doctor.mjs --fix node_modules`.replace('scripts/', `${path.join(copy, 'scripts')}/`);

const ENTRIES = [['cutout.mjs', ['photo.png']]];
for (const [script, args] of ENTRIES) {
  test(`${script} in a copy with no node_modules prints the doctor command and exits 2, with no stack`, () => {
    const copy = bareCopy();
    const r = run(copy, script, args);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.ok(r.stderr.includes(FIX(copy)), r.stderr);
    assert.match(r.stderr, /dependencies are not installed/);
    assert.doesNotMatch(r.stderr + r.stdout, /ERR_MODULE_NOT_FOUND|Cannot find package|at \w+ \(/);
  });
}

test('with node_modules present the entry scripts run as before', () => {
  const r = spawnSync(process.execPath, [path.join(root, 'scripts/make.mjs'), '--list', 'looks'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /desk/);
  const help = spawnSync(process.execPath, [path.join(root, 'scripts/cutout.mjs'), '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0, help.stdout + help.stderr);
});
