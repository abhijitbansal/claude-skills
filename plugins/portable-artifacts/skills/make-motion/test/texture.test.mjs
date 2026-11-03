// P4: root `texture` (vignette and static film grain) and `typing` text. Opt-in; default is today's output.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTimeline, seekTo } from '../template/timeline.mjs';
import { validateSpec } from '../scripts/lib/spec.mjs';
import { probed, framed, meanLuma } from './render-probe.mjs';
import { requireRender, BROWSER_ONLY } from './helpers/render.mjs';

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
    grain: stage.querySelectorAll(':scope > .grain').length,
    seeds: [...stage.querySelectorAll(':scope > .grain')].map((n) => n.dataset.seed),
    inElements: stage.querySelectorAll('.el .grain, .el .vignette').length,
  };
};

test('vignette adds exactly one layer over the scenes, with the clear-centre gradient; none when off', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return undefined;
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
  if (!(await requireRender(t, BROWSER_ONLY))) return undefined;
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
  if (!(await requireRender(t, BROWSER_ONLY))) return undefined;
  const textured = spec({ texture: { vignette: true, grain: 0.1 } });
  const first = await framed(textured, 0.5);
  const second = await framed(textured, 0.5);
  assert.ok(first.equals(second), 'two renders of one frame are the same bytes');
  assert.ok(!first.equals(await framed(spec(), 0.5)), 'texture is visible');
  assert.ok(!first.equals(await framed(spec({ texture: { vignette: true } }), 0.5)), 'grain is visible on its own');
  return undefined;
});

test('grain is luminance-neutral: the mean luma stays within a point of the grain-free frame at the strongest setting, while the pixels differ', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return undefined;
  const bare = spec({}, []);
  const grainy = spec({ texture: { grain: 0.15 } }, []);
  const [plain, noisy] = [await framed(bare, 0.5), await framed(grainy, 0.5)];
  assert.ok(!plain.equals(noisy), 'the grain is drawn');
  const [a, b] = [await meanLuma(plain), await meanLuma(noisy)];
  assert.ok(Math.abs(a - b) < 1, `mean luma ${a.toFixed(1)} without grain, ${b.toFixed(1)} with grain 0.15`);
  for (const theme of ['paper', 'press']) {
    const [x, y] = [await framed({ ...bare, theme }, 0.5), await framed({ ...grainy, theme }, 0.5)];
    const [lx, ly] = [await meanLuma(x), await meanLuma(y)];
    assert.ok(Math.abs(lx - ly) < 1, `${theme}: ${lx.toFixed(1)} vs ${ly.toFixed(1)}`);
  }
  return undefined;
});

test('grain across a crossfade does not wash the frame: mid-window luma stays at the grain-free value', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return undefined;
  const scenes = [{ id: 'one', duration: 2, elements: [] }, { id: 'two', duration: 2, transition: 'crossfade', elements: [] }];
  const bare = { size: [160, 90], scenes };
  const grainy = { ...bare, texture: { grain: 0.15 } };
  const [a, b] = [await meanLuma(await framed(bare, 2.2)), await meanLuma(await framed(grainy, 2.2))];
  assert.ok(Math.abs(a - b) < 1, `mid-crossfade luma ${a.toFixed(1)} without grain, ${b.toFixed(1)} with`);
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

test('a typing text that cannot finish inside its scene is an error naming the fix', () => {
  const long = 'x'.repeat(100);
  const motion = spec({}, [label('a', { text: long, typing: true })]);
  motion.scenes[0].duration = 1;
  assert.deepEqual(errs(motion), ['scenes[0].elements[0].text: typing 100 characters takes 3.50s but scene "one" lasts 1s (it must finish a frame before the scene ends at 30 fps); shorten the text or lengthen the scene to at least 3.54s']);
  motion.scenes[0].duration = 3.54;
  assert.deepEqual(errs(motion), []);
  motion.scenes[0].duration = 1;
  motion.scenes[0].elements[0].keyframes = [{ t: 0, value: 0 }, { t: 0.9, value: 100 }];
  assert.deepEqual(errs(motion), [], 'value keyframes put the pace in the author hands');
});

// ---- typing: timeline --------------------------------------------------------------------------

const typed = (extra = {}) => buildTimeline(spec({}, [label('a', { text: 'Hello world', typing: true, ...extra })]));
const count = (built, sec) => { seekTo(built.timeline, sec); return Math.floor(built.states.get('a').value + 1e-6); };

test('typing counts characters up at 0.035 s each from the scene start, and holds the full count', () => {
  const built = typed();
  assert.deepEqual([0, 0.035, 0.14, 0.175, 0.2, 0.385, 1, 1.9].map((s) => count(built, s)), [0, 1, 4, 5, 5, 11, 11, 11]);
  near(built.states.get('a').value, 11);
});

test('typing counts what a reader sees as one character: emoji, ZWJ sequences, flags and accents are one each', () => {
  const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}';
  assert.equal(count(typed({ text: 'a\u{1F600}b' }), 1), 3);
  assert.equal(count(typed({ text: `x${family}y` }), 1), 3, 'a ZWJ family is one character');
  assert.equal(count(typed({ text: 'a\u{1F1EB}\u{1F1F7}b' }), 1), 3, 'a flag is one character');
  assert.equal(count(typed({ text: 'cafe\u0301' }), 1), 4, 'a decomposed accent stays with its letter');
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
  if (!(await requireRender(t, BROWSER_ONLY))) return undefined;
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
  if (!(await requireRender(t, BROWSER_ONLY))) return undefined;
  const found = await probed(spec(), () => {
    const node = document.querySelector('[data-id="a"]');
    return { text: node.textContent, spans: node.querySelectorAll('span').length };
  });
  assert.deepEqual(found, { text: 'a', spans: 0 });
  return undefined;
});

test('a wrapped typing text lays out identically at every typed count: same box height, same line for every character', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return undefined;
  const wrapped = spec({}, [label('a', { text: 'Hello wonderful world', typing: true, maxWidth: 260, fontSize: 40 })]);
  const found = await probed(wrapped, () => {
    const node = document.querySelector('[data-id="a"]');
    const tops = () => {
      const out = [];
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      for (let text = walker.nextNode(); text; text = walker.nextNode()) {
        for (let i = 0; i < text.length; i++) {
          const range = document.createRange();
          range.setStart(text, i);
          range.setEnd(text, i + 1);
          out.push(Math.round(range.getBoundingClientRect().top));
        }
      }
      return out;
    };
    return Array.from({ length: 22 }, (_, n) => {
      window.__motion.seek(n * 0.035 + 0.001);
      return { height: Math.round(node.getBoundingClientRect().height), tops: tops().join(',') };
    });
  });
  assert.equal(new Set(found.map((f) => f.height)).size, 1, `heights: ${found.map((f) => f.height)}`);
  assert.equal(new Set(found.map((f) => f.tops)).size, 1, 'every character stays on its line while typing');
  assert.ok(new Set(found[0].tops.split(',')).size > 1, 'the text really wraps in this setup');
  return undefined;
});

test('typing never shows half a character: a ZWJ family and a decomposed accent appear whole', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return undefined;
  const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}';
  const found = await probed(spec({}, [label('a', { text: `${family}e\u0301x`, typing: true })]), () => {
    const typedText = (n) => { window.__motion.seek(n * 0.035 + 0.001); return document.querySelector('[data-id="a"] .typed').textContent; };
    return [typedText(1), typedText(2)];
  });
  assert.deepEqual(found, [family, `${family}e\u0301`]);
  return undefined;
});
