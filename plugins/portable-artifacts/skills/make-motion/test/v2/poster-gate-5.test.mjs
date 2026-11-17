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
import { snappedOffset } from '../../engine/cuts/cover.mjs';

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

// ---- ruling 7: wipes ----
// A held frame is any frame of the film at 30 fps (each is on screen for a frame time, and a contact sheet shows it). On
// a frame inside a cover (the sheet `cover.backdrop` is drawn) no text box may straddle the sheet's leading edge or the
// frame's edge, and the sheet never stops short of home by less than TAIL of the frame (there its chrome stacks against
// the outgoing chrome).
const TAIL = 0.1;
function coverFrames(name) {
  const b = gate(name);
  const total = b.durations.reduce((s, d) => s + d, 0);
  return Array.from({ length: Math.floor(total * FPS) }, (_, f) => f / FPS).map((t) => ({ t, leaves: drawnLeaves(snapshotOf(b.built.frameAt(t).sampled)) }))
    .map((f) => ({ ...f, sheet: f.leaves.find((l) => l.node.id === 'cover.backdrop') })).filter((f) => f.sheet !== undefined);
}
for (const name of [WIDE, TALL]) {
  test(`poster ${name}: no frame of a cover slices a word at the sheet's edge or the frame's edge, nor stops the sheet just short of home`, () => {
    const b = gate(name);
    const canvas = { w: b.film.format === '16:9' ? 1920 : 1080, h: b.film.format === '16:9' ? 1080 : 1920 };
    const frames = coverFrames(name);
    assert.ok(frames.length > 0, 'the film has a cover');
    const bad = frames.flatMap(({ t, leaves, sheet }) => {
      const [sx, sy] = sheet.box;
      const axis = Math.abs(sx) > Math.abs(sy) ? 0 : 1;
      const L = axis === 0 ? canvas.w : canvas.h;
      const offset = axis === 0 ? sx : sy;
      const edges = [offset > 0 ? offset : L + offset, 0, L].filter((e) => e > 0.5 && e < L - 0.5 || e === 0 || e === L);
      const sliced = leaves.filter((l) => l.node.type === 'text').filter((l) => edges.some((e) => l.box[axis] < e - 0.5 && l.box[axis] + l.box[axis + 2] > e + 0.5));
      const short = Math.abs(offset) > 0.5 && Math.abs(offset) < TAIL * L;
      return [...sliced.map((l) => `@${t.toFixed(2)} ${l.node.id}`), ...(short ? [`@${t.toFixed(2)} sheet ${offset.toFixed(0)} px from home`] : [])];
    });
    assert.deepEqual(bad.slice(0, 8), []);
  });
}

// a sampled text whose layout box is [x, y, w, h] (only what the snap reads)
const sampledText = (id, [x, y, w, h]) => ({ type: 'text', id, x, y, rotate: 0, scale: 1, scaleX: 1, scaleY: 1, opacity: 1, children: [], props: { layout: { width: w, height: h } } });
test('poster cover snap: where every offset of the travel would slice a word, the sheet jumps (start or home), never slices', () => {
  const canvas = { w: 1080, h: 1920 };
  // outgoing words down the whole height: every place of the sheet's edge cuts one
  const from = Array.from({ length: 10 }, (_, k) => sampledText(`o${k}`, [0, 5 + k * 190, 800, 200])); // 5 to 1915 px, overlapping
  const at = snappedOffset({ from, to: [], canvas, direction: 'up', snap: { tail: 0.1 } });
  const offsets = Array.from({ length: 13 }, (_, k) => at(k / 12)[1]);
  const cut = offsets.filter((o) => from.some((t) => o > t.y + 0.5 && o < t.y + t.props.layout.height - 0.5));
  assert.deepEqual(cut, [], `offsets ${offsets.map((o) => o.toFixed(0))}`);
});

test('poster cover snap: a word whose ink overhangs its tight layout box (display line height 0.9) is not sliced either', () => {
  const canvas = { w: 1080, h: 1920 };
  // a 100 px display line with a tight layout box, 1030 to 1080, baseline 1070; capitals reach a cap height (about 0.72
  // em) over the baseline, to 998, above the box
  const word = { ...sampledText('w', [0, 1030, 800, 50]), props: { layout: { width: 800, height: 50, lines: [{ y: 40 }] }, font: { size: 100 } } };
  const at = snappedOffset({ from: [word], to: [], canvas, direction: 'up', snap: { tail: 0.1 } });
  const raw = 1010; // an eased offset over the layout box, inside the ink
  const o = at(1 - raw / canvas.h)[1];
  assert.ok(!(o > 1070 - 0.72 * 100 + 0.5 && o < 1070 - 0.5), `offset ${o.toFixed(1)} cuts the capitals (ink 998 to 1070)`);
});

test('poster: a film of four free shots shows every ground once before any repeats (look.groundsFresh)', () => {
  const look = registries.looks.get(LOOK);
  for (const seed of [1, 2, 3, 31, 37]) {
    const keys = groundKeys(look, 4, seed, ['statement', 'statement', 'statement', 'statement']);
    assert.equal(new Set(keys).size, 4, `seed ${seed}: ${keys}`);
  }
});
