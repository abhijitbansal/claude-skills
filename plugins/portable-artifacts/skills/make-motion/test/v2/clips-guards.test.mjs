// The clip allow-list (scripts/v2/clips.mjs) seen from the binaries' side: an attached picture (cover art) is refused, the
// one real video stream is mapped by its index, and every ffprobe and ffmpeg call carries a codec whitelist, so no decoder
// outside the allow-list runs on a clip's bytes (not even in ffprobe's stream analysis). The binaries are wrapped by a
// script that records its arguments and runs the real tool. Tests that need ffmpeg skip without it.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import '../../scripts/v2/list.mjs';
import { SpecError } from '../../scripts/v2/spec.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { clipInput, clipProblem, probeClip, prepareClips } from '../../scripts/v2/clips.mjs';
import { findFfmpeg, findFfprobe } from '../../scripts/lib/ffmpeg.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIP = path.resolve(HERE, '../../references/examples/v2/media-clip.mp4');
const COVER_ART = path.join(HERE, 'fixtures/clips/cover-art-first.mp4'); // h264 + aac + an attached mjpeg picture
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0 && spawnSync('ffprobe', ['-version']).status === 0;
const shotOf = (extra) => ({ id: 'reel', show: 'media', src: 'clip.mp4', hold: 1, ...extra });
const filmOf = (...shots) => ({ version: 2, fps: 30, look: 'desk', shots });

let dir, work, log, realFfmpeg, realFfprobe;
const saved = { FFMPEG_PATH: process.env.FFMPEG_PATH, FFPROBE_PATH: process.env.FFPROBE_PATH };

function wrapper(name, real) {
  const file = path.join(dir, name);
  writeFileSync(file, `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\nexec '${real}' "$@"\n`, { mode: 0o755 });
  return file;
}

before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'mm-clip-guards-'));
  work = mkdtempSync(path.join(tmpdir(), 'mm-clip-guards-work-'));
  log = path.join(dir, 'calls.log');
  copyFileSync(CLIP, path.join(dir, 'clip.mp4'));
  copyFileSync(COVER_ART, path.join(dir, 'cover.mp4'));
  if (!hasFfmpeg) return;
  // video second, sound first: the real video is stream 1, so "the first video" and "stream 0" are not the same stream
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=30:duration=1', '-f', 'lavfi', '-i', 'sine=duration=1', '-map', '1:a', '-map', '0:v', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-t', '1', path.join(dir, 'sound-first.mp4')]);
  realFfmpeg = await findFfmpeg();
  realFfprobe = findFfprobe({ ffmpeg: realFfmpeg });
  process.env.FFMPEG_PATH = wrapper('spy-ffmpeg.sh', realFfmpeg);
  process.env.FFPROBE_PATH = wrapper('spy-ffprobe.sh', realFfprobe);
});
after(() => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  rmSync(dir, { recursive: true, force: true });
  rmSync(work, { recursive: true, force: true });
});

const prepared = (film, sub = 'w') => prepareClips({ film, specDir: dir, timeline: buildTimeline(film, { fps: film.fps }), cacheDir: mkdtempSync(path.join(work, sub)), canvas: { w: 1920, h: 1080 } });
const calls = () => readFileSync(log, 'utf8').split('\n').filter(Boolean);
const whitelistOf = (line) => line.match(/-codec_whitelist (\S+)/)?.[1]?.split(',') ?? [];

test('a clip with an attached picture is refused at its src, whatever order the streams come in', { skip: !hasFfmpeg }, async () => {
  await assert.rejects(prepared(filmOf(shotOf({ src: 'cover.mp4' })), 'cover'), (err) => err instanceof SpecError && err.errors[0].path === 'shots[0].src');
});

test('the probe of cover art says a stream has a codec that is not accepted, and never opens that decoder', { skip: !hasFfmpeg }, async () => {
  const probe = await probeClip({ file: path.join(dir, 'cover.mp4') });
  assert.match(clipProblem(probe), /not one of the accepted codecs/);
});

test('a stream flagged as an attached picture is refused even when its codec is on the lists', () => {
  const probe = { format: 'matroska,webm', duration: 4, width: 160, height: 90, codec: 'h264', audio: false, streams: [{ type: 'video', codec: 'h264', attachedPic: false }, { type: 'video', codec: 'h264', attachedPic: true }] };
  assert.match(clipProblem(probe), /attached picture/);
  assert.equal(clipProblem({ ...probe, streams: [probe.streams[0]] }), null, 'the same clip without the picture passes');
});

test('every clip call carries a codec whitelist of the accepted decoders only: ffprobe, the frame decode and the sound cut', { skip: !hasFfmpeg }, async () => {
  const args = clipInput('x.mp4');
  const list = args[args.indexOf('-codec_whitelist') + 1]?.split(',') ?? [];
  for (const name of ['h264', 'hevc', 'vp9', 'av1', 'mpeg4', 'prores', 'aac', 'mp3', 'opus', 'vorbis', 'flac', 'alac', 'pcm_s16le', 'pcm_s24le']) assert.ok(list.includes(name), `${name} is allowed`);
  for (const name of ['mjpeg', 'png', 'gif', 'mpeg2video', 'ac3', 'subrip']) assert.ok(!list.includes(name), `${name} is not`);
  writeFileSync(log, '');
  await prepared(filmOf(shotOf({ in: 0, out: 0.5 })), 'wl');
  const lines = calls();
  assert.ok(lines.some((l) => /show_entries/.test(l)), 'ffprobe was called');
  assert.ok(lines.some((l) => /-f image2/.test(l)), 'ffmpeg decoded');
  for (const line of lines.filter((l) => /-i \S*clip\.mp4/.test(l))) assert.ok(whitelistOf(line).includes('h264'), `a clip call without the whitelist: ${line}`);
});

test('the decode maps the probed video stream by its index, not "the first video"', { skip: !hasFfmpeg }, async () => {
  writeFileSync(log, '');
  await prepared(filmOf(shotOf({ src: 'sound-first.mp4', out: 0.5 })), 'idx');
  const decode = calls().find((l) => /-f image2/.test(l));
  assert.match(decode, /-map 0:1 /, decode);
  assert.doesNotMatch(decode, /-map 0:v:0/);
});
