// Shared by tests that need a browser and/or ffmpeg (not a test file). Without PA_REQUIRE_RENDER=1 a
// missing tool skips the test; with it (CI sets it) a missing tool is a failure, so a render test
// can never go quietly green by skipping.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findFfmpeg, findFfprobe } from '../../scripts/lib/ffmpeg.mjs';
import { launchBrowser } from '../../scripts/lib/browser.mjs';

const RENDER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/render.mjs');
const PINNED_BUILD_DATE = '1793318400'; // 30 Oct 2026 00:00 UTC: render.mjs stamps the build date into the MP4 comment tag

const TOOLS = ['ffmpeg', 'ffprobe', 'browser']; // probe order: ffprobe looks beside the ffmpeg that was found
const DEFAULT_NEED = ['browser', 'ffmpeg'];
/** `{ need }` for tests that draw on the page but never call ffmpeg (render-flags uses a fake one on purpose). */
export const BROWSER_ONLY = { need: ['browser'] };

const firstLine = (e) => String(e?.message ?? e).split('\n')[0];

let browserProbe; // one launch per test file; every test there needs the same answer
const PROBES = {
  ffmpeg: ({ skipStatic }) => findFfmpeg({ skipStatic }),
  ffprobe: ({ ffmpeg }) => findFfprobe({ ffmpeg }) ?? Promise.reject(new Error('no ffprobe found')),
  browser: () => (browserProbe ??= launchBrowser({ quiet: true }).then((b) => b.close())),
};

/**
 * `{ ffmpeg, ffprobe }` once every tool in `need` (a subset of browser, ffmpeg, ffprobe; default
 * browser + ffmpeg) is present; a tool not in `need` is null. So `ffprobe` is null only when it is
 * not in `need`. A missing tool calls `t.skip(<reason>)` and returns null, or throws
 * `PA_REQUIRE_RENDER=1 but <tool> is unavailable: <first line of the cause>` when PA_REQUIRE_RENDER=1.
 * `probes` replaces individual probes (each returns the tool or rejects); for tests of this helper.
 */
export async function requireRender(t, { need = DEFAULT_NEED, skipStatic = false, probes = {} } = {}) {
  const unknown = need.filter((tool) => !TOOLS.includes(tool));
  if (unknown.length) throw new Error(`requireRender: unknown tool ${unknown.join(', ')}; accepted: ${TOOLS.join(', ')}`);
  const probe = { ...PROBES, ...probes };
  const found = { ffmpeg: null, ffprobe: null };
  for (const tool of TOOLS.filter((x) => need.includes(x))) {
    try {
      const got = await probe[tool]({ skipStatic, ffmpeg: found.ffmpeg });
      if (tool !== 'browser') found[tool] = got;
    } catch (cause) {
      if (process.env.PA_REQUIRE_RENDER === '1') {
        throw new Error(`PA_REQUIRE_RENDER=1 but ${tool} is unavailable: ${firstLine(cause)}`, { cause });
      }
      t.skip(`${need.join(' or ')} unavailable`);
      return null;
    }
  }
  return found;
}

/**
 * Renders `specPath` with render.mjs (`--out <tmp>/v.mp4`, then `args`), asserts exit 0 and returns
 * `{ sha256, out, stdout }`. SOURCE_DATE_EPOCH is pinned so the comment tag does not change the bytes;
 * the caller's `env` wins, so `{ env: { SOURCE_DATE_EPOCH: '' } }` gives a render stamped with today.
 */
export async function renderHash(specPath, args = [], { env = {} } = {}) {
  const out = path.join(mkdtempSync(path.join(tmpdir(), 'rh-')), 'v.mp4');
  const r = spawnSync(process.execPath, [RENDER, specPath, '--out', out, ...args], {
    encoding: 'utf8',
    env: { ...process.env, SOURCE_DATE_EPOCH: PINNED_BUILD_DATE, ...env },
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return { sha256: createHash('sha256').update(readFileSync(out)).digest('hex'), out, stdout: r.stdout };
}

/** Renders twice through `renderHash`, asserts the two files are byte-identical and returns the hash. */
export async function assertRendersIdentically(_t, specPath, args) {
  const first = await renderHash(specPath, args);
  const second = await renderHash(specPath, args);
  assert.equal(second.sha256, first.sha256, 'two renders of the same spec and media must be byte-identical');
  return first.sha256;
}

const TEST_VIDEO_SOURCES = {
  // Every frame differs and the flat areas compress near-losslessly, so a one-frame misalignment shows.
  // The box is overlaid, not drawn: drawbox has no time variable (its `t` is the line thickness), so a drawbox at
  // x='t*100' stands still. overlay's `t` is the frame time: 100 px a second.
  movingbox: (size, fps, seconds) => `color=c=0x224466:size=${size}:rate=${fps}:duration=${seconds}[bg];color=c=white:size=60x60:rate=${fps}[box];[bg][box]overlay=x='t*100':y=40:shortest=1`,
  smptebars: (size, fps, seconds) => `smptebars=size=${size}:rate=${fps}:duration=${seconds}`,
};

/** Writes a small H.264 test clip with ffmpeg lavfi sources, plus a 440 Hz sine track when `audio` is true. */
export function makeTestVideo(ffmpeg, file, { seconds = 2, fps = 10, size = '320x180', source = 'movingbox', audio = false } = {}) {
  const graph = TEST_VIDEO_SOURCES[source];
  if (!graph) throw new Error(`makeTestVideo: unknown source "${source}"; accepted: ${Object.keys(TEST_VIDEO_SOURCES).join(', ')}`);
  const inputs = ['-f', 'lavfi', '-i', graph(size, fps, seconds)];
  if (audio) inputs.push('-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`);
  const r = spawnSync(ffmpeg, [...inputs, '-pix_fmt', 'yuv420p', '-y', file], { encoding: 'utf8' });
  assert.equal(r.status, 0, `makeTestVideo: ffmpeg failed\n${r.stderr}`);
}
