// A spec with `theme` draws with the shared theme's fonts and dark colours; one without it is untouched.
// Render-smoke style: needs a browser, skips without one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from '../scripts/lib/browser.mjs';
import { startServer } from '../scripts/lib/server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RENDER = path.join(root, 'scripts/render.mjs');
const tmp = (p) => mkdtempSync(path.join(tmpdir(), p));
async function haveBrowser() {
  try { await (await launchBrowser({ quiet: true })).close(); return true; } catch { return false; }
}

// blueprint: IBM Plex Sans body and IBM Plex Mono, neither of which the unthemed page uses.
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
      const css = (sel) => getComputedStyle(document.querySelector(sel));
      const family = css('.el.text:not(.mono)').fontFamily;
      const mono = css('.el.text.mono').fontFamily;
      return {
        family, mono,
        color: css('.el.text:not(.mono)').color,
        stage: css('#stage').backgroundColor,
        page: getComputedStyle(document.documentElement).backgroundColor,
        loaded: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replaceAll('"', '')),
        shape: document.querySelector('.el.shape rect').getAttribute('fill'),
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
  assert.match(look.family, /^"IBM Plex Sans", /);
  assert.match(look.mono, /^"IBM Plex Mono", /);
  assert.equal(look.color, rgb(BLUEPRINT.text));
  assert.equal(look.stage, rgb(BLUEPRINT.page));
  assert.equal(look.shape.toLowerCase(), BLUEPRINT.accent);
  assert.ok(look.loaded.includes('IBM Plex Sans') && look.loaded.includes('IBM Plex Mono'), `fonts loaded: ${look.loaded}`);
  assert.match(look.chartFont, /IBM Plex Sans/);
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
