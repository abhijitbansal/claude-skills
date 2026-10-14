import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { slugify } from '../scripts/lib/output.mjs';
import { launchBrowser, haveBrowser, buildPage, scratchDir, EXAMPLES, example } from './helpers/browser.mjs';
import { PROTOTYPE_NAMED_SPECS } from './helpers/prototype-ids.mjs';

let browser;
after(() => browser?.close());

const pages = {};
const built = (name) => (pages[name] ??= buildPage(example(name), { name }));

// Opens a built page; collects every console error/warning and page error.
async function open(url, { width = 1440, height = 900, colorScheme = 'light', reducedMotion = 'no-preference', blockStorage = false, hash = '' } = {}) {
  browser ??= await launchBrowser();
  const context = await browser.newContext({ viewport: { width, height }, colorScheme, reducedMotion, acceptDownloads: true });
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(e.message));
  if (blockStorage) {
    await page.addInitScript(() => {
      for (const name of ['localStorage', 'sessionStorage']) {
        Object.defineProperty(window, name, { get() { throw new DOMException('denied', 'SecurityError'); } });
      }
    });
  }
  await page.goto(url + hash);
  await page.waitForFunction(() => window.paReady === true, null, { timeout: 15000 });
  return { page, problems, context };
}

const skipUnlessBrowser = async (t) => {
  if (await haveBrowser()) return false;
  t.skip('no browser (bundled Chromium or system Chrome)');
  return true;
};

const viewBox = (page) => page.evaluate(() => document.querySelector('#pa-stage svg').getAttribute('viewBox').split(' ').map(Number));
const zoom = (page) => page.evaluate(() => Number(document.getElementById('pa-stage').dataset.zoom));
// Waits until the viewBox has held still for QUIET_MS (a camera tween or a
// resize refit has finished); polls every frame instead of sleeping a fixed time.
const QUIET_MS = 100;
const settle = async (page) => {
  await page.evaluate(() => { delete window.__settle; });
  await page.waitForFunction((quiet) => {
    const now = performance.now();
    const vb = document.querySelector('#pa-stage svg').getAttribute('viewBox');
    const s = (window.__settle ??= { vb, at: now });
    if (s.vb !== vb) { s.vb = vb; s.at = now; }
    return now - s.at >= quiet;
  }, QUIET_MS, { polling: 'raf', timeout: 10000 });
};
const classes = (page, sel) => page.evaluate((s) => [...document.querySelector(s).classList], sel);
const stageCentre = async (page) => {
  const r = await page.locator('#pa-stage').boundingBox();
  return { x: r.x + r.width / 2, y: r.y + 5 };
};

// ---- every example renders ------------------------------------------------------------

for (const name of EXAMPLES) {
  for (const width of [1440, 390]) {
    test(`${name} renders at ${width} px with no console problems and no page overflow`, async (t) => {
      if (await skipUnlessBrowser(t)) return;
      const { page, problems, context } = await open(built(name).url, { width, height: width === 390 ? 780 : 900 });
      const fit = await page.evaluate(() => {
        const [x, y, w, h] = document.querySelector('#pa-stage svg').getAttribute('viewBox').split(' ').map(Number);
        return { x, y, w, h, fits: document.documentElement.scrollWidth <= window.innerWidth && document.documentElement.scrollHeight <= window.innerHeight };
      });
      assert.ok(fit.fits, 'no page overflow');
      const size = await page.evaluate(() => JSON.parse(document.getElementById('pa-data').textContent));
      assert.ok(fit.x <= 0.01 && fit.y <= 0.01 && fit.x + fit.w >= size.width - 0.01 && fit.y + fit.h >= size.height - 0.01, 'the first view shows the whole diagram');
      assert.ok(Math.abs((await zoom(page)) - 1) < 0.001);
      assert.deepEqual(problems, []);
      await context.close();
    });
  }

  test(`${name}: screenshots in light and dark`, async (t) => {
    if (await skipUnlessBrowser(t)) return;
    for (const colorScheme of ['light', 'dark']) {
      const { page, problems, context } = await open(built(name).url, { colorScheme });
      await page.screenshot({ path: path.join(scratchDir(), `${name}-${colorScheme}.png`) });
      assert.deepEqual(problems, []);
      await context.close();
    }
  });

  test(`${name}: text stays inside its node box (getBBox, 2 px tolerance)`, async (t) => {
    if (await skipUnlessBrowser(t)) return;
    const { page, context } = await open(built(name).url);
    const outside = await page.evaluate(() => {
      const tol = 2;
      const bad = [];
      for (const node of document.querySelectorAll('.pa-node')) {
        const shape = node.querySelector('.pa-shape');
        if (/dot|small-diamond/.test(shape.getAttribute('class'))) continue; // label sits beside the shape
        const box = shape.getBBox();
        for (const text of node.querySelectorAll('text')) {
          const b = text.getBBox();
          if (b.x < box.x - tol || b.y < box.y - tol || b.x + b.width > box.x + box.width + tol || b.y + b.height > box.y + box.height + tol) {
            bad.push(`${node.dataset.id}: text ${b.x.toFixed(1)},${b.width.toFixed(1)} in box ${box.x.toFixed(1)},${box.width.toFixed(1)}`);
          }
        }
      }
      return bad;
    });
    assert.deepEqual(outside, []);
    await context.close();
  });
}

// ---- fit: zero edges, a single node, zero-size stage (Review Focus 4) --------------------------

test('a single node with no edges fits, presents and zooms without NaN', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { url } = buildPage({ title: 'Solo', type: 'flow', nodes: [{ id: 'a', label: 'Only node' }] }, { name: 'solo' });
  const { page, problems, context } = await open(url);
  assert.ok((await viewBox(page)).every(Number.isFinite));
  await page.keyboard.press('p');
  await settle(page);
  const vb = await viewBox(page);
  assert.ok(vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0, String(vb));
  await page.keyboard.press('Escape');
  await page.keyboard.press('f');
  await page.keyboard.press('+');
  await page.keyboard.press('-');
  assert.ok((await viewBox(page)).every(Number.isFinite));
  assert.deepEqual(problems, []);
  await context.close();
});

test('a stage with no size (display: none) refits without NaN or errors', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await open(built('flow').url);
  await page.evaluate(() => { document.getElementById('pa-stage').style.display = 'none'; });
  await settle(page);
  await page.keyboard.press('f');
  await page.keyboard.press('p');
  await page.keyboard.press('+');
  const hiddenView = await viewBox(page);
  assert.ok(hiddenView.every(Number.isFinite) && hiddenView[2] > 0 && hiddenView[3] > 0, `a usable viewBox even with no stage size: ${hiddenView}`);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.evaluate(() => { document.getElementById('pa-stage').style.display = ''; });
  await settle(page);
  assert.ok((await viewBox(page)).every(Number.isFinite));
  assert.deepEqual(problems, []);
  await context.close();
});

// ---- zoom, pan, fit ------------------------------------------------------------------------------

test('zoom: wheel, +/- keys and buttons, clamped to 0.25x..4x of the fit', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await open(built('architecture').url);
  await page.keyboard.press('+');
  assert.ok(Math.abs((await zoom(page)) - 1.25) < 0.01);
  await page.keyboard.press('-');
  await page.keyboard.press('-');
  assert.ok(Math.abs((await zoom(page)) - 0.8) < 0.01);
  await page.click('[data-act="zoom-in"]');
  await page.click('[data-act="zoom-in"]');
  assert.ok((await zoom(page)) > 1.2);
  await page.locator('#pa-stage').hover();
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, -400);
  assert.ok(Math.abs((await zoom(page)) - 4) < 0.001, 'wheel in clamps at 4x');
  for (let i = 0; i < 40; i++) await page.mouse.wheel(0, 400);
  assert.ok(Math.abs((await zoom(page)) - 0.25) < 0.001, 'wheel out clamps at 0.25x');
  assert.equal(await page.textContent('[data-zoom-label]'), '25%');
  assert.deepEqual(problems, []);
  await context.close();
});

test('pan: drag and arrow keys move the view; F, the Fit button and a double click restore it', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await open(built('architecture').url);
  await page.keyboard.press('+');
  await page.keyboard.press('+');
  const before = await viewBox(page);
  await page.keyboard.press('ArrowRight');
  const afterKey = await viewBox(page);
  assert.ok(afterKey[0] > before[0], 'ArrowRight moves the view right');
  await page.keyboard.press('ArrowDown');
  assert.ok((await viewBox(page))[1] > afterKey[1]);
  const c = await stageCentre(page);
  await page.mouse.move(c.x, c.y + 200);
  await page.mouse.down();
  await page.mouse.move(c.x + 120, c.y + 200, { steps: 6 });
  await page.mouse.up();
  const dragged = await viewBox(page);
  assert.ok(dragged[0] < afterKey[0], 'dragging right moves the content right (view left)');
  for (const restore of [() => page.keyboard.press('f'), () => page.click('[data-act="fit"]'), () => page.mouse.dblclick(c.x, c.y + 200)]) {
    await page.keyboard.press('+');
    await restore();
    await settle(page);
    assert.ok(Math.abs((await zoom(page)) - 1) < 0.001);
  }
  assert.deepEqual(problems, []);
  await context.close();
});

// ---- hover, focus, pin ------------------------------------------------------------------------------

test('hovering a node dims everything but it, its edges, their labels and its neighbours', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await open(built('architecture').url);
  await page.hover('.pa-node[data-id="api"]');
  const state = await page.evaluate(() => {
    const dim = (el) => el.classList.contains('pa-dim');
    const nodes = Object.fromEntries([...document.querySelectorAll('.pa-node')].map((n) => [n.dataset.id, dim(n)]));
    const edges = Object.fromEntries([...document.querySelectorAll('.pa-edge')].map((e) => [`${e.dataset.from}>${e.dataset.to}`, dim(e)]));
    const labels = Object.fromEntries([...document.querySelectorAll('.pa-edge-label')].map((l) => [l.dataset.edge, dim(l)]));
    const edgeIds = Object.fromEntries([...document.querySelectorAll('.pa-edge')].map((e) => [`${e.dataset.from}>${e.dataset.to}`, e.dataset.id]));
    return { nodes, edges, labels, edgeIds };
  });
  assert.deepEqual(state.nodes, { api: false, web: false, db: false, pay: false });
  assert.equal(state.edges['web>vpc'], true, 'an edge not touching api is dimmed');
  for (const incident of ['web>api', 'api>db', 'api>pay']) {
    assert.equal(state.edges[incident], false, incident);
    assert.equal(state.labels[state.edgeIds[incident]], false, `${incident} label`);
  }
  await page.mouse.move(5, 5);
  assert.equal(await page.locator('.pa-dim').count(), 0, 'moving away clears the trace');
  await page.hover('.pa-node[data-id="web"]');
  const web = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.pa-node')].map((n) => [n.dataset.id, n.classList.contains('pa-dim')])));
  assert.deepEqual(web, { web: false, api: false, db: true, pay: true }, 'non-neighbours are dimmed');
  const dimmedLabels = await page.evaluate(() => [...document.querySelectorAll('.pa-edge-label.pa-dim')].map((l) => l.dataset.edge));
  assert.ok(dimmedLabels.length >= 1, 'labels of non-incident edges dim');
  assert.deepEqual(problems, []);
  await context.close();
});

test('click pins the trace, another click on the node and Escape release it', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await open(built('flow').url);
  const first = await page.evaluate(() => document.querySelector('.pa-node').dataset.id);
  await page.click(`.pa-node[data-id="${first}"]`);
  await page.mouse.move(2, 2);
  assert.ok((await page.locator('.pa-dim').count()) > 0, 'pinned: still traced after the pointer left');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.pa-dim').count(), 0, 'Escape clears');
  await page.click(`.pa-node[data-id="${first}"]`);
  await page.click(`.pa-node[data-id="${first}"]`);
  await page.mouse.move(2, 2);
  await page.evaluate(() => document.activeElement.blur());
  assert.equal(await page.locator('.pa-dim').count(), 0, 'a second click unpins');
  assert.deepEqual(problems, []);
  await context.close();
});

test('Tab walks the toolbar, then the nodes in layer order; focus traces like hover', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await open(built('flow').url);
  const layerOrder = await page.evaluate(() => [...document.querySelectorAll('.pa-node')].map((n) => n.dataset.id));
  const seen = [];
  for (let i = 0; i < 20 && seen.length < 2; i++) {
    await page.keyboard.press('Tab');
    const id = await page.evaluate(() => document.activeElement?.classList?.contains('pa-node') ? document.activeElement.dataset.id : null);
    if (id) seen.push(id);
  }
  assert.deepEqual(seen, layerOrder.slice(0, 2), 'the first node focused is the first of the first layer');
  assert.ok((await page.locator('.pa-dim').count()) > 0, 'keyboard focus traces');
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('role')), 'graphics-symbol');
  assert.match(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), /^.+: [a-z]+$/);
  assert.deepEqual(problems, []);
  await context.close();
});

// ---- presentation (Review Focus 5) --------------------------------------------------------------------

const hiddenIds = (page) => page.evaluate(() => [...document.querySelectorAll('.pa-hidden')].map((e) => e.dataset.id ?? `label:${e.dataset.edge}`));

test('Play: P enters, the caption line and count show the beat, arrows and the buttons step, a canvas click does not, Escape leaves', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await open(built('architecture').url);
  assert.equal(await page.locator('[data-pa-caption]').isVisible(), false);
  await page.keyboard.press('p');
  assert.equal(await page.locator('[data-pa-caption]').isVisible(), true);
  assert.equal(await page.textContent('[data-pa-line]'), '01 / 03 · WALKTHROUGH · The browser calls the API — TLS ends at the load balancer.');
  assert.equal(await page.textContent('[data-pa-count]'), '1 / 3');
  assert.equal(await page.getAttribute('[data-pa-mode="play"]', 'aria-pressed'), 'true');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.textContent('[data-pa-count]'), '2 / 3');
  assert.equal(await page.textContent('[data-pa-line]'), '02 / 03 · WALKTHROUGH · The API writes the order', 'a beat with no caption shows none');
  await page.keyboard.press('ArrowRight');
  assert.ok((await page.textContent('[data-pa-line]')).endsWith('· Everything'));
  await page.keyboard.press('ArrowLeft');
  assert.equal(await page.textContent('[data-pa-count]'), '2 / 3');
  await page.click('[data-pa-next]');
  assert.equal(await page.textContent('[data-pa-count]'), '3 / 3');
  assert.equal(await page.isDisabled('[data-pa-next]'), true);
  await page.click('[data-pa-prev]');
  const c = await stageCentre(page);
  await page.mouse.click(c.x, c.y + 60);
  assert.equal(await page.textContent('[data-pa-count]'), '2 / 3', 'a click on the canvas no longer steps');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('[data-pa-caption]').isVisible(), false);
  assert.equal(await page.getAttribute('[data-pa-mode="play"]', 'aria-pressed'), 'false');
  assert.equal(await page.locator('.pa-hidden').count(), 0, 'leaving shows everything again');
  assert.deepEqual(problems, []);
  await context.close();
});

test('presentation hides what is not revealed yet; revealing a nested node reveals its ancestor groups', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await open(built('architecture').url);
  await page.keyboard.press('p');
  // step 1 shows web and api; api sits in vpc inside aws
  let hidden = await hiddenIds(page);
  assert.ok(hidden.includes('db') && hidden.includes('pay'), `db and pay wait: ${hidden}`);
  assert.ok(!hidden.includes('aws') && !hidden.includes('vpc'), 'api is in vpc in aws: both groups are revealed with it');
  assert.ok(!hidden.includes('web') && !hidden.includes('api'));
  assert.ok(hidden.includes('edge-1') && hidden.includes('label:edge-1'), 'api > db waits for db, label with it');
  assert.ok(!hidden.includes('edge-0'), 'web > api is visible once both ends are');
  assert.ok(!hidden.includes('edge-3'), 'web > vpc: both ends (web, the revealed group) are visible');
  await page.keyboard.press('ArrowRight');
  hidden = await hiddenIds(page);
  assert.ok(!hidden.includes('db') && !hidden.includes('edge-1'));
  assert.ok(hidden.includes('pay') && hidden.includes('edge-2'));
  assert.ok((await classes(page, '.pa-node[data-id="db"]')).includes('pa-hl'), 'the highlight id is emphasised');
  await page.keyboard.press('ArrowRight');
  assert.deepEqual(await hiddenIds(page), [], 'the closing Everything step reveals the rest');
  assert.deepEqual(problems, []);
  await context.close();
});

test('a step that names only a node deep in nested groups reveals both groups and fits the node', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const spec = {
    title: 'Nested', type: 'architecture',
    groups: [{ id: 'outer', label: 'Outer' }, { id: 'mid', label: 'Mid', parent: 'outer' }, { id: 'inner', label: 'Inner', parent: 'mid' }],
    nodes: [{ id: 'x', label: 'X', group: 'inner' }, { id: 'y', label: 'Y' }],
    edges: [{ from: 'x', to: 'y' }],
    steps: [{ title: 'Only the deep node', focus: ['x'], show: ['x'] }],
  };
  const { page, problems, context } = await open(buildPage(spec, { name: 'nested' }).url);
  await page.keyboard.press('p');
  await settle(page);
  assert.deepEqual((await hiddenIds(page)).sort(), ['edge-0', 'y'], 'y and its edge wait; x, its three groups and nothing else show');
  const groupsVisible = await page.evaluate(() => ['outer', 'mid', 'inner'].map((id) => !document.querySelector(`.pa-group[data-id="${id}"]`).classList.contains('pa-hidden')));
  assert.deepEqual(groupsVisible, [true, true, true]);
  assert.equal(await page.textContent('[data-pa-count]'), '1 / 2', 'plus the closing Everything step for y');
  const vb = await viewBox(page);
  const box = await page.evaluate(() => { const b = document.querySelector('.pa-node[data-id="x"]').getBBox(); return [b.x, b.y, b.width, b.height]; });
  assert.ok(vb[0] <= box[0] - 48 + 1 && vb[1] <= box[1] - 48 + 1 && vb[0] + vb[2] >= box[0] + box[2] + 48 - 1 && vb[1] + vb[3] >= box[1] + box[3] + 48 - 1, `the view ${vb} holds the node ${box} with 48 px around`);
  assert.deepEqual(problems, []);
  await context.close();
});

test('the camera moves to the step focus: viewBox holds the focus box plus 48 px; reduced motion jumps at once', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await open(built('architecture').url);
  await page.keyboard.press('p');
  await settle(page);
  const focusBox = (pg, ids) => pg.evaluate((list) => {
    const data = JSON.parse(document.getElementById('pa-data').textContent);
    const bs = list.map((id) => data.boxes[id]);
    const x0 = Math.min(...bs.map((b) => b[0])); const y0 = Math.min(...bs.map((b) => b[1]));
    return [x0, y0, Math.max(...bs.map((b) => b[0] + b[2])) - x0, Math.max(...bs.map((b) => b[1] + b[3])) - y0];
  }, ids);
  const holds = (vb, box) => vb[0] <= box[0] - 47 && vb[1] <= box[1] - 47 && vb[0] + vb[2] >= box[0] + box[2] + 47 && vb[1] + vb[3] >= box[1] + box[3] + 47;
  assert.ok(holds(await viewBox(page), await focusBox(page, ['web', 'api'])), 'step 1 focus = its show');
  assert.ok((await zoom(page)) > 1, 'zoomed in on the focus');
  await page.keyboard.press('ArrowRight');
  await settle(page);
  assert.ok(holds(await viewBox(page), await focusBox(page, ['api', 'db'])), 'step 2 focus is explicit');
  await page.keyboard.press('Escape');
  await settle(page);
  assert.ok(Math.abs((await zoom(page)) - 1) < 0.001, 'leaving refits');
  assert.deepEqual(problems, []);
  await context.close();

  const reduced = await open(built('architecture').url, { reducedMotion: 'reduce' });
  await reduced.page.keyboard.press('p');
  const vb0 = await viewBox(reduced.page);
  assert.ok(holds(vb0, await focusBox(reduced.page, ['web', 'api'])), 'no waiting needed under reduced motion');
  await reduced.page.keyboard.press('ArrowRight');
  assert.ok(holds(await viewBox(reduced.page), await focusBox(reduced.page, ['api', 'db'])));
  assert.deepEqual(reduced.problems, []);
  await reduced.context.close();
});

test('#step-N deep link opens the presentation at that step and follows the steps', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await open(built('architecture').url, { hash: '#step-2' });
  assert.equal(await page.textContent('[data-pa-count]'), '2 / 3');
  assert.ok((await page.textContent('[data-pa-line]')).includes(example('architecture').steps[1].title));
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.evaluate(() => location.hash), '#step-3');
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => location.hash), '');
  const clamped = await open(built('architecture').url, { hash: '#step-99' });
  assert.equal(await clamped.page.textContent('[data-pa-count]'), '3 / 3');
  assert.deepEqual([...problems, ...clamped.problems], []);
  await context.close();
  await clamped.context.close();
});

test('a sequence presents message by message: lifelines, frames and notes appear with their messages', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const spec = example('sequence');
  delete spec.steps; // the viewer builds one step per message
  const { page, problems, context } = await open(buildPage(spec, { name: 'sequence-auto' }).url);
  await page.keyboard.press('p');
  const total = Number((await page.textContent('[data-pa-count]')).split(' / ')[1]);
  assert.equal(total, spec.messages.length);
  let hidden = await hiddenIds(page);
  assert.ok(!hidden.includes('m1') && hidden.includes('m2'));
  assert.equal(await page.evaluate(() => document.querySelectorAll('.pa-frame:not(.pa-hidden)').length), 0, 'frames wait for their first message');
  assert.equal(await page.evaluate(() => document.querySelectorAll('.pa-seq-note:not(.pa-hidden)').length), 0);
  for (let i = 1; i < total; i++) await page.keyboard.press('ArrowRight');
  hidden = await hiddenIds(page);
  assert.deepEqual(hidden, [], 'the last step shows everything');
  assert.equal(await page.evaluate(() => document.querySelectorAll('.pa-hidden').length), 0);
  assert.deepEqual(problems, []);
  await context.close();
});

test('a zero-message sequence still presents its participants', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { url } = buildPage({ title: 'Lonely', type: 'sequence', participants: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] }, { name: 'lonely' });
  const { page, problems, context } = await open(url);
  await page.keyboard.press('p');
  assert.equal(await page.textContent('[data-pa-count]'), '1 / 1');
  assert.deepEqual(await hiddenIds(page), []);
  assert.deepEqual(problems, []);
  await context.close();
});

test('hovering a node named like a default edge id lights up only its own edges', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const spec = {
    title: 'Edge ids', type: 'flow',
    nodes: ['e0', 'e1', 'e2', 'e3'].map((id) => ({ id, label: id })),
    edges: [{ from: 'e0', to: 'e1' }, { from: 'e1', to: 'e2' }, { from: 'e2', to: 'e3' }],
  };
  const { page, problems, context } = await open(buildPage(spec, { name: 'edge-ids' }).url);
  await page.hover('.pa-node[data-id="e1"]');
  const traced = await page.evaluate(() => ({
    nodes: Object.fromEntries([...document.querySelectorAll('.pa-node')].map((n) => [n.dataset.id, !n.classList.contains('pa-dim')])),
    edges: Object.fromEntries([...document.querySelectorAll('.pa-edge')].map((e) => [`${e.dataset.from}>${e.dataset.to}`, !e.classList.contains('pa-dim')])),
  }));
  assert.deepEqual(traced.nodes, { e0: true, e1: true, e2: true, e3: false });
  assert.deepEqual(traced.edges, { 'e0>e1': true, 'e1>e2': true, 'e2>e3': false });
  assert.deepEqual(problems, []);
  await context.close();
});

test('a step that highlights a group draws its frame in the accent colour', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const spec = {
    title: 'Group highlight', type: 'architecture',
    groups: [{ id: 'vpc', label: 'VPC' }],
    nodes: [{ id: 'a', label: 'A', group: 'vpc' }, { id: 'b', label: 'B' }],
    edges: [{ from: 'a', to: 'b' }],
    steps: [{ title: 'Node', show: ['a', 'b'], highlight: ['a'] }, { title: 'Group', show: ['a', 'b'], highlight: ['vpc'] }],
  };
  const { page, problems, context } = await open(buildPage(spec, { name: 'group-highlight' }).url);
  const stroke = (sel) => page.evaluate((s) => { const c = getComputedStyle(document.querySelector(s)); return [c.stroke, c.strokeWidth]; }, sel);
  await page.keyboard.press('p');
  const accent = await stroke('.pa-node[data-id="a"] .pa-shape');
  const plain = await stroke('.pa-group[data-id="vpc"] .pa-group-box');
  assert.notDeepEqual(plain, accent);
  await page.keyboard.press('ArrowRight');
  assert.deepEqual(await stroke('.pa-group[data-id="vpc"] .pa-group-box'), accent, 'the highlighted group takes the accent stroke');
  await page.keyboard.press('Escape');
  assert.deepEqual(await stroke('.pa-group[data-id="vpc"] .pa-group-box'), plain, 'leaving presentation restores the frame');
  assert.deepEqual(problems, []);
  await context.close();
});

test('the Everything step uses the fit camera, not a padded focus box', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  for (const name of ['architecture']) {
    const { page, problems, context } = await open(built(name).url);
    const total = example(name).steps.length + 1;
    await page.keyboard.press('p');
    for (let i = 1; i < total; i++) await page.keyboard.press('ArrowRight');
    assert.ok((await page.textContent('[data-pa-line]')).endsWith('· Everything'), name);
    await settle(page);
    assert.ok(Math.abs((await zoom(page)) - 1) < 0.001, `${name}: ${await zoom(page)}`);
    const [x, y, w, h] = await viewBox(page); // the caption shrinks the stage, so compare the centre, not the box
    const size = await page.evaluate(() => JSON.parse(document.getElementById('pa-data').textContent));
    assert.ok(Math.abs(x + w / 2 - size.width / 2) < 1 && Math.abs(y + h / 2 - size.height / 2) < 1, `${name}: centred on the diagram`);
    assert.deepEqual(problems, []);
    await context.close();
  }
});

for (const [name, spec] of Object.entries(PROTOTYPE_NAMED_SPECS)) {
  test(`${name}: hover, pin and presentation work with no console errors`, async (t) => {
    if (await skipUnlessBrowser(t)) return;
    const { page, problems, context } = await open(buildPage(spec, { name: 'proto-ids' }).url);
    const target = await page.evaluate(() => (document.querySelector('.pa-node') ?? document.querySelector('.pa-edge'))?.dataset.id ?? null);
    if (target && await page.locator('.pa-node').count()) {
      await page.hover(`.pa-node[data-id="${target}"]`);
      const dimmed = await page.evaluate(() => [...document.querySelectorAll('.pa-node.pa-dim')].map((n) => n.dataset.id));
      assert.deepEqual(dimmed, [], `with two connected nodes, nothing dims`);
      await page.mouse.move(2, 2);
      await page.click(`.pa-node[data-id="${target}"]`);
      await page.keyboard.press('Escape');
    }
    await page.keyboard.press('p');
    const total = Number((await page.textContent('[data-pa-count]')).split(' / ')[1]);
    for (let i = 1; i < total; i++) await page.keyboard.press('ArrowRight');
    await settle(page);
    assert.deepEqual(await hiddenIds(page), [], 'the last step reveals everything');
    const vb = await viewBox(page);
    assert.ok(vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0, String(vb));
    await page.keyboard.press('Escape');
    assert.deepEqual(problems, []);
    await context.close();
  });
}

test('screenshots: presentation mid-step (light and dark), a hover trace and a phone-width page', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const shot = (page, name) => page.screenshot({ path: path.join(scratchDir(), name) });
  for (const colorScheme of ['light', 'dark']) {
    const { page, problems, context } = await open(built('architecture').url, { colorScheme });
    await page.keyboard.press('p');
    await page.keyboard.press('ArrowRight');
    await settle(page);
    await shot(page, `architecture-present-${colorScheme}.png`);
    assert.deepEqual(problems, []);
    await context.close();
  }
  const seq = await open(built('sequence').url, { colorScheme: 'dark', hash: '#step-3' });
  await settle(seq.page);
  await shot(seq.page, 'sequence-present-dark.png');
  await seq.context.close();
  const hover = await open(built('architecture').url);
  await hover.page.hover('.pa-node[data-id="api"]');
  await shot(hover.page, 'architecture-hover.png');
  await hover.context.close();
  const phone = await open(built('flow').url, { width: 390, height: 780 });
  await phone.page.keyboard.press('p');
  await settle(phone.page);
  await shot(phone.page, 'flow-phone-present.png');
  assert.deepEqual(phone.problems, []);
  await phone.context.close();
});

test('a group with no nodes is revealed by the last auto step', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const spec = { title: 'Empty group', type: 'architecture', groups: [{ id: 'empty', label: 'Empty' }], nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], edges: [{ from: 'a', to: 'b' }] };
  const { page, problems, context } = await open(buildPage(spec, { name: 'empty-group' }).url);
  await page.keyboard.press('p');
  assert.ok((await hiddenIds(page)).includes('empty'), 'hidden at the start');
  const total = Number((await page.textContent('[data-pa-count]')).split(' / ')[1]);
  for (let i = 1; i < total; i++) await page.keyboard.press('ArrowRight');
  assert.ok((await page.textContent('[data-pa-line]')).endsWith('· Everything'));
  assert.deepEqual(await hiddenIds(page), []);
  assert.deepEqual(problems, []);
  await context.close();
});

test('a sequence step with no focus keeps the headers of its messages\' participants and enclosing frames in view', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const spec = example('sequence');
  const { page, problems, context } = await open(built('sequence').url, { hash: '#step-3' }); // show m5..m8, no focus
  await settle(page);
  const vb = await viewBox(page);
  const boxes = await page.evaluate(() => {
    const data = JSON.parse(document.getElementById('pa-data').textContent);
    return { b: data.boxes, frames: data.frames };
  });
  const inside = (box, pad = 0) => vb[0] <= box[0] - pad + 0.5 && vb[1] <= box[1] - pad + 0.5 && vb[0] + vb[2] >= box[0] + box[2] + pad - 0.5 && vb[1] + vb[3] >= box[1] + box[3] + pad - 0.5;
  const shown = ['m5', 'm6', 'm7', 'm8'];
  const ends = [...new Set(shown.flatMap((id) => { const m = spec.messages.find((x) => x.id === id); return [m.from, m.to]; }))];
  for (const id of ends) assert.ok(inside(boxes.b[id], 47), `header ${id} is in view`);
  const enclosing = boxes.frames.filter((f) => f.messages.some((m) => shown.includes(m)));
  assert.equal(enclosing.length, 2, 'the loop and the alt frame');
  for (const f of enclosing) assert.ok(inside(f.box, 47), 'frame in view');
  assert.deepEqual(problems, []);
  await context.close();
});

test('a double click on the canvas in Play neither steps nor leaves', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await open(built('architecture').url);
  await page.keyboard.press('p');
  const c = await stageCentre(page);
  await page.mouse.dblclick(c.x, c.y + 60);
  assert.equal(await page.textContent('[data-pa-count]'), '1 / 3');
  assert.equal(await page.locator('[data-pa-caption]').isVisible(), true);
  assert.deepEqual(problems, []);
  await context.close();
});

test('presentation never zooms in past 2x of the fit', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  for (const [name, spec] of [['architecture', example('architecture')], ['flow', example('flow')], ['solo', { title: 'Solo', type: 'flow', nodes: [{ id: 'a', label: 'Only node' }] }]]) {
    for (const width of [1440, 390]) {
      const { page, problems, context } = await open(buildPage(spec, { name: `zoomcap-${name}` }).url, { width, height: width === 390 ? 780 : 900 });
      await page.keyboard.press('p');
      const total = Number((await page.textContent('[data-pa-count]')).split(' / ')[1]);
      for (let i = 0; i < total; i++) {
        await settle(page);
        const z = await zoom(page);
        assert.ok(z <= 2.001, `${name}@${width} step ${i + 1}: ${z}`);
        await page.keyboard.press('ArrowRight');
      }
      assert.deepEqual(problems, []);
      await context.close();
    }
  }
});

test('exports are named after the .html slug, even for a title over 60 characters', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const title = 'A very long diagram title that keeps going well past the sixty character slug limit';
  const { page, problems, context } = await open(buildPage({ title, type: 'state', nodes: [{ id: 'a', label: 'A' }] }, { name: 'long-title' }).url);
  const stem = slugify(title);
  assert.ok(stem.length <= 60);
  for (const kind of ['svg', 'png']) assert.equal((await download(page, kind)).name, `${stem}.${kind}`);
  assert.deepEqual(problems, []);
  await context.close();
});

// ---- animation ------------------------------------------------------------------------------------------

const edgeStyle = (page, sel) => page.evaluate((s) => {
  const cs = getComputedStyle(document.querySelector(s));
  return { name: cs.animationName, dash: cs.strokeDasharray };
}, sel);

test('animate toggles flow on edges and keeps each style\'s dash pattern', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await open(built('architecture').url);
  assert.equal(await page.textContent('[data-act="animate"]'), 'Animate: Off');
  assert.equal((await edgeStyle(page, '.pa-edge-solid path')).name, 'none');
  const dashedBefore = (await edgeStyle(page, '.pa-edge-dashed path')).dash;
  const asyncBefore = (await edgeStyle(page, '.pa-edge-async path')).dash;
  await page.click('[data-act="animate"]');
  assert.equal(await page.textContent('[data-act="animate"]'), 'Animate: On');
  assert.equal(await page.getAttribute('[data-act="animate"]', 'aria-pressed'), 'true');
  assert.ok((await classes(page, '#pa-stage svg')).includes('pa-animate'));
  for (const sel of ['.pa-edge-solid path', '.pa-edge-dashed path', '.pa-edge-async path']) assert.equal((await edgeStyle(page, sel)).name, 'pa-flow', sel);
  assert.equal((await edgeStyle(page, '.pa-edge-dashed path')).dash, dashedBefore, 'dashed keeps 6 4');
  assert.equal((await edgeStyle(page, '.pa-edge-async path')).dash, asyncBefore, 'async keeps its dots');
  assert.match((await edgeStyle(page, '.pa-edge-solid path')).dash, /^6px, 6px$|^6, 6$/, 'solid gets a pattern to animate');
  for (const style of ['solid', 'dashed', 'async']) {
    const sample = await edgeStyle(page, `.pa-legend-sample.pa-edge-${style} path`);
    assert.equal(sample.name, 'none', `the legend's ${style} sample does not flow`);
  }
  assert.equal((await edgeStyle(page, '.pa-legend-sample.pa-edge-solid path')).dash, 'none', 'and the solid sample stays solid');
  await page.keyboard.press('a');
  assert.equal(await page.textContent('[data-act="animate"]'), 'Animate: Off');
  assert.deepEqual(problems, []);
  await context.close();
});

test('a spec with animate: true starts animated', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { url } = buildPage({ ...example('state'), animate: true }, { name: 'animated' });
  const { page, context } = await open(url);
  assert.equal(await page.textContent('[data-act="animate"]'), 'Animate: On');
  assert.equal((await edgeStyle(page, '.pa-edge path')).name, 'pa-flow');
  await context.close();
});

test('reduced motion: no animation, the toggle says so and is disabled, even for animate: true', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { url } = buildPage({ ...example('state'), animate: true }, { name: 'animated-reduced' });
  const { page, problems, context } = await open(url, { reducedMotion: 'reduce' });
  assert.equal(await page.textContent('[data-act="animate"]'), 'Reduced motion');
  assert.equal(await page.isDisabled('[data-act="animate"]'), true);
  assert.equal((await edgeStyle(page, '.pa-edge path')).name, 'none');
  assert.ok(!(await classes(page, '#pa-stage svg')).includes('pa-animate'));
  await page.keyboard.press('a');
  assert.equal((await edgeStyle(page, '.pa-edge path')).name, 'none', 'the A key does nothing');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.waitForFunction(() => !document.querySelector('[data-act="animate"]').disabled);
  assert.equal(await page.textContent('[data-act="animate"]'), 'Animate: Off', 'following the media query live');
  assert.deepEqual(problems, []);
  await context.close();
});

// ---- export -------------------------------------------------------------------------------------------------------

async function download(page, kind) {
  const [d] = await Promise.all([page.waitForEvent('download'), page.click(`[data-export="${kind}"]`)]);
  return { name: d.suggestedFilename(), file: await d.path() };
}

test('SVG and PNG export download under the strict CSP, filled with the theme surface', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  for (const colorScheme of ['light', 'dark']) {
    const { page, problems, context } = await open(built('architecture').url, { colorScheme });
    const surface = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--surface').trim());
    await page.keyboard.press('+'); // the export is the whole canvas whatever the view
    const svg = await download(page, 'svg');
    assert.equal(svg.name, 'checkout-request-path.svg');
    const text = fs.readFileSync(svg.file, 'utf8');
    assert.match(text, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.ok(text.includes(`fill="${surface}"`), 'surface background rect');
    assert.ok(text.includes('<style>') && text.includes('.pa-node') && text.includes('--surface:'), 'self-contained styles');
    assert.ok(text.includes('@font-face'), 'fonts travel with the file');
    const data = JSON.parse(built('architecture').html.match(/id="pa-data">([^<]*)<\/script>/)[1]);
    assert.match(text, new RegExp(`viewBox="0 0 ${data.width} ${data.height}"`));
    assert.ok(text.includes('--k-service:') && text.includes('--s1:') && text.includes('--mono:'), 'the kind hues, lane colours and mono font travel with the file');
    assert.ok(text.includes('class="pa-legend"'), 'the legend is part of the drawing');
    assert.ok(!/class="[^"]*\bpa-(hidden|dim|on|hl|animate)\b|tabindex=/.test(text), 'no viewer state in the file');
    const png = await download(page, 'png');
    assert.equal(png.name, 'checkout-request-path.png');
    const bytes = fs.readFileSync(png.file);
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'PNG signature');
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    assert.ok(width >= data.width && height >= data.height, `${width}x${height}`);
    assert.equal(await page.locator('[data-export-error]').isVisible(), false);
    assert.deepEqual(problems, []);
    await context.close();
  }
});

test('the PNG is surface-filled and shows the drawing (not blank), in dark too', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, context } = await open(built('flow').url, { colorScheme: 'dark' });
  const probe = await page.evaluate(async () => {
    const link = await new Promise((resolve) => {
      const original = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () { HTMLAnchorElement.prototype.click = original; resolve(this.href); };
      document.querySelector('[data-export="png"]').click();
    });
    const img = new Image();
    img.src = link;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width; canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, img.width, img.height).data;
    // 4 px in from the corner: a canvas of fractional width (the legend can set it) resamples the very first pixel by one level.
    const at = 4 * (4 * img.width + 4);
    const corner = [...data.slice(at, at + 4)];
    let different = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] !== corner[0] || data[i + 1] !== corner[1] || data[i + 2] !== corner[2]) different++;
    return { corner, different, total: data.length / 4, surface: getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() };
  });
  const hex = probe.surface.replace('#', '');
  assert.deepEqual(probe.corner.slice(0, 3), [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)), 'corner = surface colour, opaque');
  assert.equal(probe.corner[3], 255);
  assert.ok(probe.different > probe.total * 0.01, 'there is a drawing on it');
  await context.close();
});

test('a failing export shows "Export failed: ..." as text on the page, clears on the next try, and logs nothing', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await open(built('flow').url);
  await page.evaluate(() => { URL.createObjectURL = () => { throw new Error('blob refused'); }; });
  await page.click('[data-export="svg"]');
  assert.equal(await page.textContent('[data-export-error]'), 'Export failed: blob refused');
  assert.equal(await page.getAttribute('[data-export-error]', 'role'), 'alert');
  await page.click('[data-export="png"]');
  assert.equal(await page.textContent('[data-export-error]'), 'Export failed: blob refused', 'one line, replaced');
  assert.deepEqual(problems, [], 'no console output for a handled failure');
  await context.close();
});

// ---- theme ------------------------------------------------------------------------------------------------------------

const token = (page, name) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

test('theme toggle cycles Auto, Light, Dark and survives a reload', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await open(built('flow').url);
  assert.equal(await page.textContent('[data-theme-toggle]'), 'Theme: Auto');
  assert.equal(await token(page, '--page'), '#f4f6f8');
  await page.click('[data-theme-toggle]');
  assert.equal(await page.textContent('[data-theme-toggle]'), 'Theme: Light');
  await page.click('[data-theme-toggle]');
  assert.equal(await page.textContent('[data-theme-toggle]'), 'Theme: Dark');
  assert.equal(await page.getAttribute('html', 'data-theme'), 'dark');
  assert.equal(await token(page, '--page'), '#0e1319');
  await page.reload();
  await page.waitForFunction(() => window.paReady === true);
  assert.equal(await token(page, '--page'), '#0e1319', 'the choice persisted');
  assert.equal(await page.textContent('[data-theme-toggle]'), 'Theme: Dark');
  assert.equal(await page.getAttribute('[data-theme-toggle]', 'aria-label'), 'Theme: Dark. Change theme');
  await page.click('[data-theme-toggle]');
  assert.equal(await page.textContent('[data-theme-toggle]'), 'Theme: Auto');
  assert.deepEqual(problems, []);
  await context.close();
});

test('blocked storage: the page renders and the toggle still works for the visit', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await open(built('flow').url, { blockStorage: true });
  assert.ok((await page.locator('.pa-node').count()) > 0);
  await page.click('[data-theme-toggle]');
  await page.click('[data-theme-toggle]');
  assert.equal(await token(page, '--page'), '#0e1319');
  assert.deepEqual(problems, []);
  await context.close();
});

// ---- accessibility and escaping -------------------------------------------------------------------------------------------

test('accessibility: one graphics-document root, graphics-symbol nodes with names, and the text alternative', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await open(built('architecture').url);
  const a11y = await page.evaluate(() => ({
    roots: document.querySelectorAll('[role="graphics-document"]').length,
    imgs: document.querySelectorAll('svg [role="img"]').length,
    names: [...document.querySelectorAll('.pa-node')].map((n) => `${n.getAttribute('role')}|${n.getAttribute('aria-label')}`),
    labelled: document.querySelector('svg').getAttribute('aria-labelledby').split(' ').every((id) => document.getElementById(id)?.textContent),
    text: document.querySelector('section[aria-label="Diagram as text"]').textContent,
    visible: document.querySelector('section[aria-label="Diagram as text"]').getBoundingClientRect().width,
  }));
  assert.equal(a11y.roots, 1);
  assert.equal(a11y.imgs, 0, 'no nested img roles');
  assert.ok(a11y.names.every((n) => n.startsWith('graphics-symbol|') && n.length > 20));
  assert.ok(a11y.labelled);
  assert.ok(a11y.text.includes('Web app → Checkout API: POST /checkout'));
  assert.ok(a11y.visible <= 1, 'visually hidden');
  assert.deepEqual(problems, []);
  await context.close();
});

test('hostile text in labels renders as text in the page (Review Focus 1)', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const evil = '<b>&"x"';
  const spec = { title: `T ${evil}`, subtitle: evil, type: 'architecture', nodes: [{ id: 'a', label: evil, note: evil }, { id: 'b', label: 'B' }], edges: [{ from: 'a', to: 'b', label: evil }], steps: [{ title: evil, note: evil, show: ['a', 'b'] }] };
  const { page, problems, context } = await open(buildPage(spec, { name: 'evil' }).url);
  assert.equal(await page.locator('b').count(), 0);
  assert.ok((await page.textContent('.pa-node .pa-label')).includes(evil));
  assert.equal(await page.title(), `T ${evil}`);
  await page.keyboard.press('p');
  assert.ok((await page.textContent('[data-pa-line]')).includes(evil));
  assert.equal(await page.locator('b').count(), 0);
  assert.deepEqual(problems, []);
  await context.close();
});
