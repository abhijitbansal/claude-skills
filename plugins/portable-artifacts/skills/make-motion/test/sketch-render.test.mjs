// A hand-drawn scene on the real render page: strokes and written text follow the plan by lookup, the hand holds the pencil
// on the stroke, every frame is a function of the time alone, and a standard spec loads none of it.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { withDefaults } from '../template/defaults.mjs';
import { planScene, pointAt } from '../template/sketch/plan.mjs';
import { handPose, HAND_TONE_FILLS } from '../template/sketch/hand.mjs';
import { handHome, HAND_EXIT } from '../template/sketch/timing.mjs';
import { HAND_TONES, PALETTE } from '../template/sketch/style.mjs';
import lucide from '../template/sketch/lucide.mjs';
import { launchBrowser } from '../scripts/lib/browser.mjs';
import { startServer } from '../scripts/lib/server.mjs';
import { CAPTION_STYLES } from '../template/captions.mjs';
import { requireRender, renderHash, BROWSER_ONLY } from './helpers/render.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RENDER = path.join(root, 'scripts/render.mjs');
const BOARD_RGB = [253, 252, 248];
const POSTER_PAGE_RGB = [13, 14, 12]; // shared/themes/poster.json dark.page
const INK_DISTANCE = 40; // a pixel this far from the board's colour counts as drawn
const TIP_TOLERANCE = 1; // px
const BOX_TOLERANCE = 0.02; // px: CSS layout keeps sizes in 64ths of a pixel

const made = [];
let browserLaunch = null; // one browser for the whole file, a page per use: many short-lived browsers once wedged this machine's window server
const sharedBrowser = () => (browserLaunch ??= launchBrowser({ quiet: true }));
after(async () => {
  if (browserLaunch) await (await browserLaunch).close();
  for (const d of made) rmSync(d, { recursive: true, force: true });
});
const tmp = () => { const d = mkdtempSync(path.join(tmpdir(), 'sketch-render-')); made.push(d); return d; };

const scene = (elements, extra = {}) => ({ id: 'draw', duration: 6, elements, ...extra });
const film = (scenes, extra = {}) => ({ size: [960, 540], style: 'sketch', scenes, ...extra });
const TEXT = { id: 'hello', type: 'text', text: 'Hello big board', x: 480, y: 200, fontSize: 60 };
const BOX = { id: 'box', type: 'shape', shape: 'rect', x: 300, y: 380, width: 240, height: 120 };
const ARROW = { id: 'arrow', type: 'shape', shape: 'line', arrow: 'end', x: 450, y: 380, to: { x: 650, y: 380 } };
const ICON = { id: 'cog', type: 'icon', name: 'server', x: 760, y: 380, size: 90 };

function planOf(motion, si = 0) {
  const spec = withDefaults(motion);
  return planScene(spec.scenes[si], { size: spec.size, seed: spec.sketch?.seed, pace: spec.sketch?.pace, icons: lucide, sceneIndex: si });
}

// Opens `motion` on the page (the render page unless `mode` says otherwise) at its own size and runs `fn` with
// { page, requests, problems }. `files`: name -> text, written beside the spec.
async function onPage(motion, fn, { mode = 'render', files = {} } = {}) {
  const dir = tmp();
  for (const [name, body] of Object.entries(files)) writeFileSync(path.join(dir, name), body);
  writeFileSync(path.join(dir, 'm.json'), JSON.stringify(motion));
  const srv = await startServer({ specPath: path.join(dir, 'm.json'), mode });
  const browser = await sharedBrowser();
  const [width, height] = withDefaults(motion).size;
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  try {
    const requests = [];
    const problems = [];
    page.on('request', (r) => requests.push(new URL(r.url()).pathname));
    page.on('pageerror', (e) => problems.push(e.message));
    page.on('response', (r) => { if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) problems.push(`${r.status()} ${r.url()}`); });
    await page.goto(srv.url);
    await page.waitForFunction(() => window.__motion);
    await page.evaluate(() => window.__motion.ready);
    return await fn({ page, requests, problems });
  } finally { await page.close(); await srv.close(); }
}

const seek = (page, sec) => page.evaluate((s) => window.__motion.seek(s), sec);
const hideHand = (page) => page.evaluate(() => { document.getElementById('sketch-hand').style.display = 'none'; });

// The PNG of the frame at `sec`, without the hand when `hand` is false (it would cover what a test counts).
async function frame(page, sec, { hand = true } = {}) {
  await seek(page, sec);
  if (!hand) await hideHand(page);
  return page.screenshot({ type: 'png' });
}

// How many pixels of `png` inside `box` (default: all of it) are not the board.
const inkCount = (page, png, box, board = BOARD_RGB, distance = INK_DISTANCE) => page.evaluate(async ([url, region, colour, far]) => {
  const img = new Image();
  img.src = url;
  await img.decode();
  const canvas = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height });
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const { x = 0, y = 0, width = img.width, height = img.height } = region ?? {};
  const { data } = ctx.getImageData(Math.floor(x), Math.floor(y), Math.ceil(width), Math.ceil(height));
  let count = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (Math.abs(data[i] - colour[0]) + Math.abs(data[i + 1] - colour[1]) + Math.abs(data[i + 2] - colour[2]) > far) count++;
  }
  return count;
}, [`data:image/png;base64,${png.toString('base64')}`, box ?? null, board, distance]);

// Of the pixels of `png` inside `box`: the one farthest from the colour `from`, how many differ from it at all (`touched`) and
// how many differ strongly (`strong`). A caption with no visible halo or backdrop has few touched pixels beyond its strong ones.
const regionStats = (page, png, box, from) => page.evaluate(async ([url, region, colour]) => {
  const img = new Image();
  img.src = url;
  await img.decode();
  const canvas = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height });
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(Math.floor(region.x), Math.floor(region.y), Math.ceil(region.width), Math.ceil(region.height));
  const out = { farthest: colour, touched: 0, strong: 0 };
  let most = -1;
  for (let i = 0; i < data.length; i += 4) {
    const distance = Math.abs(data[i] - colour[0]) + Math.abs(data[i + 1] - colour[1]) + Math.abs(data[i + 2] - colour[2]);
    if (distance > 3) out.touched++;
    if (distance > 150) out.strong++;
    if (distance > most) { most = distance; out.farthest = [data[i], data[i + 1], data[i + 2]]; }
  }
  return out;
}, [`data:image/png;base64,${png.toString('base64')}`, box, from]);

// The RGB of `png` at each [x, y], decoded on a page of the shared browser.
async function pixelsAt(png, points) {
  const browser = await sharedBrowser();
  const page = await browser.newPage();
  try {
    return await page.evaluate(async ([url, spots]) => {
      const img = new Image();
      img.src = url;
      await img.decode();
      const canvas = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height });
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      return spots.map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data].slice(0, 3));
    }, [`data:image/png;base64,${png.toString('base64')}`, points]);
  } finally { await page.close(); }
}

const nearColour = (actual, expected, by = 12) => actual.every((v, i) => Math.abs(v - expected[i]) <= by);
const luminance = (rgb) => {
  const [r, g, b] = rgb.map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
const captionBox = (page) => page.evaluate(() => {
  const r = document.querySelector('.captions').getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height };
});
const captionColour = (page) => page.evaluate(() => getComputedStyle(document.querySelector('.captions')).color);

// Where the pencil's point is on the stage at `sec`, through every transform around it.
const tipAt = (page, sec) => page.evaluate(async (s) => {
  await window.__motion.seek(s);
  const point = new DOMPoint(0, 0).matrixTransform(document.querySelector('#sketch-hand .pencil-lead').getScreenCTM());
  return [point.x, point.y];
}, sec);

// ---- the hand's journey, with no page ------------------------------------------------------------------------------------

test('handPose: at home and not visible before the hand enters and after it leaves; lift is sin(pi x p) inside a move', () => {
  const plan = planOf(film([scene([BOX, ARROW])]));
  const home = handHome(plan.size, plan.unit);
  const enter = plan.moves[0];
  const exit = plan.moves.at(-1);
  assert.equal(enter.kind, 'enter');
  assert.equal(exit.kind, 'exit');
  for (const sec of [0, enter.t0 - 0.01, exit.t1, exit.t1 + 5]) {
    assert.deepEqual(handPose(plan, sec), { x: home[0], y: home[1], lift: 0, visible: false }, `at ${sec}`);
  }
  const mid = handPose(plan, (enter.t0 + enter.t1) / 2);
  assert.equal(mid.visible, true);
  assert.ok(Math.abs(mid.lift - 1) < 1e-9, 'a move lifts most at its middle');
  const quarter = handPose(plan, enter.t0 + (enter.t1 - enter.t0) / 4);
  assert.ok(Math.abs(quarter.lift - Math.sin(Math.PI / 4)) < 1e-9);
  assert.ok(Math.abs(mid.x - (enter.from[0] + enter.to[0]) / 2) < 1e-9, 'the move is eased: halfway in time is halfway in space');
});

test('handPose: on a line the point is the stroke\'s own, with no lift', () => {
  const plan = planOf(film([scene([BOX, ARROW])]));
  for (const stroke of plan.strokes) {
    const pose = handPose(plan, stroke.t0 + (stroke.t1 - stroke.t0) * 0.4);
    const [x, y] = pointAt(stroke, 0.4);
    assert.ok(Math.hypot(pose.x - x, pose.y - y) < 1e-9, `${stroke.path}: ${pose.x},${pose.y} is not ${x},${y}`);
    assert.equal(pose.lift, 0);
  }
});

test('handPose: on writing the point is the smoothed path: the mean of 7 points across 1.1 font sizes, 32% of the deviation back', () => {
  const plan = planOf(film([scene([TEXT])]));
  const stroke = plan.strokes.find((s) => s.kind === 'write');
  const window = 2.2 * 0.5 * TEXT.fontSize;
  const p = 0.5;
  const s = p * stroke.total;
  const here = pointAt(stroke, p);
  const mean = [0, 1].map((axis) => [-3, -2, -1, 0, 1, 2, 3].reduce((sum, i) => sum + pointAt(stroke, (s + (i / 3) * window) / stroke.total)[axis] / 7, 0));
  const pose = handPose(plan, stroke.t0 + (stroke.t1 - stroke.t0) * p);
  assert.ok(Math.abs(pose.x - (mean[0] + (here[0] - mean[0]) * 0.32)) < 1e-9);
  assert.ok(Math.abs(pose.y - (mean[1] + (here[1] - mean[1]) * 0.32)) < 1e-9);
  assert.equal(pose.lift, 0);
});

test('handPose: waiting for a drawAt, the hand holds where the last stroke ended; a plan with no strokes keeps it home', () => {
  const plan = planOf(film([scene([BOX, { ...ARROW, drawAt: 4 }])]));
  const last = plan.strokes.findLast((s) => s.t1 <= 3);
  assert.ok(plan.strokes.some((s) => s.t0 >= 4), 'the arrow waits for its drawAt');
  const pose = handPose(plan, 3);
  assert.ok(plan.moves.every((m) => !(m.t0 <= 3 && 3 < m.t1)), 'no move at 3 s');
  assert.deepEqual([pose.x, pose.y], last.points.at(-1));
  assert.equal(pose.visible, true);
  const empty = planOf(film([scene([])]));
  assert.equal(handPose(empty, 1).visible, false);
});

test('a tone fill for every hand tone; medium is clip D\'s colour', () => {
  assert.deepEqual(Object.keys(HAND_TONE_FILLS).sort(), [...HAND_TONES].sort());
  assert.equal(HAND_TONE_FILLS.medium.fill, '#eec39d');
  for (const tone of HAND_TONES) assert.notEqual(HAND_TONE_FILLS[tone].fill, HAND_TONE_FILLS[tone].shade, tone);
});

test('a sketch scene\'s background defaults to the board, and its own wins; a standard scene gets none', () => {
  const spec = withDefaults({ size: [960, 540], scenes: [
    { id: 'plain', duration: 1, elements: [] },
    { id: 'drawn', style: 'sketch', duration: 1, elements: [] },
    { id: 'tinted', style: 'sketch', background: '#ffeecc', duration: 1, elements: [] },
  ] });
  assert.deepEqual(spec.scenes.map((s) => s.background), [undefined, PALETTE.board, '#ffeecc']);
});

// ---- on the page ---------------------------------------------------------------------------------------------------------

test('written text is hidden at its t0 and fully shown at t1', async (t) => {
  if (!await requireRender(t, BROWSER_ONLY)) return;
  const motion = film([scene([TEXT])]);
  const { box, t0, t1 } = planOf(motion).elements.get('scenes[0].elements[0]');
  await onPage(motion, async ({ page, problems }) => {
    const ink = async (sec) => inkCount(page, await frame(page, sec, { hand: false }), box);
    const early = await ink(t0 - 0.01);
    const start = await ink(t0);
    const middle = await ink((t0 + t1) / 2);
    const end = await ink(t1);
    const held = await ink(motion.scenes[0].duration - 0.01);
    assert.equal(early, 0);
    assert.equal(start, 0, 'nothing is written at t0');
    assert.ok(middle > 0 && middle < end, `half written: ${middle} of ${end} pixels`);
    assert.equal(end, held, 'all of it is there at t1');
    assert.ok(end > 500, `the text was drawn: ${end} pixels`);
    assert.deepEqual(problems, []);
  });
});

test('a drawn element keeps its .el node: data-id, data-path, the plan\'s box, its plain text, and reveal progress', async (t) => {
  if (!await requireRender(t, BROWSER_ONLY)) return;
  const inner = { id: 'inner', type: 'shape', shape: 'rect', x: 10, y: 20, width: 100, height: 60 };
  const group = { id: 'grp', type: 'group', x: 200, y: 400, children: [inner] };
  const multi = { ...TEXT, id: 'two', text: 'Two whole\nlines', y: 120, anchor: 'left', x: 100 };
  const motion = film([scene([multi, group, ARROW, ICON])]);
  const plan = planOf(motion);
  await onPage(motion, async ({ page, problems }) => {
    const read = () => page.evaluate(() => [...document.querySelectorAll('.el:not(.group)')].map((n) => {
      const r = n.getBoundingClientRect();
      return { id: n.dataset.id, path: n.dataset.path, reveal: n.dataset.reveal, box: { x: r.left, y: r.top, width: r.width, height: r.height }, text: n.textContent, size: getComputedStyle(n).fontSize, weight: getComputedStyle(n).fontWeight, color: getComputedStyle(n).color };
    }));
    await seek(page, 0);
    const before = await read();
    assert.deepEqual(before.map((n) => n.id), ['two', 'inner', 'arrow', 'cog']);
    for (const node of before) {
      const { box } = plan.elements.get(node.path);
      for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(node.box[key] - box[key]) < BOX_TOLERANCE, `${node.id} ${key}: ${node.box[key]} is not ${box[key]}`);
      assert.equal(node.reveal, '0', node.id);
    }
    const written = before[0];
    assert.equal(written.text, 'Two whole\nlines');
    assert.equal(written.size, '60px', 'the plan\'s font size, for the audits');
    assert.equal(written.weight, '700');
    assert.equal(written.color, 'rgb(29, 35, 48)');
    await seek(page, motion.scenes[0].duration - 0.01);
    assert.deepEqual((await read()).map((n) => n.reveal), ['1', '1', '1', '1']);
    assert.deepEqual(problems, []);
  });
});

test('written glyphs sit at the plan\'s x, y with one x per character and no kerning, spaces included', async (t) => {
  if (!await requireRender(t, BROWSER_ONLY)) return;
  const motion = film([scene([{ ...TEXT, text: 'AV To Wa fi', maxWidth: 170 }])]);
  const { box, glyphs } = planOf(motion).elements.get('scenes[0].elements[0]');
  assert.ok(new Set(glyphs.map((g) => g.y)).size > 1, 'it wraps');
  await onPage(motion, async ({ page }) => {
    await seek(page, motion.scenes[0].duration - 0.01);
    const placed = await page.evaluate(() => [...document.querySelectorAll('.el.text text')].flatMap((node) => [...node.textContent].map((ch, i) => {
      const at = node.getStartPositionOfChar(i);
      return { char: ch, x: at.x, y: at.y };
    })));
    const shown = placed.filter((p) => !/\s/.test(p.char));
    assert.deepEqual(shown.map((p) => p.char), glyphs.map((g) => g.char));
    shown.forEach((p, i) => {
      assert.ok(Math.abs(p.x + box.x - glyphs[i].x) < 0.01, `${p.char} x`);
      assert.ok(Math.abs(p.y + box.y - glyphs[i].y) < 0.01, `${p.char} y`);
    });
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.el.text text')).fontKerning), 'none');
  });
});

test('the hand tip sits on the stroke\'s point at time t, within 1 px, in a later scene too', async (t) => {
  if (!await requireRender(t, BROWSER_ONLY)) return;
  const opening = { id: 'open', style: 'standard', duration: 1, elements: [] };
  const motion = film([opening, scene([BOX, ARROW, ICON], { background: '#ffffff' })]);
  const plan = planOf(motion, 1);
  const lines = plan.strokes.filter((s) => s.kind !== 'write');
  const sampled = [lines[0], lines[1], lines.at(-1), lines[Math.floor(lines.length / 2)]];
  await onPage(motion, async ({ page, problems }) => {
    for (const stroke of sampled) {
      for (const p of [0, 0.31, 0.77]) {
        const [x, y] = pointAt(stroke, p);
        const [tipX, tipY] = await tipAt(page, 1 + stroke.t0 + (stroke.t1 - stroke.t0) * p);
        assert.ok(Math.hypot(tipX - x, tipY - y) <= TIP_TOLERANCE, `${stroke.path} at ${p}: tip ${tipX},${tipY}, stroke ${x},${y}`);
      }
    }
    assert.deepEqual(problems, []);
  });
});

test('the hand is off canvas at scene start before entry and after exit, and shows only in sketch scenes', async (t) => {
  if (!await requireRender(t, BROWSER_ONLY)) return;
  const motion = film([scene([BOX]), { id: 'closing', style: 'standard', duration: 1, elements: [] }]);
  const plan = planOf(motion);
  const enter = plan.moves[0];
  const exit = plan.moves.at(-1);
  await onPage(motion, async ({ page, problems }) => {
    const shown = async (sec) => {
      await seek(page, sec);
      return page.evaluate(() => getComputedStyle(document.getElementById('sketch-hand')).display !== 'none');
    };
    assert.equal(await shown(0), false);
    assert.equal(await inkCount(page, await frame(page, 0)), 0, 'an empty board at the start');
    assert.equal(await shown(enter.t0 - 0.001), false);
    assert.equal(await shown(enter.t1), true);
    assert.equal(await shown(exit.t0 + HAND_EXIT / 2), true);
    assert.equal(await shown(exit.t1), false);
    const after = await frame(page, exit.t1 + 0.01);
    const handless = await frame(page, exit.t1 + 0.01, { hand: false });
    assert.ok(after.equals(handless), 'no part of the hand is in the frame once it has left');
    assert.equal(await shown(motion.scenes[0].duration + 0.5), false, 'a standard scene has no hand');
    assert.deepEqual(problems, []);
  });
});

test('the hand: scale and tone from the spec, scaled with the canvas, above the scenes and below the captions', async (t) => {
  if (!await requireRender(t, BROWSER_ONLY)) return;
  const srt = '1\n00:00:00,000 --> 00:00:05,000\nHello there\n';
  const motion = { ...film([scene([BOX])], { sketch: { hand: { tone: 'dark', scale: 0.5 } }, captions: [{ src: 'c.srt' }] }), size: [1280, 720] };
  await onPage(motion, async ({ page }) => {
    const hand = await page.evaluate(() => {
      const node = document.getElementById('sketch-hand');
      const list = [...node.parentElement.children];
      return {
        scale: new DOMMatrix(node.querySelector('.hand-scale').getAttribute('transform')).a,
        fill: node.querySelector('.hand-body').getAttribute('fill'),
        order: list.map((n) => (n === node ? 'hand' : n.className.split(' ')[0])),
      };
    });
    assert.ok(Math.abs(hand.scale - 0.4 * 0.5 * (720 / 1080)) < 1e-3, `scale ${hand.scale}`);
    assert.equal(hand.fill, HAND_TONE_FILLS.dark.fill);
    assert.deepEqual(hand.order, ['scene', 'hand', 'captions']);
  }, { files: { 'c.srt': srt } });
});

test('an opacity on an element and its group is painted once, and stays readable to the audits on their nodes', async (t) => {
  if (!await requireRender(t, BROWSER_ONLY)) return;
  const thick = { id: 'thick', type: 'shape', shape: 'line', strokeWidth: 40, x: 0, y: 0, to: { x: 300, y: 0 }, bow: 0, opacity: 0.5 };
  const motion = film([scene([{ id: 'grp', type: 'group', x: 300, y: 270, opacity: 0.5, children: [thick] }])]);
  await onPage(motion, async ({ page, problems }) => {
    const end = await frame(page, motion.scenes[0].duration - 0.01);
    const [centre] = await pixelsAt(end, [[450, 270]]);
    const expected = BOARD_RGB.map((v, i) => v + ([29, 35, 48][i] - v) * 0.25);
    centre.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) <= 2, `channel ${i}: ${v} is not ${expected[i]}`));
    const seen = await page.evaluate(() => {
      const node = document.querySelector('.el.shape');
      return Number(getComputedStyle(node).opacity) * Number(getComputedStyle(node.parentElement).opacity);
    });
    assert.equal(seen, 0.25);
    assert.deepEqual(problems, []);
  });
});

test('the preview page draws a sketch scene too', async (t) => {
  if (!await requireRender(t, BROWSER_ONLY)) return;
  const motion = film([scene([TEXT, ICON])]);
  await onPage(motion, async ({ page, problems }) => {
    await seek(page, motion.scenes[0].duration - 0.01);
    const shown = await page.evaluate(() => [...document.querySelectorAll('.el')].map((n) => n.dataset.reveal));
    assert.deepEqual(shown, ['1', '1']);
    assert.deepEqual(problems, []);
  }, { mode: 'preview' });
});

test('a push carries one finished board out and the next in, with no hand left behind, and its frames are functions of the time', async (t) => {
  if (!await requireRender(t, BROWSER_ONLY)) return;
  const motion = film([scene([BOX], { id: 'one', duration: 3 }), scene([{ ...BOX, id: 'box2', y: 200 }], { id: 'two', duration: 3, transition: 'push' })]);
  const incoming = planOf(motion, 1);
  const sec = 3 + 0.2;
  const straight = await onPage(motion, async ({ page, problems }) => {
    const handShown = async (at) => {
      await seek(page, at);
      return page.evaluate(() => getComputedStyle(document.getElementById('sketch-hand')).display !== 'none');
    };
    assert.equal(await handShown(2.99), false, 'the first scene\'s hand has left before the push starts');
    assert.equal(await handShown(sec), false, 'the next scene\'s hand has not come in yet');
    // In the window (0.5 s) and after it, the one hand there is follows the incoming plan, so none stays where the old scene left it.
    for (const at of [0.4, 0.49, 0.7]) {
      const pose = handPose(incoming, at);
      assert.equal(pose.visible, true, `the incoming hand is due at ${at}`);
      const [x, y] = await tipAt(page, 3 + at);
      const expectedY = pose.y - pose.lift * 16 * incoming.unit;
      assert.ok(Math.hypot(x - pose.x, y - expectedY) <= TIP_TOLERANCE, `at ${at}: tip ${x},${y}, plan ${pose.x},${expectedY}`);
    }
    assert.equal(await handShown(3 + incoming.moves.at(-1).t1), false, 'it has left again by the end of the drawing');
    const after = await frame(page, 3 + incoming.moves.at(-1).t1);
    assert.ok(after.equals(await frame(page, 3 + incoming.moves.at(-1).t1, { hand: false })), 'no part of a hand in the frame after it has left');
    const png = await frame(page, sec);
    assert.deepEqual(problems, []);
    assert.ok(await inkCount(page, png) > 100, 'the outgoing board\'s drawing is on screen');
    return png;
  });
  const walked = await onPage(motion, async ({ page }) => {
    for (let at = 0; at < sec; at += 0.2) await seek(page, at);
    return frame(page, sec);
  });
  assert.ok(walked.equals(straight));
});

test('a frame is a function of the time alone: seeking straight to it, forward through it or back to it gives the same bytes', async (t) => {
  if (!await requireRender(t, BROWSER_ONLY)) return;
  const motion = film([scene([TEXT, { ...BOX, fill: 'scribble' }, ARROW, ICON])]);
  const plan = planOf(motion);
  const stroke = plan.strokes.find((s) => s.kind === 'write');
  const times = [stroke.t0 + (stroke.t1 - stroke.t0) / 2, plan.strokes.at(-1).t0 + 0.02, plan.drawEnd + 0.1];
  for (const sec of times) {
    const straight = await onPage(motion, ({ page }) => frame(page, sec));
    const walked = await onPage(motion, async ({ page }) => {
      for (let at = 0; at < sec; at += 0.2) await seek(page, at);
      return frame(page, sec);
    });
    const back = await onPage(motion, async ({ page }) => {
      await seek(page, motion.scenes[0].duration - 0.01);
      await page.screenshot({ type: 'png' });
      return frame(page, sec);
    });
    assert.ok(walked.equals(straight), `${sec}: walked forward`);
    assert.ok(back.equals(straight), `${sec}: came back`);
  }
});

test('the page loads lucide.mjs only when the spec has a sketch scene', async (t) => {
  if (!await requireRender(t, BROWSER_ONLY)) return;
  const sketchOnly = /\/template\/sketch\/(lucide|view|hand|svg|plan|geometry|timing)\.mjs$|caveat-700\.woff2$/;
  const standard = { size: [320, 180], scenes: [{ id: 's', duration: 1, elements: [{ id: 'a', type: 'text', text: 'Hi', x: 160, y: 90 }] }] };
  const plain = await onPage(standard, async ({ requests, page }) => ({
    requests,
    nodes: await page.evaluate(() => [document.getElementById('sketch-hand') !== null, document.getElementById('sketch-font') !== null]),
  }));
  assert.deepEqual(plain.requests.filter((p) => sketchOnly.test(p)), []);
  assert.deepEqual(plain.nodes, [false, false], 'a standard page has no hand and no handwriting font rule');
  const drawn = await onPage(film([scene([TEXT, ICON])]), ({ requests, problems }) => ({ requests, problems }));
  assert.ok(drawn.requests.includes('/template/sketch/lucide.mjs'));
  assert.ok(drawn.requests.includes('/template/sketch/caveat-700.woff2'));
  assert.deepEqual(drawn.problems, [], 'the font passes the CSP and every module loads');
});

test('a sketch scene overrides the CSS tokens and the look on its own layer only', async (t) => {
  if (!await requireRender(t, BROWSER_ONLY)) return;
  const motion = film([{ id: 'open', style: 'standard', duration: 1, elements: [{ id: 'a', type: 'text', text: 'Hi', x: 480, y: 200, color: 'accent' }] }, scene([BOX])], { theme: 'blueprint' });
  await onPage(motion, async ({ page }) => {
    const tokens = await page.evaluate(() => {
      const [standard, sketch] = [...document.querySelectorAll('.scene')];
      const read = (node) => Object.fromEntries(['--accent', '--text', '--line', '--surface', '--page'].map((name) => [name, getComputedStyle(node).getPropertyValue(name).trim()]));
      return { standard: read(standard), sketch: read(sketch), text: getComputedStyle(standard.querySelector('.el.text')).color };
    });
    assert.deepEqual(tokens.sketch, { '--accent': PALETTE.accent, '--text': PALETTE.ink, '--line': PALETTE.ink, '--surface': PALETTE.board, '--page': PALETTE.board });
    assert.equal(tokens.standard['--accent'], '#6cb2e6', 'the theme stays on the standard scene');
    assert.equal(tokens.text, 'rgb(108, 178, 230)');
  });
});

// ---- captions over a board ------------------------------------------------------------------------------------------------

const CAPTION_SRT = '1\n00:00:00,000 --> 00:00:06,000\nHello there friend\n';
const INK_RGB = [29, 35, 48];
const DUSK_TEXT = 'rgb(247, 235, 224)';
const DUSK_TEXT_RGB = [247, 235, 224];
const DUSK_PAGE_RGB = [23, 16, 42];
const MIN_CAPTION_CONTRAST = 4.5;
const ACCENT_COLOUR = 'rgb(232, 89, 12)';
const MAX_HALO_SHARE = 1.4; // touched pixels per strong one: measured 1.19 at most for the glyphs' soft edges alone, 1.73 with the theme's dark halo

for (const style of CAPTION_STYLES) {
  test(`a ${style} caption on a sketch board reads in ink under a dark theme, with no dark halo or backdrop`, async (t) => {
    if (!await requireRender(t, BROWSER_ONLY)) return;
    const motion = film([scene([{ ...TEXT, y: 80 }])], { theme: 'dusk', captions: [{ src: 'c.srt', style }] });
    await onPage(motion, async ({ page, problems }) => {
      const png = await frame(page, 5.9);
      const stats = await regionStats(page, png, await captionBox(page), BOARD_RGB);
      assert.ok(stats.strong > 100, `${style}: the caption was drawn (${stats.strong} pixels)`);
      if (['karaoke', 'kinetic'].includes(style)) {
        assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.captions .word.on')).color), ACCENT_COLOUR, 'the current word is in the board\'s accent');
      }
      assert.ok(nearColour(stats.farthest, INK_RGB), `${style}: its darkest pixel is the ink, got ${stats.farthest}`);
      assert.ok(contrast(stats.farthest, BOARD_RGB) >= MIN_CAPTION_CONTRAST, `${style}: contrast ${contrast(stats.farthest, BOARD_RGB)}`);
      assert.ok(stats.touched / stats.strong < MAX_HALO_SHARE, `${style}: ${stats.touched} touched for ${stats.strong} strong pixels`);
      assert.deepEqual(problems, []);
    }, { files: { 'c.srt': CAPTION_SRT } });
  });
}

for (const style of ['plain', 'pill']) {
  test(`a ${style} caption across a mixed film keeps the theme's colours in the standard scenes and takes the board's in the sketch one`, async (t) => {
    if (!await requireRender(t, BROWSER_ONLY)) return;
    const part = (id, extra) => ({ id, duration: 2, elements: [], ...extra });
    const motion = film([part('a', { style: 'standard' }), part('b'), part('c', { style: 'standard' })], { theme: 'dusk', captions: [{ src: 'c.srt', style }] });
    await onPage(motion, async ({ page, problems }) => {
      const first = await frame(page, 1);
      assert.equal(await captionColour(page), DUSK_TEXT);
      const box = await captionBox(page);
      const themed = await regionStats(page, first, box, DUSK_PAGE_RGB);
      assert.ok(nearColour(themed.farthest, DUSK_TEXT_RGB), `standard scene: its brightest pixel is the theme's text, got ${themed.farthest}`);
      const drawn = await frame(page, 3);
      assert.equal(await captionColour(page), `rgb(${INK_RGB.join(', ')})`);
      const board = await regionStats(page, drawn, box, BOARD_RGB);
      assert.ok(nearColour(board.farthest, INK_RGB), `sketch scene: its darkest pixel is the ink, got ${board.farthest}`);
      const later = await frame(page, 5);
      assert.equal(await captionColour(page), DUSK_TEXT);
      const back = await regionStats(page, later, box, DUSK_PAGE_RGB);
      assert.ok(nearColour(back.farthest, DUSK_TEXT_RGB), `the standard scene after it: got ${back.farthest}`);
      assert.ok((await frame(page, 1)).equals(first), 'back in the first scene, the same bytes as the first time');
      assert.deepEqual(problems, []);
    }, { files: { 'c.srt': CAPTION_SRT } });
  });
}

// Review Focus 3.
test('with --theme poster a mixed film\'s standard scene uses poster and its sketch scene keeps #fdfcf8', async (t) => {
  if (!await requireRender(t, BROWSER_ONLY)) return;
  const dir = tmp();
  const spec = path.join(dir, 'm.json');
  writeFileSync(spec, JSON.stringify({ size: [640, 360], scenes: [
    { id: 'open', duration: 1, elements: [] },
    { id: 'draw', style: 'sketch', duration: 3, elements: [{ ...BOX, x: 320, y: 180 }] },
  ] }));
  const corner = async (sec) => {
    const png = path.join(dir, `at-${sec}.png`);
    const r = spawnSync(process.execPath, [RENDER, spec, '--theme', 'poster', '--poster', String(sec), '--poster-out', png], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    return (await pixelsAt(readFileSync(png), [[5, 5]]))[0];
  };
  assert.deepEqual(await corner(0.5), POSTER_PAGE_RGB);
  assert.deepEqual(await corner(2.5), BOARD_RGB);
});

// Review Focus 4.
test('--batch with {{name}} in handwritten text renders each row with its own text', async (t) => {
  const tools = await requireRender(t);
  if (!tools) return;
  const dir = tmp();
  const named = (text) => ({ size: [320, 180], style: 'sketch', scenes: [{ id: 'draw', duration: 3, elements: [{ id: 'who', type: 'text', text, x: 160, y: 90, fontSize: 40 }] }] });
  const spec = path.join(dir, 'm.json');
  writeFileSync(spec, JSON.stringify({ ...named('Hi {{name}}'), vars: { name: { type: 'string', default: 'Ada' } } }));
  writeFileSync(path.join(dir, 'rows.json'), JSON.stringify([{ name: 'Grace' }, { name: 'Bo' }]));
  const out = path.join(dir, 'out');
  mkdirSync(out);
  const r = spawnSync(process.execPath, [RENDER, spec, '--batch', path.join(dir, 'rows.json'), '--out', path.join(out, '{name}.mp4'), '--fps', '10'], { encoding: 'utf8', env: { ...process.env, SOURCE_DATE_EPOCH: '1793318400' } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
  const rows = { Grace: sha(path.join(out, 'Grace.mp4')), Bo: sha(path.join(out, 'Bo.mp4')) };
  assert.notEqual(rows.Grace, rows.Bo);
  for (const [name, hash] of Object.entries(rows)) {
    const literal = path.join(dir, `${name}.json`);
    writeFileSync(literal, JSON.stringify(named(`Hi ${name}`)));
    assert.equal((await renderHash(literal, ['--fps', '10'])).sha256, hash, `${name}: the same film as the text written out`);
  }
});
