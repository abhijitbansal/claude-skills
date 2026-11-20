// How each example opens on a laptop (1280x800) and a phone (390x800), at the size and motion setting the
// screenshots use. The page never overflows its viewport and the Fit and zoom buttons are on screen.
// Wider than the phone breakpoint (viewer.html, 720 px) every diagram opens fitted whole: the whole-drawing fit
// (data-fit-scale), every node whole in the stage with the fit's margin, no pan cue, whatever the text size (check.mjs
// still warns when that draws labels under 8 px). On a phone node labels never draw under the reading floor
// (legibility.mjs MIN_LABEL_PX): a diagram that fits whole at the floor opens fitted, every node a margin inside the
// stage and no pan cue; one that does not opens at the floor on its first group (or, when that does not fit, its first
// node): no node is cut by the stage edge, a pan cue shows on each side where nodes lie out of view, and the cues
// reach them.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPage, example, EXAMPLES } from './helpers/browser.mjs';
import { openPage, closeBrowser, skipUnlessBrowser, settle } from './helpers/page.mjs';
import { LABEL_PX, MIN_LABEL_PX } from '../scripts/lib/legibility.mjs';

after(async () => { await closeBrowser(); });

const FIT_GAP = 16; // px: a fitted drawing's nodes stay at least this far inside the stage
const THEMES = fs.readdirSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../shared/themes')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));

const facts = (page) => page.evaluate(() => {
  const r = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom }; };
  const stage = document.getElementById('pa-stage');
  const data = JSON.parse(document.getElementById('pa-data').textContent);
  const firstGroup = Object.keys(data.info).find((id) => data.info[id].kind === 'group') ?? null;
  const shown = (el) => el.checkVisibility() && el.getBoundingClientRect().width > 0;
  return {
    vw: window.innerWidth, vh: window.innerHeight,
    page: { w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight },
    scale: stage.querySelector('svg').getScreenCTM().a,
    fit: Number(stage.getAttribute('data-fit-scale')),
    stage: r(stage),
    nodes: [...document.querySelectorAll('.pa-node')].map((n) => ({ id: n.dataset.id, ...r(n) })),
    group: firstGroup ? { id: firstGroup, ...r(document.querySelector(`.pa-group[data-id="${CSS.escape(firstGroup)}"] > .pa-group-box`)) } : null,
    cues: Object.fromEntries([...document.querySelectorAll('[data-pa-cue]')].map((c) => [c.dataset.paCue, shown(c) ? r(c) : null])),
    zoom: [...document.querySelectorAll('[data-act="zoom-in"],[data-act="fit"]')].map((z) => ({ shown: shown(z), ...r(z) })),
  };
});

const SIDES = {
  left: (n, s) => n.right <= s.left, right: (n, s) => n.left >= s.right, top: (n, s) => n.bottom <= s.top, bottom: (n, s) => n.top >= s.bottom,
};
const fmt = (n) => `${n.id} ${Math.round(n.left)}..${Math.round(n.right)} x ${Math.round(n.top)}..${Math.round(n.bottom)}`;

function assertOpening(f) {
  const s = f.stage;
  assert.ok(f.page.w <= f.vw && f.page.h <= f.vh, `the page fits its viewport (${f.page.w}x${f.page.h})`);
  assert.ok(LABEL_PX * f.scale >= MIN_LABEL_PX - 0.05, `labels draw ${(LABEL_PX * f.scale).toFixed(2)} px (floor ${MIN_LABEL_PX})`);
  assert.ok(f.zoom.length === 2 && f.zoom.every((z) => z.shown && z.left >= 0 && z.right <= f.vw && z.bottom <= f.vh), 'Fit and zoom-in on screen');
  const shownCues = Object.keys(f.cues).filter((k) => f.cues[k]);
  if (LABEL_PX * f.fit >= MIN_LABEL_PX) {
    const near = f.nodes.filter((n) => n.left < s.left + FIT_GAP || n.right > s.right - FIT_GAP || n.top < s.top + FIT_GAP || n.bottom > s.bottom - FIT_GAP).map(fmt);
    assert.deepEqual(near, [], `fitted: every node at least ${FIT_GAP} px inside the stage`);
    assert.deepEqual(shownCues, [], 'fitted: no pan cue');
    return 'fitted';
  }
  const g = FIT_GAP - 1;
  const cut = f.nodes.filter((n) => !(n.left >= s.left + g && n.right <= s.right - g && n.top >= s.top + g && n.bottom <= s.bottom - g) && !Object.values(SIDES).some((out) => out(n, s))).map(fmt);
  assert.deepEqual(cut, [], `at the floor: no node is cut by the stage edge or flush with it (each whole and ${FIT_GAP} px in, or out of view)`);
  for (const [side, out] of Object.entries(SIDES)) {
    const beyond = f.nodes.some((n) => out(n, s));
    assert.equal(Boolean(f.cues[side]), beyond, `the ${side} cue shows exactly when nodes lie ${side} of the view`);
    if (f.cues[side]) {
      const c = f.cues[side];
      assert.ok(c.left >= s.left && c.right <= s.right && c.top >= s.top && c.bottom <= s.bottom, `the ${side} cue sits inside the stage`);
    }
  }
  return 'floored';
}

// Desktop: the whole drawing at its fit scale. The fit keeps FIT_MARGIN diagram units around the drawing, so a node
// sits at least that many units (times the scale) inside the stage.
function assertDesktop(f) {
  const s = f.stage;
  assert.ok(f.page.w <= f.vw && f.page.h <= f.vh, `the page fits its viewport (${f.page.w}x${f.page.h})`);
  assert.ok(f.zoom.length === 2 && f.zoom.every((z) => z.shown && z.left >= 0 && z.right <= f.vw && z.bottom <= f.vh), 'Fit and zoom-in on screen');
  assert.ok(Math.abs(f.scale - f.fit) < 0.002, `opens at the whole-drawing fit (${f.scale.toFixed(3)} vs ${f.fit.toFixed(3)})`);
  const m = FIT_MARGIN_UNITS * f.scale - 1;
  const out = f.nodes.filter((n) => n.left < s.left + m || n.right > s.right - m || n.top < s.top + m || n.bottom > s.bottom - m || n.bottom > f.vh).map(fmt);
  assert.deepEqual(out, [], `fitted whole: every node in the stage with the fit's margin (${m.toFixed(1)} px) and above the fold`);
  assert.deepEqual(Object.keys(f.cues).filter((k) => f.cues[k]), [], 'fitted whole: no pan cue');
}

const FIT_MARGIN_UNITS = 16; // camera.js FIT_MARGIN
const CASES = [
  ...[...EXAMPLES, 'cloud-architecture'].flatMap((name) => [1280, 390].map((width) => ({ name, width }))),
  ...THEMES.flatMap((theme) => ['story', 'cloud-architecture'].map((name) => ({ name, width: 1280, theme }))),
];

for (const { name, width, theme } of CASES) {
  const desktop = width >= 720;
  const how = desktop ? 'fitted whole with a margin and no cue' : 'readable: fitted with a margin, or at the floor with no node cut and a cue on each side with more';
  test(`${name}${theme ? ` (${theme})` : ''} at ${width}x800 opens ${how}`, async (t) => {
    if (await skipUnlessBrowser(t)) return;
    const { page, context } = await openPage(buildPage(example(name), { name: `open-${name}-${theme ?? 'base'}-${width}`, theme }).url, { width, height: 800, reducedMotion: 'reduce' });
    try {
      const f = await facts(page);
      if (desktop) assertDesktop(f);
      else assertOpening(f);
    } finally {
      await context.close();
    }
  });
}

test('cloud-architecture at 390x800: a cue press brings a node from that side into view', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, context } = await openPage(buildPage(example('cloud-architecture'), { name: 'open-cloud-cue' }).url, { width: 390, height: 800, reducedMotion: 'reduce' });
  try {
    const before = await facts(page);
    const side = Object.keys(before.cues).find((k) => before.cues[k]);
    assert.ok(side, 'a cue shows');
    const hidden = before.nodes.filter((n) => SIDES[side](n, before.stage)).map((n) => n.id);
    await page.click(`[data-pa-cue="${side}"]`);
    await settle(page);
    const f = await facts(page);
    const s = f.stage;
    const shown = f.nodes.filter((n) => hidden.includes(n.id) && n.left >= s.left && n.right <= s.right && n.top >= s.top && n.bottom <= s.bottom);
    assert.ok(shown.length > 0, `after one press a node that lay ${side} of the view is whole in view`);
    assert.equal(await page.evaluate(() => document.querySelector('.pa-node.pa-selected, .pa-edge.pa-selected')), null, 'a cue press selects nothing');
  } finally {
    await context.close();
  }
});

test('at 390x800 leaving Play returns to the readable opening view, not the whole drawing', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, context } = await openPage(buildPage(example('story'), { name: 'open-story-exit' }).url, { width: 390, height: 800, reducedMotion: 'reduce' });
  try {
    await page.click('[data-pa-mode="play"]');
    await page.click('[data-pa-mode="explore"]');
    await settle(page);
    const f = await facts(page);
    assert.ok(LABEL_PX * f.scale >= MIN_LABEL_PX - 0.05, `after Explore labels draw ${(LABEL_PX * f.scale).toFixed(2)} px (floor ${MIN_LABEL_PX})`);
  } finally {
    await context.close();
  }
});

test('on a phone the Fit button shows the whole drawing, readable or not, with no cue', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, context } = await openPage(buildPage(example('cloud-architecture'), { name: 'open-cloud-fit' }).url, { width: 390, height: 800, reducedMotion: 'reduce' });
  try {
    await page.click('[data-act="fit"]');
    await settle(page);
    const f = await facts(page);
    assert.ok(Math.abs(f.scale - f.fit) < 0.002, `Fit draws the whole-drawing fit (${f.scale.toFixed(3)} vs ${f.fit.toFixed(3)})`);
    assert.deepEqual(Object.keys(f.cues).filter((k) => f.cues[k]), [], 'and no cue: nothing is out of view');
  } finally {
    await context.close();
  }
});
