// check.mjs body, loaded after the preflight (see scripts/check.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { UsageError, parseCli, exitUsage } from '../../shared/cli.mjs';
import { liveBrowsers, SCHEMES } from '../../shared/shot.mjs';
import { launchBrowser, BrowserUnavailable } from '../lib/browser.mjs';

const USAGE = 'node scripts/check.mjs <dist folder | index.html> [--json] [--shots <dir>]';
const OPTIONS = { json: { type: 'boolean' }, shots: { type: 'string' } };
const SHOT_SCRIPT = fileURLToPath(new URL('../../shared/shot.mjs', import.meta.url));
const SHOT_WIDTHS = '390,1280';
const SHOT_TIMEOUT_MS = 180000;
const VIEWPORTS = [{ width: 1280, height: 900 }, { width: 390, height: 780 }];
const READY_MS = 15000; // window.paReady: every chart rendered (fonts first)
const WATCHDOG_MS = 120000; // wall-clock cap for the whole check
const TIMED_OUT = Symbol('timed out');
const SKIP_HINT = 'run scripts/doctor.mjs --for check --fix dev_deps,chromium to install one';
const firstLine = (e) => String(e?.message ?? e).split('\n')[0];

/** The page file for a dist folder (its index.html) or an .html path. Throws UsageError when there is none. */
export function pageFile(target) {
  const abs = path.resolve(target);
  let stat;
  try {
    stat = fs.statSync(abs);
  } catch {
    throw new UsageError(`no such file or folder: ${target}`);
  }
  const file = stat.isDirectory() ? path.join(abs, 'index.html') : abs;
  if (!fs.existsSync(file)) throw new UsageError(`no index.html in ${abs}; run build.mjs first`);
  return file;
}

// Runs in the page: what a person would see wrong once every chart has rendered.
const pageProblems = () => {
  const out = [];
  const root = document.documentElement;
  if (root.scrollWidth > window.innerWidth) out.push(`the page is ${root.scrollWidth}px wide (horizontal scroll)`);
  for (const card of document.querySelectorAll('.card')) {
    const title = card.querySelector('h2')?.textContent ?? card.id;
    const error = card.querySelector('.chart-error');
    if (error) out.push(`"${title}": ${error.textContent}`);
    for (const pane of card.querySelectorAll('.chart')) {
      const drawn = pane.querySelector('svg, canvas, table');
      if (!drawn && !card.querySelector('.empty')) out.push(`"${title}": a chart pane drew nothing`);
    }
  }
  return out;
};

async function checkView(browser, url, viewport, scheme) {
  const label = `${viewport.width}px ${scheme}`;
  const context = await browser.newContext({ viewport, colorScheme: scheme });
  const problems = [];
  try {
    const page = await context.newPage();
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`${label}: console error: ${m.text()}`); });
    page.on('pageerror', (e) => problems.push(`${label}: page error: ${firstLine(e)}`));
    await page.goto(url, { waitUntil: 'load' });
    try {
      await page.waitForFunction(() => window.paReady === true, null, { timeout: READY_MS });
    } catch {
      problems.push(`${label}: the charts did not finish rendering within ${READY_MS / 1000} s`);
      return problems;
    }
    for (const p of await page.evaluate(pageProblems)) problems.push(`${label}: ${p}`);
    return problems;
  } finally {
    await context.close();
  }
}

/**
 * Check one built page at 1280 and 390 px, light and dark. Returns { status: 'ok' | 'failed' | 'skipped', views, problems, reason? }.
 * `timeoutMs` caps the wall clock: past it the browser is closed and the result is a failure.
 */
export async function checkPage(file, { env = process.env, timeoutMs = WATCHDOG_MS } = {}) {
  let browser;
  const work = (async () => {
    try {
      browser = await launchBrowser(env);
    } catch (e) {
      if (!(e instanceof BrowserUnavailable)) throw e;
      return { status: 'skipped', views: 0, problems: [], reason: firstLine(e) };
    }
    const url = pathToFileURL(file).href;
    const problems = [];
    let views = 0;
    for (const viewport of VIEWPORTS) {
      for (const scheme of SCHEMES) {
        problems.push(...await checkView(browser, url, viewport, scheme));
        views += 1;
      }
    }
    return { status: problems.length ? 'failed' : 'ok', views, problems };
  })();
  let timer;
  const watchdog = new Promise((resolve) => { timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs); });
  try {
    const result = await Promise.race([work, watchdog]);
    if (result !== TIMED_OUT) return result;
    work.catch(() => {}); // the closed browser rejects whatever was in flight
    return { status: 'failed', views: 0, problems: [`check: timed out after ${timeoutMs / 1000} s`], timedOut: true };
  } finally {
    clearTimeout(timer);
    await browser?.close().catch(() => {});
  }
}

/** One PNG per width (390, 1280) and colour scheme into `dir`, through shared/shot.mjs in its own process. */
export function takeShots(file, dir, { run = spawnSync, script = SHOT_SCRIPT } = {}) {
  const r = run(process.execPath, [script, file, '--widths', SHOT_WIDTHS, '--out', dir, '--json'], { encoding: 'utf8', timeout: SHOT_TIMEOUT_MS });
  let body = null;
  try {
    body = JSON.parse(String(r.stdout ?? '').trim().split('\n').at(-1));
  } catch {
    body = null;
  }
  const paths = (body?.shots ?? []).map((s) => s.path);
  if (r.status === 0 && body?.ok) return { status: 0, paths };
  const message = body?.errors?.[0]?.message ?? body?.problems?.[0] ?? firstLine(r.stderr || r.error?.message || 'the screenshot run failed');
  return { status: r.status ?? 1, paths, message };
}

function report(result, json, shots) {
  if (json) {
    const body = result.status === 'skipped'
      ? { ok: true, skipped: true, reason: result.reason, hint: SKIP_HINT }
      : { ok: result.status === 'ok', views: result.views, problems: result.problems, errors: result.problems.map((message) => ({ path: '', message })) };
    process.stdout.write(`${JSON.stringify(shots ? { ...body, shots: shots.paths, ...(shots.message ? { shotsError: shots.message } : {}) } : body)}\n`);
    return;
  }
  if (result.status === 'skipped') process.stdout.write(`check: skipped (no browser: ${result.reason}; ${SKIP_HINT})\n`);
  else if (result.status === 'ok') process.stdout.write(`check: ok (${result.views} views: 1280 and 390 px, light and dark)\n`);
  else {
    for (const p of result.problems) process.stdout.write(`${p}\n`);
    if (!result.timedOut) process.stdout.write(`check: ${result.problems.length} problem${result.problems.length === 1 ? '' : 's'}\n`);
  }
  if (shots) {
    for (const p of shots.paths) process.stdout.write(`${p}\n`);
    if (shots.message) process.stderr.write(`shots: ${shots.message}\n`);
  }
}

export async function main(argv, { env = process.env, live = liveBrowsers } = {}) {
  let json = argv.includes('--json');
  try {
    const { values, positionals } = parseCli(argv, OPTIONS, USAGE);
    json = values.json === true;
    if (positionals.length !== 1) throw new UsageError(`expected one dist folder or page file; usage: ${USAGE}`);
    if (values.shots !== undefined && values.shots.trim() === '') throw new UsageError(`--shots needs a folder path; usage: ${USAGE}`);
    const file = pageFile(positionals[0]);
    // One browser-heavy run at a time on this machine.
    const running = env.PA_NO_BROWSER === '1' ? [] : live();
    if (running.length > 0 && env.ALLOW_BROWSER_RUN !== '1') {
      throw new UsageError(`another headless browser is running (${running[0]}); wait for it, or rerun with ALLOW_BROWSER_RUN=1 for a deliberate second run`);
    }
    const result = await checkPage(file, { env });
    // A skipped check takes no screenshots either; a failed one still does: the page is what you need to look at.
    const shots = values.shots !== undefined && result.status !== 'skipped' ? takeShots(file, path.resolve(values.shots)) : null;
    report(result, json, shots);
    if (!json && values.shots !== undefined && !shots) process.stdout.write('shots: skipped (the check was skipped)\n');
    let code = result.status === 'failed' ? 1 : 0;
    if (shots && shots.status !== 0) code = Math.max(code, shots.status);
    process.exitCode = code;
  } catch (e) {
    if (e instanceof UsageError) exitUsage(e, { json });
    else {
      report({ status: 'failed', problems: [`check crashed: ${firstLine(e)}`] }, json, null);
      process.exitCode = 1;
    }
  }
}
