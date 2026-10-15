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

// A copy with only scripts/doctor.mjs and shared/: no node_modules, no sister skills.
function freshCopy() {
  const copy = path.join(tmp('doctor-fresh-'), NAME);
  fs.mkdirSync(path.join(copy, 'scripts'), { recursive: true });
  fs.cpSync(path.join(SKILL, 'shared'), path.join(copy, 'shared'), { recursive: true });
  fs.copyFileSync(path.join(SKILL, 'scripts/doctor.mjs'), path.join(copy, 'scripts/doctor.mjs'));
  return copy;
}

// Import the wrapper for its exported requirementsFor; the import also runs one read-only diagnosis, whose output is swallowed.
async function loadRequirements() {
  const saved = { argv: process.argv, write: process.stdout.write, code: process.exitCode };
  process.argv = [process.argv[0], 'doctor.mjs', '--json'];
  process.stdout.write = () => true;
  try {
    return (await import(pathToFileURL(path.join(SKILL, 'scripts/doctor.mjs')).href)).requirementsFor;
  } finally {
    process.argv = saved.argv; process.stdout.write = saved.write; process.exitCode = saved.code;
  }
}
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

test('requirementsFor: check and ALL add the browser with a full npm ci; plain does not', async () => {
  const requirementsFor = await loadRequirements();
  const { ALL } = await import(pathToFileURL(path.join(SKILL, 'shared/doctor.mjs')).href);
  assert.deepEqual(idsOf(requirementsFor(undefined)), ['node', 'node_modules']);
  for (const t of ['check', ALL]) {
    const reqs = requirementsFor(t);
    assert.deepEqual(idsOf(reqs), ['node', 'node_modules', 'chromium']);
    assert.match(reqs[1].fix({ platform: 'darwin', skillDir: '/s/x' }).auto[0].join(' '), /^npm ci --prefix /, 'playwright is a devDependency: no --omit=dev');
  }
});

test('--for check on a fresh copy asks for a full npm ci (playwright is a devDependency)', () => {
  const nm = JSON.parse(run(freshCopy(), ['--json', '--for', 'check']).stdout).missing.find((m) => m.id === 'node_modules');
  assert.doesNotMatch(nm.fix.auto, /--omit=dev/);
  const plain = JSON.parse(run(freshCopy(), ['--json']).stdout).missing.find((m) => m.id === 'node_modules');
  assert.match(plain.fix.auto, /--omit=dev/);
});
