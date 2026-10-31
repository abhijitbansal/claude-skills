// Cue synthesis v2: layered cues (transient, body, tail), pink noise, stereo width above 120 Hz, and the five new cues
// (riser, swoosh, typing, drop, ding). The acoustic tests are the automated bar for "sounds right".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cueWav, writeCueTracks, pinkNoise, SAMPLE_RATE } from '../scripts/lib/cues.mjs';
import { mulberry32 } from '../template/seeded.mjs';
import { CUE_NAMES, resolveCues } from '../template/audio.mjs';
import { TYPING_SECONDS_PER_CHAR, typingLength } from '../template/defaults.mjs';
import { validateSpec } from '../scripts/lib/spec.mjs';
import { bandEnergy, spectralCentroid, zeroCrossingRate, rms } from './helpers/spectrum.mjs';
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

test('impact: zero-crossing rate over the first 20 ms is at least 3× the rate over 150–200 ms', () => {
  const { left } = channels(cueWav({ cue: 'impact' }));
  const attack = zeroCrossingRate(seconds(left, 0, 0.02), SAMPLE_RATE);
  const settled = zeroCrossingRate(seconds(left, 0.15, 0.2), SAMPLE_RATE);
  assert.ok(attack >= 3 * settled, `first 20 ms ${attack}/s, 150–200 ms ${settled}/s`);
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

