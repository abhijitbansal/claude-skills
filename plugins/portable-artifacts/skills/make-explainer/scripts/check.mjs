#!/usr/bin/env node
// node scripts/check.mjs <page.html> [--json]
// Opens a built page at 1280, 390 and 1800 px and fails on console errors or warnings, a page that scrolls
// sideways, elements wider than the page (outside a scrolling region), content clipped sideways inside a
// slide (a slide hides what overflows it, so the page-level checks cannot see that), a deck that cannot
// reach its last slide with the arrow keys or whose counter disagrees, a number-plus-unit token that wraps
// across two lines, a KPI value wider than its tile, a diagram whose viewer did not mount,
// and a Present overlay that cannot be clicked, will not open or will not close on Esc. One probe that
// crashes is reported as such and the rest of the viewport still runs.
// exit 0 ok or skipped (no browser), 1 problems, 2 usage/IO
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchBrowser, BrowserUnavailable } from './lib/browser.mjs';
import { skipHint } from './lib/doctor-hint.mjs';
import { nowrapProblems, overflowProblems } from '../shared/nowrap-probe.mjs';
import { UsageError, parseCli, exitUsage } from '../shared/cli.mjs';

const USAGE = 'node scripts/check.mjs <page.html> [--json]';
const OPTIONS = { json: { type: 'boolean' } };
const VIEWPORTS = [{ width: 1280, height: 900 }, { width: 390, height: 780 }, { width: 1800, height: 1000 }];
const READY_MS = 5000;
const ACTION_MS = 5000; // default timeout for every page action and navigation
const SETTLE_MS = 2000; // a state change the runtime makes at once (slide, overlay)
const CLICK_MS = 1500; // a button that something else covers is not going to uncover itself
const PRESENT_CLICK_MS = 5000; // a button that nothing covers may just be slow (a loaded CI machine); inside the watchdog
const WATCHDOG_MS = 60000; // wall-clock cap for the whole check
const OVERFLOW_TOLERANCE_PX = 1;
const MAX_WIDE_ELEMENTS = 3;
const MAX_CLIPPED = 3;
const MAX_OVERLAYS = 5;
const MAX_NUMBER_PROBLEMS = 3;
const TIMED_OUT = Symbol('timed out');
const firstLine = (e) => String(e?.message ?? e).split('\n')[0];
// Chromium on a GPU machine reports its own GL driver performance hints ("GPU stall due to ReadPixels") as warnings;
// they say nothing about the page, so they are the one warning a check lets through.
const GL_DRIVER_PERFORMANCE_HINT = /^\[\.WebGL-[^\]]*\]GL Driver Message \([^)]*Performance/;
/** True when a console message of this type is a problem with the page: every error, and every warning except a GL driver performance hint. */
export function isConsoleProblem(type, text) {
  if (type === 'error') return true;
  return type === 'warning' && !GL_DRIVER_PERFORMANCE_HINT.test(text);
}
const article = (word) => (/^[aeiou]/i.test(word) ? 'an' : 'a');

// Runs in the page. Two lists of elements that stick out sideways:
// wide: right edge past the page, outside any scrolling or clipping ancestor (a table wrapper, a code block,
//   a diagram slot scrolls on its own and is by design). <body> does not count as such an ancestor: an
//   overflow-x on it hides the overflow instead of containing it.
// clipped: in a deck, right edge past its slide, outside a region that scrolls on its own. The slide itself
//   clips sideways, so the page-level probe takes everything in a slide for contained.
const overflowProbe = ({ tol, max, maxClipped }) => {
  const describe = (el) => (el.id ? `#${el.id}` : `<${el.tagName.toLowerCase()}${el.classList.length ? `.${el.classList[0]}` : ''}>`);
  const scrolls = (el) => ['auto', 'scroll', 'hidden', 'clip'].includes(getComputedStyle(el).overflowX);
  const unseen = (el) => el.closest('[hidden], dialog:not([open])'); // a slide that is not current is inert but laid out
  const containedBelow = (el, top) => {
    for (let a = el.parentElement; a && a !== top; a = a.parentElement) if (scrolls(a)) return true;
    return false;
  };
  const wide = [];
  const limit = window.innerWidth + tol;
  for (const el of document.body.querySelectorAll('*')) {
    if (wide.length >= max) break;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.right <= limit || el.closest('[hidden], [inert], dialog:not([open])')) continue;
    if (getComputedStyle(el).position === 'fixed') continue;
    let contained = false;
    for (let a = el.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
      if (scrolls(a)) { contained = true; break; }
    }
    if (!contained) wide.push({ what: describe(el), width: Math.round(r.width) });
  }
  const clipped = [];
  [...document.querySelectorAll('[data-deck] .slide')].forEach((slide, i) => {
    const edge = slide.getBoundingClientRect().right + tol;
    for (const el of slide.querySelectorAll('*')) {
      if (clipped.length >= maxClipped) return;
      if (el.ownerSVGElement) continue; // an svg is judged as a whole; its parts clip to it
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.right <= edge || unseen(el)) continue;
      if (getComputedStyle(el).position === 'fixed' || containedBelow(el, slide)) continue;
      clipped.push({ slide: i + 1, what: describe(el), width: Math.round(r.width) });
    }
  });
  return { wide, clipped };
};

const pageFits = () => ({ scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth });

const deckState = () => {
  const deck = document.querySelector('[data-deck]');
  if (!deck) return null;
  return { total: Number(deck.dataset.total), current: Number(deck.dataset.current) };
};

// Press next to the end; the last slide must be current and the counter must read "N / N".
async function checkDeck(page, label, problems, tally) {
  const { total } = await page.evaluate(deckState);
  tally.slides = total;
  for (let i = 1; i < total; i++) await page.keyboard.press('ArrowRight');
  try {
    await page.waitForFunction((n) => Number(document.querySelector('[data-deck]').dataset.current) === n, total, { timeout: SETTLE_MS });
  } catch {
    const { current } = await page.evaluate(deckState);
    problems.push(`${label}: the deck stopped at slide ${current} of ${total} after the arrow keys; expected slide ${total} of ${total}`);
    return;
  }
  const counter = await page.evaluate(() => document.querySelector('.deck-count').textContent.replace(/\s+/g, ' ').trim());
  if (counter !== `${total} / ${total}`) problems.push(`${label}: on the last slide the counter reads "${counter}", expected "${total} / ${total}"`);
}

// Numbers stay on one line: no number-plus-unit token ("87%", "1,204 ms") may span two lines, and no KPI
// value may be wider than its tile (nowrap keeps it on one line, so a value that is too long spills instead).
async function checkNumbers(page, label, problems) {
  for (const { text } of (await nowrapProblems(page)).slice(0, MAX_NUMBER_PROBLEMS)) {
    problems.push(`${label}: a number-plus-unit token wraps across lines: "${text}"`);
  }
  for (const { text } of (await overflowProblems(page, '.kpi-value')).slice(0, MAX_NUMBER_PROBLEMS)) {
    problems.push(`${label}: a KPI value overflows its tile: "${text}"`);
  }
}

// Is the centre of this element's box taken by something that is not the element or part of it?
const isCovered = (locator) => locator.evaluate((el) => {
  el.scrollIntoView({ block: 'center', inline: 'center' });
  const r = el.getBoundingClientRect();
  const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return top !== null && top !== el && !el.contains(top);
}).catch(() => false);

// Open each inline diagram's Present overlay and close it with Esc. A figure is judged on its own button and
// dialog. In a deck the figure's slide is made current first.
async function checkOverlays(page, label, problems, tally) {
  const patient = { left: true };
  const figures = page.locator('[data-diagram]');
  const count = Math.min(await figures.count(), MAX_OVERLAYS);
  for (let i = 0; i < count; i++) {
    const n = i + 1;
    const figure = figures.nth(i);
    const button = figure.locator('[data-dg-present]');
    if (await button.count() === 0 || await button.evaluate((el) => el.hidden)) {
      problems.push(`${label}: the diagram ${n} viewer did not mount (its Present button is hidden)`);
      continue;
    }
    const slide = await figure.evaluate((el) => el.closest('.slide')?.id ?? null);
    if (slide) {
      await page.evaluate((id) => { window.location.hash = `#${id}`; }, slide);
      await page.waitForFunction((id) => document.getElementById(id) && document.querySelector('[data-deck]').dataset.current === id.replace('slide-', ''), slide, { timeout: SETTLE_MS });
    }
    const dialog = figure.locator('[data-dg-dialog]');
    // Something else at the button's centre: waiting longer will not help, so that wait is short. Nothing there:
    // the button may only be slow to become actionable, so it gets the longer wait, once per viewport (a page
    // where every button is stuck must still end well inside the watchdog).
    const waitMs = patient.left && !await isCovered(button) ? PRESENT_CLICK_MS : CLICK_MS;
    try {
      await button.click({ timeout: waitMs });
    } catch {
      patient.left = false;
      problems.push(await isCovered(button)
        ? `${label}: the Present button of diagram ${n} is covered by another element`
        : `${label}: the Present button of diagram ${n} did not become clickable within ${waitMs / 1000} s (disabled, hidden or very slow)`);
      continue;
    }
    if (!await dialog.evaluate((d) => d.open)) {
      problems.push(`${label}: the Present overlay did not open for diagram ${n}`);
      continue;
    }
    await page.keyboard.press('Escape');
    const closed = await page.waitForFunction((d) => !d.open, await dialog.elementHandle(), { timeout: SETTLE_MS }).then(() => true, () => false);
    if (closed) tally.presented += 1;
    else problems.push(`${label}: the Present overlay did not close on Esc for diagram ${n}`);
  }
}

// One probe. If it throws it is a problem of its own and the viewport carries on, unless the page itself is gone.
async function probe(page, label, problems, name, run) {
  try {
    await run();
  } catch (e) {
    problems.push(`${label}: ${name} check crashed: ${firstLine(e)}`);
  }
  return !page.isClosed();
}

async function checkViewport(browser, url, viewport) {
  const label = `${viewport.width}px`;
  const problems = [];
  const tally = { slides: 0, presented: 0 };
  const result = () => ({ problems, slides: tally.slides, presented: tally.presented });
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(ACTION_MS);
    page.setDefaultNavigationTimeout(ACTION_MS);
    page.on('console', (m) => {
      if (isConsoleProblem(m.type(), m.text())) problems.push(`${label}: console ${m.type()}: ${m.text()}`);
    });
    page.on('pageerror', (e) => problems.push(`${label}: page error: ${e.message}`));
    page.on('dialog', (d) => { problems.push(`${label}: the page opened ${article(d.type())} ${d.type()} dialog`); d.dismiss(); });
    await page.goto(url);
    try {
      await page.waitForFunction(() => window.paReady === true, null, { timeout: READY_MS });
    } catch {
      problems.push(`${label}: the page never became ready (window.paReady)`);
      return result();
    }
    let ok = await probe(page, label, problems, 'layout', async () => {
      const fit = await page.evaluate(pageFits);
      if (fit.scrollW > fit.innerW + OVERFLOW_TOLERANCE_PX) {
        problems.push(`${label}: the page scrolls sideways (${fit.scrollW}px wide in ${fit.innerW}px)`);
      }
      const found = await page.evaluate(overflowProbe, { tol: OVERFLOW_TOLERANCE_PX, max: MAX_WIDE_ELEMENTS, maxClipped: MAX_CLIPPED });
      for (const { what, width } of found.wide) problems.push(`${label}: ${what} is ${width}px wide, wider than the ${fit.innerW}px page`);
      for (const { slide, what, width } of found.clipped) problems.push(`${label}: slide ${slide}: ${what} is ${width}px wide and is clipped by the slide`);
    });
    if (ok) ok = await probe(page, label, problems, 'one-line numbers', () => checkNumbers(page, label, problems));
    if (ok && await page.evaluate(deckState).catch(() => null)) ok = await probe(page, label, problems, 'deck', () => checkDeck(page, label, problems, tally));
    if (ok) await probe(page, label, problems, 'diagram overlay', () => checkOverlays(page, label, problems, tally));
    return result();
  } catch (e) {
    problems.push(`${label}: check crashed: ${firstLine(e)}`);
    return result();
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
    const body = result.status === 'skipped' ? { ...base, skipped: true, reason: result.reason, hint: skipHint(result.reason) }
      : result.status === 'ok' ? { ...base, viewports: result.viewports, slides: result.slides, presented: result.presented }
        : { ...base, errors, problems: result.problems };
    process.stdout.write(`${JSON.stringify(body)}\n`);
  } else if (result.status === 'skipped') process.stdout.write(`check: skipped (no browser: ${result.reason}; ${skipHint(result.reason)})\n`);
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
