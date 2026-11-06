// A text `anchor` ('left' | 'center' | 'right', default 'center'): which edge of the text box sits on x, and so which edge
// stays put when the text grows, scales or changes. Stacked lines of different lengths with one x and anchor "left" share a
// left edge; with "right" a right edge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validateSpec } from '../scripts/lib/spec.mjs';
import { startServer } from '../scripts/lib/server.mjs';
import { launchBrowser } from '../scripts/lib/browser.mjs';
import { requireRender, BROWSER_ONLY } from './helpers/render.mjs';

const SIZE = [960, 540];
const EDGE_TOLERANCE_PX = 0.5;
const LINES = ['Hi', 'A longer line of text', 'Mid length'];
const line = (id, text, extra = {}) => ({ id, type: 'text', text, x: 300, y: 200, fontSize: 40, ...extra });
const stack = (anchor) => LINES.map((text, i) => line(`l${i}`, text, { y: 120 + i * 100, ...(anchor && { anchor }) }));
const errs = (elements) => validateSpec({ size: SIZE, scenes: [{ id: 's', duration: 2, elements }] }).errors.map((e) => `${e.path}: ${e.message}`);

// The page for `elements`, then `read(sec)` -> { id: { left, right, transform, origin } } in canvas pixels.
async function withPage(elements, use) {
  const dir = mkdtempSync(path.join(tmpdir(), 'anchor-'));
  const specPath = path.join(dir, 'motion.json');
  writeFileSync(specPath, JSON.stringify({ size: SIZE, scenes: [{ id: 's', duration: 2, elements }] }));
  const server = await startServer({ specPath, mode: 'render' });
  const browser = await launchBrowser({ quiet: true });
  try {
    const page = await browser.newPage({ viewport: { width: SIZE[0], height: SIZE[1] }, deviceScaleFactor: 1 });
    await page.goto(server.url);
    await page.waitForFunction(() => window.__motion);
    await page.evaluate(() => window.__motion.ready);
    const read = (sec) => page.evaluate(async (s) => {
      await window.__motion.seek(s);
      const stage = document.getElementById('stage').getBoundingClientRect();
      const k = window.__motion.size[0] / stage.width;
      return Object.fromEntries([...document.querySelectorAll('.el.text')].map((node) => {
        const r = node.getBoundingClientRect();
        return [node.dataset.id, { left: (r.left - stage.left) * k, right: (r.right - stage.left) * k, transform: node.style.transform, origin: node.style.transformOrigin }];
      }));
    }, sec);
    return await use(read);
  } finally { await browser.close(); await server.close(); }
}

const spread = (read, edge) => Object.values(read).map((m) => m[edge]);

test('anchor on a shape is a validation error naming the fields that are allowed', () => {
  const shape = { id: 'r', type: 'shape', shape: 'rect', x: 100, y: 100, anchor: 'left' };
  const [message] = errs([shape]);
  assert.match(message, /^scenes\[0\]\.elements\[0\]\.anchor: not valid on shape; allowed: /);
});

test('anchor takes left, center or right only', () => {
  assert.deepEqual(errs([line('a', 'x', { anchor: 'left' }), line('b', 'x', { anchor: 'center' }), line('c', 'x', { anchor: 'right' })]), []);
  assert.match(errs([line('a', 'x', { anchor: 'middle' })]).join('\n'), /scenes\[0\]\.elements\[0\]\.anchor/);
});

test('three stacked lines with anchor left share one left edge', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  await withPage(stack('left'), async (read) => {
    const lefts = spread(await read(0.5), 'left');
    assert.equal(lefts.length, 3);
    assert.ok(Math.max(...lefts) - Math.min(...lefts) <= EDGE_TOLERANCE_PX, `left edges ${lefts}`);
    assert.ok(Math.abs(lefts[0] - 300) <= EDGE_TOLERANCE_PX, `the left edge sits on x: ${lefts[0]}`);
  });
});

test('the same lines without an anchor centre on x, so their left edges differ (the control)', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  await withPage(stack(undefined), async (read) => {
    const lefts = spread(await read(0.5), 'left');
    assert.ok(Math.max(...lefts) - Math.min(...lefts) > 20, `left edges ${lefts}`);
  });
});

test('anchor right aligns right edges', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  await withPage(stack('right'), async (read) => {
    const rights = spread(await read(0.5), 'right');
    assert.ok(Math.max(...rights) - Math.min(...rights) <= EDGE_TOLERANCE_PX, `right edges ${rights}`);
    assert.ok(Math.abs(rights[0] - 300) <= EDGE_TOLERANCE_PX, `the right edge sits on x: ${rights[0]}`);
  });
});

test('scale keeps the anchored edge fixed (left stays put, the far edge moves)', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const grow = { keyframes: [{ t: 0, scale: 1 }, { t: 1, scale: 2 }] };
  await withPage([line('a', LINES[1], { anchor: 'left', ...grow }), line('b', LINES[1], { anchor: 'right', y: 300, ...grow })], async (read) => {
    const [before, after] = [await read(0), await read(1)];
    assert.ok(Math.abs(after.a.left - before.a.left) <= EDGE_TOLERANCE_PX, `left ${before.a.left} -> ${after.a.left}`);
    assert.ok(after.a.right - before.a.right > 50, 'the far edge moved');
    assert.ok(Math.abs(after.b.right - before.b.right) <= EDGE_TOLERANCE_PX, `right ${before.b.right} -> ${after.b.right}`);
    assert.ok(before.b.left - after.b.left > 50, 'the far edge moved');
  });
});

test('an element with no anchor (or "center") keeps today\'s transform string and no transform-origin', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const today = 'translate(300px, 120px) translate(-50%, -50%) scale(1) rotate(0deg)';
  await withPage([line('a', 'plain', { y: 120 }), line('b', 'centred', { y: 220, anchor: 'center' })], async (read) => {
    const got = await read(0.5);
    assert.equal(got.a.transform, today);
    assert.equal(got.a.origin, '');
    assert.equal(got.b.transform, today.replace('120px', '220px'));
    assert.equal(got.b.origin, '');
  });
});

test('the anchored transform moves the x translation and the transform origin to the edge', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  await withPage([line('l', 'left', { y: 100, anchor: 'left' }), line('r', 'right', { y: 200, anchor: 'right' })], async (read) => {
    const got = await read(0.5);
    assert.equal(got.l.transform, 'translate(300px, 100px) translate(0%, -50%) scale(1) rotate(0deg)');
    assert.equal(got.l.origin, 'left center');
    assert.equal(got.r.transform, 'translate(300px, 200px) translate(-100%, -50%) scale(1) rotate(0deg)');
    assert.equal(got.r.origin, 'right center');
  });
});
