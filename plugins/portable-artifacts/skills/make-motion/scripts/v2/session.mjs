// One film open in the render page: the loopback server, a browser and the page, with every piece released by close()
// (safe to call twice, and run even when closing the browser throws). The stages that need the page (review, sheets,
// render) share one session so the browser starts once. Starts nothing until asked; throws with the page's own message
// when the film cannot be drawn (an unknown font, an image that will not decode).
import { launchBrowser, guardNetwork } from '../lib/browser.mjs';

/** The one browser of a run that opens several sessions (a batch: openSession(loaded, { browser })); the caller closes it. */
export const launchRunBrowser = (options = { ownSignals: true }) => launchBrowser(options);
import { canvasSize } from '../../template/formats.mjs';

export { canvasSize }; // a film's canvas for scripts/v2 modules that need it outside a session (clips.mjs)
import { startV2Server } from './server.mjs';

// Playwright 1.64 (recorded by .scratch/gate/probe-errors.mjs) reports an Error the page threw as
// "page.evaluate: Error: <message>\n    at ...", and its own trouble as "page.evaluate: Target crashed ",
// "page.evaluate: Target page, context or browser has been closed" or "<call>: Timeout <n>ms exceeded." (named
// "TimeoutError"; the others "Error"). Only the first form, a plain Error the engine raised on purpose, is the film's.
const PAGE_THROWN = /^page\.evaluate: Error: ([^\n]*)/;
// Thrown on purpose by the page but not the film's fault: a WebGL context lost or broken (engine/page/post.mjs), and a
// picture the browser cannot decode (engine/page/stage.mjs), a file problem like a missing picture.
const NOT_THE_FILM = /^(?:post pass: |image ".*" could not be loaded)/;
// Playwright's call prefix ("page.evaluate: ") and an error class name before the message.
const CALL_PREFIX = /^(?:(?:page|frame|browser|browserContext|locator)\.\w+: )?(?:[A-Za-z]*Error: )?/;

/** The message of an Error the page raised on purpose about the film (one it cannot draw: an unknown font, a node it
 *  cannot place), or null for anything else: a crashed or closed page, a timeout, a lost WebGL context, an undecodable
 *  picture, an error the page did not mean to raise, or an error from outside the page. Those are the machine's. */
export function pageErrorMessage(err) {
  const message = PAGE_THROWN.exec(String(err?.message ?? ''))?.[1] ?? null;
  return message === null || NOT_THE_FILM.test(message) ? null : message;
}

/** The first line of an error with Playwright's call prefix and the error class taken off, as a report states it. */
export const machineMessage = (err) => String(err?.message ?? err).split('\n')[0].replace(CALL_PREFIX, '');

/**
 * @param {{ film: object, timeline: object, specDir: string }} loaded what loadFilm returns
 * @param {{ initScript?: string, browser?: import('playwright').Browser }} [options] initScript: JavaScript that runs in
 *   the page before its own code (tests use it to take WebGL2 away and exercise the 2D post pass); browser: one to open
 *   the page in (left open on close), instead of launching one
 * @returns {Promise<{ page: import('playwright').Page, info: { frameCount: number, fps: number, size: [number, number], post: 'webgl2' | '2d' },
 *   film: object, timeline: object, errors: string[], blocked: string[], close(): Promise<void> }>}
 */
export async function openSession({ film, timeline, specDir, prepared, clips = [] }, { initScript, browser: shared } = {}) {
  let browser = null;
  let context = null;
  let server = null;
  let closing = null;
  // A shared browser (a batch renders every row in one) is left open: only this session's context closes.
  const close = () => {
    closing ??= (async () => {
      try {
        if (shared) await context?.close();
        else if (browser) await browser.close();
      } finally {
        if (server) await server.close();
      }
    })();
    return closing;
  };
  const errors = [];
  const blocked = [];
  try {
    // clips: the film's decoded video clips (scripts/v2/clips.mjs prepareClips), served by index
    server = await startV2Server({ film, timeline, specDir, prepared, clips, onError: (err) => errors.push(err.message) });
    browser = shared ?? await launchBrowser({ ownSignals: true });
    const [width, height] = canvasSize(film);
    context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
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
