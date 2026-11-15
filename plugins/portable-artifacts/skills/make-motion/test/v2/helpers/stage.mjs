// Test helper: open a film in the v2 render page and hash frames. Registers no kinds itself; the film names
// kinds the page registers. Returns null (callers t.skip) when no browser is installed, unless PA_REQUIRE_BROWSER=1.
// close() is safe to call twice and always closes the server, even when closing the browser throws.
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, guardNetwork } from '../../../scripts/lib/browser.mjs';
import { canvasSize } from '../../../template/formats.mjs';
import { buildTimeline } from '../../../engine/script/timing.mjs';
import { startV2Server } from '../../../scripts/v2/server.mjs';

const DEFAULT_FPS = 30;
const NO_BROWSER = /^No browser available/;
const DEFAULT_SPEC_DIR = path.dirname(fileURLToPath(import.meta.url));

async function launchOrNull() {
  try {
    return await launchBrowser({ quiet: true });
  } catch (err) {
    if (NO_BROWSER.test(err.message) && process.env.PA_REQUIRE_BROWSER !== '1') return null;
    throw err;
  }
}

/**
 * @param {object} film a film object (see scripts/v2/spec.mjs); fps defaults to 30
 * @returns {Promise<null | { page, info, blocked: string[], errors: string[], hashFrame(i): Promise<string>, close(): Promise<void> }>}
 */
export async function openStage(film, { specDir = DEFAULT_SPEC_DIR } = {}) {
  const browser = await launchOrNull();
  if (browser === null) return null;
  let server;
  let closing;
  const close = () => {
    closing ??= (async () => {
      try {
        await browser.close();
      } finally {
        if (server) await server.close();
      }
    })();
    return closing;
  };
  const blocked = [];
  const errors = [];
  try {
    const timeline = buildTimeline(film, { fps: film.fps ?? DEFAULT_FPS });
    server = await startV2Server({ film, timeline, specDir });
    const [width, height] = canvasSize(film);
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    await guardNetwork(page, new URL(server.url).origin, (url) => blocked.push(url));
    await page.goto(server.url);
    const info = await page.evaluate(() => window.__ready);
    const hashFrame = async (i) => {
      await page.evaluate((frame) => window.__seek(frame), i);
      const png = await page.screenshot({ type: 'png' });
      return createHash('sha256').update(png).digest('hex');
    };
    return { page, info, blocked, errors, hashFrame, close };
  } catch (err) {
    await close();
    throw err;
  }
}
