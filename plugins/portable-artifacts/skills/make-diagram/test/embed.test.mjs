// make-explainer embeds diagrams from buildDiagram's { svg, css, data } plus
// viewerRuntime(); nothing from the page builder. This mounts exactly that.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildDiagram, viewerRuntime } from '../scripts/lib/api.mjs';
import { launchBrowser, haveBrowser, scratchDir, example } from './helpers/browser.mjs';

let browser;
after(() => browser?.close());

async function embedPage(spec, beforeMount = '') {
  const out = await buildDiagram(spec);
  const html = `<!doctype html><meta charset="utf-8"><title>embed</title>
<style>${out.css}
html,body{margin:0;height:100%}#stage{position:relative;width:900px;height:600px}#stage>svg{position:absolute;inset:0;width:100%;height:100%}</style>
<div id="stage">${out.svg}</div>
<script>${viewerRuntime()}</script>
<script>${beforeMount}window.ctl = PADiagram.mount(document.getElementById('stage'), ${JSON.stringify(out.data).replaceAll('<', '\\u003c')}, {});</script>`;
  const file = path.join(fs.mkdtempSync(path.join(scratchDir(), 'embed-')), 'embed.html');
  fs.writeFileSync(file, html);
  browser ??= await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(e.message));
  await page.goto(pathToFileURL(file).href);
  return { page, problems, out };
}

test('viewerRuntime mounts from buildDiagram output alone: hover traces and Present steps', async (t) => {
  if (!(await haveBrowser())) return t.skip('no browser');
  const { page, problems, out } = await embedPage(example('architecture'));
  await page.hover('.pa-node[data-id="web"]');
  const dim = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.pa-node')].map((n) => [n.dataset.id, n.classList.contains('pa-dim')])));
  assert.deepEqual(dim, { web: false, api: false, db: true, pay: true }, 'non-neighbours dim');
  await page.mouse.move(950, 650);
  assert.equal(await page.locator('.pa-dim').count(), 0);
  assert.equal(await page.evaluate(() => window.ctl.state().steps), out.steps.length);
  await page.evaluate(() => window.ctl.present(0));
  assert.ok((await page.locator('.pa-hidden').count()) > 0, 'unrevealed elements hide');
  assert.equal(await page.locator('#stage .pa-node[data-id="db"].pa-hidden').count(), 1);
  await page.evaluate(() => window.ctl.next());
  assert.equal(await page.locator('#stage .pa-node[data-id="db"].pa-hidden').count(), 0, 'step 2 reveals db');
  assert.equal(await page.evaluate(() => window.ctl.state().step), 1);
  assert.deepEqual(problems, []);
  await page.close();
});

test('a sequence mounts the same way', async (t) => {
  if (!(await haveBrowser())) return t.skip('no browser');
  const { page, problems } = await embedPage(example('sequence'));
  await page.evaluate(() => window.ctl.present(0));
  assert.equal(await page.locator('.pa-edge[data-id="m5"].pa-hidden').count(), 1);
  await page.evaluate(() => window.ctl.goTo(2));
  assert.equal(await page.locator('.pa-edge[data-id="m5"].pa-hidden').count(), 0);
  assert.deepEqual(problems, []);
  await page.close();
});

test('the viewer forwards the story hold hooks to the transport: hold(ms) on play, holdEnd() on pause', async (t) => {
  if (!(await haveBrowser())) return t.skip('no browser');
  // A spy wraps the transport's real hold/holdEnd: the log proves the viewer forwards the hooks and the originals still run (this embed passes no caption, so no ring shows).
  const spy = `window.holdLog = []; var make = PADiagram.transport; PADiagram.transport = function () {
    var tr = make.apply(this, arguments);
    var h = tr.hold; var e = tr.holdEnd;
    tr.hold = function (ms) { window.holdLog.push(['hold', ms]); return h.call(tr, ms); };
    tr.holdEnd = function () { window.holdLog.push(['end']); return e.call(tr); };
    return tr;
  };`;
  const { page, problems } = await embedPage(example('architecture'), spy);
  await page.evaluate(() => window.ctl.present(0));
  assert.deepEqual(await page.evaluate(() => window.holdLog), [], 'a paused beat reports no hold');
  await page.evaluate(() => { const st = document.getElementById('stage'); st.tabIndex = 0; st.focus(); });
  await page.keyboard.press('Space'); // play
  await page.waitForFunction(() => window.holdLog.length > 0, null, { timeout: 5000 });
  const [first] = await page.evaluate(() => window.holdLog);
  assert.equal(first[0], 'hold');
  assert.ok(first[1] >= 1800 && first[1] <= 4500, `hold ms ${first[1]} within HOLD_MS..HOLD_MAX_MS`);
  await page.keyboard.press('Space'); // pause
  const log = await page.evaluate(() => window.holdLog);
  assert.equal(log.filter((e) => e[0] === 'end').length, log.filter((e) => e[0] === 'hold').length, 'every hold ended, pausing included (a slow runner may have advanced a beat first)');
  assert.deepEqual(log.at(-1), ['end'], 'pausing ended the last hold');
  assert.deepEqual(problems, []);
  await page.close();
});
