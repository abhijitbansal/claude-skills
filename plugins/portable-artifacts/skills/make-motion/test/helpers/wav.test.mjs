import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { wavBuffer } from './wav.mjs';

const HEADER_BYTES = 44;
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const samplesOf = (buf) => Array.from({ length: (buf.length - HEADER_BYTES) / 2 }, (_, i) => buf.readInt16LE(HEADER_BYTES + i * 2));

// Hashes taken from the helper before clickBpm existed: the tone output must not move.
const TONE_DEFAULT_SHA = 'bac81935bcf9b34418950389fc15f2cb6443988d6da63a6d7b246242a148674e';
const TONE_STEREO_SHA = '72423f70e93070498fb30ce3c69d456e0ac8bd0d4e80cb99ef2af8ae896d0da6';

test('writeWav clickBpm 120 at 8 kHz: 160 samples of burst at sample 0, 4000, 8000 …, exact zeros between', () => {
  const buf = wavBuffer({ seconds: 10, sampleRate: 8000, clickBpm: 120 });
  const s = samplesOf(buf);
  assert.equal(s.length, 80000);
  const BURST = 160; // 20 ms at 8 kHz
  const PERIOD = 4000; // 0.5 s at 8 kHz
  for (let beat = 0; beat < 20; beat++) {
    const start = beat * PERIOD;
    const burst = s.slice(start, start + BURST);
    assert.ok(burst.some((v) => Math.abs(v) > 10000), `beat ${beat} has a burst at sample ${start}`);
    assert.ok(s.slice(start + BURST, start + PERIOD).every((v) => v === 0), `beat ${beat}: exact zeros after the burst`);
  }
});

test('writeWav clickBpm: the burst is a clickHz sine, so clickHz 500 gives a different burst than the default 1 kHz', () => {
  const burst = (opts) => samplesOf(wavBuffer({ seconds: 1, sampleRate: 8000, clickBpm: 120, ...opts })).slice(0, 160);
  assert.notDeepEqual(burst({ clickHz: 500 }), burst({}));
  assert.deepEqual(burst({}), burst({ clickHz: 1000 }));
  // 1 kHz at 8 kHz repeats every 8 samples.
  const b = burst({});
  assert.deepEqual(b.slice(0, 8), b.slice(8, 16));
});

test('writeWav clickBpm writes the same click to every channel', () => {
  const buf = wavBuffer({ seconds: 1, sampleRate: 8000, channels: 2, clickBpm: 120 });
  const s = samplesOf(buf);
  for (let i = 0; i < s.length; i += 2) assert.equal(s[i], s[i + 1]);
  assert.ok(s.slice(0, 320).some((v) => v !== 0));
});

test('without clickBpm the tone output is byte-identical to before', () => {
  assert.equal(sha256(wavBuffer()), TONE_DEFAULT_SHA);
  assert.equal(sha256(wavBuffer({ seconds: 1, channels: 2, sampleRate: 16000, toneHz: 330 })), TONE_STEREO_SHA);
});
