// A spec with `theme` draws with the shared theme's fonts and dark colours; one without it is untouched.
// Render-smoke style: needs a browser, skips without one.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from '../scripts/lib/browser.mjs';
import { startServer, themeOrDefault } from '../scripts/lib/server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RENDER = path.join(root, 'scripts/render.mjs');
const made = [];
after(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });
const tmp = (p) => { const d = mkdtempSync(path.join(tmpdir(), p)); made.push(d); return d; };
async function haveBrowser() {
  try { await (await launchBrowser({ quiet: true })).close(); return true; } catch { return false; }
}

// blueprint: Geist body and Geist Mono, neither of which the unthemed page uses.
const BLUEPRINT = { page: '#0e1319', text: '#e8edf3', accent: '#6cb2e6' };
const rgb = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
const spec = (extra = {}, el = {}) => ({
  size: [480, 270],
  scenes: [{ id: 'one', duration: 1, elements: [
    { id: 'title', type: 'text', text: 'Hello', x: 240, y: 60, fontSize: 40, ...el },
    { id: 'code', type: 'text', text: 'node run.mjs', x: 240, y: 120, fontSize: 24, font: 'mono' },
    { id: 'bar', type: 'shape', shape: 'rect', x: 240, y: 170, width: 100, height: 20 },
    { id: 'chart', type: 'chart', x: 240, y: 230, width: 200, height: 60,
      vegaLite: { data: { values: [{ a: 'x', b: 2 }, { a: 'y', b: 5 }] }, mark: 'bar', encoding: { x: { field: 'a', type: 'nominal' }, y: { field: 'b', type: 'quantitative' } } } },
  ] }],
  ...extra,
});

// Open the render page for a spec and collect what was drawn.
async function drawn(motion) {
  const dir = tmp('theme-');
  writeFileSync(path.join(dir, 'm.json'), JSON.stringify(motion));
  const srv = await startServer({ specPath: path.join(dir, 'm.json'), mode: 'render' });
  const browser = await launchBrowser({ quiet: true });
  try {
    const page = await browser.newPage();
    const requests = [];
    const problems = [];
    page.on('request', (r) => requests.push(new URL(r.url()).pathname));
    page.on('pageerror', (e) => problems.push(e.message));
    // The browser's own /favicon.ico request is the one 404 every page gets.
    page.on('response', (r) => { if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) problems.push(`${r.status()} ${r.url()}`); });
    await page.goto(srv.url);
    await page.waitForFunction(() => window.__motion);
    await page.evaluate(() => window.__motion.ready);
    const look = await page.evaluate(() => {
      const css = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el) : {}; };
      const family = css('.el.text:not(.mono)').fontFamily;
      const mono = css('.el.text.mono').fontFamily;
      return {
        family, mono,
        color: css('.el.text:not(.mono)').color,
        stage: css('#stage').backgroundColor,
        page: getComputedStyle(document.documentElement).backgroundColor,
        loaded: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replaceAll('"', '')),
        firstWeight: document.querySelector('.el.text').style.fontWeight,
        shape: document.querySelector('.el.shape rect')?.getAttribute('fill'),
        chartFont: document.querySelector('.el.chart svg text')?.getAttribute('font-family'),
        chartMarks: document.querySelector('.el.chart svg').outerHTML.toLowerCase(),
      };
    });
    return { look, requests, problems };
  } finally { await browser.close(); await srv.close(); }
}

test('themed: text, mono text, shape, chart and stage use the theme fonts and dark colours; its fonts really load', async (t) => {
  if (!(await haveBrowser())) return t.skip('browser unavailable');
  const { look, problems, requests } = await drawn(spec({ theme: 'blueprint' }));
  assert.match(look.family, /^"?Geist"?, /); // the browser drops quotes around a one-word family
  assert.match(look.mono, /^"Geist Mono", /);
  assert.equal(look.color, rgb(BLUEPRINT.text));
  assert.equal(look.stage, rgb(BLUEPRINT.page));
  assert.equal(look.shape.toLowerCase(), BLUEPRINT.accent);
  assert.ok(look.loaded.includes('Geist') && look.loaded.includes('Geist Mono'), `fonts loaded: ${look.loaded}`);
  assert.match(look.chartFont, /^"?Geist"?(,|$)/);
  assert.ok(look.chartMarks.includes(BLUEPRINT.accent), 'the bars take the theme accent');
  assert.ok(requests.includes('/theme/blueprint.json') && requests.includes('/theme/blueprint.css'));
  assert.ok(requests.some((r) => r.startsWith('/theme/fonts/') && r.endsWith('.woff2')));
  assert.deepEqual(problems, []);
  return undefined;
});

test("themed: the spec's own colours and background still win", async (t) => {
  if (!(await haveBrowser())) return t.skip('browser unavailable');
  const { look } = await drawn(spec({ theme: 'blueprint', background: '#112233' }, { color: '#ff0000' }));
  assert.equal(look.stage, rgb('#112233'));
  assert.equal(look.color, 'rgb(255, 0, 0)');
  return undefined;
});

test('unthemed: Inter and the old colours, and the page never asks for a theme', async (t) => {
  if (!(await haveBrowser())) return t.skip('browser unavailable');
  const { look, requests, problems } = await drawn(spec());
  assert.match(look.family, /^Inter, /);
  assert.match(look.mono, /^"JetBrains Mono", /);
  assert.equal(look.color, 'rgb(255, 255, 255)');
  assert.equal(look.stage, rgb('#0b0d12'));
  assert.equal(look.shape, '#ffffff');
  assert.match(look.chartFont, /Inter/);
  assert.deepEqual(requests.filter((r) => r.startsWith('/theme')), []);
  assert.deepEqual(problems, []);
  return undefined;
});

test('themed contact sheet: renders, differs from the unthemed one, and is not blank', async (t) => {
  if (!(await haveBrowser())) return t.skip('browser unavailable');
  const dir = tmp('theme-cs-');
  const sheets = {};
  for (const name of ['themed', 'plain']) {
    writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(spec(name === 'themed' ? { theme: 'blueprint' } : {})));
    const out = path.join(dir, name);
    const r = spawnSync(process.execPath, [RENDER, path.join(dir, `${name}.json`), '--contact-sheet', '--out', out, '--size', '480x270'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(readdirSync(path.join(out, 'contact')), ['one.png']);
    sheets[name] = readFileSync(path.join(out, 'contact/one.png'));
  }
  assert.ok(sheets.themed.length > 2000, 'not blank');
  assert.notDeepEqual(sheets.themed, sheets.plain);
  return undefined;
});

// ---- fixed fonts: no synthetic bold -----------------------------------------------------------

test('themed: a requested weight maps to the nearest weight the theme font ships, mono default included', async (t) => {
  if (!(await haveBrowser())) return t.skip('browser unavailable');
  // blueprint ships Geist 400 and 600, and Geist Mono 400 only.
  const weights = { sans: [[undefined, '600'], [800, '600'], [700, '600'], [300, '400'], [400, '400']], mono: [[undefined, '400'], [700, '400']] };
  for (const [font, cases] of Object.entries(weights)) {
    for (const [asked, shipped] of cases) {
      const el = { id: 'w', type: 'text', text: 'x', x: 10, y: 10, ...(asked === undefined ? {} : { fontWeight: asked }), ...(font === 'mono' ? { font: 'mono' } : {}) };
      const { look } = await drawn({ theme: 'blueprint', size: [64, 64], scenes: [{ id: 's', duration: 1, elements: [el, { id: 'b', type: 'shape', shape: 'rect', x: 1, y: 1 }, { id: 'c', type: 'text', text: 'c', x: 1, y: 1, font: 'mono' }, { id: 'd', type: 'chart', x: 1, y: 1, width: 20, height: 20, vegaLite: { data: { values: [{ a: 'x', b: 2 }] }, mark: 'bar', encoding: { x: { field: 'a', type: 'nominal' }, y: { field: 'b', type: 'quantitative' } } } }] }] });
      assert.equal(look.firstWeight, shipped, `${font} weight ${asked ?? 'default'}`);
    }
  }
  return undefined;
});

test('unthemed: weights are used as asked (Inter ships them all)', async (t) => {
  if (!(await haveBrowser())) return t.skip('browser unavailable');
  const { look } = await drawn({ size: [64, 64], scenes: [{ id: 's', duration: 1, elements: [{ id: 'w', type: 'text', text: 'x', x: 10, y: 10, fontWeight: 800 }, { id: 'b', type: 'shape', shape: 'rect', x: 1, y: 1 }, { id: 'c', type: 'text', text: 'c', x: 1, y: 1, font: 'mono' }, { id: 'd', type: 'chart', x: 1, y: 1, width: 20, height: 20, vegaLite: { data: { values: [{ a: 'x', b: 2 }] }, mark: 'bar', encoding: { x: { field: 'a', type: 'nominal' }, y: { field: 'b', type: 'quantitative' } } } }] }] });
  assert.equal(look.firstWeight, '800');
  return undefined;
});

// ---- --theme on the render CLI (the page theme an embedding tool passes down) -------------------

const sheetOf = (dir, name, motion, extra = []) => {
  writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(motion));
  const out = path.join(dir, name);
  const r = spawnSync(process.execPath, [RENDER, path.join(dir, `${name}.json`), '--contact-sheet', '--out', out, '--size', '480x270', ...extra], { encoding: 'utf8' });
  return { r, png: r.status === 0 ? readFileSync(path.join(out, 'contact/one.png')) : null };
};

test('render --theme gives a spec without a theme that theme; a spec with its own keeps it', async (t) => {
  if (!(await haveBrowser())) return t.skip('browser unavailable');
  const dir = tmp('theme-flag-');
  const plain = sheetOf(dir, 'plain', spec());
  const flagged = sheetOf(dir, 'flagged', spec(), ['--theme', 'blueprint']);
  const embedded = sheetOf(dir, 'embedded', spec({ theme: 'blueprint' }));
  assert.equal(flagged.r.status, 0, flagged.r.stderr);
  assert.deepEqual(flagged.png, embedded.png, '--theme blueprint draws what "theme": "blueprint" draws');
  assert.notDeepEqual(flagged.png, plain.png);
  const own = sheetOf(dir, 'own', spec({ theme: 'ink' }), ['--theme', 'blueprint']);
  const ink = sheetOf(dir, 'ink', spec({ theme: 'ink' }));
  assert.deepEqual(own.png, ink.png, "the spec's own theme wins over --theme");
  return undefined;
});

test('render --theme with an unknown name is a usage error (exit 2) with a did-you-mean', () => {
  const dir = tmp('theme-bad-');
  writeFileSync(path.join(dir, 'm.json'), JSON.stringify(spec()));
  const r = spawnSync(process.execPath, [RENDER, path.join(dir, 'm.json'), '--contact-sheet', '--out', dir, '--theme', 'blueprnt'], { encoding: 'utf8' });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /--theme: unknown theme "blueprnt"; did you mean "blueprint"\?/);
  const missing = spawnSync(process.execPath, [RENDER, path.join(dir, 'm.json'), '--theme'], { encoding: 'utf8' });
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /--theme needs a value/);
});

test('with no theme named, make-motion falls back to dusk', () => {
  assert.equal(themeOrDefault(undefined).name, 'dusk');
  assert.equal(themeOrDefault('no-such-theme').name, 'dusk');
  assert.equal(themeOrDefault('paper').name, 'paper');
});
