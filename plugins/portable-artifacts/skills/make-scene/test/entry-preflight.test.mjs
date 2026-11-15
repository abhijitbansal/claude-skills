// PA-08: validate.mjs and build.mjs run from a copy with no node_modules print one line naming the doctor command and
// exit 2, instead of a raw ERR_MODULE_NOT_FOUND stack with exit 1. The copy holds only scripts/ and shared/ (no
// node_modules, no template): everything the script needs before its first heavy import. (The browser check script is
// not here: with no install it already skips, exit 0, with the doctor command in its hint.)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SKILL = fileURLToPath(new URL('..', import.meta.url));
const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

function bareCopy() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scene-bare-'));
  made.push(root);
  const copy = path.join(root, 'make-scene');
  fs.mkdirSync(copy);
  fs.cpSync(path.join(SKILL, 'scripts'), path.join(copy, 'scripts'), { recursive: true });
  fs.cpSync(path.join(SKILL, 'shared'), path.join(copy, 'shared'), { recursive: true });
  fs.writeFileSync(path.join(copy, 'package.json'), '{"type":"module"}');
  return copy;
}
const spec = path.join(SKILL, 'references/examples/city.scene.json');
const run = (copy, script, args) => spawnSync(process.execPath, [path.join(copy, 'scripts', script), ...args], { encoding: 'utf8' });

for (const script of ['validate.mjs', 'build.mjs']) {
  test(`${script} with no node_modules: one line naming the doctor command, exit 2, no stack`, () => {
    const copy = bareCopy();
    const r = run(copy, script, [spec]);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.doesNotMatch(r.stderr, /ERR_MODULE_NOT_FOUND|Cannot find package|at (ModuleLoader|file:)/);
    assert.match(r.stderr, /dependencies are not installed \(no node_modules in .*make-scene\); run: node .*scripts\/doctor\.mjs --fix node_modules/);
    assert.equal(r.stderr.trim().split('\n').length, 1, r.stderr);
  });

  test(`${script} --json with no node_modules prints the error as JSON on stdout, exit 2`, () => {
    const copy = bareCopy();
    const r = run(copy, script, [spec, '--json']);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    const body = JSON.parse(r.stdout);
    assert.equal(body.ok, false);
    assert.match(body.errors[0].message, /run: node .*doctor\.mjs --fix node_modules/);
  });
}

test('with node_modules present validate runs as before (preflight is silent)', () => {
  const ok = spawnSync(process.execPath, [path.join(SKILL, 'scripts/validate.mjs'), spec], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /: valid\n$/);
});

test('--help and a usage error are answered before the dependency check: they need no node_modules', () => {
  const copy = bareCopy();
  for (const script of ['validate.mjs', 'build.mjs']) {
    const help = run(copy, script, ['--help']);
    assert.equal(help.status, 0, help.stdout + help.stderr);
    assert.match(help.stdout, new RegExp(`^usage: node scripts/${script.replace('.', '\\.')}`));
    const bad = run(copy, script, ['--bogus']);
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /Unknown option '--bogus'/);
  }
});
