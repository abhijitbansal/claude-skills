#!/usr/bin/env node
// node scripts/check.mjs <page.html> [--json]
// Opens a built page at 1280 and 390 px and fails on console errors or warnings, a page that scrolls
// sideways, elements wider than the page (outside a scrolling region), a deck that cannot reach its last
// slide with the arrow keys or whose counter disagrees, and a diagram Present overlay that will not open
// or will not close on Esc.
// exit 0 ok or skipped (no browser), 1 problems, 2 usage/IO
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchBrowser, BrowserUnavailable, SKIP_HINT } from './lib/browser.mjs';
import { UsageError, parseCli, exitUsage } from '../shared/cli.mjs';

const USAGE = 'node scripts/check.mjs <page.html> [--json]';
const OPTIONS = { json: { type: 'boolean' } };
const VIEWPORTS = [{ width: 1280, height: 900 }, { width: 390, height: 780 }];
const READY_MS = 5000;
const ACTION_MS = 5000; // default timeout for every page action and navigation
const SETTLE_MS = 2000; // a state change the runtime makes at once (slide, overlay)
const WATCHDOG_MS = 60000; // wall-clock cap for the whole check
const OVERFLOW_TOLERANCE_PX = 1;
const MAX_WIDE_ELEMENTS = 3;
const MAX_OVERLAYS = 5;
const TIMED_OUT = Symbol('timed out');
const firstLine = (e) => String(e?.message ?? e).split('\n')[0];

// Runs in the page. Elements whose right edge is past the page, outside any scrolling or clipping ancestor
// (a table wrapper, a code block, a diagram slot scrolls on its own and is by design).
const wideElements = ({ tol, max }) => {
  const limit = window.innerWidth + tol;
  const found = [];
  const describe = (el) => (el.id ? `#${el.id}` : `<${el.tagName.toLowerCase()}${el.classList.length ? `.${el.classList[0]}` : ''}>`);
  const contained = (el) => {
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const x = getComputedStyle(a).overflowX;
      if (x === 'auto' || x === 'scroll' || x === 'hidden' || x === 'clip') return true;
    }
    return false;
  };
  for (const el of document.body.querySelectorAll('*')) {
    if (found.length >= max) break;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.right <= limit || el.closest('[hidden], [inert], dialog:not([open])')) continue;
    if (getComputedStyle(el).position === 'fixed' || contained(el)) continue;
    found.push({ what: describe(el), width: Math.round(r.width) });
  }
  return found;
};

const pageFits = () => ({ scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth });

const deckState = () => {
  const deck = document.querySelector('[data-deck]');
  if (!deck) return null;
  return { total: Number(deck.dataset.total), current: Number(deck.dataset.current) };
};

// Press next to the end; the last slide must be current and the counter must read "N / N".
async function checkDeck(page, label, problems) {
  const { total } = await page.evaluate(deckState);
  for (let i = 1; i < total; i++) await page.keyboard.press('ArrowRight');
  try {
    await page.waitForFunction((n) => Number(document.querySelector('[data-deck]').dataset.current) === n, total, { timeout: SETTLE_MS });
  } catch {
    const { current } = await page.evaluate(deckState);
    problems.push(`${label}: the deck stopped at slide ${current} of ${total} after the arrow keys; expected slide ${total} of ${total}`);
    return total;
  }
  const counter = await page.evaluate(() => document.querySelector('.deck-count').textContent.replace(/\s+/g, ' ').trim());
  if (counter !== `${total} / ${total}`) problems.push(`${label}: on the last slide the counter reads "${counter}", expected "${total} / ${total}"`);
  return total;
}

// Open each inline diagram's Present overlay and close it with Esc. In a deck the figure's slide is made current first.
async function checkOverlays(page, label, problems) {
  const buttons = page.locator('[data-dg-present]:not([hidden])');
  const count = Math.min(await buttons.count(), MAX_OVERLAYS);
  let presented = 0;
  for (let i = 0; i < count; i++) {
    const button = buttons.nth(i);
    const slide = await button.evaluate((el) => el.closest('.slide')?.id ?? null);
    if (slide) {
      await page.evaluate((id) => { window.location.hash = `#${id}`; }, slide);
      await page.waitForFunction((id) => document.getElementById(id) && document.querySelector('[data-deck]').dataset.current === id.replace('slide-', ''), slide, { timeout: SETTLE_MS });
    }
    const dialog = page.locator('[data-dg-dialog]').nth(i);
    await button.click();
    if (!await dialog.evaluate((d) => d.open)) {
      problems.push(`${label}: the Present overlay did not open for diagram ${i + 1}`);
      continue;
    }
    await page.keyboard.press('Escape');
    const closed = await page.waitForFunction((n) => !document.querySelectorAll('[data-dg-dialog]')[n].open, i, { timeout: SETTLE_MS }).then(() => true, () => false);
    if (closed) presented += 1;
    else problems.push(`${label}: the Present overlay did not close on Esc for diagram ${i + 1}`);
  }
  return presented;
}

async function checkViewport(browser, url, viewport) {
  const label = `${viewport.width}px`;
  const problems = [];
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(ACTION_MS);
    page.setDefaultNavigationTimeout(ACTION_MS);
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') problems.push(`${label}: console ${m.type()}: ${m.text()}`);
    });
    page.on('pageerror', (e) => problems.push(`${label}: page error: ${e.message}`));
    page.on('dialog', (d) => { problems.push(`${label}: the page opened a ${d.type()} dialog`); d.dismiss(); });
    await page.goto(url);
    try {
      await page.waitForFunction(() => window.paReady === true, null, { timeout: READY_MS });
    } catch {
      problems.push(`${label}: the page never became ready (window.paReady)`);
      return { problems, slides: 0, presented: 0 };
    }
    const fit = await page.evaluate(pageFits);
    if (fit.scrollW > fit.innerW + OVERFLOW_TOLERANCE_PX) {
      problems.push(`${label}: the page scrolls sideways (${fit.scrollW}px wide in ${fit.innerW}px)`);
    }
    for (const { what, width } of await page.evaluate(wideElements, { tol: OVERFLOW_TOLERANCE_PX, max: MAX_WIDE_ELEMENTS })) {
      problems.push(`${label}: ${what} is ${width}px wide, wider than the ${fit.innerW}px page`);
    }
    const slides = (await page.evaluate(deckState)) ? await checkDeck(page, label, problems) : 0;
    const presented = await checkOverlays(page, label, problems);
    return { problems, slides, presented };
  } catch (e) {
    problems.push(`${label}: check crashed: ${firstLine(e)}`);
    return { problems, slides: 0, presented: 0 };
  } finally {
    await context.close().catch(() => {});
  }
}

/**
 * Check one built page. Returns { status: 'ok' | 'failed' | 'skipped', viewports, slides, presented, problems, reason? }.
 * `timeoutMs` is a wall-clock cap: past it the browser is closed and the result is a failure.
 */
export async function checkPage(file, { env = process.env, timeoutMs = WATCHDOG_MS } = {}) {
  let browser;
  let expired = false;
  const work = (async () => {
    try {
      browser = await launchBrowser(env);
    } catch (e) {
      if (!(e instanceof BrowserUnavailable)) throw e;
      return { status: 'skipped', viewports: 0, slides: 0, presented: 0, problems: [], reason: firstLine(e) };
    }
    try {
      const url = pathToFileURL(file).href;
      const results = [];
      for (const viewport of VIEWPORTS) {
        if (expired) break;
        results.push(await checkViewport(browser, url, viewport));
      }
      const problems = results.flatMap((r) => r.problems);
      return {
        status: problems.length ? 'failed' : 'ok',
        viewports: VIEWPORTS.length,
        slides: Math.max(0, ...results.map((r) => r.slides)),
        presented: Math.max(0, ...results.map((r) => r.presented)),
        problems,
      };
    } finally {
      await browser.close().catch(() => {}); // also when the watchdog already fired and the launch finished late
    }
  })();
  let timer;
  const watchdog = new Promise((resolve) => { timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs); });
  try {
    const result = await Promise.race([work, watchdog]);
    if (result !== TIMED_OUT) return result;
    expired = true;
    work.catch(() => {}); // the closed browser rejects whatever was in flight
    const seconds = Number((timeoutMs / 1000).toFixed(3));
    return { status: 'failed', viewports: 0, slides: 0, presented: 0, problems: [`check: timed out after ${seconds} s`], timedOut: true };
  } finally {
    clearTimeout(timer);
    await browser?.close().catch(() => {});
  }
}

function okLine(result) {
  const parts = [`${result.viewports} viewports`];
  if (result.slides > 0) parts.push(`${result.slides} slides`);
  if (result.presented > 0) parts.push(`${result.presented} diagram ${result.presented === 1 ? 'overlay' : 'overlays'}`);
  return `check: ok (${parts.join(', ')})\n`;
}

function report(result, json) {
  if (json) {
    const errors = result.problems.map((message) => ({ path: '', message }));
    const base = { ok: result.status !== 'failed' };
    const body = result.status === 'skipped' ? { ...base, skipped: true, reason: result.reason, hint: SKIP_HINT }
      : result.status === 'ok' ? { ...base, viewports: result.viewports, slides: result.slides, presented: result.presented }
        : { ...base, errors, problems: result.problems };
    process.stdout.write(`${JSON.stringify(body)}\n`);
  } else if (result.status === 'skipped') process.stdout.write(`check: skipped (no browser: ${result.reason}; run: npx playwright install chromium)\n`);
  else if (result.status === 'ok') process.stdout.write(okLine(result));
  else {
    // The timeout line already reads as a verdict; every other failure gets a tally.
    for (const p of result.problems) process.stdout.write(`${p}\n`);
    if (!result.timedOut) process.stdout.write(`check: ${result.problems.length} problem${result.problems.length === 1 ? '' : 's'}\n`);
  }
}

// PA_CHECK_TIMEOUT_MS shortens the wall-clock cap (tests; slow machines can raise it).
function timeoutFromEnv(env) {
  if (env.PA_CHECK_TIMEOUT_MS === undefined || env.PA_CHECK_TIMEOUT_MS === '') return WATCHDOG_MS;
  const ms = Number(env.PA_CHECK_TIMEOUT_MS);
  if (!Number.isFinite(ms) || ms <= 0) throw new UsageError(`PA_CHECK_TIMEOUT_MS must be a positive number of milliseconds, got ${JSON.stringify(env.PA_CHECK_TIMEOUT_MS)}`);
  return ms;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  let json = argv.includes('--json');
  try {
    const { values, positionals } = parseCli(argv, OPTIONS, USAGE);
    json = values.json === true;
    if (positionals.length !== 1) throw new UsageError(`expected one page file; usage: ${USAGE}`);
    const file = path.resolve(positionals[0]);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new UsageError(`cannot read ${positionals[0]}`);
    const timeoutMs = timeoutFromEnv(process.env);
    const result = await checkPage(file, { timeoutMs });
    report(result, json);
    process.exitCode = result.status === 'failed' ? 1 : 0;
  } catch (e) {
    if (e instanceof UsageError) exitUsage(e, { json });
    else {
      // Anything else is a failed check, never a stack trace.
      report({ status: 'failed', problems: [`check crashed: ${firstLine(e)}`] }, json);
      process.exitCode = 1;
    }
  }
}
