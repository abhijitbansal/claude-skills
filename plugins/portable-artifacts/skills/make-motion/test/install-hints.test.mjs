// A script that cannot find an on-demand package prints the doctor's own install step (PA-10): kokoro-js, onnxruntime-node and
// ffmpeg-static are all `npm install <pin> --no-save`, and a step that names only one pin makes npm remove the others.
// No browser, no network: the hints are plain strings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultCtx, onDemandHint, FFMPEG_STATIC_PIN, KOKORO_PIN, CUTOUT_PIN } from '../shared/doctor.mjs';
import { INSTALL_HINT as VOICE_HINT } from '../scripts/lib/voice.mjs';
import { INSTALL_HINT as CUTOUT_HINT } from '../scripts/lib/cutout.mjs';
import { npmInstallFfmpegStatic, npmInstallKokoro, npmInstallCutout, SKILL_DIR } from '../scripts/lib/doctor-hint.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ctx = () => defaultCtx(root);

test('SKILL_DIR is this skill', () => {
  assert.equal(SKILL_DIR, root);
});

test('each hint is exactly the step the doctor would run for that id', () => {
  assert.equal(npmInstallKokoro(), onDemandHint('kokoro', ctx()));
  assert.equal(npmInstallCutout(), onDemandHint('cutout', ctx()));
  assert.equal(npmInstallFfmpegStatic(), onDemandHint('ffmpeg-static', ctx()));
  assert.ok(VOICE_HINT.includes(onDemandHint('kokoro', ctx())), VOICE_HINT);
  assert.ok(CUTOUT_HINT.includes(onDemandHint('cutout', ctx())), CUTOUT_HINT);
});

test('the ffmpeg-static hint is pinned and installs from the skill folder (no --prefix)', () => {
  const hint = npmInstallFfmpegStatic();
  assert.ok(hint.includes(FFMPEG_STATIC_PIN), hint);
  assert.match(FFMPEG_STATIC_PIN, /^ffmpeg-static@\d+\.\d+\.\d+$/);
  assert.doesNotMatch(hint, /--prefix/);
  assert.match(hint, /--no-save/);
});

test('every hint names its own pin', () => {
  assert.ok(npmInstallKokoro().includes(KOKORO_PIN));
  assert.ok(npmInstallCutout().includes(CUTOUT_PIN));
});

test('the voice hint states the install size the doctor states, not the old 250 MB', () => {
  assert.match(VOICE_HINT, /about 465 MB/);
  assert.doesNotMatch(VOICE_HINT, /250 MB/);
});
