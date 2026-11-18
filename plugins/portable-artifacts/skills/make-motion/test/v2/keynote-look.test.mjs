// The `keynote` look (looks-four plan, Task 9): the contract every look owes (helpers/look-contract.mjs) with the plan's
// table, computed on all four grounds (paper, the mesh's two blob colours at full strength, which is the worst case, and
// the white card), and what is particular to keynote: a light paper (the dark variant cannot come back by a data edit),
// a camera that drifts in every shot, no bloom, the mesh in its two washes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import '../../engine/kinds/index.mjs';
import '../../engine/fields/index.mjs';
import { listEntries } from '../../scripts/v2/list.mjs';
import { expandShot } from './helpers/kinds.mjs';
import { lookContract } from './helpers/look-contract.mjs';

const NAME = 'keynote';
const look = () => registries.looks.get(NAME);
const PAPER = '#f5f5f7';
const BLOB_A = '#dfe4ff';
const BLOB_B = '#ffe6dc';
const CARD = '#ffffff';
const GROUNDS = Object.freeze([PAPER, BLOB_A, BLOB_B, CARD]);
const LIGHT_PAPER = 0.8; // relative luminance the paper must exceed
const TEXT_MIN = 4.5;
const MARK_MIN = 3;
// kinds parked in keynote alone, each with its reason in keynote.mjs (kinds.<kind>.experimental)
export const PARKED = Object.freeze(Object.fromEntries(Object.entries(look().kinds).filter(([, d]) => d.experimental === true).map(([k]) => [k, true])));

lookContract(NAME, {
  modes: ['pro'],
  grounds: [...GROUNDS],
  // the table's pairs on every ground: ink and ink2 text at 4.5, the accent (text and the ring) at 4.5 on paper and card
  // and 3 on the washes (display and marks only there), dim marks at 3, white on the accent (the me bubble) at 4.5
  pairs: [
    ...GROUNDS.flatMap((g) => [['ink', g, TEXT_MIN], ['ink2', g, TEXT_MIN], ['dim', g, MARK_MIN]]),
    ['accent', PAPER, TEXT_MIN], ['accent', CARD, TEXT_MIN], ['accent', BLOB_A, MARK_MIN], ['accent', BLOB_B, MARK_MIN],
    [CARD, 'accent', TEXT_MIN],
  ],
  // the rule colour is decoration: never text, never a mark
  banned: GROUNDS.map((g) => ['rule', g]),
  secondaryMin: 46,
  kinds: registries.kinds.names(),
  parked: PARKED,
  listed: false,
});

// WCAG relative luminance of #rrggbb
function luminance(hex) {
  const channel = (i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

test('the palette\'s paper is light: relative luminance over 0.8 (no dark keynote by a data edit)', () => {
  assert.ok(luminance(look().palette.paper) > LIGHT_PAPER, `${look().palette.paper}: ${luminance(look().palette.paper).toFixed(3)}`);
  assert.ok(luminance(look().palette.ink) < 0.05, 'ink is near black');
});

test('post.bloom is 0, and the grain is fine', () => {
  assert.equal(look().post.bloom, 0);
  assert.equal(look().post.halftone, 0);
  assert.ok(look().post.grain > 0 && look().post.grain <= 0.02);
});

test('the field is the mesh in the two washes at half strength', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(look().field)), { field: 'mesh', params: { blobs: 4, strength: 0.5, colours: ['wash', 'wash2'], sway: 1 } });
  assert.equal(look().palette.wash, BLOB_A);
  assert.equal(look().palette.wash2, BLOB_B);
});

const EXAMPLES = Object.freeze(registries.kinds.names().map((kind) => {
  const example = listEntries('kinds').find((e) => e.name === kind)?.example ?? registries.kinds.get(kind).example;
  return { kind, shot: example.src === undefined ? example : { ...example, src: 'shot.png' } };
}));

// The x the camera's drift layer holds at t, from its keys (linear between them).
const xAt = (layer, t) => {
  const keys = layer.filter((k) => k.x !== undefined);
  const after = keys.findIndex((k) => k.t >= t);
  if (after <= 0) return keys[Math.max(0, after)].x;
  const [a, b] = [keys[after - 1], keys[after]];
  return a.x + ((b.x - a.x) * (t - a.t)) / (b.t - a.t);
};

for (const format of ['16:9', '9:16']) {
  test(`the camera drifts in every shot at ${format}: every kind's example has a moving drift layer`, () => {
    for (const { kind, shot } of EXAMPLES) {
      if (kind === 'map' || kind === 'code') continue; // their examples need the prepare step: keynote-kinds.test.mjs builds them
      if (kind === 'free') continue; // free draws only what its author gives it, camera included ("as every look")
      const { camera, timing } = expandShot(shot, NAME, format);
      const drift = camera.find((layer) => layer.some((k) => k.x !== undefined));
      assert.ok(drift, `${kind}: a drift layer`);
      assert.ok(Math.abs(xAt(drift, timing.duration) - xAt(drift, 0)) >= 17, `${kind}: drifts 18 units over the shot`);
    }
  });
}

test('the camera style is the continuous desk drift, 18 units', () => {
  assert.deepEqual({ ...look().camera }, { drift: 18, style: 'desk' });
});

// n4: the plan's six cuts plus the dip and the wipe gate-keynote-2 ruling 8 takes between two type shots
test('cutPalette is the six named cuts plus the type cuts; a crossfade takes 0.5 s; every colour change mixes in OKLab', () => {
  assert.deepEqual([...look().cutPalette], ['cut', 'match', 'crossfade', 'zoom', 'blur', 'cross-zoom', 'fade', 'wipe']);
  assert.equal(look().cutStyle.crossfade.duration, 0.5);
  assert.equal(look().colorSpace, 'oklab');
});

test('sounds as the plan table: whooshes on zoom, blur and cross-zoom cuts and the zoom device, a chime on the sweep', () => {
  const { sounds } = look();
  assert.deepEqual(Object.entries(sounds.cut).filter(([, v]) => v !== null).sort(), [['blur', 'whoosh'], ['cross-zoom', 'whoosh'], ['zoom', 'whoosh']]);
  assert.deepEqual(Object.entries(sounds.device).filter(([, v]) => v !== null).sort(), [['item', 'click'], ['numeral', 'sub'], ['sweep', 'chime'], ['zoom', 'whoosh']]);
  assert.equal(sounds.emphasis, null);
  assert.equal(sounds.land, 'sub');
});
