// A copy of the skill with no node_modules: validate, preview and render print the doctor's command and exit 2 (PA-08), not a raw
// ERR_MODULE_NOT_FOUND stack with exit 1. The entry scripts check for node_modules with Node built-ins, then import the rest.
// No browser: none of these gets past the preflight. (check.mjs is not covered: it exports functions its tests import, so it
// still imports its dependencies statically.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// scripts, template and shared only: no node_modules, no sister skills.
function bareCopy() {
  const copy = path.join(mkdtempSync(path.join(tmpdir(), 'pf-')), 'make-motion');
  mkdirSync(copy, { recursive: true });
  for (const dir of ['scripts', 'template', 'shared']) cpSync(path.join(root, dir), path.join(copy, dir), { recursive: true });
  writeFileSync(path.join(copy, 'package.json'), '{ "type": "module" }');
  assert.equal(existsSync(path.join(copy, 'node_modules')), false);
  return copy;
}
const run = (copy, script, args) => spawnSync(process.execPath, [path.join(copy, 'scripts', script), ...args], { encoding: 'utf8' });
const FIX = (copy) => `scripts/doctor.mjs --fix node_modules`.replace('scripts/', `${path.join(copy, 'scripts')}/`);

for (const [script, args] of [['validate.mjs', ['motion.json']], ['preview.mjs', ['motion.json']], ['render.mjs', ['motion.json']]]) {
  test(`${script} in a copy with no node_modules prints the doctor command and exits 2, with no stack`, () => {
    const copy = bareCopy();
    const r = run(copy, script, args);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.ok(r.stderr.includes(FIX(copy)), r.stderr);
    assert.match(r.stderr, /dependencies are not installed/);
    assert.doesNotMatch(r.stderr + r.stdout, /ERR_MODULE_NOT_FOUND|Cannot find package|at \w+ \(/);
  });
}

test('validate.mjs --json in that copy answers with a JSON error on stdout, still exit 2', () => {
  const copy = bareCopy();
  const r = run(copy, 'validate.mjs', ['motion.json', '--json']);
  assert.equal(r.status, 2);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  assert.ok(out.errors[0].message.includes(FIX(copy)), r.stdout);
});

test('with node_modules present the entry scripts run as before', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pf-ok-'));
  const spec = path.join(dir, 'm.json');
  writeFileSync(spec, JSON.stringify({ scenes: [{ id: 's1', duration: 1, elements: [] }] }));
  const r = spawnSync(process.execPath, [path.join(root, 'scripts/validate.mjs'), spec], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /: valid$/m);
});
