// Tests for the v2 scene graph: node(), sampleGraph(), camera()/applyCamera() and stateKey().
import test from 'node:test';
import assert from 'node:assert/strict';
import { track } from '../../engine/time/track.mjs';
import { node } from '../../engine/graph/node.mjs';
import { sampleGraph, stateKey } from '../../engine/graph/sample.mjs';
import { camera, applyCamera } from '../../engine/graph/camera.mjs';

const CANVAS = { w: 1920, h: 1080 };
const NO_CAMERA = { x: 0, y: 0, zoom: 1, rotate: 0 };
const ramp = (from, to) => track([{ t: 0, v: from }, { t: 1, v: to, ease: 'linear' }]);
const textProps = () => ({ layout: { lines: [{ words: ['one', 'two', 'three'] }] }, font: { family: 'Fraunces', size: 48 }, fill: '#112233' });

// ---- brief tests ----

test('sampling resolves tracks and defaults', () => {
  const n = node('path', 'bar', { d: 'M0 0H10', x: 5 }, { tracks: { opacity: track([{ t: 0, v: 0 }, { t: 1, v: 1, ease: 'linear' }]) } });
  const [s] = sampleGraph([n], 0.5);
  assert.equal(s.x, 5); assert.equal(s.opacity, 0.5); assert.equal(s.scale, 1); assert.equal(s.visible, true);
});

test('a stepped node holds between steps', () => {
  const n = node('path', 'mark', { d: 'M0 0H10' }, { step: 12, tracks: { draw: track([{ t: 0, v: 0 }, { t: 1, v: 1, ease: 'linear' }]) } });
  assert.equal(sampleGraph([n], 0.10)[0].draw, sampleGraph([n], 0.16)[0].draw);
});

test('farther layers move less under a camera pan', () => {
  const near = sampleGraph([node('group', 'near', { x: 0 })], 0), far = sampleGraph([node('group', 'far', { x: 0 }, { depth: 1 })], 0);
  const cam = { x: 100, y: 0, zoom: 1, rotate: 0 }, canvas = { w: 1920, h: 1080 };
  assert.equal(applyCamera(near, cam, canvas)[0].x, -100); assert.equal(applyCamera(far, cam, canvas)[0].x, -50);
});

test('equal states give equal keys, a moved node a different one', () => {
  const n = node('group', 'g', { x: 1 });
  assert.equal(stateKey(sampleGraph([n], 0)), stateKey(sampleGraph([n], 5)));
  assert.notEqual(stateKey(sampleGraph([n], 0)), stateKey(sampleGraph([node('group', 'g', { x: 2 })], 0)));
});

// ---- sampling ----

test('defaults fill every animatable prop and the sampled node carries its static props', () => {
  const [s] = sampleGraph([node('path', 'p', { d: 'M0 0H10', stroke: '#ffffff' })], 0);
  assert.deepEqual(
    { x: s.x, y: s.y, scale: s.scale, rotate: s.rotate, opacity: s.opacity, draw: s.draw, reveal: s.reveal, blur: s.blur },
    { x: 0, y: 0, scale: 1, rotate: 0, opacity: 1, draw: 1, reveal: 1, blur: 0 },
  );
  assert.equal(s.type, 'path'); assert.equal(s.id, 'p'); assert.equal(s.depth, 0);
  assert.deepEqual(s.props, { d: 'M0 0H10', stroke: '#ffffff' });
});

test('a track wins over the static value of the same prop', () => {
  const n = node('group', 'g', { x: 5 }, { tracks: { x: ramp(100, 200) } });
  assert.equal(sampleGraph([n], 0.5)[0].x, 150);
});

test('opacity <= 0 keeps the node but marks it invisible', () => {
  const [hidden, shown] = sampleGraph([node('group', 'a', { opacity: 0 }), node('group', 'b', { opacity: 0.2 })], 0);
  assert.equal(hidden.visible, false); assert.equal(hidden.opacity, 0);
  assert.equal(shown.visible, true);
});

test('children stay nested with local values and are sampled recursively', () => {
  const grandchild = node('path', 'gc', { d: 'M0 0H1', x: 3 });
  const child = node('group', 'c', { x: 20 }, { tracks: { y: ramp(0, 10) }, children: [grandchild] });
  const parent = node('group', 'p', { x: 100 }, { tracks: { rotate: ramp(0, 90) }, children: [child] });
  const [p] = sampleGraph([parent], 0.5);
  assert.equal(p.x, 100); assert.equal(p.rotate, 45);
  assert.equal(p.children.length, 1);
  const [c] = p.children;
  assert.equal(c.id, 'c'); assert.equal(c.x, 20); assert.equal(c.y, 5); assert.equal(c.rotate, 0); // local: parent's rotate is not folded in
  assert.equal(c.children[0].id, 'gc'); assert.equal(c.children[0].x, 3);
});

test('a child honours its own step, not its parent', () => {
  const child = node('group', 'c', {}, { step: 2, tracks: { x: ramp(0, 100) } });
  const parent = node('group', 'p', {}, { children: [child] });
  const [p] = sampleGraph([parent], 0.4);
  assert.equal(p.children[0].x, 0); // floored to 0 s at 2 fps
  assert.equal(sampleGraph([parent], 0.5)[0].children[0].x, 50);
});

test('wordTracks resolve per word on a text node, defaulting to the node fill', () => {
  const n = node('text', 'title', textProps(), {
    wordTracks: [
      { opacity: ramp(0, 1), x: ramp(0, 10) },
      {},
      { fill: track([{ t: 0, v: '#000000' }, { t: 1, v: '#ffffff', ease: 'linear' }]), scale: ramp(1, 2) },
    ],
  });
  const [s] = sampleGraph([n], 0.5);
  assert.equal(s.words.length, 3);
  assert.deepEqual(s.words[0], { opacity: 0.5, x: 5, y: 0, scale: 1, fill: '#112233' });
  assert.deepEqual(s.words[1], { opacity: 1, x: 0, y: 0, scale: 1, fill: '#112233' });
  assert.deepEqual(s.words[2], { opacity: 1, x: 0, y: 0, scale: 1.5, fill: '#808080' });
});

test('wordTracks follow the node step', () => {
  const n = node('text', 'title', textProps(), { step: 4, wordTracks: [{ x: ramp(0, 100) }] });
  assert.equal(sampleGraph([n], 0.3)[0].words[0].x, 25); // floored to 0.25 s
});

test('a node without wordTracks has no words', () => {
  assert.equal(sampleGraph([node('text', 'plain', textProps())], 0)[0].words, undefined);
});

test('sampleGraph rejects a non-finite time and non-node input', () => {
  const n = node('group', 'g', {});
  assert.throws(() => sampleGraph([n], NaN), /finite/);
  assert.throws(() => sampleGraph([n], Infinity), /finite/);
  assert.throws(() => sampleGraph([{ type: 'group', id: 'raw' }], 0), /node\(\)/);
  assert.throws(() => sampleGraph(n, 0), /array/);
});

test('sampled output is immutable', () => {
  const [s] = sampleGraph([node('group', 'g', {}, { children: [node('group', 'c', {})] })], 0);
  assert.throws(() => { s.x = 9; }, TypeError);
  assert.throws(() => { s.children[0].x = 9; }, TypeError);
});

// ---- node() ----

test('node() deep-freezes what it returns and does not freeze the caller props', () => {
  const props = { d: 'M0 0H1', clip: [0, 0, 1, 1] };
  const n = node('path', 'p', props, { tracks: { x: ramp(0, 1) } });
  assert.ok(Object.isFrozen(n)); assert.ok(Object.isFrozen(n.props)); assert.ok(Object.isFrozen(n.tracks));
  assert.ok(Object.isFrozen(n.children)); assert.ok(Object.isFrozen(n.props.clip));
  assert.throws(() => { n.props.d = 'x'; }, TypeError);
  assert.ok(!Object.isFrozen(props));
});

test('node() rejects an unknown type and lists the accepted ones', () => {
  assert.throws(() => node('circle', 'c', {}), (e) => /circle/.test(e.message) && /group, text, path, image, field/.test(e.message));
});

test('node() rejects a missing or empty id', () => {
  assert.throws(() => node('group', undefined, {}), /id/);
  assert.throws(() => node('group', '', {}), /id/);
  assert.throws(() => node('group', 7, {}), /id/);
});

test('node() rejects an unknown track name and lists the accepted ones', () => {
  assert.throws(
    () => node('group', 'g', {}, { tracks: { wobble: ramp(0, 1) } }),
    (e) => /wobble/.test(e.message) && /x, y, scale, scaleX, scaleY, rotate, opacity, draw, reveal, blur/.test(e.message),
  );
});

test('node() rejects a track that is not a number track and a non-finite static value', () => {
  assert.throws(() => node('group', 'g', {}, { tracks: { x: 5 } }), /track/);
  assert.throws(() => node('group', 'g', {}, { tracks: { x: track([{ t: 0, v: 'left' }]) } }), /number/);
  assert.throws(() => node('group', 'g', { opacity: NaN }), /opacity/);
});

test('node() rejects wordTracks on a non-text node, unknown word tracks, and bad depth, step or children', () => {
  assert.throws(() => node('group', 'g', {}, { wordTracks: [{}] }), /text/);
  assert.throws(
    () => node('text', 't', textProps(), { wordTracks: [{ blur: ramp(0, 1) }] }),
    (e) => /blur/.test(e.message) && /opacity, x, y, scale, fill/.test(e.message),
  );
  assert.throws(() => node('group', 'g', {}, { depth: NaN }), /depth/);
  assert.throws(() => node('group', 'g', {}, { step: 0 }), /step/);
  assert.throws(() => node('group', 'g', {}, { children: [{ type: 'group', id: 'raw' }] }), /node\(\)/);
});

// ---- camera ----

test('camera() resolves tracks at t and defaults the rest', () => {
  const cam = camera({ tracks: { x: ramp(0, 100), zoom: ramp(1, 2) }, canvas: CANVAS });
  assert.deepEqual(cam(0.5), { x: 50, y: 0, zoom: 1.5, rotate: 0 });
  assert.deepEqual(camera({ canvas: CANVAS })(3), NO_CAMERA);
});

test('camera() rejects an unknown track and lists the accepted ones', () => {
  assert.throws(() => camera({ tracks: { dolly: ramp(0, 1) }, canvas: CANVAS }), (e) => /dolly/.test(e.message) && /x, y, zoom, rotate/.test(e.message));
});

test('zoom scales by depth: a far node zooms less than a near one', () => {
  const cam = { x: 0, y: 0, zoom: 2, rotate: 0 };
  const sampled = sampleGraph([
    node('group', 'near', { x: 1160, y: 540 }),
    node('group', 'far', { x: 1160, y: 540 }, { depth: 1 }),
    node('group', 'farther', { x: 1160, y: 540 }, { depth: 3 }),
  ], 0);
  const [near, far, farther] = applyCamera(sampled, cam, CANVAS);
  assert.equal(near.scale, 2); assert.equal(near.x, 960 + 200 * 2); assert.equal(near.y, 540);
  assert.equal(far.scale, 1.5); assert.equal(far.x, 960 + 200 * 1.5);
  assert.equal(farther.scale, 1.25); assert.equal(farther.x, 960 + 200 * 1.25);
});

test('zoom also multiplies the existing scale', () => {
  const [s] = applyCamera(sampleGraph([node('group', 'g', { scale: 3 })], 0), { x: 0, y: 0, zoom: 2, rotate: 0 }, CANVAS);
  assert.equal(s.scale, 6);
});

test('a node at the canvas centre stays put under zoom', () => {
  const [s] = applyCamera(sampleGraph([node('group', 'c', { x: 960, y: 540 })], 0), { x: 0, y: 0, zoom: 4, rotate: 0 }, CANVAS);
  assert.equal(s.x, 960); assert.equal(s.y, 540);
});

test('props.fixed nodes are untouched by the camera', () => {
  const sampled = sampleGraph([node('group', 'hud', { x: 10, y: 20, fixed: true }), node('group', 'world', { x: 10, y: 20 })], 0);
  const cam = { x: 100, y: 50, zoom: 2, rotate: 30 };
  const [hud, world] = applyCamera(sampled, cam, CANVAS);
  assert.equal(hud.x, 10); assert.equal(hud.y, 20); assert.equal(hud.scale, 1); assert.equal(hud.rotate, 0);
  assert.notEqual(world.x, 10);
});

test('pan and zoom apply to top-level nodes only; children follow their parent', () => {
  const child = node('group', 'c', { x: 7, y: 8 }, { depth: 2 });
  const sampled = sampleGraph([node('group', 'p', { x: 100, y: 100 }, { children: [child] })], 0);
  const [p] = applyCamera(sampled, { x: 40, y: 0, zoom: 2, rotate: 0 }, CANVAS);
  assert.equal(p.children[0].x, 7); assert.equal(p.children[0].y, 8); assert.equal(p.children[0].scale, 1);
  assert.notEqual(p.x, 100);
});

test('camera rotate turns top-level positions about the centre and adds to rotate', () => {
  const sampled = sampleGraph([node('group', 'g', { x: 1060, y: 540, rotate: 10 })], 0);
  const [s] = applyCamera(sampled, { x: 0, y: 0, zoom: 1, rotate: 90 }, CANVAS);
  assert.ok(Math.abs(s.x - 960) < 1e-9); assert.ok(Math.abs(s.y - 640) < 1e-9); // 100 px right of centre -> 100 px below it
  assert.equal(s.rotate, 100);
});

test('applyCamera returns new nodes and leaves its input unchanged', () => {
  const sampled = sampleGraph([node('group', 'g', { x: 5 })], 0);
  const [moved] = applyCamera(sampled, { x: 10, y: 0, zoom: 1, rotate: 0 }, CANVAS);
  assert.notEqual(moved, sampled[0]); assert.equal(sampled[0].x, 5);
});

test('applyCamera rejects a bad camera or canvas', () => {
  const sampled = sampleGraph([node('group', 'g', {})], 0);
  assert.throws(() => applyCamera(sampled, { x: 0, y: 0, zoom: 0, rotate: 0 }, CANVAS), /zoom/);
  assert.throws(() => applyCamera(sampled, { x: NaN, y: 0, zoom: 1, rotate: 0 }, CANVAS), /x/);
  assert.throws(() => applyCamera(sampled, NO_CAMERA, { w: 0, h: 10 }), /canvas/);
});

// ---- stateKey ----

test('stateKey does not depend on object key order', () => {
  const a = { type: 'group', id: 'g', props: { a: 1, b: { c: 2, d: 3 } }, x: 1, y: 2, children: [] };
  const b = { children: [], y: 2, x: 1, props: { b: { d: 3, c: 2 }, a: 1 }, id: 'g', type: 'group' };
  assert.equal(stateKey([a]), stateKey([b]));
});

test('stateKey changes with words, children, static props and node order', () => {
  const words = (x) => node('text', 't', textProps(), { wordTracks: [{ x: ramp(x, x) }] });
  assert.notEqual(stateKey(sampleGraph([words(0)], 0)), stateKey(sampleGraph([words(5)], 0)));
  const kids = (x) => node('group', 'p', {}, { children: [node('group', 'c', { x })] });
  assert.notEqual(stateKey(sampleGraph([kids(1)], 0)), stateKey(sampleGraph([kids(2)], 0)));
  const path = (d) => node('path', 'p', { d });
  assert.notEqual(stateKey(sampleGraph([path('M0 0H1')], 0)), stateKey(sampleGraph([path('M0 0H2')], 0)));
  const a = node('group', 'a', {}), b = node('group', 'b', {});
  assert.notEqual(stateKey(sampleGraph([a, b], 0)), stateKey(sampleGraph([b, a], 0)));
});

test('stateKey separates states after the camera and returns a string', () => {
  const sampled = sampleGraph([node('group', 'g', { x: 1 })], 0);
  const key = stateKey(applyCamera(sampled, { x: 5, y: 0, zoom: 1, rotate: 0 }, CANVAS));
  assert.equal(typeof key, 'string');
  assert.notEqual(key, stateKey(sampled));
});
