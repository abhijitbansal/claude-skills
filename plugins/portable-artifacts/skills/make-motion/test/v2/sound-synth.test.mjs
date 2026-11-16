// The cue voices: the version 1 synthesisers plus sub, paper, marker and a riser that ends on its anchor, as mono
// sample generators, and the renderer that lays a cue list into one stereo track of the film's length.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { KNOWN_CUES, RISER_RELEASE_SECONDS, cueSamples, riserTo, renderCues } from '../../scripts/v2/sound/synth.mjs';

const RATE = 48000;
const SEED = 7;
const NOISE_CUES = ['paper', 'marker', 'riser'];
const LIMIT = 0.98;
const dir = mkdtempSync(path.join(tmpdir(), 'sound-synth-'));
after(() => rmSync(dir, { recursive: true, force: true }));

const peakOf = (xs) => xs.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
const outFile = (name) => path.join(dir, `${name}.wav`);

// { rate, channels, left, right } of a 16-bit PCM WAV, read by its chunks.
function readWav(file) {
  const buf = readFileSync(file);
  assert.equal(buf.toString('ascii', 0, 4), 'RIFF');
  assert.equal(buf.toString('ascii', 8, 12), 'WAVE');
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
const firstNonZero = (xs) => xs.findIndex((x) => x !== 0);
const lastNonZero = (xs) => xs.findLastIndex((x) => x !== 0);

// ---- the voices ----

test('KNOWN_CUES is the frozen list of the version 1 cues and the new ones', () => {
  assert.ok(Object.isFrozen(KNOWN_CUES));
  assert.deepEqual([...KNOWN_CUES], ['pop', 'click', 'whoosh', 'chime', 'impact', 'riser', 'swoosh', 'drop', 'ding', 'sub', 'paper', 'marker']);
});

test('every known cue gives finite mono samples with a peak above 0.05 and at most 0.9', () => {
  for (const cue of KNOWN_CUES) {
    const xs = cueSamples(cue, { seed: SEED });
    assert.ok(xs instanceof Float32Array, cue);
    assert.ok(xs.length > 0, cue);
    assert.ok(xs.every(Number.isFinite), `${cue} finite`);
    const peak = peakOf(xs);
    assert.ok(peak > 0.05 && peak <= 0.9, `${cue} peak ${peak}`);
  }
});

test('the same seed gives the same samples; a different seed changes the noise cues', () => {
  for (const cue of KNOWN_CUES) assert.deepEqual(cueSamples(cue, { seed: SEED }), cueSamples(cue, { seed: SEED }), cue);
  for (const cue of NOISE_CUES) assert.notDeepEqual(cueSamples(cue, { seed: SEED }), cueSamples(cue, { seed: SEED + 1 }), cue);
});

test('the new voices last as long as the brief says: sub 0.35 s, paper 0.12 s, marker 0.18 s', () => {
  assert.equal(cueSamples('sub', { seed: SEED }).length, Math.round(0.35 * RATE));
  assert.equal(cueSamples('paper', { seed: SEED }).length, Math.round(0.12 * RATE));
  assert.equal(cueSamples('marker', { seed: SEED }).length, Math.round(0.18 * RATE));
});

// The frequency of each cycle of `xs`, from the spacing of its upward zero crossings (strictly through 0, so the
// voice's final faded-to-zero sample is not counted as a crossing).
function cycleHz(xs) {
  const ups = [];
  for (let i = 1; i < xs.length; i++) if (xs[i - 1] < 0 && xs[i] > 0) ups.push(i);
  return ups.slice(1).map((at, k) => RATE / (at - ups[k]));
}

test('sub is a sine falling from 90 Hz toward 40 Hz', () => {
  const hz = cycleHz(cueSamples('sub', { seed: SEED }));
  assert.ok(hz.length >= 10, `${hz.length} cycles`);
  assert.ok(hz[0] > 75 && hz[0] <= 92, `first cycle ${hz[0]} Hz`);
  assert.ok(hz.at(-1) >= 38 && hz.at(-1) < 48, `last cycle ${hz.at(-1)} Hz`);
  hz.slice(1).forEach((f, k) => assert.ok(f <= hz[k] + 1, `cycle ${k + 1} rises: ${hz[k]} to ${f}`));
});

test('riserTo(seconds) rises for that long to its peak, then releases over 4 ms to silence', () => {
  const release = Math.round(RISER_RELEASE_SECONDS * RATE);
  assert.equal(RISER_RELEASE_SECONDS, 0.004);
  for (const seconds of [0.5, 1.6, 3]) {
    const xs = riserTo(seconds, { seed: SEED });
    const peakAt = Math.round(seconds * RATE) - 1;
    assert.equal(xs.length, peakAt + 1 + release, `${seconds} s`);
    assert.equal(Math.abs(xs[peakAt]), peakOf(xs), `${seconds} s peaks after ${seconds} s`);
    assert.equal(xs.at(-1), 0, `${seconds} s ends silent`);
    assert.ok(peakOf(xs.subarray(0, xs.length / 2)) < 0.5 * peakOf(xs), `${seconds} s rises`);
  }
  assert.throws(() => riserTo(0, { seed: SEED }), /riserTo: seconds must be a positive number/);
  assert.throws(() => riserTo(Number.NaN, { seed: SEED }), /riserTo: seconds must be a positive number/);
});

test('riserTo and cueSamples need a seed: an integer from 0 to 2^32 - 1, or a TypeError', () => {
  for (const seed of [undefined, null, 1.5, -1, 2 ** 32, '7', Number.NaN]) {
    assert.throws(() => riserTo(1, { seed }), (err) => err instanceof TypeError && /riserTo: seed must be an integer from 0 to 4294967295/.test(err.message), String(seed));
    assert.throws(() => cueSamples('paper', { seed }), (err) => err instanceof TypeError && /cueSamples: seed must be an integer from 0 to 4294967295/.test(err.message), String(seed));
  }
  assert.throws(() => riserTo(1), TypeError);
  assert.throws(() => cueSamples('click'), TypeError);
});

test('every voice starts and ends near silence: its first and last samples are within 0.001 of 0', () => {
  for (const cue of KNOWN_CUES) {
    const xs = cueSamples(cue, { seed: SEED });
    assert.ok(Math.abs(xs[0]) <= 0.001, `${cue} starts at ${xs[0]}`);
    assert.ok(Math.abs(xs.at(-1)) <= 0.001, `${cue} ends at ${xs.at(-1)}`);
  }
});

test('an unknown cue is an error listing the known names', () => {
  assert.throws(() => cueSamples('boing', { seed: SEED }), new RegExp(`unknown cue "boing"; known cues: ${KNOWN_CUES.join(', ')}`));
});

// ---- the track ----

test('renderCues writes a stereo 48 kHz WAV of the film length; a click starts within one sample of round(t x 48000)', async () => {
  const result = await renderCues([{ t: 1.0, cue: 'click', gainDb: -12, pan: 0 }], { seconds: 2, seed: SEED, out: outFile('click') });
  assert.deepEqual(result, { file: outFile('click'), dropped: 0 });
  const wav = readWav(outFile('click'));
  assert.deepEqual([wav.rate, wav.channels, wav.left.length], [RATE, 2, 2 * RATE]);
  assert.ok(Math.abs(firstNonZero(wav.left) - Math.round(1.0 * RATE)) <= 1, `first sample at ${firstNonZero(wav.left)}`);
  assert.deepEqual(wav.left, wav.right, 'a centred cue is the same in both channels');
});

test('a cue is scaled by its gain: a click at -12 dB peaks a quarter as high as at 0 dB', async () => {
  await renderCues([{ t: 0.5, cue: 'click', gainDb: 0, pan: 0 }], { seconds: 1, seed: SEED, out: outFile('loud') });
  await renderCues([{ t: 0.5, cue: 'click', gainDb: -12, pan: 0 }], { seconds: 1, seed: SEED, out: outFile('quiet') });
  const ratio = peakOf(readWav(outFile('quiet')).left) / peakOf(readWav(outFile('loud')).left);
  assert.ok(Math.abs(ratio - 10 ** (-12 / 20)) < 0.002, `ratio ${ratio}`);
});

test('a riser peaks on its anchor: its loudest sample is at round(t x 48000), its release done 4 ms later', async () => {
  await renderCues([{ t: 1.5, cue: 'riser', gainDb: -12, pan: 0 }], { seconds: 3, seed: SEED, out: outFile('riser') });
  const { left } = readWav(outFile('riser'));
  const anchor = Math.round(1.5 * RATE);
  assert.equal(Math.abs(left[anchor]), peakOf(left), 'the riser peaks on the anchor');
  assert.ok(lastNonZero(left) <= anchor + Math.round(RISER_RELEASE_SECONDS * RATE), `last sound at ${lastNonZero(left)}`);
});

test('a riser anchored earlier than its length is cut at the film start, not moved', async () => {
  await renderCues([{ t: 0.4, cue: 'riser', gainDb: -12, pan: 0 }], { seconds: 2, seed: SEED, out: outFile('early-riser') });
  const { left } = readWav(outFile('early-riser'));
  assert.equal(Math.abs(left[Math.round(0.4 * RATE)]), peakOf(left), 'still peaks on its anchor');
});

test('a cue cut by the film\'s edge fades in or out there, never a step (review Minor 1)', async () => {
  await renderCues([{ t: 0.05, cue: 'riser', gainDb: -12, pan: 0 }], { seconds: 2, seed: SEED, out: outFile('cut-head') });
  const head = readWav(outFile('cut-head')).left;
  assert.ok(Math.abs(head[0]) < 0.001, `the track starts on ${head[0]}`);
  assert.ok(Math.abs(head[Math.round(0.05 * RATE)]) > 0.01, 'the riser is still heard up to its anchor');
  await renderCues([{ t: 1.967, cue: 'sub', gainDb: -12, pan: 0 }], { seconds: 2, seed: SEED, out: outFile('cut-tail') });
  const tail = readWav(outFile('cut-tail')).left;
  assert.ok(Math.abs(tail.at(-1)) < 0.001, `the track ends on ${tail.at(-1)}`);
  assert.ok(peakOf(tail) > 0.01, 'the sub sounds');
});

test('renderCues writes through a temporary name: when that name cannot be written, nothing appears at out', async () => {
  const out = outFile('blocked');
  mkdirSync(`${out}.partial`);
  await assert.rejects(() => renderCues([{ t: 0.1, cue: 'click', gainDb: -12, pan: 0 }], { seconds: 1, seed: SEED, out }));
  assert.equal(existsSync(out), false);
});

test('overlapping cues never pass 0.98', async () => {
  // eight impacts on the same frame, at 0 dB: four times full scale before the limit
  const cues = Array.from({ length: 8 }, () => ({ t: 0.2, cue: 'impact', gainDb: 0, pan: 0 }));
  await renderCues(cues, { seconds: 1.5, seed: SEED, out: outFile('pile') });
  const { left, right } = readWav(outFile('pile'));
  const peak = Math.max(peakOf(left), peakOf(right));
  assert.ok(peak <= LIMIT, `peak ${peak}`);
  assert.ok(peak > 0.97, `the pile reaches the limit (${peak}), so the limit is what holds it`);
});

test('a cue past the end of the film is dropped and counted; one that starts inside it is cut at the end', async () => {
  const cues = [
    { t: 2.5, cue: 'click', gainDb: -12, pan: 0 },
    { t: 2.0, cue: 'pop', gainDb: -12, pan: 0 },
    { t: 2.2, cue: 'riser', gainDb: -12, pan: 0 },
    { t: 1.9, cue: 'chime', gainDb: -12, pan: 0 },
  ];
  const result = await renderCues(cues, { seconds: 2, seed: SEED, out: outFile('late') });
  assert.equal(result.dropped, 3);
  const { left } = readWav(outFile('late'));
  assert.equal(left.length, 2 * RATE);
  assert.ok(firstNonZero(left) >= Math.round(1.9 * RATE) - 1, 'only the chime sounds');
});

test('no cues give a silent track of the film length; the same input gives the same bytes', async () => {
  const silent = await renderCues([], { seconds: 1, seed: SEED, out: outFile('silent') });
  assert.equal(silent.dropped, 0);
  const { left } = readWav(outFile('silent'));
  assert.equal(left.length, RATE);
  assert.equal(firstNonZero(left), -1);
  const cues = [{ t: 0.3, cue: 'paper', gainDb: -12, pan: 0 }, { t: 0.6, cue: 'marker', gainDb: -12, pan: 0 }];
  await renderCues(cues, { seconds: 1, seed: SEED, out: outFile('a') });
  await renderCues(cues, { seconds: 1, seed: SEED, out: outFile('b') });
  assert.deepEqual(readFileSync(outFile('a')), readFileSync(outFile('b')));
});

test('renderCues refuses a bad length, an unknown cue or a cue without a finite time, gain or pan', async () => {
  const out = outFile('bad');
  await assert.rejects(() => renderCues([], { seconds: 0, seed: SEED, out }), /renderCues: seconds must be a positive number/);
  await assert.rejects(() => renderCues([{ t: 0.1, cue: 'boing', gainDb: -12, pan: 0 }], { seconds: 1, seed: SEED, out }), /cues\[0\]: unknown cue "boing"/);
  await assert.rejects(() => renderCues([{ t: Number.NaN, cue: 'click', gainDb: -12, pan: 0 }], { seconds: 1, seed: SEED, out }), /cues\[0\]\.t must be a number of seconds, 0 or more/);
  await assert.rejects(() => renderCues([{ t: 0.1, cue: 'click', gainDb: 'loud', pan: 0 }], { seconds: 1, seed: SEED, out }), /cues\[0\]\.gainDb must be a finite number/);
  await assert.rejects(() => renderCues([{ t: 0.1, cue: 'click', gainDb: -12, pan: 2 }], { seconds: 1, seed: SEED, out }), /cues\[0\]\.pan must be a number from -1 to 1/);
});
