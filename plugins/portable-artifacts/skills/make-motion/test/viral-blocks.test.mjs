// Task 11b: the viral structure blocks (cta-soft, story-beats, listicle, before-after-swipe): their schedules, the
// scene-length and action errors, image or video media, the viral check of their examples, and (parked from Task 11a)
// the largest params of the stacking blocks inside the viral free band above the captions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BLOCKS, BLOCK_NAMES, expandBlocks, paramOfPart } from '../template/blocks/index.mjs';
import { ACTION_LABELS } from '../template/blocks/cta-soft.mjs';
import { freeBand } from '../template/blocks/layout.mjs';
import { safeInsets, captionZone, VIRAL_SAFE_ZONE } from '../template/formats.mjs';
import { flattenElements } from '../template/groups.mjs';
import { validateSpec, withDefaults } from '../scripts/lib/spec.mjs';
import { startServer } from '../scripts/lib/server.mjs';
import { launchBrowser } from '../scripts/lib/browser.mjs';
import { waitReady } from '../scripts/check.mjs';
import { requireRender, renderHash, makeTestVideo, BROWSER_ONLY } from './helpers/render.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = path.join(root, 'scripts/check.mjs');
const EXAMPLES = path.join(root, 'references/examples/blocks');
const PHONE = [1080, 1920];
const NEW_BLOCKS = ['cta-soft', 'story-beats', 'listicle', 'before-after-swipe'];
const EPSILON = 1e-9;

const block = (name, params, extra = {}) => ({ id: 'b', type: 'block', x: 502, y: 644, block: name, params, ...extra });
const scene = (duration, elements, id = 's') => ({ id, duration, elements });
const viral = (scenes, extra = {}) => ({ mode: 'viral', fps: 30, ...extra, scenes });
const errs = (motion, dir = EXAMPLES) => validateSpec(motion, { dir }).errors.map((e) => `${e.path}: ${e.message}`);
const partsOf = (spec) => flattenElements(spec.scenes[0].elements).map(({ el }) => el).filter((el) => el.type !== 'group');
const part = (spec, id) => partsOf(spec).find((el) => el.id === id);
const times = (el, prop) => el.keyframes.filter((kf) => kf[prop] !== undefined).map((kf) => [kf.t, kf[prop]]);

const STORY = BLOCKS['story-beats'].example;

// ---- story-beats: the schedule ----------------------------------------------------------------------------------

test('story-beats at beatSeconds 2.4 in a 12 s scene: the hook is on at 0 and out at 2.1-2.4; the problem in at 2.4 and out at 4.5; the CTA has no exit', () => {
  const spec = expandBlocks(viral([scene(12, [block('story-beats', STORY)])]));
  const hook = part(spec, 'b/hook');
  assert.deepEqual(times(hook, 'opacity'), [[0, 1], [2.1, 1], [2.4, 0]]);
  assert.deepEqual(times(hook, 'scale'), [[0, 1.08], [0.4, 1]]);
  assert.equal(hook.keyframes.find((kf) => kf.t === 0.4).ease, 'enter');
  assert.deepEqual(times(part(spec, 'b/problem'), 'opacity'), [[2.4, 0], [2.7, 1], [4.5, 1], [4.8, 0]]);
  assert.deepEqual(times(part(spec, 'b/reveal'), 'opacity'), [[4.8, 0], [5.1, 1], [6.9, 1], [7.2, 0]]);
  assert.deepEqual(times(part(spec, 'b/proof'), 'opacity'), [[7.2, 0], [7.5, 1], [9.3, 1], [9.6, 0]]);
  const cta = part(spec, 'b/cta');
  assert.deepEqual(times(cta, 'opacity'), [[9.6, 0], [9.9, 1]]);
  assert.equal(cta.keyframes.length, 2, 'the CTA stays: nothing after its fade-in');
  assert.equal(part(spec, 'b/problem').keyframes[1].ease, 'enter');
  assert.equal(part(spec, 'b/problem').keyframes[3].ease, 'exit');
});

test('story-beats proofNumber adds a counter under the proof that counts over the proof beat; without it there is none', () => {
  const spec = expandBlocks(viral([scene(12, [block('story-beats', { ...STORY, proofNumber: { to: 63, prefix: '$', suffix: 'k', decimals: 1 } })])]));
  const counter = part(spec, 'b/proof-number');
  assert.deepEqual([counter.type, counter.from, counter.to, counter.prefix, counter.suffix, counter.decimals], ['counter', 0, 63, '$', 'k', 1]);
  assert.ok(counter.y > part(spec, 'b/proof').y, 'under the proof text');
  assert.deepEqual(times(counter, 'value'), [[7.2, 0], [9, 63]]);
  assert.deepEqual(times(counter, 'opacity'), [[7.2, 0], [7.5, 1], [9.3, 1], [9.6, 0]]);
  const { proofNumber, ...without } = STORY;
  assert.equal(part(expandBlocks(viral([scene(12, [block('story-beats', without)])])), 'b/proof-number'), undefined);
});

test('story-beats at the largest beatSeconds (4 s, a 20 s scene) puts beat i at 4 i', () => {
  const spec = expandBlocks(viral([scene(20, [block('story-beats', { ...STORY, beatSeconds: 4 })])]));
  assert.deepEqual(times(part(spec, 'b/problem'), 'opacity'), [[4, 0], [4.3, 1], [7.7, 1], [8, 0]]);
  assert.deepEqual(times(part(spec, 'b/cta'), 'opacity'), [[16, 0], [16.3, 1]]);
});

// ---- validation texts -------------------------------------------------------------------------------------------

test('a scene shorter than the schedule is an error at params.beatSeconds / params.itemSeconds with the exact text; a scene of exactly that length is valid', () => {
  const at = 'scenes[0].elements[0].params';
  assert.deepEqual(errs(viral([scene(6, [block('story-beats', STORY)])])), [`${at}.beatSeconds: 5 beats × 2.4s need a scene of at least 12s`]);
  assert.deepEqual(errs(viral([scene(12, [block('story-beats', STORY)])])), []);
  assert.deepEqual(errs(viral([scene(12, [block('story-beats', { ...STORY, beatSeconds: 4 })])])), [`${at}.beatSeconds: 5 beats × 4s need a scene of at least 20s`]);
  const list = BLOCKS.listicle.example;
  assert.deepEqual(errs(viral([scene(6, [block('listicle', list)])])), [`${at}.itemSeconds: 3 items × 2s need a scene of at least 6.8s`]);
  assert.deepEqual(errs(viral([scene(6.8, [block('listicle', list)])])), []);
  assert.deepEqual(errs(viral([scene(5, [block('listicle', { ...list, itemSeconds: 1.1 })])])), []);
  assert.deepEqual(errs(viral([scene(4, [block('listicle', { ...list, itemSeconds: 1.1 })])])), [`${at}.itemSeconds: 3 items × 1.1s need a scene of at least 4.1s`]);
});

test('cta-soft: an unknown action is one error at params.actions[0] naming the five; every action has a label and a prototype key is not an action', () => {
  const list = Object.keys(ACTION_LABELS).map((a) => JSON.stringify(a)).join(', ');
  assert.deepEqual(errs(viral([scene(4, [block('cta-soft', { line: 'Liked it?', actions: ['like'] })])])), [`scenes[0].elements[0].params.actions[0]: must be one of ${list}`]);
  assert.deepEqual(Object.keys(ACTION_LABELS), ['save', 'send', 'follow', 'comment', 'part-2']);
  assert.deepEqual(ACTION_LABELS, { save: 'Save for later', send: 'Send this to someone', follow: 'Follow for more', comment: 'Tell me below', 'part-2': 'Part 2 is next' });
  for (const key of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    const motion = viral([scene(4, [block('cta-soft', { line: 'Liked it?', actions: [key] })])]);
    assert.equal(errs(motion).length, 1, key);
    assert.doesNotThrow(() => expandBlocks(motion), key);
  }
  for (const actions of [[], ['save', 'send', 'follow', 'comment']]) {
    assert.equal(errs(viral([scene(4, [block('cta-soft', { line: 'Liked it?', actions })])])).length, 1, JSON.stringify(actions));
  }
  const spec = expandBlocks(viral([scene(4, [block('cta-soft', { line: 'Liked it?', actions: ['send', 'part-2', 'comment'] })])]));
  assert.deepEqual(partsOf(spec).filter((el) => el.id.startsWith('b/label-')).map((el) => el.text), ['Send this to someone', 'Part 2 is next', 'Tell me below']);
  const starts = [1, 2, 3].map((k) => part(spec, `b/pill-${k}`).keyframes[0].t);
  assert.deepEqual(starts, [0.2, 0.4, 0.6], 'one pill every 0.2 s after the line');
});

// ---- before-after-swipe: image or video, the swipe ---------------------------------------------------------------

const SWIPE = BLOCKS['before-after-swipe'].example;
const SWIPE_WIDTH = (spec) => part(spec, 'b/after').width;

test('before-after-swipe with PNG srcs expands to two image elements, with clip.mp4 srcs to two (muted) video elements; the after one slides from off the canvas to the block centre', () => {
  const images = expandBlocks(viral([scene(6, [block('before-after-swipe', SWIPE)])]));
  assert.deepEqual(['before', 'after'].map((p) => part(images, `b/${p}`).type), ['image', 'image']);
  const clip = { before: { src: 'data/clip.mp4', label: 'Before' }, after: { src: 'data/clip.MOV', label: 'After' } };
  const videos = expandBlocks(viral([scene(6, [block('before-after-swipe', clip)])]));
  const [before, after] = ['before', 'after'].map((p) => part(videos, `b/${p}`));
  assert.deepEqual([before.type, after.type, before.src, after.src, before.mute, after.mute], ['video', 'video', 'data/clip.mp4', 'data/clip.MOV', true, true]);
  const slide = part(images, 'b/after').keyframes;
  assert.deepEqual([slide[0].t, slide[1].t, slide[1].x, slide[1].ease], [2.4, 3, 0, 'move'], 'from 0.4 of a 6 s scene, over 0.6 s, to the block centre');
  assert.ok(502 + slide[0].x - SWIPE_WIDTH(images) / 2 >= PHONE[0], 'waiting wholly right of the canvas');
  const line = part(images, 'b/swipe-line');
  assert.deepEqual([line.rotate, line.stroke, line.strokeWidth], [90, 'accent', 6]);
  assert.deepEqual(line.keyframes.map((kf) => kf.t), slide.map((kf) => kf.t), 'the line leads the after frame');
  assert.equal(line.keyframes[1].x, -SWIPE_WIDTH(images) / 2 + 3, "just inside the after frame's left edge");
  const custom = expandBlocks(viral([scene(6, [block('before-after-swipe', { ...SWIPE, swipeAt: 1 })])]));
  assert.equal(part(custom, 'b/after').keyframes[0].t, 1);
});

test('before-after-swipe: a video src validates and its files are served (needs ffprobe); a missing or escaping src is named at params.before.src', async (t) => {
  const tools = await requireRender(t, { need: ['ffmpeg', 'ffprobe'] });
  if (!tools) return;
  const dir = mkdtempSync(path.join(tmpdir(), 'swipe-'));
  makeTestVideo(tools.ffmpeg, path.join(dir, 'a.mp4'));
  makeTestVideo(tools.ffmpeg, path.join(dir, 'b.mp4'), { source: 'smptebars' });
  writeFileSync(path.join(dir, 'other.mp4'), 'unreferenced');
  const clips = { before: { src: 'a.mp4', label: 'Before' }, after: { src: 'b.mp4', label: 'After' } };
  assert.deepEqual(errs(viral([scene(6, [block('before-after-swipe', clips)])]), dir), []);
  assert.deepEqual(errs(viral([scene(6, [block('before-after-swipe', { ...clips, before: { src: 'missing.mp4', label: 'x' } })])]), dir), ['scenes[0].elements[0].params.before.src: file not found: missing.mp4']);
  assert.deepEqual(errs(viral([scene(6, [block('before-after-swipe', { ...clips, after: { src: '../x.png', label: 'x' } })])]), dir), ['scenes[0].elements[0].params.after.src: must stay inside the spec folder']);
  const specPath = path.join(dir, 'm.json');
  writeFileSync(specPath, JSON.stringify(viral([scene(6, [block('before-after-swipe', clips)])])));
  const srv = await startServer({ specPath, mode: 'preview' });
  try {
    assert.equal((await fetch(new URL('/assets/a.mp4', srv.url))).status, 200);
    assert.equal((await fetch(new URL('/assets/b.mp4', srv.url))).status, 200);
    assert.equal((await fetch(new URL('/assets/other.mp4', srv.url))).status, 404);
  } finally { await srv.close(); }
});

test('before-after-swipe with two clips renders, byte-identical twice (needs a browser, ffmpeg and ffprobe)', async (t) => {
  const tools = await requireRender(t, { need: ['browser', 'ffmpeg', 'ffprobe'] });
  if (!tools) return;
  const dir = mkdtempSync(path.join(tmpdir(), 'swipe-render-'));
  makeTestVideo(tools.ffmpeg, path.join(dir, 'a.mp4'), { seconds: 3 });
  makeTestVideo(tools.ffmpeg, path.join(dir, 'b.mp4'), { seconds: 3, source: 'smptebars' });
  const specPath = path.join(dir, 'm.json');
  writeFileSync(specPath, JSON.stringify(viral([scene(3, [block('before-after-swipe', { before: { src: 'a.mp4', label: 'Before' }, after: { src: 'b.mp4', label: 'After' } })])])));
  const args = ['--fps', '10', '--size', '180x320'];
  const first = await renderHash(specPath, args);
  assert.equal((await renderHash(specPath, args)).sha256, first.sha256);
});

test('listicle at the validator minimum keeps the rows at 0.8 + i x itemSeconds: 5 items x 1 s in a 5.8 s scene, 2 items x 1 s in 2.8 s', () => {
  const rowStarts = (items, itemSeconds, duration) => {
    const params = { title: 'Five fast ways to win', items: Array.from({ length: items }, (_, i) => `Way ${i + 1}`), itemSeconds };
    const spec = expandBlocks(viral([scene(duration, [block('listicle', params)])]));
    assert.deepEqual(errs(viral([scene(duration, [block('listicle', params)])])), [], `${items} x ${itemSeconds} s in ${duration} s is valid`);
    return Array.from({ length: items }, (_, i) => times(part(spec, `b/row-${i + 1}`), 'opacity'));
  };
  assert.deepEqual(rowStarts(5, 1, 5.8), [0.8, 1.8, 2.8, 3.8, 4.8].map((t) => [[t, 0], [Math.round((t + 0.6) * 10) / 10, 1]]));
  assert.deepEqual(rowStarts(2, 1, 2.8), [0.8, 1.8].map((t) => [[t, 0], [Math.round((t + 0.6) * 10) / 10, 1]]));
});

test('before-after-swipe: swipeAt must leave the 0.6 s swipe and 0.4 s of result (exact texts), the default swipeAt always does, and a valid scene keeps the swipe at 0.6 s', () => {
  const at = 'scenes[0].elements[0].params.swipeAt';
  assert.deepEqual(errs(viral([scene(6, [block('before-after-swipe', { ...SWIPE, swipeAt: 5.5 })])])), [`${at}: swipeAt 5.5s + the 0.6s swipe and 0.4s to show the result need a scene of at least 6.5s; use a swipeAt of at most 5s or a longer scene`]);
  assert.deepEqual(errs(viral([scene(4, [block('before-after-swipe', { ...SWIPE, swipeAt: 50 })])])), [`${at}: swipeAt 50s + the 0.6s swipe and 0.4s to show the result need a scene of at least 51s; use a swipeAt of at most 3s or a longer scene`]);
  assert.deepEqual(errs(viral([scene(0.5, [block('before-after-swipe', SWIPE)])])), [`${at}: the 0.6s swipe and 0.4s to show the result need a scene of at least 1s`]);
  assert.deepEqual(errs(viral([scene(6, [block('before-after-swipe', { ...SWIPE, swipeAt: 5 })])])), []);
  // swipeAt 5 in a 6 s scene is exactly the limit: valid, the swipe takes its full 0.6 s
  const slide = part(expandBlocks(viral([scene(6, [block('before-after-swipe', { ...SWIPE, swipeAt: 5 })])])), 'b/after').keyframes;
  assert.deepEqual(slide.map((kf) => kf.t), [5, 5.6]);
  for (const duration of [1, 1.5, 2, 2.5, 6]) {
    const motion = viral([scene(duration, [block('before-after-swipe', SWIPE)])]);
    assert.deepEqual(errs(motion), [], `the default swipeAt is valid in ${duration} s`);
    const [from, to] = part(expandBlocks(motion), 'b/after').keyframes.map((kf) => kf.t);
    assert.ok(Math.abs(to - from - 0.6) < 1e-9 && to + 0.4 <= duration + 1e-9, `${duration} s: swipe ${from}..${to}`);
  }
  assert.equal(errs(viral([scene(60, [block('before-after-swipe', { ...SWIPE, swipeAt: 59 })])])).length, 1, 'above 58 is a schema error');
  const after = (spec) => times(part(spec, 'b/after-label'), 'opacity');
  assert.deepEqual(after(expandBlocks(viral([scene(6, [block('before-after-swipe', SWIPE)])]))), [[2.4, 0], [3, 1]], 'the after label fades in with the swipe');
});

test('cta-soft: a repeated action is an error; a finding about a pill names the block and part but no param to shorten, a finding about the line names params.line', () => {
  const dup = errs(viral([scene(4, [block('cta-soft', { line: 'Liked it?', actions: ['save', 'save'] })])]));
  assert.equal(dup.length, 1);
  assert.match(dup[0], /^scenes\[0\]\.elements\[0\]\.params\.actions: must NOT have duplicate items/);
  assert.equal(paramOfPart('cta-soft', 'label-1'), null);
  assert.equal(paramOfPart('cta-soft', 'line'), 'line');
});

// ---- the viral examples -------------------------------------------------------------------------------------------

test('every new block opens a viral spec with a hook: the examples validate, show a hook at frame 0 and produce no viral warning', async (t) => {
  for (const name of NEW_BLOCKS) {
    const file = path.join(EXAMPLES, `${name}.json`);
    const spec = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(spec.mode, 'viral', name);
    assert.deepEqual(errs(spec), [], name);
  }
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  for (const name of NEW_BLOCKS) {
    const r = spawnSync(process.execPath, [CHECK, path.join(EXAMPLES, `${name}.json`)], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${name}: ${r.stdout}${r.stderr}`);
    assert.equal(r.stderr, '', `${name}: no warning of any kind, viral included`);
  }
});

test('the story-beats hook and the listicle title are on at frame 0 in a viral spec, hook entrance included', () => {
  const story = withDefaults(viral([scene(12, [block('story-beats', STORY)])])).scenes[0].elements[0].children;
  assert.deepEqual([story[0].id, story[0].keyframes[0].opacity, story[0].keyframes[0].scale], ['b/hook', 1, 1.08]);
  assert.ok(story.filter((el) => el.id !== 'b/hook').every((el) => el.keyframes[0].opacity === 0), 'the later beats start hidden');
  const list = withDefaults(viral([scene(7, [block('listicle', BLOCKS.listicle.example)])])).scenes[0].elements[0].children;
  assert.deepEqual([list[0].id, list[0].keyframes[0].opacity, list[0].keyframes[0].scale], ['b/title', 1, 1.08]);
  assert.ok(list.filter((el) => el.id.startsWith('b/row-') || el.id.startsWith('b/item-')).every((el) => el.keyframes[0].opacity === 0));
  const plain = expandBlocks({ scenes: [scene(7, [block('listicle', BLOCKS.listicle.example)])] }).scenes[0].elements[0].children;
  assert.equal(plain[0].keyframes, undefined, 'outside viral mode the title is just held');
});

test('listicle: the row i comes in at 0.8 + i x itemSeconds over 0.6 s, with a number badge when numbered and none when not', () => {
  const p = { title: 'Three quick ways to win', items: ['One', 'Two', 'Three'], itemSeconds: 2 };
  const spec = expandBlocks(viral([scene(7, [block('listicle', p)])]));
  for (const [i, start] of [0.8, 2.8, 4.8].entries()) {
    for (const kind of ['row', 'badge', 'number', 'item']) assert.deepEqual(times(part(spec, `b/${kind}-${i + 1}`), 'opacity'), [[start, 0], [Math.round((start + 0.6) * 10) / 10, 1]], `${kind}-${i + 1}`);
  }
  assert.deepEqual(['badge-1', 'number-1'].map((id) => part(spec, `b/${id}`).type), ['shape', 'text']);
  assert.equal(part(spec, 'b/number-2').text, '2');
  const plain = expandBlocks(viral([scene(7, [block('listicle', { ...p, numbered: false })])]));
  assert.equal(partsOf(plain).filter((el) => /badge|number/.test(el.id)).length, 0);
});

// ---- parked from Task 11a: the largest params fit the viral free band above the captions -----------------------------

const insets = safeInsets(PHONE, VIRAL_SAFE_ZONE);
const zone = captionZone(PHONE, '9:16', insets);
const text40 = (n, seed) => `${seed} ${'word '.repeat(10)}`.slice(0, n).trimEnd();
const LARGEST = {
  listicle: { title: text40(40, 'Why every single edit goes'), items: Array.from({ length: 5 }, (_, i) => text40(40, `Item ${i + 1} keeps every`)), itemSeconds: 1 },
  'cta-soft': { line: text40(40, 'Liked this long closing line'), actions: ['send', 'follow', 'comment'] },
  // Six rows of two lines at the 40 px floor are the most that fit the 684 px band; 8 rows of 40 characters cannot (8 x 2 x 46 px
  // is 736 px), and check.mjs warns about the one under the top band, naming params.items.
  checklist: { items: Array.from({ length: 6 }, (_, i) => text40(40, `Check ${i + 1} stays inside`)) },
  'story-beats': { hook: text40(48, 'A very long hook text'), problem: text40(80, 'The problem'), reveal: text40(80, 'The reveal'), proof: text40(80, 'The proof'), proofNumber: { to: 999999999, prefix: '$', suffix: 'k', decimals: 4 }, cta: text40(40, 'Follow for the full workflow') },
};
const captioned = (name) => viral([scene(Math.max(6, BLOCKS[name].minDuration?.(LARGEST[name]) ?? 0), [block(name, LARGEST[name], BLOCKS[name].place(PHONE, '9:16', undefined, insets))])], { captions: [{ src: 'c.srt' }] });

test('the largest params of listicle, cta-soft, story-beats and (6 rows of) checklist keep every card and pill inside the viral free band above the lifted caption zone (no browser)', () => {
  for (const name of Object.keys(LARGEST)) {
    const motion = captioned(name);
    const { captions, ...bare } = motion; // c.srt exists only in the page test's folder
    assert.deepEqual(errs(bare), [], name);
    const { x, y } = motion.scenes[0].elements[0];
    const band = freeBand({ size: PHONE, format: '9:16', captions: true, insets });
    assert.ok(band.bottom <= zone.top && band.top >= insets.top, `${name}: the free band ${band.top}..${band.bottom} is inside ${insets.top}..${zone.top}`);
    // withDefaults, not expandBlocks: it writes viral's 9:16 canvas before the blocks lay out.
    const rects = partsOf(withDefaults(motion)).filter((el) => el.type === 'shape' && el.shape === 'rect');
    for (const r of rects) {
      assert.ok(y + r.y - r.height / 2 >= insets.top - 0.5 && y + r.y + r.height / 2 <= zone.top + 0.5, `${name}: ${r.id} spans ${y + r.y - r.height / 2}..${y + r.y + r.height / 2}, outside ${insets.top}..${zone.top}`);
      assert.ok(x + r.x - r.width / 2 >= insets.left - 0.5 && x + r.x + r.width / 2 <= PHONE[0] - insets.right + 0.5, `${name}: ${r.id} crosses a side band`);
    }
  }
});

test('the same largest params, drawn by the page, keep every part (texts included) inside the safe area and above the caption zone', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const browser = await launchBrowser({ quiet: true });
  try {
    for (const name of Object.keys(LARGEST)) {
      const motion = captioned(name);
      const dir = mkdtempSync(path.join(tmpdir(), 'vb-'));
      writeFileSync(path.join(dir, 'c.srt'), '1\n00:00:00,200 --> 00:00:05,800\nCaptions stay on screen\n');
      const file = path.join(dir, 'm.json');
      writeFileSync(file, JSON.stringify(motion));
      const srv = await startServer({ specPath: file, mode: 'render' });
      const page = await browser.newPage({ viewport: { width: PHONE[0], height: PHONE[1] }, deviceScaleFactor: 1 });
      try {
        await page.goto(srv.url);
        await waitReady(page);
        await page.evaluate((s) => window.__motion.seek(s), motion.scenes[0].duration - 0.1); // everything has landed
        const boxes = await page.evaluate(() => {
          const stage = document.getElementById('stage').getBoundingClientRect();
          const k = window.__motion.size[0] / stage.width;
          return [...document.querySelectorAll('#stage .scene .el:not(.group)')].map((n) => {
            const r = n.getBoundingClientRect();
            return { id: n.dataset.id, left: (r.left - stage.left) * k, top: (r.top - stage.top) * k, right: (r.right - stage.left) * k, bottom: (r.bottom - stage.top) * k };
          });
        });
        for (const b of boxes) {
          const where = `${name}: "${b.id}" ${JSON.stringify(b)}`;
          assert.ok(b.left >= insets.left - 0.5 && b.right <= PHONE[0] - insets.right + 0.5, `${where} crosses a side band`);
          assert.ok(b.top >= insets.top - 0.5 && b.bottom <= zone.top + 0.5, `${where} leaves ${insets.top}..${zone.top}`);
        }
      } finally { await page.close(); await srv.close(); }
    }
  } finally { await browser.close(); }
});

test('the registry lists the four new blocks after the original eight, and blocks.mjs show describes their nested params', () => {
  assert.deepEqual(BLOCK_NAMES.slice(8, 12), NEW_BLOCKS);
  const cli = (...args) => spawnSync(process.execPath, [path.join(root, 'scripts/blocks.mjs'), ...args], { encoding: 'utf8' });
  const show = cli('show', 'before-after-swipe');
  assert.equal(show.status, 0, show.stderr);
  assert.match(show.stdout, /^before +object +yes +- +/m);
  assert.match(show.stdout, /^swipeAt +number 0–58 +no +- +/m);
  assert.match(cli('show', 'cta-soft').stdout, /^actions +save\|send\|follow\|comment\|part-2\[1–3\] +yes +- +/m);
  assert.match(cli('show', 'story-beats').stdout, /^beatSeconds +number 1\.5–4 +no +2\.4 +/m);
  assert.match(cli('show', 'listicle').stdout, /^numbered +boolean +no +true +/m);
});
