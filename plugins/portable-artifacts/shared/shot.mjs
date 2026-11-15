#!/usr/bin/env node
// node shared/shot.mjs <file.html | folder> [--widths 390,1280] [--out <dir>] [--json]
// Screenshot a local page the way a person would check it: served from a loopback server (so relative assets load
// and a 404 is seen), at each width, light and dark. One PNG per page, width and scheme in <out>
// (default <git root>/.scratch/shots). Then LOOK at the PNGs; a script that wrote them has verified nothing.
//
// Exit 0 ok, 1 a page answered non-2xx or a request failed, 2 usage / environment (no browser library, another
// headless browser running). The browser library is loaded lazily from the calling skill's own node_modules (this file
// is copied into every skill's shared/), else from a sibling skill that has it; run the skill's doctor
// (`--fix dev_deps`, or `--fix node_modules` in make-motion) when it is missing.
// Only this file touches a browser, and only after the arguments, the target and the pgrep check pass.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseCli, UsageError, exitUsage } from './cli.mjs';
import { findGitRoot, slugify } from './output.mjs';

export const BROWSER_PACKAGE = 'playwright';
export const DEFAULT_WIDTHS = [390, 1280];
export const SCHEMES = ['light', 'dark'];
// Chromium wraps (tiles) a full-page capture taller than about 16384 device pixels, so a longer page is cut here.
export const MAX_SHOT_HEIGHT = 16000;
const MIN_WIDTH = 200;
const MAX_WIDTH = 4000;
const VIEWPORT_HEIGHT = 800;
const USAGE = 'node shared/shot.mjs <file.html | folder> [--widths 390,1280] [--out <dir>] [--json]';
const OPTIONS = { widths: { type: 'string' }, out: { type: 'string' }, json: { type: 'boolean' } };
const here = path.dirname(fileURLToPath(import.meta.url));

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json',
};

/** { target, widths, out, json } from argv. Throws UsageError (a help request included); never touches the disk. */
export function parseShotArgs(argv) {
  const { values, positionals } = parseCli(argv, OPTIONS, USAGE);
  if (positionals.length !== 1) throw new UsageError(`expected one page file or folder; usage: ${USAGE}`);
  const widths = (values.widths ?? DEFAULT_WIDTHS.join(',')).split(',').map((w) => w.trim());
  const bad = widths.find((w) => !/^\d+$/.test(w) || Number(w) < MIN_WIDTH || Number(w) > MAX_WIDTH);
  if (bad !== undefined) throw new UsageError(`--widths needs whole pixel widths from ${MIN_WIDTH} to ${MAX_WIDTH}, comma separated (for example 390,1280); got ${JSON.stringify(bad)}`);
  if (values.out !== undefined && values.out.trim() === '') throw new UsageError('--out needs a folder path');
  return { target: positionals[0], widths: [...new Set(widths.map(Number))], out: values.out, json: values.json === true };
}

/** The server root and the pages to shoot: a file serves its folder; a folder serves index.html, else each top-level .html. */
export function pagesFor(target) {
  const abs = path.resolve(target);
  let stat;
  try {
    stat = fs.statSync(abs);
  } catch {
    throw new UsageError(`no such file or folder: ${target}`);
  }
  if (stat.isFile()) {
    if (!/\.html?$/i.test(abs)) throw new UsageError(`${target} is not an .html file`);
    return { root: path.dirname(abs), pages: [path.basename(abs)] };
  }
  const html = fs.readdirSync(abs).filter((n) => /\.html?$/i.test(n)).sort();
  if (html.length === 0) throw new UsageError(`no .html page in ${target}`);
  return { root: abs, pages: html.includes('index.html') ? ['index.html'] : html };
}

function resolveInside(root, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const real = fs.realpathSync(root);
  let file = path.resolve(real, `.${decoded.startsWith('/') ? '' : '/'}${decoded}`);
  try {
    if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    file = fs.realpathSync(file);
  } catch {
    return null;
  }
  return file === real || file.startsWith(real + path.sep) ? file : null;
}

/** Serve `root` on 127.0.0.1 and a free port. Read-only, GET and HEAD, never outside `root` (symlinks included). */
export function startServer(root) {
  const server = http.createServer((req, res) => {
    let file = req.method === 'GET' || req.method === 'HEAD' ? resolveInside(root, req.url ?? '/') : null;
    try {
      if (file && !fs.statSync(file).isFile()) file = null;
    } catch {
      file = null;
    }
    if (!file) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    if (req.method === 'HEAD') res.end();
    else fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({ origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((done) => { server.closeAllConnections?.(); server.close(() => done()); }) });
    });
  });
}

/** Lines of `pgrep -fl chrome-headless-shell`: another headless browser is already running (the Mac wedges on many at once). */
export function liveBrowsers(run = spawnSync) {
  const r = run('pgrep', ['-fl', 'chrome-headless-shell'], { encoding: 'utf8' });
  if (r.error || r.status !== 0) return [];
  return String(r.stdout ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
}

/** The skill folder whose node_modules holds the browser library: this skill's, then a sibling's, then (plugin source) any skill's. */
export function findBrowserLib(skillRoot = path.resolve(here, '..'), { exists = fs.existsSync, list = (d) => fs.readdirSync(d) } = {}) {
  const has = (dir) => exists(path.join(dir, 'node_modules', BROWSER_PACKAGE, 'package.json'));
  const subdirs = (d) => { try { return list(d).sort().map((n) => path.join(d, n)); } catch { return []; } };
  const candidates = [skillRoot, ...(path.basename(path.dirname(skillRoot)) === 'skills' ? subdirs(path.dirname(skillRoot)) : []), ...subdirs(path.join(skillRoot, 'skills'))];
  return candidates.find(has) ?? null;
}

async function loadChromium(dir) {
  const req = createRequire(path.join(dir, 'package.json'));
  const mod = await import(pathToFileURL(req.resolve(BROWSER_PACKAGE)).href);
  return mod.chromium ?? mod.default.chromium;
}

async function launch(chromium) {
  try {
    return await chromium.launch();
  } catch (bundled) {
    try {
      return await chromium.launch({ channel: 'chrome' });
    } catch {
      throw new UsageError(`no browser could start (${String(bundled.message).split('\n')[0]}); install one with the skill's doctor (--fix chromium) or install Google Chrome`);
    }
  }
}

// Page height and horizontal overflow, after web fonts settle: where a 390 px layout breaks shows up as scrollWidth > width.
const measurePage = async () => {
  await document.fonts?.ready;
  return { height: document.documentElement.scrollHeight, scrollWidth: document.documentElement.scrollWidth, width: window.innerWidth };
};

async function shootOne(browser, { url, name, width, scheme, out }) {
  // reducedMotion: a shot shows the settled page, not an entrance animation still at opacity 0 (the explainer's rise-in).
  const context = await browser.newContext({ viewport: { width, height: VIEWPORT_HEIGHT }, colorScheme: scheme, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const problems = [];
  const warnings = [];
  try {
    const page = await context.newPage();
    page.on('response', (r) => { if (!r.ok()) problems.push(`${r.status()} ${r.url()}`); });
    page.on('requestfailed', (r) => problems.push(`failed ${r.url()}: ${r.failure()?.errorText ?? 'request failed'}`));
    await page.goto(url, { waitUntil: 'load' });
    const { height, scrollWidth } = await page.evaluate(measurePage);
    if (scrollWidth > width) warnings.push(`${name} at ${width}px: the page is ${scrollWidth}px wide (horizontal overflow)`);
    if (height > MAX_SHOT_HEIGHT) warnings.push(`${name} at ${width}px: the page is ${height}px tall; the shot is cut at ${MAX_SHOT_HEIGHT}px`);
    const file = path.join(out, `${name}-${width}-${scheme}.png`);
    await page.screenshot({ path: file, fullPage: true, ...(height > MAX_SHOT_HEIGHT ? { clip: { x: 0, y: 0, width, height: MAX_SHOT_HEIGHT } } : {}) });
    return { shot: { page: name, width, scheme, path: file }, problems, warnings };
  } finally {
    await context.close();
  }
}

function report(result, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  for (const s of result.shots) process.stdout.write(`${s.path}\n`);
  for (const w of result.warnings) process.stderr.write(`warning: ${w}\n`);
  for (const p of result.problems) process.stderr.write(`error: ${p}\n`);
}

// A browser or navigation failure (a timeout, a crash): one line, exit 1, no stack.
function failRun(error, json) {
  const message = String(error?.message ?? error).split('\n')[0];
  if (json) process.stdout.write(`${JSON.stringify({ ok: false, shots: [], problems: [message], warnings: [] })}\n`);
  else process.stderr.write(`error: ${message}\n`);
  process.exitCode = 1;
}

/**
 * Run the whole thing. `deps` is for tests: { chromium, live }. Sets process.exitCode and returns; never throws.
 * The browser library is imported only after every cheap check has passed.
 */
export async function main(argv, deps = {}) {
  const json = argv.includes('--json');
  let server = null;
  let browser = null;
  try {
    const args = parseShotArgs(argv);
    const { root, pages } = pagesFor(args.target);
    const running = (deps.live ?? liveBrowsers)();
    if (running.length > 0 && process.env.ALLOW_BROWSER_RUN !== '1') {
      throw new UsageError(`another headless browser is running (${running[0]}); wait for it, or rerun with ALLOW_BROWSER_RUN=1 for a deliberate second run`);
    }
    let chromium = deps.chromium;
    if (!chromium) {
      const dir = findBrowserLib();
      if (!dir) throw new UsageError(`the browser library (${BROWSER_PACKAGE}) is not installed in this skill or a sibling; run the skill's doctor (scripts/doctor.mjs --fix dev_deps, or --fix node_modules in make-motion)`);
      chromium = await loadChromium(dir);
    }
    const out = path.resolve(args.out ?? path.join(findGitRoot(process.cwd()) ?? process.cwd(), '.scratch', 'shots'));
    fs.mkdirSync(out, { recursive: true });
    server = await startServer(root);
    browser = await launch(chromium);
    const result = { ok: true, shots: [], problems: [], warnings: [] };
    for (const page of pages) {
      for (const width of args.widths) {
        for (const scheme of SCHEMES) {
          const one = await shootOne(browser, { url: `${server.origin}/${encodeURIComponent(page)}`, name: slugify(page.replace(/\.html?$/i, ''), 'page'), width, scheme, out });
          result.shots.push(one.shot);
          result.problems.push(...one.problems);
          result.warnings.push(...one.warnings);
        }
      }
    }
    result.problems = [...new Set(result.problems)];
    result.ok = result.problems.length === 0;
    report(result, json);
    process.exitCode = result.ok ? 0 : 1;
  } catch (e) {
    if (e instanceof UsageError) exitUsage(e, { json });
    else failRun(e, json);
  } finally {
    await browser?.close();
    await server?.close();
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
