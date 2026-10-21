import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from '../scripts/lib/browser.mjs';
import { startServer } from '../scripts/lib/server.mjs';
import { bindWithNbsp, findTokens } from '../shared/nowrap.mjs';
import { nowrapProblems } from '../shared/nowrap-probe.mjs';
import { main as checkMain, wrapProblems } from '../scripts/check.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = path.join(root, 'scripts/check.mjs');
const SPEC_DIRS = [path.join(root, 'test/fixtures'), path.join(root, 'references/examples')];
const TOKEN_TEXT = 'Latency fell to 1,204 ms after the change';
const MESSAGE = 'a number-plus-unit token wraps across lines';

let browserPresent;
async function skipUnlessBrowser(t) {
  browserPresent ??= await launchBrowser({ quiet: true }).then((b) => b.close().then(() => true), () => false);
  if (!browserPresent) t.skip('no browser (bundled Chromium or system Chrome)');
  return !browserPresent;
}

function specFile(elements, { size = [1920, 1080] } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'motion-nowrap-'));
  const file = path.join(dir, 'motion.json');
  writeFileSync(file, JSON.stringify({ size, fps: 30, scenes: [{ id: 's', duration: 2, elements }] }));
  return file;
}

// The expected render: only the space inside each token found by the shared pattern becomes U+00A0.
const withTokenSpacesBound = (text) => findTokens(text).reduceRight(
  (acc, tok) => acc.slice(0, tok.start) + tok.text.replace(' ', '\u00a0') + acc.slice(tok.end), text);

const narrowToken = () => specFile([{ id: 'latency', type: 'text', text: TOKEN_TEXT, x: 960, y: 540, fontSize: 120, maxWidth: 300 }]);

test('check: a token in a narrow box is held on one line by the renderer, so check passes', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const r = spawnSync(process.execPath, [CHECK, narrowToken()], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout, new RegExp(MESSAGE));
});

test('check guardrail: a plain-space token that wraps is reported once per scene, with the scene index', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  // The renderer binds tokens with U+00A0, so build the failing case by hand: the same text with a plain space in a narrow box.
  const browser = await launchBrowser({ quiet: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await page.setContent(`<div id="stage"><div style="width:300px;font-size:120px;text-align:center">${TOKEN_TEXT}</div></div>`);
    const wraps = await nowrapProblems(page, { root: '#stage' });
    assert.deepEqual(wraps.map((w) => w.text), ['1,204 ms'], 'the probe sees the wrapped token');
    // Three sampled moments see the same wrap: it is one problem for the scene.
    const samples = [0.5, 1, 1.5].map((t0) => ({ t: t0, els: [], wraps }));
    const problems = wrapProblems({ id: 'facts' }, 3, samples);
    assert.equal(problems.length, 1);
    assert.equal(problems[0].path, 'scenes[3]');
    assert.match(problems[0].message, new RegExp(`^${MESSAGE}: "1,204 ms" at 0\\.50s$`));
  } finally {
    await browser.close();
  }
});

test('check end to end: with the NBSP binding undone on the page, the real check path reports the wrap and exits 1', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  // `prepare` is check.mjs's test seam: it runs on the ready render page before sampling. Here it asserts the page
  // has the #stage the wrap probe is rooted at, then swaps U+00A0 back to a plain space in the rendered text.
  const prepare = async (page) => {
    assert.equal(await page.evaluate(() => document.querySelectorAll('#stage').length), 1, 'the render page has one #stage');
    const swapped = await page.evaluate(() => [...document.querySelectorAll('#stage .el.text')].map((n) => {
      n.textContent = n.textContent.replaceAll('\u00a0', ' ');
      return n.textContent;
    }));
    assert.deepEqual(swapped, [TOKEN_TEXT], 'the binding was present and is now undone');
  };
  const out = [];
  const realWrite = process.stdout.write;
  process.stdout.write = (chunk, ...rest) => (typeof chunk === 'string' ? (out.push(chunk), true) : realWrite.call(process.stdout, chunk, ...rest)); // the test runner's own output is not a string
  let code;
  try {
    code = await checkMain([narrowToken(), '--json'], { prepare });
  } finally {
    process.stdout.write = realWrite;
  }
  const body = JSON.parse(out.join(''));
  assert.equal(code, 1, out.join(''));
  assert.equal(body.ok, false);
  const wrapped = body.errors.filter((e) => e.message.startsWith(MESSAGE));
  assert.equal(wrapped.length, 1, 'one problem per token per scene, however many moments see it');
  assert.equal(wrapped[0].path, 'scenes[0]');
  assert.match(wrapped[0].message, /"1,204 ms" at \d+\.\d\ds$/);
});

test('wrapProblems: distinct tokens each report once; no wraps report nothing', () => {
  const samples = [
    { t: 0.5, wraps: [{ text: '87%', lines: 2 }] },
    { t: 1, wraps: [{ text: '87%', lines: 2 }, { text: '1,204 ms', lines: 2 }] },
    { t: 1.5, wraps: [] },
  ];
  assert.deepEqual(wrapProblems({ id: 's' }, 0, samples).map((p) => p.message), [`${MESSAGE}: "87%" at 0.50s`, `${MESSAGE}: "1,204 ms" at 1.00s`]);
  assert.deepEqual(wrapProblems({ id: 's' }, 0, [{ t: 0, wraps: [] }]), []);
});

// Text-level determinism (the spec is never rewritten; frames hash differently per machine, so compare text).
test('bindWithNbsp leaves token-free text identical and swaps only the token space', () => {
  for (const s of ['Revenue up', 'Costs down', '12 files', '3 options', 'v1.2.3 shipped', '']) assert.equal(bindWithNbsp(s), s, s);
  assert.equal(bindWithNbsp(TOKEN_TEXT), 'Latency fell to 1,204 ms after the change');
  assert.equal(findTokens(bindWithNbsp(TOKEN_TEXT)).length, 0, 'a bound token no longer matches the plain-space pattern');
});

test('rendered text element textContent: unchanged without a token; only the token space is U+00A0 with one', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const files = SPEC_DIRS.flatMap((dir) => readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => path.join(dir, f)));
  files.push(narrowToken());
  const browser = await launchBrowser({ quiet: true });
  let tokenSpecs = 0;
  try {
    for (const file of files) {
      const spec = JSON.parse(readFileSync(file, 'utf8'));
      const texts = spec.scenes.flatMap((s) => s.elements).filter((e) => e.type === 'text');
      if (!texts.length) continue;
      const server = await startServer({ specPath: file, mode: 'render' });
      try {
        const page = await browser.newPage({ viewport: { width: spec.size[0], height: spec.size[1] } });
        await page.goto(server.url);
        await page.waitForFunction(() => window.__motion, null, { timeout: 0 });
        await page.evaluate(() => window.__motion.ready);
        const rendered = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.el.text')].map((n) => [n.dataset.id, n.textContent])));
        for (const el of texts) {
          const hasToken = findTokens(el.text).length > 0;
          tokenSpecs += hasToken ? 1 : 0;
          if (hasToken) assert.equal(rendered[el.id], withTokenSpacesBound(el.text), `${file}: ${el.id}`);
          else assert.equal(rendered[el.id], el.text, `${file}: ${el.id}`);
        }
        await page.close();
      } finally {
        await server.close();
      }
    }
  } finally {
    await browser.close();
  }
  assert.ok(tokenSpecs >= 1, 'at least the narrow-token spec exercises the binding');
});
