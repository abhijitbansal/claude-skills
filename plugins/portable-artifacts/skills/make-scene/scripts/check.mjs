#!/usr/bin/env node
// node scripts/check.mjs <page.html> [--shots <dir>] [--json]
// Opens a built page at 1440 and 390 px and fails on console errors, page overflow, a blank canvas, a fallback table that
// stays visible once WebGL runs, or a tour that cannot reach its last beat.
// --shots <dir> also checks the page in the dark colour scheme and writes PNGs: one per width and scheme, and one per tour
// beat at 1440 px in light (a camera that lands on the wrong thing shows there). Then open the PNGs and look: a check that
// only wrote them has verified nothing. A skipped check writes none and says so.
// exit 0 ok or skipped (no browser, or no WebGL in it), 1 problems, 2 usage/IO
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchBrowser, BrowserUnavailable } from './lib/browser.mjs';
import { doctorCommand, skipHint } from './lib/doctor-hint.mjs';
import { GRID, MIN_COLOURS, canvasPng } from './lib/canvas-shot.mjs';
import { SCHEMES, parseShotsDir, shotName } from './lib/shots.mjs';
import { distinctColours } from './lib/png.mjs';
import { UsageError, parseCli, exitUsage } from '../shared/cli.mjs';
import { warnIfStaleCopy } from '../shared/stale-copy.mjs';

const USAGE = 'node scripts/check.mjs <page.html> [--shots <dir>] [--json]';
const OPTIONS = { json: { type: 'boolean' }, shots: { type: 'string' } };
const VIEWPORTS = [{ width: 1440, height: 900 }, { width: 390, height: 780 }];
const READY_MS = 10000; // software WebGL is slow to draw the first frame
const ACTION_MS = 5000; // default timeout for every page action and navigation
// A screenshot under software WebGL is the slowest thing the check does. Measured on a CI runner (4 CPUs, run 44484783849):
// the first canvas screenshot 0.9 s with one browser and 2.1 to 2.5 s with three at once; 0.12 s on a laptop; one check
// run timed out at 4.95 s (run 44465347491). 15 s is six times the worst healthy figure and well inside WATCHDOG_MS, which
// still ends a page that truly hangs.
const SHOT_MS = 15000;
const SELECTOR_MS = 2000; // reads of elements the runtime should already have drawn
const FLY_SETTLE_MS = 1200; // the camera's fly-to takes 900 ms; a beat frame waits this long so it shows the landing, not the flight
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
  const colours = distinctColours(await canvasPng(page, { timeout: SHOT_MS }), GRID);
  if (colours < MIN_COLOURS) problems.push(`${label}: the canvas looks blank (${colours} distinct colours on a ${GRID}x${GRID} grid, need ${MIN_COLOURS})`);
}

// Enter the tour, step to the end with the arrow key, and require the count to read "N / N". `frame(n)` (--shots) is called
// once beat n is showing.
async function checkTour(page, beats, label, problems, frame) {
  await page.keyboard.press('p');
  await frame?.(1);
  for (let i = 1; i < beats; i++) {
    await page.keyboard.press('ArrowRight');
    await frame?.(i + 1);
  }
  const count = (await page.textContent('.sc-cap-count', { timeout: SELECTOR_MS }).catch(() => null))?.trim();
  if (count === undefined || count === null) problems.push(`${label}: check crashed: the tour caption .sc-cap-count is missing`);
  else if (count !== `${beats} / ${beats}`) problems.push(`${label}: tour stopped at "${count}", expected "${beats} / ${beats}"`);
  await page.keyboard.press('Escape');
}

// `shots` is { dir, file, beats } for a --shots pass (beats: also frame every tour beat), else null.
async function checkViewport(browser, url, viewport, readyMs, { scheme = 'light', shots = null } = {}) {
  const label = scheme === 'light' ? `${viewport.width}px` : `${viewport.width}px ${scheme}`;
  const problems = [];
  const written = [];
  const snap = async (name) => {
    const target = path.join(shots.dir, name);
    await page.screenshot({ path: target, timeout: SHOT_MS });
    written.push(target);
  };
  let page;
  const context = await browser.newContext({ viewport, colorScheme: scheme });
  try {
    page = await context.newPage();
    page.setDefaultTimeout(ACTION_MS);
    page.setDefaultNavigationTimeout(ACTION_MS);
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`${label}: console error: ${m.text()}`); });
    page.on('pageerror', (e) => problems.push(`${label}: page error: ${e.message}`));
    await page.goto(url);
    if (!(await page.evaluate(webglWorks))) return { problems, beats: 0, shots: written, skipped: 'WebGL is not available in this browser' };
    try {
      await page.waitForFunction(() => { const h = document.querySelector('[data-pa-scene]'); return !h || h.dataset.sceneState !== 'loading'; }, null, { timeout: readyMs });
    } catch {
      problems.push(`${label}: the scene never left the loading state`);
      return { problems, beats: 0, shots: written };
    }
    const facts = await page.evaluate(sceneFacts);
    if (!facts) {
      problems.push(`${label}: the page has no [data-pa-scene] element`);
      return { problems, beats: 0, shots: written };
    }
    const fit = await page.evaluate(pageFits);
    if (fit.scrollW > fit.innerW || fit.scrollH > fit.innerH) {
      problems.push(`${label}: the page overflows the viewport (${fit.scrollW}x${fit.scrollH} in ${fit.innerW}x${fit.innerH})`);
    }
    if (facts.state !== 'ready') {
      problems.push(`${label}: the 3D view fell back to the table although WebGL runs (state "${facts.state}")`);
      if (shots) await snap(shotName(shots.file, { width: viewport.width, scheme })); // the fallback is what a reader sees: look at it
      return { problems, beats: facts.beats, shots: written };
    }
    const { fallbackSize } = facts;
    if (fallbackSize && (fallbackSize.w > FALLBACK_HIDDEN_PX || fallbackSize.h > FALLBACK_HIDDEN_PX)) {
      problems.push(`${label}: the fallback table is still visible once WebGL runs (${Math.round(fallbackSize.w)}x${Math.round(fallbackSize.h)} px)`);
    }
    await checkCanvas(page, label, problems);
    if (shots) await snap(shotName(shots.file, { width: viewport.width, scheme }));
    const frame = shots?.beats ? async (n) => {
      await page.waitForTimeout(FLY_SETTLE_MS);
      await snap(shotName(shots.file, { width: viewport.width, scheme, beat: n }));
    } : undefined;
    if (facts.beats > 0) await checkTour(page, facts.beats, label, problems, frame);
    return { problems, beats: facts.beats, shots: written };
  } catch (e) {
    problems.push(`${label}: check crashed: ${firstLine(e)}`);
    return { problems, beats: 0, shots: written };
  } finally {
    await context.close().catch(() => {});
  }
}

/**
 * Check one built page. Returns { status: 'ok' | 'failed' | 'skipped', viewports, beats, problems, shots, reason? }.
 * `timeoutMs` is a wall-clock cap: past it the browser is closed and the result is a failure. `readyMs` is how long the scene may stay loading.
 * `shotsDir` (--shots): also check the dark scheme and write the PNGs of shotPlan there; `shots` lists the paths written.
 */
export async function checkPage(file, { env = process.env, timeoutMs = WATCHDOG_MS, readyMs = READY_MS, launcher = launchBrowser, shotsDir = null } = {}) {
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
      return { status: 'skipped', viewports: 0, beats: 0, problems: [], shots: [], reason: firstLine(e) };
    }
    const url = pathToFileURL(file).href;
    const results = [];
    if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
    for (const viewport of VIEWPORTS) {
      for (const scheme of shotsDir ? SCHEMES : ['light']) {
        if (stopped) break;
        // the widest width in the light scheme also frames every tour beat
        const shots = shotsDir ? { dir: shotsDir, file, beats: viewport === VIEWPORTS[0] && scheme === 'light' } : null;
        results.push(await checkViewport(browser, url, viewport, readyMs, { scheme, shots }));
      }
    }
    const shots = results.flatMap((r) => r.shots ?? []);
    const problems = results.flatMap((r) => r.problems);
    const skipped = results.find((r) => r.skipped);
    if (skipped && problems.length === 0) return { status: 'skipped', viewports: 0, beats: 0, problems: [], shots: [], reason: skipped.skipped, noWebgl: true };
    return { status: problems.length ? 'failed' : 'ok', viewports: VIEWPORTS.length, beats: Math.max(0, ...results.map((r) => r.beats)), problems, shots };
  })();
  let timer;
  let launchSettled = false;
  launching.then(() => { launchSettled = true; }, () => { launchSettled = true; });
  const watchdog = new Promise((resolve) => { timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs); });
  let timedOut = false;
  try {
    const result = await Promise.race([work, watchdog]);
    if (result !== TIMED_OUT) return result;
    timedOut = true;
    work.catch(() => {}); // the closed browser rejects whatever was in flight
    const after = timeoutMs < 1000 ? `${Math.round(timeoutMs)} ms` : `${Number((timeoutMs / 1000).toFixed(1))} s`;
    return { status: 'failed', viewports: 0, beats: 0, problems: [`check: timed out after ${after}`], shots: [], timedOut: true };
  } finally {
    clearTimeout(timer);
    stopped = true;
    const closing = launching.then((browser) => browser.close()).catch(() => {});
    // A launch still pending when the watchdog fired is closed whenever it lands, but the verdict does not wait for it.
    if (!timedOut || launchSettled) await closing;
  }
}

// A missing browser has a doctor fix id; a browser without WebGL has none, so it gets the plain doctor command.
const hintFor = (result) => (result.noWebgl ? `the 3D view cannot be checked without WebGL; check the browser setup with: ${doctorCommand('--for', 'check')}` : skipHint(result.reason));

// With --shots (`asked`), a result says what it wrote, or that it wrote nothing: a skipped check took no pictures, and the
// report must not read as if the page had been looked at.
function report(result, json, asked = false) {
  const shots = result.shots ?? [];
  if (json) {
    const errors = result.problems.map((message) => ({ path: '', message }));
    const base = { ok: result.status !== 'failed' };
    const body = result.status === 'skipped' ? { ...base, skipped: true, reason: result.reason, hint: hintFor(result) }
      : result.status === 'ok' ? { ...base, viewports: result.viewports, beats: result.beats }
        : { ...base, errors, problems: result.problems };
    process.stdout.write(`${JSON.stringify(asked ? { ...body, shots } : body)}\n`);
    return;
  }
  if (result.status === 'skipped') {
    const what = result.noWebgl ? 'no WebGL' : 'no browser';
    process.stdout.write(`check: skipped (${what}: ${result.reason}; ${hintFor(result)})\n`);
  } else if (result.status === 'ok') process.stdout.write(`check: ok (${result.viewports} viewports, ${result.beats} beats)\n`);
  else {
    // The timeout line already reads as a verdict; every other failure gets a tally.
    for (const p of result.problems) process.stdout.write(`${p}\n`);
    if (!result.timedOut) process.stdout.write(`check: ${result.problems.length} problem${result.problems.length === 1 ? '' : 's'}\n`);
  }
  if (!asked) return;
  if (shots.length === 0) process.stdout.write('shots: none written; look at the page yourself before reporting it checked\n');
  else process.stdout.write(`shots: ${shots.length} PNG${shots.length === 1 ? '' : 's'}, open each one and look:\n${shots.map((f) => `${f}\n`).join('')}`);
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
    const shotsDir = parseShotsDir(values.shots);
    warnIfStaleCopy();
    const result = await checkPage(file, { timeoutMs, shotsDir });
    report(result, json, shotsDir !== null);
    process.exitCode = result.status === 'failed' ? 1 : 0;
  } catch (e) {
    if (e instanceof UsageError) exitUsage(e, { json });
    else {
      // Anything else is a failed check, never a stack trace.
      report({ status: 'failed', problems: [`check crashed: ${firstLine(e)}`] }, json);
      process.exitCode = 1;
    }
  } finally {
    setTimeout(() => process.exit(), EXIT_BACKSTOP_MS).unref(); // whatever the outcome, a stray handle must never keep the CLI alive
  }
}
