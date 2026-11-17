// make.mjs <film> --preview: the page in a headless browser with the network guarded (no blocked request), driven
// through its own controls; the child process stopped with SIGTERM exits 0 and closes its port. Skips without a browser.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HERE, browserAvailable } from './helpers/session.mjs';
import '../../scripts/v2/list.mjs';
import { loadFilm } from '../../scripts/v2/pipeline.mjs';
import { openSession, launchRunBrowser } from '../../scripts/v2/session.mjs';
import { guardNetwork } from '../../scripts/lib/browser.mjs';
import { runPreview, openUrl } from '../../scripts/v2/viewer-run.mjs';

const MAKE = path.resolve(HERE, '../../../scripts/make.mjs');
const BAR = (fill) => ({ type: 'path', id: 'bar', props: { d: 'M300 500H1620V580H300Z', fill } });
const filmOf = (ground, extra = {}) => ({ version: 2, fps: 30, generatedBy: { model: 'm1' }, ...extra, shots: [
  { id: 'a', show: 'free', hold: 1, background: ground, nodes: [BAR('#15130f')] },
  { id: 'b', show: 'free', hold: 1, background: '#1f4e8c', cut: 'cut', nodes: [BAR('#ffe14a')] },
] });
const READY = () => document.body.dataset.ready === 'true' || document.body.classList.contains('invalid');

let dir, browser, child, url, page;
const blocked = [];
const filmFile = () => path.join(dir, 'film.json');
const writeFilm = (film) => writeFileSync(filmFile(), JSON.stringify(film));

// The preview as a child process: resolves its URL from the first line it prints.
function startPreview(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [MAKE, filmFile(), '--preview', '--json', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    proc.stderr.on('data', (d) => { err += d; });
    proc.stdout.on('data', (d) => {
      out += d;
      if (out.includes('\n')) resolve({ proc, line: JSON.parse(out.split('\n')[0]) });
    });
    proc.on('exit', (code) => reject(new Error(`preview exited ${code} before printing: ${out}${err}`)));
  });
}

const sourceHash = (p) => p.evaluate(async () => {
  const blob = await window.__source.convertToBlob({ type: 'image/png' });
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
});
const frameShown = (n) => page.waitForFunction((i) => window.__viewer.p.frame === i && !window.__viewer.p.busy, n);

before(async () => {
  if (!await browserAvailable()) return;
  dir = mkdtempSync(path.join(tmpdir(), 'mm-viewer-b-'));
  writeFilm(filmOf('#f3eee3'));
  ({ proc: child, line: { preview: { url } } } = await startPreview([]));
  browser = await launchRunBrowser();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(() => {
    window.__copied = [];
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text) => { window.__copied.push(text); } } });
  });
  page = await context.newPage();
  await guardNetwork(page, new URL(url).origin, (u) => blocked.push(u));
  await page.goto(url);
  await page.waitForFunction(READY);
});
after(async () => {
  await browser?.close();
  if (child && child.exitCode === null) child.kill('SIGKILL');
  if (dir) rmSync(dir, { recursive: true, force: true });
});

test('the scrubber at frame n shows the pixels __seek(n) gives on the render page', async (t) => {
  if (!browser) return t.skip('no browser');
  const session = await openSession(loadFilm(filmFile()), { browser });
  try {
    for (const n of [10, 40]) {
      await page.$eval('#scrub', (el, i) => { el.value = String(i); el.dispatchEvent(new Event('input')); }, n);
      await frameShown(n);
      await session.page.evaluate((i) => window.__seek(i), n);
      assert.equal(await sourceHash(page), await sourceHash(session.page), `frame ${n}`);
    }
  } finally {
    await session.close();
  }
});

test('Space toggles play, and the arrow keys move one frame', async (t) => {
  if (!browser) return t.skip('no browser');
  await page.keyboard.press('Space');
  assert.equal(await page.evaluate(() => window.__viewer.p.playing), true);
  await page.keyboard.press('Space');
  assert.equal(await page.evaluate(() => window.__viewer.p.playing), false);
  await page.$eval('#scrub', (el) => { el.value = '20'; el.dispatchEvent(new Event('input')); });
  await frameShown(20);
  await page.locator('#stage').focus().catch(() => {});
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('ArrowRight');
  await frameShown(21);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await frameShown(19);
});

test('a click on an element copies its path in the film; the footer shows the provenance line', async (t) => {
  if (!browser) return t.skip('no browser');
  await page.$eval('#scrub', (el) => { el.value = '10'; el.dispatchEvent(new Event('input')); });
  await frameShown(10);
  const box = await page.locator('#stage').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + (540 / 1080) * box.height);
  const copied = await page.evaluate(() => window.__copied);
  assert.equal(copied.length, 1);
  assert.equal(copied[0], 'shots[0]  id=a  node=bar');
  assert.match(await page.textContent('#toast'), /^shots\[0\]/);
  assert.match(await page.textContent('#provenance'), /^make-motion · m1 · effort not reported/);
});

test('an edit reloads the page; an invalid edit shows the validator\'s line; a valid one brings the film back', async (t) => {
  if (!browser) return t.skip('no browser');
  const before = await sourceHash(page);
  let reload = page.waitForEvent('load');
  writeFilm(filmOf('#c43d2f'));
  await reload;
  await page.waitForFunction(READY);
  assert.notEqual(await sourceHash(page), before, 'the new background is drawn');
  reload = page.waitForEvent('load');
  writeFileSync(filmFile(), JSON.stringify({ ...filmOf('#c43d2f'), shots: [{ id: 'a', show: 'free', hold: -1, nodes: [] }] }));
  await reload;
  await page.waitForFunction(READY);
  assert.equal(await page.evaluate(() => document.body.classList.contains('invalid')), true);
  assert.match(await page.textContent('#errors'), /shots\[0\]\.hold/);
  reload = page.waitForEvent('load');
  writeFilm(filmOf('#f3eee3', { provenance: false }));
  await reload;
  await page.waitForFunction(READY);
  assert.equal(await page.evaluate(() => document.body.classList.contains('invalid')), false);
  assert.equal(await page.textContent('#provenance'), '', 'provenance: false leaves the footer empty');
});

test('no request left the preview\'s origin', (t) => {
  if (!browser) return t.skip('no browser');
  assert.deepEqual(blocked, []);
});

test('SIGTERM stops the preview cleanly: exit 0 and the port closed', async (t) => {
  if (!browser) return t.skip('no browser');
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  child.kill('SIGTERM');
  assert.deepEqual(await exited, { code: 0, signal: null });
  await assert.rejects(fetch(`${url}/state`));
});

test('--open calls the opener once with the URL; nothing is opened without it; a remote URL is refused', async (t) => {
  if (!browser) return t.skip('no browser');
  writeFilm(filmOf('#f3eee3'));
  const run = async (open) => {
    const opened = [];
    const controller = new AbortController();
    const result = runPreview({ specPath: filmFile(), open, json: false, provenance: { noProvenance: false } }, {
      signal: controller.signal, opener: (u) => opened.push(u), say: (line) => { opened.url = line; controller.abort(); },
    });
    assert.deepEqual(await result, { exitCode: 0 });
    return opened;
  };
  const withOpen = await run(true);
  assert.equal(withOpen.length, 1);
  assert.match(withOpen[0], /^http:\/\/127\.0\.0\.1:\d+\/preview$/);
  assert.equal(withOpen.url, `preview: ${withOpen[0]}`);
  assert.equal((await run(false)).length, 0);
  assert.throws(() => openUrl('https://example.com/'), /refusing to open/);
});
