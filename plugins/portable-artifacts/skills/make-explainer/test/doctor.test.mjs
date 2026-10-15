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

test('requirementsFor: check adds dev_deps and the browser; ALL has every sister, motion needs and the browser', async () => {
  const requirementsFor = await loadRequirements();
  const { ALL } = await import(pathToFileURL(path.join(SKILL, 'shared/doctor.mjs')).href);
  assert.deepEqual(idsOf(requirementsFor(undefined)), ['node', 'node_modules']);
  assert.deepEqual(idsOf(requirementsFor('check')), ['node', 'node_modules', 'dev_deps', 'chromium']);
  const all = idsOf(requirementsFor(ALL));
  for (const id of ['make-diagram', 'make-dashboard', 'make-motion', 'ffmpeg', 'chromium']) assert.ok(all.includes(id), id);
  assert.ok(all.includes('dev_deps'), 'ALL accepts --fix dev_deps');
  assert.equal(requirementsFor('check')[2].size, '≈19 MB');
  assert.equal(new Set(all).size, all.length, 'no duplicate ids');
});

test('a motion section does not ask for dev_deps; its browser is make-motion\'s', async () => {
  const requirementsFor = await loadRequirements();
  const reqs = requirementsFor(specFile([{ type: 'motion' }]));
  assert.equal(reqs.some((r) => r.id === 'dev_deps'), false);
  const b = reqs.find((r) => r.id === 'chromium');
  assert.match(b.why, /make-motion/);
  assert.equal(b.fix({ platform: 'darwin', skillDir: '/s/make-explainer', exists: () => false, which: () => false }).auto[0][3], '/s/make-motion');
});

test('a fresh --omit=dev copy with a motion spec reports no dev_deps', () => {
  const ids = JSON.parse(run(freshCopy(), ['--json', '--for', specFile([{ type: 'motion' }])]).stdout).missing.map((m) => m.id);
  assert.equal(ids.includes('dev_deps'), false);
  assert.ok(ids.includes('make-motion'));
});

test('a motion section needs a required browser and counts make-motion\'s ffmpeg-static', async () => {
  const requirementsFor = await loadRequirements();
  const reqs = requirementsFor(specFile([{ type: 'motion' }]));
  assert.equal(reqs.find((r) => r.id === 'chromium').required, true);
  const ff = reqs.find((r) => r.id === 'ffmpeg');
  const isExecutable = (p) => p === '/s/make-motion/node_modules/ffmpeg-static/ffmpeg';
  assert.equal(await ff.check({ platform: 'darwin', env: {}, skillDir: '/s/make-explainer', exists: () => false, which: () => false, isExecutable }), true);
});
