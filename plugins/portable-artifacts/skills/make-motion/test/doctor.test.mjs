import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { quoteArg } from '../shared/doctor.mjs';

const SKILL = fileURLToPath(new URL('..', import.meta.url));
const NAME = 'make-motion';
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
  if (fs.existsSync(path.join(SKILL, 'node_modules/ffmpeg-static'))) {
    t.skip('ffmpeg-static is installed in make-motion, so an empty PATH still finds an ffmpeg');
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
  const doctor = quoteArg(path.join(SKILL, 'scripts/doctor.mjs'));
  const { INSTALL_HINT } = await lib('voice.mjs');
  assert.ok(INSTALL_HINT.includes(`node ${doctor} --for voiceover, id kokoro)`), INSTALL_HINT);
  assert.ok(INSTALL_HINT.includes(`--prefix ${quoteArg(SKILL.replace(/[\\/]$/, ''))}`), INSTALL_HINT);
  assert.doesNotMatch(INSTALL_HINT, /<skill-dir>/);
  const { findFfmpeg } = await lib('ffmpeg.mjs');
  const saved = { p: process.env.PATH, f: process.env.FFMPEG_PATH };
  process.env.PATH = tmp('doctor-nopath-'); delete process.env.FFMPEG_PATH;
  try {
    await assert.rejects(() => findFfmpeg({ skipStatic: true }), (e) => e.message.includes(`node ${doctor}, id ffmpeg)`));
  } finally {
    process.env.PATH = saved.p;
    if (saved.f !== undefined) process.env.FFMPEG_PATH = saved.f;
  }
});

test('the browser hint names the doctor id (run in a child where chromium and chrome cannot launch)', () => {
  const code = `import { launchBrowser } from ${JSON.stringify(pathToFileURL(path.join(SKILL, 'scripts/lib/browser.mjs')).href)};
    try { const b = await launchBrowser({ quiet: true }); await b.close(); console.log('LAUNCHED'); } catch (e) { console.log(e.message); }`;
  const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: tmp('doctor-pw-') };
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', env });
  if (r.stdout.includes('LAUNCHED')) return; // system Chrome launched: no failure to observe on this machine
  assert.ok(r.stdout.includes(`node ${quoteArg(path.join(SKILL, 'scripts/doctor.mjs'))}, id chromium)`), r.stdout + r.stderr);
});

test('the doctor command in hints quotes a path with spaces, as the shared helper does', async () => {
  const dir = path.join(tmp('doctor space '), 'make motion');
  fs.cpSync(path.join(SKILL, 'scripts'), path.join(dir, 'scripts'), { recursive: true });
  fs.cpSync(path.join(SKILL, 'shared'), path.join(dir, 'shared'), { recursive: true });
  const { doctorCommand } = await import(pathToFileURL(path.join(dir, 'scripts/lib/doctor-hint.mjs')).href);
  assert.equal(doctorCommand(), `node ${quoteArg(path.join(fs.realpathSync(dir), 'scripts/doctor.mjs'))}`);
  assert.match(doctorCommand(), /^node ["']/);
});
