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

// The PNG of `motion` at `sec`, as the render loop screenshots it. `files`: name -> text or Buffer, written beside the spec.
export async function framed(motion, sec, files = {}) {
  const { page, done } = await openPage(motion, motion.size, files);
  try {
    await page.evaluate((s) => window.__motion.seek(s), sec);
    return await page.screenshot({ type: 'png' });
  } finally { await done(); }
}

// Draw `motion` on the render page and return what `probe` (run in the page) found. `files`: as for `framed`.
export async function probed(motion, probe, files = {}) {
  const { page, problems, done } = await openPage(motion, undefined, files);
  try {
    const found = await page.evaluate(probe);
    assert.deepEqual(problems, []);
    return found;
  } finally { await done(); }
}

async function openPage(motion, size, files = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'probe-'));
  made.push(dir);
  for (const [name, body] of Object.entries(files)) writeFileSync(path.join(dir, name), body);
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

// Mean luma (0-255) of a PNG, decoded in a browser page.
export async function meanLuma(png) {
  const browser = await launchBrowser({ quiet: true });
  try {
    const page = await browser.newPage();
    return await page.evaluate(async (url) => {
      const img = new Image(); img.src = url; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      return sum / (d.length / 4);
    }, `data:image/png;base64,${png.toString('base64')}`);
  } finally { await browser.close(); }
}

// RGB at each [x, y] of a PNG buffer, decoded in a browser page.
export async function pixelsOf(png, points) {
  const browser = await launchBrowser({ quiet: true });
  try {
    const page = await browser.newPage();
    return await page.evaluate(async ([url, spots]) => {
      const img = new Image();
      img.src = url;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      return spots.map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data].slice(0, 3));
    }, [`data:image/png;base64,${png.toString('base64')}`, points]);
  } finally { await browser.close(); }
}
