// Shared by render-page tests (not a test file): draw a spec on the real render page and run a probe in it.
import { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { launchBrowser } from '../scripts/lib/browser.mjs';
import { startServer } from '../scripts/lib/server.mjs';

const made = [];
after(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });

export async function haveBrowser() {
  try { await (await launchBrowser({ quiet: true })).close(); return true; } catch { return false; }
}

// The PNG of `motion` at `sec`, as the render loop screenshots it.
export async function framed(motion, sec) {
  const { page, done } = await openPage(motion, motion.size);
  try {
    await page.evaluate((s) => window.__motion.seek(s), sec);
    return await page.screenshot({ type: 'png' });
  } finally { await done(); }
}

// Draw `motion` on the render page and return what `probe` (run in the page) found.
export async function probed(motion, probe) {
  const { page, problems, done } = await openPage(motion);
  try {
    const found = await page.evaluate(probe);
    assert.deepEqual(problems, []);
    return found;
  } finally { await done(); }
}

async function openPage(motion, size) {
  const dir = mkdtempSync(path.join(tmpdir(), 'probe-'));
  made.push(dir);
  writeFileSync(path.join(dir, 'm.json'), JSON.stringify(motion));
  const srv = await startServer({ specPath: path.join(dir, 'm.json'), mode: 'render' });
  const browser = await launchBrowser({ quiet: true });
  const done = async () => { await browser.close(); await srv.close(); };
  try {
    // A `size` gives the viewport the stage size, as render.mjs does; without it the page is the default window.
    const page = await browser.newPage(size ? { viewport: { width: size[0], height: size[1] }, deviceScaleFactor: 1 } : {});
    const problems = [];
    page.on('pageerror', (e) => problems.push(e.message));
    await page.goto(srv.url);
    await page.waitForFunction(() => window.__motion);
    await page.evaluate(() => window.__motion.ready);
    return { page, problems, done };
  } catch (e) { await done(); throw e; }
}
