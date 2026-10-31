import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireRender, BROWSER_ONLY } from './helpers/render.mjs';
import { launchBrowser, guardNetwork } from '../scripts/lib/browser.mjs';
import { startServer } from '../scripts/lib/server.mjs';

const FIRST_MARK = 'Revenue Q1 $32.0M';
// Every element-opacity shape: a ramp that ends at 1 (and later at 0 for the exit), two ramps at different times, a ramp
// inside a crossfade window, and a group whose own opacity ramps over children that ramp too.
const SPEC = {
  size: [320, 180], fps: 30, scenes: [
    { id: 'a', duration: 2.4, elements: [
      { id: 'one', type: 'text', text: FIRST_MARK, x: 160, y: 50, fontSize: 22, fontWeight: 600, keyframes: [{ t: 0.2, opacity: 0 }, { t: 0.6, opacity: 1 }, { t: 1.8, opacity: 1 }, { t: 2.2, opacity: 0.4 }] },
      { id: 'two', type: 'text', text: 'Second line of text', x: 160, y: 90, fontSize: 20, keyframes: [{ t: 0.8, opacity: 0 }, { t: 1.2, opacity: 1 }] },
      { id: 'ctr', type: 'counter', from: 0, to: 18, prefix: '+', suffix: '%', x: 160, y: 130, fontSize: 30, fontWeight: 700, keyframes: [{ t: 0.3, opacity: 0, value: 0 }, { t: 0.7, opacity: 1 }, { t: 1.4, value: 18 }] },
    ] },
    { id: 'b', duration: 1.5, transition: 'crossfade', elements: [
      { id: 'three', type: 'text', text: 'Next scene heading', x: 160, y: 60, fontSize: 22, keyframes: [{ t: 0.2, opacity: 0 }, { t: 0.7, opacity: 1 }] },
      { id: 'grp', type: 'group', x: 160, y: 120, keyframes: [{ t: 0.4, opacity: 0 }, { t: 0.9, opacity: 1 }],
        children: [{ id: 'kid', type: 'text', text: 'Inside a group', x: 0, y: 0, fontSize: 20, keyframes: [{ t: 0.4, opacity: 0.2 }, { t: 0.8, opacity: 1 }] }] },
    ] },
  ],
};

// Kinetic captions across a hard cut, a typing line with its caret, and a fade in the first scene: the things that live on
// the stage rather than in an element's own node. A node renewed only by its own opacity ramp must leave them as they were.
const CAPTIONS_SRT = '1\n00:00:00,000 --> 00:00:01,600\nCaptions come from a plain SRT file.\n\n2\n00:00:01,800 --> 00:00:03,300\nEach group shows two to six words.\n';
const SPEC_STAGE = {
  size: [320, 180], fps: 30, captions: [{ src: 'c.srt', style: 'kinetic' }], scenes: [
    { id: 'a', duration: 1.8, elements: [
      { id: 'h', type: 'text', text: FIRST_MARK, x: 160, y: 50, fontSize: 22, fontWeight: 600, keyframes: [{ t: 0.2, opacity: 0 }, { t: 0.6, opacity: 1 }] },
      { id: 'ty', type: 'text', text: 'Typing a line, one char at a time', x: 160, y: 100, fontSize: 16, typing: true },
    ] },
    { id: 'b', duration: 1.6, elements: [{ id: 'u', type: 'text', text: FIRST_MARK, x: 160, y: 50, fontSize: 22, fontWeight: 600 }] },
  ],
};

// 1080p at 30 fps, where a settling move is smallest: kinetic captions (pops) over a `slide` scene transition, a headline
// scaling up, a line rotating level and an eased fade-and-rise. Checked in a window around the slide (frame 105 starts it).
const SPEC_1080 = {
  size: [1920, 1080], fps: 30, captions: [{ src: 'c.srt', style: 'kinetic' }], scenes: [
    { id: 'intro', duration: 3.5, elements: [
      { id: 'kicker', type: 'text', text: 'Release notes', x: 960, y: 300, fontSize: 48, fontWeight: 500, color: 'text2', keyframes: [{ t: 0, opacity: 0, y: 320 }, { t: 0.8, opacity: 1, y: 300, ease: 'enter' }] },
      { id: 'headline', type: 'text', text: 'Captions, built in', x: 960, y: 460, fontSize: 120, fontWeight: 700, keyframes: [{ t: 0.2, scale: 0.9 }, { t: 1.4, scale: 1, ease: 'outCubic' }] },
    ] },
    { id: 'styles', duration: 3.5, transition: { type: 'slide', direction: 'up' }, elements: [
      { id: 'count', type: 'counter', from: 0, to: 6, suffix: ' styles', x: 960, y: 380, fontSize: 140, fontWeight: 700 },
      { id: 'list', type: 'text', text: 'plain, pill, karaoke, kinetic, boxed, typewriter', x: 960, y: 600, fontSize: 44, color: 'text2', keyframes: [{ t: 0.3, rotate: -3, x: 940 }, { t: 1.6, rotate: 0, x: 960, ease: 'outCubic' }] },
    ] },
  ],
};

// Moves that settle, from the committed examples (the shapes that failed): launch-title's headline eases onto its place
// (y 470.728, 470.144, 470.009, then 470: Chromium does not redraw a step that small, so the frame kept the old position),
// and camera-push-in's zoom moves the whole stage in small steps. First frames only, enough to cover both.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MOTION_FRAMES = 16;
const LAUNCH_TITLE = path.join(root, 'references/examples/launch-title.json');
const CAMERA_PUSH_IN = path.join(root, 'references/examples/camera-push-in.json');
const TRANSITIONS = path.join(root, 'references/examples/transitions.json');

// `spec`: a spec object (written to a temp folder with the captions file beside it) or the path of a spec file.
// Options: `fps` (10), `viewport` ([320, 180]), `mode` ('render'), and the frames compared: `from`..`to` (all).
async function withPages(spec, fn, { fps = 10, viewport = [320, 180], mode = 'render', from = 0, to = Infinity } = {}) {
  const dir = typeof spec === 'string' ? null : mkdtempSync(path.join(tmpdir(), 'so-'));
  const specPath = dir ? path.join(dir, 'm.json') : spec;
  if (dir) {
    writeFileSync(specPath, JSON.stringify(spec));
    writeFileSync(path.join(dir, 'c.srt'), CAPTIONS_SRT);
  }
  const server = await startServer({ specPath, mode });
  const browser = await launchBrowser({ quiet: true });
  const open = async () => {
    const page = await browser.newPage({ viewport: { width: viewport[0], height: viewport[1] }, deviceScaleFactor: 1 });
    await guardNetwork(page, new URL(server.url).origin, () => {});
    await page.goto(server.url);
    await page.waitForFunction(() => window.__motion);
    await page.evaluate(() => window.__motion.ready);
    return page;
  };
  const seek = (page, i) => page.evaluate((s) => window.__motion.seek(s), i / fps);
  const shot = async (page, i) => {
    await seek(page, i);
    return page.screenshot({ type: 'png' });
  };
  try {
    const probe = await open();
    const total = Math.round((await probe.evaluate(() => window.__motion.duration)) * fps);
    await probe.close();
    return await fn({ open, seek, shot, from, to: Math.min(total, to) });
  } finally {
    await browser.close();
    await server.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

// Element opacity ramps, settling moves and camera moves leave memory in Chromium (renderer.mjs renewNodes): without the
// renewal a frame reached after a walk differs from the same frame reached cold, by one level on glyph edges or by a
// sub-pixel position.
const CASES = [
  ['element fades (a ramp that ends at 1, two at different times, one in a crossfade, one in a group)', SPEC, {}],
  ['stage-level captions, typing and a fade across a hard cut', SPEC_STAGE, {}],
  ['a headline easing onto its place (launch-title)', LAUNCH_TITLE, { to: MOTION_FRAMES }],
  ['a camera push-in (camera-push-in)', CAMERA_PUSH_IN, { to: MOTION_FRAMES }],
  ['push and slide scene transitions (transitions.json, 1.2 s to 4.5 s)', TRANSITIONS, { from: 10, to: 46, coldStep: 3 }],
  ['kinetic captions over a slide transition, 1080p at 30 fps (frames 98-122)', SPEC_1080, { fps: 30, viewport: [1920, 1080], from: 98, to: 122, coldStep: 3 }],
];
for (const [name, spec, { coldStep = 1, ...options }] of CASES) {
  test(`a frame is the same bytes whichever frames were painted before it, with ${name}: forward walk, backward walk and a fresh page at each frame agree`, async (t) => {
    if (!await requireRender(t, BROWSER_ONLY)) return;
    await withPages(spec, async ({ open, shot, from, to }) => {
      const forward = await open();
      const walk = [];
      for (let i = 0; i < to; i++) walk.push(await shot(forward, i));
      await forward.close();
      const backward = await open();
      const back = [];
      for (let i = to - 1; i >= from; i--) back[i] = await shot(backward, i);
      const differing = { backward: [], cold: [] };
      for (let i = from; i < to; i++) {
        if (!back[i].equals(walk[i])) differing.backward.push(i);
        if ((i - from) % coldStep) continue;
        const cold = await open(); // a fresh page that seeks straight to the frame
        if (!(await shot(cold, i)).equals(walk[i])) differing.cold.push(i);
        await cold.close();
      }
      assert.deepEqual(differing, { backward: [], cold: [] }, 'frames whose bytes depend on the frames painted before them');
    }, options);
  });
}

// The renewal makes frames byte-exact for a render; a preview does not need that, and tearing down and rebuilding the
// layout objects of moving elements (each on its own compositor layer there, a <video> among them) could cost smoothness or
// flash a playing video. So it runs in render mode and fails closed to it: only a page that says "preview" outright skips it.
test('renewal runs in render mode and not in preview mode (a preview must not tear down moving elements)', async (t) => {
  if (!await requireRender(t, BROWSER_ONLY)) return;
  const renewals = async (mode) => withPages(SPEC, async ({ open, seek }) => {
    const page = await open();
    await page.evaluate(() => {
      window.__hidden = 0;
      new MutationObserver((records) => { for (const r of records) if (r.target.classList.contains('el') && /display:\s*none/.test(r.oldValue ?? '')) window.__hidden++; })
        .observe(document.body, { attributes: true, attributeFilter: ['style'], attributeOldValue: true, subtree: true });
    });
    for (let i = 0; i < 12; i++) await seek(page, i); // the first text ramps in over frames 2-6
    await page.evaluate(() => new Promise((r) => { setTimeout(r); })); // let the observer deliver
    return page.evaluate(() => window.__hidden);
  }, { mode });
  assert.ok(await renewals('render') > 0, 'render mode renews moving elements');
  assert.equal(await renewals('preview'), 0, 'preview mode renews nothing');
});
