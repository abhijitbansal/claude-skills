// The real shader programs a page links before its first frame is on screen, counted in a browser (render-programs.test.mjs
// counts them without one). Opening a page costs about 50 to 70 ms of shader compile per program on software WebGL and on a
// slow CI runner, so the count is pinned, not the time. The budgets are what each scene linked before the look work: a lifted
// diagram 2, a city and a forest 2, a terrain 2, a galaxy 5 (its rings, stars and links are basic materials). Skips without
// Chromium or WebGL2.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from '../scripts/build.mjs';
import { WORLDS, buildWorldPage, demoRows, launchBrowser } from './helpers/browser.mjs';
import { PINNED_ENV, tempDir } from './helpers/scene-fixtures.mjs';
import { skipUnlessReady } from './helpers/webgl.mjs';

const BUDGET = { city: 2, forest: 2, galaxy: 5, terrain: 2, story: 2 };
const FIX = new URL('./fixtures/', import.meta.url);

let browser = null;
let skipReason = null;
before(async () => {
  try {
    browser = await launchBrowser();
  } catch (err) {
    skipReason = `no browser (${String(err.message).split('\n')[0]})`;
  }
});
after(async () => {
  await browser?.close();
});

// Counts createProgram calls: set before any page script runs, so the first frame's programs are all in.
const COUNT_PROGRAMS = () => {
  window.__programs = 0;
  const proto = window.WebGL2RenderingContext?.prototype;
  if (!proto) return;
  const create = proto.createProgram;
  proto.createProgram = function createProgram(...args) {
    window.__programs += 1;
    return create.apply(this, args);
  };
};

async function programsAtOpen(t, file, colorScheme) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme, reducedMotion: 'reduce' });
  t.after(() => context.close());
  await context.addInitScript(COUNT_PROGRAMS);
  const page = await context.newPage();
  await page.goto(`${pathToFileURL(file).href}?test=1`);
  await page.waitForFunction(() => document.querySelector('[data-pa-scene]').dataset.sceneState !== 'loading', null, { timeout: 15000 });
  if (await skipUnlessReady(t, page, assert)) return null;
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))); // two more frames
  return page.evaluate(() => window.__programs);
}

async function storyPage(t) {
  const dir = tempDir(t, 'scene-programs-');
  fs.copyFileSync(new URL('story.diagram.json', FIX), path.join(dir, 'story.diagram.json'));
  fs.writeFileSync(path.join(dir, 'scene.json'), JSON.stringify({ title: 'Lifted', lift: { diagram: 'story.diagram.json' } }));
  const built = await build(path.join(dir, 'scene.json'), { out: path.join(dir, 'page.html'), env: { ...PINNED_ENV, PA_OUTPUT_DIR: dir } });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  return built.out;
}

for (const name of [...WORLDS, 'story']) {
  for (const scheme of ['light', 'dark']) {
    test(`${name}, ${scheme}: opening the page links at most ${BUDGET[name]} shader programs`, async (t) => {
      if (!browser) return t.skip(skipReason);
      const file = name === 'story' ? await storyPage(t) : (await buildWorldPage(t, name, { rows: demoRows() })).file;
      const programs = await programsAtOpen(t, file, scheme);
      if (programs === null) return;
      assert.ok(programs > 0, 'the count hook saw the context');
      assert.ok(programs <= BUDGET[name], `${programs} programs linked, at most ${BUDGET[name]}`);
    });
  }
}
