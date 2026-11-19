// check.mjs gives a screenshot its own time budget. Under software WebGL a canvas screenshot is the slowest thing the
// check does: on a CI runner (probe, run 44484783849) the first one took 0.9 s with one browser and 2.1 to 2.5 s with
// three at once (0.12 s on a laptop), and one check run timed out at 4.95 s against the 5 s every page action gets
// (check.test:217, run 44465347491: "check crashed: locator.screenshot: Timeout 4952.668ms exceeded"). A slow machine then
// reported a good page as crashed. Pure: a fake browser whose screenshot only says how long it would take, and rejects
// when the timeout it was given is shorter, like Playwright. No browser, no waiting.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { crc32 } from 'node:zlib';
import { checkPage } from '../scripts/check.mjs';

// An 8-bit RGB PNG of four stripes: more than the three distinct colours a canvas needs to count as drawn.
function stripedPng(w = 64, h = 64) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(w, 0);
  header.writeUInt32BE(h, 4);
  header[8] = 8;
  header[9] = 2;
  const colours = [[200, 30, 30], [30, 200, 30], [30, 30, 200], [240, 240, 240]];
  const rows = Array.from({ length: h }, (_, y) => Buffer.concat([Buffer.from([0]), ...Array.from({ length: w }, (_, x) => Buffer.from(colours[Math.floor(x / 16) % 4]))]));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

// A browser that shows a good page with no tour; every screenshot "takes" `shotMs` and fails when given less.
function fakeBrowser(shotMs) {
  const png = stripedPng();
  const timeouts = [];
  const take = async (what, timeout) => {
    timeouts.push(timeout);
    if (shotMs > timeout) throw new Error(`${what}: Timeout ${timeout}ms exceeded.\nCall log: ...`);
  };
  const page = {
    setDefaultTimeout() {}, setDefaultNavigationTimeout() {}, on() {},
    goto: async () => {},
    evaluate: async (fn) => ({
      webglWorks: true,
      sceneFacts: { state: 'ready', fallbackSize: null, beats: 0 },
      pageFits: { scrollW: 390, innerW: 390, scrollH: 780, innerH: 780 },
    })[fn.name],
    waitForFunction: async () => {},
    waitForTimeout: async () => {},
    addStyleTag: async () => ({ evaluate: async () => {} }),
    locator: () => ({ first: () => ({ screenshot: async ({ timeout } = {}) => { await take('locator.screenshot', timeout ?? 30000); return png; } }) }),
    screenshot: async ({ timeout } = {}) => { await take('page.screenshot', timeout ?? 5000); },
  };
  const context = { newPage: async () => page, close: async () => {} };
  return { browser: { newContext: async () => context, close: async () => {} }, timeouts };
}

const run = async (shotMs, options = {}) => {
  const { browser, timeouts } = fakeBrowser(shotMs);
  const result = await checkPage(path.join(os.tmpdir(), 'page.html'), { launcher: () => Promise.resolve(browser), ...options });
  return { result, timeouts };
};

test('a canvas screenshot that takes 7 s is slow, not a crash (the other page actions keep their 5 s)', async () => {
  const { result } = await run(7000);
  assert.deepEqual(result.problems, []);
  assert.equal(result.status, 'ok');
});

test('a --shots screenshot of the page gets the same budget', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-shot-budget-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { result } = await run(7000, { shotsDir: dir });
  assert.deepEqual(result.problems, []);
  assert.equal(result.status, 'ok');
});

test('a screenshot that takes longer than any healthy runner (20 s) is still reported as a crash naming the timeout', async () => {
  const { result } = await run(20000);
  assert.equal(result.status, 'failed');
  assert.match(result.problems[0], /check crashed: locator\.screenshot: Timeout \d+ms exceeded/);
});
