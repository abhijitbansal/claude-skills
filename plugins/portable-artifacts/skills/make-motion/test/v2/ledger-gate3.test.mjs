// The `ledger` gate, revision round 2 (gate-ledger-2.md; the controller's rulings, binding). Each test pins one ruling
// on the gate films (or a kind's own example) as the Node build expands them (the tests' stand-in measure and times):
//   1. the feed at 9:16: the title a small ruled tag (the look's slug), the messages the hero filling the frame, the
//      speakers told apart by an indent, the spoken message in ink and the others dimmed to ink2, every row set at once;
//   2. holds: a statement's accent and a chart's final values on screen at least 1.2 s before the cut;
//   3. timeline: the title the hero over dates and events, which fill the frame and are set from frame 0 (and the list);
//   4. map: no route over another city's pin or name, only the origin in the accent;
//   5. charts: the "0" tick and the first value apart, the claimed point in the accent, bars grown in their final colours;
//   6. compare: the values the hero filling the frame, on the film's left margin.
// "Fills the frame" is ban 2's extent (as the kinds sweep measures it) and the tallest empty band (bandsOf): an extent
// test alone passed while the reviewer saw 55 percent of the frame blank between spread rows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registries } from '../../engine/registry.mjs';
import '../../engine/kinds/index.mjs';
import { sampleGraph } from '../../engine/graph/sample.mjs';
import { lookForFormat } from '../../engine/looks/index.mjs';
import { barInput } from './helpers/bar.mjs';
import { pathPoints } from '../../engine/devices/shared.mjs';

// a path node's box from its points, in canvas pixels
function pinBox({ n, dx, dy }) {
  const pts = pathPoints(n.props.d);
  const xs = pts.map(([x]) => x + dx + (n.x ?? 0)), ys = pts.map(([, y]) => y + dy + (n.y ?? 0));
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
}

const LOOK = 'ledger';
const FILMS = Object.freeze({ '16:9': 'gate-ledger.json', '9:16': 'gate-ledger-tall.json' });
const PREPARED = Object.freeze(['map', 'code']);
const MAX_EMPTY = 0.35; // of the composition height: ban 2, as the kinds sweep measures it
const MAX_BAND = 0.25; // of the composition height: the tallest empty band (round 2's chat left about 55 percent)
const EPS = 1e-6;
const filmOf = (format) => JSON.parse(readFileSync(new URL(`../../references/examples/v2/${FILMS[format]}`, import.meta.url), 'utf8'));
const shotOf = (format, id) => filmOf(format).shots.find((s) => s.id === id);
const inputOf = (format, shot) => barInput(shot.show, shot, { look: LOOK, format, prepare: PREPARED.includes(shot.show) });
const look = () => registries.looks.get(LOOK);

// Every drawn node of a sampled graph with its effective opacity (its own times its groups') and its offset (the
// groups' x and y added up).
function drawn(nodes, alpha = 1, dx = 0, dy = 0) {
  return nodes.flatMap((n) => {
    const a = alpha * (n.opacity ?? 1);
    const ox = dx + (n.type === 'group' ? n.x ?? 0 : 0), oy = dy + (n.type === 'group' ? n.y ?? 0 : 0);
    const self = n.type === 'group' || n.type === 'field' ? [] : [{ n, a, dx, dy }];
    return [...self, ...drawn(n.children ?? [], a, ox, oy)];
  });
}
const textsAt = (input, t) => drawn(sampleGraph(input.nodes, t)).filter(({ n, a }) => n.type === 'text' && a > EPS && n.props.layout.lines.length > 0);
// a text node's box from its layout: [x, top, w, h] in canvas pixels
const boxOf = ({ n, dx, dy }) => [n.x + dx, n.y + dy, n.props.layout.width, n.props.layout.height];

/** Ban 2 as the kinds sweep measures it (`extent`: the share of the height outside the first text's top to the last's
 *  foot) and the tallest empty band between texts or under the last (`band`), each a share of the composition height.
 *  The band rule is what keeps the extent from being met by spreading a few small rows down the frame. */
export function bandsOf(input, format, texts) {
  const margin = lookForFormat(input.look, format).grid.margin * input.unit;
  const top = margin, bottom = input.canvas.h - margin, h = bottom - top;
  const spans = texts.map(boxOf).map(([, y, , bh]) => [Math.max(top, y), Math.min(bottom, y + bh)]).filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]);
  let reach = spans[0][0], band = 0;
  for (const [a, b] of spans) {
    band = Math.max(band, a - reach);
    reach = Math.max(reach, b);
  }
  band = Math.max(band, bottom - reach);
  return { extent: 1 - (reach - spans[0][0]) / h, band: band / h };
}

// ---- ruling 1: the feed ----

const FEED_EXAMPLE = Object.freeze(registries.kinds.get('feed').example);
const FEEDS = Object.freeze([['gate chat', '9:16', () => shotOf('9:16', 'chat')], ['kind example', '9:16', () => FEED_EXAMPLE], ['kind example', '16:9', () => FEED_EXAMPLE]]);
const rowsOf = (texts, id) => texts.filter(({ n }) => /^.+\.item\d+\.text$/.test(n.id) && n.id.startsWith(`${id}.`)).sort((p, q) => p.n.id.localeCompare(q.n.id, 'en', { numeric: true }));

for (const [name, format, shotFn] of FEEDS) {
  test(`ruling 1: ${format} feed (${name}): the title is the look's small ruled tag, never larger than a message`, () => {
    const shot = shotFn();
    const input = inputOf(format, shot);
    const parts = drawn(sampleGraph(input.nodes, input.duration));
    assert.ok(parts.some(({ n }) => n.id === `${shot.id}.slug.plate`), 'the title on the look\'s tag plate');
    assert.ok(!parts.some(({ n }) => n.id === `${shot.id}.title`), 'no display-size title over the rows');
    const kicker = parts.find(({ n }) => n.id === `${shot.id}.kicker`);
    assert.ok(kicker, 'the title set as the tag\'s text');
    const rows = rowsOf(textsAt(input, input.duration), shot.id);
    assert.equal(rows.length, shot.items.length, 'every message drawn');
    assert.ok(rows.every(({ n }) => n.props.font.size > kicker.n.props.font.size), 'every message larger than the tag');
    assert.ok(rows.every(({ n }) => n.props.font.family === look().fonts.display.family && n.props.font.weight === look().fonts.display.weight), 'messages in the display face');
  });

  test(`ruling 1: ${format} feed (${name}): every row is set on frame 0, the speakers told apart by an indent, no typing dots`, () => {
    const shot = shotFn();
    const input = inputOf(format, shot);
    const zero = rowsOf(textsAt(input, 0), shot.id);
    assert.equal(zero.length, shot.items.length, 'every message on the first frame');
    const all = drawn(sampleGraph(input.nodes, 0));
    assert.deepEqual(all.filter(({ n }) => /\.dots?\d*$/.test(n.id) || /\.dots\./.test(n.id)).map(({ n }) => n.id), [], 'typing dots');
    const xs = (from) => zero.filter(({ n }) => shot.items[Number(/item(\d+)/.exec(n.id)[1])].from === from).map((p) => boxOf(p)[0]);
    const indent = look().kinds.feed.indent * input.unit;
    assert.ok(Math.min(...xs('me')) - Math.max(...xs('them')) >= indent - 1, `me at ${xs('me').map(Math.round)}, them at ${xs('them').map(Math.round)}: indent ${indent}`);
  });

  test(`ruling 1: ${format} feed (${name}): the spoken message in ink, every other one dimmed to ink2 (opaque)`, () => {
    const shot = shotFn();
    const input = inputOf(format, shot);
    const { ink, ink2 } = look().palette;
    const colours = (t) => rowsOf(textsAt(input, t), shot.id).map(({ n, a }) => {
      assert.ok(a > 1 - EPS, `${n.id} opaque`);
      const fills = new Set((n.words?.length ? n.words : [null]).map((w) => w?.fill ?? n.props.fill));
      assert.equal(fills.size, 1, `${n.id}: one colour across the message`);
      return [...fills][0];
    });
    const last = shot.items.length - 1;
    assert.deepEqual(colours(0), shot.items.map((_, k) => (k === 0 ? ink : ink2)), 'the first message lit on frame 0');
    assert.deepEqual(colours(input.duration), shot.items.map((_, k) => (k === last ? ink : ink2)), 'the last message lit at the end');
  });
}

for (const [name, shotFn] of [['gate chat', () => shotOf('9:16', 'chat')], ['kind example', () => FEED_EXAMPLE]]) {
  test(`ruling 1: 9:16 feed (${name}): the messages fill the frame, at most 35 percent of the height empty, from frame 0`, () => {
    const shot = shotFn();
    const input = inputOf('9:16', shot);
    for (const t of [0, input.duration]) {
      const { extent, band } = bandsOf(input, '9:16', textsAt(input, t));
      assert.ok(extent <= MAX_EMPTY, `at ${t.toFixed(2)} s ${(100 * extent).toFixed(0)}% of the height outside the texts' extent`);
      assert.ok(band <= MAX_BAND, `at ${t.toFixed(2)} s an empty band ${(100 * band).toFixed(0)}% of the height`);
    }
  });
}

// ---- ruling 2: holds ----

const HOLD = 1.2; // s: the accent and the final values are on screen at least this long before the cut
const FRAME = 1 / 30;
// What a part shows: its opacity, fill, stroke, draw, reveal and scale, and each word's opacity and fill.
const stateOf = ({ n, a }) => JSON.stringify([a.toFixed(3), n.props?.fill, n.props?.stroke, n.draw, n.reveal, n.scaleX, n.scaleY, (n.words ?? []).map((w) => [w?.opacity, w?.fill])]);
const statesAt = (input, t) => new Map(drawn(sampleGraph(input.nodes, t)).map((p) => [p.n.id, stateOf(p)]));

for (const format of Object.keys(FILMS)) {
  for (const shot of filmOf(format).shots.filter((s) => s.show === 'statement' || s.show === 'chart')) {
    test(`ruling 2: ${format} ${shot.id} (${shot.show}): nothing changes in the last ${HOLD} s before the cut`, () => {
      const input = inputOf(format, shot);
      const end = statesAt(input, input.duration);
      const moved = (t) => [...end].filter(([id, s]) => statesAt(input, t).get(id) !== s).map(([id]) => id);
      assert.deepEqual(moved(input.duration - HOLD), [], `changed after ${(input.duration - HOLD).toFixed(2)} s of a ${input.duration.toFixed(2)} s shot`);
    });
  }
}

test('ruling 2: the statement accent is on screen at its final colour before the hold starts', () => {
  for (const format of Object.keys(FILMS)) {
    const shot = shotOf(format, 'lede');
    const input = inputOf(format, shot);
    const accentAt = (t) => drawn(sampleGraph(input.nodes, t)).some(({ n }) => (n.words ?? []).some((w) => w?.fill === look().palette.accent));
    assert.ok(accentAt(input.duration - HOLD + FRAME), `${format} lede: the accent word is not yet red ${HOLD} s before the cut`);
  }
});

// ---- ruling 3: timeline (and the list's opening) ----

const OPENS = Object.freeze([['16:9', 'year'], ['9:16', 'year'], ['16:9', 'next']]);
const partsOf = (texts, id) => texts.filter(({ n }) => new RegExp(`^${id}\\.(when|what|item)\\d+$`).test(n.id));

for (const format of Object.keys(FILMS)) {
  test(`ruling 3: ${format} year: the title is the hero, every date and event at most a third of it`, () => {
    const input = inputOf(format, shotOf(format, 'year'));
    const texts = textsAt(input, input.duration);
    const title = texts.find(({ n }) => n.id === 'year.title');
    const parts = partsOf(texts, 'year');
    assert.ok(title && parts.length === 8, 'a title, four dates and four events');
    const big = parts.filter(({ n }) => 3 * n.props.font.size > title.n.props.font.size + EPS).map(({ n }) => `${n.id} ${n.props.font.size}`);
    assert.deepEqual(big, [], `title ${title.n.props.font.size}`);
  });
}

const LEGIBLE = 1.25; // of the look's secondary floor: the events a quarter over it (round 2 set them at 48, on the floor)

test('ruling 3: 16:9 year: the events are legible at phone size (a quarter over the secondary floor) and fill the frame', () => {
  const input = inputOf('16:9', shotOf('16:9', 'year'));
  const texts = textsAt(input, input.duration);
  const least = Math.min(...partsOf(texts, 'year').map(({ n }) => n.props.font.size));
  assert.ok(least >= LEGIBLE * look().secondary.min * input.unit, `the smallest event text is ${least}`);
  const { extent, band } = bandsOf(input, '16:9', texts);
  assert.ok(extent <= MAX_EMPTY && band <= MAX_BAND, `extent ${(100 * extent).toFixed(0)}% empty, a band of ${(100 * band).toFixed(0)}%`);
});

for (const [format, id] of OPENS) {
  test(`ruling 3: ${format} ${id} opens composed: every event or item set on frame 0, the spoken one lit, none blank band`, () => {
    const shot = shotOf(format, id);
    const input = inputOf(format, shot);
    const n = (shot.events ?? shot.items).length;
    const zero = partsOf(textsAt(input, 0), id);
    assert.equal(zero.length, id === 'year' ? 2 * n : n, 'every part on the first frame');
    assert.ok(zero.every(({ a }) => a > 1 - EPS), 'opaque');
    const { ink, ink2 } = look().palette;
    const fillOf = ({ n: node }) => (node.words?.[0]?.fill ?? node.props.fill);
    // the list's preview track (shared with cosmos, frozen) lights its first item over the emphasize move from frame 0
    const lit = partsOf(textsAt(input, look().moves.emphasize.dur + FRAME), id);
    const first = lit.filter(({ n: node }) => /(when|what|item)0$/.test(node.id));
    assert.ok(first.every((p) => fillOf(p) === ink), 'the first lit');
    assert.ok(lit.filter((p) => !first.includes(p)).every((p) => fillOf(p) === ink2), 'the rest set in ink2');
    const { band } = bandsOf(input, format, textsAt(input, 0));
    assert.ok(band <= 0.4, `an empty band of ${(100 * band).toFixed(0)}% on the first frame`);
  });
}

// ---- ruling 4: the map ----

const ROUTE_CLEAR = 24; // units: a route keeps this far off every other city's pin and name

function reachEnd() {
  const input = inputOf('16:9', shotOf('16:9', 'reach'));
  return { input, parts: drawn(sampleGraph(input.nodes, input.duration)).filter(({ a }) => a > EPS) };
}

test('ruling 4: 16:9 reach: no route runs over another city\'s pin or name', () => {
  const { input, parts } = reachEnd();
  const shot = shotOf('16:9', 'reach');
  const near = ROUTE_CLEAR * input.unit;
  const grow = ([x, y, w, h]) => [x - near, y - near, w + 2 * near, h + 2 * near];
  const inside = ([px, py], [x, y, w, h]) => px > x && px < x + w && py > y && py < y + h;
  const hits = [];
  shot.routes.forEach((r, j) => {
    const line = parts.find(({ n }) => n.id === `reach.route${j}.line`);
    assert.ok(line, `route ${j} drawn`);
    const pts = pathPoints(line.n.props.d).map(([x, y]) => [x + line.dx, y + line.dy]);
    shot.places.forEach((p, i) => {
      if (p.name === r.from || p.name === r.to) return;
      const name = parts.find(({ n }) => n.id === `reach.place${i}.text`);
      const pin = parts.find(({ n }) => n.id === `reach.place${i}.pin`);
      const boxes = [name && boxOf(name), pin && pinBox(pin)].filter(Boolean).map(grow);
      if (pts.some((q) => boxes.some((b) => inside(q, b)))) hits.push(`${r.from}-${r.to} over ${p.name}`);
    });
  });
  assert.deepEqual(hits, []);
});

test('ruling 4: 16:9 reach: only the origin city takes the accent, the destinations are ink', () => {
  const { parts } = reachEnd();
  const shot = shotOf('16:9', 'reach');
  const { accent, ink } = look().palette;
  const origins = new Set(shot.routes.map((r) => r.from));
  const fills = shot.places.map((p, i) => [p.name, parts.find(({ n }) => n.id === `reach.place${i}.pin`)?.n.props.fill]);
  assert.deepEqual(fills, shot.places.map((p) => [p.name, origins.has(p.name) ? accent : ink]));
  const red = parts.filter(({ n }) => n.props?.fill === accent || n.props?.stroke === accent || (n.words ?? []).some((w) => w?.fill === accent))
    .map(({ n }) => n.id).filter((id) => !/slug|kicker/.test(id));
  assert.deepEqual(red, [`reach.place${shot.places.findIndex((p) => origins.has(p.name))}.pin`], 'nothing else in the accent');
});

// ---- ruling 6: compare ----

const SIDE_BEARING = 8; // units: two texts on one margin may differ by this much (their faces' side bearings)

for (const format of Object.keys(FILMS)) {
  test(`ruling 6: ${format} gap: the values are the hero and fill the frame, the lower third included`, () => {
    const input = inputOf(format, shotOf(format, 'gap'));
    const texts = textsAt(input, input.duration).filter(({ n }) => n.id.startsWith('gap.') && !/kicker/.test(n.id));
    const values = texts.filter(({ n }) => /\.value$/.test(n.id));
    assert.equal(values.length, 2, 'two values');
    const largest = Math.max(...texts.map(({ n }) => n.props.font.size));
    assert.ok(values.every(({ n }) => n.props.font.size === largest), 'the values are the largest text');
    const { extent, band } = bandsOf(input, format, texts);
    assert.ok(extent <= MAX_EMPTY && band <= MAX_BAND, `extent ${(100 * extent).toFixed(0)}% empty, a band of ${(100 * band).toFixed(0)}%`);
  });

  test(`ruling 6: ${format} gap: the copy starts on the film's left margin (the chart's claim)`, () => {
    const input = inputOf(format, shotOf(format, 'gap'));
    const lefts = textsAt(input, input.duration).filter(({ n }) => /^gap\.left\./.test(n.id)).map((p) => boxOf(p)[0]);
    const chart = inputOf(format, shotOf(format, 'growth'));
    const claim = boxOf(textsAt(chart, chart.duration).find(({ n }) => n.id === 'growth.title'))[0];
    // within a side bearing: a kind may set a text by its ink (the chart's claim sits a few units left of the margin)
    assert.ok(lefts.length > 0 && lefts.every((x) => Math.abs(x - claim) < SIDE_BEARING * input.unit), `the left column at ${lefts.map(Math.round)}, the claim at ${Math.round(claim)}`);
  });
}

// ---- ruling 5: charts ----

for (const format of Object.keys(FILMS)) {
  test(`ruling 5: ${format} growth: the "0" tick and the first value label sit on different rows (never "0 6")`, () => {
    const input = inputOf(format, shotOf(format, 'growth'));
    const texts = textsAt(input, input.duration);
    const zero = texts.find(({ n }) => /\.tick\.\d+$/.test(n.id) && n.props.layout.lines[0]?.words[0]?.text === '0');
    const first = texts.find(({ n }) => n.id === 'growth.point.0');
    assert.ok(zero && first, 'a 0 tick and a first value label');
    const [, zy] = boxOf(zero), [fx, fy, , fh] = boxOf(first);
    const em = first.n.props.font.size;
    assert.ok(fy + fh + 0.25 * em <= zy, `first label foot ${Math.round(fy + fh)} and the 0's top ${Math.round(zy)} closer than a quarter em`);
    // and on whatever row it lifts into, at least an em clear of every tick label (a full em up set it beside "100")
    const beside = texts.filter(({ n }) => /\.tick\.\d+$/.test(n.id)).filter((t) => {
      const [tx, ty, tw, th] = boxOf(t);
      return ty < fy + fh && fy < ty + th && fx - (tx + tw) < em;
    });
    assert.deepEqual(beside.map(({ n }) => n.id), [], 'a tick label beside the first value');
  });

  test(`ruling 5: ${format} growth: the claimed point (Q4, the last) takes the accent, its label and its dot; no other`, () => {
    const input = inputOf(format, shotOf(format, 'growth'));
    const { accent } = look().palette;
    const parts = drawn(sampleGraph(input.nodes, input.duration)).filter(({ a }) => a > EPS);
    const red = parts.filter(({ n }) => n.props?.fill === accent || n.props?.stroke === accent || (n.words ?? []).some((w) => w?.fill === accent)).map(({ n }) => n.id).sort();
    assert.deepEqual(red, ['growth.point.3', 'growth.point.3.dot']);
  });

  test(`ruling 5: ${format} regions: no bar is ever drawn in ink: each grows in its final colour`, () => {
    const input = inputOf(format, shotOf(format, 'regions'));
    const { ink } = look().palette;
    const black = new Set();
    for (let t = 0; t <= input.duration; t += 3 * FRAME) {
      drawn(sampleGraph(input.nodes, t)).filter(({ n, a }) => a > EPS && /^regions\.mark\.\d+$/.test(n.id) && (n.scaleX ?? n.scaleY ?? 1) > EPS && n.props.fill === ink)
        .forEach(({ n }) => black.add(n.id));
    }
    assert.deepEqual([...black], [], 'a bar drawn in ink');
  });
}

// (cosmos left this list in the looks phase: it has its own feed data, with `lit`, ledger's switch, set deliberately)
test('ruling 1: the feed changes leave desk and pop feed data untouched', () => {
  for (const name of ['desk', 'pop']) {
    const data = registries.looks.get(name).kinds?.feed ?? {};
    for (const key of ['titleSlug', 'indent', 'lit']) assert.equal(data[key], undefined, `${name} feed ${key}`);
  }
});
