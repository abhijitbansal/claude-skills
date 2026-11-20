// scripts/lib/video-probe.mjs: what the cut-out tool takes from a clip (probe, hash, decode). Hermetic: ffprobe and
// ffmpeg are stand-in shell scripts, so these run without either installed. The real-binary cases are in cutout.test.mjs
// (a VP9 alpha WebM probed and decoded) and the whitelist rows of the security table are repeated here for the kept tool.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { VIDEO_EXTENSIONS, probeArgs, probeVideo, fileSha256, decodeArgs, decodeFrames, readCache } from '../scripts/lib/video-probe.mjs';
import { extractArgs } from '../scripts/lib/cutout.mjs';

const tmp = (prefix) => mkdtempSync(path.join(tmpdir(), prefix));
const WHITELIST = ['-protocol_whitelist', 'file,pipe'];

// A stand-in ffprobe that prints `json` whatever it is asked, or exits `status` with `stderr`.
function fakeProbe(dir, { json = '{}', status = 0, stderr = '' } = {}) {
  const file = path.join(dir, `ffprobe-${Math.random().toString(36).slice(2)}`);
  writeFileSync(file, `#!/bin/sh\nprintf '%s' '${json}'\nprintf '%s\\n' '${stderr}' >&2\nexit ${status}\n`, { mode: 0o755 });
  return file;
}

const VIDEO = { codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p', width: 320, height: 180, avg_frame_rate: '30000/1001', r_frame_rate: '30/1', duration: '2.0004' };

test('the clip extensions are the four the cut-out tool and version 2 take', () => {
  assert.deepEqual([...VIDEO_EXTENSIONS], ['mp4', 'mov', 'webm', 'm4v']);
});

test('every ffprobe and ffmpeg call the cut-out tool makes on a user file allows only the file and pipe protocols', () => {
  const probe = probeArgs('/a/clip.mp4');
  const at = probe.indexOf('-protocol_whitelist');
  assert.deepEqual(probe.slice(at, at + 2), WHITELIST);
  assert.ok(at >= 0 && at < probe.indexOf('/a/clip.mp4'), 'the whitelist comes before the file');
  const decode = decodeArgs({ file: '/a/clip.mp4', trimStart: 0, trimEnd: 1, fps: 10, width: 32, height: 18, fit: 'contain', alpha: false, dir: '/c' });
  const input = decode.indexOf('-i');
  assert.deepEqual(decode.slice(input - 2, input), WHITELIST);
  assert.equal(decode[input + 1], '/a/clip.mp4');
  const extract = extractArgs('/a/clip.mp4', 12, '/c/%06d.png');
  const extractInput = extract.indexOf('-i');
  assert.deepEqual(extract.slice(extractInput - 2, extractInput), WHITELIST);
});

test('decodeArgs: JPEG by default, PNG with alpha, the decoder named before the input, fit as the scale filter', () => {
  const args = { file: '/a/clip.mp4', trimStart: 0.5, trimEnd: 2, fps: 10, width: 320, height: 180, fit: 'contain', alpha: false, dir: '/c' };
  const plain = decodeArgs(args);
  assert.ok(!plain.includes('-c:v'), 'no decoder flag for a clip without one');
  assert.deepEqual(plain.slice(-5), ['-vf', 'fps=10,scale=320:180:force_original_aspect_ratio=decrease', '-q:v', '1', '/c/%06d.jpg']);
  assert.equal(decodeArgs({ ...args, fit: 'cover' }).find((a) => a.startsWith('fps=')), 'fps=10,scale=320:180:force_original_aspect_ratio=increase');
  assert.equal(decodeArgs({ ...args, fit: 'fill' }).find((a) => a.startsWith('fps=')), 'fps=10,scale=320:180');
  const alpha = decodeArgs({ ...args, alpha: true, decoder: 'libvpx-vp9' });
  assert.deepEqual(alpha.slice(-3), ['-vf', 'fps=10,scale=320:180:force_original_aspect_ratio=decrease', '/c/%06d.png']);
  assert.ok(alpha.join(' ').includes('-c:v libvpx-vp9 -protocol_whitelist'), 'the decoder comes before the input');
});

test('probeVideo reads duration, size, frame rate and sound from ffprobe, rounds the duration to a millisecond, and says no alpha for an ordinary clip', () => {
  const dir = tmp('video-probe-');
  const json = JSON.stringify({ streams: [VIDEO, { codec_type: 'audio' }], format: { duration: '9' } });
  assert.deepEqual(probeVideo(fakeProbe(dir, { json }), '/a/clip.mp4'), { duration: 2, width: 320, height: 180, fps: 30000 / 1001, hasAudio: true, hasAlpha: false });
  const silent = JSON.stringify({ streams: [{ ...VIDEO, duration: undefined, avg_frame_rate: '0/0' }], format: { duration: '1.2346' } });
  assert.deepEqual(probeVideo(fakeProbe(dir, { json: silent }), '/a/clip.mp4'), { duration: 1.235, width: 320, height: 180, fps: 30, hasAudio: false, hasAlpha: false }, 'the container duration and r_frame_rate stand in');
});

test('probeVideo: an alpha pixel format, and a VP9 stream tagged alpha_mode 1, are alpha; only the VP9 one names a decoder', () => {
  const dir = tmp('video-probe-alpha-');
  const rgba = JSON.stringify({ streams: [{ ...VIDEO, codec_name: 'png', pix_fmt: 'rgba' }] });
  assert.deepEqual([probeVideo(fakeProbe(dir, { json: rgba }), 'x').hasAlpha, probeVideo(fakeProbe(dir, { json: rgba }), 'x').alphaDecoder], [true, undefined]);
  const vp9 = JSON.stringify({ streams: [{ ...VIDEO, codec_name: 'vp9', tags: { alpha_mode: '1' } }] });
  const info = probeVideo(fakeProbe(dir, { json: vp9 }), 'x');
  assert.deepEqual([info.hasAlpha, info.alphaDecoder], [true, 'libvpx-vp9']);
  const vp9Opaque = JSON.stringify({ streams: [{ ...VIDEO, codec_name: 'vp9' }] });
  assert.deepEqual([probeVideo(fakeProbe(dir, { json: vp9Opaque }), 'x').hasAlpha, probeVideo(fakeProbe(dir, { json: vp9Opaque }), 'x').alphaDecoder], [false, undefined]);
});

test('probeVideo: an error for a failing ffprobe, an answer that is not JSON, no video stream (a cover picture does not count) and no duration', () => {
  const dir = tmp('video-probe-error-');
  assert.deepEqual(probeVideo(fakeProbe(dir, { status: 1, stderr: 'x.mp4: Invalid data found' }), 'x'), { error: 'x.mp4: Invalid data found' });
  assert.deepEqual(probeVideo(fakeProbe(dir, { json: 'not json' }), 'x'), { error: 'ffprobe gave no readable answer' });
  const cover = JSON.stringify({ streams: [{ ...VIDEO, disposition: { attached_pic: 1 } }, { codec_type: 'audio' }] });
  assert.deepEqual(probeVideo(fakeProbe(dir, { json: cover }), 'x'), { error: 'no video stream' });
  const still = JSON.stringify({ streams: [{ ...VIDEO, duration: undefined }], format: {} });
  assert.deepEqual(probeVideo(fakeProbe(dir, { json: still }), 'x'), { error: 'unknown duration' });
  assert.match(probeVideo('/nonexistent/ffprobe', 'x').error, /ENOENT|ffprobe/);
});

test('fileSha256 is the sha256 of the file, for a file shorter than and longer than one read chunk', () => {
  const dir = tmp('video-sha-');
  for (const size of [0, 5, (1 << 20) + 17]) {
    const file = path.join(dir, `f${size}`);
    const bytes = Buffer.alloc(size, 7);
    writeFileSync(file, bytes);
    assert.equal(fileSha256(file), createHash('sha256').update(bytes).digest('hex'), String(size));
  }
});

test('readCache: a whole decode is { count }; a missing folder, a bad count, or a missing first or last frame is null', () => {
  const dir = tmp('video-cache-');
  const put = (name, count, frames) => {
    const folder = path.join(dir, name);
    mkdirSync(folder);
    if (count !== undefined) writeFileSync(path.join(folder, 'done.json'), JSON.stringify({ count }));
    for (const n of frames) writeFileSync(path.join(folder, `${String(n).padStart(6, '0')}.jpg`), 'x');
    return folder;
  };
  assert.deepEqual(readCache(put('whole', 3, [1, 2, 3]), 'jpg'), { count: 3 });
  assert.equal(readCache(path.join(dir, 'nowhere'), 'jpg'), null);
  assert.equal(readCache(put('no-done', undefined, [1, 2, 3]), 'jpg'), null);
  assert.equal(readCache(put('zero', 0, []), 'jpg'), null);
  assert.equal(readCache(put('fraction', 1.5, [1, 2]), 'jpg'), null);
  assert.equal(readCache(put('no-first', 3, [2, 3]), 'jpg'), null);
  assert.equal(readCache(put('no-last', 3, [1, 2]), 'jpg'), null);
  assert.equal(readCache(put('wrong-ext', 3, [1, 2, 3]), 'png'), null);
});

// A stand-in ffmpeg that writes `count` numbered frames into the folder of its last argument (the output pattern), or fails.
function fakeFfmpeg(dir, { count = 3, status = 0, stderr = '' } = {}) {
  const file = path.join(dir, `ffmpeg-${Math.random().toString(36).slice(2)}`);
  const frames = Array.from({ length: count }, (_, i) => `: > "$d/${String(i + 1).padStart(6, '0')}.jpg"`).join('\n');
  writeFileSync(file, `#!/bin/sh\nfor a in "$@"; do last="$a"; done\nd=$(dirname "$last")\n${frames}\nprintf '%s\\n' '${stderr}' >&2\nexit ${status}\n`, { mode: 0o755 });
  return file;
}

test('decodeFrames writes the frames and done.json into place and returns the count; the folder it worked in is gone', () => {
  const dir = tmp('video-decode-');
  const out = path.join(dir, 'frames');
  const opts = { file: '/a/clip.mp4', trimStart: 0, trimEnd: 1, fps: 3, width: 32, height: 18, fit: 'contain', alpha: false, dir: out };
  assert.deepEqual(decodeFrames(fakeFfmpeg(dir, { count: 3 }), opts), { count: 3 });
  assert.deepEqual(readdirSync(out).sort(), ['000001.jpg', '000002.jpg', '000003.jpg', 'done.json']);
  assert.deepEqual(readCache(out, 'jpg'), { count: 3 });
  assert.deepEqual(readdirSync(dir).filter((f) => f.includes('.partial-')), [], 'no private work folder is left');
  assert.deepEqual(decodeFrames(fakeFfmpeg(dir, { count: 3 }), opts), { count: 3 }, 'a whole decode already in place is kept');
});

test('decodeFrames: ffmpeg failing and ffmpeg writing no frame are errors that name the clip, and leave nothing in place', () => {
  const dir = tmp('video-decode-fail-');
  const out = path.join(dir, 'frames');
  const opts = { file: '/a/clip.mp4', trimStart: 0.5, trimEnd: 1, fps: 3, width: 32, height: 18, fit: 'contain', alpha: false, dir: out };
  assert.throws(() => decodeFrames(fakeFfmpeg(dir, { count: 0, status: 1, stderr: 'boom' }), opts), /^Error: ffmpeg cannot decode \/a\/clip\.mp4: boom$/);
  assert.throws(() => decodeFrames(fakeFfmpeg(dir, { count: 0 }), opts), /ffmpeg decoded no frames from \/a\/clip\.mp4 between 0\.5s and 1s/);
  assert.equal(existsSync(out), false);
  assert.deepEqual(readdirSync(dir).filter((f) => f.includes('.partial-')), []);
});
