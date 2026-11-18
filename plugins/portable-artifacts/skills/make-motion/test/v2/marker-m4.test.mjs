// The `marker` look, fourth pass (m4, revision round 1 of the gate): what the hand draws and when. The rulings (gate-marker-1):
// the hand draws every element (nothing is set on frame 0), frame 0 shows the pen down with the first stroke begun, a diagram
// is drawn title, box, box, arrow in story order, a picture is a card on the board, every cut between boards is an erase or a
// pan, and the hand never jumps across the board at a cut. Node level, with the fake text measure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import '../../engine/kinds/index.mjs';
import { handPlan, handPose } from '../../engine/hand/index.mjs';
import { resolveShotCut } from '../../engine/cuts/resolve.mjs';
import { erase } from '../../engine/cuts/erase.mjs';
import { expandShot, canvasOf, filmOf } from './helpers/kinds.mjs';

const look = registries.looks.get('marker');
const FORMATS = ['16:9', '9:16'];
const OPEN = { id: 'open', show: 'statement', kicker: 'Ridgeline Prints', say: 'Where does one *order* go?' };
const END = { id: 'close', show: 'end', say: 'That is the journey of one order.', ask: 'ridgelineprints.shop', mark: 'Ridgeline Prints' };
const FLOW = { id: 'flow', show: 'diagram', title: 'One order', nodes: ['Order', 'Print', 'Pack', 'Ship'].map((label) => ({ id: label.toLowerCase(), label })),
  edges: [['order', 'print'], ['print', 'pack'], ['pack', 'ship']].map(([from, to]) => ({ from, to })), say: 'It is printed, then packed, then shipped.' };
const MEDIA = { id: 'print', show: 'media', src: 'shot.png', caption: 'Dawn Ridge, the best seller', say: 'Dawn Ridge is the best seller.' };

const planOf = (shot, format) => {
  const { nodes, timing, ctx } = expandShot(structuredClone(shot), 'marker', format);
  return { ...handPlan(nodes, timing, ctx), timing, ctx, canvas: ctx.canvas, unit: ctx.unit };
};
const orderOf = (plan) => plan.map((s) => s.node).filter((id, i, ids) => id !== ids[i - 1]);

// ---- ruling 1: every element drawn by the hand, frame 0 = pen down, first stroke begun ----

for (const format of FORMATS) {
  for (const shot of [OPEN, END, FLOW, MEDIA]) {
    test(`marker ${shot.show} at ${format}: nothing is set on frame 0, every stroke is drawn (the badge, kicker and hero line included)`, () => {
      const { plan } = planOf(shot, format);
      assert.ok(plan.length > 0);
      const whole = plan.filter((s) => s.end <= 0 && !s.put);
      assert.deepEqual(whole.map((s) => s.node), [], 'a stroke that is whole on frame 0 was set, not drawn');
    });

    test(`marker ${shot.show} at ${format}: frame 0 has the hand on the board, pen down, its first stroke begun`, () => {
      const { plan, canvas, unit } = planOf(shot, format);
      const pose = handPose(plan, 0, look, { canvas, unit });
      assert.equal(pose.down, true, 'the pen is down on frame 0');
      assert.equal(pose.resting, false);
      assert.ok(pose.x > 0 && pose.x < canvas.w && pose.y > 0 && pose.y < canvas.h, 'the hand is on the board');
      const first = plan.reduce((a, b) => (b.start < a.start ? b : a));
      assert.ok(first.start < 0 && first.end > 0, `the first stroke ("${first.node}") is under way on frame 0 (${first.start} to ${first.end})`);
    });
  }
}

// ---- ruling 2: drawing order follows the story ----

for (const format of FORMATS) {
  test(`marker diagram at ${format}: the title, then each box with its label before the arrow that leaves it`, () => {
    const order = orderOf(planOf(FLOW, format).plan);
    const first = (prefix) => order.findIndex((id) => id.startsWith(prefix));
    const last = (prefix) => order.findLastIndex((id) => id.startsWith(prefix));
    for (let k = 0; k < 4; k++) assert.ok(last('flow.title') < first(`flow.node${k}.`), `the title heads node ${k}`);
    // replaced by m5 ruling 4 (marker-m5.test.mjs checks the full order): the arrow is drawn once both its boxes exist
    for (let k = 0; k < 3; k++) {
      assert.ok(last(`flow.node${k}.card`) < first(`flow.edge${k}.`), `box ${k} is drawn before the arrow ${k} that leaves it`);
      assert.ok(last(`flow.node${k + 1}.card`) < first(`flow.edge${k}.`), `the arrow ${k} is drawn after the box ${k + 1} it points at`);
    }
  });
}

// ---- ruling 9: the diagram's boxes are large enough at phone size (the tall one uses the side thirds) ----

test('marker diagram at 9:16: each box is at least 30 percent of the board wide and 7 percent high; at 16:9 at least 11 percent wide', () => {
  for (const [format, minW, minH] of [['9:16', 0.3, 0.07], ['16:9', 0.11, 0.1]]) {
    const { boxes } = expandShot(structuredClone(FLOW), 'marker', format);
    const canvas = canvasOf(format);
    for (const id of ['order', 'print', 'pack', 'ship']) {
      const [, , w, h] = boxes[`node:${id}`];
      assert.ok(w >= minW * canvas.w && h >= minH * canvas.h, `${format} ${id}: ${Math.round(w)} x ${Math.round(h)}`);
    }
  }
});

// ---- ruling 8: the close: the url at the look's secondary minimum at least, the resting hand clear of the badge ----

for (const format of FORMATS) {
  test(`marker end at ${format}: the url is set at ${look.secondary.min} or more, and the hand at rest is clear of the badge`, async () => {
    const { nodes, boxes, canvas, ctx } = expandShot(structuredClone(END), 'marker', format);
    const ask = allNodes(nodes).find((n) => n.id === 'close.ask' || (n.type === 'text' && n.id.startsWith('close.ask')));
    assert.ok(ask, 'the ask is a text node');
    const title = allNodes(nodes).find((n) => n.id === 'close.title');
    // wide: the look's minimum; tall: the hero is 150 there, and the hero rule (three times the smallest) caps the url at 50: the
    // largest the rule allows (PARTIAL for ruling 8, see m4-report.md; with the page's real glyphs the tall hero is 196 and the url
    // 65, marker-m6-browser.test.mjs). m6 (gate-marker-3): the hand rests where the plan puts it (chooseRest), no longer on the
    // static restAt, which the badge, lifted off the bottom for the hand, can meet
    const floor = format === '16:9' ? look.secondary.min : title.props.font.size / 3 - 1;
    assert.ok(ask.props.font.size / ctx.unit >= floor - 1e-6, `the url is ${Math.round(ask.props.font.size / ctx.unit)} units, the floor ${Math.round(floor)}`);
    const { handOutline } = await import('../../engine/hand/shape.mjs');
    const [rx, ry] = handPlan(nodes, ctx.timing, ctx).rest;
    const r = (look.hand.angle * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
    const hand = handOutline(look, ctx.unit).map(([x, y]) => [rx + x * c - y * s, ry + x * s + y * c]);
    const [mx, my, mw, mh] = boxes.mark;
    const inBox = ([x, y]) => x >= mx && x <= mx + mw && y >= my && y <= my + mh;
    const inHand = ([px, py]) => hand.reduce((hit, [xi, yi], i) => {
      const [xj, yj] = hand[(i + hand.length - 1) % hand.length];
      return (yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi ? !hit : hit;
    }, false);
    const corners = [[mx, my], [mx + mw, my], [mx, my + mh], [mx + mw, my + mh]];
    assert.ok(!hand.some(inBox) && !corners.some(inHand), 'the resting hand (its outline) does not touch the badge');
  });
}

// ---- ruling 7: the list draws numbers (the gate's list names none), desk's does not ----

const LEARNED = { id: 'learned', show: 'list', title: 'What we learned', say: 'The North buys most. Dawn Ridge sells best. Every order is printed, packed, shipped.',
  items: ['The North buys most', 'Dawn Ridge sells best', 'Every order is printed, packed, shipped'] };

for (const format of FORMATS) {
  test(`marker list at ${format}: each item gets a hand-written number before it, though the shot names none`, () => {
    const { nodes, timing, ctx } = expandShot(structuredClone(LEARNED), 'marker', format);
    const order = orderOf(handPlan(nodes, timing, ctx).plan.filter((s) => /\.(figure|item)\d/.test(s.node)));
    assert.deepEqual(order, ['learned.figure0', 'learned.item0', 'learned.figure1', 'learned.item1', 'learned.figure2', 'learned.item2']);
  });
}

test('desk list with no numbering names no figure (numbering by look data is marker\'s)', () => {
  const { nodes } = expandShot(structuredClone(LEARNED), 'desk', '16:9');
  assert.equal(allNodes(nodes).some((n) => /figure/.test(n.id)), false);
});

// ---- ruling 4: media is a picture card on the board, never full bleed ----

for (const format of FORMATS) {
  test(`marker media at ${format}: the picture is a card inside the board's margins, not full bleed`, () => {
    const { boxes } = expandShot(structuredClone(MEDIA), 'marker', format);
    const canvas = canvasOf(format);
    const margin = (format === '16:9' ? look.grid : look.gridTall).margin * (Math.min(canvas.w, canvas.h) / 1080);
    const [x, y, w, h] = boxes.picture;
    assert.ok(x >= margin - 1 && y >= margin - 1 && x + w <= canvas.w - margin + 1 && y + h <= canvas.h - margin + 1, `picture box ${[x, y, w, h].map(Math.round)} is inside the margins`);
  });
}

// ---- ruling 5: every cut between boards is an erase or a pan ----

test('marker: with no cut named, every board change is an erase or a slide (a pan), never a hard cut', () => {
  const film = filmOf([OPEN, FLOW, MEDIA, { id: 'g', show: 'statement', say: 'One.' }, { id: 'h', show: 'statement', say: 'Two.' }, END], 'marker', '16:9');
  const names = [1, 2, 3, 4, 5].map((i) => resolveShotCut(film, i, { shotDuration: 3 }).name);
  assert.ok(names.every((n) => ['erase', 'slide'].includes(n)), `cuts: ${names.join(', ')}`);
  assert.ok(names.includes('erase') && names.includes('slide'), 'both are used');
  assert.ok(names.every((n, i) => n !== names[i - 1]), 'never the same cut twice in a row');
});

// ---- ruling 3: the hand never jumps across the board at a cut ----

const sampled = (id, x, y) => Object.freeze({ type: 'group', id, depth: 0, props: Object.freeze({}), x, y, scale: 1, scaleX: 1, scaleY: 1, rotate: 0, opacity: 1, draw: 1, reveal: 1, blur: 0, visible: true, children: Object.freeze([]) });
const handAt = (frame) => frame.find((n) => n.id === 'hand');

test('erase: the hand leaves where the outgoing board left it and arrives where the incoming first stroke is, without a jump', () => {
  const canvas = { w: 1920, h: 1080 };
  const from = [sampled('hand', 1700, 990)], to = [sampled('hand', 600, 300)];
  const args = { from, to, canvas, look };
  const at = (p) => handAt(erase.apply({ ...args, p }));
  const gap = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  assert.ok(gap(at(0.0001), from[0]) < 0.05 * canvas.w, 'at the first frame of the wipe the hand is where it was');
  assert.ok(gap(at(0.9999), to[0]) < 0.05 * canvas.w, 'at the last frame of the wipe the hand is where the incoming board has it');
  // m5 (gate-marker-2 ruling 1): the hand leaves by the right edge and a hand with an eraser comes back; a step between two hands
  // out of frame is no jump (marker-m5.test.mjs samples the real films), and a frame between them holds no hand
  let worst = 0, prev = at(0.0001);
  for (let p = 0.01; p < 1; p += 0.01) {
    const now = at(p);
    if (!now) { prev = undefined; continue; }
    if (prev && !(now.x > canvas.w && prev.x > canvas.w)) worst = Math.max(worst, gap(prev, now));
    prev = now;
  }
  assert.ok(worst < 0.2 * canvas.w, `no visible step of the hand across the wipe is wider than a fifth of the board (${Math.round(worst)} px)`);
});

// ---- ruling 3: at rest the hand sits on the board, fully visible (never cropped in a corner) ----

for (const format of FORMATS) {
  test(`marker at ${format}: the rest point puts the whole hand inside the frame, with room to spare`, async () => {
    const { handOutline } = await import('../../engine/hand/shape.mjs');
    const { restPoint } = await import('../../engine/hand/pose.mjs');
    const canvas = canvasOf(format);
    const unit = Math.min(canvas.w, canvas.h) / 1080;
    const [rx, ry] = restPoint(look, canvas);
    const r = (look.hand.angle * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
    const points = handOutline(look, unit).map(([x, y]) => [rx + x * c - y * s, ry + x * s + y * c]);
    const slack = 10 * unit;
    for (const [x, y] of points) assert.ok(x >= slack && x <= canvas.w - slack && y >= slack && y <= canvas.h - slack, `hand point ${Math.round(x)},${Math.round(y)} is inside the ${canvas.w}x${canvas.h} frame`);
  });
}

// ---- ruling 6: compare. The value is the hero (3x the side title), the vs has room, no dash reads as a minus, the gap is drawn ----

const GAP = { id: 'gap', show: 'compare', say: 'The North bought about three times as many as the West.',
  left: { title: 'North', value: '182', points: ['orders'] }, right: { title: 'West', value: '59', points: ['orders'] } };
const allNodes = (nodes) => nodes.flatMap((n) => [n, ...allNodes(n.children ?? [])]);
const byId = (nodes, id) => allNodes(nodes).find((n) => n.id === id);
const boxOfD = (n) => {
  const nums = (n.props.d.match(/-?\d*\.?\d+/g) ?? []).map(Number);
  const xs = nums.filter((_, i) => i % 2 === 0), ys = nums.filter((_, i) => i % 2 === 1);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
};

for (const format of FORMATS) {
  test(`marker compare at ${format}: each value is at least three times its side's title`, () => {
    const { nodes } = expandShot(structuredClone(GAP), 'marker', format);
    for (const side of ['left', 'right']) {
      const value = byId(nodes, `gap.${side}.value`), title = byId(nodes, `gap.${side}.title`);
      assert.ok(value.props.font.size >= 3 * title.props.font.size - 1e-6, `${side}: value ${value.props.font.size} vs title ${title.props.font.size}`);
    }
  });

  test(`marker compare at ${format}: the vs has at least 36 units of clear space round it`, () => {
    const { nodes, boxes } = expandShot(structuredClone(GAP), 'marker', format);
    // replaced by m5 ruling 6: the vs is a text in the look's face (gap.vs), its box the layout's
    const vs = byId(nodes, 'gap.vs');
    const mark = [vs.props.x, vs.props.y, vs.props.x + vs.props.layout.width, vs.props.y + vs.props.layout.height];
    const [a, b] = [boxes.left, boxes.right];
    const wide = format === '16:9';
    const clear = wide ? Math.min(mark[0] - (a[0] + a[2]), b[0] - mark[2]) : Math.min(mark[1] - (a[1] + a[3]), b[1] - mark[3]);
    assert.ok(clear >= 36, `the vs is ${Math.round(clear)} units from the nearer card`);
  });

  test(`marker compare at ${format}: no point starts with a dash`, () => {
    const { nodes } = expandShot(structuredClone(GAP), 'marker', format);
    // replaced by m5 ruling 6: the points follow the title on its own line, so no node holds a point starting a line
    for (const side of ['left', 'right']) {
      const words = byId(nodes, `gap.${side}.title`).props.layout.lines.flatMap((l) => l.words).map((w) => w.text);
      assert.ok(words.every((w) => !/^[-–—]/.test(w)), `${side}: ${words.join(' ')}`);
    }
  });

  test(`marker compare at ${format}: the gap is drawn: a bar under each value at the true scale of the two, from the same edge`, () => {
    const { nodes } = expandShot(structuredClone(GAP), 'marker', format);
    const [l, r] = ['left', 'right'].map((side) => {
      const bar = byId(nodes, `gap.${side}.bar`);
      assert.ok(bar, `${side} has a bar`);
      const [x0, , x1] = boxOfD(bar);
      return { start: x0, length: x1 - x0 };
    });
    assert.ok(Math.abs(l.length / r.length - 182 / 59) < 0.03 * (182 / 59), `bars ${Math.round(l.length)} and ${Math.round(r.length)} are in the ratio of 182 to 59`);
  });
}

test('desk compare is unchanged: no bar, a dash before each point (bars and plainPoints are marker data)', () => {
  const { nodes } = expandShot(structuredClone(GAP), 'desk', '16:9');
  assert.equal(byId(nodes, 'gap.left.bar'), undefined);
});
