// The music bed: a beat grid fitted to the film's cuts, a synthesised backing texture on that grid, and a user's own
// music file checked under the same rules as a user's recording.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fitBeatGrid, renderBed, musicInput, musicEnd, musicDecodeArgs, padNotes, BEDS } from '../../scripts/v2/sound/bed.mjs';
import { SpecError } from '../../scripts/v2/spec.mjs';
import { findFfprobe } from '../../scripts/lib/ffmpeg.mjs';
import { ffmpegOrNull } from './helpers/session.mjs';

const RATE = 48000;
const SEED = 3;
const PEAK = 0.5;
const FADE_IN = 0.5;
const FADE_OUT = 1;
const LSB = 1 / 32768;
const root = mkdtempSync(path.join(tmpdir(), 'sound-bed-'));
after(() => rmSync(root, { recursive: true, force: true }));

const peakOf = (xs) => xs.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
const outFile = (name) => path.join(root, `${name}.wav`);

// { rate, channels, left, right } of a 16-bit PCM WAV, read by its chunks.
function readWav(file) {
  const buf = readFileSync(file);
  assert.equal(buf.toString('ascii', 0, 4), 'RIFF');
  assert.equal(buf.readUInt32LE(4), buf.length - 8, 'the RIFF size is the file size less 8');
  let at = 12;
  let fmt = null;
  while (at + 8 <= buf.length) {
    const id = buf.toString('ascii', at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    if (id === 'fmt ') fmt = { format: buf.readUInt16LE(at + 8), channels: buf.readUInt16LE(at + 10), rate: buf.readUInt32LE(at + 12), bits: buf.readUInt16LE(at + 22) };
    if (id === 'data') {
      assert.deepEqual({ format: fmt.format, bits: fmt.bits }, { format: 1, bits: 16 });
      const frames = size / (2 * fmt.channels);
      const channel = (c) => Float64Array.from({ length: frames }, (_, i) => buf.readInt16LE(at + 8 + (i * fmt.channels + c) * 2) / 32768);
      return { rate: fmt.rate, channels: fmt.channels, left: channel(0), right: channel(1) };
    }
    at += 8 + size;
  }
  throw new Error(`${file}: no data chunk`);
}

// A mono 16-bit 48 kHz WAV of `samples` (in -1..1), for musicInput.
function writeMonoWav(file, samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((x, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x)) * 32767), i * 2));
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  writeFileSync(file, Buffer.concat([header, data]));
}

// ---- fitBeatGrid ----

test('cuts at 2, 4 and 6 s at 120 bpm land all three with offset 0', () => {
  assert.deepEqual(fitBeatGrid([2, 4, 6], { bpm: 120, seconds: 8 }), { bpm: 120, offset: 0, landed: 3, cuts: 3 });
});

test('cuts at 2.1, 4.1 and 6.1 s at 120 bpm land all three with offset 0.1', () => {
  assert.deepEqual(fitBeatGrid([2.1, 4.1, 6.1], { bpm: 120, seconds: 8 }), { bpm: 120, offset: 0.1, landed: 3, cuts: 3 });
});

test('irregular cuts land fewer than all, and the counts say so', () => {
  const fit = fitBeatGrid([1.0, 2.37, 3.9, 5.15, 7.62], { bpm: 120, seconds: 9 });
  assert.equal(fit.cuts, 5);
  assert.ok(fit.landed >= 1 && fit.landed < 5, `landed ${fit.landed}`);
  assert.ok(Math.abs(fit.bpm - 120) <= 120 * 0.04 + 1e-9, `bpm ${fit.bpm} within the tolerance`);
});

test('one cut always lands, at the requested tempo', () => {
  assert.deepEqual(fitBeatGrid([3.3], { bpm: 120, seconds: 6 }), { bpm: 120, offset: 0.3, landed: 1, cuts: 1 });
});

test('no cuts: the requested tempo, offset 0, nothing landed', () => {
  assert.deepEqual(fitBeatGrid([], { bpm: 96, seconds: 6 }), { bpm: 96, offset: 0, landed: 0, cuts: 0 });
});

test('the tempo is searched within bpm x (1 +- tolerance): cuts on a 123 bpm grid all land asked for 120', () => {
  const beat = 60 / 123;
  const cuts = [4, 8, 12, 16].map((k) => k * beat);
  const fit = fitBeatGrid(cuts, { bpm: 120, seconds: 9 });
  assert.equal(fit.landed, 4);
  assert.ok(fit.bpm > 120 && fit.bpm <= 124.8, `bpm ${fit.bpm}: off 120, inside the tolerance`);
  const period = 60 / fit.bpm;
  for (const cut of cuts) {
    const d = (((cut - fit.offset) % period) + period) % period;
    assert.ok(Math.min(d, period - d) <= 1 / 30 + 1e-6, `cut ${cut} within a frame of a beat of the returned grid`);
  }
  const fixed = fitBeatGrid([4, 8, 12, 16].map((k) => k * beat), { bpm: 120, tolerance: 0, seconds: 9 });
  assert.equal(fixed.bpm, 120);
  assert.ok(fixed.landed < 4, 'at exactly 120 the grid drifts off them');
});

test('with no bpm the search runs from 84 to 132', () => {
  const fit = fitBeatGrid([1.2, 2.4, 3.6, 4.8], { seconds: 6 });
  assert.equal(fit.landed, 4);
  assert.ok(fit.bpm >= 84 && fit.bpm <= 132, `bpm ${fit.bpm}`);
});

test('a cut lands within one frame of a beat: the frame is the film fps (30 by default)', () => {
  assert.equal(fitBeatGrid([2.0, 4.05], { bpm: 120, tolerance: 0, seconds: 6 }).landed, 2);
  assert.equal(fitBeatGrid([2.0, 4.05], { bpm: 120, tolerance: 0, seconds: 6, fps: 60 }).landed, 1);
});

test('cuts outside the film are not counted; bad input is an error', () => {
  assert.equal(fitBeatGrid([2, 9], { bpm: 120, seconds: 8 }).cuts, 1);
  assert.throws(() => fitBeatGrid([2], { bpm: 120, seconds: 0 }), /fitBeatGrid: seconds must be a positive number/);
  assert.throws(() => fitBeatGrid([2], { bpm: -1, seconds: 4 }), /fitBeatGrid: bpm must be a positive number/);
  assert.throws(() => fitBeatGrid([Number.NaN], { bpm: 120, seconds: 4 }), /fitBeatGrid: cutTimes\[0\] must be a finite number/);
  assert.throws(() => fitBeatGrid([2], { bpm: 120, tolerance: 1, seconds: 4 }), /fitBeatGrid: tolerance must be a number from 0 to 0.5/);
});

// ---- renderBed ----

const GRID = Object.freeze({ bpm: 120, offset: 0.1 });

test('renderBed writes a 48 kHz stereo WAV of the film length for each bed, peaking at most 0.5, through a temporary name', async () => {
  assert.deepEqual([...BEDS], ['pulse', 'drift', 'tape']);
  for (const bed of BEDS) {
    const out = outFile(`bed-${bed}`);
    assert.equal(await renderBed({ bed, grid: GRID, seconds: 6, seed: SEED, out }), out);
    const wav = readWav(out);
    assert.deepEqual([wav.rate, wav.channels, wav.left.length], [RATE, 2, 6 * RATE], bed);
    const peak = Math.max(peakOf(wav.left), peakOf(wav.right));
    assert.ok(peak <= PEAK && peak > 0.25, `${bed} peak ${peak}`);
  }
  assert.deepEqual(readdirSync(root).filter((name) => !name.endsWith('.wav')), [], 'no temporary file is left behind');
});

test('every bed fades in over 0.5 s and out over 1 s', async () => {
  for (const bed of BEDS) {
    const { left, right } = readWav(outFile(`bed-${bed}`));
    const n = left.length;
    for (const xs of [left, right]) {
      assert.equal(xs[0], 0, `${bed} starts silent`);
      assert.equal(xs[n - 1], 0, `${bed} ends silent`);
      for (let i = 0; i < FADE_IN * RATE; i++) assert.ok(Math.abs(xs[i]) <= (PEAK * i) / (FADE_IN * RATE) + LSB, `${bed} fade in at ${i}`);
      for (let i = n - FADE_OUT * RATE; i < n; i++) assert.ok(Math.abs(xs[i]) <= (PEAK * (n - 1 - i)) / (FADE_OUT * RATE) + LSB, `${bed} fade out at ${i}`);
    }
    assert.ok(peakOf(left.subarray(RATE, 4 * RATE)) > 0.25, `${bed} sounds between the fades`);
  }
});

test('the pulse bed puts a kick onset within 1 ms of every beat of the grid', async () => {
  const { left } = readWav(outFile('bed-pulse'));
  const period = 60 / GRID.bpm;
  const ms = RATE / 1000;
  const threshold = 0.01;
  let checked = 0;
  for (let beat = GRID.offset; beat < 6 - FADE_OUT; beat += period) {
    if (beat < FADE_IN) continue;
    const at = Math.round(beat * RATE);
    const quietBefore = peakOf(left.subarray(at - 2 * ms, at - ms));
    assert.ok(quietBefore < threshold, `quiet before the beat at ${beat} s (${quietBefore})`);
    let onset = at - ms;
    while (Math.abs(left[onset]) < threshold && onset < at + 2 * ms) onset++;
    assert.ok(Math.abs(onset - at) <= ms, `kick onset at ${onset}, beat at ${at}`);
    checked++;
  }
  assert.ok(checked >= 8, `${checked} beats checked`);
});

test('the same seed gives identical files; a different seed changes the noise of the tape bed', async () => {
  for (const bed of BEDS) {
    const again = outFile(`again-${bed}`);
    await renderBed({ bed, grid: GRID, seconds: 6, seed: SEED, out: again });
    assert.deepEqual(readFileSync(again), readFileSync(outFile(`bed-${bed}`)), bed);
  }
  await renderBed({ bed: 'tape', grid: GRID, seconds: 6, seed: SEED + 1, out: outFile('tape-other') });
  assert.notDeepEqual(readFileSync(outFile('tape-other')), readFileSync(outFile('bed-tape')));
});

test('the drift pad changes its two notes on every bar', () => {
  const bars = padNotes({ grid: GRID, seconds: 12, seed: SEED });
  assert.ok(bars.length >= 5, `${bars.length} bars`);
  bars.forEach((bar, k) => {
    assert.equal(bar.notes.length, 2);
    assert.ok(Math.abs(bar.start - (GRID.offset + k * 4 * (60 / GRID.bpm))) < 1e-9 || (k === 0 && bar.start === 0), `bar ${k} starts on a downbeat`);
    if (k > 0) assert.notDeepEqual(bar.notes, bars[k - 1].notes, `bar ${k} changes`);
  });
});

test('renderBed writes through a temporary name: when that name cannot be written, nothing appears at out', async () => {
  const out = outFile('blocked-bed');
  mkdirSync(`${out}.partial`);
  await assert.rejects(() => renderBed({ bed: 'pulse', grid: GRID, seconds: 2, seed: SEED, out }));
  assert.equal(existsSync(out), false);
  rmSync(`${out}.partial`, { recursive: true });
});

test('renderBed refuses an unknown bed, a bad grid or a bad length', async () => {
  const out = outFile('bad');
  await assert.rejects(() => renderBed({ bed: 'disco', grid: GRID, seconds: 4, seed: SEED, out }), /renderBed: unknown bed "disco"; beds: pulse, drift, tape/);
  await assert.rejects(() => renderBed({ bed: 'pulse', grid: { bpm: 0, offset: 0 }, seconds: 4, seed: SEED, out }), /renderBed: grid\.bpm must be a positive number/);
  await assert.rejects(() => renderBed({ bed: 'pulse', grid: GRID, seconds: -1, seed: SEED, out }), /renderBed: seconds must be a positive number/);
});

// ---- a user's own music ----

const film = (src) => ({ version: 2, music: { src }, shots: [] });

function filmFolder(name) {
  const dir = path.join(root, name);
  mkdirSync(dir);
  return dir;
}

// ffmpeg and the ffprobe beside it, or null after skipping `t` when either is missing (as voice-external.test.mjs does).
async function mediaTools(t) {
  const ffmpeg = await ffmpegOrNull();
  const ffprobe = ffmpeg ? findFfprobe({ ffmpeg }) : null;
  if (!ffmpeg || !ffprobe) { t.skip('no ffmpeg or ffprobe'); return null; }
  return { ffmpeg, ffprobe };
}

test('musicInput: a click track inside the film folder gives its real path, its length and its beats', async (t) => {
  const tools = await mediaTools(t);
  if (!tools) return;
  const dir = filmFolder('clicks');
  const click = (i) => (i % (RATE / 2) < 240 ? 0.8 * Math.exp(-(i % (RATE / 2)) / 40) * (i % 2 ? 1 : -1) : 0);
  writeMonoWav(path.join(dir, 'track.wav'), Array.from({ length: 8 * RATE }, (_, i) => click(i)));
  const got = await musicInput(film('track.wav'), dir, tools);
  assert.equal(got.file, realpathSync(path.join(dir, 'track.wav')));
  assert.ok(Math.abs(got.seconds - 8) < 0.01, `seconds ${got.seconds}`);
  assert.ok(Array.isArray(got.beats) && got.beats.length >= 10, `beats ${JSON.stringify(got.beats)}`);
  got.beats.slice(1).forEach((b, k) => assert.ok(Math.abs(b - got.beats[k] - 0.5) < 0.03, `beat gap ${b - got.beats[k]}`));
});

test('musicInput: silence has no beats (null), not an error', async (t) => {
  const tools = await mediaTools(t);
  if (!tools) return;
  const dir = filmFolder('silent');
  writeMonoWav(path.join(dir, 'quiet.wav'), new Array(6 * RATE).fill(0));
  const got = await musicInput(film('quiet.wav'), dir, tools);
  assert.equal(got.beats, null);
});

test('musicInput: a path out of the film folder or a missing file is a SpecError at music.src, before any tool runs', async () => {
  const dir = filmFolder('refused');
  writeMonoWav(path.join(root, 'outside.wav'), new Array(RATE).fill(0));
  for (const src of ['../outside.wav', 'missing.wav']) {
    await assert.rejects(() => musicInput(film(src), dir, { ffmpeg: '/nonexistent/ffmpeg', ffprobe: '/nonexistent/ffprobe' }), (err) => {
      assert.ok(err instanceof SpecError, `${src}: ${err}`);
      assert.equal(err.errors[0].path, 'music.src', src);
      return true;
    });
  }
});

// A film folder holding the two hostile files the voice review used (voice-external.test.mjs hostileFolder): an HLS
// playlist naming a segment outside the folder by its absolute path, and cat.wav holding an ffconcat list whose entry is
// a symlink inside the folder pointing outside.
function hostileFolder(name, ffmpeg) {
  const dir = filmFolder(name);
  const outside = filmFolder(`${name}-outside`);
  const segment = path.join(outside, 'seg.ts');
  const made = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=440:d=2', '-c:a', 'aac', '-f', 'mpegts', segment], { encoding: 'utf8' });
  assert.equal(made.status, 0, made.stderr);
  writeFileSync(path.join(dir, 'bed.m3u8'), `#EXTM3U\n#EXT-X-TARGETDURATION:3\n#EXTINF:2.0,\n${segment}\n#EXT-X-ENDLIST\n`);
  symlinkSync(segment, path.join(dir, 'seg.ts'));
  writeFileSync(path.join(dir, 'cat.wav'), 'ffconcat version 1.0\nfile seg.ts\n');
  return dir;
}

test('musicInput: a playlist or a concat script is a SpecError at music.src naming its format, found by the probe', async (t) => {
  const tools = await mediaTools(t);
  if (!tools) return;
  const dir = hostileFolder('hostile-input', tools.ffmpeg);
  for (const [src, format] of [['bed.m3u8', 'hls'], ['cat.wav', 'concat']]) {
    await assert.rejects(() => musicInput(film(src), dir, tools), (err) => {
      assert.ok(err instanceof SpecError, `${src}: ${err}`);
      assert.equal(err.errors[0].path, 'music.src');
      assert.match(err.message, new RegExp(`"${src.replace('.', '\\.')}" is in the "${format}" format, not plain audio`));
      return true;
    });
  }
});

test('with the probe bypassed, the beat decode itself refuses a playlist or a concat script: the format whitelist', async (t) => {
  const tools = await mediaTools(t);
  if (!tools) return;
  const dir = hostileFolder('hostile-decode', tools.ffmpeg);
  for (const name of ['bed.m3u8', 'cat.wav']) {
    const r = spawnSync(tools.ffmpeg, musicDecodeArgs(path.join(dir, name)), { encoding: 'buffer' });
    assert.notEqual(r.status, 0, `${name}: ffmpeg decoded it`);
    assert.match(r.stderr.toString(), /Format not on whitelist/, name);
  }
});

test('musicInput needs a music src', async () => {
  await assert.rejects(() => musicInput({ version: 2, music: { bed: 'pulse' }, shots: [] }, root), /musicInput: the film's music has no src/);
});

test('musicEnd: music shorter than the film ends where it ends, with a 1 s fade; longer music is cut at the film end', () => {
  assert.deepEqual(musicEnd(5, 8), { end: 5, fadeFrom: 4, short: true });
  assert.deepEqual(musicEnd(12, 8), { end: 8, fadeFrom: 7, short: false });
  assert.deepEqual(musicEnd(0.5, 8), { end: 0.5, fadeFrom: 0, short: true });
});
