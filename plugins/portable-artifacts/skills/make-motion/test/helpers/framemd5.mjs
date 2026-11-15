// Diagnostics for a byte-identical render test that fails (PA-42). Two renders of one spec differed once in CI and nothing
// said which frame; this dumps the per-frame MD5 of both MP4s to test/.out/framemd5 (CI uploads that folder on a failure)
// and names the first frame that differs, plus the captured PNGs that differ when the renders kept them. Not a test file.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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

const pngIndexes = (folder) => readdirSync(folder).map((f) => /^(\d+)\.png$/.exec(f)).filter(Boolean).map((m) => Number(m[1]));
const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

/** The frames (ascending) whose `<frame>.png` differs between two PA_KEEP_FRAMES folders, or exists in only one. */
export function differingPngFrames(firstDir, secondDir) {
  const frames = [...new Set([...pngIndexes(firstDir), ...pngIndexes(secondDir)])].sort((a, b) => a - b);
  return frames.filter((i) => {
    const [a, b] = [firstDir, secondDir].map((d) => path.join(d, `${i}.png`));
    return !existsSync(a) || !existsSync(b) || sha(a) !== sha(b);
  });
}

const MAX_PNG_COPIES = 12; // frames whose two PNGs are copied for the CI artifact; the message lists every one

// The captured-PNG half of the report: which frames differ, exactly, and where both copies of the first few went.
function pngReport(first, second, name, dir) {
  const frames = differingPngFrames(first.frames, second.frames);
  if (!frames.length) return 'every captured PNG matches, so the difference is in the encode';
  const copies = [];
  for (const i of frames.slice(0, MAX_PNG_COPIES)) {
    for (const [side, folder] of [['first', first.frames], ['second', second.frames]]) {
      const from = path.join(folder, `${i}.png`);
      if (!existsSync(from)) continue;
      const to = path.join(dir, `${name}-${side}-${i}.png`);
      copyFileSync(from, to);
      copies.push(to);
    }
  }
  return `the captured PNGs differ at frames ${frames.join(', ')} (exact, before the encode); copies: ${copies.join(' ')}`;
}

/**
 * Nothing when the two renders (`{ sha256, out, frames? }`, from renderHash) have the same hash. Otherwise writes
 * `<dir>/<label>-first.framemd5` and `<label>-second.framemd5`, and fails naming both files and the first decoded frame that
 * differs. That frame number is approximate: x264's lookahead and macroblock tree carry a change in one input frame into
 * the encoded frames around it (shown with ffmpeg: one frame one luma level brighter changes every decoded frame). With
 * `frames` on both (renderHash keepFrames), it also names the captured PNGs that differ, which is exact, and copies both
 * PNGs of each such frame into `dir` as `<label>-first-<frame>.png` and `<label>-second-<frame>.png`.
 */
export function assertSameRender(first, second, { ffmpeg, label, dir = FRAMEMD5_DIR }) {
  if (first.sha256 === second.sha256) return;
  const name = safeLabel(label);
  const files = [`${name}-first.framemd5`, `${name}-second.framemd5`].map((f) => path.join(dir, f));
  const listings = [first.out, second.out].map((out) => framemd5Of(ffmpeg, out));
  mkdirSync(dir, { recursive: true });
  files.forEach((file, i) => writeFileSync(file, listings[i]));
  const at = firstDifferingFrame(listings[0], listings[1]);
  const where = at === -1 ? 'every frame matches (the difference is outside the picture: container or audio)'
    : `the first decoded frame that differs is ${at} (approximate: the encoder carries a change to the frames around it)`;
  const pngs = first.frames && second.frames ? `; ${pngReport(first, second, name, dir)}` : '';
  assert.fail(`two renders of ${label} are not byte-identical (${first.sha256} vs ${second.sha256}): ${where}${pngs}; per-frame MD5s: ${files.join(' and ')}`);
}
