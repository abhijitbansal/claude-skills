// Task 4: the `group` element. A group holds children positioned relative to its centre and moves them as one unit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { flattenElements, isGroup, MAX_GROUP_DEPTH, MAX_GROUP_CHILDREN } from '../template/groups.mjs';
import { validateSpec, withDefaults, typingErrors, ANIMATABLE } from '../scripts/lib/spec.mjs';
import { buildTimeline, seekTo } from '../template/timeline.mjs';
import { resolveCues, typingFollow } from '../template/audio.mjs';
import { startServer } from '../scripts/lib/server.mjs';
import { launchBrowser } from '../scripts/lib/browser.mjs';
import { framed, probed } from './render-probe.mjs';
import { requireRender, BROWSER_ONLY, assertRendersIdentically } from './helpers/render.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = path.join(root, 'scripts/check.mjs');
const EXAMPLE = path.join(root, 'references/examples/group-card.json');

const text = (id, extra = {}) => ({ id, type: 'text', text: id, x: 0, y: 0, fontSize: 40, ...extra });
const group = (id, children, extra = {}) => ({ id, type: 'group', x: 240, y: 135, children, ...extra });
const spec = (elements, extra = {}) => ({ size: [480, 270], scenes: [{ id: 's', duration: 2, elements }], ...extra });
const errs = (motion) => validateSpec(motion).errors.map((e) => `${e.path}: ${e.message}`);
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

// groups nested `levels` deep, the innermost holding one text
const nest = (levels) => {
  let el = text('leaf');
  for (let i = levels; i >= 1; i--) el = group(`g${i}`, [el]);
  return el;
};

// ---- flattenElements ----------------------------------------------------------------------------

test('flattenElements walks depth first in document order, groups before their children, with spec paths and depth', () => {
  const elements = [
    text('a'),
    group('g', [text('b'), group('h', [text('c')]), text('d')]),
    text('e'),
  ];
  const flat = flattenElements(elements, 'scenes[0]');
  assert.deepEqual(flat.map((f) => [f.el.id, f.path, f.depth]), [
    ['a', 'scenes[0].elements[0]', 0],
    ['g', 'scenes[0].elements[1]', 0],
    ['b', 'scenes[0].elements[1].children[0]', 1],
    ['h', 'scenes[0].elements[1].children[1]', 1],
    ['c', 'scenes[0].elements[1].children[1].children[0]', 2],
    ['d', 'scenes[0].elements[1].children[2]', 1],
    ['e', 'scenes[0].elements[2]', 0],
  ]);
  assert.equal(flat[1].el, elements[1], 'elements are returned, not copied');
  assert.equal(flattenElements(elements)[2].path, 'elements[1].children[0]', 'without a base path the scene prefix is left to the caller');
});

test('flattenElements and isGroup survive a half-edited spec', () => {
  assert.deepEqual(flattenElements(undefined), []);
  assert.deepEqual(flattenElements([{ id: 'g', type: 'group', children: 'oops' }]).map((f) => f.el.id), ['g']);
  assert.deepEqual([isGroup({ type: 'group' }), isGroup({ type: 'text' }), isGroup(undefined)], [true, false, false]);
});

// ---- validation ---------------------------------------------------------------------------------

test('a group of children validates; ANIMATABLE.group is the pose; the limits are 3 deep and 40 children', () => {
  assert.deepEqual(errs(spec([group('g', [text('a'), text('b')])])), []);
  assert.deepEqual(ANIMATABLE.group, ['opacity', 'x', 'y', 'scale', 'rotate']);
  assert.equal(MAX_GROUP_DEPTH, 3);
  assert.equal(MAX_GROUP_CHILDREN, 40);
});

test('child ids are global: a duplicate inside a group is reported at its nested path', () => {
  assert.deepEqual(errs(spec([text('a'), group('g', [text('a')])])), ['scenes[0].elements[1].children[0].id: duplicate id "a" (first used at scenes[0].elements[0].id)']);
  assert.deepEqual(errs(spec([group('g', [text('a')]), group('h', [text('a')])])), ['scenes[0].elements[1].children[0].id: duplicate id "a" (first used at scenes[0].elements[0].children[0].id)']);
  assert.deepEqual(errs(spec([group('g', [text('a')]), text('g')])), ['scenes[0].elements[1].id: duplicate id "g" (first used at scenes[0].elements[0].id)']);
});

test('depth 4 is rejected naming the limit; depth 3 is allowed', () => {
  assert.deepEqual(errs(spec([nest(3)])), []);
  const e = errs(spec([nest(4)]));
  assert.equal(e.length, 1, e.join('\n'));
  assert.match(e[0], /scenes\[0\].elements\[0\].children\[0\].children\[0\].children\[0\].children: groups nest at most 3 deep/);
});

test('a keyframe prop not in POSE is rejected on a group', () => {
  const e = errs(spec([group('g', [text('a')], { keyframes: [{ t: 0, draw: 0 }, { t: 1, draw: 1 }] })]));
  assert.match(e[0], /scenes\[0\].elements\[0\].keyframes\[0\].draw: not animatable on group; animatable: opacity, x, y, scale, rotate/);
  assert.deepEqual(errs(spec([group('g', [text('a')], { keyframes: [{ t: 0, opacity: 0, y: 200 }, { t: 1, opacity: 1, y: 135, scale: 1.1, rotate: 5, x: 240 }] })])), []);
});

test('children is required, holds 1 to 40 elements, and belongs to a group only', () => {
  assert.deepEqual(errs(spec([{ id: 'g', type: 'group', x: 1, y: 1 }])), ['scenes[0].elements[0].children: required for type group']);
  assert.match(errs(spec([group('g', [])]))[0], /^scenes\[0\].elements\[0\].children: .*(fewer than 1|1)/);
  const many = Array.from({ length: MAX_GROUP_CHILDREN + 1 }, (_, i) => text(`t${i}`));
  assert.match(errs(spec([group('g', many)]))[0], /^scenes\[0\].elements\[0\].children: .*(more than 40|40)/);
  assert.deepEqual(errs(spec([group('g', many.slice(0, MAX_GROUP_CHILDREN))])), []);
  assert.match(errs(spec([text('a', { children: [text('b')] })]))[0], /^scenes\[0\].elements\[0\].children: not valid on text; allowed: /);
  assert.match(errs(spec([group('g', [text('a')], { text: 'hi' })]))[0], /^scenes\[0\].elements\[0\].text: not valid on group; allowed: .*children/);
});

test('a problem in a child is reported at the child, with the child checks that apply to its own type', () => {
  const e = errs(spec([group('g', [
    { id: 'c', type: 'counter', x: 0, y: 0 },
    text('t', { color: 'nope', keyframes: [{ t: 0, opacity: 0 }, { t: 5, opacity: 1 }] }),
  ])]));
  assert.ok(e.includes('scenes[0].elements[0].children[0].to: required for type counter'), e.join('\n'));
  assert.ok(e.some((x) => x.startsWith('scenes[0].elements[0].children[1].color: must be a CSS colour')), e.join('\n'));
  assert.ok(e.includes('scenes[0].elements[0].children[1].keyframes[1].t: 5 exceeds scene duration 2'), e.join('\n'));
});

test('typing errors name the nested path (typingErrors and validateSpec)', () => {
  const long = 'x'.repeat(100);
  const motion = spec([group('g', [text('t', { text: long, typing: true })])]);
  const found = typingErrors(motion, 30);
  assert.equal(found.length, 1);
  assert.equal(found[0].path, 'scenes[0].elements[0].children[0].text');
  assert.match(found[0].message, /typing 100 characters takes 3\.50s but scene "s" lasts 2s/);
  assert.deepEqual(errs(motion).filter((x) => x.includes('typing 100')).map((x) => x.split(':')[0]), ['scenes[0].elements[0].children[0].text']);
});

// ---- a typing cue follows a typing text inside a group -------------------------------------------

const followSpec = () => ({
  size: [480, 270],
  cues: [{ cue: 'typing', follow: 'typed' }],
  scenes: [
    { id: 'one', duration: 2, elements: [text('plain')] },
    { id: 'two', duration: 3, elements: [group('outer', [group('inner', [text('typed', { text: 'hello', typing: true })])])] },
  ],
});

test('follow finds a typing text inside a group: it starts with the text\'s scene and clicks once per character', () => {
  assert.deepEqual(errs(followSpec()), []);
  const found = typingFollow(followSpec(), 'typed');
  assert.equal(found.el.id, 'typed');
  assert.equal(found.scene.id, 'two');
  const [cue] = resolveCues(followSpec());
  assert.equal(cue.start, 2);
  assert.equal(cue.chars, 5);
});

test('follow errors still resolve through groups: a group is not a text, and an unknown id lists the nested typing texts', () => {
  const asGroup = followSpec();
  asGroup.cues[0].follow = 'outer';
  assert.deepEqual(errs(asGroup), ['cues[0].follow: element "outer" is a group, not a text; follow a typing text']);
  const unknown = followSpec();
  unknown.cues[0].follow = 'nope';
  assert.deepEqual(errs(unknown), ['cues[0].follow: element "nope" not found; typing texts: typed']);
});

// ---- defaults and timeline ----------------------------------------------------------------------

test('withDefaults fills a group and every child, at any depth, without mutating the input', () => {
  const input = spec([group('g', [text('a'), group('h', [{ id: 'c', type: 'counter', to: 5, from: 2, x: 0, y: 0 }])])]);
  const out = withDefaults(input);
  const [g] = out.scenes[0].elements;
  assert.deepEqual([g.opacity, g.scale, g.rotate, g.keyframes], [1, 1, 0, []]);
  const [a, h] = g.children;
  assert.deepEqual([a.opacity, a.scale, a.rotate, a.keyframes], [1, 1, 0, []]);
  assert.equal(h.children[0].value, 2, 'a counter two levels down gets its `from`');
  assert.ok(!('opacity' in input.scenes[0].elements[0]) && !('opacity' in input.scenes[0].elements[0].children[0]), 'input not mutated');
});

test('every child has its own state entry keyed by id, and sceneOf covers children', () => {
  const motion = {
    size: [480, 270],
    scenes: [
      { id: 'one', duration: 2, elements: [text('a')] },
      { id: 'two', duration: 2, elements: [group('g', [text('b', { keyframes: [{ t: 0, x: 10 }, { t: 1, x: 50 }] }), group('h', [text('c')])],
        { keyframes: [{ t: 0, y: 100 }, { t: 1, y: 200 }] })] },
    ],
  };
  const built = buildTimeline(motion);
  assert.deepEqual([...built.states.keys()].sort(), ['a', 'b', 'c', 'g', 'h', 'scene:one', 'scene:two']);
  assert.deepEqual(['a', 'g', 'b', 'h', 'c'].map((id) => built.sceneOf.get(id)), [0, 1, 1, 1, 1]);
  seekTo(built.timeline, 2.5); // half a second into scene two
  near(built.states.get('g').y, 150);
  near(built.states.get('b').x, 30);
  near(built.states.get('c').x, 0, 1e-9); // the grandchild is untouched by the group's and its sibling's tracks
  near(built.states.get('b').y, 0);
});

// ---- rendered ------------------------------------------------------------------------------------

const rect = (id, extra = {}) => ({ id, type: 'shape', shape: 'rect', width: 120, height: 20, fill: '#4488ff', x: 0, y: 0, ...extra });
const nested = (kf = [{ t: 0, x: 240, y: 135 }, { t: 1, x: 280, y: 155 }]) => spec([group('g', [text('title', { y: -40 }), rect('bar', { y: 30 })], { keyframes: kf })]);
// The same picture by hand: each child at its absolute position, with the group's keyframes moved onto it.
const flat = (kf = [{ t: 0, x: 240, y: 135 }, { t: 1, x: 280, y: 155 }]) => spec([
  text('title', { x: 240, y: 95, keyframes: kf.map((k) => ({ ...k, y: k.y - 40 })) }),
  rect('bar', { x: 240, y: 165, keyframes: kf.map((k) => ({ ...k, y: k.y + 30 })) }),
]);

// The largest difference in any channel between two PNGs, decoded in a page.
async function maxChannelDiff(a, b) {
  const browser = await launchBrowser({ quiet: true });
  try {
    const page = await browser.newPage();
    return await page.evaluate(async (urls) => {
      const pixels = async (url) => {
        const img = new Image(); img.src = url; await img.decode();
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, c.width, c.height).data;
      };
      const [x, y] = await Promise.all(urls.map(pixels));
      return x.reduce((m, v, i) => Math.max(m, Math.abs(v - y[i])), 0);
    }, [a, b].map((png) => `data:image/png;base64,${png.toString('base64')}`));
  } finally { await browser.close(); }
}

test('nested spec renders pixel-identical to its hand-flattened equivalent at 0.5 s and 1.5 s', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  for (const sec of [0.5, 1.5]) {
    const a = await framed(nested(), sec);
    const b = await framed(flat(), sec);
    assert.ok(a.equals(b), `the grouped and the flat frame differ at ${sec} s`);
  }
  assert.ok(!(await framed(nested(), 0.5)).equals(await framed(nested(), 1.5)), 'the group moves between the two frames');
});

test('a group fade matches fading each child to within one level per channel (the group is composited as one layer)', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const fade = [{ t: 0, opacity: 0, x: 240, y: 135 }, { t: 1, opacity: 1, x: 240, y: 135 }];
  const grouped = await framed(nested(fade), 0.5);
  const handmade = await framed(flat(fade), 0.5);
  assert.ok((await maxChannelDiff(grouped, handmade)) <= 1);
  assert.ok((await maxChannelDiff(grouped, await framed(nested(fade), 0))) > 20, 'the fade is visible: half opacity differs from nothing');
});

test('every node carries data-path; a group is a zero-size node holding its children\'s nodes', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const found = await probed(spec([text('a'), group('g', [text('b'), group('h', [text('c')])]), text('d')]), () => [...document.querySelectorAll('#stage .el')].map((n) => ({
    id: n.dataset.id, path: n.dataset.path, width: n.style.width, parent: n.parentElement.dataset.id ?? 'scene',
  })));
  assert.deepEqual(found.map((n) => [n.id, n.path, n.parent]), [
    ['a', 'scenes[0].elements[0]', 'scene'],
    ['g', 'scenes[0].elements[1]', 'scene'],
    ['b', 'scenes[0].elements[1].children[0]', 'g'],
    ['h', 'scenes[0].elements[1].children[1]', 'g'],
    ['c', 'scenes[0].elements[1].children[1].children[0]', 'h'],
    ['d', 'scenes[0].elements[2]', 'scene'],
  ]);
  const size = await probed(spec([group('g', [text('b')])]), () => {
    const r = document.querySelector('#stage .el.group').getBoundingClientRect();
    return [r.width, r.height];
  });
  assert.deepEqual(size, [0, 0]);
});

test('a group scales and rotates its children about its own centre', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  // The child sits 50 px right of the group centre: scaled to 100, then turned 90 degrees clockwise, it lands 100 px below it.
  const motion = spec([group('g', [rect('dot', { x: 50, y: 0, width: 20, height: 20 })], { rotate: 90, scale: 2 })]);
  const centre = await probed(motion, () => {
    const stage = document.getElementById('stage').getBoundingClientRect();
    const r = document.querySelector('.el[data-id="dot"]').getBoundingClientRect();
    const k = 480 / stage.width;
    return { x: ((r.left + r.right) / 2 - stage.left) * k, y: ((r.top + r.bottom) / 2 - stage.top) * k, width: (r.right - r.left) * k };
  });
  near(centre.x, 240, 0.5);
  near(centre.y, 235, 0.5);
  near(centre.width, 40, 0.5); // a 20 px square at scale 2
});

test('group-card example renders byte-identical twice', async (t) => {
  if (!(await requireRender(t))) return;
  await assertRendersIdentically(t, EXAMPLE, ['--fps', '10', '--size', '320x180']);
});

// ---- check.mjs judges children --------------------------------------------------------------------

function specFile(scenes, extra = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'motion-group-'));
  const file = path.join(dir, 'motion.json');
  writeFileSync(file, JSON.stringify({ size: [1920, 1080], fps: 30, ...extra, scenes }));
  return file;
}
const oneScene = (elements, extra) => specFile([{ id: 's', duration: 2, elements }], extra);
const check = (file, args = []) => spawnSync(process.execPath, [CHECK, file, ...args], { encoding: 'utf8' });
const lines = (stdout) => stdout.trim().split('\n');
const big = (id, extra = {}) => text(id, { fontSize: 64, ...extra });

test('check.mjs judges a child: a child text held outside the safe area is a problem at its nested path', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const file = oneScene([{ ...group('card', [big('fine'), big('edge', { y: -500 })]), x: 960, y: 540 }]);
  const r = check(file);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.deepEqual(lines(r.stdout), ['scenes[0].elements[0].children[1]: text "edge" leaves the safe area (top) at 0.10s', 'check: 1 problem']);
  assert.equal(r.stderr, '');
});

test('check.mjs: a child is in motion while its group moves, so a slide-in group is not flagged on the way', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  // The child has no keyframes of its own. At the 0.1 s first look the group is mid-slide with the child straddling the left edge.
  const slide = { ...group('card', [big('hello')]), x: 960, y: 540, keyframes: [{ t: 0, x: -700 }, { t: 0.6, x: 960, ease: 'outCubic' }] };
  const file = oneScene([big('anchor', { x: 960, y: 900 }), slide]);
  const r = check(file);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.stderr, '');
});

test('check.mjs: overlapping texts are reported at the later one\'s nested path, across a group boundary', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const file = oneScene([big('under', { x: 960, y: 540 }), { ...group('card', [big('over')]), x: 960, y: 540 }]);
  const r = check(file);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.deepEqual(lines(r.stdout), ['scenes[0].elements[1].children[0]: text "over" overlaps text "under" at 0.10s', 'check: 1 problem']);
});

test('check.mjs: a group that starts invisible is named as the cause of a blank first frame, and one that ends invisible empties its scene', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const hidden = { ...group('card', [big('hello')]), x: 960, y: 540, keyframes: [{ t: 0, opacity: 0 }, { t: 0.5, opacity: 1 }] };
  const first = check(oneScene([hidden]));
  assert.equal(first.status, 0, first.stdout + first.stderr);
  assert.match(first.stderr, /scene "s" shows nothing at 0\.00s: .*"card" has an opacity 0 first keyframe/);
  const leaving = { ...group('card', [big('hello')]), x: 960, y: 540, keyframes: [{ t: 0, opacity: 1 }, { t: 1, opacity: 1 }, { t: 1.5, opacity: 0 }] };
  const last = check(oneScene([leaving]));
  assert.equal(last.status, 1, last.stdout + last.stderr);
  assert.match(last.stdout, /^scenes\[0\]: scene "s" ends with nothing on screen/);
});

test('check.mjs: a crossfade names the overlapping child at its nested path', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const scene = (id, label) => ({ id, duration: 2, elements: [{ ...group(`${id}-card`, [big(label)]), x: 960, y: 540 }] });
  const r = check(specFile([scene('one', 'a'), { ...scene('two', 'b'), transition: 'crossfade' }]));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stderr, /warning: scenes\[1\]\.elements\[0\]\.children\[0\]: text "b" overlaps text "a" of the outgoing scene "one" during the crossfade/);
});

// ---- the server serves an image inside a group -----------------------------------------------------

test('/assets serves an image nested in a group; an unreferenced file is still 404', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'group-srv-'));
  writeFileSync(path.join(dir, 'pic.png'), 'public');
  writeFileSync(path.join(dir, 'other.png'), 'unreferenced');
  const specPath = path.join(dir, 'm.json');
  writeFileSync(specPath, JSON.stringify(spec([group('g', [group('h', [{ id: 'im', type: 'image', src: 'pic.png', x: 0, y: 0, width: 4, height: 4 }])])])));
  const srv = await startServer({ specPath, mode: 'preview' });
  try {
    const served = await fetch(new URL('/assets/pic.png', srv.url));
    assert.equal(served.status, 200);
    assert.equal(await served.text(), 'public');
    assert.equal((await fetch(new URL('/assets/other.png', srv.url))).status, 404);
  } finally { await srv.close(); }
});
