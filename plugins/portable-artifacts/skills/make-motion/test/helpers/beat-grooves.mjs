// Drum-like grooves for the beat detector's tests, built sample for sample as the third review built them (mono,
// 22050 Hz, in memory): the 31 cases of the second held-out set (shuffle, disco, breakbeat, polka, march, bossa, transient
// shapes and noise mixes, each drawn from its own seeded stream) and a kick on beats 1 and 3 over weak clicks on every beat.
// test/beats-heldout2.test.mjs measures the set; test/beats-limits.test.mjs takes its documented misreads from it.
import { mulberry32 } from '../../template/seeded.mjs';

export const SR = 22050;
const SET_SEED = 31337; // the set's jitter is drawn from this stream, and case i renders from SET_SEED + i
const RING_SECONDS = 0.6; // how long a hit is rendered
const CUTOFF = 0.1; // no hit starts in the last 0.1 s
const SECONDS = 15;

let rand = mulberry32(SET_SEED);
const decay = (i, ms) => Math.exp(-i / ((ms / 1000) * SR));
const onset = (i, ms) => Math.min(1, i / ((ms / 1000) * SR));
const noise = () => rand() * 2 - 1;
const sine = (hz, i) => Math.sin((2 * Math.PI * hz * i) / SR);
const held = (i) => (i < 0.22 * SR ? 1 : decay(i - 0.22 * SR, 20)); // a note held 220 ms, then let go
const SOUNDS = {
  kick: (i) => sine(48 + 140 * decay(i, 9), i) * decay(i, 80) + (i < 0.002 * SR ? noise() * 0.3 : 0),
  snare: (i) => (noise() * 0.75 + 0.25 * sine(210, i)) * decay(i, 55),
  ghost: (i) => noise() * decay(i, 25),
  chat: (i) => noise() * decay(i, 6),
  ohat: (i) => noise() * decay(i, 110),
  clap: (i) => noise() * ((i < 0.004 * SR) || (i > 0.011 * SR && i < 0.015 * SR) || (i > 0.022 * SR) ? 1 : 0.2) * decay(Math.max(0, i - 0.022 * SR), 40),
  bass: (i) => sine(98, i) * onset(i, 5) * held(i),
  bass2: (i) => sine(147, i) * onset(i, 5) * held(i),
  chord: (i) => ((sine(392, i) + sine(494, i) + sine(587, i)) / 3) * decay(i, 90),
  rim: (i) => sine(1900, i) * decay(i, 5) + noise() * 0.3 * decay(i, 3),
  shaker: (i) => noise() * onset(i, 10) * decay(i, 30),
  softsynth: (i) => sine(330, i) * onset(i, 15) * decay(i, 150),
  piano: (i) => (sine(262, i) + 0.5 * sine(524, i) + 0.25 * sine(786, i)) * onset(i, 2) * decay(i, 400),
  pluck: (i) => sine(440, i) * decay(i, 60) + noise() * 0.2 * decay(i, 4),
  tom: (i) => sine(110 + 60 * decay(i, 30), i) * decay(i, 150),
};

// `hits` ({ t, kind, amp }) mixed into `seconds` of silence, then the mix options: a feedback echo, room-tap reflections,
// pink noise, crowd bursts and vinyl crackle (each drawn from the current stream, in that order).
function render(seconds, hits, { pink = 0, echo, crowd = 0, crackle = 0, taps } = {}) {
  const pcm = new Float32Array(Math.round(seconds * SR));
  for (const { t, kind, amp } of hits) {
    const s = Math.round(t * SR);
    for (let i = 0; i < RING_SECONDS * SR && s + i < pcm.length; i++) if (s + i >= 0) pcm[s + i] += amp * SOUNDS[kind](i);
  }
  if (echo) {
    const d = Math.round(echo.delay * SR);
    for (let i = d; i < pcm.length; i++) pcm[i] += echo.gain * pcm[i - d];
  }
  if (taps) {
    const dry = Float32Array.from(pcm);
    for (const [ms, gain] of taps) {
      const d = Math.round((ms / 1000) * SR);
      for (let i = d; i < pcm.length; i++) pcm[i] += gain * dry[i - d];
    }
  }
  if (pink) {
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < pcm.length; i++) {
      const w = noise();
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      pcm[i] += (pink * (b0 + b1 + b2 + w * 0.1848)) / 3;
    }
  }
  if (crowd) {
    for (let t = 0; t < seconds; t += 0.05 + rand() * 0.2) {
      const s = Math.round(t * SR);
      const a = crowd * (0.3 + rand());
      for (let i = 0; i < 0.08 * SR && s + i < pcm.length; i++) pcm[s + i] += a * noise() * decay(i, 20);
    }
  }
  if (crackle) {
    for (let t = 0; t < seconds; t += rand() * 0.1) {
      const s = Math.round(t * SR);
      if (s < pcm.length) pcm[s] += crackle * noise();
    }
  }
  return pcm;
}

// A bar pattern: notes [[beat position, sound, amp], ...] repeated every `beatsPerBar` beats from `from`, each hit
// humanised by up to ±`jitter` seconds.
function bars(bpm, seconds, beatsPerBar, notes, { from = 0, jitter = 0 } = {}) {
  const out = [];
  const beat = 60 / bpm;
  for (let bar = 0; from + bar * beatsPerBar * beat < seconds; bar++) {
    for (const [pos, kind, amp] of notes) {
      const t = from + (bar * beatsPerBar + pos) * beat + (jitter ? noise() * jitter : 0);
      if (t < seconds - CUTOFF) out.push({ t, kind, amp });
    }
  }
  return out;
}
const every = (step, n, kind, amp, offset = 0) => Array.from({ length: n }, (_, i) => [offset + i * step, kind, amp]);

const cases = [];
// documented: the octaves the docs name as limits for that case (a read there is not counted wrong).
const add = (group, name, truth, documented, hits, opts = {}, seconds = SECONDS) => cases.push({ group, name, truth, documented, hits, opts, seconds });
const S = SECONDS;

const shuffle = [[0, 'kick', 0.9], [2, 'kick', 0.9], [1, 'snare', 0.8], [3, 'snare', 0.8], ...every(1, 4, 'chat', 0.35), ...every(1, 4, 'chat', 0.25, 2 / 3)];
add('shuffle', 'shuffle 93', 93, [], bars(93, S, 4, shuffle));
add('shuffle', 'shuffle 118', 118, [], bars(118, S, 4, shuffle));
add('shuffle', 'shuffle 137', 137, [68.5], bars(137, S, 4, shuffle));
const disco = [...every(1, 4, 'kick', 0.9), ...every(1, 4, 'ohat', 0.45, 0.5), [1, 'clap', 0.6], [3, 'clap', 0.6], ...every(0.25, 16, 'chat', 0.2), ...every(1, 4, 'bass2', 0.4, 0.5)];
add('disco', 'disco 117', 117, [], bars(117, S, 4, disco));
add('disco', 'disco 122 + pink noise 0.15', 122, [], bars(122, S, 4, disco), { pink: 0.15 });
const brk = [[0, 'kick', 0.9], [2.5, 'kick', 0.8], [2.75, 'kick', 0.6], [1, 'snare', 0.85], [3, 'snare', 0.85], [1.75, 'ghost', 0.3], [3.25, 'ghost', 0.3], [3.75, 'ghost', 0.3], ...every(0.25, 16, 'chat', 0.22)];
add('break', 'breakbeat 97', 97, [], bars(97, S, 4, brk));
add('break', 'breakbeat 108', 108, [], bars(108, S, 4, brk));
add('break', 'breakbeat 108, humanised +-7 ms', 108, [], bars(108, S, 4, brk, { jitter: 0.007 }));
const polka = [[0, 'bass', 0.8], [1, 'bass2', 0.7], [0.5, 'chord', 0.6], [1.5, 'chord', 0.6]];
add('polka', 'polka 126', 126, [], bars(126, S, 2, polka));
add('polka', 'polka 134 + snare on the ands', 134, [], bars(134, S, 2, [...polka, [0.5, 'snare', 0.4], [1.5, 'snare', 0.4]]));
const march = [...every(1, 4, 'tom', 0.9), ...every(0.5, 8, 'snare', 0.3), [1, 'snare', 0.7], [3, 'snare', 0.7], [0, 'ohat', 0.5]];
add('march', 'march 112', 112, [], bars(112, S, 4, march));
add('march', 'march 120 + vinyl crackle', 120, [], bars(120, S, 4, march), { crackle: 0.4 });
const bossa = [[0, 'kick', 0.8], [1.5, 'kick', 0.6], [2, 'kick', 0.8], [3.5, 'kick', 0.6], [0, 'rim', 0.5], [1.5, 'rim', 0.5], [3, 'rim', 0.5], [5, 'rim', 0.5], [6, 'rim', 0.5], [4, 'kick', 0.8], [5.5, 'kick', 0.6], [6, 'kick', 0.8], [7.5, 'kick', 0.6], ...every(0.5, 16, 'shaker', 0.2)];
add('bossa', 'bossa 124', 124, [], bars(124, S, 8, bossa));
add('bossa', 'bossa 138', 138, [], bars(138, S, 8, bossa));
add('shape', 'soft-attack synth pulses 101', 101, [], bars(101, S, 1, [[0, 'softsynth', 0.7]]));
add('shape', 'soft-attack synth pulses 142', 142, [], bars(142, S, 1, [[0, 'softsynth', 0.7]]));
add('shape', 'piano chords every beat, bass on 1, 79', 79, [], bars(79, S, 4, [...every(1, 4, 'piano', 0.5), [0, 'bass', 0.6]]));
add('shape', 'staccato bass notes every beat 88', 88, [], bars(88, S, 2, [[0, 'bass', 0.8], [1, 'bass2', 0.8]]));
add('shape', 'claps every beat 132', 132, [], bars(132, S, 1, [[0, 'clap', 0.8]]));
add('shape', 'pizzicato plucks 74', 74, [], bars(74, S, 1, [[0, 'pluck', 0.7]]));
add('shape', 'toms every beat 157', 157, [], bars(157, S, 1, [[0, 'tom', 0.8]]));
const rock = [[0, 'kick', 0.9], [2, 'kick', 0.9], [1, 'snare', 0.8], [3, 'snare', 0.8], ...every(0.5, 8, 'chat', 0.3)];
add('mix', 'rock 104 + crowd bursts', 104, [], bars(104, S, 4, rock), { crowd: 0.25 });
add('mix', 'four-floor 111 + feedback echo 170 ms', 111, [], bars(111, S, 4, [...every(1, 4, 'kick', 0.9), [1, 'snare', 0.7], [3, 'snare', 0.7]]), { echo: { delay: 0.17, gain: 0.5 } });
add('mix', 'four-floor 127 + room taps', 127, [], bars(127, S, 4, [...every(1, 4, 'kick', 0.9), ...every(1, 4, 'chat', 0.3, 0.5), [1, 'clap', 0.6], [3, 'clap', 0.6]]), { taps: [[31, 0.5], [53, 0.4], [79, 0.3], [113, 0.25], [151, 0.2]] });
add('mix', 'disco 125 humanised +-10 ms + pink 0.1', 125, [], bars(125, S, 4, disco, { jitter: 0.01 }), { pink: 0.1 });
add('mix', 'clicks 186 + pink 0.3', 186, [], bars(186, S, 1, [[0, 'rim', 0.8]]), { pink: 0.3 });
add('mix', 'rock 83 humanised +-6 ms', 83, [], bars(83, S, 4, rock, { jitter: 0.006 }));
add('edge', 'ballad 66: kick 1, snare 3, shaker 8ths', 66, [132], bars(66, 18, 4, [[0, 'kick', 0.9], [2, 'snare', 0.8], ...every(0.5, 8, 'shaker', 0.3)]), {}, 18);
add('edge', 'ballad 71: piano on every beat', 71, [], bars(71, 18, 1, [[0, 'piano', 0.6]]), {}, 18);
add('edge', 'fast four-floor 163 + off-beat hats', 163, [], bars(163, S, 1, [[0, 'kick', 0.9], [0.5, 'ohat', 0.4]]));
add('edge', 'polka 178 (fast)', 178, [], bars(178, S, 2, polka));

/** The 31 cases of the second held-out set: { group, name, truth, documented, seconds }, in order. */
export const GROOVES = cases.map(({ group, name, truth, documented, seconds }) => ({ group, name, truth, documented, seconds }));

/** The samples of case `name` of GROOVES (each case from its own stream, so one case renders the same alone or in a run). */
export function groove(name) {
  const index = cases.findIndex((c) => c.name === name);
  if (index < 0) throw new Error(`no groove named ${JSON.stringify(name)}`);
  const c = cases[index];
  rand = mulberry32(SET_SEED + index);
  return render(c.seconds, c.hits, c.opts);
}

const softKick = (i) => sine(55 + 120 * Math.exp(-i / (0.012 * SR)), i) * Math.exp(-i / (0.06 * SR));
const click = (i) => (i < 0.005 * SR ? sine(1000, i) : 0);
const KICK_RING_SECONDS = 0.5;

/** A kick (0.9) on beats 1 and 3 of each 4-beat bar and a weak 5 ms click (0.3) on every beat, for `seconds` at `bpm`. */
export function kickOneAndThree(bpm, seconds = 12) {
  const pcm = new Float32Array(seconds * SR);
  const notes = [[0, softKick, 0.9], [2, softKick, 0.9], ...[0, 1, 2, 3].map((b) => [b, click, 0.3])];
  for (let bar = 0; (bar * 4 * 60) / bpm < seconds; bar++) {
    for (const [pos, sound, amp] of notes) {
      const s = Math.round((((bar * 4 + pos) * 60) / bpm) * SR);
      for (let i = 0; i < KICK_RING_SECONDS * SR && s + i < pcm.length; i++) pcm[s + i] += amp * sound(i);
    }
  }
  return pcm;
}
