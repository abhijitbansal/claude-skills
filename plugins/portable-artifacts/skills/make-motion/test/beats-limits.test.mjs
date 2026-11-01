// The beat detector's documented limits (references/schema.md, "Known limits") and the flags that fix them, measured on
// the third review's own audio (test/helpers/beat-grooves.mjs) and on the helper synthesis (test/helpers/beat-signals.mjs).
// The tempo estimator is not tuned here: these tests pin where each limit is and that its documented fix works.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectBeats } from '../scripts/lib/beats.mjs';
import { mulberry32 } from '../template/seeded.mjs';
import { groove, kickOneAndThree } from './helpers/beat-grooves.mjs';
import { SR, synth, grid, bar } from './helpers/beat-signals.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GATE = 0.5; // the CLI's default --min-confidence
const BEAT_TOLERANCE = 0.02;
const OFF = [1.03, 0.97]; // a --bpm 3 % off the track
const near = (bpm, truth) => Math.abs(bpm - truth) <= truth * 0.01;
// The documented range advice: --min-bpm and --max-bpm from about 0.8 to 1.25 times the tempo you hear.
const rangeFor = (heard) => ({ minBpm: Math.round(heard * 0.8), maxBpm: Math.round(heard * 1.25) });
// How far (seconds) the farthest beat is from the true grid; every case has a beat at t = 0.
const worstBeat = (beats, truth) => Math.max(...beats.map((b) => {
  const period = 60 / truth;
  return Math.abs(b - Math.round(b / period) * period);
}));
const helperKickOneAndThree = (bpm) => synth(12, [...grid(bpm, 12, { every: 2, kind: 'kick', amp: 0.9 }), ...grid(bpm, 12, { kind: 'click5', amp: 0.3 })]);
const rock = (bpm) => synth(12, [...grid(bpm, 12, { every: 2, kind: 'kick', amp: 0.9 }), ...grid(bpm, 12, { every: 2, offset: 60 / bpm, kind: 'noise', amp: 0.9 }), ...grid(bpm * 2, 12, { kind: 'click5', amp: 0.35 })]);

// The review's misreads: auto detection reads these at half (bossa, a kick on 1 and 3), at 2/3 (polka) or refuses them
// (rim clicks under heavy pink noise).
const MISREADS = [
  { name: 'bossa 124', truth: 124, pcm: () => groove('bossa 124') },
  { name: 'bossa 138', truth: 138, pcm: () => groove('bossa 138') },
  { name: 'polka 134 + snare on the ands', truth: 134, pcm: () => groove('polka 134 + snare on the ands') },
  { name: 'kick on 1 and 3 at 124', truth: 124, pcm: () => kickOneAndThree(124) },
  { name: 'kick on 1 and 3 at 140', truth: 140, pcm: () => kickOneAndThree(140) },
  { name: 'rim clicks 186 + pink noise 0.3', truth: 186, pcm: () => groove('clicks 186 + pink 0.3') },
];

test('--bpm at the right tempo passes the gate with every beat within 20 ms, on each documented misread', () => {
  const problems = [];
  for (const c of MISREADS) {
    const { confidence, beats } = detectBeats(c.pcm(), { bpm: c.truth });
    if (confidence < GATE) problems.push(`${c.name} --bpm ${c.truth}: confidence ${confidence.toFixed(2)}`);
    else if (worstBeat(beats, c.truth) > BEAT_TOLERANCE) problems.push(`${c.name} --bpm ${c.truth}: a beat ${(worstBeat(beats, c.truth) * 1000).toFixed(0)} ms off`);
  }
  assert.deepEqual(problems, []);
});

test('--bpm 3 % off the right tempo fails the gate on each of them', () => {
  const problems = [];
  for (const c of MISREADS) {
    const pcm = c.pcm();
    for (const k of OFF) {
      const { confidence } = detectBeats(pcm, { bpm: c.truth * k });
      if (confidence >= GATE) problems.push(`${c.name} --bpm ${(c.truth * k).toFixed(2)}: confidence ${confidence.toFixed(2)} passes`);
    }
  }
  assert.deepEqual(problems, []);
});

test('the documented range (0.8 to 1.25 times the tempo heard) recovers each half, 2/3 and double read and passes the gate', () => {
  const cases = [
    ...MISREADS.filter((c) => !c.name.startsWith('rim')),
    ...[150, 168, 192].map((truth) => ({ name: `rock ${truth}`, truth, pcm: () => rock(truth) })),
    { name: '6/8 at a dotted quarter of 50', truth: 50, pcm: () => synth(14, bar(150, 14, 6, [[0, 'kick', 0.9], [3, 'snare', 0.7], ...Array.from({ length: 6 }, (_, i) => [i, 'hat', 0.35])])) },
    { name: 'clicks at 50 (below the default search)', truth: 50, pcm: () => synth(14, grid(50, 14)) },
  ];
  const problems = [];
  for (const c of cases) {
    const pcm = c.pcm();
    const auto = detectBeats(pcm);
    const fixed = detectBeats(pcm, rangeFor(c.truth));
    if (near(auto.bpm, c.truth)) problems.push(`${c.name}: auto already reads ${auto.bpm.toFixed(2)}; not a limit case`);
    if (!near(fixed.bpm, c.truth) || fixed.confidence < GATE) problems.push(`${c.name} with --min-bpm ${rangeFor(c.truth).minBpm} --max-bpm ${rangeFor(c.truth).maxBpm}: ${fixed.bpm.toFixed(2)} at ${fixed.confidence.toFixed(2)}`);
  }
  assert.deepEqual(problems, []);
});

test('rim clicks under heavy pink noise are refused, not misread, with or without a range; --bpm is the fix', () => {
  const pcm = groove('clicks 186 + pink 0.3');
  for (const opts of [{}, rangeFor(186)]) {
    const { bpm, confidence } = detectBeats(pcm, opts);
    assert.ok(confidence < GATE, `${JSON.stringify(opts)}: read ${bpm.toFixed(2)} at ${confidence.toFixed(2)} passes the gate`);
  }
});

test('the kick-on-1-and-3 limit starts where the docs say: from about 115 BPM with a soft kick, about 125 with a clickier one', () => {
  const read = (pcm) => detectBeats(pcm).bpm;
  const problems = [];
  for (const [label, make, beatUpTo, halfFrom] of [['soft kick', kickOneAndThree, 112, 120], ['clickier kick', helperKickOneAndThree, 124, 128]]) {
    for (let bpm = 100; bpm <= 148; bpm += 4) {
      const got = read(make(bpm));
      if (bpm <= beatUpTo && !near(got, bpm)) problems.push(`${label} ${bpm}: read ${got.toFixed(2)}, expected the beat`);
      if (bpm >= halfFrom && !near(got, bpm / 2)) problems.push(`${label} ${bpm}: read ${got.toFixed(2)}, expected half (${bpm / 2})`);
    }
  }
  assert.deepEqual(problems, []);
});

test('narration-like syllables can pass the default gate, and --min-confidence 0.6 refuses every seed', () => {
  const confidences = [];
  for (let seed = 1; seed <= 30; seed++) {
    const next = mulberry32(3000 + seed);
    const pcm = new Float32Array(10 * SR);
    for (let t = 0; t < 9.8; t += 0.15 + next() * 0.2) {
      const start = Math.round(t * SR);
      const amp = 0.3 + next() * 0.5;
      for (let i = 0; i < 0.3 * SR && start + i < pcm.length; i++) pcm[start + i] += amp * Math.sin((2 * Math.PI * (150 + 100 * next()) * i) / SR) * Math.exp(-i / (0.05 * SR));
    }
    confidences.push(detectBeats(pcm).confidence);
  }
  assert.ok(confidences.some((c) => c >= GATE), 'the limit exists: some narration passes 0.5');
  assert.ok(Math.max(...confidences) < 0.6, `the fix works: highest ${Math.max(...confidences).toFixed(3)}`);
});

test('schema.md and SKILL.md name every known limit with the flag that fixes it', () => {
  const schema = readFileSync(path.join(root, 'references/schema.md'), 'utf8');
  const skill = readFileSync(path.join(root, 'SKILL.md'), 'utf8');
  for (const [name, text] of [['schema.md', schema], ['SKILL.md', skill]]) {
    for (const words of ['bossa', 'polka', '2/3', 'from about 115', '6/8', 'below 60', 'swing', 'ritardando', 'narration', 'heavy noise', '0.8 to 1.25 times', '--min-confidence 0.6', '--bpm', '--min-bpm', '--max-bpm']) {
      assert.ok(text.includes(words), `${name} names: ${words}`);
    }
    assert.ok(!text.includes('from about 140'), `${name} no longer says the kick-on-1-and-3 limit starts at 140`);
  }
});
