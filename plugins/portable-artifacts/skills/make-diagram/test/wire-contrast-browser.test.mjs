// Dashed and dotted wires stay legible as the page opens: measured from a screenshot (helpers/wire-contrast.mjs),
// every one draws at 3:1 or more against the page in light mode, at 1280 and 390 px, in every example and theme.
// And they stay secondary: a return, reply or event wire (dashed or dotted) never draws heavier than the calls (solid)
// beside it, as styled (never wider, never darker, and thinner or lighter) and as measured, and the legend's samples
// keep the same order.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPage, example, EXAMPLES } from './helpers/browser.mjs';
import { openPage, closeBrowser, skipUnlessBrowser } from './helpers/page.mjs';
import { wireContrast, wireInk, wireWeights } from './helpers/wire-contrast.mjs';

after(async () => { await closeBrowser(); });

const MIN_WIRE = 3;
const EPS = 0.01;
const THEMES = fs.readdirSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../shared/themes')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
const CASES = [
  ...EXAMPLES.flatMap((name) => [1280, 390].map((width) => ({ name, width }))),
  ...THEMES.map((theme) => ({ name: 'story', width: 1280, theme })),
];
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

// The samples of `list` ({ style, width }) that draw heavier than the call sample, or as heavy.
const heavierSamples = (list) => {
  const call = list.find((s) => s.style === 'solid');
  return call ? list.filter((s) => s.style !== 'solid' && s.width >= call.width - EPS).map((s) => `${s.style} ${s.width} vs call ${call.width}`) : [];
};

for (const { name, width, theme } of CASES) {
  const open = () => openPage(buildPage(example(name), { name: `wires-${name}-${theme ?? 'base'}-${width}`, theme }).url, { width, height: 800, reducedMotion: 'reduce' });
  const label = `${name}${theme ? ` (${theme})` : ''} at ${width}px, light`;

  test(`${label}: every dashed and dotted wire draws at ${MIN_WIRE}:1 or more`, async (t) => {
    if (await skipUnlessBrowser(t)) return;
    const { page, context } = await open();
    try {
      const { wires } = await wireContrast(page, context);
      const faint = wires.filter((w) => w.style !== 'solid' && w.contrast < MIN_WIRE).map((w) => `${w.edge} (${w.style}) ${w.contrast}:1`);
      assert.deepEqual(faint, [], 'no faint wire');
    } finally {
      await context.close();
    }
  });

  test(`${label}: return, reply and event wires draw lighter than calls, never heavier`, async (t) => {
    if (await skipUnlessBrowser(t)) return;
    const { page, context } = await open();
    try {
      const { wires, drawn, overlay } = await wireWeights(page);
      const calls = wires.filter((w) => w.style === 'solid');
      if (calls.length) {
        const callWidth = Math.min(...calls.map((w) => w.width));
        const callContrast = Math.min(...calls.map((w) => w.contrast));
        const heavy = wires.filter((w) => w.style !== 'solid').filter((w) => w.width > callWidth + EPS || w.contrast > callContrast + EPS || (w.width > callWidth - EPS && w.contrast > callContrast - EPS))
          .map((w) => `${w.edge} (${w.style}) ${w.width} px ${w.contrast}:1 vs calls ${callWidth} px ${callContrast}:1`);
        assert.deepEqual(heavy, [], 'as styled: every dashed or dotted wire thinner or lighter than the calls, never wider or darker');
        const measured = await wireInk(page, context);
        const callInk = median(measured.filter((w) => w.style === 'solid').map((w) => w.ink));
        const darker = measured.filter((w) => w.style !== 'solid' && w.ink > callInk).map((w) => `${w.edge} (${w.style}) ink ${w.ink} vs calls ${callInk}`);
        assert.deepEqual(darker, [], 'as measured: no dashed or dotted wire puts down more ink than the calls');
      }
      assert.deepEqual(heavierSamples(drawn), [], 'the drawn legend samples keep the order');
      assert.deepEqual(heavierSamples(overlay), [], 'the overlay legend samples keep the order');
    } finally {
      await context.close();
    }
  });
}
