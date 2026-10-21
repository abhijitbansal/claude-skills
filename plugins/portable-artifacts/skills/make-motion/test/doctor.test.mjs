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

test('--for voiceover asks for kokoro; plain does not; --for check is accepted and never asks for kokoro', () => {
  const ids = (args) => JSON.parse(run(SKILL, ['--json', ...args]).stdout).missing.map((m) => m.id);
  assert.equal(ids([]).includes('kokoro'), false);
  const hasKokoro = fs.existsSync(path.join(SKILL, 'node_modules/kokoro-js'));
  assert.equal(ids(['--for', 'voiceover']).includes('kokoro'), !hasKokoro);
  assert.notEqual(run(SKILL, ['--for', 'check']).status, 2);
  assert.equal(ids(['--for', 'check']).includes('kokoro'), false);
});

test('requirementsFor check: node, node_modules and a required browser; no ffmpeg (check.mjs captures no video)', async () => {
  const requirementsFor = await loadRequirements();
  assert.deepEqual(idsOf(requirementsFor('check')), ['node', 'node_modules', 'chromium', 'builder_agent']);
  assert.equal(requirementsFor('check')[2].required, true);
  assert.equal(requirementsFor('check')[3].required, false, 'the agent file is optional');
});

test('requirementsFor: rendering always needs ffmpeg and a required browser; ALL adds kokoro', async () => {
  const requirementsFor = await loadRequirements();
  const { ALL } = await import(pathToFileURL(path.join(SKILL, 'shared/doctor.mjs')).href);
  assert.deepEqual(idsOf(requirementsFor(undefined)), ['node', 'node_modules', 'ffmpeg', 'chromium', 'builder_agent']);
  assert.equal(requirementsFor(undefined)[3].required, true);
  assert.deepEqual(idsOf(requirementsFor(ALL)), ['node', 'node_modules', 'ffmpeg', 'chromium', 'kokoro', 'builder_agent']);
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

test('the browser hint names the doctor id and the make-motion prefix (playwright stubbed so both launches fail)', () => {
  // A copy of the lib files with a stub `playwright`: no real browser is ever launched.
  const dir = path.join(tmp('doctor-stub-'), 'make-motion');
  fs.mkdirSync(path.join(dir, 'scripts/lib'), { recursive: true });
  for (const f of ['browser.mjs', 'doctor-hint.mjs']) fs.copyFileSync(path.join(SKILL, 'scripts/lib', f), path.join(dir, 'scripts/lib', f));
  fs.cpSync(path.join(SKILL, 'shared'), path.join(dir, 'shared'), { recursive: true });
  const pw = path.join(dir, 'node_modules/playwright');
  fs.mkdirSync(pw, { recursive: true });
  fs.writeFileSync(path.join(pw, 'package.json'), '{"name":"playwright","type":"module","main":"index.mjs"}');
  fs.writeFileSync(path.join(pw, 'index.mjs'), "export const chromium = { launch: async (o = {}) => { throw new Error(o.channel ? 'channel chrome not found' : \"Executable doesn't exist at /x\"); } };\n");
  const code = `import { launchBrowser } from ${JSON.stringify(pathToFileURL(path.join(dir, 'scripts/lib/browser.mjs')).href)};
    try { await launchBrowser({ quiet: true }); console.log('LAUNCHED'); } catch (e) { console.log(e.message); }`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 20000 });
  assert.equal(r.status, 0, r.stderr);
  const real = fs.realpathSync(dir);
  assert.ok(r.stdout.includes(`No browser available. Run: npx --no --prefix ${quoteArg(real)} playwright install chromium (doctor: node ${quoteArg(path.join(real, 'scripts/doctor.mjs'))}, id chromium)`), r.stdout);
});

test('the ffmpeg hint installs into make-motion', async () => {
  const { findFfmpeg } = await import(pathToFileURL(path.join(SKILL, 'scripts/lib/ffmpeg.mjs')).href);
  const saved = { p: process.env.PATH, f: process.env.FFMPEG_PATH };
  process.env.PATH = tmp('doctor-nopath-'); delete process.env.FFMPEG_PATH;
  try {
    await assert.rejects(() => findFfmpeg({ skipStatic: true }), (e) => e.message.includes(`npm i ffmpeg-static --no-save --prefix ${quoteArg(SKILL.replace(/[\\/]$/, ''))}`));
  } finally {
    process.env.PATH = saved.p;
    if (saved.f !== undefined) process.env.FFMPEG_PATH = saved.f;
  }
});

test('the doctor command in hints quotes a path with spaces, as the shared helper does', async () => {
  const dir = path.join(tmp('doctor space '), 'make motion');
  fs.cpSync(path.join(SKILL, 'scripts'), path.join(dir, 'scripts'), { recursive: true });
  fs.cpSync(path.join(SKILL, 'shared'), path.join(dir, 'shared'), { recursive: true });
  const { doctorCommand } = await import(pathToFileURL(path.join(dir, 'scripts/lib/doctor-hint.mjs')).href);
  assert.equal(doctorCommand(), `node ${quoteArg(path.join(fs.realpathSync(dir), 'scripts/doctor.mjs'))}`);
  assert.match(doctorCommand(), /^node ["']/);
});

// The optional artifact-builder agent file: reported only where Copilot or Codex exists, never a failure on its own.
test('builder_agent is an optional requirement in every target, and a missing agent file keeps exit 0', async () => {
  const requirementsFor = await loadRequirements();
  const { ALL } = await import(pathToFileURL(path.join(SKILL, 'shared/doctor.mjs')).href);
  for (const t of [undefined, ALL]) {
    const b = requirementsFor(t).find((r) => r.id === 'builder_agent');
    assert.ok(b, `builder_agent for ${String(t)}`);
    assert.equal(b.required, false);
  }
  const home = tmp('doctor-home-');
  const cwd = tmp('doctor-cwd-');
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  const doctor = () => spawnSync(process.execPath, [path.join(SKILL, 'scripts/doctor.mjs'), '--json'], { encoding: 'utf8', env, cwd });
  const read = (r) => JSON.parse(r.stdout);
  const consistent = (r) => {
    const out = read(r);
    assert.equal(out.ok, out.missing.filter((m) => m.required).length === 0, 'ok ignores optional misses');
    assert.equal(r.status, out.ok ? 0 : 1, 'an optional miss alone must not exit 1');
    return out;
  };
  // Neither ~/.copilot nor ~/.codex: Claude Code or Gemini, nothing to report.
  assert.equal(consistent(doctor()).missing.some((m) => m.id === 'builder_agent'), false, 'not reported without a Copilot or Codex folder');
  // ~/.codex exists, no agent file: a missing optional.
  fs.mkdirSync(path.join(home, '.codex'));
  const miss = consistent(doctor()).missing.find((m) => m.id === 'builder_agent');
  assert.ok(miss, 'reported once ~/.codex exists');
  assert.equal(miss.required, false);
  assert.match(miss.fix.manual.darwin, /install\.mjs copilot --agents-only/);
  fs.mkdirSync(path.join(home, '.codex/agents'));
  fs.writeFileSync(path.join(home, '.codex/agents/artifact-builder.toml'), 'name = "artifact-builder"\n');
  assert.equal(consistent(doctor()).missing.some((m) => m.id === 'builder_agent'), false, 'present once the file exists');
});
