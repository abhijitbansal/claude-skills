// TEMPORARY diagnostic (delete once the Linux text-metrics failures are settled). It asserts nothing: it prints, per
// Chromium launch setting, how wide Archivo "Rag" measures at 24 px x8 and at 192 px (equal where advances are
// fractional, 43 x 8 = 344 against 350 where each glyph advance is rounded to a whole pixel), so one CI run says which
// setting restores fractional advances on Linux. Read the `text-metrics:` lines in the job log.
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FONT = readFileSync(path.resolve(HERE, '../../engine/fonts/archivo-latin-standard-normal.woff2')).toString('base64');
const VARIANTS = [
  { name: 'default', args: [] },
  { name: 'hinting-none', args: ['--font-render-hinting=none'] },
  { name: 'subpixel-flag', args: ['--enable-font-subpixel-positioning'] },
  { name: 'hinting-none+subpixel-flag', args: ['--font-render-hinting=none', '--enable-font-subpixel-positioning'] },
  { name: 'default-dsf2', args: [], deviceScaleFactor: 2 },
];

const MONO = readFileSync(path.resolve(HERE, '../../../../shared/fonts/jetbrains-mono-latin-400-normal.woff2')).toString('base64');

const measure = ({ fontData, monoData }) => {
  const face = new FontFace('Archivo', `url(data:font/woff2;base64,${fontData})`, { weight: '100 900' });
  const mono = new FontFace('JetBrains Mono', `url(data:font/woff2;base64,${monoData})`, { weight: '400' });
  return Promise.all([face.load(), mono.load()]).then(() => {
    document.fonts.add(face);
    document.fonts.add(mono);
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = '400 11px "JetBrains Mono"';
    const dashboard = { month: ctx.measureText('Jan 2025').width, money: ctx.measureText('$1,000').width }; // 52.8 and 39.6 unrounded
    const widths = (rendering) => {
      if (rendering) ctx.textRendering = rendering;
      const at = (size, scale) => { ctx.font = `400 ${size}px "Archivo"`; return ctx.measureText('Rag').width * scale; };
      return { px24x8: at(24, 8), px192: at(192, 1), px24: at(24, 1) / 1 };
    };
    const span = document.createElement('span');
    span.style.cssText = 'font: 400 24px Archivo; position: absolute; white-space: nowrap';
    span.textContent = 'Rag';
    document.body.append(span);
    return { auto: widths(undefined), geometricPrecision: widths('geometricPrecision'), dom24: span.getBoundingClientRect().width, jetbrains11: dashboard, ua: navigator.userAgent };
  });
};

for (const variant of VARIANTS) {
  test(`text-metrics probe: ${variant.name}`, async (t) => {
    let browser;
    try { browser = await chromium.launch({ args: variant.args }); } catch (error) { return t.skip(`no browser: ${error.message.split('\n')[0]}`); }
    try {
      const context = await browser.newContext({ deviceScaleFactor: variant.deviceScaleFactor ?? 1 });
      const page = await context.newPage();
      await page.setContent('<body></body>');
      const result = await page.evaluate(measure, { fontData: FONT, monoData: MONO });
      console.log(`text-metrics: ${process.platform} ${variant.name} ${JSON.stringify(result)}`);
    } finally {
      await browser.close();
    }
  });
}
