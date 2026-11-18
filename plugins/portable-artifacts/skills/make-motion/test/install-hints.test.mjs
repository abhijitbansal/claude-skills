// A script that cannot find an optional package prints the doctor's own install step (PA-10), so the two never differ.
// Merge note: on main the steps were `npm install <pin> --no-save` (kokoro-js, onnxruntime-node, ffmpeg-static); this branch
// installs each optional stack with `npm ci --ignore-scripts` into its own locked folder and ships no ffmpeg-static, so the
// hint is optionalInstallArgv, the same step `doctor --fix <id>` runs.
// No browser, no network: the hints are plain strings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultCtx, diagnose, kokoro, cutout } from '../shared/doctor.mjs';
import { INSTALL_HINT as VOICE_HINT } from '../scripts/v2/voice/worker.mjs';
import { INSTALL_HINT as CUTOUT_HINT } from '../scripts/lib/cutout.mjs';
import { optionalInstall, SKILL_DIR } from '../scripts/lib/doctor-hint.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The doctor's fix line for a requirement, as `doctor` would print it here, whether or not it is installed.
const doctorStep = async (req) => {
  const ctx = { ...defaultCtx(root), exists: () => false };
  return (await diagnose([req], ctx)).missing[0].fix.auto;
};

test('SKILL_DIR is this skill', () => {
  assert.equal(SKILL_DIR, root);
});

test('each hint is exactly the step the doctor would run for that id', async () => {
  assert.equal(optionalInstall('kokoro'), await doctorStep(kokoro()));
  assert.equal(optionalInstall('cutout'), await doctorStep(cutout()));
  assert.ok(VOICE_HINT.includes(optionalInstall('kokoro')), VOICE_HINT);
  assert.ok(CUTOUT_HINT.includes(optionalInstall('cutout')), CUTOUT_HINT);
});

test('every hint is a locked install into its own folder, never --no-save', () => {
  for (const [id, dir] of [['kokoro', 'voice'], ['cutout', 'cutout']]) {
    const hint = optionalInstall(id);
    assert.match(hint, new RegExp(`^npm ci --ignore-scripts --prefix \\S*optional[\\\\/]${dir}$`), hint);
    assert.doesNotMatch(hint, /--no-save|npm install/);
  }
  assert.throws(() => optionalInstall('ffmpeg-static'), /unknown optional install "ffmpeg-static"/);
});

test('the voice hint names no install size: the doctor reports it', () => {
  assert.doesNotMatch(VOICE_HINT, /\bMB\b/);
});
