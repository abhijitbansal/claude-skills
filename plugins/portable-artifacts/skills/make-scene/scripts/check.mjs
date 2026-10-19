#!/usr/bin/env node
// node scripts/check.mjs <page.html> [--json]
// Opens a built page at 1440 and 390 px and fails on console errors, page overflow, a blank canvas, a fallback table that
// stays visible once WebGL runs, or a tour that cannot reach its last beat.
// exit 0 ok or skipped (no browser, or no WebGL in it), 1 problems, 2 usage/IO
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchBrowser, BrowserUnavailable } from './lib/browser.mjs';
import { doctorCommand, skipHint } from './lib/doctor-hint.mjs';
import { GRID, MIN_COLOURS, canvasPng } from './lib/canvas-shot.mjs';
import { distinctColours } from './lib/png.mjs';
import { UsageError, parseCli, exitUsage } from '../shared/cli.mjs';

const USAGE = 'node scripts/check.mjs <page.html> [--json]';
const OPTIONS = { json: { type: 'boolean' } };
const VIEWPORTS = [{ width: 1440, height: 900 }, { width: 390, height: 780 }];
const READY_MS = 10000; // software WebGL is slow to draw the first frame
const ACTION_MS = 5000; // default timeout for every page action and navigation
const SELECTOR_MS = 2000; // reads of elements the runtime should already have drawn
const WATCHDOG_MS = 60000; // wall-clock cap for the whole check
const FALLBACK_HIDDEN_PX = 2; // the visually hidden table is 1 x 1 px; a visible one is far larger
const EXIT_BACKSTOP_MS = 3000; // after the report is written, a handle that keeps Node alive this long is forced out
const TIMED_OUT = Symbol('timed out');
const firstLine = (e) => String(e?.message ?? e).split('\n')[0];

// Runs in the page.
const webglWorks = () => {
  try {
    return Boolean(document.createElement('canvas').getContext('webgl2'));
  } catch {
    return false;
  }
};
const pageFits = () => ({
  scrollW: document.documentElement.scrollWidth,
  innerW: window.innerWidth,
  scrollH: document.documentElement.scrollHeight,
  innerH: window.innerHeight,
});
const sceneFacts = () => {
  const host = document.querySelector('[data-pa-scene]');
  if (!host) return null;
  const fallback = host.querySelector('[data-scene-fallback]');
  const box = fallback?.getBoundingClientRect();
  const data = host.querySelector('script[type="application/json"]');
  return {
    state: host.dataset.sceneState ?? 'loading',
    fallbackSize: box ? { w: box.width, h: box.height } : null,
    beats: data ? (JSON.parse(data.textContent).tour ?? []).length : 0,
  };
};

async function checkCanvas(page, label, problems) {
  const colours = distinctColours(await canvasPng(page, { timeout: ACTION_MS }), GRID);
  if (colours < MIN_COLOURS) problems.push(`${label}: the canvas looks blank (${colours} distinct colours on a ${GRID}x${GRID} grid, need ${MIN_COLOURS})`);
}

// Enter the tour, step to the end with the arrow key, and require the count to read "N / N".
async function checkTour(page, beats, label, problems) {
  await page.keyboard.press('p');
  for (let i = 1; i < beats; i++) await page.keyboard.press('ArrowRight');
  const count = (await page.textContent('.sc-cap-count', { timeout: SELECTOR_MS }).catch(() => null))?.trim();
  if (count === undefined || count === null) problems.push(`${label}: check crashed: the tour caption .sc-cap-count is missing`);
  else if (count !== `${beats} / ${beats}`) problems.push(`${label}: tour stopped at "${count}", expected "${beats} / ${beats}"`);
  await page.keyboard.press('Escape');
}

async function checkViewport(browser, url, viewport, readyMs) {
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
    if (!(await page.evaluate(webglWorks))) return { problems, beats: 0, skipped: 'WebGL is not available in this browser' };
    try {
      await page.waitForFunction(() => { const h = document.querySelector('[data-pa-scene]'); return !h || h.dataset.sceneState !== 'loading'; }, null, { timeout: readyMs });
    } catch {
      problems.push(`${label}: the scene never left the loading state`);
      return { problems, beats: 0 };
    }
    const facts = await page.evaluate(sceneFacts);
    if (!facts) {
      problems.push(`${label}: the page has no [data-pa-scene] element`);
      return { problems, beats: 0 };
    }
    const fit = await page.evaluate(pageFits);
    if (fit.scrollW > fit.innerW || fit.scrollH > fit.innerH) {
      problems.push(`${label}: the page overflows the viewport (${fit.scrollW}x${fit.scrollH} in ${fit.innerW}x${fit.innerH})`);
    }
    if (facts.state !== 'ready') {
      problems.push(`${label}: the 3D view fell back to the table although WebGL runs (state "${facts.state}")`);
      return { problems, beats: facts.beats };
    }
    const { fallbackSize } = facts;
    if (fallbackSize && (fallbackSize.w > FALLBACK_HIDDEN_PX || fallbackSize.h > FALLBACK_HIDDEN_PX)) {
      problems.push(`${label}: the fallback table is still visible once WebGL runs (${Math.round(fallbackSize.w)}x${Math.round(fallbackSize.h)} px)`);
    }
    await checkCanvas(page, label, problems);
    if (facts.beats > 0) await checkTour(page, facts.beats, label, problems);
    return { problems, beats: facts.beats };
  } catch (e) {
    problems.push(`${label}: check crashed: ${firstLine(e)}`);
    return { problems, beats: 0 };
  } finally {
    await context.close().catch(() => {});
  }
}

/**
 * Check one built page. Returns { status: 'ok' | 'failed' | 'skipped', viewports, beats, problems, reason? }.
 * `timeoutMs` is a wall-clock cap: past it the browser is closed and the result is a failure. `readyMs` is how long the scene may stay loading.
 */
export async function checkPage(file, { env = process.env, timeoutMs = WATCHDOG_MS, readyMs = READY_MS, launcher = launchBrowser } = {}) {
  // The launch promise is kept: if the watchdog wins while Chromium is still starting, the finally block
  // closes whatever the launch yields, and `stopped` keeps the late-arriving work from touching it.
  const launching = launcher(env);
  let stopped = false;
  const work = (async () => {
    let browser;
    try {
      browser = await launching;
    } catch (e) {
      if (!(e instanceof BrowserUnavailable)) throw e;
      return { status: 'skipped', viewports: 0, beats: 0, problems: [], reason: firstLine(e) };
    }
    const url = pathToFileURL(file).href;
    const results = [];
    for (const viewport of VIEWPORTS) {
      if (stopped) break;
      results.push(await checkViewport(browser, url, viewport, readyMs));
    }
    const problems = results.flatMap((r) => r.problems);
    const skipped = results.find((r) => r.skipped);
    if (skipped && problems.length === 0) return { status: 'skipped', viewports: 0, beats: 0, problems: [], reason: skipped.skipped, noWebgl: true };
    return { status: problems.length ? 'failed' : 'ok', viewports: VIEWPORTS.length, beats: Math.max(0, ...results.map((r) => r.beats)), problems };
  })();
  let timer;
  const watchdog = new Promise((resolve) => { timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs); });
  try {
    const result = await Promise.race([work, watchdog]);
    if (result !== TIMED_OUT) return result;
    stopped = true;
    work.catch(() => {}); // the closed browser rejects whatever was in flight
    const after = timeoutMs < 1000 ? `${Math.round(timeoutMs)} ms` : `${Number((timeoutMs / 1000).toFixed(1))} s`;
    return { status: 'failed', viewports: 0, beats: 0, problems: [`check: timed out after ${after}`], timedOut: true };
  } finally {
    clearTimeout(timer);
    stopped = true;
    await launching.then((browser) => browser.close()).catch(() => {}); // a launch still pending when the watchdog fired is closed once it lands
  }
}

// A missing browser has a doctor fix id; a browser without WebGL has none, so it gets the plain doctor command.
const hintFor = (result) => (result.noWebgl ? `the 3D view cannot be checked without WebGL; check the browser setup with: ${doctorCommand('--for', 'check')}` : skipHint(result.reason));

function report(result, json) {
  if (json) {
    const errors = result.problems.map((message) => ({ path: '', message }));
    const base = { ok: result.status !== 'failed' };
    const body = result.status === 'skipped' ? { ...base, skipped: true, reason: result.reason, hint: hintFor(result) }
      : result.status === 'ok' ? { ...base, viewports: result.viewports, beats: result.beats }
        : { ...base, errors, problems: result.problems };
    process.stdout.write(`${JSON.stringify(body)}\n`);
  } else if (result.status === 'skipped') {
    const what = result.noWebgl ? 'no WebGL' : 'no browser';
    process.stdout.write(`check: skipped (${what}: ${result.reason}; ${hintFor(result)})\n`);
  } else if (result.status === 'ok') process.stdout.write(`check: ok (${result.viewports} viewports, ${result.beats} beats)\n`);
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
    setTimeout(() => process.exit(), EXIT_BACKSTOP_MS).unref(); // a stray handle must never keep the CLI alive
  } catch (e) {
    if (e instanceof UsageError) exitUsage(e, { json });
    else {
      // Anything else is a failed check, never a stack trace.
      report({ status: 'failed', problems: [`check crashed: ${firstLine(e)}`] }, json);
      process.exitCode = 1;
    }
  }
}
