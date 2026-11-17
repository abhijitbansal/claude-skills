// Dashed and dotted wires stay legible as the page opens: measured from a screenshot (helpers/wire-contrast.mjs),
// every one draws at 3:1 or more against the page in light mode, at 1280 and 390 px, in every example and theme.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPage, example, EXAMPLES } from './helpers/browser.mjs';
import { openPage, closeBrowser, skipUnlessBrowser } from './helpers/page.mjs';
import { wireContrast } from './helpers/wire-contrast.mjs';

after(async () => { await closeBrowser(); });

const MIN_WIRE = 3;
const THEMES = fs.readdirSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../shared/themes')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
const CASES = [
  ...EXAMPLES.flatMap((name) => [1280, 390].map((width) => ({ name, width }))),
  ...THEMES.map((theme) => ({ name: 'story', width: 1280, theme })),
];

for (const { name, width, theme } of CASES) {
  test(`${name}${theme ? ` (${theme})` : ''} at ${width}px, light: every dashed and dotted wire draws at ${MIN_WIRE}:1 or more`, async (t) => {
    if (await skipUnlessBrowser(t)) return;
    const { page, context } = await openPage(buildPage(example(name), { name: `wires-${name}-${theme ?? 'base'}-${width}`, theme }).url, { width, height: 800, reducedMotion: 'reduce' });
    try {
      const { wires } = await wireContrast(page, context);
      const faint = wires.filter((w) => w.contrast < MIN_WIRE).map((w) => `${w.edge} (${w.style}) ${w.contrast}:1`);
      assert.deepEqual(faint, [], 'no faint wire');
    } finally {
      await context.close();
    }
  });
}
