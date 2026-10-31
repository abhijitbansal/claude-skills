import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { findFfprobe } from '../../scripts/lib/ffmpeg.mjs';

const HELPER = pathToFileURL(path.resolve(import.meta.dirname, 'render.mjs')).href;
const tmp = () => mkdtempSync(path.join(tmpdir(), 'rr-'));
const NO_TOOLS = '/nonexistent';

// Runs requireRender in a child whose whole env is replaced, so neither PATH nor FFMPEG_PATH finds ffmpeg.
// skipStatic rules out an installed ffmpeg-static; the fake `t` reports a skip on stdout.
function runRequireRender(env) {
  const script = `import { requireRender } from ${JSON.stringify(HELPER)};
    const t = { skip: (why) => process.stdout.write('SKIPPED: ' + why) };
    const got = await requireRender(t, { skipStatic: true });
    process.stdout.write('RETURNED: ' + JSON.stringify(got));`;
  return spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', env });
}

test('requireRender throws instead of skipping when PA_REQUIRE_RENDER=1 and ffmpeg is missing', () => {
  const r = runRequireRender({ PATH: NO_TOOLS, PA_REQUIRE_RENDER: '1' });
  assert.match(r.stderr, /PA_REQUIRE_RENDER=1 but ffmpeg is unavailable/);
  assert.notEqual(r.status, 0);
  assert.doesNotMatch(r.stdout, /SKIPPED/);
});

test('requireRender skips and returns null when ffmpeg is missing and PA_REQUIRE_RENDER is unset', () => {
  const r = runRequireRender({ PATH: NO_TOOLS });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'SKIPPED: browser or ffmpeg unavailable' + 'RETURNED: null');
});

// ---- findFfprobe -------------------------------------------------------------------------------

function withEnv(env, fn) {
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}
function fakeBin(dir, name) {
  const file = path.join(dir, name);
  writeFileSync(file, '#!/bin/sh\nexit 0\n');
  chmodSync(file, 0o755);
  return file;
}

test('findFfprobe honours FFPROBE_PATH and falls back to the ffmpeg sibling', () => {
  const dir = tmp();
  const ffmpeg = fakeBin(dir, 'ffmpeg');
  const ffprobe = fakeBin(dir, 'ffprobe');
  const elsewhere = fakeBin(tmp(), 'my-probe');

  // FFPROBE_PATH wins, even when it is not the sibling.
  assert.equal(withEnv({ FFPROBE_PATH: elsewhere, PATH: NO_TOOLS }, () => findFfprobe({ ffmpeg })), elsewhere);
  // A non-executable FFPROBE_PATH is ignored; with nothing on PATH the sibling of the `ffmpeg` argument is used.
  assert.equal(withEnv({ FFPROBE_PATH: path.join(dir, 'missing'), PATH: NO_TOOLS }, () => findFfprobe({ ffmpeg })), ffprobe);
  // With no argument the sibling of $FFMPEG_PATH is used (the validator calls it that way).
  assert.equal(withEnv({ FFPROBE_PATH: undefined, FFMPEG_PATH: ffmpeg, PATH: NO_TOOLS }, () => findFfprobe()), ffprobe);
  // Nothing anywhere: null, not a throw.
  assert.equal(withEnv({ FFPROBE_PATH: undefined, FFMPEG_PATH: undefined, PATH: NO_TOOLS }, () => findFfprobe()), null);
});
