// Transitions Task 7: the strips, the audit plan, the review's own cut findings and the sound events follow the resolved
// cut (engine/cuts/resolve.mjs). Pure: no browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { registries } from '../../engine/registry.mjs';
import '../../scripts/v2/list.mjs'; // registers the looks, kinds, devices and cuts, as make.mjs does
import { buildTimeline } from '../../engine/script/timing.mjs';
import { buildFilm } from '../../engine/graph/film.mjs';
import { planSheets, auditMoments, CUT_STRIP_MAX_TILES } from '../../scripts/v2/plan.mjs';
import { auditPlan, cutWindowFindings } from '../../scripts/v2/review.mjs';
import { soundEvents } from '../../scripts/v2/sound/events.mjs';
import { planCues } from '../../scripts/v2/sound/cues.mjs';
import { fitBeatGrid } from '../../scripts/v2/sound/bed.mjs';
import { measure } from './helpers/kinds.mjs';

const FPS = 30;
const EXAMPLES = fileURLToPath(new URL('../../references/examples/v2/', import.meta.url));
const example = (name) => JSON.parse(readFileSync(`${EXAMPLES}${name}`, 'utf8'));
const film = (shots, extra = {}) => ({ version: 2, mode: 'pro', look: 'desk', fps: FPS, shots, ...extra });
const two = (cut, { hold = 2, look = 'desk', mode = 'pro' } = {}) => film([{ id: 'a', hold: 2, show: 'free' }, { id: 'b', hold, show: 'free', cut }], { look, mode });
const stripOf = (f, name = 'cut-a-b.png') => planSheets(f, buildTimeline(f, { fps: FPS })).find((s) => s.name === name);

// ---- strips ----

test('a 2 s crossfade plans at most CUT_STRIP_MAX_TILES tiles: two each side, the window first, middle and last, in time order, none twice', () => {
  const f = two({ type: 'crossfade', duration: 2 }, { hold: 4 });
  const frames = stripOf(f).tiles.map((t) => t.frame);
  // b starts on frame 60; its 2 s window is frames 60 to 119, the middle 89
  assert.ok(frames.length <= CUT_STRIP_MAX_TILES, `${frames.length} tiles`);
  assert.equal(frames.length, CUT_STRIP_MAX_TILES, 'a long window fills the cap');
  for (const frame of [58, 59, 60, 89, 119, 120, 121]) assert.ok(frames.includes(frame), `frame ${frame} in ${frames}`);
  assert.deepEqual(frames, [...new Set(frames)].sort((x, y) => x - y), 'unique and in time order');
  assert.deepEqual([frames[0], frames[1], frames.at(-2), frames.at(-1)], [58, 59, 120, 121]);
});

test('the cap keeps every frame of a 0.6 s shader window, and is a whole number of strip rows', () => {
  assert.ok(CUT_STRIP_MAX_TILES >= 22, 'a 0.6 s window at 30 fps plus two frames each side');
  assert.equal(CUT_STRIP_MAX_TILES % 5, 0);
  assert.deepEqual(stripOf(two('water-drop')).tiles.map((t) => t.frame), Array.from({ length: 22 }, (_, k) => 58 + k));
});

test('a 0.2 s punch plans the same tiles as before the cap (recorded at 8093b24b), its window tiles labelled with the cut', () => {
  // the 0.2 s written out: pop's own punch now runs 0.3 s (look review gate-cuts-1 P1)
  const tiles = stripOf(two({ type: 'punch', duration: 0.2 }, { look: 'pop', mode: 'viral' })).tiles;
  assert.deepEqual(tiles.map((t) => t.frame), [58, 59, 60, 61, 62, 63, 64, 65, 66, 67]);
  assert.deepEqual(tiles.map((t) => t.label), [
    'a · 1.93s', 'a · 1.97s',
    'b · 2.00s · punch 0%', 'b · 2.03s · punch 17%', 'b · 2.07s · punch 33%', 'b · 2.10s · punch 50%', 'b · 2.13s · punch 67%', 'b · 2.17s · punch 83%',
    'b · 2.20s', 'b · 2.23s',
  ]);
});

test('a strip tile inside a window is labelled with the cut\'s name and progress; a hard cut\'s tiles are not', () => {
  const slide = stripOf(two({ type: 'slide', direction: 'up' }));
  assert.equal(slide.tiles.find((t) => t.frame === 66).label, 'b · 2.20s · slide 50%');
  assert.ok(stripOf(two('cut')).tiles.every((t) => !t.label.includes('%')));
});

test('a window that is not a whole number of frames holds the frames the film draws inside it, in the strip and the audit', () => {
  for (const duration of [0.11, 0.25, 0.4]) {
    const f = two({ type: 'wipe', duration });
    const timeline = buildTimeline(f, { fps: FPS });
    const movie = buildFilm({ film: f, timeline, measure, canvas: { w: 1920, h: 1080 } });
    const drawn = Array.from({ length: 60 }, (_, k) => 60 + k).filter((i) => movie.frameAt(i / FPS).cut !== undefined);
    const strip = stripOf(f).tiles.map((t) => t.frame).slice(2, -2); // less the two frames each side
    assert.deepEqual(strip, drawn, `${duration} s`);
    const alone = auditPlan(f, timeline).filter(([shot, frame]) => shot === 1 && frame >= 60).map(([, frame]) => frame);
    assert.ok(alone.every((frame) => drawn.includes(frame)), `${duration} s: audited alone only inside the drawn window`);
  }
});

// ---- the audit ----

test('auditMoments includes the first frame after a 0.8 s slide\'s window', () => {
  const f = two({ type: 'slide', duration: 0.8 });
  assert.ok(auditMoments(f, buildTimeline(f, { fps: FPS })).includes(84), 'b starts on 60; 0.8 s is 24 frames');
});

test('a frame inside a wipe\'s window is audited as the incoming shot alone, and the frame after it as the whole picture', () => {
  const f = two({ type: 'wipe', direction: 'left' });
  const plan = new Map(auditPlan(f, buildTimeline(f, { fps: FPS })).map(([shot, frame]) => [frame, shot]));
  assert.equal(plan.get(60), 1);
  assert.equal(plan.get(68), 1);
  assert.equal(plan.get(72), -1, 'frame 72 is 0.4 s in: the window is over');
});

// ---- the review's own cut findings ----

test('a cut longer than its shot is mechanical: after the clamp it never finishes', () => {
  const found = cutWindowFindings(two({ type: 'crossfade', duration: 1.5 }, { hold: 1 }), buildTimeline(two({ type: 'crossfade', duration: 1.5 }, { hold: 1 }), { fps: FPS }));
  assert.deepEqual(found.map((f) => [f.kind, f.shot, f.path, f.rule, f.t]), [['mechanical', 'b', 'shots[1].cut', 'cut-window', 2]]);
  assert.match(found[0].message, /the crossfade needs 1\.5 s but its shot lasts 1 s, so it never finishes/);
});

test('a cut that takes more than half its shot is creative, naming both lengths; exactly half is not a finding', () => {
  const f = two({ type: 'wipe', duration: 1.2 });
  const found = cutWindowFindings(f, buildTimeline(f, { fps: FPS }));
  assert.deepEqual(found.map((x) => [x.kind, x.path, x.rule]), [['creative', 'shots[1].cut', 'cut-window']]);
  assert.equal(found[0].message, 'the wipe is on screen for 1.2 s of this 2 s shot; shorten it or lengthen the shot');
  const half = two({ type: 'wipe', duration: 1 });
  assert.deepEqual(cutWindowFindings(half, buildTimeline(half, { fps: FPS })), []);
  assert.deepEqual(cutWindowFindings(two('cut', { hold: 0.2 }), buildTimeline(two('cut', { hold: 0.2 }), { fps: FPS })), [], 'a hard cut has no window');
});

test('a cut the shot takes from the root cut points at the root cut', () => {
  const f = { ...two(undefined, { hold: 1 }), cut: { type: 'fade', duration: 0.8 } };
  assert.deepEqual(cutWindowFindings(f, buildTimeline(f, { fps: FPS })).map((x) => [x.kind, x.path]), [['creative', 'cut']]);
});

test('the gate and example films have no cut-window finding', () => {
  for (const name of ['gate-desk.json', 'gate-pop.json', 'gate-cosmos.json', 'gate-cosmos-viral.json', 'kinds-desk.json', 'kinds-pop.json', 'sound-desk.json', 'sound-pop.json']) {
    const f = example(name);
    assert.deepEqual(cutWindowFindings(f, buildTimeline(f, { fps: f.fps ?? FPS })), [], name);
  }
});

// ---- sound ----

test('a cut event carries the resolved cut: its name, its length clamped to the shot, and its direction', () => {
  const f = film([
    { id: 'a', hold: 2, show: 'free' },
    { id: 'b', hold: 2, show: 'free', cut: { type: 'wipe', direction: 'up', duration: 0.8 } },
    { id: 'c', hold: 1, show: 'free', cut: { type: 'blur', duration: 2 } },
    { id: 'd', hold: 2, show: 'free' },
  ]);
  const timeline = buildTimeline(f, { fps: FPS });
  assert.equal(timeline.shots[2].duration, 1);
  const cuts = soundEvents(f, timeline).filter((e) => e.kind === 'cut');
  assert.deepEqual(cuts.map(({ shot, cut, dur, direction }) => [shot, cut, dur, direction]), [['b', 'wipe', 0.8, 'up'], ['c', 'blur', 1, null], ['d', 'cut', 0, null]]);
});

test('a cue plays at the start of each new cut a look names one for, and none for a cut it names null', () => {
  const look = registries.looks.get('desk');
  assert.equal(look.sounds.cut.wipe, 'paper');
  assert.equal(look.sounds.cut.crossfade, null);
  const f = film([
    { id: 'a', hold: 2, show: 'free' },
    { id: 'b', hold: 2, show: 'free', cut: 'wipe' },
    { id: 'c', hold: 2, show: 'free', cut: 'crossfade' },
    { id: 'd', hold: 2, show: 'free', cut: 'page-curl' },
  ], { sound: 'on' });
  const cues = planCues(f, buildTimeline(f, { fps: FPS }), { looks: registries.looks, modes: registries.modes });
  assert.deepEqual(cues.map(({ t, cue }) => [Math.round(t * 1e6) / 1e6, cue]), [[2, 'paper'], [6, 'paper']]);
});

test('the cuts on a beat of sound-desk.json are unchanged (estimated timeline; recorded at 8093b24b: 3 of 4)', () => {
  const f = example('sound-desk.json');
  const timeline = buildTimeline(f, { fps: FPS });
  const grid = fitBeatGrid(timeline.shots.slice(1).map((s) => s.start), { bpm: f.music.bpm, seconds: timeline.duration, fps: FPS });
  assert.deepEqual([grid.landed, grid.cuts], [3, 4]);
  const cues = planCues(f, timeline, { looks: registries.looks, modes: registries.modes });
  assert.deepEqual(cues.map((c) => c.cue), ['paper', 'marker', 'paper', 'paper', 'click', 'paper'], 'the cue plan recorded at 8093b24b');
});
