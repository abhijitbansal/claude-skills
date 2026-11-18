// The keynote gate's medium fix items (gate-keynote-3.md, the lead's n5 brief), on the gate films' own shots
// (references/examples/v2 gate-keynote.json and gate-keynote-tall.json; a screen's picture swapped for the test picture,
// 1600 x 1000, the same shape as dashboard.png at 3200 x 2000): every cut soft (no wipe), a second screen in a row framed
// differently with the screen's own title in its chrome, a lifted crop clear of the UI around its panel, a larger end
// card picture with the line clear of it, the tall flow's last card inside the bottom safe margin, and no pale rectangle
// outside the tall region card's ring.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registries } from '../../engine/registry.mjs';
import { safeRectFor } from '../../scripts/v2/review.mjs';
import { filmFor, filmOf } from './helpers/kinds.mjs';
import { drawnLeaves } from './helpers/bar.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { resolveShotCut } from '../../engine/cuts/resolve.mjs';

const EXAMPLES = new URL('../../references/examples/v2/', import.meta.url);
const gate = (file) => JSON.parse(readFileSync(new URL(file, EXAMPLES), 'utf8'));
const WIDE = gate('gate-keynote.json');
const TALL = gate('gate-keynote-tall.json');
const withTestPicture = (shot) => (shot.src === undefined ? shot : { ...shot, src: 'shot.png' });
const shotOf = (film, id) => withTestPicture(film.shots.find((s) => s.id === id));
const CANVAS = Object.freeze({ '16:9': { w: 1920, h: 1080 }, '9:16': { w: 1080, h: 1920 } });
const FPS = 30;
const framesOf = (duration) => Array.from({ length: Math.floor(duration * FPS) + 1 }, (_, i) => i / FPS);
const look = () => registries.looks.get('keynote');
const built = (shot, format) => filmFor([shot], 'keynote', format, { mode: 'pro' });
const union = (boxes) => {
  const [x0, y0] = [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1]))];
  return [x0, y0, Math.max(...boxes.map((b) => b[0] + b[2])) - x0, Math.max(...boxes.map((b) => b[1] + b[3])) - y0];
};
const safeBox = (format) => {
  const s = safeRectFor(CANVAS[format], look());
  return [s.left, s.top, s.right - s.left, s.bottom - s.top];
};
const insideBox = (b, r, slack = 1) => b[0] >= r[0] - slack && b[1] >= r[1] - slack && b[0] + b[2] <= r[0] + r[2] + slack && b[1] + b[3] <= r[1] + r[3] + slack;
const leavesAt = (b, index, t) => drawnLeaves(b.sampleShot(index, t));
const idOf = (l) => l.node.id;
const textOf = (l) => l.node.props.layout.lines.map((line) => line.words.map((w) => w.text).join(' ')).join(' ');
const GUTTER = 24; // px at 1080: the look's grid gutter

function wholeFilm(film) {
  const shots = film.shots.map(withTestPicture);
  const spec = filmOf(shots, 'keynote', film.format, { mode: 'pro' });
  const timeline = buildTimeline(spec, { fps: FPS });
  const b = filmFor(shots, 'keynote', film.format, { mode: 'pro' });
  const index = (id) => shots.findIndex((s) => s.id === id);
  return { b, shots, spec, index, duration: (id) => timeline.shots[index(id)].duration };
}

// ---- cuts: every keynote cut is soft ----

const HEADLINE = 84; // px: the smallest headline size (scale step 3)
const OVERLAP_MAX = 0.15; // two headlines never both drawn above this opacity at one frame of a cut
const P_STEPS = 60;
const recipes = (cut, canvas) => Array.from({ length: P_STEPS + 1 }, (_, i) => cut.entry.layers({ p: i / P_STEPS, direction: cut.direction, canvas }));
for (const film of [WIDE, TALL]) {
  test(`gate ${film.format}: no keynote cut is a hard cut or a wipe, and a cut over two headlines never holds both`, () => {
    const w = wholeFilm(film);
    const canvas = CANVAS[film.format];
    const textsAt = (id, t) => leavesAt(w.b, w.index(id), t).filter((l) => l.node.type === 'text' && l.opacity > 0.5);
    const headline = (id, t) => textsAt(id, t).some((l) => l.node.props.font.size * l.scale >= HEADLINE);
    film.shots.slice(1).forEach((shot, k) => {
      const cut = resolveShotCut(w.spec, k + 1, { look: look() });
      const where = `${film.shots[k].id} to ${shot.id} (${cut?.name})`;
      assert.ok(cut !== null && cut.entry.family === 'layer', `${where} is a layer cut`);
      for (const r of recipes(cut, canvas)) assert.ok(r.from.clip === null && r.to.clip === null, `${where} masks a picture with a moving edge`);
      if (headline(film.shots[k].id, w.duration(film.shots[k].id) - 0.05) && headline(shot.id, 0)) {
        const worst = Math.max(...recipes(cut, canvas).map((r) => Math.min(r.from.opacity, r.to.opacity)));
        assert.ok(worst <= OVERLAP_MAX, `${where} holds two headlines at once (up to ${worst.toFixed(2)})`);
      }
    });
  });
}

// ---- two screens in a row are framed differently ----

const regionCardOf = (b, index, id, t) => {
  const leaves = leavesAt(b, index, t);
  const paper = leaves.find((l) => idOf(l) === `${id}.region.paper`);
  const image = leaves.find((l) => idOf(l) === `${id}.region.image`);
  return { paper, image, box: union([paper, image].filter(Boolean).map((l) => l.box)) };
};
const HERO_FLOOR = 144; // px: three times the chrome text step (48), the least a headline is set
const FRAMING_STEP = 0.1; // of the frame's width: the least a second framing differs in the card's width or centre

test('gate 16:9: month (a screen right after a screen) lifts a smaller card on the right under its own headline; dash is untouched', () => {
  const w = wholeFilm(WIDE);
  const W = CANVAS['16:9'].w;
  const [dash, month] = ['dash', 'month'].map((id) => regionCardOf(w.b, w.index(id), id, w.duration(id) - 0.05));
  assert.ok(Math.abs(dash.box[2] - month.box[2]) >= FRAMING_STEP * W || Math.abs(dash.box[0] + dash.box[2] / 2 - (month.box[0] + month.box[2] / 2)) >= FRAMING_STEP * W,
    `the two cards share one framing: dash ${dash.box.map(Math.round)}, month ${month.box.map(Math.round)}`);
  assert.ok(dash.box[2] >= 0.8 * W, `the first screen keeps its 80 percent card (${Math.round(dash.box[2])})`);
  const end = leavesAt(w.b, w.index('month'), w.duration('month') - 0.05);
  const headline = end.find((l) => idOf(l) === 'month.headline');
  assert.ok(headline, 'a headline over the second screen');
  assert.equal(textOf(headline), 'Orders by month');
  // set at least three times the chrome text (the review's hero rule, 144) and fitting its column (the first render's
  // finding: "month.headline does not fit even at the smallest size", under the tall hero's 0.4 height share)
  assert.ok(headline.node.props.font.size >= HERO_FLOOR, `the headline is ${headline.node.props.font.size} px`);
  assert.ok(!headline.node.props.layout.overflow, 'the headline fits its column');
  assert.ok(insideBox(headline.box, safeBox('16:9')), `the headline ${headline.box.map(Math.round)} is inside the title-safe box`);
  assert.ok(month.box[0] - (headline.box[0] + headline.box[2]) >= GUTTER, `the headline is ${Math.round(month.box[0] - (headline.box[0] + headline.box[2]))} px from the card`);
  assert.ok(insideBox(month.box, safeBox('16:9')), `the card ${month.box.map(Math.round)} is inside the title-safe box`);
});

test('gate 16:9 month: the browser chrome keeps the screen\'s own title and url while the screen is whole', () => {
  const w = wholeFilm(WIDE);
  for (const [id, title] of [['dash', 'Orders dashboard'], ['month', 'Orders by month']]) {
    const leaves = leavesAt(w.b, w.index(id), 0);
    const chrome = leaves.find((l) => idOf(l) === `${id}.title`);
    assert.ok(chrome && chrome.opacity > 0.99, `${id}: the chrome title is on at frame 0`);
    assert.equal(textOf(chrome), title);
    assert.ok(leaves.some((l) => idOf(l) === `${id}.url` && l.opacity > 0.99), `${id}: the chrome url is on at frame 0`);
  }
});

test('gate 16:9: a screen after something other than a screen is framed as the first one is', () => {
  const gap = { id: 'gap', show: 'statement', say: 'A word between.' };
  const shots = [shotOf(WIDE, 'dash'), gap, shotOf(WIDE, 'month')];
  const b = filmFor(shots, 'keynote', '16:9', { mode: 'pro' });
  const timeline = buildTimeline(filmOf(shots, 'keynote', '16:9', { mode: 'pro' }), { fps: FPS });
  const month = regionCardOf(b, 2, 'month', timeline.shots[2].duration - 0.05);
  assert.ok(month.box[2] >= 0.8 * CANVAS['16:9'].w, `the card is ${Math.round(month.box[2])} px wide`);
  assert.ok(Math.abs(month.box[0] + month.box[2] / 2 - CANVAS['16:9'].w / 2) <= 1, 'centred');
  assert.equal(leavesAt(b, 2, timeline.shots[2].duration - 0.05).some((l) => idOf(l) === 'month.headline'), false, 'no headline');
});

test('gate 9:16: a second screen in a row sets its card above its headline where the first sets it under', () => {
  const [a, c] = [{ ...shotOf(TALL, 'dash'), id: 'a' }, { ...shotOf(TALL, 'dash'), id: 'c' }];
  const b = filmFor([a, c], 'keynote', '9:16', { mode: 'pro' });
  const timeline = buildTimeline(filmOf([a, c], 'keynote', '9:16', { mode: 'pro' }), { fps: FPS });
  const placed = (index, id) => {
    const leaves = leavesAt(b, index, timeline.shots[index].duration - 0.05);
    return { headline: leaves.find((l) => idOf(l) === `${id}.headline`).box, card: regionCardOf(b, index, id, timeline.shots[index].duration - 0.05).box };
  };
  const first = placed(0, 'a'), second = placed(1, 'c');
  assert.ok(first.headline[1] + first.headline[3] <= first.card[1], 'the first: the headline over the card');
  assert.ok(second.headline[1] >= second.card[1] + second.card[3], 'the second: the headline under the card');
  const safe = safeBox('9:16');
  assert.ok(insideBox(second.headline, safe) && insideBox(second.card, safe), 'both inside the title-safe box');
});

// ---- the lifted crop stays inside its panel ----

const PICTURE_W = 1600; // px: the test picture
const REAL_W = 3200; // px: dashboard.png, on which the strips were measured (.scratch/n5/strips.mjs)
// px of dashboard.png the film's region reaches past the panel's own white interior: the page's grey and the panel's
// 2 px border (a region's rect is the film's; the crop must not show them)
const STRIPS = Object.freeze({
  region: { top: 14, left: 12, right: 8, bottom: 0 },
  month: { top: 14, left: 2, right: 0, bottom: 0 },
});
const cropCases = [[WIDE, '16:9', 'dash', 'region'], [WIDE, '16:9', 'month', 'month'], [TALL, '9:16', 'dash', 'region']];
for (const [film, format, id, region] of cropCases) {
  test(`gate ${format} ${id}: the lifted crop starts inside the panel, with no strip of the UI above it and no double border`, () => {
    const shot = shotOf(film, id);
    const b = built(shot, format);
    const image = drawnLeaves(b.sampleShot(0, b.duration)).find((l) => idOf(l) === `${id}.region.image`);
    assert.ok(image, 'the region image');
    const [fx, fy, fw, fh] = shot.regions[region];
    const [x0, y0, x1, y1] = [fx * PICTURE_W, fy * 1000, (fx + fw) * PICTURE_W, (fy + fh) * 1000];
    const scale = PICTURE_W / REAL_W;
    const strip = STRIPS[region];
    const [cx, cy, cw, ch] = image.node.props.clip;
    assert.ok(cy >= y0 + strip.top * scale - 1e-6, `top ${cy.toFixed(2)} of the region's ${y0}: the strip is ${strip.top * scale} px`);
    assert.ok(cx >= x0 + strip.left * scale - 1e-6, `left ${cx.toFixed(2)} of ${x0}: ${strip.left * scale} px`);
    assert.ok(cx + cw <= x1 - strip.right * scale + 1e-6, `right ${(cx + cw).toFixed(2)} of ${x1}: ${strip.right * scale} px`);
    assert.ok(cy + ch <= y1 - strip.bottom * scale + 1e-6, `bottom ${(cy + ch).toFixed(2)} of ${y1}`);
  });
}

// ---- the end card's product ----

const HALF_WIDTH = 0.5; // of the 16:9 frame: the product picture at least this wide
test('gate 16:9 close: the product picture is at least half the frame wide and the line clears its card by the gutter', () => {
  const w = wholeFilm(WIDE);
  const leaves = leavesAt(w.b, w.index('close'), w.duration('close') - 0.05);
  const picture = leaves.find((l) => idOf(l) === 'close.product.image');
  const paper = leaves.find((l) => idOf(l) === 'close.product.paper');
  assert.ok(picture.box[2] >= HALF_WIDTH * CANVAS['16:9'].w - 1, `the picture is ${Math.round(picture.box[2])} px wide`);
  // the headline (the ask is one unbreakable url, which the Node tests' stand-in measure overstates: 767 px against about
  // 570 px set in the page)
  const title = leaves.find((l) => idOf(l) === 'close.title');
  const right = title.box[0] + title.box[2];
  assert.ok(paper.box[0] - right >= GUTTER, `the line ends at ${Math.round(right)}, the card starts at ${Math.round(paper.box[0])}`);
  // the camera's drift (look.camera.drift, half each way) moves the frame by up to DRIFT / 2 px
  assert.ok(insideBox(paper.box, safeBox('16:9'), look().camera.drift / 2 + 1), `the card ${paper.box.map(Math.round)} is inside the title-safe box`);
});

test('gate 9:16 close: the product picture is at least the safe width, inside the safe box', () => {
  const w = wholeFilm(TALL);
  const picture = leavesAt(w.b, w.index('close'), w.duration('close') - 0.05).find((l) => idOf(l) === 'close.product.image');
  const safe = safeBox('9:16');
  assert.ok(picture.box[2] >= safe[2] - 1, `the picture is ${Math.round(picture.box[2])} px wide, the safe width ${safe[2]}`);
  // the camera's drift (look.camera.drift, half each way) moves the frame by up to DRIFT / 2 px
  assert.ok(insideBox(picture.box, safe, look().camera.drift / 2 + 1), `the picture ${picture.box.map(Math.round)} is inside the title-safe box`);
});

// ---- the tall flow ----

test('gate 9:16 flow: the last card is at least the bottom safe margin from the frame\'s edge on every frame', () => {
  const b = built(shotOf(TALL, 'flow'), '9:16');
  const safe = safeBox('9:16');
  for (const t of framesOf(b.duration)) {
    const cards = drawnLeaves(b.sampleShot(0, t)).filter((l) => /^flow\.node\d+\.card\.paper$/.test(idOf(l)));
    assert.equal(cards.length, 4);
    const last = cards.reduce((a, c) => (c.box[1] > a.box[1] ? c : a));
    assert.ok(last.box[1] + last.box[3] <= safe[1] + safe[3] + 1e-6, `at ${t.toFixed(2)} s the last card ends at ${Math.round(last.box[1] + last.box[3])}, the safe bottom is ${safe[1] + safe[3]}`);
  }
});

// ---- no band of light outside the tall region card's ring ----

const RING_ALLOW = 6; // px a mark may reach past the card's picture: the ring's 4 px line and its round cap

test('gate 9:16 dash: no pale rectangle outside the ring at any frame', () => {
  const b = built(shotOf(TALL, 'dash'), '9:16');
  for (const t of framesOf(b.duration)) {
    const leaves = drawnLeaves(b.sampleShot(0, t)).filter((l) => l.opacity > 0);
    const band = leaves.filter((l) => idOf(l).includes('.sweep'));
    assert.equal(band.length, 0, `at ${t.toFixed(2)} s a band of light is drawn (${band.slice(0, 2).map((l) => l.box.map(Math.round))})`);
    const card = leaves.find((l) => idOf(l) === 'dash.region.image');
    if (card === undefined) continue;
    const stray = leaves.filter((l) => idOf(l).startsWith('dash.region') && !idOf(l).includes('.shadow') && !insideBox(l.box, card.box, RING_ALLOW));
    assert.equal(stray.length, 0, `at ${t.toFixed(2)} s ${stray.map(idOf).slice(0, 2)} lie outside the ring round the card`);
  }
});
