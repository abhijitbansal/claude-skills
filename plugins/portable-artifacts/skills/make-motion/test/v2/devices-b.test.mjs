// The second-wave devices: label, focus, route, numeral, sticker, sweep (engine/devices), and the photo treatments
// (Task 3). Geometry is checked by hand for one input each; every listed look and cosmos names a sound for each.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import '../../engine/looks/index.mjs';
import { allLookNames, applyAccent } from '../../engine/looks/index.mjs';
import { treatmentFor } from '../../engine/devices/treatments.mjs';
import { duotone, halftone, halftoneDots, createTreatCache } from '../../engine/page/treat.mjs';
import { sample } from '../../engine/time/track.mjs';
import { sampleGraph } from '../../engine/graph/sample.mjs';
import { node } from '../../engine/graph/node.mjs';
import { pathPoints } from '../../engine/devices/shared.mjs';
import { validateFilm } from '../../scripts/v2/spec.mjs';
import { listEntries } from '../../scripts/v2/list.mjs';
import { measure } from './helpers/kinds.mjs';
import { drawnLeaves } from './helpers/bar.mjs';

const desk = registries.looks.get('desk');
const pop = registries.looks.get('pop');
const device = (name) => registries.devices.get(name);
const BASE = { at: 1, unit: 1, seed: 1 };
const HEAD_DEVICES = ['highlight', 'circle', 'underline', 'arrow', 'bracket', 'cutout', 'card', 'tag', 'punch'];
const NEW_DEVICES = ['label', 'focus', 'route', 'numeral', 'sticker', 'sweep'];
const CANVAS = [0, 0, 1920, 1080];
const all = (nodes) => nodes.flatMap((n) => [n, ...all(n.children)]);
const near = (a, b, tol = 0.02) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

test('each new device is supported where the look styles it', () => {
  const where = Object.fromEntries(NEW_DEVICES.map((n) => [n, [desk, pop].filter((l) => device(n).supports(l)).map((l) => l.name)]));
  assert.deepEqual(where, { label: ['desk', 'pop'], focus: ['desk', 'pop'], route: ['desk', 'pop'], numeral: ['pop'], sticker: ['pop'], sweep: ['pop'] });
});

test('every registered look, cosmos included, names a sound (a cue or null) for each new device', () => {
  for (const look of allLookNames()) {
    for (const name of NEW_DEVICES) {
      const cue = registries.looks.get(look).sounds.device[name];
      assert.ok(cue === null || typeof cue === 'string', `${look}: sounds.device.${name}`);
    }
  }
});

test('--list devices shows the nine devices of HEAD, the six new ones and the two treatments: seventeen', () => {
  const names = listEntries('devices').map((e) => e.name);
  assert.deepEqual(names, [...HEAD_DEVICES, ...NEW_DEVICES, 'duotone', 'halftone']);
});

// ---- label ----

const labelOf = (look, anchor, extra = {}) => device('label').build({ ...BASE, id: 'l', box: CANVAS, look, measure, text: 'Nairobi', anchor, size: 44, ...extra });
const leaderOf = (built) => all(built.nodes).find((n) => n.id === 'l.leader');
const textOf = (built) => all(built.nodes).find((n) => n.id === 'l.text');

test('label: the leader ends on the anchor and draws on with the look draw move, landing at `at`', () => {
  for (const look of [desk, pop]) {
    const built = labelOf(look, [900, 500]);
    const end = pathPoints(leaderOf(built).props.d).at(-1);
    near(end[0], 900); near(end[1], 500);
    const leader = leaderOf(built);
    assert.equal(sample(leader.tracks.draw, 1, leader.step), 1);
    assert.equal(sample(leader.tracks.draw, 1 - look.moves.draw.dur, leader.step), 0);
    assert.equal(textOf(built).props.layout.size, 44, 'the caller size, one size');
  }
});

test('label: the side with room is chosen away from the anchor, and the text never leaves the box', () => {
  const right = labelOf(desk, [1880, 500]);
  assert.equal(right.side, 'left', 'an anchor at the right edge puts the label on its left');
  const left = labelOf(desk, [30, 500]);
  assert.equal(left.side, 'right');
  for (const built of [right, left, labelOf(desk, [960, 20]), labelOf(desk, [960, 1060])]) {
    const [x, y, w, h] = built.boxes.label;
    assert.ok(x >= 0 && y >= 0 && x + w <= 1920 && y + h <= 1080, JSON.stringify(built.boxes.label));
  }
  assert.equal(labelOf(desk, [960, 500], { side: 'below' }).side, 'below', 'a given side is kept');
});

test('label: the leader starts on the text box edge nearest the anchor', () => {
  const built = labelOf(desk, [1880, 500]);
  const [x, y, w, h] = built.boxes.label;
  const start = pathPoints(leaderOf(built).props.d)[0];
  assert.ok(Math.abs(start[0] - (x + w)) < 1 && start[1] >= y && start[1] <= y + h, `${start} on the right edge of ${built.boxes.label}`);
});

// ---- focus ----

test('focus: a scrim over the cover with the box left clear, rising to the look dim by `at`', () => {
  const built = device('focus').build({ ...BASE, id: 'f', box: [100, 200, 300, 150], look: desk, cover: [0, 0, 1920, 1080] });
  const scrim = built.nodes[0];
  const points = pathPoints(scrim.props.d);
  assert.deepEqual(points.slice(-4), [[100, 200], [100, 350], [400, 350], [400, 200]], 'the hole is the box, counter-clockwise');
  near(sample(scrim.tracks.opacity, 1), desk.devices.focus.dim);
  assert.equal(sample(scrim.tracks.opacity, 0), 0);
});

// ---- route ----

const POINTS = [[100, 800], [600, 300], [1200, 500], [1700, 200]];

test('route: passes through every point in order and draws from 0 to 1 landing at `at`', () => {
  for (const look of [desk, pop]) {
    const built = device('route').build({ ...BASE, id: 'r', look, points: POINTS });
    const path = all(built.nodes).find((n) => n.id === 'r.line');
    // "Mx yCc1 c1 c2 c2 x y..." (devices/shared.mjs smoothPath): the M point, then each cubic's end point
    const [head, ...cubics] = path.props.d.split('C');
    const vertices = [head.slice(1).trim().split(/\s+/).map(Number), ...cubics.map((c) => c.trim().split(/\s+/).map(Number).slice(-2))];
    assert.deepEqual(vertices, POINTS, `${look.name}: the stroke's segment ends are the points, in order`);
    assert.equal(sample(path.tracks.draw, 0, path.step), 0);
    assert.equal(sample(path.tracks.draw, 1, path.step), 1);
    assert.ok(sample(path.tracks.draw, 0.9, path.step) < 1);
  }
});

test('route: desk puts pins at both ends; pop jabs an arrow head at the end', () => {
  const deskRoute = all(device('route').build({ ...BASE, id: 'r', look: desk, points: POINTS }).nodes).map((n) => n.id);
  assert.ok(deskRoute.includes('r.pin0') && deskRoute.includes('r.pin1'), deskRoute.join());
  const popRoute = all(device('route').build({ ...BASE, id: 'r', look: pop, points: POINTS }).nodes);
  const head = popRoute.find((n) => n.id === 'r.head');
  assert.ok(head, popRoute.map((n) => n.id).join());
  assert.equal(popRoute.some((n) => n.id === 'r.pin0'), false);
  const tip = pathPoints(head.props.d)[1];
  near(tip[0] + head.props.x, 1700, 1); near(tip[1] + head.props.y, 200, 1);
});

// ---- numeral ----

// A measure in which "1" is narrow and "8" wide, as real faces are.
const proportional = (text, font) => {
  const widths = { 1: 0.3, 8: 0.62 };
  const width = [...text].reduce((sum, ch) => sum + (widths[ch] ?? 0.55) * font.size, 0);
  return { width, ascent: font.size * 0.8, descent: font.size * 0.2, inkAscent: 0.72 * font.size, inkDescent: 0, inkLeft: 0, inkRight: width };
};
const numeralOf = (text, extra = {}) => device('numeral').build({ ...BASE, id: 'n', box: [100, 100, 600, 300], look: pop, measure: proportional, text, ...extra });

test('numeral: digits sit in equal cells, so "1" and "8" give the same width, fitted to the box', () => {
  const one = numeralOf('1'), eight = numeralOf('8');
  const figure = (built) => all(built.nodes).find((n) => n.id === 'n.figure');
  near(figure(one).props.layout.width, figure(eight).props.layout.width);
  const many = figure(numeralOf('1818'));
  const cells = many.props.layout.lines[0].words.map((w) => w.x + w.width / 2);
  near(cells[1] - cells[0], cells[2] - cells[1]); near(cells[2] - cells[1], cells[3] - cells[2]);
  assert.ok(many.props.layout.width <= 600 + 1e-6, 'fits the box width');
  assert.ok(many.props.layout.size * 0.72 <= 300 + 1e-6, 'its cap height fits the box height');
});

test('numeral: the unit is smaller, an affix on the cap height', () => {
  const built = numeralOf('42', { unitText: '%' });
  const figure = all(built.nodes).find((n) => n.id === 'n.figure');
  const unit = all(built.nodes).find((n) => n.id === 'n.unit');
  assert.equal(unit.props.role, 'affix');
  assert.ok(unit.props.layout.size < figure.props.layout.size);
  const capTop = (n) => n.props.y + n.props.layout.lines[0].y - 0.72 * n.props.layout.size;
  near(capTop(unit), capTop(figure), 0.5);
});

// ---- sticker ----

test('sticker: an outlined cut shape about the children, turned by the seed within the look range', () => {
  const child = node('path', 'c', { d: 'M100 100H300V200H100Z', fill: '#ff0000' });
  const build = (seed) => device('sticker').build({ ...BASE, seed, id: 's', box: [100, 100, 200, 100], look: pop, children: [child] });
  const a = build(1), b = build(1), c = build(2);
  assert.equal(a.nodes[0].props.rotate, b.nodes[0].props.rotate);
  assert.notEqual(a.nodes[0].props.rotate, c.nodes[0].props.rotate);
  for (const seed of [1, 2, 3, 4, 5]) assert.ok(Math.abs(build(seed).nodes[0].props.rotate) <= pop.devices.sticker.rotate);
  const outline = all(a.nodes).find((n) => n.id === 's.outline');
  assert.equal(outline.props.stroke, pop.palette.ink);
  assert.equal(outline.props.strokeWidth, pop.devices.sticker.width);
  assert.ok(all(a.nodes).some((n) => n.id === 'c'), 'the children are inside');
});

test('sticker: lands whole at `at` and holds its children in place at rest', () => {
  const child = node('path', 'c', { d: 'M100 100H300V200H100Z', fill: '#ff0000' });
  const built = device('sticker').build({ ...BASE, id: 's', box: [100, 100, 200, 100], look: pop, children: [child] });
  const [leaf] = drawnLeaves(sampleGraph(built.nodes, 1)).filter((l) => l.node.id === 'c');
  near(leaf.box[0] + leaf.box[2] / 2, 200, 15); near(leaf.box[1] + leaf.box[3] / 2, 150, 15);
});

// ---- sweep ----

test('sweep: a screened band of light that stays inside the box at five sampled times', () => {
  const box = [200, 300, 800, 400];
  const built = device('sweep').build({ ...BASE, id: 'w', box, look: pop });
  assert.equal(built.nodes[0].props.blend, 'screen');
  assert.ok(!JSON.stringify(built.nodes).includes('"blur"'), 'no blur filter');
  for (const t of [0.4, 0.6, 0.8, 1, 1.2]) {
    for (const leaf of drawnLeaves(sampleGraph(built.nodes, t))) {
      const [x, y, w, h] = leaf.box;
      assert.ok(x >= box[0] - 0.5 && y >= box[1] - 0.5 && x + w <= box[0] + box[2] + 0.5 && y + h <= box[1] + box[3] + 0.5, `at ${t}: ${leaf.box}`);
    }
  }
});

// ---- photo treatments (Task 3) ----

// A 4 x 4 RGBA picture: top-left quadrant black, top-right white, bottom-left grey 128, bottom-right a checker.
function fixture4() {
  const data = new Uint8ClampedArray(4 * 4 * 4);
  const set = (x, y, v) => data.set([v, v, v, 255], (y * 4 + x) * 4);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const left = x < 2, top = y < 2;
      set(x, y, top ? (left ? 0 : 255) : (left ? 128 : ((x + y) % 2 === 0 ? 0 : 255)));
    }
  }
  return data;
}
const pixel = (data, x, y) => [...data.slice((y * 4 + x) * 4, (y * 4 + x) * 4 + 4)];

test('duotone: luminance mapped from dark to light in OKLab (hand-computed: black, white, grey 128 between black and white)', () => {
  const out = duotone(fixture4(), '#000000', '#ffffff');
  assert.deepEqual(pixel(out, 0, 0), [0, 0, 0, 255]);
  assert.deepEqual(pixel(out, 3, 0), [255, 255, 255, 255]);
  // grey 128: t = 128/255 = 0.50196; OKLab L from 0 to 1 is t, linear light t^3 = 0.12648, sRGB 0.39075 -> 100
  assert.deepEqual(pixel(out, 0, 3), [100, 100, 100, 255]);
  const tinted = duotone(fixture4(), '#15130f', '#f3eee3');
  assert.deepEqual(pixel(tinted, 0, 0), [0x15, 0x13, 0x0f, 255], 'black takes the dark colour');
  assert.deepEqual(pixel(tinted, 3, 0), [0xf3, 0xee, 0xe3, 255], 'white takes the light colour');
});

test('halftone: one dot per cell, its radius from the cell mean luminance (hand-computed for cell 2)', () => {
  const dots = halftoneDots(fixture4(), 4, 4, 2);
  const r = Object.fromEntries(dots.map((d) => [`${d.cx},${d.cy}`, d.r]));
  near(r['1,1'], Math.SQRT2, 1e-9); // black: the dot covers the whole cell (its corners are sqrt(2) out)
  near(r['3,1'], 0, 1e-9); // white: no dot
  near(r['1,3'], Math.SQRT2 * Math.sqrt(1 - 128 / 255), 1e-9); // grey 128: 0.99804
  near(r['3,3'], 1, 1e-9); // half black: sqrt(2) * sqrt(0.5)
  const out = halftone(fixture4(), 4, 4, '#000000', '#ffffff', 2);
  assert.deepEqual(pixel(out, 0, 0), [0, 0, 0, 255], 'inside the black cell dot');
  assert.deepEqual(pixel(out, 2, 0), [255, 255, 255, 255], 'the white cell is the light colour');
});

test('the treat cache returns the same bitmap for the same picture, treatment and size', () => {
  let made = 0;
  const makeCanvas = (w, h) => {
    made += 1;
    let stored = null;
    return { width: w, height: h, getContext: () => ({ drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(w * h * 4).fill(128), width: w, height: h }), putImageData(img) { stored = img; }, createImageData: (iw, ih) => ({ data: new Uint8ClampedArray(iw * ih * 4), width: iw, height: ih }) }), stored: () => stored };
  };
  const cache = createTreatCache(makeCanvas);
  const image = { width: 8, height: 8 };
  const treatment = { type: 'duotone', dark: '#000000', light: '#ffffff' };
  const a = cache.get(image, treatment, 4, 4);
  assert.equal(cache.get(image, treatment, 4, 4), a);
  assert.equal(made, 1);
  assert.notEqual(cache.get(image, { ...treatment, light: '#ff0000' }, 4, 4), a, 'another treatment is another bitmap');
  assert.notEqual(cache.get(image, treatment, 6, 4), a, 'another size is another bitmap');
});

test('duotone and halftone are registered layout devices, styled per look, their colours from the look palette', () => {
  assert.deepEqual(['duotone', 'halftone'].map((n) => [desk, pop].filter((l) => device(n).supports(l)).map((l) => l.name)), [['desk'], ['pop']]);
  assert.equal(device('duotone').on, false);
  assert.equal(device('halftone').on, false);
  assert.deepEqual(treatmentFor(desk, 'duotone', 1), { type: 'duotone', dark: desk.palette.ink, light: desk.palette.paper });
  const pt = treatmentFor(pop, 'halftone', 2);
  assert.deepEqual(pt, { type: 'halftone', dark: pop.palette.paper, light: pop.palette.ink, cell: pop.devices.halftone.cell * 2 });
  assert.equal(treatmentFor(desk, 'none', 1), null);
});

test('an accent override changes the treated colours where the look names the accent', () => {
  const look = { ...desk, devices: { ...desk.devices, duotone: { dark: 'ink', light: 'accent' } } };
  assert.equal(treatmentFor(look, 'duotone', 1).light, desk.palette.accent);
  assert.equal(treatmentFor(applyAccent(look, '#ff6600'), 'duotone', 1).light, '#ff6600');
});

// ---- on: false ----

test('numeral and sticker are layout devices: an on event naming one is refused, and never offered', () => {
  const film = (name) => ({ version: 2, mode: 'viral', look: 'pop', shots: [{ id: 'a', show: 'statement', say: 'Hello there.', on: [{ at: 'word:Hello', do: name }] }] });
  for (const name of ['numeral', 'sticker']) {
    const found = validateFilm(film(name), { specDir: '.' }).errors.find((e) => e.path === 'shots[0].on[0].do');
    assert.match(found?.message ?? '', new RegExp(`^"${name}" is built by shot kinds, not placed by an on event; the devices an on event can place: `), JSON.stringify(found));
    assert.doesNotMatch(found.message.split('place: ')[1], /numeral|sticker/);
  }
  const unsupported = validateFilm({ version: 2, shots: [{ id: 'a', show: 'statement', say: 'Hello there.', on: [{ at: 'word:Hello', do: 'sweep' }] }] }, { specDir: '.' }).errors.find((e) => e.path === 'shots[0].on[0].do');
  assert.match(unsupported.message, /device "sweep" is not supported by look "desk"; it supports: /);
  assert.doesNotMatch(unsupported.message, /numeral|sticker/, 'a layout device is not offered either');
});
