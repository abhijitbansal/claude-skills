import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SKILL = fileURLToPath(new URL('..', import.meta.url));
const NAME = 'make-dashboard';
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
  assert.match(r.stderr, /existing spec \.json file/);
});

test('--fix with an unknown id reports it instead of installing anything', () => {
  const r = run(SKILL, ['--fix', 'no-such-requirement', '--json']);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /no-such-requirement/);
});

test('requirementsFor: plain and ALL need no browser (nothing here uses one)', async () => {
  const { requirementsFor } = { requirementsFor: await loadRequirements() };
  assert.deepEqual(idsOf(requirementsFor()), ['node', 'node_modules']);
  assert.deepEqual(idsOf(requirementsFor(Symbol('x'))), ['node', 'node_modules']);
});

test('a build missing its vendored chart libraries names the doctor id', () => {
  const dir = path.join(tmp('doctor build '), NAME);
  for (const d of ['scripts', 'shared', 'template', 'references', 'test']) fs.cpSync(path.join(SKILL, d), path.join(dir, d), { recursive: true });
  fs.copyFileSync(path.join(SKILL, 'package.json'), path.join(dir, 'package.json'));
  // node_modules with everything except vega-embed's build output, which the build embeds.
  fs.mkdirSync(path.join(dir, 'node_modules'));
  for (const e of fs.readdirSync(path.join(SKILL, 'node_modules'))) {
    if (e !== 'vega-embed') fs.symlinkSync(path.join(SKILL, 'node_modules', e), path.join(dir, 'node_modules', e));
  }
  fs.mkdirSync(path.join(dir, 'node_modules', 'vega-embed'));
  const proj = tmp('doctor-proj-');
  fs.cpSync(path.join(SKILL, 'test/fixtures/data'), path.join(proj, 'data'), { recursive: true });
  const spec = path.join(proj, 'dashboard.json');
  fs.copyFileSync(path.join(SKILL, 'references/examples/sales-overview.json'), spec);
  const r = spawnSync(process.execPath, [path.join(dir, 'scripts/build.mjs'), spec, '--out', path.join(proj, 'out')], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  const doctor = path.join(fs.realpathSync(dir), 'scripts/doctor.mjs');
  assert.ok((r.stdout + r.stderr).includes(`(doctor: node '${doctor}', id node_modules)`), r.stdout + r.stderr);
});
