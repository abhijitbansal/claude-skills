// W3-M02 (PA-26): a build --fragment output mounts inside a host page. fragment.test.mjs pins what is written; this is the
// register's verify ("--fragment mounts in a test page"). Not yet run: it needs the serial browser slot. Seed to show it
// can fail: in scripts/lib/build-run.mjs fragmentOf drop the PAScene.initAll line, and the scene never leaves 'loading'.
// Skips without Chromium or WebGL2, and for no other reason.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from '../scripts/build.mjs';
import { launchBrowser } from './helpers/browser.mjs';
import { consoleProblem, skipUnlessReady } from './helpers/webgl.mjs';
import { PINNED_ENV, tempDir, writeScene } from './helpers/scene-fixtures.mjs';

const SPEC = {
  title: 'Commits per folder',
  world: 'city',
  data: { file: 'rows.json' },
  tour: [{ title: 'W30', focus: ['2026-W30'] }, { title: 'W31', focus: ['2026-W31'] }],
};

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

test('a fragment pasted into a host page mounts: ready, one canvas inside the host, the host page untouched, no console noise', async (t) => {
  if (!browser) return t.skip(skipReason);
  const dir = tempDir(t);
  const built = await build(writeScene(t, SPEC), { fragment: true, env: { ...PINNED_ENV, PA_OUTPUT_DIR: dir } });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  const hostFile = path.join(dir, 'host.html');
  fs.writeFileSync(hostFile, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Host</title></head><body>
<h1 id="host-title">A host page</h1>
${fs.readFileSync(built.out, 'utf8')}
<p id="host-after">after the scene</p>
</body></html>
`);
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  t.after(() => context.close());
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => { const problem = consoleProblem(m); if (problem) problems.push(problem); });
  page.on('pageerror', (e) => problems.push(e.message));
  await page.goto(pathToFileURL(hostFile).href);
  await page.waitForFunction(() => document.querySelector('[data-pa-scene]').dataset.sceneState !== 'loading', null, { timeout: 10000 });
  if (await skipUnlessReady(t, page, assert)) return;
  assert.equal(await page.locator('[data-pa-scene] canvas').count(), 1, 'one canvas inside the host');
  assert.equal(await page.locator('#host-title').textContent(), 'A host page');
  assert.equal(await page.locator('#host-after').textContent(), 'after the scene');
  await page.getByRole('button', { name: 'Tour' }).click();
  assert.equal(await page.getByRole('button', { name: 'Pause' }).count(), 1, 'the tour plays inside the host');
  assert.deepEqual(problems, []);
});
