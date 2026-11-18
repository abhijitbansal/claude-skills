// scripts/lib/ffmpeg.mjs: finding ffmpeg, the file-only input builder, and the loudness parser. (Version 1's encode, preflight
// and audio-probe builders were deleted at cut-over with their callers; version 2 builds its own arguments in scripts/v2.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { findFfmpeg, fileInput, parseLoudness, PROTOCOL_WHITELIST } from '../scripts/lib/ffmpeg.mjs';

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
    await assert.rejects(() => findFfmpeg(), /ffmpeg not found.*brew install ffmpeg/s);
  } finally {
    process.env.PATH = saved.p;
    if (saved.f !== undefined) process.env.FFMPEG_PATH = saved.f;
  }
});

test('the not-found hint offers system installs and FFMPEG_PATH, never an npm install', async () => {
  const saved = { p: process.env.PATH, f: process.env.FFMPEG_PATH };
  process.env.PATH = '/nonexistent'; delete process.env.FFMPEG_PATH;
  try {
    await assert.rejects(() => findFfmpeg(), (e) => /FFMPEG_PATH/.test(e.message) && !/npm (?:install|i)\b|ffmpeg-static/.test(e.message));
  } finally {
    process.env.PATH = saved.p;
    if (saved.f !== undefined) process.env.FFMPEG_PATH = saved.f;
  }
  const source = readFileSync(fileURLToPath(new URL('../scripts/lib/ffmpeg.mjs', import.meta.url)), 'utf8');
  assert.doesNotMatch(source, /ffmpeg-static/);
});

test('findFfmpeg warns when FFMPEG_PATH is set but not executable', async () => {
  const saved = { p: process.env.PATH, f: process.env.FFMPEG_PATH };
  process.env.PATH = '/nonexistent'; process.env.FFMPEG_PATH = '/nonexistent/ffmpeg';
  const orig = process.stderr.write.bind(process.stderr);
  let seen = '';
  process.stderr.write = (c) => { seen += c; return true; };
  try {
    await assert.rejects(() => findFfmpeg(), /ffmpeg not found/);
  } finally {
    process.stderr.write = orig;
    process.env.PATH = saved.p;
    if (saved.f === undefined) delete process.env.FFMPEG_PATH; else process.env.FFMPEG_PATH = saved.f;
  }
  assert.match(seen, /FFMPEG_PATH is set to .*\/nonexistent\/ffmpeg.* not executable/);
});

test('fileInput puts the file-and-pipe protocol whitelist before the input, so a renamed playlist cannot fetch a URL', () => {
  assert.deepEqual(PROTOCOL_WHITELIST, ['-protocol_whitelist', 'file,pipe']);
  assert.deepEqual(fileInput('/a/b.mp3'), ['-protocol_whitelist', 'file,pipe', '-i', '/a/b.mp3']);
});

test('parseLoudness reads the last integrated loudness and true peak of an ebur128 summary', () => {
  const stderr = ['  I:         -23.4 LUFS', '  True peak:', '    Peak:       -1.2 dBFS', '', '  I:         -16.0 LUFS', '  True peak:', '    Peak:       -0.5 dBFS'].join('\n');
  assert.deepEqual(parseLoudness(stderr), { lufs: -16, truePeak: -0.5 });
});

test('parseLoudness reads silence as -Infinity and a summary without a peak as null', () => {
  assert.deepEqual(parseLoudness('  I:         -inf LUFS\n  True peak:\n    Peak:       -inf dBFS'), { lufs: -Infinity, truePeak: -Infinity });
  assert.equal(parseLoudness('  I:         -20.0 LUFS'), null);
  assert.equal(parseLoudness(''), null);
});
