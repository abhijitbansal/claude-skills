// What the synthesised cues sound like, measured on their samples: layered cues (transient, body, tail), pink noise,
// stereo width above 120 Hz, pitch falls, the FM alias limits at the top of the keyboard. cue-synth.test.mjs pins the bytes
// by hash; this file keeps the acoustic bars that say the bytes are the right ones. They moved here from version 1's
// test/cues-v2.test.mjs when version 1 was deleted (cut-over Task 3); nothing was loosened.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CUE_LAYERS, SAMPLE_RATE, FM_CLICK_RATIO, MAX_HZ, cueWav, fmBand, layerCue, levelled, noteHz, pinkNoise } from '../../scripts/v2/sound/cue-synth.mjs';
import { mulberry32 } from '../../engine/seeded.mjs';
import { bandEnergy, spectralCentroid, zeroCrossingRate, rms, pitchAt } from '../helpers/spectrum.mjs';

const TYPING_SECONDS_PER_CHAR = 0.035; // the typing spacing cueWav uses when a caller names none
const CUE_NAMES = [...Object.keys(CUE_LAYERS), 'typing'];

// 16-bit stereo PCM -> left and right sample arrays in -1..1.
function channels(buf) {
  const data = buf.subarray(44);
  const left = []; const right = [];
  for (let i = 0; i < data.length; i += 4) {
    left.push(data.readInt16LE(i) / 32768);
    right.push(data.readInt16LE(i + 2) / 32768);
  }
  return { left, right };
}
// The samples between fractions `from` and `to` of the cue's length.
const part = (xs, from, to) => xs.slice(Math.round(xs.length * from), Math.round(xs.length * to));
const seconds = (xs, from, to) => xs.slice(Math.round(from * SAMPLE_RATE), Math.round(to * SAMPLE_RATE));

const STEREO = ['whoosh', 'swoosh', 'riser'];

test('the ten cues are the nine layered ones and typing', () => {
  assert.equal(CUE_NAMES.length, 10);
  assert.ok(CUE_NAMES.includes('typing') && CUE_NAMES.includes('pop'));
});

test('whoosh, swoosh and riser differ between channels at pan 0; pop, click, chime, impact, typing, drop and ding are identical in both', () => {
  for (const cue of CUE_NAMES) {
    const { left, right } = channels(cueWav({ cue, pan: 0 }));
    if (STEREO.includes(cue)) assert.notDeepEqual(left, right, `${cue} is widened`);
    else assert.deepEqual(left, right, `${cue} is mono`);
  }
});

test('pinkNoise: band energy 200–400 Hz over 1600–3200 Hz is between 0.5 and 2 (the white source gives about 0.125)', () => {
  const WARMUP = 8192; // the slowest pole (0.99765) settles in a few thousand samples
  const ratio = (next) => {
    for (let i = 0; i < WARMUP; i++) next();
    let low = 0; let high = 0;
    for (let w = 0; w < 4; w++) { // four windows, so one unlucky window cannot decide it
      const xs = Array.from({ length: 4096 }, next);
      low += bandEnergy(xs, SAMPLE_RATE, 200, 400);
      high += bandEnergy(xs, SAMPLE_RATE, 1600, 3200);
    }
    return low / high;
  };
  const white = mulberry32(7);
  const pink = ratio(pinkNoise(mulberry32(7)));
  const flat = ratio(() => white() * 2 - 1);
  assert.ok(pink >= 0.5 && pink <= 2, `pink ratio ${pink}`);
  assert.ok(flat > 0.06 && flat < 0.25, `the measure tells white from pink: white ratio ${flat}`);
});

test('whoosh: spectral centroid of the first 20 % is below 1 kHz and of the middle 20 % above 2.5 kHz', () => {
  const { left } = channels(cueWav({ cue: 'whoosh' }));
  const early = spectralCentroid(part(left, 0, 0.2), SAMPLE_RATE);
  const middle = spectralCentroid(part(left, 0.4, 0.6), SAMPLE_RATE);
  assert.ok(early < 1000, `first 20 %: ${early} Hz`);
  assert.ok(middle > 2500, `middle 20 %: ${middle} Hz`);
});

// The pitch of the first whole cycle at or after `from` seconds (a noise burst can hide the cycles before it).
function firstPitch(xs, from) {
  for (let t = from; t < from + 0.05; t += 0.001) {
    const hz = pitchAt(xs, SAMPLE_RATE, t);
    if (Number.isFinite(hz)) return hz;
  }
  return Number.NaN;
}

test('impact: pitch just after the 8 ms noise burst is at least 2.5× where it settles, and it has settled (within 10 %) by 100 ms', () => {
  const { left } = channels(cueWav({ cue: 'impact' }));
  const onset = firstPitch(left, 0.01);
  const at100 = pitchAt(left, SAMPLE_RATE, 0.1);
  const settled = pitchAt(left, SAMPLE_RATE, 0.3);
  assert.ok(onset >= 2.5 * settled, `onset ${onset} Hz, settled ${settled} Hz: a fall of ${(onset / settled).toFixed(2)}×`);
  assert.ok(Math.abs(at100 / settled - 1) < 0.1, `100 ms ${at100} Hz against ${settled} Hz`);
});

test('drop: falls about an octave (1.4–2.1× measured just after its 5 ms click) and has settled (within 3 %) by 80 ms', () => {
  const { left } = channels(cueWav({ cue: 'drop' }));
  const onset = firstPitch(left, 0.006);
  const at80 = pitchAt(left, SAMPLE_RATE, 0.08);
  const settled = pitchAt(left, SAMPLE_RATE, 0.3);
  assert.ok(onset >= 1.4 * settled && onset <= 2.1 * settled, `onset ${onset} Hz, settled ${settled} Hz`);
  assert.ok(Math.abs(at80 / settled - 1) < 0.03, `80 ms ${at80} Hz against ${settled} Hz`);
});

test('ding: a partial near 2.76 × f0, at least 10× the energy of the band between 2.2 and 2.5 × f0', () => {
  const f0 = noteHz('E6');
  const { left } = channels(cueWav({ cue: 'ding' }));
  const head = seconds(left, 0, 0.1);
  const partial = bandEnergy(head, SAMPLE_RATE, 2.66 * f0, 2.86 * f0);
  const between = bandEnergy(head, SAMPLE_RATE, 2.2 * f0, 2.5 * f0);
  assert.ok(partial >= 10 * between, `2.76 × f0 band ${partial}, 2.2–2.5 × f0 band ${between}`);
});

test('swoosh: the spectral centroid of its middle third is above both outer thirds (it opens and closes)', () => {
  const { left } = channels(cueWav({ cue: 'swoosh' }));
  const [first, middle, last] = [0, 1, 2].map((k) => spectralCentroid(part(left, k / 3, (k + 1) / 3), SAMPLE_RATE));
  assert.ok(middle > first && middle > last, `thirds: ${first}, ${middle}, ${last} Hz`);
});

test('pop, chime, impact and ding have a reverb tail: the tail adds between -30 and -6 dB of the dry sound', () => {
  for (const cue of ['pop', 'chime', 'impact', 'ding']) {
    const def = CUE_LAYERS[cue];
    const f0 = noteHz({ pop: 'E5', chime: 'A5', impact: 'F2', ding: 'E6' }[cue]);
    const wet = layerCue(def, f0, mulberry32(1)).left;
    const dry = layerCue({ ...def, tail: undefined }, f0, mulberry32(1)).left;
    const db = 20 * Math.log10(rms(wet.map((x, i) => x - dry[i])) / rms(dry));
    assert.ok(db > -30 && db < -6, `${cue}: tail at ${db.toFixed(1)} dB`);
  }
});

test('at C8 every FM click stays at or below 0.4 × the sample rate, and every pitched cue still renders at full peak', () => {
  const c8 = noteHz('C8');
  for (const [cue, ratio] of Object.entries(FM_CLICK_RATIO)) {
    const band = fmBand(ratio * c8);
    assert.ok(band.topHz <= MAX_HZ + 1e-9, `${cue}: FM reaches ${band.topHz} Hz`);
  }
  assert.equal(MAX_HZ, 0.4 * SAMPLE_RATE);
  assert.ok(fmBand(1000).index === 5 && fmBand(1000).topHz <= MAX_HZ, 'a low click keeps its full index');
  for (const cue of ['pop', 'chime', 'impact', 'drop', 'ding']) {
    const { left } = channels(cueWav({ cue, note: 'C8' }));
    const top = left.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
    assert.ok(left.every(Number.isFinite) && Math.abs(top - 0.5) < 0.01, `${cue} at C8 peaks at ${top}`);
  }
});

// The onset (first 10 ms) of a cue, zero-padded in front so the Hann window centres on the attack, not on its tail.
const ONSET = Math.round(0.01 * SAMPLE_RATE);
const onsetWindow = (xs) => [...new Array(ONSET).fill(0), ...xs.slice(0, ONSET)];
const ALIAS_BAR = 3e-4; // measured: about 4e-5 with the clamp, 7e-4 to 1.2e-2 with the raw carrier and index 5

test('the FM attack of pop, drop and ding at C8 and B8 puts under 3e-4 of its onset energy above 0.4 × the sample rate', () => {
  for (const note of ['C8', 'B8']) {
    for (const cue of Object.keys(FM_CLICK_RATIO)) {
      const xs = onsetWindow(channels(cueWav({ cue, note })).left);
      const above = bandEnergy(xs, SAMPLE_RATE, MAX_HZ, SAMPLE_RATE / 2 + 1) / bandEnergy(xs, SAMPLE_RATE, 0, SAMPLE_RATE / 2 + 1);
      assert.ok(above < ALIAS_BAR, `${cue} at ${note}: ${above} of the onset energy is above ${MAX_HZ} Hz`);
    }
  }
});

const BODY_ALIAS_BAR = 1e-3; // measured: at most 2e-5 with the partial and glide clamps, 2.5e-2 to 6.8e-2 without them

test('at B8 chime, impact and ding put under 1e-3 of their first 4096 samples (85 ms) above 0.4 × the sample rate', () => {
  for (const cue of ['chime', 'impact', 'ding']) {
    const xs = channels(cueWav({ cue, note: 'B8' })).left.slice(0, 4096);
    const above = bandEnergy(xs, SAMPLE_RATE, MAX_HZ, SAMPLE_RATE / 2 + 1) / bandEnergy(xs, SAMPLE_RATE, 0, SAMPLE_RATE / 2 + 1);
    assert.ok(above < BODY_ALIAS_BAR, `${cue} at B8: ${above} of the energy is above ${MAX_HZ} Hz`);
  }
});

test('levelled: a silent input stays silent (no 0/0 NaN)', () => {
  assert.deepEqual(levelled(new Float64Array(8)), [0, 0, 0, 0, 0, 0, 0, 0]);
});

test('pop: a small pitch drop, so the zero-crossing rate over 10–30 ms is under 1.15× the rate over 60–80 ms (the old pop fell an octave: 1.36)', () => {
  const { left } = channels(cueWav({ cue: 'pop' }));
  const early = zeroCrossingRate(seconds(left, 0.01, 0.03), SAMPLE_RATE);
  const late = zeroCrossingRate(seconds(left, 0.06, 0.08), SAMPLE_RATE);
  assert.ok(early < 1.15 * late, `10–30 ms ${early}/s, 60–80 ms ${late}/s`);
});

test('click: spectral centroid between 2 and 8 kHz, a tick rather than hiss (the old click: about 15.9 kHz)', () => {
  const { left } = channels(cueWav({ cue: 'click' }));
  const centroid = spectralCentroid(left, SAMPLE_RATE);
  assert.ok(centroid > 2000 && centroid < 8000, `${centroid} Hz`);
});

test('riser: rms of the last 10 % is at least 4× the first 10 %', () => {
  const { left } = channels(cueWav({ cue: 'riser' }));
  const first = rms(part(left, 0, 0.1));
  const last = rms(part(left, 0.9, 1));
  assert.ok(last >= 4 * first, `first ${first}, last ${last}`);
});

// Onsets: 5 ms windows whose peak is a local maximum above 30 % of the loudest; the time is that window's loudest sample.
function transients(xs) {
  const W = Math.round(0.005 * SAMPLE_RATE);
  const env = Array.from({ length: Math.ceil(xs.length / W) }, (_, w) => {
    let best = 0; let at = w * W;
    for (let i = w * W; i < Math.min(xs.length, (w + 1) * W); i++) if (Math.abs(xs[i]) > best) { best = Math.abs(xs[i]); at = i; }
    return { best, at };
  });
  const top = Math.max(...env.map((e) => e.best));
  return env.filter((e, w) => e.best >= 0.3 * top && e.best > (env[w - 1]?.best ?? 0) && e.best >= (env[w + 1]?.best ?? 0)).map((e) => e.at / SAMPLE_RATE);
}

test('typing with chars 12: twelve transients 0.035 s apart (peaks over a 5 ms window) and 0.47 s long', () => {
  const { left } = channels(cueWav({ cue: 'typing', chars: 12 }));
  const onsets = transients(left);
  assert.equal(onsets.length, 12, `onsets at ${onsets.map((s) => s.toFixed(4)).join(', ')}`);
  onsets.slice(1).forEach((s, i) => assert.ok(Math.abs(s - onsets[i] - TYPING_SECONDS_PER_CHAR) < 0.002, `gap ${i}: ${s - onsets[i]}`));
  assert.ok(Math.abs(left.length / SAMPLE_RATE - 0.47) < 1 / SAMPLE_RATE + 1e-9, `${left.length / SAMPLE_RATE} s`);
});

test('a typing cue with a zero count still makes one click, never a 0/0 level', () => {
  assert.ok(cueWav({ cue: 'typing', chars: 0 }).length > 44);
});
