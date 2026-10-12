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

export const EXAMPLES = ['concept'];
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
