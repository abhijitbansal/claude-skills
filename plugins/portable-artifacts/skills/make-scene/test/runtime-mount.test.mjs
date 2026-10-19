// Browser checks for mount(): fallback toggling, teardown and key handling. Skips itself without
// Chromium or WebGL (the full-page browser tests are Task 9's).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadTheme, themeCss } from '../shared/theme.mjs';
import { BUNDLE_FILE } from '../scripts/lib/bundle.mjs';

const GOLDEN = new URL('./golden/city.json', import.meta.url);
const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

let browser = null;
let skipReason = null;

before(async () => {
  try {
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ args: ARGS });
  } catch (err) {
    skipReason = `no Chromium (${err.message.split('\n')[0]})`;
  }
});
after(async () => {
  await browser?.close();
});

// wrapper: true puts the canvas in a [data-scene-canvas] element, false mounts straight into the host.
function pageHtml({ wrapper, graph = fs.readFileSync(GOLDEN, 'utf8') }) {
  const bundle = fs.readFileSync(BUNDLE_FILE, 'utf8');
  const inner = wrapper
    ? '<div id="cv" data-scene-canvas style="position:absolute;inset:0"></div>'
    : '';
  return `<!doctype html><html><head><meta charset="utf-8"><style>${themeCss(loadTheme('dusk'))}
    #host{position:relative;width:640px;height:400px} #fb{display:block;background:#eee} #ctl{display:flex}</style></head>
    <body><div id="host">${inner}<div id="fb" data-scene-fallback>table</div><div id="ctl" data-scene-controls>controls</div></div>
    <script>${bundle.replaceAll('</script', '<\\/script')}</script>
    <script>window.GRAPH=${graph};window.errors=[];window.addEventListener('error',e=>errors.push(e.message));
    window.docKeys=[];document.addEventListener('keydown',e=>docKeys.push(e.key));</script></body></html>`;
}

async function open(t, options = {}) {
  if (!browser) return t.skip(skipReason) ?? null;
  const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
  t.after(() => context.close());
  const page = await context.newPage();
  const logs = [];
  page.on('console', (m) => {
    if (m.type() === 'error') logs.push(m.text());
  });
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
  await page.setContent(pageHtml(options));
  await page.evaluate((reduced) => {
    window.API = PAScene.mount(document.getElementById('host'), GRAPH, { reducedMotion: reduced });
  }, options.reducedMotion ?? true);
  await page.waitForTimeout(300);
  if ((await page.evaluate(() => document.getElementById('host').dataset.sceneState)) !== 'ready') {
    t.skip('WebGL unavailable in this Chromium');
    return null;
  }
  return { page, logs };
}

const display = (page, selector) => page.evaluate((s) => getComputedStyle(document.querySelector(s)).display, selector);

for (const wrapper of [false, true]) {
  test(`context loss hides canvas, wrapper and controls and shows the fallback (wrapper: ${wrapper})`, async (t) => {
    const ctx = await open(t, { wrapper });
    if (!ctx) return;
    const { page, logs } = ctx;
    assert.equal(await display(page, '#ctl'), 'flex');
    await page.evaluate(() => {
      window.EXT = API.canvas.getContext('webgl2').getExtension('WEBGL_lose_context');
      EXT.loseContext();
    });
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => document.getElementById('host').dataset.sceneState), 'fallback');
    assert.equal(await display(page, 'canvas'), 'none');
    if (wrapper) assert.equal(await display(page, '#cv'), 'none');
    assert.equal(await display(page, '#ctl'), 'none');
    assert.equal(await display(page, '#fb'), 'block');
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('fb')).position), 'static', 'fully visible again');
    await page.evaluate(() => EXT.restoreContext());
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => document.getElementById('host').dataset.sceneState), 'ready');
    assert.equal(await display(page, 'canvas'), 'block');
    assert.deepEqual(logs, []);
  });
}

test('while the 3D view works the fallback is visually hidden but still in the accessibility tree', async (t) => {
  const ctx = await open(t, { wrapper: false });
  if (!ctx) return;
  const style = await ctx.page.evaluate(() => {
    const el = document.getElementById('fb');
    const cs = getComputedStyle(el);
    return { hidden: el.hidden, display: cs.display, position: cs.position, width: cs.width, height: cs.height, overflow: cs.overflow };
  });
  assert.deepEqual(style, { hidden: false, display: 'block', position: 'absolute', width: '1px', height: '1px', overflow: 'hidden' });
});

test('only the arrow keys are consumed: other keys reach the document', async (t) => {
  const ctx = await open(t, { wrapper: false, reducedMotion: false });
  if (!ctx) return;
  const { page } = ctx;
  await page.focus('canvas');
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowRight');
  assert.deepEqual(await page.evaluate(() => docKeys), [' '], 'arrows stop at the canvas, Space bubbles');
});

test('a throw during mount releases what was built: no live loop, context lost, fallback shown', async (t) => {
  if (!browser) return t.skip(skipReason);
  const ctx = await open(t, { wrapper: false });
  if (!ctx) return;
  const { page, logs } = ctx;
  const result = await page.evaluate(async () => {
    const bad = { ...GRAPH, bounds: undefined };
    const host = document.createElement('div');
    host.innerHTML = '<div data-scene-fallback>t</div>';
    document.body.append(host);
    PAScene.mount(host, bad, {});
    await new Promise((r) => setTimeout(r, 400));
    const canvas = host.querySelector('canvas');
    return { state: host.dataset.sceneState, lost: canvas.getContext('webgl2')?.isContextLost() ?? 'no-context', errors };
  });
  assert.equal(result.state, 'fallback');
  assert.ok(result.lost === true || result.lost === 'no-context');
  assert.deepEqual(result.errors, []);
  assert.deepEqual(logs, []);
});

test('a throw inside a frame falls back and cleans up without uncaught errors', async (t) => {
  const ctx = await open(t, { wrapper: false });
  if (!ctx) return;
  const { page, logs } = ctx;
  await page.evaluate(() => {
    Object.defineProperty(window, 'devicePixelRatio', { get() { throw new Error('boom'); } });
    API.wake('test');
  });
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => document.getElementById('host').dataset.sceneState), 'fallback');
  assert.equal(await display(page, 'canvas'), 'none');
  assert.deepEqual(await page.evaluate(() => errors), []);
  assert.deepEqual(logs, []);
});

test('destroy() releases the GL context and removes the canvas; calling it twice is safe', async (t) => {
  const ctx = await open(t, { wrapper: false });
  if (!ctx) return;
  const { page, logs } = ctx;
  const after = await page.evaluate(() => {
    const canvas = API.canvas;
    API.destroy();
    API.destroy();
    return { attached: canvas.isConnected, lost: canvas.getContext('webgl2').isContextLost() };
  });
  assert.deepEqual(after, { attached: false, lost: true });
  await page.waitForTimeout(300);
  assert.deepEqual(await page.evaluate(() => errors), []);
  assert.deepEqual(logs, []);
});
