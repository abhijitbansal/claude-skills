// Regression tests for the beat detector's judgement calls, on synthetic drum-like audio built in memory (no ffmpeg).
// Each group is a failure the re-reviews found (octave errors, busy grooves failing the confidence gate, quiet sound
// trimmed as silence), written so it fails on the code that had the bug; test/beats.test.mjs covers the CLI and the click sweep.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectBeats, soundSpan } from '../scripts/lib/beats.mjs';
import { mulberry32 } from '../template/seeded.mjs';
import { SR, synth, grid, bar, nearestHit } from './helpers/beat-signals.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GATE = 0.5; // the CLI's default --min-confidence
const BEAT_TOLERANCE = 0.02;

// A case: a name, the clip, the true beat rate and the hits the beats should land on.
const kicks = (bpm, seconds, extra = []) => [...grid(bpm, seconds, { kind: 'kick', amp: 0.9 }), ...extra];
function read(c) {
  return { ...c, ...detectBeats(synth(c.seconds, c.events, { tone: c.tone })) };
}
const wrongTempo = (cases) => cases.map(read).filter((r) => Math.abs(r.bpm - r.truth) > 1).map((r) => `${r.name}: read ${r.bpm.toFixed(2)}, truth ${r.truth}`);

// --- octave choice -----------------------------------------------------------------------------------------------

test('ghost notes between the beats do not double the tempo (80, 90 and 100 BPM; ghosts at 0.4 and 0.6 of the kick)', () => {
  const cases = [80, 90, 100].flatMap((bpm) => [0.4, 0.6].map((ghost) => ({
    name: `kick ${bpm} + ghost 8ths ${ghost}`, seconds: 12, truth: bpm,
    events: [...grid(bpm, 12, { kind: 'noise', amp: 0.8 }), ...grid(bpm, 12, { offset: 30 / bpm, kind: 'noise', amp: ghost })],
  })));
  assert.deepEqual(wrongTempo(cases), []);
});

test('a kick on beats 1 and 3 over weak hats on every beat reads at the beat (100 and 120 BPM; from about 128 it reads at half, a documented limit pinned in beats-limits.test.mjs)', () => {
  const cases = [100, 120].map((bpm) => ({
    name: `kick 1&3 + hats ${bpm}`, seconds: 12, truth: bpm,
    events: [...grid(bpm, 12, { every: 2, kind: 'kick', amp: 0.9 }), ...grid(bpm, 12, { kind: 'click5', amp: 0.3 })],
  }));
  assert.deepEqual(wrongTempo(cases), []);
});

test('a rock groove (kick 1 and 3, snare 2 and 4, hats on the eighth notes) reads at the beat', () => {
  const cases = [85, 90, 100].flatMap((bpm) => [0.3, 0.6, 0.8].map((hat) => ({
    name: `rock ${bpm} hats ${hat}`, seconds: 12, truth: bpm,
    events: [...grid(bpm, 12, { every: 2, kind: 'kick', amp: 0.9 }), ...grid(bpm, 12, { every: 2, offset: 60 / bpm, kind: 'noise', amp: 0.9 }), ...grid(bpm * 2, 12, { kind: 'click5', amp: hat })],
  })));
  assert.deepEqual(wrongTempo(cases), []);
});

test('fast steady pulses stay fast: clicks at 175 to 200 BPM, and noise bursts, kicks and clicks at 80 to 140', () => {
  const clicks = [175, 180, 190, 195, 199, 200].map((bpm) => ({ name: `clicks ${bpm}`, seconds: 12, truth: bpm, events: grid(bpm, 12, { kind: 'click5' }) }));
  const drums = [80, 100, 120, 140].flatMap((bpm) => ['noise', 'kick'].map((kind) => ({ name: `${kind} ${bpm}`, seconds: 12, truth: bpm, events: grid(bpm, 12, { kind, amp: 0.9 }) })));
  assert.deepEqual(wrongTempo([...clicks, ...drums]), []);
});

// --- the grid lands on the kick, not on the hats --------------------------------------------------------------------

// How far, in seconds on average, the detected beats are from the nearest of `hits`.
const meanOff = (beats, hits) => beats.reduce((sum, b) => sum + nearestHit(b, hits), 0) / beats.length;

test('the grid lands on the kick when broadband hats sit on the off-beat: kick every beat at 88 to 176 BPM, hats at 0.5 and 0.7', () => {
  const problems = [];
  for (const bpm of [88, 100, 112, 128, 140, 160, 176]) {
    for (const hat of [0.5, 0.7]) {
      const kicksAt = grid(bpm, 14, { kind: 'kick', amp: 0.9 });
      const { bpm: read, beats } = detectBeats(synth(14, [...kicksAt, ...grid(bpm, 14, { offset: 30 / bpm, kind: 'hat', amp: hat })]));
      if (Math.abs(read - bpm) > 1) problems.push(`${bpm} + hats ${hat}: read ${read.toFixed(1)}`);
      else if (meanOff(beats, kicksAt) > 60 / bpm / 8) problems.push(`${bpm} + hats ${hat}: grid ${(meanOff(beats, kicksAt) * 1000).toFixed(0)} ms off the kicks`);
    }
  }
  assert.deepEqual(problems, []);
});

test('four-on-the-floor house with open hats on the off-beat and a clap on 2 and 4 lands on the kick (126 and 130 BPM, with and without 16th hats)', () => {
  const problems = [];
  for (const bpm of [126, 130]) {
    for (const sixteenths of [false, true]) {
      const open = [0.5, 1.5, 2.5, 3.5].map((pos) => [pos, 'ohat', 0.5]);
      const closed = sixteenths ? Array.from({ length: 16 }, (_, i) => [i * 0.25, 'hat', 0.25]) : [];
      const hits = bar(bpm, 14, 4, [[0, 'kick', 0.9], [1, 'kick', 0.9], [2, 'kick', 0.9], [3, 'kick', 0.9], [1, 'snare', 0.6], [3, 'snare', 0.6], ...open, ...closed]);
      const { bpm: read, beats } = detectBeats(synth(14, hits));
      const kicksAt = hits.filter((h) => h.kind === 'kick');
      if (Math.abs(read - bpm) > 1) problems.push(`house ${bpm}${sixteenths ? ' + 16ths' : ''}: read ${read.toFixed(1)}`);
      else if (meanOff(beats, kicksAt) > 60 / bpm / 8) problems.push(`house ${bpm}${sixteenths ? ' + 16ths' : ''}: grid ${(meanOff(beats, kicksAt) * 1000).toFixed(0)} ms off the kicks`);
    }
  }
  assert.deepEqual(problems, []);
});

// --- ratios other than two ---------------------------------------------------------------------------------------------

test('a tempo is not read at 2/3 or 3/4 of the beat: fast kicks over off-beat hats (156 to 180 BPM) and half-time grooves with 16th hats', () => {
  const fast = [156, 164, 172, 180].map((bpm) => ({
    name: `kick every beat ${bpm} + offbeat hats`, seconds: 14, truth: bpm,
    events: [...grid(bpm, 14, { kind: 'kick', amp: 0.9 }), ...grid(bpm, 14, { offset: 30 / bpm, kind: 'hat', amp: 0.5 })],
  }));
  const halfTime = [130, 136, 144].map((bpm) => ({
    name: `half-time ${bpm}`, seconds: 14, truth: bpm,
    events: bar(bpm, 14, 4, [[0, 'kick', 0.9], [2, 'snare', 0.9], [2.75, 'kick', 0.6], ...Array.from({ length: 16 }, (_, i) => [i * 0.25, 'hat', 0.3])]),
  }));
  const wrong = [...fast, ...halfTime].map(read).filter((r) => ![r.truth, r.truth / 2].some((x) => Math.abs(r.bpm - x) <= 1)).map((r) => `${r.name}: read ${r.bpm.toFixed(1)}`);
  assert.deepEqual(wrong, []);
});

test('a compound meter (6/8 with accents on 1 and 4) always reads some pulse, never nothing', () => {
  const problems = [];
  for (const eighths of [120, 135, 150, 165, 180]) {
    const hits = bar(eighths, 14, 6, [[0, 'kick', 0.9], [3, 'snare', 0.7], ...Array.from({ length: 6 }, (_, i) => [i, 'hat', 0.35])]);
    const { bpm, confidence, beats } = detectBeats(synth(14, hits));
    if (!(bpm >= 60 && bpm <= 200 && beats.length > 8 && confidence >= GATE)) problems.push(`6/8 eighths ${eighths}: read ${bpm.toFixed(1)}, ${beats.length} beats, confidence ${confidence.toFixed(2)}`);
  }
  assert.deepEqual(problems, []);
});

// --- a grid that slides is not a steady beat ---------------------------------------------------------------------------

test('a forced --bpm 1 to 4 % off the track fails the gate and reports the drift; the right tempo does not', () => {
  const problems = [];
  for (const [bpm, seconds, off] of [[100, 12, [102, 104, 98]], [96, 60, [96.5, 97, 94]], [133, 120, [133.2, 135]], [111, 30, [112, 114]]]) {
    const pcm = synth(seconds, grid(bpm, seconds));
    const right = detectBeats(pcm, { bpm });
    if (right.confidence < GATE || right.drift > 0.05) problems.push(`${bpm} forced right: confidence ${right.confidence.toFixed(2)}, drift ${right.drift.toFixed(2)}`);
    for (const forced of off) {
      const r = detectBeats(pcm, { bpm: forced });
      if (r.confidence >= GATE || r.drift <= 0.125) problems.push(`${bpm} forced ${forced}: confidence ${r.confidence.toFixed(2)}, drift ${r.drift.toFixed(2)} (should fail the gate)`);
    }
  }
  assert.deepEqual(problems, []);
});

test('a tempo that changes mid-track fails the gate when the grid slides (100 then 130 BPM)', () => {
  const change = detectBeats(synth(12, [...grid(100, 6), ...grid(130, 12, { from: 6 })]));
  assert.ok(change.drift > 0.125 && change.confidence < GATE, `100 then 130: drift ${change.drift.toFixed(2)}, confidence ${change.confidence.toFixed(2)}`);
});

test('a steady groove, a swing of 40 ms and a long steady track do not count as drift', () => {
  const swung = detectBeats(synth(10, grid(120, 10).map((e, i) => ({ ...e, t: e.t + (i % 2 ? 0.04 : 0) }))));
  assert.ok(swung.drift <= 0.125 && swung.confidence >= GATE, `swing 40 ms: drift ${swung.drift.toFixed(2)}, confidence ${swung.confidence.toFixed(2)}`);
  const steady = detectBeats(synth(60, grid(128, 60)));
  assert.ok(steady.drift <= 0.05, `60 s at 128 BPM: drift ${steady.drift.toFixed(2)}`);
});

// --- confidence --------------------------------------------------------------------------------------------------

test('a steady busy groove reaches the gate: kick on every beat with 16th-note hats at 120 and 128 BPM', () => {
  const cases = [[120, 0.5], [128, 0.5], [120, 0.3], [128, 0.3], [100, 0.5], [90, 0.4]].map(([bpm, hat]) => ({
    name: `kick ${bpm} + 16th hats ${hat}`, seconds: 12, truth: bpm,
    events: kicks(bpm, 12, grid(bpm * 4, 12, { kind: 'click5', amp: hat })),
  }));
  cases.push({ name: 'kick 120 + 16th noise hats 0.5', seconds: 12, truth: 120, events: kicks(120, 12, grid(480, 12, { kind: 'noise', amp: 0.5 })) });
  const reads = cases.map(read);
  assert.deepEqual(reads.filter((r) => Math.abs(r.bpm - r.truth) > 1).map((r) => `${r.name}: read ${r.bpm.toFixed(2)}`), []);
  assert.deepEqual(reads.filter((r) => r.confidence < GATE).map((r) => `${r.name}: confidence ${r.confidence.toFixed(2)}`), []);
});

test('clicks at 180 to 200 BPM keep a high confidence', () => {
  for (const bpm of [180, 190, 200]) {
    const { confidence } = detectBeats(synth(12, grid(bpm, 12, { kind: 'click5' })));
    assert.ok(confidence >= 0.8, `${bpm} BPM: confidence ${confidence.toFixed(2)}`);
  }
});

test('white noise stays below the gate for every seed, at 4, 8 and 30 s', () => {
  const noise = (seconds, seed) => {
    const next = mulberry32(seed);
    return Float32Array.from({ length: seconds * SR }, () => (next() * 2 - 1) * 0.6);
  };
  const worst = [];
  for (const [seconds, seeds] of [[4, 20], [8, 12], [30, 4]]) {
    for (let seed = 1; seed <= seeds; seed++) {
      const { confidence, bpm } = detectBeats(noise(seconds, seed));
      if (confidence >= GATE) worst.push(`${seconds} s seed ${seed}: confidence ${confidence.toFixed(2)}`);
      assert.ok(bpm >= 60 && bpm <= 200, `${seconds} s seed ${seed}: bpm ${bpm}`);
    }
  }
  assert.deepEqual(worst, []);
});

test('a forced --bpm on white noise stays below the gate for every seed and tempo, at 4, 8 and 30 s', () => {
  const passed = [];
  for (const [seconds, seeds] of [[4, 20], [8, 12], [30, 2]]) {
    for (let seed = 1; seed <= seeds; seed++) {
      const next = mulberry32(seed);
      const pcm = Float32Array.from({ length: seconds * SR }, () => (next() * 2 - 1) * 0.6);
      for (const bpm of [66, 95, 120, 181]) {
        const { confidence } = detectBeats(pcm, { bpm });
        if (confidence >= GATE) passed.push(`${seconds} s seed ${seed} --bpm ${bpm}: confidence ${confidence.toFixed(2)}`);
      }
    }
  }
  assert.deepEqual(passed, []);
});

// --- the grid covers the sound, not the loudest hit ----------------------------------------------------------------

const TRIM_CASES = [
  { name: '2 s at 0.1 then 0.8', seconds: 10, events: grid(120, 10, { ampAt: (t) => (t < 2 ? 0.1 : 0.8) }), sound: [0, 9.5] },
  { name: '2 s at 0.15 then 0.8', seconds: 10, events: grid(120, 10, { ampAt: (t) => (t < 2 ? 0.15 : 0.8) }), sound: [0, 9.5] },
  { name: '2 s at 0.25 then 0.8', seconds: 10, events: grid(120, 10, { ampAt: (t) => (t < 2 ? 0.25 : 0.8) }), sound: [0, 9.5] },
  { name: 'linear fade-in over 4 s', seconds: 10, events: grid(120, 10, { ampAt: (t) => Math.min(0.8, (0.8 * t) / 4 + 0.01) }), sound: [0, 9.5] },
  { name: 'fade-out over the last 4 s', seconds: 10, events: grid(120, 10, { ampAt: (t) => Math.min(0.8, (0.8 * (10 - t)) / 4) }), sound: [0, 9.5] },
  { name: 'one loud hit at 5 s over clicks at 0.15', seconds: 10, events: grid(120, 10, { ampAt: (t) => (Math.abs(t - 5) < 0.01 ? 0.8 : 0.15) }), sound: [0, 9.5] },
  { name: 'silent for 3 s, then clicks', seconds: 12, events: grid(120, 12, { from: 3 }), sound: [3, 11.5] },
  { name: '8 s of clicks, then 4 s of silence', seconds: 12, events: grid(120, 8), sound: [0, 7.5] },
  { name: 'clicks from 0.3 s', seconds: 8, events: grid(120, 8, { from: 0.3 }), sound: [0.3, 7.8] },
  { name: 'clicks from 0.02 s', seconds: 8, events: grid(120, 8, { from: 0.02 }), sound: [0.02, 7.52] },
  { name: 'a 2 s break in the middle', seconds: 12, events: grid(120, 12).filter((e) => e.t < 5 || e.t > 7), sound: [0, 11.5], gap: [5, 7] }, // the grid runs on through a break, so beat n stays the song's nth pulse
  { name: 'room tone under a silent intro', seconds: 12, events: grid(120, 12, { from: 3 }), sound: [3, 11.5], tone: 0.004 },
];

test('beat 0 is the first sounding beat and the last beat the last: quiet intros, fades and silence', () => {
  const problems = [];
  for (const c of TRIM_CASES) {
    const { beats } = read({ ...c, truth: 120 });
    if (!beats.length) { problems.push(`${c.name}: no beats`); continue; }
    if (Math.abs(beats[0] - c.sound[0]) > 0.06) problems.push(`${c.name}: first beat ${beats[0]}, first sound ${c.sound[0]}`);
    if (Math.abs(beats.at(-1) - c.sound[1]) > 0.06) problems.push(`${c.name}: last beat ${beats.at(-1)}, last sound ${c.sound[1]}`);
    const off = Math.max(...beats.filter((b) => !c.gap || b < c.gap[0] - 0.1 || b > c.gap[1] + 0.1).map((b) => nearestHit(b, c.events)));
    if (off > BEAT_TOLERANCE) problems.push(`${c.name}: a beat is ${(off * 1000).toFixed(0)} ms from a hit`);
  }
  assert.deepEqual(problems, []);
});

test('soundSpan: digital silence has none, and the loudest hit does not move the floor', () => {
  assert.equal(soundSpan(new Float32Array(SR * 3)), null);
  assert.equal(soundSpan(new Float32Array(100)), null);
  const quiet = synth(6, grid(120, 6, { amp: 0.05 }));
  const loud = synth(6, grid(120, 6, { ampAt: (t) => (Math.abs(t - 3) < 0.01 ? 0.9 : 0.05) }));
  assert.equal(soundSpan(loud).first, soundSpan(quiet).first);
  assert.equal(soundSpan(loud).last, soundSpan(quiet).last);
});

test('a clip of silence gives no beats, never an error', () => {
  assert.deepEqual(detectBeats(new Float32Array(SR * 4)), { bpm: 0, confidence: 0, confidenceBeforeDrift: 0, drift: 0, beats: [] });
});

// --- long tracks ---------------------------------------------------------------------------------------------------

test('a long track keeps its grid: 128 BPM for 120 s and 300 s stay within 20 ms of the clicks to the end', () => {
  for (const seconds of [120, 300]) {
    const hits = grid(128, seconds);
    const { bpm, beats } = detectBeats(synth(seconds, hits));
    assert.ok(Math.abs(bpm - 128) <= 0.05, `${seconds} s: read ${bpm}`);
    const worst = Math.max(...beats.map((b) => nearestHit(b, hits)));
    assert.ok(worst <= BEAT_TOLERANCE, `${seconds} s: worst beat ${(worst * 1000).toFixed(0)} ms from a click`);
  }
});

// --- the user override --------------------------------------------------------------------------------------------

// An octave the detector gets the wrong way for a track this slow (70 BPM kick, ghost eighth notes at 0.6): 140 is as
// periodic and sits nearer the prior. Nothing in the audio settles it, so the caller can.
const slowGroove = () => synth(12, [...grid(70, 12, { kind: 'noise', amp: 0.8 }), ...grid(70, 12, { offset: 30 / 70, kind: 'noise', amp: 0.6 })]);

test('--min-bpm and --max-bpm narrow the search; the tempo they exclude cannot be read', () => {
  const pcm = slowGroove();
  const free = detectBeats(pcm);
  assert.ok(Math.abs(free.bpm - 140) <= 1, `unconstrained: ${free.bpm}`); // the ambiguity the override exists for
  const narrowed = detectBeats(pcm, { minBpm: 60, maxBpm: 100 });
  assert.ok(Math.abs(narrowed.bpm - 70) <= 1, `max 100: ${narrowed.bpm}`);
  assert.ok(narrowed.confidence >= GATE, `confidence ${narrowed.confidence}`);
  const clicks = synth(12, grid(160, 12));
  assert.ok(detectBeats(clicks, { minBpm: 60, maxBpm: 120 }).bpm <= 120);
  assert.ok(detectBeats(clicks, { minBpm: 150, maxBpm: 200 }).bpm >= 150);
});

test('--bpm forces the grid at that tempo and reports the fit as the confidence', () => {
  const hits = [...grid(70, 12, { kind: 'noise', amp: 0.8 }), ...grid(70, 12, { offset: 30 / 70, kind: 'noise', amp: 0.6 })];
  const forced = detectBeats(synth(12, hits), { bpm: 70 });
  assert.equal(forced.bpm, 70);
  assert.ok(forced.beats.length >= 13, `${forced.beats.length} beats`);
  assert.ok(forced.confidence >= GATE, `confidence of the right tempo ${forced.confidence}`);
  const kicks70 = hits.filter((h) => h.amp === 0.8);
  assert.ok(Math.max(...forced.beats.map((b) => nearestHit(b, kicks70))) <= BEAT_TOLERANCE, 'the forced grid sits on the kicks');
  const spacing = forced.beats.slice(2).map((b, i) => b - forced.beats[i + 1]);
  assert.ok(spacing.every((x) => Math.abs(x - 60 / 70) < 0.0025), 'a forced grid is a steady grid');
  const wrong = detectBeats(synth(12, grid(120, 12)), { bpm: 90 });
  assert.equal(wrong.bpm, 90);
  assert.ok(wrong.confidence < GATE, `confidence of a wrong tempo ${wrong.confidence}`);
  const near = detectBeats(synth(12, grid(120, 12)), { bpm: 130 }); // 8 % off: a grid at 130 drifts off every click
  assert.ok(near.confidence < GATE, `confidence of a tempo 8 % off ${near.confidence}`);
  const double = detectBeats(synth(12, grid(120, 12)), { bpm: 240 }); // every other beat on silence: no drift, but no fit
  assert.ok(double.confidence < GATE, `confidence of double the tempo ${double.confidence}`);
  const half = detectBeats(synth(12, grid(120, 12)), { bpm: 60 }); // every beat on a click
  assert.ok(half.confidence >= GATE, `confidence of half the tempo ${half.confidence}`);
});

// --- the docs describe what the detector does ---------------------------------------------------------------------

test('schema.md quotes the numbers of the committed example beats file', () => {
  const beats = JSON.parse(readFileSync(path.join(root, 'references/examples/data/on-the-beat.beats.json'), 'utf8'));
  const schema = readFileSync(path.join(root, 'references/schema.md'), 'utf8');
  assert.ok(schema.includes(`"bpm": ${beats.bpm}, "confidence": ${beats.confidence}`), `schema.md should show "bpm": ${beats.bpm}, "confidence": ${beats.confidence}`);
  assert.ok(schema.includes(`${beats.bpm} BPM, ${beats.beats.length} beats`), `schema.md should show "${beats.bpm} BPM, ${beats.beats.length} beats"`);
});

test('schema.md and SKILL.md name the tempo flags and the known limits', () => {
  const schema = readFileSync(path.join(root, 'references/schema.md'), 'utf8');
  const skill = readFileSync(path.join(root, 'SKILL.md'), 'utf8');
  for (const text of [schema, skill]) {
    for (const flag of ['--bpm', '--min-bpm', '--max-bpm']) assert.ok(text.includes(flag), `${flag} is documented`);
  }
  for (const limit of ['swing', 'tempo change']) assert.ok(schema.includes(limit), `schema.md names the limit: ${limit}`);
});
