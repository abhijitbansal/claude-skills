import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeArgs, findFfmpeg } from '../scripts/lib/ffmpeg.mjs';

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
