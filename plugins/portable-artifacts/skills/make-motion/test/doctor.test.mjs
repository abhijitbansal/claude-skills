import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SKILL = fileURLToPath(new URL('..', import.meta.url));
const NAME = 'make-motion';
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
  assert.match(r.stderr, /voiceover/);
});

test('--fix with an unknown id reports it instead of installing anything', () => {
  const r = run(SKILL, ['--fix', 'no-such-requirement', '--json']);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /no-such-requirement/);
});

test('ffmpeg is reported required-missing when PATH is empty and FFMPEG_PATH unset', (t) => {
  const real = JSON.parse(run(SKILL, ['--json']).stdout);
  if (real.missing.some((m) => m.id === 'ffmpeg')) {
    t.skip('ffmpeg is not on this machine\'s PATH, so the real-PATH guardrail step cannot run');
    return;
  }
  const env = { ...process.env, PATH: tmp('doctor-path-') };
  delete env.FFMPEG_PATH;
  // node is run by absolute path, so an empty PATH is fine; ffmpeg-static is absent from node_modules.
  const f = JSON.parse(run(SKILL, ['--json'], env).stdout).missing.find((m) => m.id === 'ffmpeg');
  assert.ok(f && f.required === true);
});

test('--for voiceover asks for kokoro; plain does not; --for check is no longer accepted', () => {
  const ids = (args) => JSON.parse(run(SKILL, ['--json', ...args]).stdout).missing.map((m) => m.id);
  assert.equal(ids([]).includes('kokoro'), false);
  const hasKokoro = fs.existsSync(path.join(SKILL, 'node_modules/kokoro-js'));
  assert.equal(ids(['--for', 'voiceover']).includes('kokoro'), !hasKokoro);
  assert.equal(run(SKILL, ['--for', 'check']).status, 2);
});

test('requirementsFor: rendering always needs ffmpeg and a required browser; ALL adds kokoro', async () => {
  const requirementsFor = await loadRequirements();
  const { ALL } = await import(pathToFileURL(path.join(SKILL, 'shared/doctor.mjs')).href);
  assert.deepEqual(idsOf(requirementsFor(undefined)), ['node', 'node_modules', 'ffmpeg', 'chromium']);
  assert.equal(requirementsFor(undefined)[3].required, true);
  assert.deepEqual(idsOf(requirementsFor(ALL)), ['node', 'node_modules', 'ffmpeg', 'chromium', 'kokoro']);
});

test('install hints name the doctor with its real path and the missing item id', async () => {
  const lib = (f) => import(pathToFileURL(path.join(SKILL, 'scripts/lib', f)).href);
  const doctor = path.join(SKILL, 'scripts/doctor.mjs');
  const { INSTALL_HINT } = await lib('voice.mjs');
  assert.ok(INSTALL_HINT.includes(`node ${doctor} --for voiceover, id kokoro)`), INSTALL_HINT);
  const { findFfmpeg } = await lib('ffmpeg.mjs');
  const saved = { p: process.env.PATH, f: process.env.FFMPEG_PATH };
  process.env.PATH = tmp('doctor-nopath-'); delete process.env.FFMPEG_PATH;
  try {
    await assert.rejects(() => findFfmpeg({ skipStatic: true }), (e) => e.message.includes(`node ${doctor}, id ffmpeg)`));
  } finally {
    process.env.PATH = saved.p;
    if (saved.f !== undefined) process.env.FFMPEG_PATH = saved.f;
  }
  const src = fs.readFileSync(path.join(SKILL, 'scripts/lib/browser.mjs'), 'utf8');
  assert.match(src, /doctor: \$\{doctorCommand\(\)\}, id chromium\)/);
});

test('the doctor command in hints quotes a path with spaces', async () => {
  const dir = path.join(tmp('doctor space '), 'make motion');
  fs.cpSync(path.join(SKILL, 'scripts'), path.join(dir, 'scripts'), { recursive: true });
  const { doctorCommand } = await import(pathToFileURL(path.join(dir, 'scripts/lib/doctor-hint.mjs')).href);
  assert.ok(doctorCommand().startsWith(`node '${path.join(fs.realpathSync(dir), 'scripts/doctor.mjs')}'`) || doctorCommand().startsWith('node "'), doctorCommand());
});
