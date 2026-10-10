import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { encodeArgs, findFfmpeg, probeAudio } from '../scripts/lib/ffmpeg.mjs';
import { writeWav } from './helpers/wav.mjs';

test('encodeArgs shape', () => {
  assert.deepEqual(encodeArgs({ fps: 30, out: 'o.mp4' }), [
    '-y', '-f', 'image2pipe', '-framerate', '30', '-c:v', 'png', '-i', '-',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', 'o.mp4']);
});

test('findFfmpeg honours FFMPEG_PATH', async () => {
  const saved = process.env.FFMPEG_PATH;
  process.env.FFMPEG_PATH = process.execPath; // any existing executable
  try { assert.equal(await findFfmpeg(), process.execPath); } finally {
    if (saved === undefined) delete process.env.FFMPEG_PATH; else process.env.FFMPEG_PATH = saved;
  }
});

test('findFfmpeg throws an install hint when nothing is found', async () => {
  const saved = { p: process.env.PATH, f: process.env.FFMPEG_PATH };
  process.env.PATH = '/nonexistent'; delete process.env.FFMPEG_PATH;
  try {
    await assert.rejects(() => findFfmpeg({ skipStatic: true }), /ffmpeg not found.*brew install ffmpeg/s);
  } finally {
    process.env.PATH = saved.p;
    if (saved.f !== undefined) process.env.FFMPEG_PATH = saved.f;
  }
});

test('findFfmpeg warns when FFMPEG_PATH is set but not executable', async () => {
  const saved = { p: process.env.PATH, f: process.env.FFMPEG_PATH };
  process.env.PATH = '/nonexistent'; process.env.FFMPEG_PATH = '/nonexistent/ffmpeg';
  const orig = process.stderr.write.bind(process.stderr);
  let seen = '';
  process.stderr.write = (c) => { seen += c; return true; };
  try {
    await assert.rejects(() => findFfmpeg({ skipStatic: true }), /ffmpeg not found/);
  } finally {
    process.stderr.write = orig;
    process.env.PATH = saved.p;
    if (saved.f === undefined) delete process.env.FFMPEG_PATH; else process.env.FFMPEG_PATH = saved.f;
  }
  assert.match(seen, /FFMPEG_PATH is set to .*\/nonexistent\/ffmpeg.* not executable/);
});

const VIDEO_HEAD = ['-y', '-f', 'image2pipe', '-framerate', '10', '-c:v', 'png', '-i', '-'];
const VIDEO_TAIL = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];
const AUDIO_OUT = ['-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2'];

test('encodeArgs with an empty audio list is identical to no audio option', () => {
  assert.deepEqual(encodeArgs({ fps: 10, out: 'o.mp4', audio: [], duration: 5 }), encodeArgs({ fps: 10, out: 'o.mp4' }));
});

test('encodeArgs one track: no amix, mapped directly', () => {
  const audio = [{ file: '/a/v.wav', start: 0, end: 5, volume: 1, fadeIn: 0, fadeOut: 0 }];
  assert.deepEqual(encodeArgs({ fps: 10, out: 'o.mp4', audio, duration: 5 }), [
    ...VIDEO_HEAD, '-i', '/a/v.wav',
    '-filter_complex', '[1:a]atrim=end=5,volume=1,adelay=0:all=1[a0]',
    '-map', '0:v', '-map', '[a0]', ...VIDEO_TAIL, ...AUDIO_OUT, '-t', '5', 'o.mp4']);
});

test('encodeArgs two tracks with fades, delay and volume are mixed without normalising', () => {
  const audio = [
    { file: '/a/music.mp3', start: 0, end: 6, volume: 0.4, fadeIn: 1, fadeOut: 2 },
    { file: '/a/voice.wav', start: 1.5, end: 6, volume: 1, fadeIn: 0, fadeOut: 0.5 },
  ];
  assert.deepEqual(encodeArgs({ fps: 10, out: 'o.mp4', audio, duration: 6 }), [
    ...VIDEO_HEAD, '-i', '/a/music.mp3', '-i', '/a/voice.wav',
    '-filter_complex',
    '[1:a]atrim=end=6,volume=0.4,afade=t=in:st=0:d=1,afade=t=out:st=4:d=2,adelay=0:all=1[a0];'
      + '[2:a]atrim=end=4.5,volume=1,afade=t=out:st=4:d=0.5,adelay=1500:all=1[a1];'
      + '[a0][a1]amix=inputs=2:duration=longest:normalize=0[aout]',
    '-map', '0:v', '-map', '[aout]', ...VIDEO_TAIL, ...AUDIO_OUT, '-t', '6', 'o.mp4']);
});

test('encodeArgs trims a track to its resolved end and clamps a fade-out longer than the clip', () => {
  const audio = [{ file: '/a/s.wav', start: 2, end: 3, volume: 1, fadeIn: 0, fadeOut: 4 }];
  const args = encodeArgs({ fps: 10, out: 'o.mp4', audio, duration: 8 });
  assert.equal(args[args.indexOf('-filter_complex') + 1],
    '[1:a]atrim=end=1,volume=1,afade=t=out:st=0:d=4,adelay=2000:all=1[a0]');
  assert.equal(args[args.indexOf('-t') + 1], '8');
});

test('encodeArgs never uses -shortest', () => {
  const audio = [{ file: '/a/s.wav', start: 0, end: 1, volume: 1, fadeIn: 0, fadeOut: 0 }];
  assert.ok(!encodeArgs({ fps: 10, out: 'o.mp4', audio, duration: 1 }).includes('-shortest'));
});

test('probeAudio accepts a decodable file', async (t) => {
  const ff = await findFfmpeg().catch(() => null);
  if (!ff) return t.skip('ffmpeg unavailable');
  const dir = mkdtempSync(path.join(tmpdir(), 'probe-'));
  const good = path.join(dir, 'good.wav');
  writeWav(good, { seconds: 0.5 });
  assert.equal(probeAudio(ff, good), null);
  return undefined;
});

test('probeAudio returns the first stderr line for an undecodable file', async (t) => {
  const ff = await findFfmpeg().catch(() => null);
  if (!ff) return t.skip('ffmpeg unavailable');
  const dir = mkdtempSync(path.join(tmpdir(), 'probe-'));
  const bad = path.join(dir, 'bad.wav');
  writeFileSync(bad, 'this is not audio\n');
  const msg = probeAudio(ff, bad);
  assert.equal(typeof msg, 'string');
  assert.ok(msg.length > 0 && !msg.includes('\n'));
  return undefined;
});

test('probeAudio rejects a file with no audio stream before any frame is captured', async (t) => {
  const ff = await findFfmpeg().catch(() => null);
  if (!ff) return t.skip('ffmpeg unavailable');
  const dir = mkdtempSync(path.join(tmpdir(), 'probe-'));
  const videoOnly = path.join(dir, 'novoice.m4a');
  const r = spawnSync(ff, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=16x16:d=0.2', '-c:v', 'libx264', '-f', 'mp4', videoOnly]);
  assert.equal(r.status, 0, String(r.stderr));
  const msg = probeAudio(ff, videoOnly);
  assert.equal(typeof msg, 'string');
  assert.match(msg, /matches no streams|does not contain any stream/);
  return undefined;
});

test('probeAudio reports a message instead of throwing when ffmpeg cannot be spawned', () => {
  const msg = probeAudio('/nonexistent/ffmpeg', '/nonexistent/x.wav');
  assert.equal(typeof msg, 'string');
  assert.match(msg, /ENOENT|spawn/);
});
