// The `poster` look (looks-four plan, Task 6): the contract every look owes (helpers/look-contract.mjs) with the plan's
// four grounds, its eight permitted pairings and four banned ones, and what is particular to poster: a ground a shot
// that never repeats its neighbour's, carried as an opaque sheet first in the shot (so the contrast review judges a text
// on the ground it sits on), the `flat` field painting that ground with its cut-paper shapes outside the text area, the
// pairing table every kind's text colour comes from, and display widths only in the six stretch keywords.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import '../../engine/kinds/index.mjs';
import '../../engine/fields/index.mjs';
import { groundKeys, shotLook, GROUND_ID } from '../../engine/looks/grounds.mjs';
import { stackArea } from '../../engine/kinds/stack.mjs';
import { STRETCH_KEYWORDS } from '../../engine/fonts/index.mjs';
import { contrastFindings } from '../../engine/review/contrast.mjs';
import { contrastRatio } from '../../shared/contrast.mjs';
import { lookContract } from './helpers/look-contract.mjs';
import { filmFor, expandIn, filmOf, all, canvasOf, platformOf } from './helpers/kinds.mjs';
import { reviewRoom } from '../../engine/kinds/code-fit.mjs';
import { snapshotOf } from './helpers/bar.mjs';

const NAME = 'poster';
const look = () => registries.looks.get(NAME);
const PAPER = '#f2ede2', RED = '#d92b1c', BLUE = '#1f3fc4', INK = '#141414';
const FORMATS = Object.freeze(['16:9', '9:16']);
const DISPLAY_FROM_STEP = 3; // red on paper and ink on red are display sizes only

lookContract(NAME, {
  modes: ['pro', 'viral'],
  grounds: [PAPER, RED, BLUE, INK],
  pairs: [
    ['ink', 'paper', 4.5], ['accent', 'paper', 3], ['accent2', 'paper', 3],
    ['paper', 'accent', 3], ['ink', 'accent', 3],
    ['paper', 'accent2', 3],
    ['paper', 'ink', 3], ['accent', 'ink', 3],
  ],
  banned: [['ink', 'accent2'], ['accent', 'accent2'], ['accent2', 'accent'], ['accent2', 'ink']],
  secondaryMin: 52,
  kinds: registries.kinds.names(),
  // number: at 9:16 in viral its digits overflow poster's numeral floor (poster.mjs); parked in poster alone
  parked: { number: true },
});

const tenShots = () => Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, show: 'statement', text: `Shot number ${i + 1} here`, hold: 1 }));

test('no two neighbouring shots of a ten-shot film get the same ground, for several seeds', () => {
  for (const seed of [1, 2, 7, 99]) {
    const keys = groundKeys(look(), 10, seed);
    assert.equal(keys.length, 10);
    keys.forEach((k, i) => assert.ok(look().grounds.includes(k), `${k} is a ground`));
    keys.slice(1).forEach((k, i) => assert.notEqual(k, keys[i], `seed ${seed}: shots ${i} and ${i + 1} share ${k}`));
    assert.deepEqual(groundKeys(look(), 10, seed), keys, 'the same seed picks the same grounds');
  }
});

test('every shot\'s first node is the opaque ground sheet in the colour the field paints', () => {
  for (const format of FORMATS) {
    const film = filmFor(tenShots(), NAME, format);
    const keys = groundKeys(look(), 10, 1);
    film.backgrounds.forEach((_, i) => {
      const nodes = film.sampleShot(i, 0.5);
      const [first] = nodes;
      const field = all(nodes).find((n) => n.type === 'field');
      assert.equal(first.id, GROUND_ID, `${format} shot ${i}: the sheet comes first`);
      assert.equal(first.type, 'path');
      assert.equal(first.opacity, 1);
      assert.equal(first.props.fill, look().palette[keys[i]], `${format} shot ${i}: the sheet is the ${keys[i]} ground`);
      assert.equal(field.props.palette.paper, first.props.fill, 'the field paints the same ground');
      assert.equal(film.backgrounds[i], first.props.fill, 'the shot background is the ground too');
    });
  }
});

// A sampled text of one word planted over the shot's own nodes, with its bbox: what the contrast review sees.
function plantedText(fill, box) {
  return { type: 'text', id: 'planted', props: { fill }, layout: { lines: [{ words: [{ index: 0 }] }] }, opacity: 1, children: [], bbox: box };
}

test('the contrast review reports ink text on the blue ground, and nothing for paper text on the red ground', () => {
  const keys = groundKeys(look(), 10, 1);
  const film = filmFor(tenShots(), NAME, '16:9');
  const blue = keys.indexOf('accent2'), red = keys.indexOf('accent');
  assert.ok(blue >= 0 && red >= 0, `the ten shots hold a blue and a red ground: ${keys.join(', ')}`);
  const judge = (index, fill) => {
    const sampled = snapshotOf(film.sampleShot(index, 0.5));
    const text = { ...plantedText(fill, [400, 400, 300, 100]), bbox: [400, 400, 300, 100] };
    return contrastFindings([{ node: text, ink: [400, 400, 300, 100], role: 'hero', opacity: 1 }], [...sampled, text], { background: film.backgrounds[index] },
      (kind, rule, id, message) => ({ kind, rule, id, message }));
  };
  assert.equal(judge(blue, INK).length, 1, 'ink on blue is reported');
  assert.deepEqual(judge(red, PAPER), [], 'paper on red passes');
});

test('desk, pop, cosmos and ledger get no ground sheet: shotLook returns the look itself', () => {
  for (const name of ['desk', 'pop', 'cosmos', 'ledger']) {
    const l = registries.looks.get(name);
    assert.equal(shotLook(l, 0, 1), l, name);
    const film = filmFor([{ id: 'a', show: 'statement', text: 'A plain line', hold: 1 }], name, '16:9');
    assert.ok(!all(film.sampleShot(0, 0.5)).some((n) => n.id === GROUND_ID), `${name}: no sheet`);
  }
});

test('the field\'s cut-paper shapes lie outside the text area the kind composes in, at both formats and both modes', () => {
  for (const format of FORMATS) {
    for (const mode of ['pro', 'viral']) {
      for (let i = 0; i < 4; i++) {
        const extra = { mode, seed: 11 + i };
        const area = stackArea(expandIn(filmOf(tenShots().slice(0, 4), NAME, format, extra), i).ctx);
        const field = all(filmFor(tenShots().slice(0, 4), NAME, format, extra).sampleShot(i, 0.5)).find((n) => n.type === 'field');
        assert.deepEqual(field.props.params.clear, [area.left, area.top, area.w, area.h], 'the field is told the text area');
        const plan = registries.fields.get('flat').plan({ w: field.props.w, h: field.props.h, unit: field.props.unit, seed: field.props.seed, palette: field.props.palette, params: field.props.params });
        assert.ok(plan.shapes.length <= 2, 'at most two shapes');
        for (const shape of plan.shapes) {
          const [x, y, w, h] = shape.box.map((v, k) => v + (k === 0 ? field.props.x : k === 1 ? field.props.y : 0));
          const meets = x < area.left + area.w && area.left < x + w && y < area.top + area.h && area.top < y + h;
          assert.ok(!meets, `${format} ${mode} shot ${i}: ${shape.kind} at ${[x, y, w, h].map(Math.round)} meets the text area ${[area.left, area.top, area.w, area.h].map(Math.round)}`);
        }
      }
    }
  }
});

test('the flat field is still and deterministic', () => {
  const flat = registries.fields.get('flat');
  assert.equal(flat.animated, false);
  const input = { w: 2150, h: 1210, unit: 1, seed: 3, palette: shotLook(look(), 0, 1).palette, params: { ...look().field.params, clear: [100, 100, 1700, 800] } };
  assert.deepEqual(flat.plan(input), flat.plan(input));
});

// The ground a text sits on: the last opaque path or field drawn before it whose box holds its centre (a plate, a card),
// else the sheet.
function groundUnder(sampled, text) {
  const leaves = all(sampled);
  const at = leaves.indexOf(text);
  const [cx, cy] = [text.bbox[0] + text.bbox[2] / 2, text.bbox[1] + text.bbox[3] / 2];
  const holds = (b) => b && cx >= b[0] && cx <= b[0] + b[2] && cy >= b[1] && cy <= b[1] + b[3];
  const under = leaves.slice(0, at).filter((n) => n.type === 'path' && /^#[0-9a-f]{6}$/i.test(n.props.fill ?? '') && n.opacity >= 1 && holds(n.bbox));
  return under.at(-1)?.props.fill ?? null;
}

const PERMITTED = () => {
  const p = look().palette;
  return Object.fromEntries(Object.entries(look().on).map(([ground, fgs]) => [p[ground].toLowerCase(), fgs.map((k) => p[k].toLowerCase())]));
};
const DISPLAY_ONLY = () => [[look().palette.accent, look().palette.paper], [look().palette.ink, look().palette.accent]].map((pair) => pair.map((c) => c.toLowerCase()).join('/'));

test('every text colour a statement sets is permitted on its ground, on every ground, display-only pairs at step 3 and up', () => {
  const permitted = PERMITTED();
  for (const format of FORMATS) {
    const film = filmFor([...tenShots().slice(0, 4).map((s) => ({ ...s, say: 'This *word* is said.', text: undefined, hold: undefined, kicker: 'Kicker' }))], NAME, format);
    for (let i = 0; i < 4; i++) {
      const sampled = snapshotOf(film.sampleShot(i, 1.5));
      for (const text of all(sampled).filter((n) => n.type === 'text' && n.opacity > 0)) {
        const ground = groundUnder(sampled, text);
        assert.ok(ground !== null, `${format} shot ${i}: ${text.id} has a ground`);
        const fill = text.props.fill.toLowerCase();
        assert.ok((permitted[ground.toLowerCase()] ?? []).includes(fill), `${format} shot ${i}: ${text.id} ${fill} on ${ground} is not a permitted pairing`);
        if (DISPLAY_ONLY().includes(`${fill}/${ground.toLowerCase()}`)) {
          assert.ok(text.props.font.size >= look().scale[DISPLAY_FROM_STEP - 1] * (Math.min(canvasOf(format).w, canvasOf(format).h) / 1080) - 1e-6, `${format} shot ${i}: ${text.id} ${fill} on ${ground} at ${text.props.font.size}px is under step ${DISPLAY_FROM_STEP}`);
        }
      }
    }
  }
});

test('the pairing table: each ground\'s permitted colours are over 3:1 on it and the banned pairs are absent', () => {
  const p = look().palette;
  for (const [ground, fgs] of Object.entries(look().on)) {
    assert.ok(look().grounds.includes(ground), `${ground} is a ground`);
    for (const fg of fgs) assert.ok(contrastRatio(p[fg], p[ground]) >= 3, `${fg} on ${ground}`);
  }
  assert.ok(!look().on.accent2.includes('ink') && !look().on.accent2.includes('accent'), 'nothing but paper on blue');
});

test('9:16 in pro keeps the 72-unit margins at the sides and the band; in viral the platform safe zone and the band', () => {
  const shot = { id: 'a', show: 'statement', text: 'A plain line', hold: 1 };
  const pro = stackArea(expandIn(filmOf([shot], NAME, '9:16', { mode: 'pro' })).ctx);
  assert.deepEqual([pro.left, pro.top, pro.top + pro.h], [72, look().band.top * 1920, look().band.bottom * 1920], 'pro: the margins and the band');
  const viral = stackArea(expandIn(filmOf([shot], NAME, '9:16', { mode: 'viral' })).ctx);
  assert.ok(viral.top >= look().band.top * 1920, `viral: at or under the band top, got ${viral.top}`);
  assert.ok(viral.top + viral.h <= look().band.bottom * 1920 + 1e-6, 'viral: above the band bottom');
});

test('a viral hook opens at full ink on frame 0: no ghost, no fade, every word in the ground\'s ink', () => {
  const film = filmFor([{ id: 'h', show: 'statement', say: 'Rent ate *half* the pay.' }], NAME, '9:16', { mode: 'viral' });
  const ink = shotLook(look(), 0, 1).palette.ink;
  // a beat's knockout copy (props.beatOf, gate-poster-2 ruling 3) is off on frame 0 and not one of the stack's lines
  const lines = all(film.sampleShot(0, 0)).filter((n) => n.type === 'text' && n.props.stack === 'h.text' && n.props.beatOf === undefined);
  assert.ok(lines.length > 0);
  for (const line of lines) {
    assert.equal(line.opacity, 1);
    for (const w of line.words ?? []) {
      assert.ok(!((w.ghost ?? 0) > 0), `${line.id}: no ghost on frame 0`);
      assert.equal(w.opacity ?? 1, 1, `${line.id}: full opacity on frame 0`);
      assert.equal(w.fill ?? line.props.fill, ink, `${line.id}: ink on frame 0`);
    }
  }
});

test('the code review measures its room by the film\'s mode: margins and band in pro, the platform zone in viral', () => {
  const canvas = canvasOf('9:16');
  const insets = platformOf(canvas);
  const pro = reviewRoom(look(), canvas, insets, registries.modes.get('pro'));
  const viral = reviewRoom(look(), canvas, insets, registries.modes.get('viral'));
  assert.deepEqual([pro.x, pro.y], [72, look().band.top * canvas.h], 'pro: the margins and the band');
  assert.equal(viral.x, insets.left, 'viral: the platform zone');
});

test('in pro every statement opens composed: its words set from the first frame', () => {
  const film = filmFor([{ id: 'p', show: 'statement', say: 'Rent ate half the pay this year.' }], NAME, '16:9', { mode: 'pro' });
  const lines = all(film.sampleShot(0, 0)).filter((n) => n.type === 'text' && n.props.stack === 'p.text');
  for (const line of lines) for (const w of line.words ?? []) assert.equal(w.opacity ?? 1, 1, `${line.id}: set on frame 0`);
});

test('display width takes only the six stretch keywords', () => {
  const keywords = STRETCH_KEYWORDS.map(([, k]) => k);
  for (const font of Object.values(look().fonts)) assert.ok(keywords.includes(font.width), `${font.family} ${font.width}`);
  assert.equal(look().fonts.display.width, 'extra-condensed');
});

test('camera locked, OKLab colour, hook at full ink, the six cuts of the palette, a little grain and nothing else', () => {
  const { closeUp, ...camera } = look().camera;
  assert.deepEqual(camera, { drift: 0, style: 'locked' });
  assert.deepEqual(Object.keys(closeUp).sort(), ['height', 'minGain', 'pad', 'width'], 'the close-up window is data for a cut, not a move');
  assert.equal(look().colorSpace, 'oklab');
  assert.equal(look().hookInk, true);
  assert.deepEqual([...look().cutPalette], ['cut', 'cover', 'iris', 'wipe', 'punch', 'slide']);
  assert.deepEqual({ ...look().post }, { grain: 0.015, halftone: 0, bloom: 0 });
  assert.equal(look().composition, 'stack');
  assert.equal(look().emphasis, 'scale');
});
