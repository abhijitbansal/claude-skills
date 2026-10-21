// P4: root `texture` (vignette and static film grain) and `typing` text. Opt-in; default is today's output.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTimeline, seekTo } from '../template/timeline.mjs';
import { validateSpec } from '../scripts/lib/spec.mjs';
import { haveBrowser, probed, framed } from './render-probe.mjs';

const label = (id, extra = {}) => ({ id, type: 'text', text: id, x: 240, y: 135, fontSize: 40, ...extra });
const spec = (extra = {}, elements = [label('a')]) => ({
  size: [480, 270],
  scenes: [{ id: 'one', duration: 2, elements }, { id: 'two', duration: 2, elements: [label('b')] }],
  ...extra,
});
const errs = (motion) => validateSpec(motion).errors.map((e) => `${e.path}: ${e.message}`);
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

// ---- texture: validation -----------------------------------------------------------------------

test('texture accepts a vignette and a grain from 0 to 0.15, alone or together', () => {
  for (const texture of [{ vignette: true }, { grain: 0.08 }, { vignette: true, grain: 0.15 }, { grain: 0 }, {}]) {
    assert.deepEqual(errs(spec({ texture })), [], JSON.stringify(texture));
  }
});

test('texture rejects out-of-range grain, a non-boolean vignette and unknown keys with a did-you-mean', () => {
  assert.ok(errs(spec({ texture: { grain: 0.2 } }))[0].startsWith('texture.grain:'));
  assert.ok(errs(spec({ texture: { grain: -0.01 } }))[0].startsWith('texture.grain:'));
  assert.ok(errs(spec({ texture: { grain: 'a lot' } }))[0].startsWith('texture.grain:'));
  assert.ok(errs(spec({ texture: { vignette: 'yes' } }))[0].startsWith('texture.vignette:'));
  assert.deepEqual(errs(spec({ texture: { vinette: true } })), ['texture.vinette: unknown property; did you mean "vignette"?']);
});

// ---- texture: drawn ----------------------------------------------------------------------------

const layers = () => {
  const stage = document.getElementById('stage');
  const vignette = [...stage.querySelectorAll(':scope > .vignette')];
  return {
    vignette: vignette.length,
    vignetteCss: vignette[0]?.style.background ?? '',
    grain: stage.querySelectorAll('.scene > .grain').length,
    seeds: [...stage.querySelectorAll('.scene > .grain')].map((n) => n.dataset.seed),
    inElements: stage.querySelectorAll('.el .grain, .el .vignette').length,
  };
};

test('vignette adds exactly one layer over the scenes, with the clear-centre gradient; none when off', async (t) => {
  if (!(await haveBrowser())) return t.skip('browser unavailable');
  const on = await probed(spec({ texture: { vignette: true } }), layers);
  assert.equal(on.vignette, 1);
  assert.match(on.vignetteCss, /radial-gradient\(.*55%.*0\.55.*100%/);
  assert.equal(on.grain, 0, 'a vignette alone adds no grain');
  for (const texture of [undefined, {}, { vignette: false }, { grain: 0 }]) {
    const off = await probed(spec(texture === undefined ? {} : { texture }), layers);
    assert.deepEqual([off.vignette, off.grain], [0, 0], JSON.stringify(texture));
  }
  return undefined;
});

test('grain adds one static layer per scene, seeded from the scene id and nothing else', async (t) => {
  if (!(await haveBrowser())) return t.skip('browser unavailable');
  const found = await probed(spec({ texture: { grain: 0.1 } }), layers);
  assert.equal(found.grain, 2);
  assert.equal(found.vignette, 0);
  assert.equal(found.inElements, 0);
  assert.equal(found.seeds.length, 2);
  assert.notEqual(found.seeds[0], found.seeds[1], 'each scene has its own noise');
  const again = await probed(spec({ texture: { grain: 0.1 } }), layers);
  assert.deepEqual(again.seeds, found.seeds, 'the seed is a function of the scene id');
  return undefined;
});

test('the same spec with grain and vignette renders byte-identical frames; the texture changes the frame', async (t) => {
  if (!(await haveBrowser())) return t.skip('browser unavailable');
  const textured = spec({ texture: { vignette: true, grain: 0.1 } });
  const first = await framed(textured, 0.5);
  const second = await framed(textured, 0.5);
  assert.ok(first.equals(second), 'two renders of one frame are the same bytes');
  assert.ok(!first.equals(await framed(spec(), 0.5)), 'texture is visible');
  assert.ok(!first.equals(await framed(spec({ texture: { vignette: true } }), 0.5)), 'grain is visible on its own');
  return undefined;
});

// ---- typing: validation ------------------------------------------------------------------------

test('typing is for text: a counter, shape or chart rejects it, and it must be a boolean', () => {
  assert.deepEqual(errs(spec({}, [label('a', { typing: true })])), []);
  const bad = errs(spec({}, [{ id: 'c', type: 'counter', to: 5, x: 1, y: 1, typing: true }, { id: 'r', type: 'shape', shape: 'rect', x: 1, y: 1, typing: true }]));
  assert.ok(bad.some((e) => e.startsWith('scenes[0].elements[0].typing: not valid on counter')), bad.join('\n'));
  assert.ok(bad.some((e) => e.startsWith('scenes[0].elements[1].typing: not valid on shape')), bad.join('\n'));
  assert.ok(errs(spec({}, [label('a', { typing: 'fast' })]))[0].startsWith('scenes[0].elements[0].typing:'));
});

test('a value keyframe is for typing text only', () => {
  assert.deepEqual(errs(spec({}, [label('a', { typing: true, keyframes: [{ t: 0.5, value: 0 }, { t: 1, value: 3 }] })])), []);
  assert.deepEqual(errs(spec({}, [label('a', { keyframes: [{ t: 0.5, value: 0 }] })])), ['scenes[0].elements[0].keyframes[0].value: not animatable on text; animatable: opacity, x, y, scale, rotate (value needs "typing": true)']);
});

// ---- typing: timeline --------------------------------------------------------------------------

const typed = (extra = {}) => buildTimeline(spec({}, [label('a', { text: 'Hello world', typing: true, ...extra })]));
const count = (built, sec) => { seekTo(built.timeline, sec); return Math.floor(built.states.get('a').value + 1e-6); };

test('typing counts characters up at 0.035 s each from the scene start, and holds the full count', () => {
  const built = typed();
  assert.deepEqual([0, 0.035, 0.14, 0.175, 0.2, 0.385, 1, 1.9].map((s) => count(built, s)), [0, 1, 4, 5, 5, 11, 11, 11]);
  near(built.states.get('a').value, 11);
});

test('typing counts code points, not UTF-16 units', () => {
  assert.equal(count(typed({ text: 'a\u{1F600}b' }), 1), 3);
});

test('value keyframes take control of the timing, as on a counter', () => {
  const built = typed({ keyframes: [{ t: 1, value: 0 }, { t: 1.5, value: 11 }] });
  assert.deepEqual([0, 0.9, 1.25, 1.5, 1.9].map((s) => count(built, s)), [0, 0, 5, 11, 11]);
});

test('text without typing keeps value 0 and no track', () => {
  const built = buildTimeline(spec());
  seekTo(built.timeline, 1);
  assert.equal(built.states.get('a').value, 0);
});

// ---- typing: drawn -----------------------------------------------------------------------------

test('typing shows the first n characters with a caret after them, in a box that is always the full text', async (t) => {
  if (!(await haveBrowser())) return t.skip('browser unavailable');
  const found = await probed(spec({}, [label('a', { text: 'Hello world', typing: true })]), () => {
    const node = document.querySelector('[data-id="a"]');
    const at = (sec) => {
      window.__motion.seek(sec);
      const shown = node.querySelector('.typed').textContent;
      const rest = node.querySelector('.rest');
      return { shown, hidden: getComputedStyle(rest).visibility, restText: rest.textContent, width: node.getBoundingClientRect().width, caret: node.querySelectorAll('.caret').length };
    };
    return { start: at(0), mid: at(0.035 * 5 + 0.001), end: at(1.9), plain: node.textContent };
  });
  assert.equal(found.start.shown, '');
  assert.equal(found.mid.shown, 'Hello');
  assert.equal(found.mid.restText, ' world');
  assert.equal(found.mid.hidden, 'hidden', 'the untyped part keeps its space but is not drawn');
  assert.equal(found.end.shown, 'Hello world');
  const same = (a, b) => Math.abs(a - b) < 0.5; // splitting a run into spans can move kerning by a hair
  assert.ok(same(found.start.width, found.mid.width) && same(found.mid.width, found.end.width), `the box is the full text at every moment: ${found.start.width} ${found.mid.width} ${found.end.width}`);
  assert.equal(found.mid.caret, 1);
  return undefined;
});

test('text without typing is drawn as before: plain text content, no spans', async (t) => {
  if (!(await haveBrowser())) return t.skip('browser unavailable');
  const found = await probed(spec(), () => {
    const node = document.querySelector('[data-id="a"]');
    return { text: node.textContent, spans: node.querySelectorAll('span').length };
  });
  assert.deepEqual(found, { text: 'a', spans: 0 });
  return undefined;
});
