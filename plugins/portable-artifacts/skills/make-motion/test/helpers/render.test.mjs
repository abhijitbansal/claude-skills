import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { findFfprobe } from '../../scripts/lib/ffmpeg.mjs';
import { requireRender } from './render.mjs';

const HELPER = pathToFileURL(path.resolve(import.meta.dirname, 'render.mjs')).href;
const tmp = () => mkdtempSync(path.join(tmpdir(), 'rr-'));
const NO_TOOLS = '/nonexistent';

function fakeBin(dir, name) {
  const file = path.join(dir, name);
  writeFileSync(file, '#!/bin/sh\nexit 0\n');
  chmodSync(file, 0o755);
  return file;
}

// Runs requireRender(t, <optionsSource>) in a child whose whole env is replaced, so the parent's PATH,
// FFMPEG_PATH and PA_REQUIRE_RENDER cannot leak in. The fake `t` reports a skip on stdout.
function runRequireRender(env, optionsSource) {
  const script = `import { requireRender } from ${JSON.stringify(HELPER)};
    const t = { skip: (why) => process.stdout.write('SKIPPED: ' + why + '\\n') };
    const got = await requireRender(t, ${optionsSource});
    process.stdout.write('RETURNED: ' + JSON.stringify(got));`;
  return spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', env });
}

// skipStatic rules out an installed ffmpeg-static, so "no ffmpeg" really means none.
const NO_FFMPEG = '{ skipStatic: true }';
// The browser probe fails the way Playwright's does: a long message whose first line is the cause.
// (PLAYWRIGHT_BROWSERS_PATH=/nonexistent is no use: launchBrowser then falls back to a system Chrome.)
const NO_BROWSER = `{ probes: { browser: async () => { throw new Error("Executable doesn't exist at /x\\nlong install advice"); } } }`;

test('requireRender throws instead of skipping when PA_REQUIRE_RENDER=1 and ffmpeg is missing', () => {
  const r = runRequireRender({ PATH: NO_TOOLS, PA_REQUIRE_RENDER: '1' }, NO_FFMPEG);
  assert.match(r.stderr, /PA_REQUIRE_RENDER=1 but ffmpeg is unavailable: ffmpeg not found/);
  assert.notEqual(r.status, 0);
  assert.doesNotMatch(r.stdout, /SKIPPED/);
});

test('requireRender skips and returns null when ffmpeg is missing and PA_REQUIRE_RENDER is unset', () => {
  const r = runRequireRender({ PATH: NO_TOOLS }, NO_FFMPEG);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'SKIPPED: browser or ffmpeg unavailable\nRETURNED: null');
});

test('requireRender names the browser and the first line of its error when PA_REQUIRE_RENDER=1 and only the browser is missing', () => {
  const ffmpeg = fakeBin(tmp(), 'ffmpeg');
  const r = runRequireRender({ PATH: NO_TOOLS, FFMPEG_PATH: ffmpeg, PA_REQUIRE_RENDER: '1' }, NO_BROWSER);
  assert.match(r.stderr, /PA_REQUIRE_RENDER=1 but browser is unavailable: Executable doesn't exist at \/x/);
  assert.notEqual(r.status, 0);
});

test('the PA_REQUIRE_RENDER error message carries only the first line of the cause and keeps the cause', async () => {
  const cause = new Error("Executable doesn't exist at /x\nlong install advice");
  const probes = { browser: async () => { throw cause; } };
  const saved = process.env.PA_REQUIRE_RENDER;
  process.env.PA_REQUIRE_RENDER = '1';
  try {
    await assert.rejects(() => requireRender({ skip() {} }, { need: ['browser'], probes }), (e) => {
      assert.equal(e.message, "PA_REQUIRE_RENDER=1 but browser is unavailable: Executable doesn't exist at /x");
      assert.equal(e.cause, cause);
      return true;
    });
  } finally {
    if (saved === undefined) delete process.env.PA_REQUIRE_RENDER; else process.env.PA_REQUIRE_RENDER = saved;
  }
});

test('requireRender skips with the same reason when only the browser is missing and PA_REQUIRE_RENDER is unset', () => {
  const ffmpeg = fakeBin(tmp(), 'ffmpeg');
  const r = runRequireRender({ PATH: NO_TOOLS, FFMPEG_PATH: ffmpeg }, NO_BROWSER);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'SKIPPED: browser or ffmpeg unavailable\nRETURNED: null');
});

test('requireRender with need: ["browser"] does not look for ffmpeg, and skips as "browser unavailable"', () => {
  const noBrowser = `{ need: ['browser'], ${NO_BROWSER.slice(2)}`;
  const r = runRequireRender({ PATH: NO_TOOLS }, noBrowser);
  assert.equal(r.stdout, 'SKIPPED: browser unavailable\nRETURNED: null');
});

test('requireRender throws when PA_REQUIRE_RENDER=1 and ffprobe is needed but missing; returns it when present', () => {
  const dir = tmp();
  const ffmpeg = fakeBin(dir, 'ffmpeg');
  const options = "{ need: ['ffmpeg', 'ffprobe'] }";
  const missing = runRequireRender({ PATH: NO_TOOLS, FFMPEG_PATH: ffmpeg, PA_REQUIRE_RENDER: '1' }, options);
  assert.match(missing.stderr, /PA_REQUIRE_RENDER=1 but ffprobe is unavailable/);
  assert.notEqual(missing.status, 0);
  const ffprobe = fakeBin(dir, 'ffprobe');
  const present = runRequireRender({ PATH: NO_TOOLS, FFMPEG_PATH: ffmpeg, PA_REQUIRE_RENDER: '1' }, options);
  assert.equal(present.status, 0, present.stderr);
  assert.equal(present.stdout, `RETURNED: ${JSON.stringify({ ffmpeg, ffprobe })}`);
});

test('requireRender rejects an unknown tool name and lists the accepted ones', async () => {
  await assert.rejects(() => requireRender({ skip() {} }, { need: ['broswer'] }), /unknown tool broswer; accepted: ffmpeg, ffprobe, browser/);
});

// ---- findFfprobe -------------------------------------------------------------------------------

function withEnv(env, fn) {
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  const apply = (e) => { for (const [k, v] of Object.entries(e)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };
  apply(env);
  try { return fn(); } finally { apply(saved); }
}

function captureStderr(fn) {
  const write = process.stderr.write;
  let text = '';
  process.stderr.write = (chunk) => { text += chunk; return true; };
  try { return { value: fn(), text }; } finally { process.stderr.write = write; }
}

test('findFfprobe honours FFPROBE_PATH and falls back to the ffmpeg sibling', () => {
  const dir = tmp();
  const ffmpeg = fakeBin(dir, 'ffmpeg');
  const ffprobe = fakeBin(dir, 'ffprobe');
  const elsewhere = fakeBin(tmp(), 'my-probe');

  // FFPROBE_PATH wins, even when it is not the sibling.
  assert.equal(withEnv({ FFPROBE_PATH: elsewhere, PATH: NO_TOOLS }, () => findFfprobe({ ffmpeg })), elsewhere);
  // With no argument the sibling of $FFMPEG_PATH is used (the validator calls it that way).
  assert.equal(withEnv({ FFPROBE_PATH: undefined, FFMPEG_PATH: ffmpeg, PATH: NO_TOOLS }, () => findFfprobe()), ffprobe);
  // Nothing anywhere: null, not a throw.
  assert.equal(withEnv({ FFPROBE_PATH: undefined, FFMPEG_PATH: undefined, PATH: NO_TOOLS }, () => findFfprobe()), null);
});

test('findFfprobe warns about a non-executable FFPROBE_PATH, then looks elsewhere', () => {
  const dir = tmp();
  const ffmpeg = fakeBin(dir, 'ffmpeg');
  const ffprobe = fakeBin(dir, 'ffprobe');
  const bad = path.join(dir, 'missing');
  const { value, text } = captureStderr(() => withEnv({ FFPROBE_PATH: bad, PATH: NO_TOOLS }, () => findFfprobe({ ffmpeg })));
  assert.equal(value, ffprobe);
  assert.equal(text, `warning: FFPROBE_PATH is set to "${bad}" but it is not executable; looking elsewhere\n`);
});

test('findFfprobe prefers the ffprobe beside ffmpeg over a different one on PATH, and uses PATH when there is no sibling', () => {
  const pair = tmp();
  const ffmpeg = fakeBin(pair, 'ffmpeg');
  const sibling = fakeBin(pair, 'ffprobe');
  const onPath = tmp();
  fakeBin(onPath, 'ffprobe');
  assert.equal(withEnv({ FFPROBE_PATH: undefined, PATH: onPath }, () => findFfprobe({ ffmpeg })), sibling);

  const lonely = fakeBin(tmp(), 'ffmpeg');
  assert.equal(withEnv({ FFPROBE_PATH: undefined, PATH: onPath }, () => findFfprobe({ ffmpeg: lonely })), 'ffprobe');
});
