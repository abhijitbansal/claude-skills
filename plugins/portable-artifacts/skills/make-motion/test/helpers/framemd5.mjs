// Diagnostics for a byte-identical render test that fails (PA-42). Two renders of one spec differed once in CI and nothing
// said which frame; this dumps the per-frame MD5 of both MP4s to test/.out/framemd5 (CI uploads that folder on a failure)
// and names the first frame that differs. Not a test file.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FRAMEMD5_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.out/framemd5');
const LABEL_MAX = 80;

/** The `-f framemd5` listing of an MP4's first video stream: one `stream, dts, pts, duration, size, md5` line per frame. */
export function framemd5Of(ffmpeg, file) {
  const r = spawnSync(ffmpeg, ['-v', 'error', '-i', file, '-map', '0:v:0', '-f', 'framemd5', '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  assert.equal(r.status, 0, `framemd5 of ${file} failed: ${r.stderr}`);
  return r.stdout;
}

const frameLines = (text) => text.split('\n').filter((line) => line !== '' && !line.startsWith('#'));

/** The 0-based index of the first frame whose line differs, a frame count difference included; -1 when the listings match. */
export function firstDifferingFrame(a, b) {
  const left = frameLines(a);
  const right = frameLines(b);
  const longest = Math.max(left.length, right.length);
  for (let i = 0; i < longest; i++) if (left[i] !== right[i]) return i;
  return -1;
}

const safeLabel = (label) => label.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, LABEL_MAX) || 'render';

/**
 * Nothing when the two renders (`{ sha256, out }`, from renderHash) have the same hash. Otherwise writes
 * `<dir>/<label>-first.framemd5` and `<label>-second.framemd5`, and fails naming both files and the first frame that differs.
 */
export function assertSameRender(first, second, { ffmpeg, label, dir = FRAMEMD5_DIR }) {
  if (first.sha256 === second.sha256) return;
  const name = safeLabel(label);
  const files = [`${name}-first.framemd5`, `${name}-second.framemd5`].map((f) => path.join(dir, f));
  const listings = [first.out, second.out].map((out) => framemd5Of(ffmpeg, out));
  mkdirSync(dir, { recursive: true });
  files.forEach((file, i) => writeFileSync(file, listings[i]));
  const at = firstDifferingFrame(listings[0], listings[1]);
  const where = at === -1 ? 'every frame matches (the difference is outside the picture: container or audio)' : `the first frame that differs is ${at}`;
  assert.fail(`two renders of ${label} are not byte-identical (${first.sha256} vs ${second.sha256}): ${where}; per-frame MD5s: ${files.join(' and ')}`);
}
