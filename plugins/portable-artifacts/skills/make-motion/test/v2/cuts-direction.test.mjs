// Directions name what the viewer sees (look review gate-cuts-1, P-F1; lead ruling 1): `left` and `right` name the edge
// the incoming shot enters by, `up` and `down` the way it moves on screen, so `down` enters at the top edge and moves
// down, `up` enters at the bottom edge and moves up. One table (engine/cuts/edges.mjs) gives the entry edge; each
// family is sampled here where the incoming picture first appears. Canvas y grows downward. Pure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import '../../engine/cuts/index.mjs';
import { ENTRY_EDGE } from '../../engine/cuts/edges.mjs';
import { SHADER_MODULES, shaderUniforms } from '../../engine/cuts/shaders/index.mjs';

const W = 1920, H = 1080;
const CANVAS = { w: W, h: H };
const EARLY = 0.2; // the incoming shot has only begun to arrive
const node = (id, x, y) => Object.freeze({ type: 'path', id, depth: 0, props: Object.freeze({ d: 'M0 0H10V10H0Z', fill: '#000000' }),
  x, y, scale: 1, scaleX: 1, scaleY: 1, rotate: 0, opacity: 1, draw: 1, reveal: 1, blur: 0, visible: true, children: Object.freeze([]) });
const REST = [960, 540];
const FROM = [node('a', ...REST)];
const TO = [node('b', ...REST)];
const at = (nodes, id) => nodes.find((n) => n.id === id);

// The side of the canvas a point displaced from the centre by (dx, dy) lies toward.
function sideOf(dx, dy) {
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'bottom' : 'top';
}

const SEEN = Object.freeze({ right: 'right', left: 'left', up: 'bottom', down: 'top' });

test('the entry edge of each direction is what the viewer sees: up enters at the bottom, down at the top', () => {
  assert.deepEqual({ ...ENTRY_EDGE }, SEEN);
});

for (const name of ['slide', 'cover']) {
  for (const [direction, edge] of Object.entries(SEEN)) {
    test(`${name} ${direction}: the incoming shot first appears at the ${edge} edge`, () => {
      const out = registries.cuts.get(name).apply({ from: FROM, to: TO, p: EARLY, canvas: CANVAS, direction, background: '#123456' });
      const b = at(out, 'b');
      assert.equal(sideOf(b.x - REST[0], b.y - REST[1]), edge);
    });
  }
}

test('slide down moves the outgoing shot down too; slide up moves it up', () => {
  const down = registries.cuts.get('slide').apply({ from: FROM, to: TO, p: EARLY, canvas: CANVAS, direction: 'down' });
  const up = registries.cuts.get('slide').apply({ from: FROM, to: TO, p: EARLY, canvas: CANVAS, direction: 'up' });
  assert.ok(at(down, 'a').y > REST[1], `down: outgoing at y ${at(down, 'a').y}`);
  assert.ok(at(up, 'a').y < REST[1], `up: outgoing at y ${at(up, 'a').y}`);
});

for (const [direction, edge] of Object.entries(SEEN)) {
  test(`wipe ${direction}: the incoming picture is first uncovered along the ${edge} edge`, () => {
    const [x, y, w, h] = registries.cuts.get('wipe').layers({ p: EARLY, direction, canvas: CANVAS }).to.clip.rect;
    const touches = { left: x === 0 && w < W, right: x + w === W && x > 0, top: y === 0 && h < H, bottom: y + h === H && y > 0 };
    assert.deepEqual(Object.keys(touches).filter((k) => touches[k]), [edge]);
  });
}

// The cube body (cube.mjs) brings the incoming face from the bottom or the right when uFlip is 1, about the
// horizontal axis when uSwap is 1; the browser test (cuts-direction-browser) reads the picture itself.
test('cube up turns the incoming face in from the bottom, cube down from the top', () => {
  const uniforms = (direction) => shaderUniforms(SHADER_MODULES.cube, { p: 0.5, direction, canvas: CANVAS });
  assert.deepEqual([uniforms('up').uSwap, uniforms('up').uFlip], [1, 1]);
  assert.deepEqual([uniforms('down').uSwap, uniforms('down').uFlip], [1, 0]);
  assert.deepEqual([uniforms('left').uSwap, uniforms('left').uFlip], [0, 0]);
  assert.deepEqual([uniforms('right').uSwap, uniforms('right').uFlip], [0, 1]);
});

test('cover\'s leading side faces away from the edge it enters by: cover down leads with its bottom', () => {
  const look = { coverEdge: { line: { color: 'ink', width: 4, alpha: 1 } }, palette: { ink: '#000000' } };
  const out = registries.cuts.get('cover').apply({ from: FROM, to: TO, p: EARLY, canvas: CANVAS, direction: 'down', background: '#123456', look });
  const line = at(out, 'cover.edge.line');
  // the band sits just below the sheet (y from h to h + 4 before the sheet's offset), and the sheet is above the canvas
  assert.match(line.props.d, /^M0 1080H1920V1084H0Z$/);
  assert.ok(line.y < 0);
});
