#!/usr/bin/env node
// node scripts/check.mjs <page.html> [--json]
// Opens a built page at 1440 and 390 px and fails on console errors, page overflow,
// text overflowing its node box (> 2 px) or a presentation that cannot reach its last step.
// exit 0 ok or skipped (no browser), 1 problems, 2 usage/IO
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchBrowser, BrowserUnavailable, SKIP_HINT } from './lib/browser.mjs';
import { UsageError, parseCli, exitUsage } from '../shared/cli.mjs';

const USAGE = 'node scripts/check.mjs <page.html> [--json]';
const OPTIONS = { json: { type: 'boolean' } };
const VIEWPORTS = [{ width: 1440, height: 900 }, { width: 390, height: 780 }];
const READY_MS = 5000;
const TEXT_TOLERANCE_PX = 2;
const ACTION_MS = 5000; // default timeout for every page action and navigation
const SELECTOR_MS = 2000; // reads of elements the runtime should already have drawn
const WATCHDOG_MS = 60000; // wall-clock cap for the whole check
const TIMED_OUT = Symbol('timed out');
const firstLine = (e) => String(e?.message ?? e).split('\n')[0];

// Runs in the page. Every node whose label text leaves the node's shape by more than tol px.
const overflowingText = (tol) => {
  const bad = [];
  for (const node of document.querySelectorAll('.pa-node')) {
    const shape = node.querySelector('.pa-shape');
    if (!shape || /dot|small-diamond/.test(shape.getAttribute('class'))) continue; // the label sits beside these
    const box = shape.getBBox();
    let worst = 0;
    for (const text of node.querySelectorAll('text')) {
      const b = text.getBBox();
      worst = Math.max(worst, box.x - b.x, box.y - b.y, b.x + b.width - (box.x + box.width), b.y + b.height - (box.y + box.height));
    }
    if (worst > tol) bad.push({ id: node.dataset.id, by: worst });
  }
  return bad;
};

const pageFits = () => ({
  scrollW: document.documentElement.scrollWidth,
  innerW: window.innerWidth,
  scrollH: document.documentElement.scrollHeight,
  innerH: window.innerHeight,
});

async function checkViewport(browser, url, viewport) {
  const label = `${viewport.width}px`;
  const problems = [];
  const context = await browser.newContext({ viewport });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(ACTION_MS);
    page.setDefaultNavigationTimeout(ACTION_MS);
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`${label}: console error: ${m.text()}`); });
    page.on('pageerror', (e) => problems.push(`${label}: page error: ${e.message}`));
    await page.goto(url);
    try {
      await page.waitForFunction(() => window.paReady === true, null, { timeout: READY_MS });
    } catch {
      problems.push(`${label}: the page never became ready (window.paReady)`);
      return { problems, steps: 0 };
    }
    const fit = await page.evaluate(pageFits);
    if (fit.scrollW > fit.innerW || fit.scrollH > fit.innerH) {
      problems.push(`${label}: the page overflows the viewport (${fit.scrollW}x${fit.scrollH} in ${fit.innerW}x${fit.innerH})`);
    }
    for (const { id, by } of await page.evaluate(overflowingText, TEXT_TOLERANCE_PX)) {
      problems.push(`${label}: node "${id}": text overflows its box by ${by.toFixed(1)} px`);
    }
    const steps = await page.evaluate(() => (JSON.parse(document.getElementById('pa-data').textContent).steps || []).length);
    if (steps > 0) await checkPresentation(page, steps, label, problems);
    return { problems, steps };
  } catch (e) {
    problems.push(`${label}: check crashed: ${firstLine(e)}`);
    return { problems, steps: 0 };
  } finally {
    await context.close().catch(() => {});
  }
}

// Present, press next to the end, and require the caption to read "N / N".
async function checkPresentation(page, steps, label, problems) {
  await page.keyboard.press('p');
  for (let i = 1; i < steps; i++) await page.keyboard.press('ArrowRight');
  const count = (await page.textContent('[data-pa-count]', { timeout: SELECTOR_MS }).catch(() => null))?.trim();
  if (count === undefined) {
    problems.push(`${label}: check crashed: the presentation caption [data-pa-count] is missing`);
    return;
  }
  if (count !== `${steps} / ${steps}`) problems.push(`${label}: presentation stopped at "${count}", expected "${steps} / ${steps}"`);
  await page.waitForSelector('#pa-stage svg', { timeout: SELECTOR_MS });
  const view = await page.evaluate(() => document.querySelector('#pa-stage svg').getAttribute('viewBox').split(' ').map(Number));
  if (!view.every(Number.isFinite)) problems.push(`${label}: the presentation camera has a non-finite view (${view.join(' ')})`);
  await page.keyboard.press('Escape');
}

/**
 * Check one built page. Returns { status: 'ok' | 'failed' | 'skipped', viewports, steps, problems, reason? }.
 * `timeoutMs` is a wall-clock cap: past it the browser is closed and the result is a failure.
 */
export async function checkPage(file, { env = process.env, timeoutMs = WATCHDOG_MS } = {}) {
  let browser;
  const work = (async () => {
    try {
      browser = await launchBrowser(env);
    } catch (e) {
      if (!(e instanceof BrowserUnavailable)) throw e;
      return { status: 'skipped', viewports: 0, steps: 0, problems: [], reason: firstLine(e) };
    }
    const url = pathToFileURL(file).href;
    const results = [];
    for (const viewport of VIEWPORTS) results.push(await checkViewport(browser, url, viewport));
    const problems = results.flatMap((r) => r.problems);
    return { status: problems.length ? 'failed' : 'ok', viewports: VIEWPORTS.length, steps: Math.max(...results.map((r) => r.steps)), problems };
  })();
  let timer;
  const watchdog = new Promise((resolve) => { timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs); });
  try {
    const result = await Promise.race([work, watchdog]);
    if (result !== TIMED_OUT) return result;
    work.catch(() => {}); // the closed browser rejects whatever was in flight
    const seconds = Number((timeoutMs / 1000).toFixed(1));
    return { status: 'failed', viewports: 0, steps: 0, problems: [`check: timed out after ${seconds} s`], timedOut: true };
  } finally {
    clearTimeout(timer);
    await browser?.close().catch(() => {});
  }
}

function report(result, json) {
  if (json) {
    const errors = result.problems.map((message) => ({ path: '', message }));
    const base = { ok: result.status !== 'failed' };
    const body = result.status === 'skipped' ? { ...base, skipped: true, reason: result.reason, hint: SKIP_HINT }
      : result.status === 'ok' ? { ...base, viewports: result.viewports, steps: result.steps }
        : { ...base, errors, problems: result.problems };
    process.stdout.write(`${JSON.stringify(body)}\n`);
  } else if (result.status === 'skipped') process.stdout.write(`check: skipped (no browser: ${result.reason}; run: npx playwright install chromium)\n`);
  else if (result.status === 'ok') process.stdout.write(`check: ok (${result.viewports} viewports, ${result.steps} steps)\n`);
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
