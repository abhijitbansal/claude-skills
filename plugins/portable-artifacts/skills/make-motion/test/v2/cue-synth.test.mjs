// scripts/v2/sound/cue-synth.mjs: the synthesis moved out of version 1's scripts/lib/cues.mjs (cut-over plan, Task 1)
// with its bytes unchanged. HASHES holds the sha256 of each cue's WAV as scripts/lib/cues.mjs made it at 2e505594, before
// the move, recorded by running that file (.scratch/co1/record-before.mjs): a cue that changes by one sample fails here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as synth from '../../scripts/v2/sound/cue-synth.mjs';
import { CUE_LAYERS, SAMPLE_RATE, cueWav, channelsWav, levelled, layerCue, noteHz, pinkNoise, fmBand, MAX_HZ, FM_CLICK_RATIO } from '../../scripts/v2/sound/cue-synth.mjs';
import { mulberry32 } from '../../engine/seeded.mjs';

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

const HASHES = Object.freeze({
  pop: '05ceac153a43e2fa1f13919f33b3e7aff764da5e577e7c900b5ba39c6b176054',
  click: 'dda6a952655125403ec05266280ca7c04bfa0c8241684a65964c6624786b5497',
  whoosh: '7efa3af288449415b5915e6f6e4629920390379d1c6f8ad864be952326f42d63',
  chime: 'bbb6caa15474b90ee7e8ba5415830376abf7e55f90f267b172ab92359297aee2',
  impact: '84827605aeafda789d0e89436c4c74d69e14543978ca45819d7dc91e2e61a3ec',
  riser: '79d5c5297a56f9b8aa3e6bd379d53728095f780aaf622458316387d3df78bc2d',
  swoosh: 'f5deb7652f488830374cb7caef5075684566e5f425a6c476eb6a666829d53cff',
  drop: '793be04e68628a0c342c02b9f1112feafe1f11233577689acb48e2578155ec9a',
  ding: '16a9e8e970c08c6c7ba0d6cb69d9f09848f874d752ab072795df621954f9abc1',
});
const OTHER_HASHES = [
  [{ cue: 'typing', chars: 12 }, 'a9a4a55466b3b4435a24306a992ca5e470658b0df4aa01c036c24dfb06bd620b'],
  [{ cue: 'typing', chars: 5, spacing: 0.05 }, 'db3423d43bd15dabea78d9142abc220a9dbdfd4e95cc0eda7f57f28bfdace333'],
  [{ cue: 'typing', chars: 40 }, '2456fbc05609d01c1df8b1bacdcc26d3db93002805de6c708c2a4f4d86d68e13'], // the default key spacing, 0.035 s
  [{ cue: 'chime', note: 'C#5', pan: 0.5 }, '7403ac6cb59d81bf1c802ca53f3b4a076200ed53a7e3f4a5c5a2b6d2ba932fb9'],
  [{ cue: 'pop', note: 'A7', pan: -1 }, '8292bd25ff43573f651393be4c426145caadfb0007bf435e4bf1e3c56b539f86'],
  [{ cue: 'whoosh', pan: 1 }, '6fbe552b71753e5e87a46d5ee085e3f2c78d51e6b53329ec8deff84585dda8c3'],
];

test('the module exports the synthesis and nothing of version 1: no sample loader, no spec-level function', () => {
  assert.deepEqual(Object.keys(synth).sort(), ['CUE_LAYERS', 'FM_CLICK_RATIO', 'MAX_HZ', 'SAMPLE_RATE', 'channelsWav', 'cueWav', 'fmBand', 'layerCue', 'levelled', 'noteHz', 'pinkNoise', 'reverbTail', 'widen']);
});

test('every cue of CUE_LAYERS makes the bytes version 1 made, and the table names exactly the nine cues', () => {
  assert.deepEqual(Object.keys(CUE_LAYERS), Object.keys(HASHES));
  for (const cue of Object.keys(CUE_LAYERS)) assert.equal(sha(cueWav({ cue })), HASHES[cue], cue);
});

test('typing (at its default and a given spacing), a tuned note and a pan make the bytes version 1 made', () => {
  for (const [options, hash] of OTHER_HASHES) assert.equal(sha(cueWav(options)), hash, JSON.stringify(options));
});

test('the same cue is the same bytes twice, and a pan moves the channels, not the length', () => {
  assert.equal(sha(cueWav({ cue: 'pop' })), sha(cueWav({ cue: 'pop' })));
  assert.equal(cueWav({ cue: 'pop', pan: 1 }).length, cueWav({ cue: 'pop', pan: -1 }).length);
  assert.notEqual(sha(cueWav({ cue: 'pop', pan: 1 })), sha(cueWav({ cue: 'pop', pan: -1 })));
});

test('a name that is not a synthesised cue is an Error that lists the cues; a recorded sample is not one here', () => {
  assert.throws(() => cueWav({ cue: 'nope' }), /unknown cue "nope"; cues: pop, click, whoosh, chime, impact, riser, swoosh, drop, ding, typing/);
  assert.throws(() => cueWav({ cue: 'kenney:click-a' }), /unknown cue "kenney:click-a"/);
  assert.throws(() => cueWav({ cue: 'constructor' }), /unknown cue "constructor"/, 'an inherited name is not a cue');
  assert.throws(() => cueWav({ cue: 'pop', note: 'H9' }), /not a note name/);
});

test('channelsWav levels each channel to the cue peak, fades the last 5 ms, pans equal-power, and is a 44-byte-header 48 kHz stereo WAV', () => {
  const ramp = Float64Array.from({ length: 4800 }, (_, i) => (i % 2 === 0 ? 1 : -1) * 3);
  const wav = channelsWav({ left: ramp, right: ramp, pan: 0 });
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.readUInt16LE(22), 2);
  assert.equal(wav.readUInt32LE(24), SAMPLE_RATE);
  assert.equal(wav.length, 44 + 4800 * 4);
  assert.equal(wav.readInt16LE(44), wav.readInt16LE(46), 'a centred cue is the same in both channels');
  assert.equal(Math.abs(wav.readInt16LE(44)), Math.round(0.5 * 32767), 'peak 0.5 (-6 dBFS)');
  assert.equal(wav.readInt16LE(44 + 4799 * 4), 0, 'it ends on silence');
  const hard = channelsWav({ left: ramp, right: ramp, pan: 1 });
  assert.ok(Math.abs(hard.readInt16LE(44)) < 3, 'panned right: the left channel is silent');
});

test('levelled leaves silence silent and scales a signal to peak 0.5', () => {
  assert.deepEqual(levelled(new Float64Array(10)), new Array(10).fill(0));
  assert.equal(Math.max(...levelled([0.1, -0.4, 0.2, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1].concat(new Array(300).fill(0.1))).map(Math.abs)), 0.5);
});

test('the building blocks keep their contracts: note frequencies, the FM band limit, pink noise, layers summed in mono and widened', () => {
  assert.equal(noteHz('A4'), 440);
  assert.ok(Math.abs(noteHz('C#5') - 554.365) < 0.001);
  assert.ok(Math.abs(noteHz('Bb3') - 233.082) < 0.001);
  const band = fmBand(1e6);
  assert.ok(band.topHz <= MAX_HZ + 1e-9 && band.index >= 1, 'a very high note keeps its strong sidebands under the alias limit');
  assert.deepEqual(FM_CLICK_RATIO, { pop: 6, drop: 16, ding: 2 });
  const pink = pinkNoise(mulberry32(1));
  const values = Array.from({ length: 1000 }, pink);
  assert.ok(values.every(Number.isFinite) && Math.max(...values.map(Math.abs)) > 0.1);
  const mono = layerCue(CUE_LAYERS.click, 3000, mulberry32(0x5eed));
  assert.equal(mono.left, mono.right, 'a dry cue is one array in both channels');
  const wide = layerCue(CUE_LAYERS.whoosh, 440, mulberry32(0x5eed));
  assert.notDeepEqual(wide.left, wide.right, 'a widened cue is not');
});
