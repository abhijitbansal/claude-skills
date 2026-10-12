// Shared by the browser tests: launch (bundled Chromium, else system Chrome),
// build a spec file to a page, and open it with the console watched.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchBrowser } from '../../scripts/lib/browser.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BUILD = path.join(ROOT, 'scripts/build.mjs');

export const EXAMPLES = ['concept', 'checklist', 'slides', 'recap'];
export const exampleFile = (name) => path.join(ROOT, `references/examples/${name}.explainer.json`);

export { launchBrowser };

let cached;
export async function haveBrowser() {
  if (cached === undefined) {
    try { await (await launchBrowser()).close(); cached = true; } catch { cached = false; }
  }
  return cached;
}

let scratch;
/** A temp dir shared by the whole run; screenshots and builds land here. */
export function scratchDir() {
  scratch ??= fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-ui-'));
  return scratch;
}

/** Build a spec file to a page in the scratch dir; returns { file, url, html }. */
export function buildFile(specFile, { theme, name = 'page' } = {}) {
  const dir = fs.mkdtempSync(path.join(scratchDir(), 'build-'));
  const file = path.join(dir, `${name}.html`);
  const args = [BUILD, specFile, '--out', file, ...(theme ? ['--theme', theme] : [])];
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', env: { ...process.env, PA_OUTPUT_DIR: path.join(dir, 'unused'), EVAL_LOG: '' } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return { file, url: pathToFileURL(file).href, html: fs.readFileSync(file, 'utf8') };
}

/** Write a spec object next to `assetsFrom`'s files (so relative paths work), build it, return the page. */
export function buildSpec(spec, { name = 'page', files = [] } = {}) {
  const dir = fs.mkdtempSync(path.join(scratchDir(), 'spec-'));
  for (const f of files) fs.copyFileSync(f, path.join(dir, path.basename(f)));
  const specFile = path.join(dir, 'spec.explainer.json');
  fs.writeFileSync(specFile, JSON.stringify(spec));
  return buildFile(specFile, { name });
}

/**
 * Open a built page in a fresh context; resolves { page, problems, context } once the runtime has started.
 * `problems` collects every console error/warning and page error. `blockStorage` makes localStorage throw;
 * `seed` is a { key: value } map written to localStorage before any page script runs.
 */
let shared;
/** Closes the browser openPage launched; call it from the test file's `after`. */
export async function closeSharedBrowser() {
  await shared?.close();
  shared = undefined;
}

export async function openPage(url, { width = 1280, height = 900, colorScheme = 'light', reducedMotion = 'reduce', blockStorage = false, seed = {}, context: existing } = {}) {
  shared ??= await launchBrowser();
  const context = existing ?? await shared.newContext({ viewport: { width, height }, colorScheme, reducedMotion });
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(e.message));
  page.on('dialog', (d) => { problems.push(`dialog: ${d.type()}`); d.dismiss(); });
  if (blockStorage) {
    await page.addInitScript(() => {
      for (const name of ['localStorage', 'sessionStorage']) {
        Object.defineProperty(window, name, { get() { throw new DOMException('denied', 'SecurityError'); } });
      }
    });
  }
  if (Object.keys(seed).length > 0) {
    await page.addInitScript((entries) => {
      if (!window.name.includes('seeded')) {
        for (const [k, v] of Object.entries(entries)) window.localStorage.setItem(k, v);
        window.name += 'seeded';
      }
    }, seed);
  }
  await page.goto(url);
  await page.waitForFunction(() => window.paReady === true, null, { timeout: 15000 });
  return { page, problems, context };
}
