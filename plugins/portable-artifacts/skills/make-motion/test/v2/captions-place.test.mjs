// Where captions stand against what the shot pins and marks (branch review A, I3 and I4): every caption style's zone
// keeps clear of ctx.avoid (pinned text cards) and ctx.marks (marked regions), narrowing or moving along its band; the
// placer and the review compute a mark's box with one function, so the judge never disagrees with the placer; and a
// caption a style truly cannot clear is a creative finding that names the shot and what the author can change.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registries } from '../../engine/registry.mjs';
import { markedBoxes } from '../../engine/captions/index.mjs';
import { markBoxes, pathBox, walkPlaced } from '../../engine/review/marks.mjs';
import { auditFrame, OVERLAP_UNITS } from '../../engine/review/frame.mjs';
import { runInk, unionBox } from '../../engine/kinds/shared.mjs';
import { unitOf } from '../../engine/units.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { shotContext } from '../../engine/graph/film.mjs';
import { safeRectFor } from '../../scripts/v2/review.mjs';
import { FPS, measure, canvasOf, viralOf, filmOf, filmFor, IMAGES } from './helpers/kinds.mjs';

const STYLES = Object.freeze([['lower', 'desk'], ['stack', 'pop'], ['pill', 'cosmos']]);
const FORMATS = Object.freeze(['16:9', '9:16', '1:1']);
const modeFor = (look) => (look === 'pop' ? 'viral' : 'pro');
const SAY = 'This one shows the query behind every chart.';
const meets = (a, b, gap = 0) => a[0] < b[0] + b[2] + gap && b[0] < a[0] + a[2] + gap && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];

function ctxFor(look, format) {
  const film = filmOf([{ id: 'c', show: 'clipping', src: 'shot.png', say: SAY }], look, format, { captions: true, mode: modeFor(look) });
  const timeline = buildTimeline(film, { fps: FPS });
  const canvas = canvasOf(format);
  return shotContext({ film, index: 0, timeline, canvas, measure, assets: IMAGES, viralInsets: viralOf(canvas) });
}

// ---- I4: one computation of a mark's box ----

const MARKED = { id: 'c', show: 'clipping', src: 'shot.png', say: SAY, regions: { q: [0.58, 0.14, 0.37, 0.24], r: [0.1, 0.5, 0.3, 0.3] },
  on: [{ at: 'word:query', do: 'highlight', target: 'region:q' }, { at: 'word:one', do: 'circle', target: 'region:r' }] };

test('the placer\'s mark boxes are the review\'s: one function (marks.mjs markBoxes) over the sampled tree', () => {
  for (const [, look] of STYLES) {
    const built = filmFor([MARKED], look, '16:9', { captions: true, mode: modeFor(look) });
    const duration = buildTimeline(filmOf([MARKED], look, '16:9', { captions: true, mode: modeFor(look) }), { fps: FPS }).shots[0].duration;
    let seen = 0;
    for (const t of [0.5, 1, duration / 2, duration - 0.01]) {
      const sampled = built.sampleShot(0, t);
      const judged = markBoxes(sampled, ['c.on0', 'c.on1']).map((m) => m.box);
      assert.deepEqual(markedBoxes(sampled, ['c.on0', 'c.on1']), judged, `${look} at ${t}`);
      seen += judged.length;
    }
    assert.ok(seen > 0, `${look}: a mark was on screen`);
  }
});

test('a mark\'s box holds its stroke: half the stroke width and the roughness past its points, as the page bounds it', () => {
  const side = { type: 'path', id: 'm.on0.side0', x: 100, y: 50, scale: 2, scaleX: 1, scaleY: 1, rotate: 0, opacity: 1, children: [], draw: 1,
    props: { d: 'M0 0L100 0L100 40L0 40Z', stroke: '#d63a2f', strokeWidth: 6, rough: 1 } };
  const [{ box }] = markBoxes([{ ...side, id: 'm.on0', type: 'group', props: {}, x: 0, y: 0, scale: 1, children: [side] }], ['m.on0']);
  assert.deepEqual(box, [100 - 8, 50 - 8, 200 + 16, 80 + 16], 'grown 3 + 1 in its own space, then scaled by 2');
});

test('a marked path whose points cannot be read has no box, and nothing throws (the review never throws)', () => {
  const path = (d) => ({ type: 'path', id: 'm.on0', x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotate: 0, opacity: 1, children: [], draw: 1, props: { d, stroke: '#000' } });
  for (const d of ['M', '', 'Z']) assert.deepEqual(markBoxes([path(d)], ['m.on0']), [], JSON.stringify(d));
  assert.doesNotThrow(() => markBoxes([path('M0 0H10')], ['m.on0']), 'an H the devices never write reads as its pairs, never a throw');
});

// ---- I3: each style keeps clear of a blocker in its band ----

const BEFORE = JSON.parse(readFileSync(new URL('./fixtures/captions/zones-before.json', import.meta.url), 'utf8'));

test('with nothing pinned or marked, every style\'s zone is exactly what it was before zones avoided anything', () => {
  for (const [style, look] of STYLES) {
    for (const format of FORMATS) {
      const ctx = ctxFor(look, format);
      const zone = registries.captions.get(style).zone;
      assert.deepEqual(zone(ctx), BEFORE[`${style} ${format}`], `${style} ${format}`);
      assert.deepEqual(zone({ ...ctx, avoid: [], marks: [] }), BEFORE[`${style} ${format} empty`]);
    }
  }
  const free = BEFORE['lower 16:9'];
  assert.deepEqual(registries.captions.get('lower').zone({ ...ctxFor('desk', '16:9'), avoid: [], marks: [[free[0] - 40, free[1] + 10, 200, 60]] }), BEFORE['lower 16:9 left mark'], 'lower steps right of a mark on its left as before');
});

test('every style moves or narrows its zone off a mark or a pinned card in its band, at its left, middle or right', () => {
  for (const [style, look] of STYLES) {
    for (const format of FORMATS) {
      const ctx = ctxFor(look, format);
      const zone = registries.captions.get(style).zone;
      const free = zone(ctx);
      const gutter = ctx.look.grid.gutter * ctx.unit;
      const size = Math.min(free[2] / 5, 160);
      for (const share of [0.05, 0.45, 0.8]) {
        const box = [free[0] + free[2] * share, free[1] + free[3] / 4, size, free[3] / 2];
        for (const blockers of [{ marks: [box], avoid: [] }, { marks: [], avoid: [box] }]) {
          const moved = zone({ ...ctx, ...blockers });
          assert.ok(!meets(moved, box, gutter - 1e-6), `${style} ${format} at ${share}: ${moved.map(Math.round)} meets ${box.map(Math.round)}`);
          assert.ok(moved[1] >= free[1] - 1e-6 && moved[1] + moved[3] <= free[1] + free[3] + 1e-6, `${style} ${format}: stays in its band`);
          assert.ok(moved[2] > 0);
        }
      }
    }
  }
});

test('a band blocked across its whole width keeps the style\'s own zone (the review then names the shot, creatively)', () => {
  for (const [style, look] of STYLES) {
    const ctx = ctxFor(look, '16:9');
    const zone = registries.captions.get(style).zone;
    const free = zone(ctx);
    assert.deepEqual(zone({ ...ctx, avoid: [], marks: [[0, free[1], ctx.canvas.w, free[3]]] }), free, style);
  }
});

// ---- I3: the review's words and kinds for what a style could not clear ----

const CANVAS = { w: 1920, h: 1080 };
const ZONE = [600, 820, 1000, 160];
const reviewCtx = (extra = {}) => {
  const look = registries.looks.get('desk');
  return { look, canvas: CANVAS, mode: 'pro', shotId: 'proof', shotIndex: 2, t: 1, safe: safeRectFor(CANVAS, look), ...extra };
};
const SIZE = 44, ASCENT = 0.9 * SIZE, DESCENT = 0.25 * SIZE;
function captionNode(caption = {}) {
  const words = [0, 1, 2].map((k) => ({ text: 'WORD', index: k, x: k * 2.4 * SIZE, width: 1.8 * SIZE }));
  const width = words.at(-1).x + words.at(-1).width;
  return {
    type: 'text', id: 'proof.captions.0.text', depth: 0, x: 700, y: 860, scale: 1, scaleX: 1, scaleY: 1, rotate: 0, opacity: 1, visible: true, children: [],
    props: { role: 'caption', furniture: true, caption: { zone: ZONE, end: 1, hero: 'proof.image', emphasis: [], marks: [], ...caption } },
    words: words.map(() => ({ opacity: 1, x: 0, y: 0, scale: 1 })),
    layout: { size: SIZE, width, height: ASCENT + DESCENT, overflow: false, lines: [{ x: 0, y: ASCENT, width, words }] },
    bbox: [700, 860, width, ASCENT + DESCENT], spread: 0,
  };
}
// A path as the snapshot gives it: its points (`d`, which the mark boxes read) and its page bbox (which the card rule reads).
const rect = ([x, y, w, h]) => `M${x} ${y}L${x + w} ${y}L${x + w} ${y + h}L${x} ${y + h}Z`;
const plain = (id, bbox, props = {}) => ({ type: 'path', id, depth: 0, x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotate: 0, opacity: 1, visible: true, children: [], props: { d: rect(bbox), ...props }, bbox, spread: 0, draw: 1 });
const group = (id, bbox, children) => ({ ...plain(id, bbox), type: 'group', children });
const NO_MOVE_ZONE = /move the zone/;

test('a spoken caption over a marked region is creative: it names the shot and what the author can change, never "move the zone"', () => {
  const mark = group('proof.on0', [650, 820, 400, 120], [plain('proof.on0.side0', [650, 820, 400, 120], { stroke: '#d63a2f' })]);
  const found = auditFrame([mark, captionNode({ marks: ['proof.on0'] })], reviewCtx()).find((f) => f.rule === 'caption-covers');
  assert.ok(found);
  assert.equal(found.kind, 'creative');
  assert.match(found.message, /shot "proof"/);
  assert.match(found.message, /covers the region marked by "proof\.on0"/);
  assert.match(found.message, /move the mark/);
  assert.match(found.message, /captions: false/);
  assert.doesNotMatch(found.message, NO_MOVE_ZONE);
});

test('a spoken caption over a pinned text card is creative and names the shot; any other text over a card stays mechanical', () => {
  const card = group('proof.slug', [680, 840, 400, 120], [plain('proof.slug.paper', [680, 840, 400, 120], { textCard: true })]);
  const found = auditFrame([card, captionNode()], reviewCtx()).find((f) => f.rule === 'card-overlap');
  assert.equal(found.kind, 'creative');
  assert.match(found.message, /shot "proof"/);
  assert.doesNotMatch(found.message, NO_MOVE_ZONE);
  const statement = { ...captionNode(), id: 'proof.text', props: { role: 'hero' } };
  assert.equal(auditFrame([card, statement], reviewCtx()).find((f) => f.rule === 'card-overlap').kind, 'mechanical');
});

test('no caption finding asks the author to move the zone: no spec field controls it', () => {
  const outside = { ...captionNode(), x: 300, bbox: [300, 860, 400, 50] };
  const picture = { ...plain('proof.image', [650, 700, 500, 300]), type: 'image' };
  const messages = auditFrame([picture, outside], reviewCtx()).filter((f) => f.rule.startsWith('caption')).map((f) => f.message);
  assert.ok(messages.length >= 2, JSON.stringify(messages));
  messages.forEach((m) => assert.doesNotMatch(m, NO_MOVE_ZONE, m));
});

// ---- I3: through the engine, a marked shot gets no mechanical caption finding ----

// Every spoken caption's ink on the canvas in a sampled tree (caption groups are upright and unscaled, so an origin is a
// sum of offsets), as the review measures it without the page's line ink.
function captionInks(sampled) {
  const out = [];
  const walk = (n, ox, oy, opacity) => {
    const x = ox + n.x, y = oy + n.y, o = opacity * n.opacity;
    if (o <= 0) return;
    if (n.type === 'text' && n.props.caption) {
      const { layout, font } = n.props;
      out.push(unionBox(layout.lines.map((line) => {
        const ink = runInk(line, font, measure);
        return [x + ink.left, y + line.y - ink.up, ink.right - ink.left, ink.up + ink.down];
      })));
    }
    n.children.forEach((child) => walk(child, x, y, o));
  };
  sampled.forEach((n) => walk(n, 0, 0, 1));
  return out;
}

// The papers of the kind's pinned text cards on screen (not the caption's own), through the shared placement walk.
function kindPapers(sampled) {
  const out = [];
  walkPlaced(sampled, (n, m) => {
    if (n.type === 'path' && n.props.textCard === true && !n.id.startsWith('c.captions')) out.push(pathBox(n, m));
  });
  return out;
}

const overlapBy = (a, b) => Math.min(Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]), Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));

test('a shot whose marks or pinned cards reach the caption band, pushed in or not: its captions keep off them on every frame', () => {
  const regions = [[0.05, 0.7, 0.3, 0.28], [0.62, 0.7, 0.35, 0.28], [0.35, 0.72, 0.3, 0.26]];
  for (const [, look] of STYLES) {
    for (const format of ['16:9', '9:16']) {
      for (const region of regions) {
        // a highlight and a circle on the region (pop draws no region highlight, and its circle only briefly)
        const on = ['highlight', 'circle'].map((device) => ({ at: 'word:one', do: device, target: 'region:q' }));
        const shot = { id: 'c', show: 'clipping', src: 'shot.png', say: SAY, caption: 'Every chart shows its query', regions: { q: region }, on };
        const extra = { captions: true, mode: modeFor(look) };
        const built = filmFor([shot], look, format, extra);
        const { duration } = buildTimeline(filmOf([shot], look, format, extra), { fps: FPS }).shots[0];
        const limit = OVERLAP_UNITS * unitOf(canvasOf(format));
        let marked = 0;
        for (let t = 0; t <= duration; t += 0.1) {
          const sampled = built.sampleShot(0, t);
          const marks = markedBoxes(sampled, ['c.on0', 'c.on1']);
          marked += marks.length;
          const blockers = [...marks, ...kindPapers(sampled)];
          for (const ink of captionInks(sampled)) {
            const hit = blockers.find((b) => overlapBy(ink, b) > limit);
            assert.equal(hit, undefined, `${look} ${format} region ${region} at ${t.toFixed(1)}: caption ${ink.map(Math.round)} over ${hit?.map(Math.round)}`);
          }
        }
        assert.ok(marked > 0, `${look} ${format} region ${region}: a mark is on screen in the shot`);
      }
    }
  }
});
