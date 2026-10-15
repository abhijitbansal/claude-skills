import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SKILL = fileURLToPath(new URL('..', import.meta.url));
const NAME = 'make-diagram';
const run = (skillDir, args, env = process.env) => spawnSync(process.execPath, [path.join(skillDir, 'scripts/doctor.mjs'), ...args], { encoding: 'utf8', env });

const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = (prefix) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); made.push(d); return d; };

// A copy with only scripts/doctor.mjs, scripts/lib/requirements.mjs and shared/: no node_modules, no sister skills.
// It proves the doctor imports nothing but node: built-ins and shared/.
function freshCopy() {
  const copy = path.join(tmp('doctor-fresh-'), NAME);
  fs.mkdirSync(path.join(copy, 'scripts'), { recursive: true });
  fs.cpSync(path.join(SKILL, 'shared'), path.join(copy, 'shared'), { recursive: true });
  fs.mkdirSync(path.join(copy, 'scripts/lib'), { recursive: true });
  fs.copyFileSync(path.join(SKILL, 'scripts/doctor.mjs'), path.join(copy, 'scripts/doctor.mjs'));
  fs.copyFileSync(path.join(SKILL, 'scripts/lib/requirements.mjs'), path.join(copy, 'scripts/lib/requirements.mjs'));
  return copy;
}

// Side-effect free: importing it runs nothing.
const loadRequirements = async () => (await import(pathToFileURL(path.join(SKILL, 'scripts/lib/requirements.mjs')).href)).requirementsFor;
const idsOf = (reqs) => reqs.map((r) => r.id);

test('runs on a fresh copy with no node_modules and reports it missing', () => {
  const r = run(freshCopy(), ['--json']);
  assert.equal(r.status, 1, r.stderr);
  assert.equal(JSON.parse(r.stdout).missing.find((m) => m.id === 'node_modules').required, true);
});

test('unknown argument exits 2 and lists the accepted ones', () => {
  const r = run(SKILL, ['--frobnicate']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--json|--for|--fix/);
});

test('--for with an unknown target exits 2 and says what is accepted', () => {
  const r = run(SKILL, ['--for', 'bogus']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /check/);
});

test('--fix with an unknown id reports it instead of installing anything', () => {
  const r = run(SKILL, ['--fix', 'no-such-requirement', '--json']);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /no-such-requirement/);
});

test('requirementsFor: check and ALL add dev_deps and the browser; plain does not', async () => {
  const requirementsFor = await loadRequirements();
  const { ALL } = await import(pathToFileURL(path.join(SKILL, 'shared/doctor.mjs')).href);
  assert.deepEqual(idsOf(requirementsFor(undefined)), ['node', 'node_modules']);
  for (const t of ['check', ALL]) {
    assert.deepEqual(idsOf(requirementsFor(t)), ['node', 'node_modules', 'dev_deps', 'chromium']);
    assert.deepEqual(requirementsFor(t).map((r) => r.required), [true, true, true, true], 'check.mjs skips without a browser, so ok must be false');
  }
});

test('--for check on a fresh copy asks for dev_deps; node_modules keeps --omit=dev so consent equals what --fix runs', () => {
  const missing = JSON.parse(run(freshCopy(), ['--json', '--for', 'check']).stdout).missing;
  assert.match(missing.find((m) => m.id === 'node_modules').fix.auto, /--omit=dev/);
  const dev = missing.find((m) => m.id === 'dev_deps');
  assert.doesNotMatch(dev.fix.auto, /--omit=dev/);
  assert.match(dev.notes, /dev dependencies/);
  assert.equal(dev.size, '≈118 MB');
});
