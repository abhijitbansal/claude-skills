// poster gate revision 1, round 2 (gate-poster-1.md, the lead's rulings for p7): the frame filled (ban 2) and the
// hierarchy (ruling 1: the 16:9 diagram and quote, the compare at both formats, the 9:16 feed and close), the close's ask
// (ruling 2: at least the look's secondary.min, held 1.5 s) and turned type in the 16:9 film (ruling 3). Each test reads
// the lead's gate films (references/examples/v2/gate-poster*.json) under the fake measure (helpers/kinds.mjs); the real
// glyphs are judged on the gate renders.
import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import '../../engine/kinds/index.mjs';
import { lookOfShot } from '../../engine/graph/film.mjs';
import { contrastRatio } from '../../shared/contrast.mjs';
import { snapshotOf, drawnLeaves, contentOf } from './helpers/bar.mjs';
import { filmFor, expandIn, canvasOf, FPS } from './helpers/kinds.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { prepareFilm } from '../../scripts/v2/prepare/index.mjs';
import { stackArea } from '../../engine/kinds/stack.mjs';

const LOOK = 'poster';
const look = () => registries.looks.get(LOOK);
const GATE_DIR = new URL('../../references/examples/v2/', import.meta.url);
const WIDE = 'gate-poster.json', TALL = 'gate-poster-tall.json';
const HERO = 3; // the frame review's MIN_HERO_RATIO
const MAX_BAND = 0.2; // a filled frame: no empty band over this share of the composition height
const WIDE_SPAN = 0.8; // a filled wide frame: the content spans this share of the width
const TALL_USE = 0.85; // a filled tall frame: the content spans this share of the band's height
const ASK_HOLD = 1.5; // s: the close's ask on screen at least this long (ruling 2)

const gateFilm = (name) => ({ ...JSON.parse(readFileSync(new URL(name, GATE_DIR), 'utf8')), fps: FPS });
const cache = new Map();
// the gate film built once: { film, built, durations }
function gate(name) {
  if (cache.has(name)) return cache.get(name);
  const film = gateFilm(name);
  const prepared = prepareFilm(film, { filmDir: '.' }).prepared;
  const built = filmFor(film.shots, LOOK, film.format, { mode: film.mode, seed: film.seed, music: film.music }, { prepared });
  const durations = buildTimeline({ ...film, version: 2 }, { fps: FPS }).shots.map((s) => s.duration);
  const out = { film, built, durations, prepared };
  cache.set(name, out);
  return out;
}
const indexOf = (name, id) => gate(name).film.shots.findIndex((s) => s.id === id);
const leavesAt = (name, id, t) => drawnLeaves(snapshotOf(gate(name).built.sampleShot(indexOf(name, id), t)));
const endOf = (name, id) => gate(name).durations[indexOf(name, id)] - 0.05;
const ofShot = (leaves, id) => leaves.filter((l) => l.node.id.startsWith(`${id}.`));
const texts = (leaves) => leaves.filter((l) => l.node.type === 'text');
const words = (n) => n.props.layout.lines.flatMap((l) => l.words.map((w) => w.text)).join(' ');
const span = (boxes, axis) => Math.max(...boxes.map((b) => b[axis] + b[axis + 2])) - Math.min(...boxes.map((b) => b[axis]));
// the composition area of a shot (the stack's: the band at 9:16, the margins at 16:9), as { top, h }
const areaOf = (name, id) => {
  const { film, prepared } = gate(name);
  return stackArea(expandIn({ ...film, look: LOOK }, indexOf(name, id), { prepared }).ctx);
};

// The largest band (px) between `top` and `bottom` that no box covers, the area's own ends counted.
function largestGap(boxes, top, bottom) {
  const spans = boxes.map((b) => [Math.max(top, b[1]), Math.min(bottom, b[1] + b[3])]).filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]);
  let reach = top, gap = 0;
  for (const [a, b] of spans) {
    gap = Math.max(gap, a - reach);
    reach = Math.max(reach, b);
  }
  return Math.max(gap, bottom - reach);
}
// the shot's content boxes at t (no ground, no full-frame sheet), and the area's fill: { used, gap } as shares
function fillOf(name, id, t) {
  const canvas = canvasOf(gate(name).film.format);
  const boxes = contentOf(leavesAt(name, id, t), canvas).map((l) => l.box).filter((b) => b[2] * b[3] < 0.9 * canvas.w * canvas.h);
  const area = areaOf(name, id);
  const top = Math.max(area.top, Math.min(...boxes.map((b) => b[1]))), bottom = Math.min(area.top + area.h, Math.max(...boxes.map((b) => b[1] + b[3])));
  return { boxes, used: (bottom - top) / area.h, gap: largestGap(boxes, area.top, area.top + area.h) / area.h, canvas };
}

// ---- ruling 1: the 16:9 diagram ----

test('poster 16:9 diagram: the title is the hero in condensed capitals, at least three times the card labels', () => {
  const end = texts(leavesAt(WIDE, 'flow', endOf(WIDE, 'flow')));
  const title = end.find((l) => l.node.id === 'flow.title');
  const label = end.find((l) => l.node.id === 'flow.node0.label');
  assert.ok(title, `a title text: ${end.map((l) => l.node.id).join(', ')}`);
  assert.equal(title.node.props.font.width, look().fonts.display.width, 'the condensed display face');
  assert.equal(words(title.node), 'ONE COMMAND', 'in capitals');
  assert.ok(title.node.props.font.size >= HERO * label.node.props.font.size, `title ${title.node.props.font.size} vs label ${label.node.props.font.size}`);
});

test('poster 16:9 diagram: the diagram fills the frame (width and height, no empty band over a fifth)', () => {
  const { boxes, gap, canvas } = fillOf(WIDE, 'flow', endOf(WIDE, 'flow'));
  const width = span(boxes, 0);
  assert.ok(width >= WIDE_SPAN * canvas.w, `content ${Math.round(width)} of ${canvas.w} wide`);
  assert.ok(gap <= MAX_BAND, `an empty band of ${(100 * gap).toFixed(0)}% of the height`);
});

test('poster 16:9 diagram: the opening frame holds at least two cards and the edge between them, whole', () => {
  const first = leavesAt(WIDE, 'flow', 0);
  const cards = [0, 1, 2, 3].filter((k) => first.some((l) => l.node.id === `flow.node${k}.label` && l.opacity >= 1));
  assert.ok(cards.length >= 2, `cards on frame 0: ${cards.join(', ')}`);
  const edge = first.find((l) => l.node.id === 'flow.edge0.line');
  assert.ok(edge && edge.node.draw >= 1 && edge.opacity >= 1, `edge 0 drawn ${edge?.node.draw} at ${edge?.opacity}`);
});

// ---- ruling 1 and ruling 3: the 16:9 quote, a hero that fills the frame, turned ----

test('poster 16:9 quote: the quotation fills the frame (at least 80 percent of its width, no empty band over a fifth)', () => {
  const t = endOf(WIDE, 'bar');
  const { boxes, gap, canvas } = fillOf(WIDE, 'bar', t);
  assert.ok(span(boxes, 0) >= WIDE_SPAN * canvas.w, `content ${Math.round(span(boxes, 0))} of ${canvas.w} wide`);
  assert.ok(gap <= MAX_BAND, `an empty band of ${(100 * gap).toFixed(0)}% of the height`);
});

test('poster 16:9 film: at least one composition uses turned type (the quote turns a line up the frame)', () => {
  const lines = texts(leavesAt(WIDE, 'bar', 1)).filter((l) => l.node.props.stack !== undefined);
  const turned = lines.filter((l) => Math.abs(Math.abs(l.node.rotate ?? 0) - 90) < 1e-6);
  assert.ok(turned.length >= 1, `turned lines: ${lines.map((l) => `${words(l.node)}@${l.node.rotate ?? 0}`).join(' / ')}`);
  // and it carries the quotation's own words, in order (the first line, read up the frame first)
  assert.equal(words(turned[0].node), words(lines[0].node));
});

// ---- ruling 1: the compare, at 16:9 and 9:16 ----

const SIDE_TITLES = (id) => [`${id}.left.title`, `${id}.right.title`];
const titleFill = (leaves, hero) => {
  const line = texts(leaves).find((l) => l.node.props.stack === hero);
  return line ? sampledFill(line.node) : null;
};
// a text's drawn colour: its first word's sampled fill, else its own
const sampledFill = (n) => (n.words?.[0]?.fill ?? n.fill ?? n.props.fill).toLowerCase();

for (const [name, id] of [[WIDE, 'swap'], [TALL, 'swap']]) {
  const format = gate(name).film.format;
  test(`poster ${format} compare: the two sides' heroes are distinct (the payoff in another colour), both read on the ground`, () => {
    const [left, right] = SIDE_TITLES(id);
    const turnEnd = endOf(name, id);
    const ground = lookOfShot(gate(name).film, indexOf(name, id)).palette.paper;
    const a = titleFill(leavesAt(name, id, format === '16:9' ? 0.2 : turnEnd), left);
    const b = titleFill(leavesAt(name, id, turnEnd), right);
    assert.ok(a && b, `both titles drawn (${a}, ${b})`);
    const shownA = format === '16:9' ? a : titleFill(leavesAt(name, id, 0.2), left);
    assert.notEqual(shownA, b, `A ${shownA} vs B ${b}`);
    for (const c of [shownA, b]) assert.ok(contrastRatio(c, ground) >= 3, `${c} on ${ground}`);
  });
}

// the payoff colour is the ground's accent, which differs from its ink only where the accent reads (paper, ink): on the
// blue ground the only permitted mark is the paper, so the payoff would take the ink's colour
test('poster compare stands only on grounds where its payoff differs from the ink, across seeds', () => {
  const film = gateFilm(WIDE);
  const [idea, swap] = ['idea', 'swap'].map((id) => film.shots.find((s) => s.id === id));
  const shots = Array.from({ length: 8 }, (_, i) => ({ ...(i % 2 ? swap : idea), id: `s${i}` }));
  for (let seed = 1; seed <= 12; seed++) {
    shots.forEach((s, i) => {
      if (s.show !== 'compare') return;
      const { palette, ground } = lookOfShot({ ...film, seed, shots }, i);
      assert.notEqual(palette.accent, palette.ink, `seed ${seed} shot ${i} on ${ground}`);
      assert.ok(contrastRatio(palette.accent, palette.paper) >= 3, `seed ${seed} shot ${i}: accent on ${ground}`);
    });
  }
});

test('poster 9:16 compare: a visible swap: the unspoken side is not at full weight on frame 1, and the sides trade at the turn', () => {
  const [left, right] = SIDE_TITLES('swap');
  const early = leavesAt(TALL, 'swap', 1 / FPS), late = leavesAt(TALL, 'swap', endOf(TALL, 'swap'));
  const b0 = titleFill(early, right), b1 = titleFill(late, right);
  const a0 = titleFill(early, left), a1 = titleFill(late, left);
  assert.notEqual(b0, b1, `B on frame 1 ${b0}, at the end ${b1}`);
  assert.notEqual(a0, a1, `A on frame 1 ${a0}, at the end ${a1}`);
  // never by opacity (bans 5 and 6): every part of both sides opaque on frame 1
  const faint = ofShot(early, 'swap').filter((l) => l.opacity < 0.999 && l.node.id !== 'swap.turn').map((l) => l.node.id);
  assert.deepEqual(faint, []);
  // the unspoken side's points step with its title
  const points = (leaves) => texts(leaves).find((l) => l.node.id === 'swap.right.points');
  assert.notEqual(sampledFill(points(early).node), sampledFill(points(late).node), 'B\'s points step too');
});

// the lower third filled: B's block runs to the band's bottom edge (p6 centred each side in its half, leaving the band's
// foot empty), and no empty band over ban 2's share
const BAN_2 = 0.35;
const REACH = 0.98; // of the band's height: the content's lowest ink at least this far down
test('poster 9:16 compare: the two sides fill the band to its foot (B reaches the bottom, no band over ban 2)', () => {
  const t = endOf(TALL, 'swap');
  const { boxes, gap } = fillOf(TALL, 'swap', t);
  const area = areaOf(TALL, 'swap');
  const bottom = Math.max(...boxes.map((b) => b[1] + b[3]));
  assert.ok(bottom >= area.top + REACH * area.h, `lowest ink at ${(100 * (bottom - area.top) / area.h).toFixed(1)}% of the band`);
  assert.ok(gap <= BAN_2, `an empty band of ${(100 * gap).toFixed(0)}%`);
});

test('poster 16:9 compare: each side fills its frame (no empty band over a quarter, before and after the turn)', (t) => {
  for (const at of [0.5, endOf(WIDE, 'swap')]) {
    const { gap } = fillOf(WIDE, 'swap', at);
    t.diagnostic(`at ${at.toFixed(2)} s the largest empty band is ${(100 * gap).toFixed(1)}% (fake measure)`);
    assert.ok(gap <= MAX_BAND + 0.05, `at ${at.toFixed(2)} s an empty band of ${(100 * gap).toFixed(0)}%`);
  }
});

// ---- ruling 1: the 9:16 feed ----

test('poster 9:16 feed: the title is the slug (frame furniture), the messages the hero in the display capitals', () => {
  const end = texts(leavesAt(TALL, 'chat', endOf(TALL, 'chat')));
  const slug = end.find((l) => words(l.node).toUpperCase() === 'STUDIO');
  assert.ok(slug && slug.node.props.furniture === true, `the title as a slug: ${slug?.node.id} furniture ${slug?.node.props.furniture}`);
  const messages = end.filter((l) => /^chat\.item\d+\.text$/.test(l.node.id));
  assert.equal(messages.length, 2);
  for (const m of messages) {
    assert.equal(m.node.props.font.width, look().fonts.display.width, `${m.node.id} in the display face`);
    assert.equal(words(m.node), words(m.node).toUpperCase(), `${m.node.id} in capitals`);
    assert.ok(m.node.props.font.size >= look().scale[2], `${m.node.id} at ${m.node.props.font.size}`);
  }
});

test('poster 9:16 feed: the thread fills the band (no empty band over a fifth once both messages are in)', () => {
  const { used, gap } = fillOf(TALL, 'chat', endOf(TALL, 'chat'));
  assert.ok(used >= TALL_USE, `${(100 * used).toFixed(0)}% of the band used`);
  assert.ok(gap <= MAX_BAND, `an empty band of ${(100 * gap).toFixed(0)}%`);
});

// ---- ruling 1: the 9:16 close ----

test('poster 9:16 close: the card fills the band (no empty band over a fifth)', () => {
  const { used, gap } = fillOf(TALL, 'close', endOf(TALL, 'close'));
  assert.ok(used >= TALL_USE, `${(100 * used).toFixed(0)}% of the band used`);
  assert.ok(gap <= MAX_BAND, `an empty band of ${(100 * gap).toFixed(0)}%`);
});

// ---- ruling 2: the close's ask ----

for (const name of [WIDE, TALL]) {
  test(`poster ${name}: the close's ask is at least the look's secondary.min and on screen at least ${ASK_HOLD} s`, () => {
    const t = endOf(name, 'close') + 0.05 - ASK_HOLD;
    const ask = texts(leavesAt(name, 'close', t)).find((l) => l.node.id === 'close.ask.text');
    assert.ok(ask && ask.opacity >= 0.999, `ask at ${ask?.opacity} at ${t.toFixed(2)} s`);
    assert.ok(ask.node.props.font.size >= look().secondary.min, `ask at ${ask.node.props.font.size} units, floor ${look().secondary.min}`);
  });
}
