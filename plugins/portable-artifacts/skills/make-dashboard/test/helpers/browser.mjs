// Shared by the browser tests: launch (bundled Chromium, else system Chrome)
// and a one-call "build this spec against the fixture data" helper.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BUILD = path.join(ROOT, 'scripts/build.mjs');

// `--font-render-hinting=none`: Linux's headless Chromium rounds every glyph advance to a whole pixel, where macOS keeps
// fractions (CI, ubuntu: JetBrains Mono at 11 px measured 56 and 42 px for "Jan 2025" and "$1,000"; 52.8 and 39.6 on
// macOS and with the flag). Vega reads those widths to decide which month ticks fit, so the 390 px tick-count test drew
// 2 labels instead of 3 in the mono theme. The flag makes the browser measure the same everywhere; macOS ignores it.
const ARGS = ['--font-render-hinting=none'];

export async function launchBrowser() {
  const { chromium } = await import('playwright');
  try {
    return await chromium.launch({ args: ARGS });
  } catch (first) {
    if (!/Executable doesn't exist/i.test(first.message)) throw first;
    return chromium.launch({ channel: 'chrome', args: ARGS });
  }
}

let cached;
export async function haveBrowser() {
  if (cached === undefined) {
    try { await (await launchBrowser()).close(); cached = true; } catch { cached = false; }
  }
  return cached;
}

export function buildProject(spec, { theme } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-ui-'));
  fs.cpSync(path.join(ROOT, 'test/fixtures/data'), path.join(dir, 'data'), { recursive: true });
  const file = path.join(dir, 'dashboard.json');
  fs.writeFileSync(file, JSON.stringify(spec));
  const out = path.join(dir, 'dist');
  const args = [BUILD, file, '--out', out, ...(theme ? ['--theme', theme] : [])];
  const r = spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return { dir, file, out, html: fs.readFileSync(path.join(out, 'index.html'), 'utf8') };
}
