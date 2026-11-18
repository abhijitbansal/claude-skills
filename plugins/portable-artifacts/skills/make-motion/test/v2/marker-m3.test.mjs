// The `marker` look, third pass (m3): what is drawn, where and when, so more kinds hold at both formats. The hand's findings
// (hand-speed, covered, stroke-edge) are not touched; each test below is about the order or the place a kind builds its
// marks. Node level, with the fake text measure (the browser examples test judges the same kinds with real glyphs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import '../../engine/kinds/index.mjs';
import { handPlan } from '../../engine/hand/index.mjs';
import { flattenForHand } from '../../engine/hand/flatten.mjs';
import { node } from '../../engine/graph/node.mjs';import { prepareFilm } from '../../scripts/v2/prepare/index.mjs';
import { expandShot, expandIn, filmOf, all, pushLanding } from './helpers/kinds.mjs';

const example = (kind) => structuredClone(registries.kinds.get(kind).example);
const ids = (nodes) => all(nodes).map((n) => n.id);

// ---- list: the bullet is drawn with its item, before it ----

for (const format of ['16:9', '9:16']) {
  test(`marker list at ${format}: each step figure is built before its item (look data bulletFirst)`, () => {
    const { nodes } = expandShot(example('list'), 'marker', format);
    const order = ids(nodes);
    for (const k of [0, 1, 2]) assert.ok(order.indexOf(`how.figure${k}`) < order.indexOf(`how.item${k}`), `figure ${k} comes before item ${k}`);
  });

  test(`marker list at ${format}: the hand writes a step's figure before its item, and the first thing on the board is a figure`, () => {
    const { nodes, timing, ctx } = expandShot(example('list'), 'marker', format);
    const { plan } = handPlan(nodes, timing, ctx);
    const first = plan.filter((s) => s.kind === 'write' && /^how\.(figure|item)/.test(s.node));
    // an item of two lines has a stroke for each: the order of nodes is what is judged
    const order = first.map((s) => s.node).filter((id, i, all) => id !== all[i - 1]);
    assert.deepEqual(order, ['how.figure0', 'how.item0', 'how.figure1', 'how.item1', 'how.figure2', 'how.item2']);
    assert.equal(first[0].end, 0, 'the first figure is on the board on frame 0');
  });
}

// ---- number: the label is written below the figure's ink box ----

const INK_DOWN = 0.22; // em under the baseline the review counts a written line's ink to (scripts/v2/review-hand.mjs)

for (const format of ['16:9', '9:16']) {
  test(`marker number at ${format}: the label is written under the digits' ink box, so the hand writing it never hangs over the figure`, () => {
    const { nodes, timing, ctx } = expandShot(example('number'), 'marker', format);
    const planned = handPlan(nodes, timing, ctx);
    const digits = planned.nodes.find((n) => n.id === 'rows.value.digits');
    const baseline = digits.props.y + digits.props.layout.lines[0].y;
    const label = planned.plan.find((s) => s.node === 'rows.label');
    const inkBottom = baseline + INK_DOWN * digits.props.font.size;
    assert.ok(label.points[0][1] >= inkBottom, `the label is written at y ${Math.round(label.points[0][1])}, the digits' ink box ends at ${Math.round(inkBottom)}`);
  });
}

// ---- compare: the arrow between the cards is drawn between them, before the second card's copy ----

for (const format of ['16:9', '9:16']) {
  test(`marker compare at ${format}: the before-after arrow is drawn after the first card and before the second card's copy`, () => {
    const { nodes, timing, ctx } = expandShot(example('compare'), 'marker', format);
    const order = handPlan(nodes, timing, ctx).plan.map((s) => s.node).filter((id, i, all) => id !== all[i - 1]);
    const arrow = order.indexOf('swap.arrow');
    assert.ok(arrow > order.indexOf('swap.left.points'), 'after the left card is written');
    assert.ok(arrow < order.indexOf('swap.right.title'), 'before the right card is written');
    assert.ok(arrow < order.indexOf('swap.right.points'), 'before the right card points');
  });
}

// ---- media: the caption's box is an opaque ground put on with its text, over the picture ----

const look = registries.looks.get('marker');
const PICTURE = node('image', 'pic', { src: 'shot.png', w: 1920, h: 1080, x: 0, y: 0 });
const plate = (id, props = {}) => node('path', id, { d: 'M100 800L500 800L500 900L100 900Z', ...props });

test('flatten: a plate in the board colour over a picture is kept as an opaque ground, its edge merged onto it', () => {
  const out = flattenForHand([PICTURE, plate('c.paper', { fill: look.palette.paper }), plate('c.edge', { stroke: look.palette.ink, strokeWidth: 6 })], look, 1);
  const ground = out.find((n) => n.id === 'c.paper');
  assert.ok(ground, 'the plate is kept');
  assert.equal(ground.props.fill, look.palette.paper);
  assert.equal(ground.props.stroke, look.palette.ink, 'the edge is on the ground node');
  assert.equal(ground.props.put, true, 'put on at once by the hand, not drawn');
  assert.equal(out.find((n) => n.id === 'c.edge'), undefined, 'no separate edge to draw');
});

test('flatten: the same plate with no picture under it is dropped as before, its edge drawn by the hand', () => {
  const out = flattenForHand([plate('c.paper', { fill: look.palette.paper }), plate('c.edge', { stroke: look.palette.ink, strokeWidth: 6 })], look, 1);
  assert.equal(out.find((n) => n.id === 'c.paper'), undefined);
  assert.equal(out.find((n) => n.id === 'c.edge').props.put, undefined);
});

test('flatten: a drawn mark over a picture (a ring, an underline) is still drawn by the hand, never put on', () => {
  const out = flattenForHand([PICTURE, plate('ring', { stroke: look.palette.accent, strokeWidth: 7 })], look, 1);
  assert.equal(out.find((n) => n.id === 'ring').props.put, undefined);
});

test('a put ground that is not the first element appears set when its sentence opens, and is not in the plan', () => {
  const out = expandShot({ id: 'b', show: 'free', say: 'First we write a word. Then a plate arrives under it and we write more.', nodes: [
    { type: 'text', id: 'one', props: { text: 'First', font: { family: 'Caveat', size: 96, weight: 700, width: 'normal' }, maxWidth: 900, x: 160, y: 300, fill: '#1b1b1f' }, sentence: 0 },
    { type: 'path', id: 'ground', props: { d: 'M100 500L600 500L600 700L100 700Z', fill: look.palette.paper, stroke: '#1b1b1f', strokeWidth: 6, put: true }, sentence: 1 },
    { type: 'text', id: 'two', props: { text: 'More', font: { family: 'Caveat', size: 96, weight: 700, width: 'normal' }, maxWidth: 900, x: 160, y: 640, fill: '#1b1b1f' }, sentence: 1 },
  ].map((n) => ({ type: n.type, id: n.id, props: { ...n.props, sentence: n.sentence } })) }, 'marker', '16:9');
  const { plan, set } = handPlan(out.nodes, out.timing, out.ctx);
  assert.equal(plan.some((s) => s.node === 'ground'), false, 'the hand does not draw it');
  assert.deepEqual(set.map((s) => s.node), ['ground']);
  assert.ok(Math.abs(set[0].at - out.timing.sentences[1].start) < 1e-6, 'put on when its sentence opens');
});

test('marker media at 16:9: the caption box is a ground in the board colour kept over the picture, whole on frame 0, with the text written into it', () => {
  const { nodes, timing, ctx } = expandShot({ ...example('media'), src: 'shot.png' }, 'marker', '16:9'); // the helper's loaded picture
  const out = handPlan(nodes, timing, ctx);
  const ground = out.nodes.find((n) => n.id === 'catch.card.paper');
  assert.ok(ground, 'the card plate is kept');
  assert.equal(ground.props.fill, look.palette.paper);
  assert.ok(ground.props.stroke, 'with its edge');
  assert.equal(out.nodes.some((n) => n.id === 'catch.card.edge'), false);
  const strokes = out.plan.filter((s) => s.node === 'catch.card.paper');
  assert.ok(strokes.every((s) => s.end === 0), 'the box is there on frame 0');
  const caption = out.plan.find((s) => s.node === 'catch.caption');
  assert.ok(caption.kind === 'write' && caption.end > caption.start, 'the hand writes the caption into it');
  const order = out.nodes.map((n) => n.id);
  const picture = out.nodes.findIndex((n) => n.id.startsWith('catch.picture') || n.type === 'image');
  assert.ok(picture >= 0 && picture < order.indexOf('catch.card.paper'), 'the ground is painted above the picture');
});

// ---- map: the title across the top inside the margins, the map scaled to the board under it ----

// (the fake measure sets Caveat wider than the page does, so how many lines the title takes and how large the map is are
// judged in the page: marker-m3-browser.test.mjs)
test('marker map at 16:9: the title is above the map and clear of it, inside the margins; the map is inside them too', () => {
  const film = filmOf([example('map')], 'marker', '16:9');
  const { nodes, boxes, canvas } = expandIn(film, 0, { prepared: prepareFilm(film, { filmDir: '.' }).prepared });
  const title = all(nodes).find((n) => n.id === 'reach.title');
  const [mx, my, mw, mh] = boxes.map;
  const margin = look.grid.margin;
  const [tx, ty, tw, th] = [title.props.x + title.props.layout.lines[0].x, title.props.y, title.props.layout.width, title.props.layout.height];
  assert.ok(tx >= margin && tx + tw <= canvas.w - margin, 'inside the left and right margins');
  assert.ok(ty >= margin, 'under the top margin');
  assert.ok(ty + th <= my, `clear of the map (title ends ${Math.round(ty + th)}, map starts ${Math.round(my)})`);
  assert.ok(mx >= margin && mx + mw <= canvas.w - margin && my + mh <= canvas.h - margin, 'the map is inside the margins');
});

test('desk map is unchanged: the title beside the map, on columns 2 to 5 (titleAbove is look data)', () => {
  const film = filmOf([example('map')], 'desk', '16:9');
  const { nodes, boxes } = expandIn(film, 0, { prepared: prepareFilm(film, { filmDir: '.' }).prepared });
  const title = all(nodes).find((n) => n.id === 'reach.title');
  assert.ok(title.props.x + title.props.layout.width <= boxes.map[0], 'beside the map, left of it');
});

// ---- clipping: one print, one frame, and the ring drawn on its spoken word ----

const CLIP = () => ({ ...example('clipping'), src: 'shot.png' });

for (const format of ['16:9', '9:16']) {
  test(`marker clipping at ${format}: one picture on the board (no close-up print laid over the first)`, () => {
    const { nodes } = expandShot(CLIP(), 'marker', format);
    assert.equal(all(nodes).filter((n) => n.type === 'image').length, 1);
    assert.equal(all(nodes).some((n) => n.id.includes('.close')), false);
  });

  test(`marker clipping at ${format}: the camera never pushes in on the region (nothing on a whiteboard zooms)`, () => {
    const { camera } = expandShot(CLIP(), 'marker', format);
    assert.equal(pushLanding(camera), undefined);
  });

  test(`marker clipping at ${format}: the ring is not on the board from the first frame: the hand draws it from its spoken word`, () => {
    const { nodes, timing, ctx } = expandShot(CLIP(), 'marker', format);
    const { plan } = handPlan(nodes, timing, ctx);
    const ring = plan.filter((s) => s.node === 'query.on0');
    assert.ok(ring.length > 0, 'the ring is a stroke of the hand');
    assert.ok(ring.every((s) => s.start > 0 && s.end > s.start), `the ring is drawn over time (starts ${ring[0].start.toFixed(2)})`);
    assert.ok(ring.at(-1).end <= timing.duration - 0.3 + 1e-6, 'and is done before the hold ends');
  });
}

test('an on-event mark in a hand look names the time it is drawn in (its draw track), and in desk it does not', () => {
  const [on] = all(expandShot(CLIP(), 'marker', '16:9').nodes).filter((n) => n.id === 'query.on0');
  const keys = on.tracks.draw.points;
  assert.deepEqual(on.props.window, [keys.findLast((k) => k.v <= 0).t, keys.find((k) => k.v >= 1).t], 'the window is the draw track\'s run, from its last rest to its first full key');
  assert.ok(on.props.window[0] > 0, 'and it begins after frame 0');
  const desk = all(expandShot({ ...CLIP(), say: 'Every chart on this page shows its query.' }, 'desk', '16:9').nodes).find((n) => n.id === 'query.on0');
  assert.equal(desk?.props.window, undefined);
});

test('a mark with a window of its own is never the first element (the first element is whole on frame 0)', () => {
  const FONT = { family: 'Caveat', size: 96, weight: 700, width: 'normal' };
  const out = expandShot({ id: 'b', show: 'free', say: 'Write this word and then ring the picture near the end of it all.', nodes: [
    { type: 'path', id: 'ring', props: { d: 'M100 500L400 500L400 700L100 700Z', stroke: '#d1321f', strokeWidth: 7, window: [1.5, 2.5] } },
    { type: 'text', id: 'word', props: { text: 'Hello', font: FONT, maxWidth: 900, x: 160, y: 300, fill: '#1b1b1f' } },
  ] }, 'marker', '16:9');
  const { plan } = handPlan(out.nodes, out.timing, out.ctx);
  assert.equal(plan.find((s) => s.node === 'word').end, 0, 'the word is the first element, whole on frame 0');
  assert.ok(plan.find((s) => s.node === 'ring').start > 0, 'the ring is drawn later');
});

test('desk compare keeps the arrow after both cards (betweenFirst is marker data)', () => {
  const { nodes } = expandShot(example('compare'), 'desk', '16:9');
  const order = ids(nodes);
  assert.ok(order.indexOf('swap.arrow') > order.indexOf('swap.right.points'));
});

test('desk list is unchanged: the item first, its figure after (bulletFirst is marker data)', () => {
  const { nodes } = expandShot(example('list'), 'desk', '16:9');
  const order = ids(nodes);
  assert.ok(order.indexOf('how.item0') < order.indexOf('how.figure0'));
});
