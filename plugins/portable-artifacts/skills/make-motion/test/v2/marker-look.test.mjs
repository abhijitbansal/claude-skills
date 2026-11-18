// The `marker` look (looks-four plan, Task 12): the contract every look owes (helpers/look-contract.mjs) with the plan's
// table (one ground, the board, computed in the contract), and what is particular to marker: a linear stroke for every
// move with no scale and no travel, the cut palette, the board field, the hand data and the hand layer built for its
// shots, screen and code refused with the looks that support them, race the one parked chart type, a locked camera.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import '../../engine/kinds/index.mjs';
import '../../engine/fields/index.mjs';
import { kindSupportProblems, supportsKind, isParkedChartType, isParkedKind } from '../../engine/looks/index.mjs';
import { handLayer } from '../../engine/hand/index.mjs';
import { lookContract } from './helpers/look-contract.mjs';
import { expandShot, filmFor, all } from './helpers/kinds.mjs';

const NAME = 'marker';
const look = () => registries.looks.get(NAME);
const BOARD = '#fdfdfb';
const TEXT_MIN = 4.5;
// the kinds marker has data for: the sixteen less screen and code; those parked in marker alone are named in marker.mjs
const SUPPORTED = Object.freeze(registries.kinds.names().filter((k) => k !== 'screen' && k !== 'code'));
export const PARKED = Object.freeze(Object.fromEntries(Object.entries(look().kinds).filter(([, d]) => d.experimental === true).map(([k]) => [k, true])));

lookContract(NAME, {
  modes: ['pro'],
  grounds: [BOARD],
  pairs: [['ink', BOARD, TEXT_MIN], ['ink2', BOARD, TEXT_MIN], ['accent', BOARD, TEXT_MIN]],
  banned: [['rule', BOARD]],
  secondaryMin: 60,
  kinds: Object.keys(look().kinds),
  parked: PARKED,
});

test('screen and code are excluded: refused with the looks that support them; every other registered kind has data', () => {
  for (const kind of ['screen', 'code']) {
    assert.equal(supportsKind(look(), kind), false, kind);
    const [problem] = kindSupportProblems(kind, look());
    assert.match(problem.message, /is not supported by look "marker"; the looks that support it: /, kind);
  }
  assert.deepEqual(Object.keys(look().kinds).sort(), SUPPORTED.filter((k) => look().kinds[k] !== undefined).sort());
  assert.ok(supportsKind(look(), 'statement') && supportsKind(look(), 'free'));
});

test('race is the one parked chart type, once the chart kind is there', () => {
  if (!supportsKind(look(), 'chart')) return;
  assert.deepEqual([...look().kinds.chart.experimentalTypes], ['race']);
  assert.equal(isParkedChartType(look(), 'race'), true);
});

test('every move is a linear stroke: no scale, no travel, no spring', () => {
  for (const [name, move] of Object.entries(look().moves)) {
    if (move === null) continue;
    assert.equal(move.ease, 'linear', `${name} ease`);
    assert.equal(move.scale, undefined, `${name} has no scale`);
    assert.equal(move.dist, undefined, `${name} has no dist`);
    assert.equal(move.step, undefined, `${name}: the hand bends the stroke, nothing steps`);
  }
  assert.equal(look().moves.exit.dur, 0, 'a board leaves only by the erase');
  assert.equal(look().moves.slam.dur, 0);
  assert.equal(look().moves.settle.dur, 0);
  assert.equal(look().moves.count.dur, 0.8);
});

test('cutPalette is cut and erase; every registered cut is listed; erase sounds as the erase cue', () => {
  assert.deepEqual([...look().cutPalette], ['cut', 'erase']);
  assert.deepEqual([...look().cuts].sort(), registries.cuts.names().sort());
  assert.equal(look().sounds.cut.erase, 'erase');
  assert.equal(Object.entries(look().sounds.cut).filter(([, v]) => v !== null).length, 1, 'erase is the one cut cue');
  assert.equal(look().sounds.emphasis, 'marker');
  assert.equal(look().sounds.land, null);
});

test('the field is the board, still, with the look\'s margins; the camera is locked; grain 0.006 and no halftone or bloom', () => {
  assert.equal(look().field.field, 'board');
  assert.equal(registries.fields.get('board').animated, false);
  assert.deepEqual({ drift: look().camera.drift, style: look().camera.style }, { drift: 0, style: 'locked' });
  assert.equal(look().camera.closeUp.width, 0.86, 'a region close-up is a cut to a window, as in ledger');
  assert.deepEqual({ ...look().post }, { grain: 0.006, halftone: 0, bloom: 0 });
});

test('the type is Caveat in every role at 700, 600 and 600; the scale is the plan\'s; secondary.min is 60', () => {
  assert.deepEqual(Object.values(look().fonts).map((f) => [f.family, f.weight]), [['Caveat', 700], ['Caveat', 600], ['Caveat', 600]]);
  assert.deepEqual([...look().scale], [44, 60, 92, 150, 240]);
  assert.equal(look().secondary.min, 60);
  assert.deepEqual([look().lineHeight.display, look().lineHeight.text], [1.0, 1.2]);
  assert.deepEqual([look().grid.margin, look().grid.gutter, look().gridTall.margin, look().gridTall.gutter], [110, 24, 80, 20]);
});

test('accent2 is ink2, not a copy of the accent hex; the only accent stroke colour key is "accent"', () => {
  const { palette, devices, hand } = look();
  assert.equal(palette.accent2, palette.ink2);
  assert.notEqual(palette.accent2.toLowerCase(), palette.accent.toLowerCase());
  for (const [name, style] of Object.entries(devices)) {
    if (style.color !== undefined) assert.ok(Object.hasOwn(palette, style.color), `${name}.color is a palette key, not a hex`);
  }
  assert.ok(Object.values(hand.colours).every((c) => Object.hasOwn(palette, c) || !/^#[0-9a-f]{6}$/i.test(c) || ['#eec39d', '#d9a680', '#2b2e33'].includes(c)), 'hand colours: palette keys or the three skin and barrel tones');
});

test('the hand: the look carries its data and a statement shot\'s nodes come back with the hand group laid over them', () => {
  const hand = look().hand;
  // rest 0.3, not the plan's 1.2: a hand that waits 1.2 s over the stroke it just finished covers that text (list, compare)
  assert.deepEqual({ rest: hand.rest, maxSpeed: hand.maxSpeed, angle: hand.angle }, { rest: 0.3, maxSpeed: 2600, angle: 55 });
  assert.deepEqual({ ...hand.erase }, { passes: 3, smear: 0.4 });
  for (const format of ['16:9', '9:16']) {
    const out = expandShot({ id: 's', show: 'statement', say: 'Numbers need *sources* on the board.' }, NAME, format);
    const layered = handLayer(out.nodes, out.timing, out.ctx);
    assert.notEqual(layered, out.nodes, `${format}: a new node list`);
    assert.equal(layered.at(-1).id, 'hand');
    assert.equal(layered.at(-1).props.role, 'hand');
  }
});

test('a marker shot is drawn, never faded: no text or path node has a part-way opacity track, in the hand layer\'s output', () => {
  const shots = [
    { id: 'a', show: 'statement', say: 'Every number needs a *source*.' },
    { id: 'b', show: 'statement', say: 'So we draw the source under it, and *then* we write it down.' },
  ];
  for (const format of ['16:9', '9:16']) {
    for (const shot of shots) {
      const out = expandShot(shot, NAME, format);
      const layered = handLayer(out.nodes, out.timing, out.ctx);
      assert.equal(layered.at(-1).id, 'hand', `${shot.id} ${format}: the hand is last`);
      const drawn = all(layered.slice(0, -1)).filter((x) => x.type === 'text' || x.type === 'path');
      assert.ok(drawn.length >= 2, 'a text and its underline');
      for (const n of drawn) {
        assert.ok((n.tracks.opacity?.points ?? []).every((k) => k.v === 0 || k.v === 1), `${n.id}: opacity steps, never part-way`);
        for (const w of n.wordTracks ?? []) assert.ok((w.opacity?.points ?? []).every((k) => k.v === 0 || k.v === 1), `${n.id}: word opacity steps`);
      }
    }
  }
});

test('frame 0 of a marker statement holds a complete first element: its text is revealed whole at t = 0', () => {
  const out = expandShot({ id: 's', show: 'statement', say: 'Numbers need *sources* on the board.' }, NAME, '16:9');
  const layered = handLayer(out.nodes, out.timing, out.ctx);
  const lines = layered.filter((n) => n.type === 'text');
  assert.ok(lines.length >= 1);
  for (const n of lines) assert.equal(n.tracks.reveal.points[0].v, 1, `${n.id}: the reveal is 1 on frame 0`);
});

test('written words are never ghosted or held back: the end kind\'s word opacity steps are dropped, every written line is whole from its reveal', () => {
  const out = expandShot({ id: 'e', show: 'end', say: 'Every number, with its *source*.', ask: 'Start today', mark: 'make-motion' }, NAME, '16:9');
  const raw = all(out.nodes).filter((n) => n.type === 'text' && (n.wordTracks ?? []).some((w) => w.opacity !== undefined));
  assert.ok(raw.length > 0, 'the kind itself builds word opacity steps (the premise of the test)');
  const layered = handLayer(out.nodes, out.timing, out.ctx);
  for (const n of all(layered).filter((x) => x.type === 'text')) {
    for (const w of n.wordTracks ?? []) assert.deepEqual(Object.keys(w), [], `${n.id}: no word track holds a word back or greys it`);
  }
});
