// TEMPORARY diagnostic, round 2 (delete this file once the Linux poster safe-area failure is settled). It asserts
// nothing: it prints `ink-metrics:` lines, the advance width and the ink bounds canvas reports for a few words under the
// engine's launch arguments, so the Linux log and a macOS run can be compared number for number. Round 1 of this file
// showed that `--font-render-hinting=none` gives unrounded advances on Linux (349.05 for Archivo "Rag" at 24 px x8, 349.0
// on macOS), which is why the engine launches with it.
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from '../../scripts/lib/browser.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FONT = readFileSync(path.resolve(HERE, '../../engine/fonts/archivo-latin-standard-normal.woff2')).toString('base64');
const SAMPLES = [
  { text: 'total', weight: 900, size: 280, stretch: 'extra-condensed' },
  { text: 'TOTAL', weight: 900, size: 280, stretch: 'extra-condensed' },
  { text: 'total', weight: 900, size: 100, stretch: 'extra-condensed' },
  { text: 'Rag', weight: 400, size: 120, stretch: 'normal' },
  { text: 'l', weight: 900, size: 280, stretch: 'extra-condensed' },
];

const measure = ({ fontData, samples }) => {
  const face = new FontFace('Archivo', `url(data:font/woff2;base64,${fontData})`, { weight: '100 900' });
  return face.load().then(() => {
    document.fonts.add(face);
    const ctx = document.createElement('canvas').getContext('2d');
    return samples.map(({ text, weight, size, stretch }) => {
      ctx.font = `${weight} ${size}px "Archivo"`;
      ctx.fontStretch = stretch;
      const m = ctx.measureText(text);
      const r = (v) => Math.round(v * 1000) / 1000;
      return { text, weight, size, stretch, width: r(m.width), left: r(m.actualBoundingBoxLeft), right: r(m.actualBoundingBoxRight), ascent: r(m.actualBoundingBoxAscent), descent: r(m.actualBoundingBoxDescent) };
    });
  });
};

test('ink-metrics probe', async (t) => {
  let browser;
  try { browser = await launchBrowser({ quiet: true }); } catch (error) { return t.skip(`no browser: ${error.message.split('\n')[0]}`); }
  try {
    const page = await (await browser.newContext()).newPage();
    await page.setContent('<body></body>');
    const rows = await page.evaluate(measure, { fontData: FONT, samples: SAMPLES });
    for (const row of rows) console.log(`ink-metrics: ${process.platform} ${JSON.stringify(row)}`);
  } finally {
    await browser.close();
  }
});
