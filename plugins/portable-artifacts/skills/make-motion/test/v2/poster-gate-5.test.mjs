// The poster look, revision 2 round 2 finished (gate-poster-2.md and the lead's rulings for p9): grounds (ruling 5),
// legibility and fill (6), kinetic type for the data kinds (3) and wipes (7), asserted on the two gate films (node side,
// the fake measure, estimated timing) or on a small film of their own.
import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import '../../engine/kinds/index.mjs';
import { groundKeys } from '../../engine/looks/grounds.mjs';
import { FPS, filmFor, filmOf, expandIn } from './helpers/kinds.mjs';
import { snapshotOf, drawnLeaves } from './helpers/bar.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { prepareFilm } from '../../scripts/v2/prepare/index.mjs';
import { stackArea } from '../../engine/kinds/stack.mjs';
import { resolveShotCut } from '../../engine/cuts/resolve.mjs';

const unionOf = (boxes) => {
  const x = Math.min(...boxes.map((b) => b[0])), y = Math.min(...boxes.map((b) => b[1]));
  return [x, y, Math.max(...boxes.map((b) => b[0] + b[2])) - x, Math.max(...boxes.map((b) => b[1] + b[3])) - y];
};

const LOOK = 'poster';
const GATE_DIR = new URL('../../references/examples/v2/', import.meta.url);
const WIDE = 'gate-poster.json', TALL = 'gate-poster-tall.json';

const gateFilm = (name) => ({ ...JSON.parse(readFileSync(new URL(name, GATE_DIR), 'utf8')), fps: FPS });
const groundsOf = (film) => groundKeys(registries.looks.get(LOOK), film.shots.length, film.seed, film.shots.map((s) => s.show));

// ---- ruling 5: grounds ----

for (const name of [WIDE, TALL]) {
  test(`poster ${name}: no two consecutive shots share a ground`, () => {
    const keys = groundsOf(gateFilm(name));
    const same = keys.slice(1).flatMap((k, i) => (k === keys[i] ? [`${i}-${i + 1} ${k}`] : []));
    assert.deepEqual(same, []);
  });
}

test('poster 9:16 viral film: at least three grounds, red among them', () => {
  const keys = groundsOf(gateFilm(TALL));
  assert.ok(new Set(keys).size >= 3, `grounds ${keys}`);
  assert.ok(keys.includes('accent'), `a red ground: ${keys}`);
});

// ---- ruling 6: legibility and fill ----

const cache = new Map();
function gate(name) {
  if (cache.has(name)) return cache.get(name);
  const film = gateFilm(name);
  const prepared = prepareFilm(film, { filmDir: '.' }).prepared;
  const out = {
    film,
    prepared,
    built: filmFor(film.shots, LOOK, film.format, { mode: film.mode, seed: film.seed, music: film.music }, { prepared }),
    durations: buildTimeline({ ...film, version: 2 }, { fps: FPS }).shots.map((s) => s.duration),
  };
  cache.set(name, out);
  return out;
}
const indexIn = (b, id) => b.film.shots.findIndex((s) => s.id === id);
const leavesOf = (b, i, t) => drawnLeaves(snapshotOf(b.built.sampleShot(i, t)));
// the visible texts; a beat bar's knockout copy stands in for its hidden row (same size and place), so it counts
const textsAt = (b, i, t) => leavesOf(b, i, t).filter((l) => l.node.type === 'text' && l.opacity > 0);
const sizeOf = (l) => l.node.props.font.size;
const SECONDARY_MIN = 52;
const THIRD = 1 / 3;
const TOL = 1e-6;
// a shot's hero: its largest text on screen at t; every other text at least a third of it and secondary.min (furniture
// and tags are not content: the review leaves them out of the hero rule too)
function smallTexts(b, i, t, ids) {
  const all = textsAt(b, i, t);
  const hero = Math.max(...all.map(sizeOf));
  return all.filter((l) => ids.test(l.node.id)).filter((l) => sizeOf(l) < Math.max(SECONDARY_MIN, THIRD * hero) - TOL).map((l) => `${l.node.id} ${sizeOf(l).toFixed(1)} of hero ${hero.toFixed(1)}`);
}

for (const name of [WIDE, TALL]) {
  test(`poster ${name} swap: the compare points are at least a third of the hero and secondary.min, before and after the turn`, () => {
    const b = gate(name);
    const i = indexIn(b, 'swap');
    const small = [0.1, b.durations[i] - 0.05].flatMap((t) => smallTexts(b, i, t, /\.points$/));
    assert.ok(textsAt(b, i, b.durations[i] - 0.05).some((l) => /\.points$/.test(l.node.id)), 'points on screen');
    assert.deepEqual(small, []);
  });
  test(`poster ${name} tests: the chart's claim, labels and source are at least a third of the hero and secondary.min`, () => {
    const b = gate(name);
    const i = indexIn(b, 'tests');
    const end = b.durations[i] - 0.05;
    assert.ok(textsAt(b, i, end).some((l) => /\.source$/.test(l.node.id)), 'the source on screen');
    assert.deepEqual(smallTexts(b, i, end, /\.(title\.text|source|label|value)/), []);
  });
}

test('poster 16:9 swap: each side fills its frame (its text spans at least 60 percent of the height and 85 percent of the width)', () => {
  const b = gate(WIDE);
  const i = indexIn(b, 'swap');
  const area = stackArea(expandIn({ ...b.film, look: LOOK }, i, { prepared: b.prepared }).ctx);
  const short = [0.1, b.durations[i] - 0.05].flatMap((t) => {
    const box = unionOf(textsAt(b, i, t).map((l) => l.box));
    return box[3] >= 0.6 * area.h && box[2] >= 0.85 * area.w ? [] : [`@${t.toFixed(2)} ${(box[2] / area.w).toFixed(2)} x ${(box[3] / area.h).toFixed(2)}`];
  });
  assert.deepEqual(short, []);
});

test('poster 16:9 swap: a short side title grows past the stack cap to fill the width (compare.titleCap)', () => {
  const film = filmOf([{ id: 's', show: 'compare', mode: 'before-after', say: 'Before, slow. Now, fast.', left: { title: 'Slow', points: ['Hours'] }, right: { title: 'Fast', points: ['Seconds'] } }], LOOK, '16:9', { mode: 'pro', seed: 4 });
  const b = { film, built: filmFor(film.shots, LOOK, '16:9', { mode: 'pro', seed: 4 }) };
  const title = textsAt(b, 0, 0.1).find((l) => /\.left\.title\.line0$/.test(l.node.id));
  assert.ok(sizeOf(title) > 400 + TOL, `title ${sizeOf(title).toFixed(1)} units`);
});

const EDGE = 0.9; // of the safe width: a row that runs edge to edge
const areaOf = (b, i) => stackArea(expandIn({ ...b.film, look: LOOK }, i, { prepared: b.prepared }).ctx);
// the rows of the stacks matching `stack` on screen at t narrower than EDGE of the safe width
const shortRows = (b, i, t, stack) => {
  const area = areaOf(b, i);
  return textsAt(b, i, t).filter((l) => stack.test(l.node.props.stack ?? '')).filter((l) => l.box[2] < EDGE * area.w).map((l) => `@${t.toFixed(2)} ${l.node.id} ${(l.box[2] / area.w).toFixed(2)}`);
};

test('poster 9:16 close: the closing line fills its width (every row at least 90 percent of the safe width)', () => {
  const b = gate(TALL);
  const i = indexIn(b, 'close');
  assert.deepEqual(shortRows(b, i, b.durations[i] - 0.05, /^close\.title$/), []);
});

test('poster 9:16 how: every list row runs edge to edge, for each item', () => {
  const b = gate(TALL);
  const i = indexIn(b, 'how');
  const short = [...new Set(Array.from({ length: Math.floor(b.durations[i] / 0.25) }, (_, k) => k * 0.25).flatMap((t) => shortRows(b, i, t, /^how\./).map((s) => s.replace(/^@[\d.]+ /, ''))))];
  assert.deepEqual(short, []);
});

test('poster: a stack with an emphasised word keeps two sizes (justify is for fills without a lead)', () => {
  const film = filmOf([{ id: 'h', show: 'statement', say: 'Write the *script*. Get the film.' }], LOOK, '9:16', { mode: 'viral', seed: 37 });
  const b = { film, built: filmFor(film.shots, LOOK, '9:16', { mode: 'viral', seed: 37 }) };
  const sizes = new Set(textsAt(b, 0, 0).filter((l) => l.node.props.stack === 'h.text').map((l) => sizeOf(l).toFixed(3)));
  assert.equal(sizes.size, 2, [...sizes].join(', '));
});

test('poster 9:16 chat: the reply\'s room is on frame 0, its words arrive in place on their spoken words', () => {
  const b = gate(TALL);
  const i = indexIn(b, 'chat');
  const plateAt = (t) => leavesOf(b, i, t).find((l) => l.node.id === 'chat.item1.plate' && l.opacity > 0);
  const zero = plateAt(0), end = plateAt(b.durations[i] - 0.05);
  assert.ok(zero !== undefined, 'the reply plate on frame 0');
  assert.deepEqual(zero.box.map(Math.round), end.box.map(Math.round), 'the plate does not move');
  const reply = (t) => leavesOf(b, i, t).find((l) => l.node.id === 'chat.item1.text');
  const words = (t) => (reply(t)?.node.words ?? []).filter((w) => (w.opacity ?? 1) > 0).length;
  assert.equal(words(0), 0, 'no reply word on frame 0');
  const counts = Array.from({ length: Math.floor(b.durations[i] * FPS) }, (_, f) => words(f / FPS));
  assert.ok(new Set(counts).size >= 3, `the reply arrives word by word: ${[...new Set(counts)]}`);
});

test('poster 16:9 flow: three of the chain\'s four cards are on frame 0', () => {
  const b = gate(WIDE);
  const i = indexIn(b, 'flow');
  const cards = leavesOf(b, i, 0).filter((l) => /^flow\.node\d\.label$/.test(l.node.id) && l.opacity > 0);
  assert.ok(cards.length >= 3, `cards on frame 0: ${cards.map((l) => l.node.id)}`);
});

const CLEAR = 0.05; // of the row's size: the least clear space the beat bar keeps above the cap line and below the baseline
const CAP_UP = 0.74; // the fake measure's ink above the baseline for capitals (helpers/kinds.mjs inkUp)
for (const [name, id] of [[WIDE, 'idea'], [WIDE, 'close'], [TALL, 'hook'], [TALL, 'close']]) {
  test(`poster ${name} ${id}: the beat bar keeps clear space above and below its row's letters`, () => {
    const b = gate(name);
    const i = indexIn(b, id);
    const end = b.durations[i] - 0.05;
    const leaves = leavesOf(b, i, end);
    const bar = leaves.find((l) => /\.beat\d+$/.test(l.node.id) && l.opacity >= 1);
    const copy = leaves.find((l) => l.node.id === `${bar.node.id}.text`);
    // the copy's leaf box is its layout box in canvas pixels; its first line's baseline sits lines[0].y under its top
    const size = sizeOf(copy), baseline = copy.box[1] + copy.node.props.layout.lines[0].y;
    const above = baseline - CAP_UP * size - bar.box[1], below = bar.box[1] + bar.box[3] - baseline;
    assert.ok(above >= CLEAR * size - TOL && below >= CLEAR * size - TOL, `${bar.node.id}: ${(above / size).toFixed(3)} em above, ${(below / size).toFixed(3)} em below`);
    // and clear of the neighbouring rows' letters (look.stack.rowGap): the row over it ends on its baseline, the row
    // under it starts at its cap line
    const rows = leaves.filter((l) => l.node.type === 'text' && l.node.props.stack === copy.node.props.stack && l.node.props.beatOf === undefined && l.node.id !== copy.node.props.beatOf);
    const near = rows.flatMap((l) => {
      const s = sizeOf(l), base = l.box[1] + l.node.props.layout.lines[0].y;
      const gap = base < baseline ? bar.box[1] - base : base - CAP_UP * s - (bar.box[1] + bar.box[3]);
      return gap < CLEAR * Math.max(s, size) - TOL ? [`${l.node.id} ${(gap / size).toFixed(3)} em`] : [];
    });
    assert.deepEqual(near, []);
  });
}

// ---- ruling 7: wipes (revised by the lead on gate-poster-3) ----
// Ruling 7's intent: no word half sliced on a HELD frame. The snap that jumped such offsets made both 16:9 covers stall,
// then pop (gate-poster-3). The lead's ruling: a sheet that moves every frame holds no frame, so the cover moves on a
// steady ease (cutStyle.cover.ease) and no snap. Each frame of a cover window (the sheet `cover.backdrop` drawn, off
// home) moves the sheet, and no step is over STEP_RATIO times the mean step from off-frame to home.
const STEP_RATIO = 2.5;
const STILL = 0.5; // px: a step this small is no move
function coverWindows(name) {
  const b = gate(name);
  const canvas = { w: b.film.format === '16:9' ? 1920 : 1080, h: b.film.format === '16:9' ? 1080 : 1920 };
  const total = b.durations.reduce((s, d) => s + d, 0);
  const frames = Array.from({ length: Math.floor(total * FPS) }, (_, f) => f / FPS).map((t) => ({ t, sheet: leavesAt(b, t).find((l) => l.node.id === 'cover.backdrop') }))
    .filter((f) => f.sheet !== undefined).map(({ t, sheet }) => {
      const axis = Math.abs(sheet.box[0]) > Math.abs(sheet.box[1]) ? 0 : 1;
      return { t, axis, L: axis === 0 ? canvas.w : canvas.h, offset: Math.abs(sheet.box[axis]) };
    }).filter((f) => f.offset > STILL);
  // consecutive frames one frame apart are one window
  return frames.reduce((windows, f) => {
    const last = windows.at(-1);
    return last && Math.abs(f.t - last.at(-1).t - 1 / FPS) < 1e-6 ? [...windows.slice(0, -1), [...last, f]] : [...windows, [f]];
  }, []);
}
const leavesAt = (b, t) => drawnLeaves(snapshotOf(b.built.frameAt(t).sampled));
for (const name of [WIDE, TALL]) {
  test(`poster ${name}: every cover's sheet moves every frame of its window and no step exceeds 2.5x the mean`, () => {
    const windows = coverWindows(name);
    assert.ok(windows.length > 0, 'the film has a cover');
    const bad = windows.flatMap((w) => {
      const path = [...w.map((f) => f.offset), 0];
      const steps = path.slice(1).map((o, k) => Math.abs(path[k] - o));
      const mean = steps.reduce((s, x) => s + x, 0) / steps.length;
      const still = steps.flatMap((s, k) => (s < STILL ? [`@${w[k].t.toFixed(2)} still`] : []));
      const jump = steps.flatMap((s, k) => (s > STEP_RATIO * mean ? [`@${w[k].t.toFixed(2)} step ${(s / mean).toFixed(2)}x the mean`] : []));
      return [...still, ...jump];
    });
    assert.deepEqual(bad, []);
  });
}

// gate-poster-3 (cut bar->close): "a gentler ease so the red sheet crosses the frame over the whole cover". The ruling's
// 2.5x bounds a jump; the steady ease also keeps the peak step within STEADY of the mean (the default cover curve,
// inOutCubic, peaks near 2.5x)
const STEADY = 2;
test('poster 16:9: the bar to close cover travels on a steady ease, its largest step at most 2x the mean', () => {
  const b = gate(WIDE);
  const close = b.durations.slice(0, indexIn(b, 'close')).reduce((s, d) => s + d, 0);
  const w = coverWindows(WIDE).find((win) => Math.abs(win[0].t - close) < 2 / FPS);
  assert.ok(w, 'the close opens on a cover');
  const path = [...w.map((f) => f.offset), 0];
  const steps = path.slice(1).map((o, k) => Math.abs(path[k] - o));
  const ratio = Math.max(...steps) / (steps.reduce((s, x) => s + x, 0) / steps.length);
  assert.ok(ratio <= STEADY, `largest step ${ratio.toFixed(2)}x the mean`);
});

// The lead's ruling on gate-poster-3 (the cream sheet over the cream code card): where the picked cover's sheet would
// cross a large opaque area of its own colour, the look picks a plain cut instead. A large area: an opaque path at least
// LARGE of the frame in the incoming ground's colour on the outgoing shot's last frame.
const LARGE = 0.1;
function sameColourArea(b, i) {
  const start = b.durations.slice(0, i).reduce((s, d) => s + d, 0);
  const incoming = b.built.backgrounds[i].toLowerCase();
  const canvas = b.film.format === '16:9' ? 1920 * 1080 : 1080 * 1920;
  return leavesAt(b, start - 1 / FPS).filter((l) => l.node.type === 'path' && l.node.id !== 'ground' && l.opacity >= 1 && (l.node.props.fill ?? '').toLowerCase() === incoming)
    .reduce((s, l) => s + l.box[2] * l.box[3], 0) / canvas;
}
test('poster 16:9: the picked cover into swap is a plain cut, its sheet would cross the code card of its own colour', () => {
  const b = gate(WIDE);
  const i = indexIn(b, 'swap');
  assert.equal(i % registries.looks.get(LOOK).cutPick.every, 0, 'the look picks the cover for this shot');
  assert.ok(sameColourArea(b, i) >= LARGE, `the code card covers ${(sameColourArea(b, i) * 100).toFixed(0)} percent in the incoming colour`);
  assert.equal(resolveShotCut({ ...b.film, look: LOOK }, i).name, 'cut');
});
for (const name of [WIDE, TALL]) {
  test(`poster ${name}: every cover the look still picks crosses no large area of its own colour`, () => {
    const b = gate(name);
    const covers = b.film.shots.map((_, i) => i).filter((i) => i > 0 && resolveShotCut({ ...b.film, look: LOOK }, i).name === 'cover');
    assert.ok(covers.length > 0, 'a cover is still picked');
    assert.deepEqual(covers.filter((i) => sameColourArea(b, i) >= LARGE).map((i) => b.film.shots[i].id), []);
  });
}

test('poster: a film of four free shots shows every ground once before any repeats (look.groundsFresh)', () => {
  const look = registries.looks.get(LOOK);
  for (const seed of [1, 2, 3, 31, 37]) {
    const keys = groundKeys(look, 4, seed, ['statement', 'statement', 'statement', 'statement']);
    assert.equal(new Set(keys).size, 4, `seed ${seed}: ${keys}`);
  }
});
