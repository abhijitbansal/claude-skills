// Cutting to the user's music: music.beats (a beats file used instead of detecting) and music.snap (the cuts of a film
// with no narration moved onto beats, scripts/v2/sound/snap.mjs). Tests that need ffmpeg or a browser skip without them
// (PA_REQUIRE_BROWSER=1 makes that a failure). Run with --test-concurrency=1.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { browserAvailable, ffmpegOrNull } from './helpers/session.mjs';
import { writeClicks, writeNoise } from './helpers/clicks.mjs';
import { findFfprobe } from '../../scripts/lib/ffmpeg.mjs';
import '../../scripts/v2/list.mjs'; // registers the looks, kinds, devices and cuts, as make.mjs does
import { validateFilm, withFilmDefaults } from '../../scripts/v2/spec.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { SNAP_MIN_SHOT_SECONDS, shotFloors, snapCuts, snapFilm } from '../../scripts/v2/sound/snap.mjs';
import { musicInput } from '../../scripts/v2/sound/bed.mjs';
import { writeBeatsFile } from '../../scripts/v2/sound/beats-file.mjs';
import { runMake } from '../../scripts/v2/run.mjs';
import { soundLine } from '../../scripts/v2/report.mjs';

const FPS = 30;
const BAR = { type: 'path', id: 'bar', props: { d: 'M300 500H1620V580H300Z', fill: '#15130f' } };
const free = (id, hold, cut) => ({ id, show: 'free', hold, background: '#f3eee3', ...(cut ? { cut } : {}), nodes: [BAR] });
const grid = (bpm, seconds) => Array.from({ length: Math.floor((seconds * bpm) / 60) + 1 }, (_, k) => (k * 60) / bpm);
const timelineOf = (film) => {
  const filled = withFilmDefaults(film);
  return buildTimeline(filled, { fps: filled.fps });
};
const FOUR = { version: 2, fps: FPS, shots: [free('a', 1.9), free('b', 2.3, 'cut'), free('c', 2.1, 'cut'), free('d', 1.7, 'cut')] };

let dir;
before(() => { dir = mkdtempSync(path.join(tmpdir(), 'mm-sound-snap-')); });
after(() => rmSync(dir, { recursive: true, force: true }));
const folder = (name) => {
  const at = path.join(dir, name);
  mkdirSync(at, { recursive: true });
  return at;
};

// ---- snapCuts, pure ----

test('four shots against a 120 BPM grid: each cut moves to its nearest beat, hand-computed', () => {
  const timeline = timelineOf(FOUR);
  assert.deepEqual(timeline.shots.map((s) => s.start), [0, 1.9, 4.2, 6.3], 'the cuts before snapping');
  const { timeline: snapped, moved } = snapCuts(timeline, grid(120, 10), { minShot: 1, maxShiftSeconds: 0.25 });
  assert.deepEqual(snapped.shots.map((s) => [s.start, s.end, s.duration]), [[0, 2, 2], [2, 4, 2], [4, 6.5, 2.5], [6.5, 8, 1.5]]);
  assert.deepEqual(moved, [{ shot: 'b', from: 1.9, to: 2 }, { shot: 'c', from: 4.2, to: 4 }, { shot: 'd', from: 6.3, to: 6.5 }]);
  assert.equal(snapped.duration, timeline.duration, 'the film keeps its length');
  assert.equal(snapped.frameCount, timeline.frameCount);
  assert.deepEqual(timeline.shots.map((s) => s.start), [0, 1.9, 4.2, 6.3], 'the input timeline is not changed');
});

test('a cut further from a beat than the limit stays where it is', () => {
  const timeline = timelineOf(FOUR);
  const { timeline: snapped, moved } = snapCuts(timeline, grid(120, 10), { minShot: 1, maxShiftSeconds: 0.05 });
  assert.deepEqual(moved, []);
  assert.deepEqual(snapped.shots.map((s) => s.start), [0, 1.9, 4.2, 6.3]);
});

test('a snap that would leave a shot under its floor stays', () => {
  const timeline = timelineOf({ version: 2, fps: FPS, shots: [free('a', 1.1), free('b', 3, 'cut')] });
  const { moved } = snapCuts(timeline, [0.9, 5], { minShot: 1, maxShiftSeconds: 0.5 });
  assert.deepEqual(moved, [], 'moving the cut to 0.9 s would leave "a" 0.9 s long');
  const floors = snapCuts(timeline, [1.4], { minShot: [1, 3], maxShiftSeconds: 0.5 });
  assert.deepEqual(floors.moved, [], 'a per-shot floor: "b" would be 2.7 s, under its 3 s');
});

test('a beat between frames lands on the nearest frame', () => {
  const timeline = timelineOf({ version: 2, fps: FPS, shots: [free('a', 2), free('b', 2, 'cut')] });
  const { moved } = snapCuts(timeline, [2.01], { minShot: 1, maxShiftSeconds: 0.25 });
  assert.deepEqual(moved, []);
  const near = snapCuts(timeline, [2.05], { minShot: 1, maxShiftSeconds: 0.25 });
  assert.equal(near.moved[0].to * FPS, Math.round(2.05 * FPS));
});

test('a shot\'s floor is the shortest shot (1 s) or its incoming cut\'s length, whichever is longer', () => {
  const floors = shotFloors({ shots: [free('a', 2), free('b', 2, 'cut'), free('c', 2, 'cut')] });
  assert.deepEqual(floors, [SNAP_MIN_SHOT_SECONDS, SNAP_MIN_SHOT_SECONDS, SNAP_MIN_SHOT_SECONDS]);
});

test('a film without snap keeps the timeline it had (the same object), and reports no moves', () => {
  const timeline = timelineOf(FOUR);
  const out = snapFilm({ ...FOUR, music: { src: 'm.wav' } }, timeline, grid(120, 10));
  assert.equal(out.timeline, timeline);
  assert.equal(out.moved, null);
});

// ---- the film fields ----

const validate = (film, at) => validateFilm(film, { specDir: at });
const errorAt = (result, at) => result.errors.find((e) => e.path === at);

test('snap in a narrated film is refused at music.snap, saying why', () => {
  const at = folder('narrated');
  writeClicks(path.join(at, 'm.wav'), { bpm: 120, seconds: 1 });
  const result = validate({ version: 2, music: { src: 'm.wav', snap: true }, shots: [{ id: 'a', show: 'statement', say: 'Hello there.' }] }, at);
  assert.equal(result.ok, false);
  assert.match(errorAt(result, 'music.snap')?.message ?? '', /narrat/);
  assert.match(errorAt(result, 'music.snap').message, /shots\[0\]/);
});

test('music.beats outside the folder, or malformed, is refused at music.beats with its path', () => {
  const at = folder('beats-bad/film');
  writeClicks(path.join(at, 'm.wav'), { bpm: 120, seconds: 1 });
  writeFileSync(path.join(at, '..', 'out.beats.json'), JSON.stringify({ beats: [1] }));
  writeFileSync(path.join(at, 'bad.beats.json'), JSON.stringify({ beats: [2, 1] }));
  const shots = [free('a', 2)];
  for (const beats of ['../out.beats.json', 'bad.beats.json']) {
    const result = validate({ version: 2, music: { src: 'm.wav', beats }, shots }, at);
    assert.equal(result.ok, false, beats);
    assert.ok(errorAt(result, 'music.beats')?.message.includes(JSON.stringify(beats)), JSON.stringify(result.errors));
  }
});

test('beats and snap go with a music file of your own, not a bed', () => {
  const at = folder('bed');
  const result = validate({ version: 2, music: { bed: 'pulse', snap: true }, shots: [free('a', 2)] }, at);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.path === 'music' && /src/.test(e.message)), JSON.stringify(result.errors));
});

test('a valid music.beats and snap validate', () => {
  const at = folder('beats-ok');
  writeClicks(path.join(at, 'm.wav'), { bpm: 120, seconds: 1 });
  writeBeatsFile(path.join(at, 'm.beats.json'), { source: 'm.wav', bpm: 120, confidence: 1, beats: grid(120, 8) });
  const result = validate({ version: 2, music: { src: 'm.wav', beats: 'm.beats.json', snap: true }, shots: [free('a', 2), free('b', 2, 'cut')] }, at);
  assert.deepEqual(result.errors, []);
});

// ---- the detector is not asked when a beats file is given ----

async function mediaTools(t) {
  const ffmpeg = await ffmpegOrNull();
  const ffprobe = ffmpeg ? findFfprobe({ ffmpeg }) : null;
  if (ffmpeg && ffprobe) return { ffmpeg, ffprobe };
  if (process.env.PA_REQUIRE_BROWSER === '1') throw new Error('ffmpeg and ffprobe are required');
  t.skip('no ffmpeg or ffprobe');
  return null;
}

test('musicInput with beats never calls the detector; without them it does', async (t) => {
  const tools = await mediaTools(t);
  if (!tools) return;
  const at = folder('spy');
  writeNoise(path.join(at, 'm.wav'), { seconds: 6 });
  const calls = [];
  const detect = (pcm) => { calls.push(pcm.length); return [0, 0.5]; };
  const film = { music: { src: 'm.wav' } };
  const given = await musicInput(film, at, { ...tools, beats: [0.25, 0.75], detect });
  assert.deepEqual(given.beats, [0.25, 0.75]);
  assert.equal(calls.length, 0, 'the detector was called');
  const detected = await musicInput(film, at, { ...tools, detect });
  assert.equal(calls.length, 1);
  assert.deepEqual(detected.beats, [0, 0.5]);
});

// ---- through the run ----

test('snap with no beats file on music with no steady beat is refused at music.snap', async (t) => {
  if (!await mediaTools(t)) return;
  const at = folder('run-nobeat');
  writeNoise(path.join(at, 'm.wav'), { seconds: 10 });
  const specPath = path.join(at, 'film.json');
  writeFileSync(specPath, JSON.stringify({ ...FOUR, music: { src: 'm.wav', snap: true } }));
  const { report, exitCode } = await runMake({ specPath, out: path.join(at, 'out', 'film.mp4'), exact: false, noRender: true, outline: false });
  assert.equal(exitCode, 1);
  assert.ok(report.findings.some((f) => f.path === 'music.snap' && /steady beat/.test(f.message)), JSON.stringify(report.findings));
});

test('music.beats and snap through the run: the file\'s grid is used and every cut is moved onto it', async (t) => {
  if (!await mediaTools(t)) return;
  if (!await browserAvailable()) { t.skip('no browser'); return; }
  const at = folder('run-snap');
  writeNoise(path.join(at, 'm.wav'), { seconds: 10 });
  writeBeatsFile(path.join(at, 'm.beats.json'), { source: 'm.wav', bpm: 120, confidence: 1, beats: grid(120, 10) });
  const specPath = path.join(at, 'film.json');
  writeFileSync(specPath, JSON.stringify({ ...FOUR, music: { src: 'm.wav', beats: 'm.beats.json', snap: true } }));
  const { report, exitCode } = await runMake({ specPath, out: path.join(at, 'out', 'film.mp4'), exact: false, noRender: true, outline: false });
  assert.equal(exitCode, 0, JSON.stringify(report.findings));
  const { music } = report.audio;
  assert.equal(music.bpm, 120, 'noise has no steady beat: the tempo can only come from the file');
  assert.equal(music.landed, 3);
  assert.deepEqual(music.moved, [{ shot: 'b', from: 1.9, to: 2 }, { shot: 'c', from: 4.2, to: 4 }, { shot: 'd', from: 6.3, to: 6.5 }]);
  assert.match(soundLine(report.audio), /3 of 3 cuts on a beat, 3 moved onto a beat/);
});

test('an anchor that snap leaves outside its shortened shot is refused at its path, after the snap', async (t) => {
  if (!await mediaTools(t)) return;
  const at = folder('run-snap-anchor');
  writeNoise(path.join(at, 'm.wav'), { seconds: 10 });
  writeBeatsFile(path.join(at, 'm.beats.json'), { source: 'm.wav', bpm: 120, confidence: 1, beats: grid(120, 10) });
  // "b" runs 1.9 to 4.2 s (2.3 s) before the snap and 2 to 4 s (2 s) after it: an anchor at 2.2 s fits only before.
  const shots = FOUR.shots.map((shot) => (shot.id === 'b' ? { ...shot, on: [{ at: 2.2, do: 'highlight' }] } : shot));
  const film = { ...FOUR, shots, music: { src: 'm.wav', beats: 'm.beats.json', snap: true } };
  assert.deepEqual(validate(film, at).errors, [], 'valid on the unsnapped timeline');
  const specPath = path.join(at, 'film.json');
  writeFileSync(specPath, JSON.stringify(film));
  const { report, exitCode } = await runMake({ specPath, out: path.join(at, 'out', 'film.mp4'), exact: false, noRender: true, outline: false });
  assert.equal(exitCode, 1);
  const finding = report.findings.find((f) => f.path === 'shots[1].on[0].at');
  assert.match(finding?.message ?? '', /outside the shot.*music\.snap/, JSON.stringify(report.findings));
});

test('the review draws the snapped timeline: each shot opens where its cut was moved to', async (t) => {
  if (!await mediaTools(t)) return;
  if (!await browserAvailable()) { t.skip('no browser'); return; }
  const at = folder('run-snap-drawn');
  writeNoise(path.join(at, 'm.wav'), { seconds: 10 });
  writeBeatsFile(path.join(at, 'm.beats.json'), { source: 'm.wav', bpm: 120, confidence: 1, beats: grid(120, 10) });
  // Shots with nothing on them: the review names each one at the time it opens, as the session draws it.
  const empty = FOUR.shots.map((shot) => ({ ...shot, nodes: [] }));
  const specPath = path.join(at, 'film.json');
  writeFileSync(specPath, JSON.stringify({ ...FOUR, shots: empty, music: { src: 'm.wav', beats: 'm.beats.json', snap: true } }));
  const { report } = await runMake({ specPath, out: path.join(at, 'out', 'film.mp4'), exact: false, noRender: true, outline: false });
  const opens = report.findings.filter((f) => /opens on an empty frame/.test(f.message)).map((f) => [f.shot, f.t]);
  assert.deepEqual(opens, [['b', 2], ['c', 4], ['d', 6.5]], JSON.stringify(report.findings));
});
