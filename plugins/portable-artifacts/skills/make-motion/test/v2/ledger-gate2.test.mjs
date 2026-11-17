// The `ledger` gate, revision round 1 (gate-ledger-1.md; the controller's rulings, binding). Each test pins one ruling
// on the gate films as the Node build expands them (the tests' stand-in measure and word times):
//   1. no hand-drawn device: compare as hairline columns with no card and no scribbled vs, no minus-like bullet, the
//      emphasis on the larger value; a region mark is ruled (no curve); feed messages as ruled rows, the title over the
//      body, no orphan word;
//   2. map: routes in the accent or ink, each from one placed city to another, land that reads on paper;
//   4. openings: on a shot's first frame the claim, the frame furniture, the axes and the land are fully set, nothing
//      half-entered; a chart's values have landed at least a second before the shot ends.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registries } from '../../engine/registry.mjs';
import '../../engine/kinds/index.mjs';
import { sampleGraph } from '../../engine/graph/sample.mjs';
import { pathPoints } from '../../engine/devices/shared.mjs';
import { contrastRatio } from '../../../../shared/contrast.mjs';
import { barInput } from './helpers/bar.mjs';

const LOOK = 'ledger';
const FILMS = Object.freeze({ '16:9': 'gate-ledger.json', '9:16': 'gate-ledger-tall.json' });
const PREPARED = Object.freeze(['map', 'code']);
const SETTLED_BEFORE_END = 1; // s: a chart's values have landed this long before its shot ends (ruling 4)
const FRAME = 1 / 30;
const EPS = 1e-6;
const filmOf = (format) => JSON.parse(readFileSync(new URL(`../../references/examples/v2/${FILMS[format]}`, import.meta.url), 'utf8'));
const shotOf = (format, id) => filmOf(format).shots.find((s) => s.id === id);
const inputOf = (format, shot) => barInput(shot.show, shot, { look: LOOK, format, prepare: PREPARED.includes(shot.show) });
const look = () => registries.looks.get(LOOK);

// Every drawn node of a sampled graph with its effective opacity (its own times its groups').
function drawn(nodes, alpha = 1) {
  return nodes.flatMap((n) => {
    const a = alpha * (n.opacity ?? 1);
    const self = n.type === 'group' || n.type === 'field' ? [] : [{ n, a }];
    return [...self, ...drawn(n.children ?? [], a)];
  });
}
const wordAlphas = (n) => (n.words ?? []).map((w) => w?.opacity ?? 1);

// ---- ruling 4: openings ----

// the texts and parts that make the composed first frame: the claim or title, the tag and the mark, a chart's axes and
// category labels, the map's land
const SET_ON_OPEN = /^[^.]+\.(text|title|kicker)$|\.mark\.text$|\.slug\.(plate|rule)$|\.(tick|x|label)\.\d+$|\.land$/;

for (const format of Object.keys(FILMS)) {
  for (const shot of filmOf(format).shots) {
    test(`ruling 4: ${format} ${shot.id} (${shot.show}) opens composed: the claim and furniture set, nothing half-entered`, () => {
      const parts = drawn(sampleGraph(inputOf(format, shot).nodes, 0));
      const half = parts.filter(({ n, a }) => (a > EPS && a < 1 - EPS) || wordAlphas(n).some((w) => w > EPS && w < 1 - EPS));
      assert.deepEqual(half.map(({ n }) => n.id), [], 'half-entered on the first frame');
      const unset = parts.filter(({ n, a }) => SET_ON_OPEN.test(n.id) && (a < 1 - EPS || wordAlphas(n).some((w) => w < 1 - EPS)));
      assert.deepEqual(unset.map(({ n }) => n.id), [], 'not set on the first frame');
    });
  }
}

// What a chart part shows: its opacity, fill and draw, and each word's opacity and fill.
const stateOf = ({ n, a }) => JSON.stringify([a.toFixed(3), n.props?.fill, n.draw, n.reveal, n.scaleX, n.scaleY, (n.words ?? []).map((w) => [w?.opacity, w?.fill])]);

for (const format of Object.keys(FILMS)) {
  for (const shot of filmOf(format).shots.filter((s) => s.show === 'chart')) {
    test(`ruling 4: ${format} ${shot.id} chart values and colours have landed ${SETTLED_BEFORE_END} s before the cut`, () => {
      const input = inputOf(format, shot);
      const at = (t) => new Map(drawn(sampleGraph(input.nodes, t)).map((p) => [p.n.id, stateOf(p)]));
      const late = at(input.duration - SETTLED_BEFORE_END), end = at(input.duration);
      const moved = [...end].filter(([id, s]) => late.get(id) !== s).map(([id]) => id);
      assert.deepEqual(moved, [], `changed in the last ${SETTLED_BEFORE_END} s of a ${input.duration.toFixed(2)} s shot`);
    });
  }
}

// ---- ruling 2: the map ----

function reach() {
  const input = inputOf('16:9', shotOf('16:9', 'reach'));
  return { input, parts: drawn(sampleGraph(input.nodes, input.duration)) };
}

// A node's points in canvas space: its own, moved by its x and y and scaled by its groups (the map group's scale).
const ROUTE_LINE = /^reach\.route\d+(\.part\d+)?\.line$/;

test('ruling 2: every map route is drawn in the accent or the ink, never a second hue', () => {
  const { parts } = reach();
  const { accent, ink } = look().palette;
  const lines = parts.filter(({ n }) => /^reach\.route/.test(n.id) && n.props.stroke);
  assert.ok(lines.length > 0, 'routes drawn');
  assert.deepEqual(lines.filter(({ n }) => ![accent, ink].includes(n.props.stroke)).map(({ n }) => `${n.id} ${n.props.stroke}`), []);
});

test('ruling 2: every map route is one line that starts and ends on a placed city', () => {
  const { parts } = reach();
  const shot = shotOf('16:9', 'reach');
  const lines = parts.filter(({ n }) => ROUTE_LINE.test(n.id));
  assert.equal(lines.length, shot.routes.length, `one line per route, got ${lines.map(({ n }) => n.id).join(', ')}`);
  const pins = parts.filter(({ n }) => /^reach\.place\d+\.dot$|^reach\.place\d+\.pin$|^reach\.place\d+\.on\d*\.dot$/.test(n.id));
  const placeAt = parts.filter(({ n }) => /^reach\.place\d+\.text$/.test(n.id));
  assert.ok(placeAt.length === shot.places.length, 'every place labelled');
  // the route's ends are the places' points: compare with the label device's dot (ends on what it labels)
  const dots = parts.filter(({ n }) => /^reach\.place\d+\.(dot|leader\.dot)$/.test(n.id) || /^reach\.place\d+\..*dot$/.test(n.id))
    .map(({ n }) => { const p = pathPoints(n.props.d); return [p.reduce((s, q) => s + q[0], 0) / p.length + (n.x ?? 0), p.reduce((s, q) => s + q[1], 0) / p.length + (n.y ?? 0)]; });
  assert.ok(dots.length + pins.length >= shot.places.length, `a dot on every place, got ${dots.length}`);
  const near = ([x, y]) => dots.some(([px, py]) => Math.hypot(px - x, py - y) < 12);
  for (const { n } of lines) {
    const pts = pathPoints(n.props.d);
    assert.ok(near(pts[0]) && near(pts.at(-1)), `${n.id} runs from ${pts[0].map(Math.round)} to ${pts.at(-1).map(Math.round)}, not between two places`);
  }
});

test('ruling 2: the map land reads on paper and carries the labels and pins', () => {
  const { paper, ink, ink2, accent } = look().palette;
  const land = look().kinds.map.land;
  assert.ok(contrastRatio(land, paper) >= 1.5, `land on paper ${contrastRatio(land, paper).toFixed(2)}`);
  assert.ok(contrastRatio(ink2, land) >= 3, `ink2 leaders on land ${contrastRatio(ink2, land).toFixed(2)}`);
  assert.ok(contrastRatio(ink, land) >= 4.5, `ink on land ${contrastRatio(ink, land).toFixed(2)}`);
  assert.ok(contrastRatio(accent, land) >= 3, `accent pins on land ${contrastRatio(accent, land).toFixed(2)}`);
});

// ---- ruling 1: no hand-drawn device ----

const CURVE = /[CcQqSsTtAa]/;

for (const format of Object.keys(FILMS)) {
  test(`ruling 1: ${format} compare is two hairline columns: no card, no scribbled vs, every path straight`, () => {
    const shot = shotOf(format, 'gap');
    const parts = drawn(sampleGraph(inputOf(format, shot).nodes, inputOf(format, shot).duration));
    assert.deepEqual(parts.filter(({ n }) => /\.(paper|vs\.v|vs\.s|scrim)$/.test(n.id)).map(({ n }) => n.id), [], 'cards, scrims or a vs');
    const paths = parts.filter(({ n }) => n.type === 'path' && n.props.d && !/\.(slug|grid)/.test(n.id));
    assert.deepEqual(paths.filter(({ n }) => CURVE.test(n.props.d)).map(({ n }) => n.id), [], 'a curved (drawn) path');
    assert.ok(paths.some(({ n }) => /divider/.test(n.id)), 'a ruled divider between the columns');
  });

  test(`ruling 1: ${format} compare points carry no minus-like bullet, and the emphasis lands on the larger value`, () => {
    const shot = shotOf(format, 'gap');
    const input = inputOf(format, shot);
    const { accent } = look().palette;
    const texts = (t) => drawn(sampleGraph(input.nodes, t)).filter(({ n }) => n.type === 'text');
    const lines = texts(input.duration).flatMap(({ n }) => n.props.layout.lines.map((l) => l.words.map((w) => w.text).join(' ')));
    assert.deepEqual(lines.filter((l) => /^[–—\-−]/.test(l)), [], 'a line opening on a dash');
    // North (182) is the larger side: its texts take the accent; West's never do
    const red = (side) => [0, input.duration / 2, input.duration].some((t) => texts(t).some(({ n }) => n.id.startsWith(`gap.${side}.`)
      && (n.props.fill === accent || (n.words ?? []).some((w) => w?.fill === accent))));
    assert.ok(red('left'), 'the larger value (North, 182) holds the accent');
    assert.ok(!red('right'), 'the smaller value (West, 59) never takes the accent');
    // and nothing is dimmed to a ghost: every text stays opaque in ink or the accent
    const end = texts(input.duration).filter(({ n }) => n.id.startsWith('gap.'));
    assert.ok(end.every(({ a }) => a > 1 - EPS), 'every compare text opaque at the end');
  });
}

test('ruling 1: a region mark in ledger is ruled: the circle device draws a rectangle, no curve', () => {
  const built = registries.devices.get('circle').build({ id: 'r', box: [100, 100, 400, 200], at: 1, look: look(), unit: 1, seed: 1 });
  const paths = drawn(built.nodes).filter(({ n }) => n.type === 'path');
  assert.ok(paths.length > 0, 'drawn');
  assert.deepEqual(paths.filter(({ n }) => CURVE.test(n.props.d)).map(({ n }) => n.id), []);
});

test('ruling 1: 9:16 feed draws ruled rows: no bubble card, the title over the body and larger, no orphan word', () => {
  const shot = shotOf('9:16', 'chat');
  const input = inputOf('9:16', shot);
  const parts = drawn(sampleGraph(input.nodes, input.duration));
  const fills = parts.filter(({ n }) => n.type === 'path' && n.props.fill && n.props.fill !== look().palette.paper && !/\.(slug|grid)/.test(n.id));
  assert.deepEqual(fills.map(({ n }) => `${n.id} ${n.props.fill}`), [], 'a filled card behind a message');
  assert.ok(parts.some(({ n }) => n.type === 'path' && /rule/.test(n.id)), 'a hairline rule between rows');
  const texts = parts.filter(({ n }) => n.type === 'text');
  const title = texts.find(({ n }) => n.id === 'chat.title').n;
  const body = texts.filter(({ n }) => n.id !== 'chat.title' && n.props.layout.lines.length > 0);
  assert.ok(body.length >= shot.items.length, 'every message drawn');
  assert.ok(body.every(({ n }) => title.props.font.size > n.props.font.size), 'the title is larger than every message');
  assert.ok(body.every(({ n }) => title.y < n.y), 'the title sits above the body');
  const orphans = body.flatMap(({ n }) => n.props.layout.lines.filter((l, i, all) => all.length > 1 && l.words.length < 2).map(() => n.id));
  assert.deepEqual(orphans, [], 'a line of one word');
});

test('ruling 1: the route colour, compare and feed changes leave desk, pop and cosmos data untouched', () => {
  for (const name of ['desk', 'pop', 'cosmos']) {
    const other = registries.looks.get(name);
    assert.equal(other.kinds?.compare?.columns, undefined, `${name} compare`);
    assert.equal(other.kinds?.feed?.rows, undefined, `${name} feed`);
    assert.equal(other.opens, undefined, `${name} opens`);
  }
});

// ---- ruling 3: line and area charts ----

const SERIES = Object.freeze([['16:9', 'growth'], ['9:16', 'growth']]);
// a text node's box from its layout: [x, top, w, h] (y is the layout's top)
const textBox = (n) => [n.x, n.y, n.props.layout.width, n.props.layout.height];
const apart = ([ax, ay, aw, ah], [bx, by, bw, bh], gap) => ax + aw + gap <= bx || bx + bw + gap <= ax || ay + ah + gap <= by || by + bh + gap <= ay;

for (const [format, id] of SERIES) {
  test(`ruling 3: ${format} ${id} labels every point's value directly, landed with the line`, () => {
    const shot = shotOf(format, id);
    const input = inputOf(format, shot);
    const end = drawn(sampleGraph(input.nodes, input.duration)).filter(({ n }) => n.type === 'text');
    const values = end.filter(({ n }) => /\.point\.\d+$/.test(n.id));
    // a numeral is laid out a digit a cell (numeralLayout): its words join without spaces
    const said = values.map(({ n }) => n.props.layout.lines.map((l) => l.words.map((w) => w.text).join('')).join('')).sort();
    assert.deepEqual(said, shot.data.map((p) => String(p.y)).sort(), 'one value label per point');
    assert.ok(values.every(({ a }) => a > 1 - EPS), 'every value label on at the end');
  });

  test(`ruling 3: ${format} ${id} the "0" tick and the first category label never touch`, () => {
    const shot = shotOf(format, id);
    const input = inputOf(format, shot);
    const texts = drawn(sampleGraph(input.nodes, input.duration)).filter(({ n }) => n.type === 'text').map(({ n }) => n);
    const zero = texts.find((n) => /\.tick\.\d+$/.test(n.id) && n.props.layout.lines[0]?.words[0]?.text === '0');
    const first = texts.find((n) => n.id === `${id}.x.0`);
    assert.ok(zero && first, 'a 0 tick and a first category label');
    // the label row sits under the tick column: the first category label's top a quarter em under the 0's foot, so the
    // two never read as one string ("0Q1", gate-ledger-1)
    const gap = 0.25 * first.props.font.size;
    const [, zy, , zh] = textBox(zero), [, fy] = textBox(first);
    assert.ok(zy + zh + gap <= fy, `0 at ${textBox(zero).map(Math.round)} and ${first.id} at ${textBox(first).map(Math.round)} are closer than ${gap}`);
  });
}

test('ruling 3: 9:16 growth area fill reaches the line tip on every frame', () => {
  const shot = shotOf('9:16', 'growth');
  const input = inputOf('9:16', shot);
  const at = (t) => new Map(drawn(sampleGraph(input.nodes, t)).map(({ n }) => [n.id, n]));
  const line = at(0).get('growth.mark.0');
  const pts = pathPoints(line.props.d);
  const segs = pts.slice(1).map((q, k) => Math.hypot(q[0] - pts[k][0], q[1] - pts[k][1]));
  const total = segs.reduce((a, b) => a + b, 0);
  const tipX = (s) => {
    let left = s * total;
    for (let k = 0; k < segs.length; k++) {
      if (left <= segs[k]) return pts[k][0] + (pts[k + 1][0] - pts[k][0]) * (left / segs[k]);
      left -= segs[k];
    }
    return pts.at(-1)[0];
  };
  const x0 = pts[0][0], span = pts.at(-1)[0] - x0;
  const behind = [];
  for (let t = 0; t <= input.duration; t += FRAME) {
    const nodes = at(t);
    const draw = Math.min(1, Math.max(0, nodes.get('growth.mark.0').draw ?? 1));
    const reveal = Math.min(1, Math.max(0, nodes.get('growth.mark.0.fill').reveal ?? 1));
    const edge = x0 + reveal * span;
    if (Math.abs(edge - tipX(draw)) > 2) behind.push(`${t.toFixed(2)}s: fill ${edge.toFixed(0)}, tip ${tipX(draw).toFixed(0)}`);
  }
  assert.deepEqual(behind.slice(0, 5), [], 'the fill edge and the line tip part');
});

// ---- rulings 5 and 6: compositions fill the frame; the lede is set like every other claim ----

const FILL_WIDE = 0.7; // of the width between the margins
const FILL_TALL = 0.65;
const union = (boxes) => {
  const x0 = Math.min(...boxes.map((b) => b[0])), y0 = Math.min(...boxes.map((b) => b[1]));
  return [x0, y0, Math.max(...boxes.map((b) => b[0] + b[2])) - x0, Math.max(...boxes.map((b) => b[1] + b[3])) - y0];
};
const between = (input, format) => input.canvas.w - 2 * (format === '9:16' ? look().gridTall : look().grid).margin * input.unit;

function filled(format, id, pick) {
  const shot = shotOf(format, id);
  const input = inputOf(format, shot);
  const parts = drawn(sampleGraph(input.nodes, input.duration)).filter(({ n, a }) => a > EPS && pick(n));
  const boxes = parts.filter(({ n }) => n.type === 'text').map(({ n }) => textBox(n));
  return { input, box: union(boxes) };
}

test('ruling 5: the 16:9 statement fills the frame: its claim across most of the width and much of the height', () => {
  const { input, box } = filled('16:9', 'lede', (n) => n.id === 'lede.text');
  assert.ok(box[2] >= FILL_WIDE * between(input, '16:9'), `the claim is ${Math.round(box[2])} wide of ${Math.round(between(input, '16:9'))}`);
  assert.ok(box[3] >= 0.45 * input.canvas.h, `the claim is ${Math.round(box[3])} tall of ${input.canvas.h}`);
});

test('ruling 5: the 16:9 list fills the frame: its items across most of the width and the height', () => {
  const { input, box } = filled('16:9', 'next', (n) => /^next\.item\d+$/.test(n.id));
  assert.ok(box[2] >= FILL_WIDE * between(input, '16:9'), `the items are ${Math.round(box[2])} wide of ${Math.round(between(input, '16:9'))}`);
  assert.ok(box[3] >= 0.55 * input.canvas.h, `the items are ${Math.round(box[3])} tall of ${input.canvas.h}`);
});

test('ruling 5: the 9:16 diagram fills the frame across, not a centre column', () => {
  const shot = shotOf('9:16', 'flow');
  const input = inputOf('9:16', shot);
  // each node's box (its card's paper, in the card's own space: a width does not move with the group)
  const papers = drawn(sampleGraph(input.nodes, input.duration)).filter(({ n }) => /^flow\.node\d+\.card\.paper$/.test(n.id));
  assert.equal(papers.length, shot.nodes.length, 'a box per node');
  const widths = papers.map(({ n }) => { const xs = pathPoints(n.props.d).map(([x]) => x); return Math.max(...xs) - Math.min(...xs); });
  const least = Math.min(...widths);
  assert.ok(least >= FILL_TALL * between(input, '9:16'), `the narrowest box is ${Math.round(least)} wide of ${Math.round(between(input, '9:16'))}`);
});

test('ruling 6: the lede is set in the display face, weight and width of the other claims, from the same column', () => {
  const at = (id, node) => {
    const shot = shotOf('16:9', id);
    const input = inputOf('16:9', shot);
    return drawn(sampleGraph(input.nodes, input.duration)).find(({ n }) => n.id === node).n;
  };
  const lede = at('lede', 'lede.text'), claim = at('growth', 'growth.title');
  for (const key of ['family', 'weight', 'width']) assert.equal(lede.props.font[key], claim.props.font[key], key);
  assert.ok(Math.abs(lede.x - claim.x) < 1, `the lede starts at ${lede.x.toFixed(0)}, the chart's claim at ${claim.x.toFixed(0)}`);
});

export { FRAME };
