// The layer cuts (transitions plan Task 3): crossfade, fade, wipe, iris, zoom and blur are pure recipes for composing the
// outgoing and the incoming picture; the page composes them (engine/page/cut-pictures.mjs). And frameAt inside a layer
// window returns the incoming shot live plus the outgoing one frozen at its end.
import test from 'node:test';
import assert from 'node:assert/strict';
import '../../scripts/v2/list.mjs';
import { registries } from '../../engine/registry.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { buildFilm } from '../../engine/graph/film.mjs';
import { measure, canvasOf } from './helpers/kinds.mjs';

const CANVAS = { w: 1920, h: 1080 };
const LAYERS = ['crossfade', 'fade', 'wipe', 'iris', 'zoom', 'blur'];
const CORNER = Math.hypot(CANVAS.w / 2, CANVAS.h / 2);
const recipe = (name, p, direction) => registries.cuts.get(name).layers({ p, direction: direction ?? registries.cuts.get(name).directions?.[0] ?? null, canvas: CANVAS });

// Does `pose` leave its picture as it is? Full opacity, no scale, no blur, and no clip or one that holds the canvas.
function untouched(pose) {
  if (pose.opacity !== 1 || pose.scale !== 1 || pose.blur !== 0) return false;
  if (pose.clip === null) return true;
  if (pose.clip.rect) {
    const [x, y, w, h] = pose.clip.rect;
    return x <= 0 && y <= 0 && x + w >= CANVAS.w && y + h >= CANVAS.h;
  }
  const [cx, cy, r] = pose.clip.circle;
  return r >= Math.hypot(Math.max(cx, CANVAS.w - cx), Math.max(cy, CANVAS.h - cy));
}
// Does `pose` show nothing of its picture? Opacity 0, or a clip with no area.
const hidden = (pose) => pose.opacity === 0 || (pose.clip?.rect && (pose.clip.rect[2] <= 0 || pose.clip.rect[3] <= 0)) || (pose.clip?.circle && pose.clip.circle[2] <= 0);

// The composed picture is exactly `which` ('from' | 'to'): it is drawn untouched, and the other is hidden or under it.
function showsOnly(r, which) {
  const other = which === 'from' ? 'to' : 'from';
  if (!untouched(r[which])) return false;
  return r.under === which ? hidden(r[other]) : true;
}

for (const name of LAYERS) {
  for (const direction of registries.cuts.get(name).directions ?? [null]) {
    test(`${name}${direction ? ` ${direction}` : ''}: p 0 is the outgoing picture and p 1 the incoming one, exactly`, () => {
      assert.ok(showsOnly(recipe(name, 0, direction), 'from'), JSON.stringify(recipe(name, 0, direction)));
      assert.ok(showsOnly(recipe(name, 1, direction), 'to'), JSON.stringify(recipe(name, 1, direction)));
    });
  }
  test(`${name}: a layer entry with its length, directions, summary and example, never smearable`, () => {
    const entry = registries.cuts.get(name);
    assert.equal(entry.family, 'layer');
    assert.equal(entry.dur, 0.4);
    assert.equal(entry.smearable, false);
    assert.equal(typeof entry.layers, 'function');
  });
}

test('the directions are version 1\'s: wipe from left, right, up, down; iris and zoom in or out', () => {
  assert.deepEqual(registries.cuts.get('wipe').directions, ['left', 'right', 'up', 'down']);
  assert.deepEqual(registries.cuts.get('iris').directions, ['in', 'out']);
  assert.deepEqual(registries.cuts.get('zoom').directions, ['in', 'out']);
  for (const name of ['crossfade', 'fade', 'blur']) assert.equal(registries.cuts.get(name).directions, null, name);
});

test('wipe from each edge at p 0.5 clips the incoming picture to the half on that side', () => {
  const half = { left: [0, 0, 960, 1080], right: [960, 0, 960, 1080], up: [0, 0, 1920, 540], down: [0, 540, 1920, 540] };
  for (const [direction, rect] of Object.entries(half)) {
    const r = recipe('wipe', 0.5, direction);
    assert.deepEqual(r.to.clip, { rect }, direction);
    assert.ok(untouched(r.from), direction);
  }
});

test('iris in at p 1 has a radius that covers the canvas corners; iris out closes the outgoing picture over the incoming one', () => {
  assert.ok(recipe('iris', 1, 'in').to.clip.circle[2] >= CORNER);
  assert.deepEqual(recipe('iris', 0.5, 'in').to.clip.circle.slice(0, 2), [960, 540]);
  const out = recipe('iris', 0.5, 'out');
  assert.equal(out.under, 'to');
  assert.ok(out.from.clip.circle[2] > 0 && out.from.clip.circle[2] < CORNER);
});

test('zoom in starts at 1.2 and zoom out at 0.8 (the version 1 values), both settling to 1', () => {
  assert.equal(recipe('zoom', 0, 'in').to.scale, 1.2);
  assert.equal(recipe('zoom', 0, 'out').to.scale, 0.8);
  assert.equal(recipe('zoom', 1, 'in').to.scale, 1);
});

test('fade dips through the incoming background: neither picture shows at p 0.5', () => {
  const r = recipe('fade', 0.5);
  assert.equal(r.from.opacity, 0);
  assert.equal(r.to.opacity, 0);
  assert.equal(r.backdrop, 'to');
  assert.ok(recipe('fade', 0.25).from.opacity > 0 && recipe('fade', 0.25).to.opacity === 0, 'the outgoing shot fades over the first half');
  assert.ok(recipe('fade', 0.75).to.opacity > 0 && recipe('fade', 0.75).from.opacity === 0, 'the incoming shot fades up over the second half');
});

test('crossfade at p 0.5 lays the incoming picture at half strength over the outgoing one', () => {
  const r = recipe('crossfade', 0.5);
  assert.equal(r.under, 'from');
  assert.equal(r.to.opacity, 0.5);
});

test('blur never returns a negative radius, and its radius grows with the canvas', () => {
  for (let p = 0; p <= 1; p += 0.05) assert.ok(recipe('blur', p).to.blur >= 0, `p ${p}`);
  const small = registries.cuts.get('blur').layers({ p: 0.2, direction: null, canvas: { w: 960, h: 540 } }).to.blur;
  assert.ok(recipe('blur', 0.2).to.blur > small);
});

test('a recipe asks for p in 0..1 and a direction the cut has', () => {
  assert.throws(() => recipe('wipe', Number.NaN), /p must be a finite number/);
  assert.throws(() => recipe('wipe', 0.5, 'in'), /direction must be one of left, right, up, down/);
});

// ---- frameAt inside a layer window ----

const flat = (id, background, cut) => ({ id, show: 'free', hold: 1, background, nodes: [], ...(cut ? { cut } : {}) });
function wipeFilm() {
  const film = { version: 2, mode: 'pro', look: 'desk', format: '16:9', fps: 30, seed: 1, shots: [flat('a', '#ff0000'), flat('b', '#0000ff', { type: 'wipe', direction: 'left' })] };
  const timeline = buildTimeline(film, { fps: 30 });
  return { timeline, built: buildFilm({ film, timeline, measure, canvas: canvasOf('16:9') }) };
}

test('frameAt inside a wipe\'s window: the incoming shot live, the cut and its progress, the outgoing shot frozen at its end', () => {
  const { timeline, built } = wipeFilm();
  const start = timeline.shots[1].start;
  const frame = built.frameAt(start + 0.2);
  assert.deepEqual(frame.cut, { name: 'wipe', family: 'layer', p: 0.5, direction: 'left' });
  assert.equal(frame.background, '#0000ff');
  assert.deepEqual(frame.sampled, built.sampleShot(1, 0.2));
  assert.deepEqual(frame.from, { shot: 0, background: '#ff0000', sampled: built.sampleShot(0, timeline.shots[0].duration), t: timeline.shots[0].end });
});

test('frameAt one frame after the window, and outside any window, returns neither cut nor from', () => {
  const { timeline, built } = wipeFilm();
  const after = built.frameAt(timeline.shots[1].start + 12 / 30);
  assert.equal(after.cut, undefined);
  assert.equal(after.from, undefined);
  assert.equal(built.frameAt(0.5).cut, undefined);
});
