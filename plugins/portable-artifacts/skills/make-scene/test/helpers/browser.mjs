// Shared by the Task 9 browser tests: launch (bundled Chromium, else system Chrome), build a world to a page, screenshot the canvas.
import assert from 'node:assert/strict';
import { build } from '../../scripts/build.mjs';
import { launchBrowser } from '../../scripts/lib/browser.mjs';
import { canvasPng } from '../../scripts/lib/canvas-shot.mjs';
import { samplePng } from '../../scripts/lib/png.mjs';
import { PINNED_ENV, tempDir, writeScene } from './scene-fixtures.mjs';

export { launchBrowser };

export const WORLDS = ['city', 'forest', 'galaxy', 'terrain'];
export const HOSTILE = '<img src=x onerror=window.PWNED=1>';

const GROUPS = ['api', 'web', 'db'];
const WEEKS = ['2026-W30', '2026-W31', '2026-W32', '2026-W33', '2026-W34'];
export const demoRows = (labelOf = (group) => group) => GROUPS.flatMap((group, g) => WEEKS.map((t, w) => (
  { group: labelOf(group), t, value: 3 + ((g * 7 + w * 5) % 11) })));
const DEMO_LINKS = [{ from: 'api', to: 'web', value: 4 }, { from: 'web', to: 'db', value: 2 }];

let cached;
/** True when a browser starts (bundled Chromium, else system Chrome). Memoised for the run. */
export async function haveBrowser() {
  if (cached === undefined) {
    try {
      await (await launchBrowser()).close();
      cached = true;
    } catch {
      cached = false;
    }
  }
  return cached;
}

/** Builds a scene of `world` (pinned clock) into a fresh temp dir; returns { file, dir }. */
export async function buildWorldPage(t, world, { spec = {}, rows = demoRows(), links = DEMO_LINKS } = {}) {
  const dir = tempDir(t, `scene-${world}-`);
  const scene = writeScene(t, { title: `${world} demo`, world, units: 'commits', data: { file: 'rows.json' }, ...spec }, { rows, links: world === 'galaxy' ? links : [] });
  const built = await build(scene, { out: `${dir}/page.html`, env: { ...PINNED_ENV, PA_OUTPUT_DIR: dir } });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  return { file: built.out, dir };
}

export { canvasPng };

/** A stable string of the canvas pixels on a 32 x 32 grid; equal strings mean the sampled pixels did not change. */
export async function canvasHash(page) {
  return samplePng(await canvasPng(page), 32);
}
