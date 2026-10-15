import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SKILL = fileURLToPath(new URL('..', import.meta.url));
const NAME = 'make-explainer';
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

function specFile(sections) {
  const file = path.join(tmp('doctor-spec-'), 'x.explainer.json');
  fs.writeFileSync(file, JSON.stringify({ title: 'T', sections }));
  return file;
}

test('--for spec.json asks for the sister skills (and ffmpeg for motion) its sections need', () => {
  const copy = freshCopy();
  const file = specFile([{ type: 'diagram' }, { type: 'chart' }, { type: 'motion' }, { type: 'text' }]);
  const env = { ...process.env, PATH: tmp('doctor-nopath-') }; // no ffmpeg on PATH
  delete env.FFMPEG_PATH;
  const ids = JSON.parse(run(copy, ['--json', '--for', file], env).stdout).missing.map((m) => m.id);
  for (const id of ['make-diagram', 'make-dashboard', 'make-motion', 'ffmpeg']) assert.ok(ids.includes(id), id);
  const none = JSON.parse(run(copy, ['--json', '--for', specFile([{ type: 'diagram' }])], env).stdout).missing.map((m) => m.id);
  assert.equal(none.includes('make-motion'), false);
  assert.equal(none.includes('ffmpeg'), false);
});

test('--for spec.json does not report sisters that sit beside the skill', () => {
  const ids = JSON.parse(run(SKILL, ['--json', '--for', specFile([{ type: 'diagram' }, { type: 'text' }])]).stdout).missing.map((m) => m.id);
  assert.equal(ids.includes('make-dashboard'), false);
  assert.equal(ids.includes('make-diagram'), false);
});

test('a malformed spec is a one-line usage error', () => {
  const file = path.join(tmp('doctor-bad-'), 'bad.json');
  fs.writeFileSync(file, '{ nope');
  const r = run(SKILL, ['--for', file]);
  assert.equal(r.status, 2);
  assert.equal(r.stderr.trim().split('\n').length, 1, r.stderr);
});

test('requirementsFor: check and ALL use a full npm ci; ALL has every sister, ffmpeg and the browser', async () => {
  const requirementsFor = await loadRequirements();
  const { ALL } = await import(pathToFileURL(path.join(SKILL, 'shared/doctor.mjs')).href);
  assert.deepEqual(idsOf(requirementsFor(undefined)), ['node', 'node_modules']);
  assert.deepEqual(idsOf(requirementsFor('check')), ['node', 'node_modules', 'chromium']);
  const all = requirementsFor(ALL);
  for (const id of ['make-diagram', 'make-dashboard', 'make-motion', 'ffmpeg', 'chromium']) assert.ok(idsOf(all).includes(id), id);
  assert.match(all[1].fix({ platform: 'darwin', skillDir: '/s/x' }).auto[0].join(' '), /^npm ci --prefix /);
});
