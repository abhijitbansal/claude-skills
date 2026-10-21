// Runs against the synced copy of shared/nowrap-probe.mjs. It lives here, not in shared/test/,
// because CI runs shared/test before `npm ci`, when no browser is installed and every case would skip.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { nowrapProblems, overflowProblems } from '../shared/nowrap-probe.mjs';
import { launchBrowser, haveBrowser } from './helpers/browser.mjs';

const skip = !(await haveBrowser()) && 'no browser available';
let browser;
let page;

before(async () => {
  if (skip) return;
  browser = await launchBrowser();
  page = await browser.newPage();
});
after(async () => { await browser?.close(); });

const para = (inner) => `<body style="margin:0;font:16px/1.4 monospace"><p style="width:120px;margin:0">${inner}</p></body>`;

test('nowrapProblems reports a token that wraps across two lines', { skip }, async () => {
  await page.setContent(para('aaaa 1,204 ms'));
  assert.deepEqual(await nowrapProblems(page), [{ text: '1,204 ms', lines: 2 }]);
});

test('nowrapProblems is quiet when the token is held with white-space nowrap', { skip }, async () => {
  await page.setContent(para('aaaa <span style="white-space:nowrap">1,204 ms</span>'));
  assert.deepEqual(await nowrapProblems(page), []);
});

test('nowrapProblems honours the root selector', { skip }, async () => {
  await page.setContent('<body style="margin:0;font:16px/1.4 monospace"><div id="a" style="width:120px">aaaa 1,204 ms</div><div id="b" style="width:120px">fine</div></body>');
  assert.deepEqual(await nowrapProblems(page, { root: '#b' }), []);
  assert.equal((await nowrapProblems(page, { root: '#a' })).length, 1);
});

test('nowrapProblems skips text inside code, pre, kbd and samp, and still reports the same text outside them', { skip }, async () => {
  for (const tag of ['code', 'pre', 'kbd', 'samp']) {
    await page.setContent(para(`aaaa <${tag}>1,204 ms</${tag}>`));
    assert.deepEqual(await nowrapProblems(page), [], tag);
  }
  await page.setContent(para('aaaa <code><b>1,204 ms</b></code>'));
  assert.deepEqual(await nowrapProblems(page), [], 'nested inside code');
  await page.setContent(para('aaaa <span>1,204 ms</span>'));
  assert.deepEqual(await nowrapProblems(page), [{ text: '1,204 ms', lines: 2 }]);
});

test('nowrapProblems does not see a token split across inline elements (documented limit)', { skip }, async () => {
  await page.setContent(para('aaaa <b>1,204</b> ms'));
  assert.deepEqual(await nowrapProblems(page), []);
});

test('overflowProblems flags content wider than its box and not a short one', { skip }, async () => {
  await page.setContent('<body style="margin:0"><div id="wide" style="width:60px"><span style="display:inline-block;width:200px">wide</span></div><div id="short" style="width:60px"><span style="display:inline-block;width:20px">ok</span></div></body>');
  const found = await overflowProblems(page, '#wide, #short');
  assert.equal(found.length, 1);
  assert.equal(found[0].text, 'wide');
  assert.equal(found[0].clientWidth, 60);
  assert.ok(found[0].scrollWidth >= 200);
});
