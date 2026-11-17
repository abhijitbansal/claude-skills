// The `ledger` gate films' findings (looks-four plan, Task 5; the controller's renders of gate-ledger.json and
// gate-ledger-tall.json): each shot of both films builds with no finding from the frame review in the Node build (the
// tests' stand-in measure), and the four named defects stay fixed: a line chart's plot keeps room for its value axis
// (the tick labels never meet), a map's four-word title is three times its place names at 16:9, a twelve-word quote
// keeps its attribution at 16:9, and a tall chart's source line takes the plot's full width and wraps to two lines.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registries } from '../../engine/registry.mjs';
import '../../engine/kinds/index.mjs';
import { lookForFormat } from '../../engine/looks/index.mjs';
import { sampleGraph } from '../../engine/graph/sample.mjs';
import { auditFrame, MIN_HERO_RATIO } from '../../engine/review/frame.mjs';
import { regionMarkIds } from '../../engine/review/regions.mjs';
import { safeRectFor } from '../../scripts/v2/review.mjs';
import { pathPoints } from '../../engine/devices/shared.mjs';
import { barInput, snapshotOf } from './helpers/bar.mjs';

const LOOK = 'ledger';
const AUDIT_STEP = 0.1; // s between audited frames
const PREPARED = Object.freeze(['map', 'code']); // kinds whose shot needs the prepare step
const MAP_SHARE = 0.5; // of the frame's height: the least a 16:9 map under its title is drawn
const FILMS = Object.freeze({ '16:9': 'gate-ledger.json', '9:16': 'gate-ledger-tall.json' });
const filmOf = (format) => JSON.parse(readFileSync(new URL(`../../references/examples/v2/${FILMS[format]}`, import.meta.url), 'utf8'));
const shotOf = (format, id) => filmOf(format).shots.find((s) => s.id === id);
const flat = (nodes) => nodes.flatMap((n) => [n, ...flat(n.children ?? [])]);
const timesOf = (duration) => [...Array.from({ length: Math.floor(duration / AUDIT_STEP) + 1 }, (_, i) => i * AUDIT_STEP), duration];
// the stand-in screenshot for a picture shot (the Node build has no PNG sizes but the helper's)
const forNode = (shot) => (shot.src === undefined ? shot : { ...shot, src: 'shot.png' });

function build(format, id) {
  const shot = forNode(shotOf(format, id));
  return { shot, input: barInput(shot.show, shot, { look: LOOK, format, prepare: PREPARED.includes(shot.show) }) };
}

function findingsOf(format, id) {
  const { shot, input } = build(format, id);
  const resolved = lookForFormat(input.look, format);
  const ctx = { look: resolved, canvas: input.canvas, mode: registries.modes.get('pro'), shotId: shot.id, shotIndex: 0, safe: safeRectFor(input.canvas, resolved), regionMarks: regionMarkIds(shot) };
  const found = timesOf(input.duration).flatMap((t) => auditFrame(snapshotOf(sampleGraph(input.nodes, t)), { ...ctx, t })
    .map((f) => `${f.kind} ${f.rule} ${f.node}: ${f.message}`));
  return [...new Set(found)];
}

for (const format of Object.keys(FILMS)) {
  for (const shot of filmOf(format).shots) {
    test(`gate ledger ${format} shot ${shot.id} (${shot.show}): no finding from the frame review`, () => {
      assert.deepEqual(findingsOf(format, shot.id), []);
    });
  }
}

const textAt = (nodes, id) => flat(nodes).find((n) => n.type === 'text' && n.id === id);
const lineHeightOf = (n) => n.props.font.size;

test('finding 1: the 16:9 line chart keeps room for its value axis: tick labels a full label height apart', () => {
  const { input } = build('16:9', 'growth');
  const nodes = sampleGraph(input.nodes, input.duration);
  const ticks = flat(nodes).filter((n) => n.type === 'text' && /\.tick\.\d+$/.test(n.id)).map((n) => ({ y: n.y, size: lineHeightOf(n) }));
  assert.ok(ticks.length >= 2, `ticks: ${ticks.length}`);
  const ys = ticks.map((t) => t.y).sort((a, b) => a - b);
  const pitch = Math.min(...ys.slice(1).map((y, i) => y - ys[i]));
  assert.ok(pitch >= ticks[0].size, `the closest ticks are ${pitch.toFixed(1)} units apart, under a label's ${ticks[0].size} units`);
});

// The title's size in a 16:9 build of the growth chart with `title` instead.
function titleSizeOf(title) {
  const shot = { ...shotOf('16:9', 'growth'), title };
  const input = barInput('chart', shot, { look: LOOK, format: '16:9' });
  return textAt(sampleGraph(input.nodes, input.duration), 'growth.title').props.font.size;
}

test('finding 1: a 16:9 claim too long to leave the plot its share is set at three times the labels, not larger', () => {
  const data = registries.looks.get(LOOK).kinds.chart;
  assert.ok(data.plotHeight > 0, 'ledger keeps a share of the height for the plot');
  assert.equal(titleSizeOf('Orders at least doubled every quarter'), MIN_HERO_RATIO * registries.looks.get(LOOK).scale[1]);
});

test('finding 1: a short 16:9 claim that leaves the plot its share keeps the largest size', () => {
  assert.equal(titleSizeOf('Orders grew'), registries.looks.get(LOOK).kinds.chart.titleMax);
});

test('finding 2: the 16:9 map title is at least three times its place names', () => {
  const { input } = build('16:9', 'reach');
  const texts = flat(sampleGraph(input.nodes, input.duration)).filter((n) => n.type === 'text');
  const hero = texts.find((n) => n.props.role === 'hero') ?? texts.find((n) => n.id.endsWith('.title'));
  const smallest = Math.min(...texts.map((n) => n.props.font.size));
  assert.ok(hero.props.font.size >= MIN_HERO_RATIO * smallest - 1e-6, `title ${hero.props.font.size} against ${smallest}`);
});

test('finding 2: the 16:9 map under its title is drawn at least half the frame tall (the lower half is not left empty)', () => {
  const { input } = build('16:9', 'reach');
  const nodes = flat(sampleGraph(input.nodes, input.duration));
  const group = nodes.find((n) => n.id === 'reach.map');
  const land = nodes.find((n) => n.id === 'reach.land');
  const ys = pathPoints(land.props.d).map(([, y]) => y);
  const height = (Math.max(...ys) - Math.min(...ys)) * group.scale;
  assert.ok(height >= MAP_SHARE * input.canvas.h, `the map is ${height.toFixed(0)} units tall of ${input.canvas.h}`);
});

test('finding 3: the 16:9 twelve-word quote keeps its attribution at the secondary floor', () => {
  const { input } = build('16:9', 'bar');
  const texts = flat(sampleGraph(input.nodes, input.duration)).filter((n) => n.type === 'text');
  assert.ok(texts.every((n) => n.props.dropped === undefined), 'nothing is dropped');
  const attribution = texts.find((n) => /make-motion design notes/.test(n.props.layout.lines.map((l) => l.text ?? '').join(' ')) || /\.by$|\.attr/.test(n.id));
  assert.ok(attribution !== undefined, `an attribution text among ${texts.map((n) => n.id).join(', ')}`);
  assert.ok(attribution.props.font.size >= input.look.secondary.min - 1e-6, `attribution at ${attribution.props.font.size}`);
});

for (const id of ['regions', 'growth']) {
  test(`finding 4: the 9:16 ${id} source line takes the plot's full width and wraps to two lines`, () => {
    const { input } = build('9:16', id);
    const nodes = sampleGraph(input.nodes, input.duration);
    const source = textAt(nodes, `${id}.source`);
    assert.equal(source.props.layout.lines.length, 2, 'two lines');
    assert.ok(source.props.layout.overflow !== true, 'no overflow');
    // the plot's left edge on a tall frame is column 1: the grid's margin
    const margin = input.look.gridTall.margin * input.unit;
    assert.ok(Math.abs(source.x - margin) < 1, `starts at ${source.x.toFixed(1)}, the plot at ${margin}`);
    assert.ok(source.x + source.props.layout.width <= input.canvas.w - margin + 1, 'inside the right margin');
  });
}
