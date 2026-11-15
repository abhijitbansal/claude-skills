// PA-08: validate.mjs and build.mjs run from a copy with no node_modules print one line naming the doctor command and
// exit 2, instead of a raw ERR_MODULE_NOT_FOUND stack with exit 1. The copy holds only scripts/ and shared/ (no
// node_modules, no template, no references): everything the entry scripts need before their first heavy import.
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-bare-'));
  made.push(root);
  const copy = path.join(root, 'make-explainer');
  fs.mkdirSync(copy);
  fs.cpSync(path.join(SKILL, 'scripts'), path.join(copy, 'scripts'), { recursive: true });
  fs.cpSync(path.join(SKILL, 'shared'), path.join(copy, 'shared'), { recursive: true });
  fs.writeFileSync(path.join(copy, 'package.json'), '{"type":"module"}');
  return copy;
}
const spec = path.join(SKILL, 'references/examples/concept.explainer.json');
const run = (copy, script, args) => spawnSync(process.execPath, [path.join(copy, 'scripts', script), ...args], { encoding: 'utf8', env: { ...process.env, EVAL_LOG: '', PA_OUTPUT_DIR: '' } });

for (const script of ['validate.mjs', 'build.mjs']) {
  test(`${script} with no node_modules: one line naming the doctor command, exit 2, no stack`, () => {
    const copy = bareCopy();
    const r = run(copy, script, [spec]);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.doesNotMatch(r.stderr, /ERR_MODULE_NOT_FOUND|Cannot find package|at (ModuleLoader|file:)/);
    assert.match(r.stderr, /dependencies are not installed \(no node_modules in .*make-explainer\); run: node .*scripts\/doctor\.mjs --fix node_modules/);
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

test('with node_modules present the entry scripts run as before (preflight is silent)', () => {
  const ok = spawnSync(process.execPath, [path.join(SKILL, 'scripts/validate.mjs'), spec], { encoding: 'utf8', env: { ...process.env, EVAL_LOG: '' } });
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /: valid \(1 warning\)\n$/, 'the concept example names no generatedBy');
  assert.equal(ok.stderr, '');
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

test('a missing spec file is a usage error, not a dependency error, once node_modules is there', () => {
  const r = spawnSync(process.execPath, [path.join(SKILL, 'scripts/validate.mjs'), path.join(os.tmpdir(), 'no-such-explainer.json')], { encoding: 'utf8', env: { ...process.env, EVAL_LOG: '' } });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /cannot read .*no-such-explainer\.json/);
});
