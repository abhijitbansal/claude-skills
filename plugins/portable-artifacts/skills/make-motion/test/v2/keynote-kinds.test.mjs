// Every kind in `keynote` (looks-four plan, Task 10): each kind's example built as a one-shot film at 16:9 and 9:16 in pro,
// judged by the frame review (auditFrame, every rule) on frames every 0.5 s with no finding; a tall frame at least 65
// percent used with no empty band over 35 percent of the composition height; a screen's card inside the title-safe box
// through its whole move; the zoom ring round the region with the region inside the frame through the push; the
// compare's back card never drawn above the front one; the statement, quote and end compositions differing in at least
// two of alignment, measure and size step.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import '../../engine/kinds/index.mjs';
import { auditFrame } from '../../engine/review/frame.mjs';
import { regionMarkIds } from '../../engine/review/regions.mjs';
import { lookOfShot } from '../../engine/graph/film.mjs';
import { safeRectFor } from '../../scripts/v2/review.mjs';
import { listEntries } from '../../scripts/v2/list.mjs';
import { prepareFilm } from '../../scripts/v2/prepare/index.mjs';
import { snapshotOf, drawnLeaves, contentOf } from './helpers/bar.mjs';
import { filmOf, filmFor, expandShot } from './helpers/kinds.mjs';
import { pathPoints } from '../../engine/devices/shared.mjs';

const LOOK = 'keynote';
const AUDIT_STEP = 0.5;
const MIN_TALL_USE = 0.65;
const MAX_EMPTY = 0.35;
const FORMATS = Object.freeze(['16:9', '9:16']);
const PREPARED = Object.freeze(['map', 'code']);
const look = () => registries.looks.get(LOOK);
const parked = () => Object.keys(look().kinds).filter((kind) => look().kinds[kind].experimental === true);
const flat = (nodes) => nodes.flatMap((n) => [n, ...flat(n.children ?? [])]);

export const EXAMPLES = Object.freeze(registries.kinds.names().map((kind) => {
  const entry = listEntries('kinds').find((e) => e.name === kind);
  const example = entry?.example ?? registries.kinds.get(kind).example;
  return { kind, shot: example.src === undefined ? example : { ...example, src: 'shot.png' } };
}));

const timesOf = (duration) => [...Array.from({ length: Math.floor(duration / AUDIT_STEP) + 1 }, (_, i) => i * AUDIT_STEP), duration];

/** The example as a one-shot film in keynote at `format`: the built film and its frame review ctx. */
export function keynoteFilm(kind, shot, format) {
  const film = filmOf([shot], LOOK, format, { mode: 'pro' });
  const prepared = PREPARED.includes(kind) ? prepareFilm(film, { filmDir: '.' }).prepared : {};
  const built = filmFor([shot], LOOK, format, { mode: 'pro' }, { prepared });
  const shotLook = lookOfShot(film, 0);
  const canvas = format === '16:9' ? { w: 1920, h: 1080 } : { w: 1080, h: 1920 };
  const ctx = { look: shotLook, canvas, mode: registries.modes.get('pro'), shotId: shot.id, shotIndex: 0, isFirstShot: true, safe: safeRectFor(canvas, shotLook), regionMarks: regionMarkIds(shot), background: built.backgrounds[0] };
  return { built, ctx, canvas };
}

test('the sweep covers all sixteen kinds, and keynote has data for every one', () => {
  assert.equal(EXAMPLES.length, 16);
  for (const { kind } of EXAMPLES) {
    if (registries.kinds.get(kind).lookData === true) assert.ok(look().kinds[kind], `keynote has data for ${kind}`);
  }
});

for (const format of FORMATS) {
  for (const { kind, shot } of EXAMPLES.filter((e) => !parked().includes(e.kind))) {
    test(`keynote ${kind} at ${format}: the example builds with no finding from the frame review`, () => {
      const { built, ctx } = keynoteFilm(kind, shot, format);
      const findings = timesOf(built.duration).flatMap((t) => auditFrame(snapshotOf(built.sampleShot(0, t)), { ...ctx, t })
        .map((f) => `at ${t.toFixed(2)} s: ${f.kind} ${f.rule}: ${f.message}`));
      assert.deepEqual([...new Set(findings)], []);
    });
  }
}

// The largest empty band (px) between `top` and `bottom` that no box covers, the area's own ends counted.
function largestGap(boxes, top, bottom) {
  const spans = boxes.map((b) => [Math.max(top, b[1]), Math.min(bottom, b[1] + b[3])]).filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]);
  let reach = top, gap = 0;
  for (const [a, b] of spans) {
    gap = Math.max(gap, a - reach);
    reach = Math.max(reach, b);
  }
  return Math.max(gap, bottom - reach);
}

for (const { kind, shot } of EXAMPLES.filter((e) => e.kind !== 'free' && !parked().includes(e.kind))) {
  test(`keynote ${kind} at 9:16: the tall frame is at least 65 percent used, with no empty band over 35 percent`, () => {
    const { built, canvas, ctx } = keynoteFilm(kind, shot, '9:16');
    const margin = ctx.look.grid.margin;
    const [top, bottom] = [margin, canvas.h - margin];
    const leaves = contentOf(drawnLeaves(built.sampleShot(0, built.duration)), canvas).filter((l) => l.node.type !== 'field');
    // the ground and the field are not content (contentOf, the field filter); a picture that bleeds the frame is
    const boxes = leaves.map((l) => l.box);
    const first = Math.max(top, Math.min(...boxes.map((b) => b[1]))), last = Math.min(bottom, Math.max(...boxes.map((b) => b[1] + b[3])));
    const used = (last - first) / (bottom - top);
    assert.ok(used >= MIN_TALL_USE, `${(100 * used).toFixed(0)}% of the height used (at least ${100 * MIN_TALL_USE}%)`);
    const gap = largestGap(boxes, top, bottom);
    assert.ok(gap <= MAX_EMPTY * (bottom - top), `an empty band of ${((100 * gap) / (bottom - top)).toFixed(0)}% of the height (at most ${100 * MAX_EMPTY}%)`);
  });
}

const exampleOf = (kind) => EXAMPLES.find((e) => e.kind === kind).shot;
const FPS = 30;
const framesOf = (duration) => Array.from({ length: Math.floor(duration * FPS) + 1 }, (_, i) => i / FPS);
const insideBox = (b, r, slack = 1) => b[0] >= r[0] - slack && b[1] >= r[1] - slack && b[0] + b[2] <= r[0] + r[2] + slack && b[1] + b[3] <= r[1] + r[3] + slack;
const union = (boxes) => {
  const [x0, y0] = [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1]))];
  return [x0, y0, Math.max(...boxes.map((b) => b[0] + b[2])) - x0, Math.max(...boxes.map((b) => b[1] + b[3])) - y0];
};

// The screen (the push and the ring, keynote.mjs kinds.screen; the turned-in-depth card with a second card behind it is
// not built: see the n1 report). The card is inside the title-safe box until the push begins; through the push the
// region, the ring round it, stays inside the frame.
// (At 9:16 a wide screen is two panels, the region enlarged under the whole screen: screen-layout.mjs twoPanelLayout.)
test('keynote screen at 9:16: the screen and its region panel stay inside the title-safe box through the shot', () => {
  const { built, ctx } = keynoteFilm('screen', exampleOf('screen'), '9:16');
  const safe = [ctx.safe.left, ctx.safe.top, ctx.safe.right - ctx.safe.left, ctx.safe.bottom - ctx.safe.top];
  for (const t of timesOf(built.duration)) {
    // the elevated shadow's outer rings (its soft falloff, each under 0.03 alpha) are not the card
    const parts = contentOf(drawnLeaves(built.sampleShot(0, t)), ctx.canvas).filter((l) => !l.node.id.includes('.shadow'));
    // slack: a cut-out's keyline (look.keyline units) may sit over the inset as the camera drifts; the picture may not
    const outside = parts.filter((l) => !insideBox(l.box, safe, ctx.look.keyline)).map((l) => `${l.node.id} ${l.box.map(Math.round)}`);
    assert.deepEqual(outside, [], `at ${t.toFixed(2)} s, against ${safe.map(Math.round)}`);
  }
});

// The card's own parts (its frame and its picture; the elevated shadow's soft rings are not the card), camera applied.
const cardOf = (leaves) => leaves.filter((l) => (l.node.id.startsWith('report.frame') && !l.node.id.includes('.shadow')) || l.node.id === 'report.screen.image');
const PUSHED = 1.2; // the smallest push (kinds/camera.mjs PUSH.min)

// n2 ruling 1: at 16:9 the push frames the whole card (look.kinds.screen.pushFrame), so no row of the screen is sliced at
// the frame's top or bottom (the n1 sheet: the dimmed rows above the ring cut at the top); the card stays in the frame
// through the whole shot, the push still a push (at least PUSH.min)
// gate-keynote-2 ruling 4 (the n4 change to this test): the region lifts off as its own card (look.kinds.screen.lift)
// instead of a push; the screen card and the lifted card each stay inside the title-safe box, the ring round the lifted
// card, which lands at least PUSHED times the screen card's width
const liftedOf = (leaves) => leaves.filter((l) => l.node.id.startsWith('report.region') && !l.node.id.includes('.shadow'));
test('keynote screen at 16:9: the card inside the title-safe box, the lifted region card inside it through the lift, the ring round the lifted card', () => {
  const { built, ctx } = keynoteFilm('screen', exampleOf('screen'), '16:9');
  const safe = [ctx.safe.left, ctx.safe.top, ctx.safe.right - ctx.safe.left, ctx.safe.bottom - ctx.safe.top];
  let lifted = false;
  for (const t of framesOf(built.duration)) {
    const leaves = drawnLeaves(built.sampleShot(0, t));
    const card = cardOf(leaves);
    if (card.length > 0) assert.ok(insideBox(union(card.map((l) => l.box)), safe, 2), `at ${t.toFixed(2)} s the card leaves the title-safe box`);
    const region = liftedOf(leaves);
    if (region.length === 0) continue;
    lifted = true;
    assert.ok(insideBox(union(region.map((l) => l.box)), safe, LOOK.keyline), `at ${t.toFixed(2)} s the lifted card ${union(region.map((l) => l.box)).map(Math.round)} leaves the title-safe box`);
  }
  assert.ok(lifted, 'the region lifts');
  const first = union(cardOf(drawnLeaves(built.sampleShot(0, 0))).map((l) => l.box));
  const end = drawnLeaves(built.sampleShot(0, built.duration));
  const last = union(liftedOf(end).filter((l) => !l.node.id.startsWith('report.ring')).map((l) => l.box));
  assert.ok(last[2] >= PUSHED * first[2] - 1, `the lift takes the card from ${Math.round(first[2])} to ${Math.round(last[2])} px wide (at least ${PUSHED}x)`);
});

// n2 ruling 1: at 9:16 no picture of the screen is cropped inside the region's own width (the n1 sheet: the region panel
// sliced at its sides, "Da", "1"). Every image's crop window spans the region's whole x-extent in picture pixels.
const IMAGE = { width: 1600, height: 1000 }; // helpers/kinds.mjs IMAGES shot.png
for (const [label, shot] of [['titled', exampleOf('screen')], ['untitled', (({ title, ...rest }) => rest)(exampleOf('screen'))]]) {
  test(`keynote screen at 9:16 (${label}): no picture is cropped inside the region's width`, () => {
    const { built } = keynoteFilm('screen', shot, '9:16');
    // n5: the lifted crop starts `trim` of the picture's width inside the region (clear of the UI round its panel)
    const trim = look().kinds.screen.trim * IMAGE.width;
    const [fx, , fw] = shot.regions.total;
    const images = flat(built.sampleShot(0, built.duration)).filter((n) => n.type === 'image');
    assert.ok(images.length > 0, 'a picture');
    for (const n of images) {
      const clip = n.props.clip ?? [0, 0, IMAGE.width, IMAGE.height];
      assert.ok(clip[0] <= fx * IMAGE.width + trim + 1 && clip[0] + clip[2] >= (fx + fw) * IMAGE.width - trim - 1,`${n.id} crops ${clip.map(Math.round)} inside the region ${Math.round(fx * IMAGE.width)} to ${Math.round((fx + fw) * IMAGE.width)}`);
    }
  });
}

// n2 ruling 1: at 9:16 a titled screen is one card under its title set as the headline (look.kinds.screen.tallHero), the
// ring drawn round the region inside the frame; the title is not drawn twice (the chrome row keeps its dots)
test('keynote screen at 9:16: the title is the headline over the whole screen, the ring round the region inside the frame', () => {
  const { built, canvas } = keynoteFilm('screen', exampleOf('screen'), '9:16');
  const leaves = drawnLeaves(built.sampleShot(0, built.duration));
  const head = leaves.find((l) => l.node.id === 'report.headline');
  assert.ok(head, 'a headline');
  assert.ok(!leaves.some((l) => l.node.id === 'report.title'), 'the chrome title is not drawn under the headline');
  const card = union(cardOf(leaves).map((l) => l.box));
  assert.ok(head.box[1] + head.box[3] <= card[1], 'the headline above the card');
  const ring = leaves.filter((l) => l.node.id.startsWith('report.ring'));
  assert.ok(ring.length > 0 && insideBox(union(ring.map((l) => l.box)), [0, 0, canvas.w, canvas.h]), 'the ring inside the frame');
});

test('keynote screen: the frame stands on the elevated card\'s two soft shadow layers, no blur filter; the end card\'s wordmark is set at 800', () => {
  const { nodes } = expandShot(exampleOf('screen'), LOOK, '16:9');
  const layers = flat(nodes).filter((n) => /^report\.frame\.shadow\d$/.test(n.id));
  assert.equal(layers.length, 2, 'two shadow layers under the frame');
  assert.ok(flat(nodes).every((n) => n.props.blur === undefined), 'no blur filter');
  const end = expandShot(exampleOf('end'), LOOK, '16:9');
  const hero = flat(end.nodes).find((n) => n.type === 'text' && n.props.role === 'hero');
  assert.equal(hero.props.font.weight, 800);
});

// n4 change (ruling 4): the ring is drawn round the lifted card, so its box contains the region's picture on that card
test('keynote screen: the zoom ring\'s box contains the region\'s box', () => {
  const { built } = keynoteFilm('screen', exampleOf('screen'), '16:9');
  const end = drawnLeaves(built.sampleShot(0, built.duration));
  const region = end.find((l) => l.node.id === 'report.region.image');
  const ring = end.filter((l) => l.node.id.startsWith('report.ring'));
  assert.ok(region && ring.length > 0, 'a lifted region and a ring');
  const box = union(ring.map((l) => l.box));
  assert.ok(insideBox(region.box, box, 0.5), `ring ${box.map(Math.round)} round region ${region.box.map(Math.round)}`);
});

// The compare: the unspoken card moved back in depth (scaled to 0.94), never dimmed, and never drawn over the front one.
for (const format of FORMATS) {
  test(`keynote compare at ${format}: the back card is smaller, not translucent, and never above the front card where they meet`, () => {
    const { built } = keynoteFilm('compare', exampleOf('compare'), format);
    for (const t of timesOf(built.duration)) {
      const sides = built.sampleShot(0, t).flatMap(function walk(n) { return [n, ...n.children.flatMap(walk)]; }).filter((n) => /^cmp\.(a|b)$/.test(n.id) || /\.(left|right|a|b)$/.test(n.id) && n.type === 'group' && n.scale !== undefined);
      if (sides.length < 2) continue;
      const [front, back] = [...sides].sort((p, q) => (q.scale ?? 1) - (p.scale ?? 1));
      assert.ok((back.scale ?? 1) >= 0.94 - 1e-9, `${back.id}: scaled no further than 0.94`);
      assert.ok(sides.every((n) => (n.opacity ?? 1) === 1), 'no card is translucent');
      const leaves = drawnLeaves(built.sampleShot(0, t));
      const boxOf = (id) => union(leaves.filter((l) => l.node.id.startsWith(`${id}.`)).map((l) => l.box));
      const [fb, bb] = [boxOf(front.id), boxOf(back.id)];
      const meet = fb[0] < bb[0] + bb[2] && bb[0] < fb[0] + fb[2] && fb[1] < bb[1] + bb[3] && bb[1] < fb[1] + fb[3];
      if (meet) assert.ok(sides.indexOf(back) < sides.indexOf(front), `at ${t} s the back card is drawn over the front one`);
    }
  });
}

test('keynote compare: the unspoken side is scaled back, then the spoken one comes forward at the turn (no scrim)', () => {
  const { nodes } = expandShot(exampleOf('compare'), LOOK, '16:9');
  const cards = flat(nodes).filter((n) => n.type === 'group' && n.tracks.scale !== undefined && n.id.split('.').length === 2);
  assert.equal(cards.length, 2, 'two cards with a depth track');
  assert.ok(flat(nodes).every((n) => !n.id.endsWith('.scrim')), 'no paper scrim');
  const [left, right] = cards;
  assert.equal(left.tracks.scale.points[0].v, 1);
  assert.equal(right.tracks.scale.points[0].v, 0.94);
  assert.equal(left.tracks.scale.points.at(-1).v, 0.94);
  assert.equal(right.tracks.scale.points.at(-1).v, 1);
});

// What makes a statement, a quote and an end card differ (Review Focus 7): at least two of alignment, measure, size step.
test('keynote statement, quote and end differ in at least two of alignment, measure and size step', () => {
  const heroOf = (kind) => {
    const { nodes, canvas } = expandShot(exampleOf(kind), LOOK, '16:9');
    const text = flat(nodes).find((n) => n.type === 'text' && n.props.role === 'hero') ?? flat(nodes).find((n) => n.type === 'text');
    const centre = (n) => n.props.x + (n.props.layout.width / 2) + flat(nodes).filter((p) => p.children?.includes(n)).reduce((s, p) => s + (p.props.x ?? 0), 0);
    return { size: text.props.font.size, measure: Math.round(text.props.layout.width / 10), centred: Math.abs(centre(text) - canvas.w / 2) < 0.08 * canvas.w };
  };
  const step = (size) => look().scale.findIndex((s, i) => size <= s || i === look().scale.length - 1);
  const [statement, quote, end] = ['statement', 'quote', 'end'].map(heroOf);
  const differs = (a, b) => [a.centred !== b.centred, a.measure !== b.measure, step(a.size) !== step(b.size)].filter(Boolean).length;
  assert.ok(differs(statement, quote) >= 2, `statement and quote: ${JSON.stringify([statement, quote])}`);
  assert.ok(differs(quote, end) >= 2, `quote and end: ${JSON.stringify([quote, end])}`);
  assert.ok(differs(statement, end) >= 1, 'statement and end are not the same layout');
});

// Shots open set (the ledger and poster gate rulings): the quotation, every code line and every chat message's room are
// on screen on frame 0, the later words stepping in without a translucent ghost.
for (const format of FORMATS) {
  for (const kind of ['quote', 'code', 'feed', 'media']) {
    test(`keynote ${kind} at ${format}: opens set, with no word drawn translucent on frame 0`, () => {
      const { built } = keynoteFilm(kind, exampleOf(kind), format);
      const texts = drawnLeaves(built.sampleShot(0, 0)).filter((l) => l.node.type === 'text');
      assert.ok(texts.length > 0, 'text on frame 0');
      for (const l of texts) {
        const words = l.node.words ?? [];
        assert.ok(words.every((w) => w.opacity === undefined || w.opacity === 0 || w.opacity === 1), `${l.node.id}: a translucent word on frame 0`);
        assert.ok(l.opacity === 1, `${l.node.id} at opacity ${l.opacity}`);
      }
      if (kind === 'media') {
        const caption = texts.find((l) => l.node.id.endsWith('.caption'));
        assert.ok(caption && (caption.node.words ?? []).every((w) => w.opacity === undefined || w.opacity === 1), 'the whole caption on frame 0');
      }
      if (kind === 'quote') assert.ok(texts.some((l) => l.node.props.role === 'hero' && (l.node.words ?? []).every((w) => w.opacity === undefined || w.opacity === 1)), 'the whole quotation on frame 0');
      if (kind === 'feed') {
        const plates = drawnLeaves(built.sampleShot(0, 0)).filter((l) => /\.plate$/.test(l.node.id));
        const last = drawnLeaves(built.sampleShot(0, built.duration)).filter((l) => /\.plate$/.test(l.node.id));
        assert.equal(plates.length, last.length, 'every message\'s plate is on from frame 0');
        // and every message's words, not a blank plate waiting for them (poster's parked failure)
        const words = (leaves) => leaves.filter((l) => l.node.type === 'text').reduce((n, l) => n + (l.node.words ?? []).filter((w) => w.opacity === undefined || w.opacity === 1).length + ((l.node.words ?? []).length === 0 ? 1 : 0), 0);
        assert.equal(words(texts), words(drawnLeaves(built.sampleShot(0, built.duration)).filter((l) => l.node.type === 'text')), 'every word on frame 0');
      }
    });
  }
}
