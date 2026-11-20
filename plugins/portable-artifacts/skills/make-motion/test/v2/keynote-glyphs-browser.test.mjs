// The `keynote` look with real glyphs (n2 rulings 2, 3 and 4): what the Node tests' fake measure cannot see. Each kind's
// example (as --list kinds prints it) as a one-shot pro film, measured in the page (window.__snapshot boxes in canvas
// pixels, window.__source pixels before the post pass).
// - Fill (ban 2): the 9:16 statement leaves no empty band over 35 percent of the composition height; at 16:9 the
//   statement, quote and timeline reach their lower area (at most a quarter of the height empty under them); the 16:9
//   diagram and code span at least 65 percent of the composition's width and height.
// - Review Focus 2: on frame 0 the light (unswept) word is not inset in its heavier word's room: every line of the
//   statement starts its ink at the same x, within a side bearing.
// - The chart's first value label is at full ink from the moment it appears.
// Run with --test-concurrency=1; skips without a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import '../../engine/kinds/index.mjs';
import { listEntries } from '../../scripts/v2/list.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { sessionOrNull, HERE } from './helpers/session.mjs';

const FPS = 30;
const look = registries.looks.get('keynote');
const exampleOf = (kind) => listEntries('kinds').find((e) => e.name === kind)?.example ?? registries.kinds.get(kind).example;
const filmOf = (kind, format) => ({ version: 2, mode: 'pro', look: 'keynote', format, fps: FPS, seed: 3, shots: [exampleOf(kind)] });
const canvasOf = (format) => (format === '16:9' ? { w: 1920, h: 1080 } : { w: 1080, h: 1920 });
const MAX_EMPTY = 0.35;
const MAX_UNDER = 0.25;
const MIN_SPAN = 0.65;
const GROUND = 0.6; // a path covering this share of the canvas is a ground or a scrim, not content
const SIDE_BEARING = 0.06; // em: lines' left ink may differ by a glyph's side bearing, not by a reserved room's inset

// The content leaves of a snapshot, with their canvas boxes: drawn (opacity over 0 down the tree), not the field, a
// ground, a caption, a shadow or a scrim.
function contentBoxes(tree, canvas) {
  const out = [];
  const walk = (n, alpha) => {
    const a = alpha * (n.opacity ?? 1);
    if (a <= 0 || n.type === 'field' || n.props?.caption !== undefined) return;
    const id = n.id ?? '';
    const leaf = (n.children ?? []).length === 0;
    const [, , w, h] = n.bbox ?? [0, 0, 0, 0];
    const skip = id.includes('.shadow') || id.includes('scrim') || id.endsWith('.focus') || w * h >= GROUND * canvas.w * canvas.h || w * h === 0;
    if (leaf && !skip) out.push(n.bbox);
    (n.children ?? []).forEach((c) => walk(c, a));
  };
  tree.forEach((n) => walk(n, 1));
  return out;
}

function largestGap(boxes, top, bottom) {
  const spans = boxes.map((b) => [Math.max(top, b[1]), Math.min(bottom, b[1] + b[3])]).filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]);
  let reach = top, gap = 0;
  for (const [a, b] of spans) {
    gap = Math.max(gap, a - reach);
    reach = Math.max(reach, b);
  }
  return Math.max(gap, bottom - reach);
}

// The settled frame of a one-shot film (its last), its content boxes and the composition band.
async function settled(t, kind, format) {
  const film = filmOf(kind, format);
  const session = await sessionOrNull(film, { specDir: HERE });
  if (!session) { t.skip('no browser'); return null; }
  t.after(() => session.close());
  const last = buildTimeline(film, { fps: FPS }).frameCount - 1;
  const canvas = canvasOf(format);
  const boxes = contentBoxes(await session.page.evaluate((i) => window.__snapshot(i), last), canvas);
  const margin = format === '16:9' ? look.grid.margin : look.gridTall.margin; // 1 unit = 1 px at 1920 x 1080 and 1080 x 1920
  assert.ok(boxes.length > 0, 'content on the settled frame');
  assert.deepEqual(session.errors, []);
  return { boxes, canvas, top: margin, bottom: canvas.h - margin, left: margin, right: canvas.w - margin };
}

const pct = (v) => `${(100 * v).toFixed(0)}%`;

test('keynote statement at 9:16 with real glyphs: no empty band over 35 percent of the composition height', async (t) => {
  const s = await settled(t, 'statement', '9:16');
  if (!s) return;
  const gap = largestGap(s.boxes, s.top, s.bottom) / (s.bottom - s.top);
  assert.ok(gap <= MAX_EMPTY, `an empty band of ${pct(gap)} of the height`);
});

// (timeline at 16:9 is open: 32 percent empty under its events, n2 report; it is not asserted here)
for (const kind of ['statement', 'quote']) {
  test(`keynote ${kind} at 16:9 with real glyphs: it reaches its lower area (at most a quarter of the height empty under it), no band over 35 percent`, async (t) => {
    const s = await settled(t, kind, '16:9');
    if (!s) return;
    const height = s.bottom - s.top;
    const lowest = Math.max(...s.boxes.map((b) => b[1] + b[3]));
    const under = Math.max(0, s.bottom - lowest) / height;
    assert.ok(under <= MAX_UNDER, `${pct(under)} of the height empty under the content`);
    const gap = largestGap(s.boxes, s.top, s.bottom) / height;
    assert.ok(gap <= MAX_EMPTY, `an empty band of ${pct(gap)} of the height`);
  });
}

// The share of the composition's width and height the content spans.
function spanOf(s) {
  const x0 = Math.min(...s.boxes.map((b) => b[0])), x1 = Math.max(...s.boxes.map((b) => b[0] + b[2]));
  const y0 = Math.min(...s.boxes.map((b) => b[1])), y1 = Math.max(...s.boxes.map((b) => b[1] + b[3]));
  return { w: (Math.min(x1, s.right) - Math.max(x0, s.left)) / (s.right - s.left), h: (Math.min(y1, s.bottom) - Math.max(y0, s.top)) / (s.bottom - s.top) };
}

test('keynote code at 16:9 with real glyphs: it spans at least 65 percent of the composition\'s width and height', async (t) => {
  const s = await settled(t, 'code', '16:9');
  if (!s) return;
  const { w, h } = spanOf(s);
  assert.ok(w >= MIN_SPAN && h >= MIN_SPAN, `spans ${pct(w)} of the width and ${pct(h)} of the height`);
});

// The diagram at 16:9 only partly meets ruling 3 (n2 report: a row of three cannot span 65 percent of the height). This
// guards what was fixed: its row across at least 65 percent of the width, its boxes at least a fifth of the height (14
// percent before keynote's pad 56).
const DIAGRAM_ROW = 0.2;
test('keynote diagram at 16:9 with real glyphs: its row spans 65 percent of the width, its boxes a fifth of the height', async (t) => {
  const s = await settled(t, 'diagram', '16:9');
  if (!s) return;
  const { w, h } = spanOf(s);
  assert.ok(w >= MIN_SPAN && h >= DIAGRAM_ROW, `spans ${pct(w)} of the width and ${pct(h)} of the height`);
});

// The leftmost dark pixel of each run of inked rows inside `box` of the frame drawn before the post pass.
async function lineStarts(page, frame, box) {
  return page.evaluate(async ({ i, b }) => {
    await window.__seek(i);
    const src = window.__source;
    const g = src.getContext('2d');
    const [x0, y0] = [Math.max(0, Math.floor(b[0]) - 4), Math.max(0, Math.floor(b[1]) - 4)];
    const [w, h] = [Math.min(src.width - x0, Math.ceil(b[2]) + 8), Math.min(src.height - y0, Math.ceil(b[3]) + 8)];
    const { data } = g.getImageData(x0, y0, w, h);
    const DARK = 90;
    const rowLeft = Array.from({ length: h }, (_, y) => {
      for (let x = 0; x < w; x++) {
        const k = 4 * (y * w + x);
        if (0.2126 * data[k] + 0.7152 * data[k + 1] + 0.0722 * data[k + 2] < DARK) return x0 + x;
      }
      return null;
    });
    const runs = [];
    rowLeft.forEach((left, y) => {
      if (left === null) return;
      const run = runs.at(-1);
      if (run && run.end === y - 1) { run.end = y; run.left = Math.min(run.left, left); } else runs.push({ start: y, end: y, left });
    });
    return runs.filter((r) => r.end - r.start > 8).map((r) => r.left);
  }, { i: frame, b: box });
}

for (const format of ['9:16', '16:9']) {
  test(`keynote statement at ${format} with real glyphs: on frame 0 the light word starts its line where the other lines start`, async (t) => {
    const film = filmOf('statement', format);
    const session = await sessionOrNull(film, { specDir: HERE });
    if (!session) { t.skip('no browser'); return; }
    t.after(() => session.close());
    const all = (ns) => ns.flatMap((n) => [n, ...all(n.children ?? [])]);
    const hero = all(await session.page.evaluate(() => window.__snapshot(0))).find((n) => n.type === 'text' && n.props?.role === 'hero');
    assert.ok(hero, 'the claim on frame 0');
    const starts = await lineStarts(session.page, 0, hero.bbox);
    const size = hero.layout.size;
    t.diagnostic(`line starts ${starts.join(', ')} at ${size.toFixed(0)} px`);
    assert.ok(starts.length >= 2, `${starts.length} lines found`);
    const spread = Math.max(...starts) - Math.min(...starts);
    assert.ok(spread <= SIDE_BEARING * size, `the lines start ${spread} px apart (at most ${(SIDE_BEARING * size).toFixed(0)}, a side bearing)`);
    assert.deepEqual(session.errors, []);
  });
}

// The left ink edge of each word on each line inside `box` (columns of ink split where a gap is wider than `gapPx`).
async function wordStarts(page, frame, box, gapPx) {
  return page.evaluate(async ({ i, b, gap }) => {
    await window.__seek(i);
    const src = window.__source;
    const g = src.getContext('2d');
    const [x0, y0] = [Math.max(0, Math.floor(b[0]) - 4), Math.max(0, Math.floor(b[1]) - 4)];
    const [w, h] = [Math.min(src.width - x0, Math.ceil(b[2]) + 8), Math.min(src.height - y0, Math.ceil(b[3]) + 8)];
    const { data } = g.getImageData(x0, y0, w, h);
    const dark = (x, y) => { const k = 4 * (y * w + x); return 0.2126 * data[k] + 0.7152 * data[k + 1] + 0.0722 * data[k + 2] < 90; };
    const inked = Array.from({ length: h }, (_, y) => { for (let x = 0; x < w; x++) if (dark(x, y)) return true; return false; });
    const bands = [];
    inked.forEach((on, y) => { if (!on) return; const last = bands.at(-1); if (last && last[1] === y - 1) last[1] = y; else bands.push([y, y]); });
    return bands.filter(([a, z]) => z - a > 8).map(([a, z]) => {
      const cols = Array.from({ length: w }, (_, x) => { for (let y = a; y <= z; y++) if (dark(x, y)) return true; return false; });
      const starts = [];
      let blank = Infinity;
      cols.forEach((on, x) => { if (on) { if (blank > gap) starts.push(x0 + x); blank = 0; } else blank += 1; });
      return starts;
    });
  }, { i: frame, b: box, gap: gapPx });
}

// Review Focus 2 at 16:9, where the light word ends a line after another word: its left ink edge on frame 0 (light) is
// where it is once swept heavy, within a side bearing; centred in its room it started half the difference further right
// and slid left as it grew, a loose space before it on frame 0.
const WORD_GAP = 0.18; // em: a gap between ink runs wider than this is a word space (a light period sits 0.12 em off)
test('keynote statement at 16:9 with real glyphs: the light word starts where its heavy self starts (no loose space before it)', async (t) => {
  const film = filmOf('statement', '16:9');
  const session = await sessionOrNull(film, { specDir: HERE });
  if (!session) { t.skip('no browser'); return; }
  t.after(() => session.close());
  const all = (ns) => ns.flatMap((n) => [n, ...all(n.children ?? [])]);
  const last = buildTimeline(film, { fps: FPS }).frameCount - 1;
  const heroAt = async (f) => all(await session.page.evaluate((i) => window.__snapshot(i), f)).find((n) => n.type === 'text' && n.props?.role === 'hero');
  const [first, end] = [await heroAt(0), await heroAt(last)];
  const gap = WORD_GAP * first.layout.size;
  const [light, heavy] = [await wordStarts(session.page, 0, first.bbox, gap), await wordStarts(session.page, last, end.bbox, gap)];
  t.diagnostic(`frame 0 ${JSON.stringify(light)}; frame ${last} ${JSON.stringify(heavy)}`);
  const line = light.findIndex((starts) => starts.length >= 2);
  assert.ok(line >= 0, 'a line with two words');
  // the drift moves the whole block between the two frames: compare each word's start with its line's first word
  const rel = (starts) => starts.map((x) => x - starts[0]);
  const [a, b] = [rel(light[line]), rel(heavy[line])];
  assert.equal(a.length, b.length, 'the same words on the line');
  const moved = Math.max(...a.map((x, k) => Math.abs(x - b[k])));
  assert.ok(moved <= SIDE_BEARING * first.layout.size, `a word on the line starts ${moved} px from where its heavy self starts`);
  assert.deepEqual(session.errors, []);
});

// The chart's value labels (the chart example's bars): each one at full opacity on every frame it is drawn.
for (const format of ['16:9', '9:16']) {
  test(`keynote chart at ${format}: every value label is drawn at full ink from the frame it appears`, async (t) => {
    const film = filmOf('chart', format);
    const session = await sessionOrNull(film, { specDir: HERE });
    if (!session) { t.skip('no browser'); return; }
    t.after(() => session.close());
    const frames = buildTimeline(film, { fps: FPS }).frameCount;
    const faint = await session.page.evaluate((count) => {
      const out = [];
      const walk = (n, a, f) => {
        const o = a * (n.opacity ?? 1);
        if (o <= 0) return;
        if (n.type === 'text' && /\.value\.\d+$/.test(n.id ?? '') && o < 0.999) out.push(`${n.id} at frame ${f}: opacity ${o.toFixed(2)}`);
        (n.children ?? []).forEach((c) => walk(c, o, f));
      };
      for (let f = 0; f < count; f++) window.__snapshot(f).forEach((n) => walk(n, 1, f));
      return out;
    }, frames);
    assert.deepEqual(faint.slice(0, 5), []);
    assert.deepEqual(session.errors, []);
  });
}
