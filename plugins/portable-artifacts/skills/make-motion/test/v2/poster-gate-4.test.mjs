// The poster look, revision 2 round 2 (gate-poster-2.md and the lead's rulings for p8): the viral hook (ruling 1),
// upright reading text in viral (2), kinetic type (3), the viral safe zone (4), grounds (5), legibility and fill (6) and
// wipes (7), each asserted on the two gate films (node side, the fake measure) or on a small film of its own.
import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import '../../engine/kinds/index.mjs';
import { stateKey } from '../../engine/graph/sample.mjs';
import { snapshotOf, drawnLeaves, contentOf } from './helpers/bar.mjs';
import { filmFor, filmOf, expandIn, canvasOf, FPS } from './helpers/kinds.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { prepareFilm } from '../../scripts/v2/prepare/index.mjs';
import { stackArea } from '../../engine/kinds/stack.mjs';

const LOOK = 'poster';
const GATE_DIR = new URL('../../references/examples/v2/', import.meta.url);
const WIDE = 'gate-poster.json', TALL = 'gate-poster-tall.json';
const SAMPLE = 0.25; // s between the samples a whole-shot rule looks at
const SAFE_FOOT = 0.72; // ruling 4: no text below this share of the height on the 9:16 viral film
const RAIL = 0.88; // ruling 4: nor right of this share of the width below mid-height (the action rail)
const MID = 0.5;

const gateFilm = (name) => ({ ...JSON.parse(readFileSync(new URL(name, GATE_DIR), 'utf8')), fps: FPS });
const cache = new Map();
// a film built once: { film, built, durations, prepared }
function built(film, key) {
  if (key !== undefined && cache.has(key)) return cache.get(key);
  const prepared = prepareFilm(film, { filmDir: '.' }).prepared;
  const out = {
    film,
    prepared,
    built: filmFor(film.shots, LOOK, film.format, { mode: film.mode, seed: film.seed, music: film.music }, { prepared }),
    durations: buildTimeline({ ...film, version: 2 }, { fps: FPS }).shots.map((s) => s.duration),
  };
  if (key !== undefined) cache.set(key, out);
  return out;
}
const gate = (name) => built(gateFilm(name), name);
const indexIn = (b, id) => b.film.shots.findIndex((s) => s.id === id);
const leavesOf = (b, i, t) => drawnLeaves(snapshotOf(b.built.sampleShot(i, t)));
const texts = (leaves) => leaves.filter((l) => l.node.type === 'text');
const timesOf = (b, i) => Array.from({ length: Math.floor(b.durations[i] / SAMPLE) + 1 }, (_, k) => Math.min(k * SAMPLE, b.durations[i] - 0.05));
const areaOf = (b, i) => stackArea(expandIn({ ...b.film, look: LOOK }, i, { prepared: b.prepared }).ctx);

// The largest band (px) between `top` and `bottom` that no box covers, the ends counted.
function largestGap(boxes, top, bottom) {
  const spans = boxes.map((x) => [Math.max(top, x[1]), Math.min(bottom, x[1] + x[3])]).filter(([a, c]) => c > a).sort((p, q) => p[0] - q[0]);
  let reach = top, gap = 0;
  for (const [a, c] of spans) {
    gap = Math.max(gap, a - reach);
    reach = Math.max(reach, c);
  }
  return Math.max(gap, bottom - reach);
}

// ---- ruling 4: the viral safe zone ----

test('poster 9:16 viral film: no text sits below 72 percent of the height, in any shot, at any sampled time', () => {
  const b = gate(TALL);
  const canvas = canvasOf(b.film.format);
  const low = [];
  b.film.shots.forEach((shot, i) => timesOf(b, i).forEach((t) => texts(leavesOf(b, i, t)).forEach((l) => {
    const foot = l.box[1] + l.box[3];
    if (foot > SAFE_FOOT * canvas.h + 0.5) low.push(`${shot.id}@${t.toFixed(2)} ${l.node.id} foot ${(foot / canvas.h).toFixed(3)}`);
  })));
  assert.deepEqual(low.slice(0, 8), []);
});

test('poster 9:16 viral film: no text in the action rail (right 12 percent below mid-height) (guard: the safe zone inset is 18 percent)', () => {
  const b = gate(TALL);
  const canvas = canvasOf(b.film.format);
  const hits = [];
  b.film.shots.forEach((shot, i) => timesOf(b, i).forEach((t) => texts(leavesOf(b, i, t)).forEach((l) => {
    if (l.box[1] + l.box[3] > MID * canvas.h && l.box[0] + l.box[2] > RAIL * canvas.w + 0.5) hits.push(`${shot.id}@${t.toFixed(2)} ${l.node.id}`);
  })));
  assert.deepEqual(hits.slice(0, 8), []);
});

// ---- ruling 2: viral reads upright ----

const TURNED = 45; // degrees: a text turned this far or more reads sideways (a cut card's 2-degree tilt does not)
// the ids of the visible texts in a sampled tree whose own rotation plus their groups' reaches TURNED
const turnedIn = (sampled, rot = 0) => sampled.flatMap((n) => {
  const r = rot + (n.rotate ?? 0);
  if ((n.opacity ?? 1) <= 0) return [];
  const mine = n.type === 'text' && Math.abs(r) >= TURNED ? [n.id] : [];
  return [...mine, ...turnedIn(n.children ?? [], r)];
});
const turnedTexts = (b) => b.film.shots.flatMap((shot, i) => timesOf(b, i).flatMap((t) => turnedIn(b.built.sampleShot(i, t)).map((id) => `${shot.id} ${id}`)));

test('poster 9:16 viral film: no reading text is turned (the list items stand upright)', () => {
  assert.deepEqual([...new Set(turnedTexts(gate(TALL)))], []);
});

test('poster in viral at 9:16: a short statement that is not the hook stands upright (it turned before ruling 2)', () => {
  const film = filmOf([{ id: 'a', show: 'statement', say: 'Hello there.' }, { id: 'b', show: 'statement', say: 'One script.' }], LOOK, '9:16', { mode: 'viral', seed: 3 });
  assert.deepEqual([...new Set(turnedTexts(built(film)))], []);
});

test('poster in pro at 16:9: the quote still turns a line (turned type stays a pro composition)', () => {
  assert.ok(turnedTexts(gate(WIDE)).some((s) => s.startsWith('bar ')), 'the 16:9 quote turns its first line');
});

test('poster 9:16 viral list: each item fills its band (no empty band over 35 percent, ban 2)', () => {
  const b = gate(TALL);
  const i = indexIn(b, 'how');
  const canvas = canvasOf(b.film.format);
  const area = areaOf(b, i);
  const gaps = timesOf(b, i).map((t) => {
    const boxes = contentOf(leavesOf(b, i, t), canvas).map((l) => l.box).filter((x) => x[2] * x[3] < 0.9 * canvas.w * canvas.h && x[1] < area.top + area.h && x[1] + x[3] > area.top);
    return largestGap(boxes, area.top, area.top + area.h) / area.h;
  });
  assert.ok(Math.max(...gaps) <= 0.35, `largest empty band ${Math.max(...gaps).toFixed(3)} of the band`);
});

// ---- ruling 1: the viral hook ----

const DOMINANT = 1.75; // the starred row at least this many times every other row (clearly smaller; was 1.35)
const EDGE = 0.97; // of the safe width: the starred row's ink runs edge to edge
const hookLines = (b, t = 0) => texts(leavesOf(b, 0, t)).filter((l) => l.node.props.stack === 'hook.text');
const lineWords = (l) => l.node.props.layout.lines[0].words.map((w) => w.text).join(' ');

test('poster 9:16 hook: the starred word has a row of its own, edge to edge, and every other row is clearly smaller (two sizes)', () => {
  const b = gate(TALL);
  const lines = hookLines(b);
  const star = lines.find((l) => /SCRIPT/.test(lineWords(l)));
  assert.equal(lineWords(star), 'SCRIPT.');
  const others = lines.filter((l) => l !== star).map((l) => l.node.props.font.size);
  const size = star.node.props.font.size;
  assert.ok(others.every((s) => size / s >= DOMINANT), `starred ${size.toFixed(1)}, others ${others.map((s) => s.toFixed(1))}`);
  assert.equal(new Set(lines.map((l) => l.node.props.font.size.toFixed(3))).size, 2, 'two sizes');
  const area = areaOf(b, 0);
  // the layout box (the fake measure's advance): within 40 px of the safe width
  assert.ok(star.box[2] >= EDGE * area.w - 40, `starred row ${star.box[2].toFixed(0)} of the safe width ${area.w.toFixed(0)}`);
});

test('poster 9:16 hook: complete and in ink on frame 0, then the starred word swaps ground on its spoken word; the end frame differs', () => {
  const b = gate(TALL);
  const zero = leavesOf(b, 0, 0);
  const lines = hookLines(b);
  for (const l of lines) for (const w of l.node.words ?? []) assert.equal(w.opacity ?? 1, 1, `${l.node.id} word at full opacity on frame 0`);
  assert.ok(!zero.some((l) => /\.beat\d/.test(l.node.id) && (l.node.reveal ?? 1) > 0), 'no bar on frame 0');
  const end = b.durations[0] - 0.05;
  assert.notEqual(stateKey(b.built.sampleShot(0, 0)), stateKey(b.built.sampleShot(0, end)), 'the end frame differs from frame 0');
  // the bar under the starred row is on by the middle of the shot and a changed frame comes within the first second
  const star = lines.findIndex((l) => /SCRIPT/.test(lineWords(l)));
  const firstChange = Array.from({ length: FPS }, (_, f) => f / FPS).find((t) => stateKey(b.built.sampleShot(0, t)) !== stateKey(b.built.sampleShot(0, 0)));
  assert.ok(firstChange !== undefined, 'motion within the first second');
  const on = leavesOf(b, 0, firstChange).find((l) => l.node.id === `hook.text.beat${star}`);
  assert.ok(on !== undefined && (on.node.reveal ?? 1) >= 1, `the bar under the starred row lands first (at ${firstChange?.toFixed(2)} s)`);
});

test('poster 9:16 hook: the smaller rows may sit under scale step 3 (the hook floor) without being flagged as overflowing', () => {
  const film = filmOf([{ id: 'h', show: 'statement', say: 'Numbers need *sources*.' }], LOOK, '9:16', { mode: 'viral', seed: 1 });
  const lines = texts(leavesOf(built(film), 0, 0)).filter((l) => l.node.props.stack === 'h.text');
  const sizes = lines.map((l) => l.node.props.font.size);
  const step3 = registries.looks.get(LOOK).scale[2] * (1080 / 1080);
  assert.ok(Math.min(...sizes) < step3, `a row under step 3: ${sizes.map((s) => s.toFixed(1))}`);
  assert.ok(lines.every((l) => l.node.props.layout.overflow !== true), 'no row flagged overflow');
  assert.ok(Math.max(...sizes) / Math.min(...sizes) >= DOMINANT, `sizes ${sizes.map((s) => s.toFixed(1))}`);
});

test('poster 9:16 hook: fills its band (no empty band over 35 percent, ban 2)', () => {
  const b = gate(TALL);
  const area = areaOf(b, 0);
  const boxes = texts(leavesOf(b, 0, 0)).map((l) => l.box);
  assert.ok(largestGap(boxes, area.top, area.top + area.h) / area.h <= 0.35, `largest gap ${(largestGap(boxes, area.top, area.top + area.h) / area.h).toFixed(3)}`);
});

// ---- ruling 3: kinetic type ----

const STILL_MAX = 2; // s: no shot is a still for longer
function longestStill(b, i) {
  const frames = Math.floor(b.durations[i] * FPS);
  let prev = null, run = 0, best = 0;
  for (let f = 0; f < frames; f++) {
    const key = stateKey(b.built.sampleShot(i, f / FPS));
    run = key === prev ? run + 1 : 1;
    best = Math.max(best, run);
    prev = key;
  }
  return best / FPS;
}

for (const name of [WIDE, TALL]) {
  // ruling 3: the stack kinds move by the beat bar (p8); the chart, code and diagram heroes take a strike, the compare
  // titles a beat bar and the feed's later words step in on their spoken words (p9)
  test(`poster ${name}: no shot is a still for more than 2 s (estimated timing)`, () => {
    const b = gate(name);
    const long = b.film.shots.map((s, i) => [s.id, longestStill(b, i)]).filter(([, s]) => s > STILL_MAX + 1e-9).map(([id, s]) => `${id} ${s.toFixed(2)} s`);
    assert.deepEqual(long, []);
  });
}

const BEAT_SHOTS = [[WIDE, 'idea'], [WIDE, 'bar'], [WIDE, 'close'], [TALL, 'hook'], [TALL, 'close']];
for (const [name, id] of BEAT_SHOTS) {
  test(`poster ${name} ${id}: type moves on its spoken words after a complete first frame (a beat bar steps row to row)`, () => {
    const b = gate(name);
    const i = indexIn(b, id);
    const bars = (t) => leavesOf(b, i, t).filter((l) => /\.beat\d+$/.test(l.node.id) && (l.node.reveal ?? 1) >= 1 && l.opacity >= 1).map((l) => l.node.id);
    const seen = new Set(timesOf(b, i).flatMap((t) => bars(t)));
    assert.ok(seen.size >= 2, `bars seen ${[...seen]}`);
    assert.ok(timesOf(b, i).every((t) => bars(t).length <= 1), 'one bar at a time');
  });
}

// ---- ruling 6: the highlighted bar carries its value label ----

for (const name of [WIDE, TALL]) {
  test(`poster ${name} tests: the highlighted bar carries its value label (besides the hero numeral)`, () => {
    const b = gate(name);
    const i = indexIn(b, 'tests');
    const all = texts(leavesOf(b, i, b.durations[i] - 0.05)).map((l) => l.node.props.layout.lines.flatMap((ln) => ln.words.map((w) => w.text)).join('')); // a counting numeral sets a word a digit
    assert.ok(all.filter((s) => s.includes('1,636')).length >= 2, `texts: ${all.join(' | ')}`);
  });
}
