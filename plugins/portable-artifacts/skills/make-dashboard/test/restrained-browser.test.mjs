// The example dashboard's colour and phone layout, in every theme, on the shipped example and its data:
// multi-series charts paint the claimed series in the accent and the rest in neutrals (never the categorical
// palette), lines take the theme accent, a phone's date ticks step evenly by month, the February note keeps clear
// of the y axis, and a month note prints its value as the axis prints whole numbers.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchBrowser, haveBrowser, buildProject } from './helpers/browser.mjs';
import { loadTheme } from '../shared/theme.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLE = JSON.parse(fs.readFileSync(path.join(ROOT, 'references/examples/sales-overview.json'), 'utf8'));
const THEMES = fs.readdirSync(path.join(ROOT, 'shared/themes')).map((f) => f.replace(/\.json$/, '')).sort();
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

let browser;
after(() => Promise.race([browser?.close().catch(() => {}), new Promise((r) => setTimeout(r, 15000).unref())]));

async function open(theme, width, scheme) {
  browser ??= await launchBrowser();
  const { out } = buildProject(EXAMPLE, { theme });
  const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto(pathToFileURL(path.join(out, 'index.html')).href);
  await page.waitForFunction(() => window.paReady === true, null, { timeout: 15000 });
  return { page, context };
}

const facts = (page) => page.evaluate(() => {
  const hex = (c) => {
    const m = (c ?? '').match(/\d+(\.\d+)?/g);
    if (!m || /^#/.test(c ?? '')) return (c ?? '').toLowerCase();
    return `#${m.slice(0, 3).map((v) => Math.round(Number(v)).toString(16).padStart(2, '0')).join('')}`;
  };
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim().toLowerCase();
  const attrs = (sel, a) => [...document.querySelectorAll(sel)].map((el) => hex(el.getAttribute(a)));
  const box = (el) => { const r = el.getBoundingClientRect(); return { text: el.textContent, left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
  const shown = (el) => Number(getComputedStyle(el).opacity) > 0 && el.getAttribute('opacity') !== '0' && el.textContent.trim() !== '';
  const axisLabels = (id) => [...document.querySelectorAll(`#${id} g.role-axis`)].map((a) => [...a.querySelectorAll('g.role-axis-label text')].filter(shown).map(box));
  const notes = (id) => [...document.querySelectorAll(`#${id} g.mark-text text`)].filter(shown).map(box);
  return {
    accent,
    // what a failed tick assertion needs to be read without a rerun: the faces' load state and each chart's drawn width
    fonts: [...document.fonts].map((f) => `${f.family} ${f.weight} ${f.status}`),
    widths: { c3: document.querySelector('#chart-c3')?.getBoundingClientRect().width, c5: document.querySelector('#chart-c5')?.getBoundingClientRect().width },
    c4: [...new Set(attrs('#chart-c4 g.mark-rect path', 'fill'))],
    c6: [...new Set(attrs('#chart-c6 g.mark-line path', 'stroke'))],
    c3: [...new Set(attrs('#chart-c3 g.mark-line path', 'stroke'))],
    axes: { c3: axisLabels('chart-c3'), c5: axisLabels('chart-c5') },
    notes: { c3: notes('chart-c3'), c5: notes('chart-c5') },
  };
});

const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
// The x axis is the axis whose labels share one row; the y axis is the one whose labels share a column.
const xAxis = (axes) => axes.find((labels) => labels.length > 1 && labels.every((l) => Math.abs(l.top - labels[0].top) < 1)) ?? [];
const yAxis = (axes) => axes.find((labels) => labels.length > 1 && !labels.every((l) => Math.abs(l.top - labels[0].top) < 1)) ?? [];
const monthIndex = (text) => {
  const m = text.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w* (20\d\d)$/);
  return m ? Number(m[2]) * 12 + MONTHS.indexOf(m[1]) : null;
};

for (const width of [1280, 390]) {
  test(`the tallest bar stays under the top gridline: the value axis takes headroom over the data (${width}px)`, async (t) => {
    if (!(await haveBrowser())) return t.skip('no browser');
    const { page, context } = await open('paper', width, 'light');
    try {
      const f = await page.evaluate(() => {
        const tops = [...document.querySelectorAll('#chart-c1 g.mark-rect path')].map((p) => p.getBoundingClientRect().top);
        const grid = [...document.querySelectorAll('#chart-c1 g.role-axis-grid line, #chart-c1 g.role-axis-grid path')].map((l) => l.getBoundingClientRect().top);
        return { bar: Math.min(...tops), grid: Math.min(...grid), n: grid.length };
      });
      assert.ok(f.n >= 2, 'the premise: gridlines drawn');
      assert.ok(f.bar >= f.grid - 0.5, `the tallest bar top ${f.bar.toFixed(1)} is under the top gridline ${f.grid.toFixed(1)}`);
    } finally {
      await context.close();
    }
  });
}

for (const theme of THEMES) {
  for (const scheme of ['light', 'dark']) {
    test(`multi-series charts claim in the accent and keep the rest neutral; lines take the accent (${theme} ${scheme})`, async (t) => {
      if (!(await haveBrowser())) return t.skip('no browser');
      const cats = Array.from({ length: 8 }, (_, i) => loadTheme(theme)[scheme][`cat${i + 1}`].toLowerCase());
      const { page, context } = await open(theme, 1280, scheme);
      try {
        const f = await facts(page);
        const palette = (list) => list.filter((c) => c !== f.accent && cats.includes(c));
        assert.ok(f.c4.includes(f.accent), `grouped bars: East in the accent ${f.accent}: ${f.c4}`);
        assert.deepEqual(palette(f.c4), [], `grouped bars: no categorical colour besides the accent: ${f.c4}`);
        assert.ok(f.c6.includes(f.accent), `running revenue: East in the accent: ${f.c6}`);
        assert.deepEqual(palette(f.c6), [], `running revenue: no categorical colour besides the accent: ${f.c6}`);
        assert.deepEqual(f.c3, [f.accent], 'the single-series line is the accent');
      } finally {
        await context.close();
      }
    });
  }

  test(`at 390px date ticks step evenly by month, the February note clears the y axis, notes print whole values (${theme})`, async (t) => {
    if (!(await haveBrowser())) return t.skip('no browser');
    const { page, context } = await open(theme, 390, 'light');
    try {
      const f = await facts(page);
      for (const id of ['c3', 'c5']) {
        const months = xAxis(f.axes[id]).map((l) => monthIndex(l.text));
        const seen = `${id}: month ticks ${xAxis(f.axes[id]).map((l) => l.text)}; tick widths ${xAxis(f.axes[id]).map((l) => (l.right - l.left).toFixed(1))}; `
          + `y labels ${yAxis(f.axes[id]).map((l) => `${l.text} ${(l.right - l.left).toFixed(1)}`)}; chart ${f.widths[id]} px wide; fonts ${f.fonts.join(', ')}`;
        assert.ok(months.length >= 3 && months.every((m) => m !== null), seen);
        const steps = new Set(months.slice(1).map((m, i) => m - months[i]));
        assert.equal(steps.size, 1, `${id}: one step between ticks: ${xAxis(f.axes[id]).map((l) => l.text)}`);
      }
      const feb = f.notes.c5.find((n) => n.text.startsWith('Feb 2025'));
      assert.ok(feb, 'the February note shows');
      const hits = yAxis(f.axes.c5).filter((l) => overlaps(l, feb)).map((l) => l.text);
      assert.deepEqual(hits, [], 'the February note overlaps no y-axis label');
      assert.ok(feb.left >= Math.max(...yAxis(f.axes.c5).map((l) => l.right)), 'and starts right of the y-axis labels');
      const aug = f.notes.c3.find((n) => n.text.startsWith('Aug 2025'));
      assert.match(aug?.text ?? '', /^Aug 2025 · \$\d{1,3}(,\d{3})+$/, `the August note prints whole dollars: ${aug?.text}`);
    } finally {
      await context.close();
    }
  });
}
