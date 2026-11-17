// poster: no banned pairing on any ground (looks-four plan, poster section: ink on blue, blue on ink, red on blue and blue
// on red are banned). Every kind's example is stood on each of the four grounds and swept: text, plate or mark (a filled
// path, or a stroked line) against what lies under it must never be one of the four. The p3 walk covered text under step
// 3 only; the plate colour was red on the blue ground and the map land was red on blue and blue on red.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import '../../engine/kinds/index.mjs';
import { snapshotOf } from './helpers/bar.mjs';
import { filmFor, filmOf, all } from './helpers/kinds.mjs';
import { lookOfShot } from '../../engine/graph/film.mjs';
import { lookOnGround } from '../../engine/looks/grounds.mjs';
import { contrastRatio } from '../../shared/contrast.mjs';
import { contrastFindings } from '../../engine/review/contrast.mjs';
import { prepareFilm } from '../../scripts/v2/prepare/index.mjs';

const GROUND_SHOTS = 12; // a film this long at seed 1 stands a shot on each of the four grounds (asserted)
const SAMPLES = Object.freeze([0.5, 1, 2.5]);
const HEX = /^#[0-9a-f]{6}$/i;
const CASES = Object.freeze([['16:9', 'pro'], ['9:16', 'pro'], ['9:16', 'viral']]);

const base = registries.looks.get('poster').palette;
const BANNED = new Set([[base.ink, base.accent2], [base.accent2, base.ink], [base.accent, base.accent2], [base.accent2, base.accent]].map((pair) => pair.join('/').toLowerCase()));

// the topmost opaque filled path drawn before `leaf` whose box holds the leaf's centre: the colour it sits on
function under(leaves, leaf) {
  const [cx, cy] = [leaf.bbox[0] + leaf.bbox[2] / 2, leaf.bbox[1] + leaf.bbox[3] / 2];
  const holds = (b) => b && cx >= b[0] && cx <= b[0] + b[2] && cy >= b[1] && cy <= b[1] + b[3];
  const lower = leaves.slice(0, leaves.indexOf(leaf)).filter((n) => n.type === 'path' && HEX.test(n.props.fill ?? '') && n.opacity >= 1 && holds(n.bbox));
  return lower.at(-1)?.props.fill ?? null;
}

// every colour a leaf paints: a text's fill, a path's fill and its stroke
const paintsOf = (n) => (n.type === 'text' ? [n.props.fill] : n.type === 'path' ? [n.props.fill, n.props.stroke] : []).filter((c) => HEX.test(c ?? ''));

export function bannedPairs(sampled) {
  const leaves = all(sampled);
  return leaves.filter((n) => n.opacity > 0 && n.id !== 'ground').flatMap((n) => {
    const ground = under(leaves, n);
    return ground === null ? [] : paintsOf(n).map((c) => `${c}/${ground}`.toLowerCase()).filter((pair) => BANNED.has(pair)).map((pair) => `${n.id}: ${pair}`);
  });
}

// a plate, highlight bar, pill or keyline must show: at least 3:1 against what lies under it (a bar the colour of its
// ground was invisible on the blue ground, the only colour blue permits being the paper)
const MARK_ID = /(\.keyline|\.pill|\.plate|\.band|\.hl\d*|\.on\d+)$/;
const SHOWS = 3;
// its ground: the shot's ground sheet, or for a URL pill the browser frame it sits on
const baseOf = (leaves, n) => leaves.find((l) => (n.id.endsWith('.pill') ? l.id === n.id.replace(/\.pill$/, '.frame.body') : l.id === 'ground'));
export function weakMarks(sampled) {
  const leaves = all(sampled);
  return leaves.filter((n) => n.type === 'path' && n.opacity > 0 && MARK_ID.test(n.id) && HEX.test(n.props.fill ?? '')).flatMap((n) => {
    const ground = baseOf(leaves, n)?.props.fill;
    const ratio = ground === undefined ? Infinity : contrastRatio(n.props.fill, ground);
    return ratio < SHOWS ? [`${n.id}: ${n.props.fill}/${ground} is ${ratio.toFixed(2)}:1`] : [];
  });
}

const KINDS =Object.freeze(registries.kinds.names().filter((k) => k !== 'free'));
for (const kind of KINDS) {
  for (const [format, mode] of CASES) {
    test(`poster ${kind} at ${format} in ${mode}: no text, plate or mark on a banned pairing, on every ground`, () => {
      const ex = registries.kinds.get(kind).example;
      const shots = Array.from({ length: GROUND_SHOTS }, (_, i) => ({ ...ex, id: `${kind}${i}`, ...(ex.src === undefined ? {} : { src: 'shot.png' }) }));
      const film = filmOf(shots, 'poster', format, { mode });
      const prepared = ['code', 'map'].includes(kind) ? prepareFilm(film, { filmDir: '.' }).prepared : {};
      const built = filmFor(shots, 'poster', format, { mode }, { prepared });
      const grounds = new Set(shots.map((_, i) => lookOfShot(film, i).ground));
      assert.equal(grounds.size, 4, `the film covers every ground (${[...grounds]})`);
      const bad = shots.flatMap((_, i) => SAMPLES.flatMap((t) => { const s = snapshotOf(built.sampleShot(i, t)); return [...bannedPairs(s), ...weakMarks(s)].map((b) => `${lookOfShot(film, i).ground} ${t}s ${b}`); }));
      assert.deepEqual([...new Set(bad)], []);
    });
  }
}

// the devices an author fires (no example does): the highlight bar was the plate colour, red on the blue ground
for (const [format, mode] of CASES) {
  test(`poster devices at ${format} in ${mode}: no highlight, circle, underline, bracket or arrow on a banned pairing, on every ground`, () => {
    const on = [{ at: 'word:server', do: 'highlight', target: 'word:3' }, { at: 'word:file', do: 'circle', target: 'word:1' }, { at: 'start', do: 'underline', target: 'word:0' },
      { at: 'start', do: 'bracket', target: 'word:2' }, { at: 'start', do: 'arrow', target: 'text' }];
    const shots = Array.from({ length: GROUND_SHOTS }, (_, i) => ({ id: `s${i}`, show: 'statement', say: 'One file. No server.', on }));
    const film = filmOf(shots, 'poster', format, { mode });
    const built = filmFor(shots, 'poster', format, { mode });
    const grounds = new Set(shots.map((_, i) => lookOfShot(film, i).ground));
    assert.equal(grounds.size, 4, `the film covers every ground (${[...grounds]})`);
    const bad = shots.flatMap((_, i) => SAMPLES.flatMap((t) => { const s = snapshotOf(built.sampleShot(i, t)); return [...bannedPairs(s), ...weakMarks(s)].map((b) => `${lookOfShot(film, i).ground} ${t}s ${b}`); }));
    assert.deepEqual([...new Set(bad)], []);
  });
}

// the palette itself: on every ground the plate is a colour the ground permits and shows at 3:1 or more against it
test('poster plate: permitted on its ground and at least 3:1 against it, on every ground', () => {
  const look = registries.looks.get('poster');
  for (const key of look.grounds) {
    const p = lookOnGround(look, key).palette;
    const permitted = look.on[key].map((k) => look.palette[k].toLowerCase());
    assert.ok(permitted.includes(p.plate.toLowerCase()), `${key}: plate ${p.plate} is not one of ${permitted}`);
    assert.ok(contrastRatio(p.plate, p.paper) >= SHOWS, `${key}: plate ${p.plate} on ${p.paper} is ${contrastRatio(p.plate, p.paper).toFixed(2)}:1`);
  }
});

// the map's coast stays visible on every ground: where the land is the ground's own colour (blue: no permitted fill)
// the line between land masses is the ink, not the same colour as the land
test('poster map: the coast line differs from the land on every ground', () => {
  const look = registries.looks.get('poster');
  for (const key of look.grounds) {
    const p = lookOnGround(look, key).palette;
    assert.notEqual(p.landLine.toLowerCase(), p.textPlate.toLowerCase(), `${key}: line ${p.landLine} on land ${p.textPlate}`);
  }
});

// words under a highlight bar are judged against the bar, not the ground: at least 4.5:1 (the bar was the plate, and on
// the blue ground it was cream under cream words)
const BAR_TEXT = 4.5;
const BAR_AT = 2.5; // s: the bar has landed
export function wordUnderBar(sampled, shotId, index) {
  const leaves = all(sampled);
  const bar = leaves.find((n) => n.id === `${shotId}.on0` && n.type === 'path');
  const lines = leaves.filter((n) => n.type === 'text' && new RegExp(`^${shotId}\\.text\\.line\\d+$`).test(n.id)).sort((a, b) => Number(a.id.split('line')[1]) - Number(b.id.split('line')[1]));
  const words = lines.flatMap((l) => l.layout.lines[0].words.map((w, j) => l.words?.[j]?.fill ?? l.props.fill));
  return { bar: bar?.props.fill, text: words[index] };
}
for (const [format, mode] of CASES) {
  test(`poster highlight at ${format} in ${mode}: the word under the bar reads at 4.5:1 against the bar, on every ground`, () => {
    const on = [{ at: 'word:server', do: 'highlight', target: 'word:3' }];
    const shots = Array.from({ length: GROUND_SHOTS }, (_, i) => ({ id: `h${i}`, show: 'statement', say: 'One file. No server.', on }));
    const film = filmOf(shots, 'poster', format, { mode });
    const built = filmFor(shots, 'poster', format, { mode });
    const bad = shots.flatMap((s, i) => {
      const { bar, text } = wordUnderBar(snapshotOf(built.sampleShot(i, BAR_AT)), s.id, 3);
      const ratio = contrastRatio(text, bar);
      return ratio < BAR_TEXT ? [`${lookOfShot(film, i).ground}: word ${text} on bar ${bar} is ${ratio.toFixed(2)}:1`] : [];
    });
    assert.deepEqual([...new Set(bad)], []);
  });
}

// the contrast review judges a shape over part of a line against the words it reaches, not the whole line: a cream bar
// under one cream-on-cream word is reported, and the cream word beside it (not under the bar) is not
test('the contrast review judges a bar against the words it lies under, not the whole line', () => {
  const word = (index, x) => ({ index, x, width: 100 });
  const text = (fill, words) => ({ type: 'text', id: 't', props: { fill }, x: 0, y: 0, rotate: 0, scale: 1, words: [{ fill }, { fill: base.ink }], layout: { lines: [{ words }] }, opacity: 1, children: [], bbox: [0, 0, 300, 100] });
  const bar = { type: 'path', id: 'bar', props: { fill: base.paper }, opacity: 1, children: [], bbox: [110, 0, 100, 100] };
  const ground = { type: 'path', id: 'ground', props: { fill: base.accent2 }, opacity: 1, children: [], bbox: [0, 0, 1000, 1000] };
  const judge = (under) => {
    const t = { ...text(base.paper, [word(0, 0), word(1, 110), word(2, 220)]), words: [{ fill: base.paper }, { fill: under }, { fill: base.paper }] };
    return contrastFindings([{ node: t, ink: [0, 0, 300, 100], role: 'hero', opacity: 1 }], [ground, bar, t], { background: base.accent2 }, (kind, rule, id, message) => ({ kind, rule, id, message }));
  };
  // word 0 (cream, x 0-100) and word 2 (cream, x 220-320) lie clear of the bar (x 110-210); word 1 lies under it
  assert.deepEqual(judge(base.ink), [], 'ink on the cream bar, cream beside it on the blue ground: nothing reported');
  assert.equal(judge(base.paper).length, 1, 'cream under the cream bar is reported');
});

// the guard fires: a red mark planted on the blue ground is reported, and cream on blue is not
test('poster pairings: the sweep reports a red mark on the blue ground and passes cream on blue', () => {
  const rect = (id, fill, bbox) => ({ type: 'path', id, opacity: 1, bbox, props: { fill }, children: [] });
  const ground = rect('ground', base.accent2, [0, 0, 100, 100]);
  assert.deepEqual(bannedPairs([ground, rect('m', base.accent, [10, 10, 20, 20])]), [`m: ${base.accent}/${base.accent2}`.toLowerCase()]);
  assert.deepEqual(bannedPairs([ground, rect('m', base.paper, [10, 10, 20, 20])]), []);
  // and a keyline the colour of its ground is reported as not showing, a cream one is not
  assert.equal(weakMarks([ground, rect('x.keyline', base.accent2, [10, 10, 20, 20])]).length, 1);
  assert.deepEqual(weakMarks([ground, rect('x.keyline', base.paper, [10, 10, 20, 20])]), []);
});
