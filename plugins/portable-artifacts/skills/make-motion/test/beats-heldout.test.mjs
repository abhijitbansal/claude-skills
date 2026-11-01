// HELD-OUT generalisation set for the beat detector: 60 cases of drum-like audio (rock, four-on-the-floor house,
// reggae, drum and bass, trap, waltz, 6/8, noise under clicks) that were written by a reviewer who had not seen the
// detector's tuning set. The detector's parameters are tuned only on test/beats-regression.test.mjs; this file is run to
// measure, never to tune. Acceptance bar (ruling R34): tempo wrong in at most 10 % of the cases, and the grid off the beat
// in at most 10 % of the cases whose tempo is right; a read at half or double tempo counts as right where the docs name it
// a known limit (below 75 or above 148 BPM, reggae one-drop, half-time trap), and 6/8, a compound meter the
// detector does not claim to read, is counted apart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectBeats } from '../scripts/lib/beats.mjs';

const SR = 22050;
const mulberry32 = (a) => () => {
  a |= 0; a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const rand = mulberry32(2026); // one stream, drawn in case order, as the reviewer's probe drew it

function hitSample(kind, i) {
  switch (kind) {
    case 'click': return i < 0.005 * SR ? Math.sin((2 * Math.PI * 1000 * i) / SR) : 0;
    case 'kick': return Math.sin(2 * Math.PI * (55 + 120 * Math.exp(-i / (0.012 * SR))) * i / SR) * Math.exp(-i / (0.06 * SR));
    case 'snare': return ((rand() * 2 - 1) * 0.7 + 0.3 * Math.sin(2 * Math.PI * 190 * i / SR)) * Math.exp(-i / (0.04 * SR));
    case 'hat': return (rand() * 2 - 1) * Math.exp(-i / (0.008 * SR));
    case 'ohat': return (rand() * 2 - 1) * Math.exp(-i / (0.07 * SR));
    case 'rim': return Math.sin(2 * Math.PI * 1700 * i / SR) * Math.exp(-i / (0.006 * SR));
    case 'chord': return (Math.sin(2 * Math.PI * 330 * i / SR) + Math.sin(2 * Math.PI * 415 * i / SR) + Math.sin(2 * Math.PI * 494 * i / SR)) / 3 * Math.exp(-i / (0.05 * SR));
    default: throw new Error(kind);
  }
}
function render(seconds, hits, { noise = 0 } = {}) {
  const pcm = new Float32Array(Math.round(seconds * SR));
  for (const { t, kind, amp } of hits) {
    const s = Math.round(t * SR);
    for (let i = 0; i < 0.3 * SR && s + i < pcm.length; i++) pcm[s + i] += amp * hitSample(kind, i);
  }
  if (noise) for (let i = 0; i < pcm.length; i++) pcm[i] += noise * (rand() * 2 - 1);
  return pcm;
}
// A bar pattern: [[beat position, kind, amp], ...] repeated every `beatsPerBar` beats.
function pattern(bpm, seconds, beatsPerBar, notes) {
  const out = [];
  const beat = 60 / bpm;
  for (let bar = 0; bar * beatsPerBar * beat < seconds; bar++) {
    for (const [pos, kind, amp] of notes) {
      const t = (bar * beatsPerBar + pos) * beat;
      if (t < seconds - 0.05) out.push({ t, kind, amp });
    }
  }
  return out;
}
const eighths = (kind, amp, n = 8, step = 0.5) => Array.from({ length: n }, (_, i) => [i * step, kind, amp]);

const S = 14;
const cases = []; // { group, name, truth, octaves, hits, noise }
const add = (group, name, truth, hits, { octaves = [], noise } = {}) => cases.push({ group, name, truth, octaves, hits, noise });
// Documented octave limits, declared by tempo and by genre before anything is read: a pulse below 75 BPM may read at double,
// one above 148 BPM with an accent on 1 and 3 at half.
const limitOctaves = (b) => [...(b < 75 ? [b * 2] : []), ...(b > 148 ? [b / 2] : [])];

for (const b of [66, 84, 96, 108, 116, 132, 150, 168, 192]) {
  add('offgrid', `clicks ${b}`, b, pattern(b, S, 1, [[0, 'click', 0.8]]), { octaves: limitOctaves(b) });
  add('offgrid', `rock ${b} (kick 1&3, snare 2&4, 8th hats)`, b, pattern(b, S, 4, [[0, 'kick', 0.9], [2, 'kick', 0.9], [1, 'snare', 0.8], [3, 'snare', 0.8], ...eighths('hat', 0.35)]), { octaves: limitOctaves(b) });
  add('offgrid', `kick every beat ${b} + offbeat hats 0.5`, b, pattern(b, S, 1, [[0, 'kick', 0.9], [0.5, 'hat', 0.5]]), { octaves: limitOctaves(b) });
}
for (const b of [90, 120, 150]) add('waltz', `3/4 strong 1 (0.9), 2&3 at 0.4, ${b}`, b, pattern(b, S, 3, [[0, 'kick', 0.9], [1, 'chord', 0.4], [2, 'chord', 0.4]]), { octaves: limitOctaves(b) });
for (const dq of [50, 60, 70]) {
  const eighthBpm = dq * 3; // 6/8: six eighths a bar, accents on 1 and 4; the dotted-quarter pulse is dq
  add('6/8', `6/8 dotted-quarter ${dq} (8ths ${eighthBpm})`, dq, pattern(eighthBpm, S, 6, [[0, 'kick', 0.9], [3, 'snare', 0.7], ...Array.from({ length: 6 }, (_, i) => [i, 'hat', 0.35])]));
}
for (const b of [100, 120]) add('push', `kick 1, and-of-2, 3; snare 2&4; 8th hats ${b}`, b, pattern(b, S, 4, [[0, 'kick', 0.9], [1.5, 'kick', 0.8], [2, 'kick', 0.9], [1, 'snare', 0.8], [3, 'snare', 0.8], ...eighths('hat', 0.3)]));
for (const b of [70, 76]) add('reggae', `one-drop: kick+rim on 3, skank on ands, hats ${b}`, b, pattern(b, S, 4, [[2, 'kick', 0.9], [2, 'rim', 0.6], [0.5, 'chord', 0.5], [1.5, 'chord', 0.5], [2.5, 'chord', 0.5], [3.5, 'chord', 0.5], ...eighths('hat', 0.25)]), { octaves: [b * 2, b / 2] });
add('house', 'house 124: 4-floor kick, open hat off-beat, clap 2&4', 124, pattern(124, S, 4, [[0, 'kick', 0.9], [1, 'kick', 0.9], [2, 'kick', 0.9], [3, 'kick', 0.9], [0.5, 'ohat', 0.5], [1.5, 'ohat', 0.5], [2.5, 'ohat', 0.5], [3.5, 'ohat', 0.5], [1, 'snare', 0.6], [3, 'snare', 0.6]]));
add('house', 'house 124 + 16th closed hats', 124, pattern(124, S, 4, [[0, 'kick', 0.9], [1, 'kick', 0.9], [2, 'kick', 0.9], [3, 'kick', 0.9], [0.5, 'ohat', 0.5], [1.5, 'ohat', 0.5], [2.5, 'ohat', 0.5], [3.5, 'ohat', 0.5], [1, 'snare', 0.6], [3, 'snare', 0.6], ...eighths('hat', 0.25, 16, 0.25)]));
add('dnb', 'dnb 172: kick 1 & 2.5, snare 2&4, 8th hats', 172, pattern(172, S, 4, [[0, 'kick', 0.9], [2.5, 'kick', 0.8], [1, 'snare', 0.9], [3, 'snare', 0.9], ...eighths('hat', 0.3)]));
add('dnb', 'dnb 174 amen-ish: ghost snares', 174, pattern(174, S, 4, [[0, 'kick', 0.9], [0.5, 'kick', 0.6], [1, 'snare', 0.9], [1.75, 'snare', 0.35], [2.5, 'kick', 0.8], [3, 'snare', 0.9], [3.75, 'snare', 0.35], ...eighths('hat', 0.3)]));
add('trap', 'trap 140 half-time: kick 1, snare 3, 16th hats', 140, pattern(140, S, 4, [[0, 'kick', 0.9], [2, 'snare', 0.9], [2.75, 'kick', 0.6], ...eighths('hat', 0.3, 16, 0.25)]), { octaves: [70] });
add('trap', 'trap 140 half-time: 8th hats', 140, pattern(140, S, 4, [[0, 'kick', 0.9], [2, 'snare', 0.9], ...eighths('hat', 0.3)]), { octaves: [70] });
for (const b of [100, 128, 175]) for (const n of [0.05, 0.1, 0.2, 0.35, 0.5]) add('noise', `clicks ${b} + white noise ${n}`, b, pattern(b, S, 1, [[0, 'click', 0.8]]), { noise: n, octaves: limitOctaves(b) });
for (const n of [0.1, 0.3]) add('noise', `rock 108 + white noise ${n}`, 108, pattern(108, S, 4, [[0, 'kick', 0.9], [2, 'kick', 0.9], [1, 'snare', 0.8], [3, 'snare', 0.8], ...eighths('hat', 0.35)]), { noise: n });

const near = (bpm, x) => Math.abs(bpm - x) <= Math.max(1, x * 0.01);
const OFF_BEAT = 1 / 8; // of a beat: a grid further than this from the beats is "off the beat"

test('held-out: the tempo is wrong in at most 10 % of 60 cases and the grid off the beat in at most 10 % of the rest', (t) => {
  assert.equal(cases.length, 60);
  const rows = cases.map((c) => {
    const { bpm, confidence, beats } = detectBeats(render(S, c.hits, { noise: c.noise }));
    const exact = near(bpm, c.truth);
    const octave = !exact && c.octaves.some((o) => near(bpm, o));
    const period = 60 / c.truth;
    // every pattern puts a beat on t = 0, so the beats are at k * period; how far, in beats, the detected grid sits from them
    const off = beats.length ? beats.reduce((sum, b) => sum + Math.abs(b - Math.round(b / period) * period), 0) / beats.length / period : Infinity;
    return { ...c, bpm, confidence, exact, octave, off, offBeat: exact && off > OFF_BEAT };
  });
  for (const r of rows) t.diagnostic(`${r.group.padEnd(8)} ${r.name.padEnd(48)} truth ${String(r.truth).padEnd(4)} read ${r.bpm.toFixed(2).padEnd(7)} conf ${r.confidence.toFixed(2)} off ${r.off.toFixed(2)} beat${r.exact ? '' : r.octave ? '  (documented octave)' : '  WRONG'}${r.offBeat ? '  OFF-BEAT' : ''}`);
  const compound = rows.filter((r) => r.group === '6/8');
  const scored = rows.filter((r) => r.group !== '6/8');
  const wrong = scored.filter((r) => !r.exact && !r.octave);
  const exact = scored.filter((r) => r.exact);
  const offBeat = exact.filter((r) => r.offBeat);
  t.diagnostic(`tempo: ${scored.length - wrong.length} of ${scored.length} right (${scored.filter((r) => r.exact).length} exact, ${scored.filter((r) => r.octave).length} documented octaves), ${wrong.length} wrong; 6/8: ${compound.filter((r) => r.exact).length} of ${compound.length} exact`);
  t.diagnostic(`grid: ${offBeat.length} of ${exact.length} exact-tempo cases more than 1/8 of a beat off the beat`);
  assert.ok(wrong.length <= 0.1 * scored.length, `${wrong.length} of ${scored.length} tempos wrong: ${wrong.map((r) => `${r.name} read ${r.bpm.toFixed(1)}`).join('; ')}`);
  assert.ok(offBeat.length <= 0.1 * exact.length, `${offBeat.length} of ${exact.length} grids off the beat: ${offBeat.map((r) => r.name).join('; ')}`);
});
