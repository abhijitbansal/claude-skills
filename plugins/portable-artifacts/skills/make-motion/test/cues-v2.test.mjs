// Cue synthesis v2: layered cues (transient, body, tail), pink noise, stereo width above 120 Hz, and the five new cues
// (riser, swoosh, typing, drop, ding). The acoustic tests are the automated bar for "sounds right".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cueWav, writeCueTracks, pinkNoise, layerCue, levelled, noteHz, fmBand, CUE_LAYERS, FM_CLICK_RATIO, MAX_HZ, SAMPLE_RATE } from '../scripts/lib/cues.mjs';
import { mulberry32 } from '../template/seeded.mjs';
import { CUE_NAMES, resolveCues } from '../template/audio.mjs';
import { TYPING_SECONDS_PER_CHAR, typingLength } from '../template/defaults.mjs';
import { validateSpec } from '../scripts/lib/spec.mjs';
import { bandEnergy, spectralCentroid, zeroCrossingRate, rms, pitchAt } from './helpers/spectrum.mjs';
import { requireRender, assertRendersIdentically } from './helpers/render.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOUR = path.join(root, 'references/examples/cue-tour.json');
const CHECK = path.join(root, 'scripts/check.mjs');
const errs = (motion) => validateSpec(motion).errors.map((e) => `${e.path}: ${e.message}`);

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

const TITLE = 'Hello, world';
const typingSpec = (title = {}, cue = {}, sceneOne = 2) => ({
  size: [320, 180],
  scenes: [
    { id: 'one', duration: sceneOne, elements: [] },
    { id: 'two', duration: 4, elements: [{ id: 'title', type: 'text', text: TITLE, typing: true, x: 160, y: 90, ...title }] },
  ],
  cues: [{ cue: 'typing', follow: 'title', ...cue }],
});

test('resolveCues: follow on a typing text gives chars = typingLength(text) and start = its scene start; with value keyframes 0 → N at t 1 and 3 the train spans 2 s', () => {
  const chars = typingLength(TITLE);
  assert.deepEqual(errs(typingSpec()), []);
  const [plain] = resolveCues(typingSpec());
  assert.equal(plain.chars, chars);
  assert.equal(plain.start, 2);
  assert.equal(plain.spacing, TYPING_SECONDS_PER_CHAR);
  const keyed = typingSpec({ keyframes: [{ t: 1, value: 0 }, { t: 3, value: chars }] });
  assert.deepEqual(errs(keyed), []);
  const [timed] = resolveCues(keyed);
  assert.equal(timed.start, 3);
  assert.equal(timed.chars, chars);
  assert.ok(Math.abs(timed.chars * timed.spacing - 2) < 1e-9, `the clicks span ${timed.chars * timed.spacing} s`);
  const [track] = writeCueTracks(keyed, mkdtempSync(path.join(tmpdir(), 'cue-follow-')));
  assert.ok(Math.abs(track.end - track.start - 2.05) < 1e-3, `the WAV holds the 2 s train and its last click: ${track.end - track.start} s`);
});

test('follow on a non-typing text, follow beside at, follow on a pop, a typing past its scene, and a cue without at: the exact error texts', () => {
  assert.deepEqual(errs(typingSpec({ typing: false })), ['cues[0].follow: element "title" is not a typing text (set "typing": true on it, or drop follow)']);
  assert.deepEqual(errs(typingSpec({}, { at: 0.5 })), ['cues[0].at: not with follow; the cue starts when "title" starts typing']);
  assert.deepEqual(errs(typingSpec({}, { scene: 'two' })), ['cues[0].scene: not with follow; the cue starts when "title" starts typing']);
  assert.deepEqual(errs(typingSpec({}, { cue: 'pop' })), ['cues[0].follow: only typing takes follow']);
  assert.deepEqual(errs(typingSpec({}, { follow: 'nope' })), ['cues[0].follow: element "nope" not found; typing texts: title']);
  const late = typingSpec({ keyframes: [{ t: 3.8, value: 0 }, { t: 3.9, value: typingLength(TITLE) }] });
  assert.deepEqual(errs(late), ['cues[0].follow: "title" types past the end of scene "two"']);
  assert.deepEqual(errs({ ...typingSpec(), cues: [{ cue: 'pop' }] }), ['cues[0].at: required']);
  assert.deepEqual(errs({ ...typingSpec(), cues: [{ cue: 'typing' }] }), ['cues[0].at: required']);
});

test('follow on an element that is not a text names its type', () => {
  const counter = { id: 'n', type: 'counter', to: 9, x: 160, y: 40 };
  const spec = typingSpec({}, { follow: 'n' });
  spec.scenes[1].elements.push(counter);
  assert.deepEqual(errs(spec), ['cues[0].follow: element "n" is a counter, not a text; follow a typing text']);
});

test('follow edge cases: keyframes that start part-typed, one value keyframe, none reaching the whole text, and empty text', () => {
  const chars = typingLength(TITLE); // 12
  const [partTyped] = resolveCues(typingSpec({ keyframes: [{ t: 1, value: 4 }, { t: 3, value: chars }] }));
  assert.equal(partTyped.chars, chars - 4, 'only the characters still to come click');
  assert.ok(Math.abs(partTyped.spacing - 2 / (chars - 4)) < 1e-12, `${partTyped.spacing}`);
  const [halfway] = resolveCues(typingSpec({ keyframes: [{ t: 1, value: 0 }, { t: 2, value: 6 }] }));
  assert.equal(halfway.chars, 6, 'no keyframe reaches the whole text: the clicks run to the last one');
  assert.ok(Math.abs(halfway.spacing - 1 / 6) < 1e-12, `${halfway.spacing}`);
  const never = 'cues[0].follow: "title" never types a character (it needs text, and value keyframes that rise if it has any); fix the text or drop follow';
  assert.deepEqual(errs(typingSpec({ keyframes: [{ t: 1, value: chars }] })), [never], 'one value keyframe: the text appears at once');
  assert.deepEqual(errs(typingSpec({ keyframes: [{ t: 1, value: chars }, { t: 2, value: 0 }] })), [never], 'keyframes that only fall');
  assert.deepEqual(errs(typingSpec({ text: '' })), [never], 'empty text');
  assert.equal(resolveCues(typingSpec({ text: '' }))[0].chars, 0);
  assert.ok(cueWav({ cue: 'typing', chars: 0 }).length > 44, 'a zero count still makes one click, never a 0/0 level');
});

test('cue-tour example is valid, passes check with no stderr, and renders byte-identical twice', async (t) => {
  const tour = JSON.parse(readFileSync(TOUR, 'utf8'));
  assert.deepEqual(validateSpec(tour, { dir: path.dirname(TOUR) }).errors, []);
  assert.deepEqual([...new Set(tour.cues.map((c) => c.cue))].sort(), [...CUE_NAMES].sort(), 'one of each cue');
  assert.ok(tour.cues.some((c) => c.cue === 'typing' && c.follow), 'a typing cue follows a typing text');
  if (!(await requireRender(t))) return;
  const r = spawnSync(process.execPath, [CHECK, TOUR], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.stderr, '');
  await assertRendersIdentically(t, TOUR, ['--fps', '10', '--size', '320x180']);
});

