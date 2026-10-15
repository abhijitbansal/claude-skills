// Shared by the browser tests: launch (bundled Chromium, else system Chrome),
// build a spec to a page, and open it with the console watched.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchBrowser } from '../../scripts/lib/browser.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BUILD = path.join(ROOT, 'scripts/build.mjs');

export const EXAMPLES = ['architecture', 'flow', 'state', 'sequence', 'story'];
export const example = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, `references/examples/${name}.diagram.json`), 'utf8'));

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
  scratch ??= fs.mkdtempSync(path.join(os.tmpdir(), 'diagram-ui-'));
  return scratch;
}

/** Build a spec object to a page in the scratch dir; returns { file, url, html }. */
export function buildPage(spec, { theme, name } = {}) {
  const dir = fs.mkdtempSync(path.join(scratchDir(), 'build-'));
  const specFile = path.join(dir, 'spec.diagram.json');
  fs.writeFileSync(specFile, JSON.stringify(spec));
  const file = path.join(dir, `${name ?? 'page'}.html`);
  const args = [BUILD, specFile, '--out', file, ...(theme ? ['--theme', theme] : [])];
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', env: { ...process.env, PA_OUTPUT_DIR: path.join(dir, 'unused') } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return { file, url: pathToFileURL(file).href, html: fs.readFileSync(file, 'utf8') };
}
