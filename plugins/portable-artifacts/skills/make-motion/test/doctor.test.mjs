import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SKILL = fileURLToPath(new URL('..', import.meta.url));
const NAME = 'make-motion';
const run = (skillDir, args, env = process.env) => spawnSync(process.execPath, [path.join(skillDir, 'scripts/doctor.mjs'), ...args], { encoding: 'utf8', env });

test('runs on a fresh copy with no node_modules and reports it missing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-fresh-'));
  const copy = path.join(dir, NAME);
  fs.mkdirSync(path.join(copy, 'scripts'), { recursive: true });
  fs.cpSync(path.join(SKILL, 'shared'), path.join(copy, 'shared'), { recursive: true });
  fs.copyFileSync(path.join(SKILL, 'scripts/doctor.mjs'), path.join(copy, 'scripts/doctor.mjs'));
  const r = run(copy, ['--json']);
  assert.equal(r.status, 1, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.missing.find((m) => m.id === 'node_modules').required, true);
});

test('unknown argument exits 2 and lists the accepted ones', () => {
  const r = run(SKILL, ['--frobnicate']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--json|--for|--fix/);
});

test('--for with an unknown target exits 2 and lists the accepted ones', () => {
  const r = run(SKILL, ['--for', 'bogus']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /check/);
});

test('--fix with an unknown id reports it instead of installing anything', () => {
  const r = run(SKILL, ['--fix', 'no-such-requirement', '--json']);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /no-such-requirement/);
});

test('ffmpeg is reported required-missing when PATH is empty and FFMPEG_PATH unset', () => {
  const real = JSON.parse(run(SKILL, ['--json']).stdout);
  assert.equal(real.missing.some((m) => m.id === 'ffmpeg'), false, 'guardrail: ffmpeg is present on the real PATH');
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-path-'));
  const env = { ...process.env, PATH: empty };
  delete env.FFMPEG_PATH;
  // node is run by absolute path, so an empty PATH is fine; ffmpeg-static is absent from node_modules.
  const out = JSON.parse(run(SKILL, ['--json'], env).stdout);
  const f = out.missing.find((m) => m.id === 'ffmpeg');
  assert.ok(f && f.required === true);
});

test('--for voiceover asks for kokoro; plain and check do not', () => {
  const ids = (args) => JSON.parse(run(SKILL, ['--json', ...args]).stdout).missing.map((m) => m.id);
  assert.equal(ids([]).includes('kokoro'), false);
  assert.equal(ids(['--for', 'check']).includes('kokoro'), false);
  const hasKokoro = fs.existsSync(path.join(SKILL, 'node_modules/kokoro-js'));
  assert.equal(ids(['--for', 'voiceover']).includes('kokoro'), !hasKokoro);
});
