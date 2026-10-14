// Shared by the story and explore browser suites: open a built page with the
// console watched, wait for the camera to settle, read the viewBox and boxes.
import { launchBrowser, haveBrowser } from './browser.mjs';

let browser;
export async function closeBrowser() { await browser?.close(); browser = undefined; }

export async function skipUnlessBrowser(t) {
  if (await haveBrowser()) return false;
  t.skip('no browser (bundled Chromium or system Chrome)');
  return true;
}

/** Opens `url`; collects every console error and warning and every page error in `problems`. */
export async function openPage(url, { width = 1440, height = 900, colorScheme = 'light', reducedMotion = 'no-preference', hash = '' } = {}) {
  browser ??= await launchBrowser();
  const context = await browser.newContext({ viewport: { width, height }, colorScheme, reducedMotion, acceptDownloads: true });
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(e.message));
  await page.goto(url + hash);
  await page.waitForFunction(() => window.paReady === true, null, { timeout: 15000 });
  return { page, problems, context };
}

export const viewBox = (page) => page.evaluate(() => document.querySelector('#pa-stage svg').getAttribute('viewBox').split(' ').map(Number));

// Waits until the viewBox has held still for QUIET_MS (a glide has finished); polls every frame.
const QUIET_MS = 100;
export async function settle(page) {
  await page.evaluate(() => { delete window.__settle; });
  await page.waitForFunction((quiet) => {
    const now = performance.now();
    const vb = document.querySelector('#pa-stage svg').getAttribute('viewBox');
    const s = (window.__settle ??= { vb, at: now });
    if (s.vb !== vb) { s.vb = vb; s.at = now; }
    return now - s.at >= quiet;
  }, QUIET_MS, { polling: 'raf', timeout: 10000 });
}

/** [x, y, w, h] of the union of the data boxes of `ids`. */
export const boxOf = (page, ids) => page.evaluate((list) => {
  const data = JSON.parse(document.getElementById('pa-data').textContent);
  const bs = list.map((id) => data.boxes[id]);
  const x0 = Math.min(...bs.map((b) => b[0]));
  const y0 = Math.min(...bs.map((b) => b[1]));
  return [x0, y0, Math.max(...bs.map((b) => b[0] + b[2])) - x0, Math.max(...bs.map((b) => b[1] + b[3])) - y0];
}, ids);

/** Whether the viewBox holds `box` with `pad` around it (1 px of rounding allowed). */
export const holds = (vb, box, pad = 48) => vb[0] <= box[0] - pad + 1 && vb[1] <= box[1] - pad + 1 && vb[0] + vb[2] >= box[0] + box[2] + pad - 1 && vb[1] + vb[3] >= box[1] + box[3] + pad - 1;

export const stageCentre = async (page) => {
  const r = await page.locator('#pa-stage').boundingBox();
  return { x: r.x + r.width / 2, y: r.y + 5 };
};
