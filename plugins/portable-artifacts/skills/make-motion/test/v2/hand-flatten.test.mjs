// flattenForHand (looks-four Task 12): what the kinds build becomes what the hand draws: text and stroked polylines.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import '../../engine/kinds/index.mjs';
import { node } from '../../engine/graph/node.mjs';
import { track } from '../../engine/time/track.mjs';
import { flattenForHand, pathToPolyline } from '../../engine/hand/flatten.mjs';
import { polylinePoints } from '../../engine/hand/strokes.mjs';
import { boxHatch } from '../../engine/hand/geometry.mjs';

const look = registries.looks.get('marker');
const UNIT = 1;
const flat = (nodes) => flattenForHand(nodes, look, UNIT);
const rect = (id, x, y, w, h, props = {}) => node('path', id, { d: `M${x} ${y}L${x + w} ${y}L${x + w} ${y + h}L${x} ${y + h}Z`, ...props });
const accent = look.palette.accent;

test('a group that is only a position is lifted: its children take its offset and keep their order', () => {
  const group = node('group', 'g', { x: 100, y: 50 }, { children: [rect('a', 0, 0, 10, 10, { stroke: '#000000', strokeWidth: 4 }), node('group', 'h', { x: 5, y: 5 }, { children: [rect('b', 0, 0, 10, 10, { stroke: '#000000', strokeWidth: 4 })] })] });
  const out = flat([group]);
  assert.deepEqual(out.map((n) => [n.id, n.props.x, n.props.y]), [['a', 100, 50], ['b', 105, 55]]);
});

test('a group that turns or scales stays as it is, with a stepped opacity (put on at once, never faded)', () => {
  const turned = node('group', 't', { x: 0, y: 0, rotate: 3 }, { tracks: { opacity: track([{ t: 0, v: 0 }, { t: 0.5, v: 1 }]) }, children: [rect('a', 0, 0, 10, 10, { stroke: '#000000' })] });
  const [out] = flat([turned]);
  assert.equal(out.id, 't');
  assert.deepEqual(out.tracks.opacity.points.map((k) => [k.t, k.v]), [[0, 0], [0.5, 0], [0.5, 1]]);
  const image = node('image', 'i', { src: 'x.png', w: 10, h: 10 }, { tracks: { opacity: track([{ t: 0, v: 0 }, { t: 0.4, v: 1 }]) } });
  assert.ok(flat([image])[0].tracks.opacity.points.every((k) => k.v === 0 || k.v === 1));
});

test('curves become polylines: a quad and a cubic are sampled, and the rest of the path is kept', () => {
  const quad = pathToPolyline('M0 0L100 0Q150 0 150 50L150 100Z');
  assert.ok(quad.closed && quad.points.length > 10);
  assert.deepEqual(quad.points[0], [0, 0]);
  assert.deepEqual(quad.points.at(-1), [150, 100]);
  const cubic = pathToPolyline('M0 0C10 40 60 40 100 0');
  assert.equal(cubic.closed, false);
  assert.deepEqual(cubic.points.at(-1), [100, 0]);
  assert.equal(pathToPolyline('M0 0a5 5 0 0 1 10 0'), null, 'a path it cannot read comes back null, so the node is left as it was');
  assert.equal(pathToPolyline('M0 0L5 5M10 10L20 20'), null, 'one subpath only');
  assert.deepEqual(pathToPolyline('M0 0H40V30H0Z').points, [[0, 0], [40, 0], [40, 30], [0, 30]]);
});

test('every path the hand draws comes out as an M/L polyline the stroke plan can read', () => {
  const smooth = node('path', 's', { d: 'M0 0C10 40 60 40 100 0', stroke: '#000000', strokeWidth: 5 });
  const [out] = flat([smooth]);
  assert.ok(polylinePoints(out.props.d) !== null);
  assert.equal(out.props.stroke, '#000000');
});

test('a fill in the board\'s own colour is dropped and its stroke stays: a drawn box is its outline', () => {
  const plate = rect('plate', 0, 0, 200, 80, { fill: look.palette.paper, stroke: look.palette.ink, strokeWidth: 6 });
  assert.deepEqual(flat([plate]).map((n) => n.id), ['plate']);
  assert.equal(flat([plate])[0].props.fill, undefined);
  assert.deepEqual(flat([rect('paper-only', 0, 0, 200, 80, { fill: look.palette.paper })]), [], 'a plate with no stroke is nothing to draw');
  assert.deepEqual(flat([rect('white', 0, 0, 200, 80, { fill: '#ffffff' })]), []);
});

test('a rectangle filled in a colour becomes its outline and a hatch of strokes inside it in that colour: no flat fill', () => {
  const bar = rect('bar', 100, 200, 300, 120, { fill: accent });
  const out = flat([bar]);
  assert.deepEqual(out.map((n) => n.id), ['bar', 'bar.hatch']);
  assert.ok(out.every((n) => n.props.fill === undefined && n.props.stroke === accent), 'strokes in the fill colour');
  const hatch = polylinePoints(out[1].props.d);
  assert.ok(hatch.length > 4, 'a zig-zag');
  assert.ok(hatch.every(([x, y]) => x >= 100 && x <= 400 && y >= 200 && y <= 320), 'inside the bar');
  const expected = boxHatch(250, 260, 300, 120, 26, 1); // the hand's hatch gap
  assert.equal(hatch.length, expected.length, 'the geometry module\'s hatch');
});

test('a shape that is not a rectangle keeps its outline only (no hatch can spill past it), a soft shape behind is dropped', () => {
  const disc = node('path', 'disc', { d: 'M100 0C155 0 200 45 200 100C200 155 155 200 100 200C45 200 0 155 0 100C0 45 45 0 100 0Z', fill: accent });
  assert.deepEqual(flat([disc]).map((n) => n.id), ['disc']);
  const glow = node('path', 'glow', { d: 'M0 0C40 0 80 40 80 80C80 120 40 160 0 160Z', fill: accent, opacity: 0.25, under: true });
  assert.deepEqual(flat([glow]), []);
});

test('text and the field are not touched, the hand group is left alone, and nothing it builds has a part-way opacity', () => {
  const field = node('field', 'field', {});
  const text = node('text', 't', { x: 10, y: 20, text: 'hi' });
  const hand = node('group', 'hand', { role: 'hand', rotate: 55 });
  const out = flat([field, text, hand]);
  assert.deepEqual(out.map((n) => n.id), ['field', 't', 'hand']);
  assert.strictEqual(out[1], text);
  assert.strictEqual(out[2], hand);
  const faded = node('path', 'f', { d: 'M0 0L50 0', stroke: '#000000', opacity: 0.5 });
  assert.equal(flat([faded])[0].props.opacity, undefined, 'a translucent stroke is made opaque: the board is drawn on in solid marker');
});
