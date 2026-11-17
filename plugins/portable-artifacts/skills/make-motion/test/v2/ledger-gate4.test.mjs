// The `ledger` gate, the fix items of review 3 (gate-ledger-3.md, ship after fixes) that are not the chart ticks
// (those are in ledger-kinds.test.mjs). Each test pins one item on the gate films as the Node build expands them:
//   F2: the Denver to Kyoto route runs the short way, west over the Pacific: the world is recentred on the route set
//       (look data map.recentre), so every route is one line between its cities and none crosses the map's edge;
//   F3: the map's source line is set like every other source: the serif, "Source: " first, on the title's left edge;
//   F4: the 16:9 lede fills the frame's height (ban 2), not only its top half.
// desk, pop and cosmos keep the unturned map: their prepared data is what it was (kinds-frozen pins their frames).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registries } from '../../engine/registry.mjs';
import '../../engine/kinds/index.mjs';
import { sampleGraph } from '../../engine/graph/sample.mjs';
import { pathPoints } from '../../engine/devices/shared.mjs';
import { prepareFilm } from '../../scripts/v2/prepare/index.mjs';
import { prepareMap } from '../../scripts/v2/prepare/map.mjs';
import { lookForFormat } from '../../engine/looks/index.mjs';
import { barInput } from './helpers/bar.mjs';
import { measure, filmOf as oneShotFilm, canvasOf, viralOf, IMAGES, FPS } from './helpers/kinds.mjs';
import { shotContext } from '../../engine/graph/film.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';

const LOOK = 'ledger';
const FILMS = Object.freeze({ '16:9': 'gate-ledger.json', '9:16': 'gate-ledger-tall.json' });
const EPS = 1e-6;
const MAX_EMPTY = 0.35; // ban 2: of the composition height outside the first text's top to the last's foot
// the tallest empty band under the lede: a fifth of the height. The reviewed frame left 26 percent under the claim (at
// the browser's advance, below), just over ledger-gate3's 25 percent rule for other compositions, and the reviewer read
// it as the lower 40 percent empty; the claim must reach well into the lower part
const LEDE_BAND = 0.2;
const filmOf = (format) => JSON.parse(readFileSync(new URL(`../../references/examples/v2/${FILMS[format]}`, import.meta.url), 'utf8'));
const shotOf = (format, id) => filmOf(format).shots.find((s) => s.id === id);
const inputOf = (format, shot, look = LOOK) => barInput(shot.show, shot, { look, format, prepare: shot.show === 'map' });
const look = () => registries.looks.get(LOOK);

// every drawn node of a sampled graph with its effective opacity and its groups' offset
function drawn(nodes, alpha = 1, dx = 0, dy = 0) {
  return nodes.flatMap((n) => {
    const a = alpha * (n.opacity ?? 1);
    const ox = dx + (n.type === 'group' ? n.x ?? 0 : 0), oy = dy + (n.type === 'group' ? n.y ?? 0 : 0);
    const self = n.type === 'group' || n.type === 'field' ? [] : [{ n, a, dx, dy }];
    return [...self, ...drawn(n.children ?? [], a, ox, oy)];
  });
}
const wordsOf = (n) => n.props.layout.lines.flatMap((l) => l.words.map((w) => w.text)).join(' ');
const pointsOf = ({ n, dx, dy }) => pathPoints(n.props.d).map(([x, y]) => [x + dx + (n.x ?? 0), y + dy + (n.y ?? 0)]);
const centreOf = (part) => {
  const pts = pointsOf(part);
  return [(Math.min(...pts.map((p) => p[0])) + Math.max(...pts.map((p) => p[0]))) / 2, (Math.min(...pts.map((p) => p[1])) + Math.max(...pts.map((p) => p[1]))) / 2];
};

// ---- F2: the routes the short way ----

const REACH = () => shotOf('16:9', 'reach');
const placeIndex = (name) => REACH().places.findIndex((p) => p.name === name);

test('F2: 16:9 reach: Denver to Kyoto runs west over the Pacific, one line from city to city', () => {
  const input = inputOf('16:9', REACH());
  const parts = drawn(sampleGraph(input.nodes, input.duration));
  const pin = (name) => centreOf(parts.find(({ n }) => n.id === `reach.place${placeIndex(name)}.pin`));
  const [denver, kyoto, oslo, lima] = ['Denver', 'Kyoto', 'Oslo', 'Lima'].map(pin);
  assert.ok(kyoto[0] < denver[0], `Kyoto (x ${kyoto[0].toFixed(0)}) lies west of Denver (x ${denver[0].toFixed(0)}): the Pacific between them`);
  assert.ok(oslo[0] > denver[0] && Math.abs(lima[0] - denver[0]) < Math.abs(oslo[0] - denver[0]), 'Oslo east over the Atlantic, Lima south');
  const j = REACH().routes.findIndex((r) => r.to === 'Kyoto');
  assert.deepEqual(parts.filter(({ n }) => n.id.startsWith(`reach.route${j}.part`)).map(({ n }) => n.id), [], 'not in parts clipped at the map\'s edges');
  const line = pointsOf(parts.find(({ n }) => n.id === `reach.route${j}.line`));
  assert.ok(line.every(([x]) => x >= kyoto[0] - 1 && x <= denver[0] + 1), `the route stays between Kyoto and Denver: x from ${Math.min(...line.map((p) => p[0])).toFixed(0)} to ${Math.max(...line.map((p) => p[0])).toFixed(0)}`);
});

test('F2: in ledger the world turns only to keep routes whole: no route crosses the map\'s edge, every place still drawn', () => {
  const { prepared } = prepareFilm({ version: 2, mode: 'pro', look: LOOK, format: '16:9', shots: [REACH()] }, { filmDir: '.' });
  const data = prepared.reach;
  assert.deepEqual(data.routes.filter((r) => r.parts !== undefined).map((r) => `${r.from}-${r.to}`), [], 'every route one run of points');
  assert.equal(data.places.length, REACH().places.length);
  // a route set that crosses no edge leaves the map as it is
  const atlantic = { ...REACH(), routes: REACH().routes.filter((r) => r.to !== 'Kyoto') };
  const kept = prepareFilm({ version: 2, mode: 'pro', look: LOOK, format: '16:9', shots: [atlantic] }, { filmDir: '.' }).prepared.reach;
  assert.deepEqual(kept, prepareMap(atlantic).data, 'no route across the edge: the unturned map');
});

test('F2: desk, pop and cosmos keep the unturned map: their prepared reach is the look-free one, Kyoto east of Denver', () => {
  const plain = prepareMap(REACH()).data;
  for (const name of ['desk', 'pop', 'cosmos']) {
    const mode = registries.looks.get(name).modes[0];
    const { prepared } = prepareFilm({ version: 2, mode, look: name, format: '16:9', shots: [REACH()] }, { filmDir: '.' });
    assert.deepEqual(prepared.reach, plain, name);
  }
  const at = new Map(plain.places.map((p) => [p.name, p.x]));
  assert.ok(at.get('Kyoto') > at.get('Denver'), 'the unturned map: Kyoto east of Denver');
});

// ---- F3: the map's source line ----

for (const format of ['16:9', '9:16']) {
  test(`F3: ${format} reach: the source line is set like every other source: the serif, "Source: " first, on the title's left edge`, () => {
    const input = inputOf(format, REACH());
    const parts = drawn(sampleGraph(input.nodes, input.duration)).filter(({ a }) => a > EPS);
    const source = parts.find(({ n }) => n.id === 'reach.source'), title = parts.find(({ n }) => n.id === 'reach.title');
    assert.ok(source && title, 'a title and a source line');
    assert.equal(source.n.props.font.family, look().fonts.text.family, 'the serif');
    assert.equal(wordsOf(source.n), `Source: ${REACH().source}`);
    assert.ok(Math.abs(source.n.x + source.dx - (title.n.x + title.dx)) < 1, `source at x ${(source.n.x + source.dx).toFixed(0)}, title at ${(title.n.x + title.dx).toFixed(0)}`);
    assert.ok(source.n.props.font.size >= look().secondary.min * input.unit - EPS, 'at or over the secondary floor');
    // the longer line ("Source: " first) wraps inside the margins rather than running off a tall frame
    const margin = lookForFormat(look(), format).grid.margin * input.unit;
    const [x, y, w, h] = [source.n.x + source.dx, source.n.y + source.dy, source.n.props.layout.width, source.n.props.layout.height];
    assert.ok(x + w <= input.canvas.w - margin + EPS, `its right end at ${(x + w).toFixed(0)}, the margin at ${input.canvas.w - margin}`);
    assert.ok(y + h <= input.canvas.h - margin + EPS, `its foot at ${(y + h).toFixed(0)}, the margin at ${input.canvas.h - margin}`);
    const map = parts.find(({ n }) => n.id === 'reach.land');
    assert.ok(map, 'the map drawn');
  });
}

test('F3: the chart\'s source line is the measure the map is held to (same face, prefix and size)', () => {
  const chart = inputOf('16:9', shotOf('16:9', 'regions'));
  const map = inputOf('16:9', REACH());
  const at = (input, id) => drawn(sampleGraph(input.nodes, input.duration)).find(({ n }) => n.id === id).n;
  const [c, m] = [at(chart, 'regions.source'), at(map, 'reach.source')];
  for (const key of ['family', 'weight', 'size']) assert.equal(m.props.font[key], c.props.font[key], key);
  assert.equal(m.props.fill, c.props.fill, 'the same ink');
});

// ---- F4: the 16:9 lede fills the frame ----

// Ban 2 as ledger-gate3.test.mjs bandsOf measures it (importing that file would run its tests here too): `extent`, the
// share of the composition height outside the first text's top to the last's foot; `band`, the tallest empty band
// between texts or under the last.
function bandsOf(input, format, texts) {
  const margin = lookForFormat(input.look, format).grid.margin * input.unit;
  const top = margin, bottom = input.canvas.h - margin, h = bottom - top;
  const spans = texts.map(({ n, dx, dy }) => [n.y + dy, n.y + dy + n.props.layout.height]).map(([a, b]) => [Math.max(top, a), Math.min(bottom, b)])
    .filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]);
  let reach = spans[0][0], band = 0;
  for (const [a, b] of spans) {
    band = Math.max(band, a - reach);
    reach = Math.max(reach, b);
  }
  band = Math.max(band, bottom - reach);
  return { extent: 1 - (reach - spans[0][0]) / h, band: band / h };
}

// The tests' stand-in measure sets 0.55 em a letter, wider than Archivo semi-condensed bold, so the gate lede broke into
// four lines in Node and filled the frame there while the browser set three lines and left the lower third empty (the
// review's frame). NARROW is the browser's advance: the gate sheet's "Orders grew every" (17 letters) set at about
// 170 px spans about 1,325 px, 0.46 em a letter (estimated from the contact sheet, gate-ledger-4/gate-ledger.sheets/lede.png).
const NARROW_ADVANCE = 0.46;
const narrowMeasure = (text, font) => ({ ...measure(text, font), width: [...text].length * font.size * NARROW_ADVANCE, inkRight: [...text].length * font.size * NARROW_ADVANCE - 0.02 * font.size });
function ledeWith(measureFn) {
  const film = oneShotFilm([shotOf('16:9', 'lede')], LOOK, '16:9');
  const canvas = canvasOf('16:9');
  const ctx = shotContext({ film, index: 0, timeline: buildTimeline(film, { fps: FPS }), canvas, measure: measureFn, assets: IMAGES, viralInsets: viralOf(canvas), prepared: {} });
  const out = registries.kinds.get('statement').expand(film.shots[0], ctx);
  return { nodes: out.nodes, duration: ctx.timing.duration, look: look(), unit: 1, canvas };
}

for (const [name, measureFn] of [['the stand-in measure', measure], ['the browser\'s advance', narrowMeasure]]) {
  test(`F4: the 16:9 lede fills the frame's height (${name}): tag and claim leave at most 35 percent empty, no band over a fifth`, () => {
    const input = ledeWith(measureFn);
    const texts = drawn(sampleGraph(input.nodes, input.duration)).filter(({ n, a }) => n.type === 'text' && a > EPS && n.props.layout.lines.length > 0);
    assert.ok(texts.some(({ n }) => n.id === 'lede.text'), 'the claim');
    const { extent, band } = bandsOf(input, '16:9', texts);
    assert.ok(extent <= MAX_EMPTY, `${(100 * extent).toFixed(0)}% of the height outside the block (at most ${100 * MAX_EMPTY}%)`);
    assert.ok(band <= LEDE_BAND, `an empty band of ${(100 * band).toFixed(0)}% of the height (at most ${100 * LEDE_BAND}%)`);
  });
}
