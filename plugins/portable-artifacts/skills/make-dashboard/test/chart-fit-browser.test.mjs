// The example dashboard at phone width, in every theme: what the charts print must fit the room they have.
// Time axes never run their labels together, line end labels stay inside their pane, and a month the
// title names is labelled on the chart. Driven in a real browser on the shipped example and its data.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchBrowser, haveBrowser, buildProject } from './helpers/browser.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLE = JSON.parse(fs.readFileSync(path.join(ROOT, 'references/examples/sales-overview.json'), 'utf8'));
const THEMES = fs.readdirSync(path.join(ROOT, 'shared/themes')).map((f) => f.replace(/\.json$/, '')).sort();
const GAP = 2; // px of clear space two neighbouring axis labels keep at the least

let browser;
after(() => Promise.race([browser?.close().catch(() => {}), new Promise((r) => setTimeout(r, 15000).unref())]));

async function open(theme, width, scheme = 'light') {
  browser ??= await launchBrowser();
  const { out } = buildProject(EXAMPLE, { theme });
  const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
  const page = await context.newPage();
  await page.goto(pathToFileURL(path.join(out, 'index.html')).href);
  await page.waitForFunction(() => window.paReady === true, null, { timeout: 15000 });
  return { page, context };
}

// Per chart pane: its horizontal axes' visible labels (text and box, left to right) and its end-label boxes.
const chartBoxes = (page) => page.evaluate(() => [...document.querySelectorAll('.chart')].map((pane) => {
  const box = (el) => { const r = el.getBoundingClientRect(); return { text: el.textContent, left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
  const shown = (el) => Number(getComputedStyle(el).opacity) > 0 && el.getAttribute('opacity') !== '0' && el.textContent.trim() !== '';
  const axes = [...pane.querySelectorAll('g.role-axis')].map((axis) => [...axis.querySelectorAll('g.role-axis-label text')].filter(shown).map(box))
    .filter((labels) => labels.length > 1 && labels.every((l) => Math.abs(l.top - labels[0].top) < 1))
    .map((labels) => labels.sort((a, b) => a.left - b.left));
  const p = pane.getBoundingClientRect();
  return { id: pane.id, axes, pane: { left: p.left, right: p.right }, texts: [...pane.querySelectorAll('g.mark-text text')].filter(shown).map(box) };
}));

// The claimed bar's fill against the page's own --accent, and every text on the two monthly charts.
const claimFacts = (page) => page.evaluate(() => {
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim().toLowerCase();
  const fills = [...document.querySelectorAll('#chart-c1 g.mark-rect path')].map((p) => (p.getAttribute('fill') ?? '').toLowerCase());
  const texts = (id) => [...document.querySelectorAll(`#${id} g.mark-text text`)].map((t) => t.textContent);
  return { accent, fills, c3: texts('chart-c3'), c5: texts('chart-c5'), c1: texts('chart-c1') };
});

for (const theme of THEMES) {
  for (const scheme of ['light', 'dark']) {
    test(`the claimed bar takes the accent, the others one neutral; the named months are labelled on their charts (${theme} ${scheme}, 390px)`, async (t) => {
      if (!(await haveBrowser())) return t.skip('no browser');
      const { page, context } = await open(theme, 390, scheme);
      try {
        const f = await claimFacts(page);
        assert.equal(f.fills.length, 4, 'four region bars');
        assert.equal(f.fills.filter((x) => x === f.accent).length, 1, `one bar in the accent ${f.accent}: ${f.fills}`);
        assert.equal(new Set(f.fills.filter((x) => x !== f.accent)).size, 1, `the other three share one neutral: ${f.fills}`);
        assert.ok(f.c1.some((x) => /^\$/.test(x)), `the bars carry their values: ${f.c1}`);
        assert.ok(f.c3.some((x) => x.startsWith('Aug 2025')), `August is labelled on its chart: ${f.c3}`);
        assert.ok(f.c5.some((x) => x.startsWith('Feb 2025')), `February is labelled on its chart: ${f.c5}`);
      } finally {
        await context.close();
      }
    });
  }
}

for (const theme of THEMES) {
  test(`at 390px the time-axis labels never run together (${theme})`, async (t) => {
    if (!(await haveBrowser())) return t.skip('no browser');
    const { page, context } = await open(theme, 390);
    try {
      const charts = await chartBoxes(page);
      const timeAxes = charts.flatMap((c) => c.axes.filter((labels) => labels.some((l) => /\b20\d\d\b|\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/.test(l.text))).map((labels) => ({ id: c.id, labels })));
      assert.ok(timeAxes.length >= 2, `the example's two monthly charts have a time axis (${timeAxes.length})`);
      const crowded = timeAxes.flatMap(({ id, labels }) => labels.slice(1).map((l, i) => [labels[i], l])
        .filter(([a, b]) => b.left - a.right < GAP).map(([a, b]) => `${id}: "${a.text}" | "${b.text}" ${Math.round(b.left - a.right)}px`));
      assert.deepEqual(crowded, []);
    } finally {
      await context.close();
    }
  });

  test(`at 390px every label drawn on a chart sits inside its pane (${theme})`, async (t) => {
    if (!(await haveBrowser())) return t.skip('no browser');
    const { page, context } = await open(theme, 390);
    try {
      const charts = await chartBoxes(page);
      assert.ok(charts.some((c) => c.texts.some((x) => x.text === 'South')), 'the running-revenue chart labels its line ends');
      const out = charts.flatMap((c) => c.texts.filter((x) => x.left < c.pane.left - 0.5 || x.right > c.pane.right + 0.5)
        .map((x) => `${c.id}: "${x.text}" ${Math.round(x.left - c.pane.left)}..${Math.round(x.right - c.pane.left)} of ${Math.round(c.pane.right - c.pane.left)}`));
      assert.deepEqual(out, []);
    } finally {
      await context.close();
    }
  });
}
