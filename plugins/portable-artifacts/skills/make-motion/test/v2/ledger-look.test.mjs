// The `ledger` look (looks-four plan, Task 3): the contract every look owes (helpers/look-contract.mjs) with the plan's
// table, and what is particular to ledger: the `grid` field (hairlines on the column edges, still, per-format grid), a
// locked camera with no drift, its four preferred cuts, no post pass, and one grid per format (gridTall on 9:16).
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import '../../engine/kinds/index.mjs';
import '../../engine/fields/index.mjs';
import { gridX, lookForFormat } from '../../engine/looks/index.mjs';
import { resolveLook } from '../../engine/graph/film.mjs';
import { FIELD_BLEED } from '../../engine/kinds/shared.mjs';
import { lookContract } from './helpers/look-contract.mjs';

const NAME = 'ledger';
const look = () => registries.looks.get(NAME);
const PAPER = '#fbfaf7';
const WHITE = '#ffffff'; // the plain card a clipping, a code listing or a caption strip sits on

lookContract(NAME, {
  modes: ['pro'],
  grounds: [PAPER, WHITE],
  pairs: [
    ['ink', 'paper', 4.5], ['ink2', 'paper', 4.5], ['accent', 'paper', 4.5], ['accent2', 'paper', 4.5],
    ['cat2', 'paper', 4.5], ['cat3', 'paper', 4.5], ['paper', 'accent', 4.5], ['dim', 'paper', 3],
    ['ink', WHITE, 4.5], ['ink2', WHITE, 4.5], ['accent', WHITE, 4.5],
  ],
  // the rule colour is decoration: never text, never a mark
  banned: [['rule', 'paper'], ['rule', WHITE]],
  secondaryMin: 46,
  kinds: registries.kinds.names(),
  // number: its tall composition leaves 76% of the height empty (ledger-kinds.test.mjs); parked in ledger alone
  parked: { number: true },
  // listed after its gate (looks-four Task 5): ship after fixes on both films, the cosmos precedent (gate record)
  listed: true,
});

// The canvases a field is planned for: the bled size fieldNode gives it (kinds/shared.mjs fieldNode).
const bled = (canvas) => ({ w: Math.round(canvas.w * (1 + 2 * FIELD_BLEED)), h: Math.round(canvas.h * (1 + 2 * FIELD_BLEED)) });
const WIDE = Object.freeze({ w: 1920, h: 1080 });
const TALL = Object.freeze({ w: 1080, h: 1920 });

function gridPlan(canvas, format) {
  const l = lookForFormat(look(), format);
  const { w, h } = bled(canvas);
  return registries.fields.get('grid').plan({ w, h, unit: 1, seed: 5, palette: l.palette, params: l.field.params });
}

test('the field is grid: still, so held frames are reused', () => {
  assert.equal(look().field.field, 'grid');
  assert.equal(registries.fields.get('grid').animated, false);
});

test('the grid field is deterministic: the same input plans the same, a different seed too (nothing is random)', () => {
  assert.deepEqual(gridPlan(WIDE, '16:9'), gridPlan(WIDE, '16:9'));
});

test('the grid field plans at both formats, its hairlines on the look\'s own column edges for each', () => {
  for (const [canvas, format] of [[WIDE, '16:9'], [TALL, '9:16']]) {
    const l = lookForFormat(look(), format);
    const plan = gridPlan(canvas, format);
    const { w } = bled(canvas);
    const inset = (w - canvas.w) / 2; // the field starts this far left of the canvas
    const columns = Array.from({ length: 12 }, (_, i) => gridX(l, canvas, i + 1)).concat(gridX(l, canvas, 13));
    assert.equal(plan.lines.length, columns.length, `${format}: a hairline per column start and the right margin`);
    plan.lines.forEach((x, i) => assert.ok(Math.abs(x - inset - columns[i]) < 0.5, `${format}: line ${i} at ${x - inset}, column edge ${columns[i]}`));
    assert.ok(plan.baseline > 0 && plan.baseline < plan.h, `${format}: a baseline rule inside the field`);
  }
});

test('one grid per format: 9:16 takes gridTall (margin 72, gutter 20), 16:9 the grid (96, 24)', () => {
  assert.deepEqual({ ...lookForFormat(look(), '16:9').grid }, { columns: 12, margin: 96, gutter: 24 });
  assert.deepEqual({ ...lookForFormat(look(), '9:16').grid }, { columns: 12, margin: 72, gutter: 20 });
  assert.deepEqual({ ...resolveLook({ version: 2, look: NAME, format: '9:16', shots: [] }).grid }, { columns: 12, margin: 72, gutter: 20 }, 'a film resolves its format\'s grid');
});

test('a look without gridTall resolves to itself at every format (desk, pop, cosmos unchanged)', () => {
  for (const name of ['desk', 'pop', 'cosmos']) {
    for (const format of ['16:9', '9:16', '1:1', '4:5']) assert.equal(lookForFormat(registries.looks.get(name), format), registries.looks.get(name), `${name} ${format}`);
  }
});

test('a step-4 hero is at least three times the secondary floor (five ascending steps kept)', () => {
  const { scale, secondary } = look();
  assert.ok(scale[3] >= 3 * secondary.min, `step 4 ${scale[3]} >= 3 x ${secondary.min}`);
  assert.ok(scale.every((v, i) => i === 0 || v > scale[i - 1]));
});

test('camera locked with no drift', () => {
  const { closeUp, ...camera } = look().camera;
  assert.deepEqual(camera, { drift: 0, style: 'locked' });
  // the close-up shares (region-off-frame, ruling 4) are data for the close-up's size, not a camera move
  assert.deepEqual(Object.keys(closeUp ?? {}).sort(), ['height', 'minGain', 'pad', 'width']);
});

test('cutPalette is the four named cuts', () => {
  assert.deepEqual([...look().cutPalette], ['cut', 'match', 'fade', 'wipe']);
});

test('post is all zero: no grain, halftone or bloom', () => {
  assert.deepEqual({ ...look().post }, { grain: 0, halftone: 0, bloom: 0 });
});

test('every colour change is mixed in OKLab', () => {
  assert.equal(look().colorSpace, 'oklab');
});

test('sounds: a paper wipe, clicks on labels, items, events and changes, a ding on landing, nothing else', () => {
  const { sounds } = look();
  assert.deepEqual(Object.entries(sounds.cut).filter(([, v]) => v !== null), [['wipe', 'paper']]);
  assert.deepEqual(Object.entries(sounds.device).filter(([, v]) => v !== null).sort(), [['change', 'click'], ['event', 'click'], ['item', 'click'], ['label', 'click']]);
  assert.equal(sounds.emphasis, null);
  assert.equal(sounds.land, 'ding');
});
