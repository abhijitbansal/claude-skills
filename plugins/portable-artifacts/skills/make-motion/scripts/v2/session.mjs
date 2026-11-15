// One film open in the render page: the loopback server, a browser and the page, with every piece released by close()
// (safe to call twice, and run even when closing the browser throws). The stages that need the page (review, sheets,
// render) share one session so the browser starts once. Starts nothing until asked; throws with the page's own message
// when the film cannot be drawn (an unknown font, an image that will not decode).
import { launchBrowser, guardNetwork } from '../lib/browser.mjs';
import { canvasSize } from '../../template/formats.mjs';
import { startV2Server } from './server.mjs';

const PAGE_ERROR = /^page\.evaluate: (?:Error: )?([^\n]*)/;

/** The message of an error the page threw inside `page.evaluate` (a film the page cannot draw, a lost WebGL context), or
 *  null for any other error: those are the machine's trouble, these are the film's or the browser's. */
export function pageErrorMessage(err) {
  return PAGE_ERROR.exec(String(err?.message ?? ''))?.[1] ?? null;
}

/**
 * @param {{ film: object, timeline: object, specDir: string }} loaded what loadFilm returns
 * @param {{ initScript?: string }} [options] initScript: JavaScript that runs in the page before its own code (tests
 *   use it to take WebGL2 away and exercise the 2D post pass)
 * @returns {Promise<{ page: import('playwright').Page, info: { frameCount: number, fps: number, size: [number, number], post: 'webgl2' | '2d' },
 *   film: object, timeline: object, errors: string[], blocked: string[], close(): Promise<void> }>}
 */
export async function openSession({ film, timeline, specDir }, { initScript } = {}) {
  let browser = null;
  let server = null;
  let closing = null;
  const close = () => {
    closing ??= (async () => {
      try {
        if (browser) await browser.close();
      } finally {
        if (server) await server.close();
      }
    })();
    return closing;
  };
  const errors = [];
  const blocked = [];
  try {
    server = await startV2Server({ film, timeline, specDir, onError: (err) => errors.push(err.message) });
    browser = await launchBrowser({ ownSignals: true });
    const [width, height] = canvasSize(film);
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    if (initScript !== undefined) await context.addInitScript(initScript);
    const page = await context.newPage();
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    await guardNetwork(page, new URL(server.url).origin, (url) => blocked.push(url));
    await page.goto(server.url);
    const info = await page.evaluate(() => window.__ready);
    return { page, info, film, timeline, errors, blocked, close };
  } catch (err) {
    await close();
    throw err;
  }
}
