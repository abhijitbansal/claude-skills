// Task 21, fix round 2: what a Lottie file may make lottie-web build or write, and the time limits that hold when a file
// gets past the static checks anyway. lottie.test.mjs covers the element itself; this file covers the limits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { lottieProblems } from '../template/lottie-guard.mjs';
import { MAX_REPEATER_COPIES, MAX_STAR_POINTS, MAX_ZIGZAG_RIDGES, MAX_LOTTIE_ELEMENTS, MAX_TEXT_CHARACTERS, easedMax } from '../template/lottie-budget.mjs';
import { readyBudget, waitReady, boundPage, frameLimit, FRAME_MS } from '../scripts/lib/ready.mjs';
import { startServer } from '../scripts/lib/server.mjs';
import { launchBrowser, guardNetwork } from '../scripts/lib/browser.mjs';
import { requireRender, BROWSER_ONLY } from './helpers/render.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(root, 'test/fixtures/data');
const RENDER = path.join(root, 'scripts/render.mjs');
const CHECK = path.join(root, 'scripts/check.mjs');
const OVERSHOOT = path.join(FIXTURES, 'lottie-overshoot-bomb.json');
const GLYPHS = path.join(FIXTURES, 'lottie-glyph-bomb.json');
const SOLID_SINK = path.join(FIXTURES, 'lottie-solid-sink.json');
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const said = (problems) => problems.map((p) => `${p.path}: ${p.message}`);

const still = (k) => ({ a: 0, k });
const TR = { ty: 'tr', p: still([0, 0]), a: still([0, 0]), s: still([100, 100]), r: still(0), o: still(100) };
const KS = { o: still(100), r: still(0), p: still([50, 50, 0]), a: still([0, 0, 0]), s: still([100, 100, 100]) };
const rect = { ty: 'rc', d: 1, p: still([0, 0]), s: still([4, 4]), r: still(0) };
const fill = { ty: 'fl', c: still([1, 1, 1, 1]), o: still(100), r: 1 };
const shapeLayer = (items, extra = {}) => ({ ddd: 0, ind: 1, ty: 4, sr: 1, ao: 0, ip: 0, op: 30, st: 0, bm: 0, ks: KS, shapes: [{ ty: 'gr', it: [...items, TR] }], ...extra });
const doc = (extra = {}) => ({ v: '5.7.4', fr: 30, ip: 0, op: 30, w: 100, h: 100, ddd: 0, assets: [], layers: [shapeLayer([rect, fill])], ...extra });
// A count property keyed from `from` to `to` with the bezier ease { o.y, i.y } between them.
const eased = (from, to, y1, y2, extra = {}) => ({ a: 1, k: [{ t: 0, s: [from], o: { x: [0.3], y: [y1] }, i: { x: [0.7], y: [y2] }, ...extra }, { t: 30, s: [to] }] });
const repeater = (c) => ({ ty: 'rp', c, o: still(0), m: 1, tr: { ty: 'tr', p: still([1, 0]), a: still([0, 0]), s: still([100, 100]), r: still(0), so: still(100), eo: still(100) } });
const textLayer = (text, extra = {}) => ({ ddd: 0, ind: 2, ty: 5, sr: 1, ao: 0, ip: 0, op: 30, st: 0, bm: 0, ks: KS,
  t: { d: { k: [{ s: { t: text, f: 'Sans', s: 4, fc: [1, 1, 1], j: 0, tr: 0, lh: 5, ls: 0 }, t: 0 }] }, p: {}, m: { g: 1, a: still([0, 0]) }, a: [] }, ...extra });
const FONTS = { list: [{ fName: 'Sans', fFamily: 'Arial', fStyle: 'Regular', fOrigin: 'n', ascent: 70 }] };
const glyph = (shapes) => ({ ch: 'A', fFamily: 'Arial', size: 4, style: 'Regular', w: 60, data: { shapes } });

function folder(lottie, { duration = 2 } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'lottie-limits-'));
  writeFileSync(path.join(dir, 'anim.json'), typeof lottie === 'string' ? lottie : JSON.stringify(lottie));
  writeFileSync(path.join(dir, 'motion.json'), JSON.stringify({ size: [320, 180], background: '#000000',
    scenes: [{ id: 's', duration, elements: [{ id: 'l', type: 'lottie', src: 'anim.json', x: 160, y: 90, width: 100, height: 100, hold: true }] }] }));
  return dir;
}

// ---- R1-1, static: an eased count is budgeted at its true maximum ---------------------------------------------------------

test('easedMax: the true maximum of a keyed value over its bezier ease, solved analytically', () => {
  assert.equal(easedMax(eased(1, 1000, 0.42, 1)), 1000, 'an ease with y in [0, 1] never passes its keys');
  assert.equal(easedMax(eased(1000, 1, 0, 0.58)), 1000);
  const big = easedMax(eased(1, 1000, 400, 400));
  assert.ok(big > 299000 && big < 300100, `y 400 overshoots to about 1 + 999 x 300: ${big}`);
  const three = easedMax(eased(1, 600, 3, 3)); // B(t) = 9t(1-t) + t^3, largest at t = (18 - sqrt(216)) / 6
  const t = (18 - Math.sqrt(216)) / 6;
  assert.ok(Math.abs(three - (1 + 599 * (9 * t * (1 - t) + t ** 3))) < 1e-6, String(three));
  assert.equal(easedMax(eased(1, 600, 3, 3, { h: 1 })), 600, 'a hold keyframe jumps: its ease is never used');
  assert.equal(easedMax(still(7)), 7);
  assert.ok(Number.isNaN(easedMax(eased(1, 2, 'x', 1))), 'an ease that is not a number');
  assert.equal(easedMax({ a: 1, k: [{ t: 0, s: [5], e: [9], o: { x: [0], y: [0] }, i: { x: [1], y: [1] } }, { t: 30 }] }), 9, 'the old e form');
});

test('R1-1: the reviewer\'s 862-byte overshoot file (keys 1 and 1000, ease y 400) is refused at its true maximum', () => {
  const [problem] = said(lottieProblems(readJson(OVERSHOOT)));
  const m = /^layers\[0\]\.shapes\[1\]\.c: (\d+) repeater copies; at most 1000$/.exec(problem);
  assert.ok(m, problem);
  assert.ok(Number(m[1]) > 299000, m[1]);
});

test('R1-1: a star and a zig-zag eased past their caps are refused; a gentle ease to the cap passes', () => {
  const star = { ty: 'sr', sy: 1, d: 1, pt: eased(3, 1000, 200, 200), p: still([0, 0]), r: still(0), ir: still(10), is: still(0), or: still(40), os: still(0) };
  const zz = { ty: 'zz', s: still(3), r: eased(1, 900, 2, 2), pt: still(1) };
  const got = said(lottieProblems(doc({ layers: [shapeLayer([rect, star, zz, fill])] })));
  assert.equal(got.length, 2, got.join('\n'));
  assert.match(got[0], new RegExp(`^layers\\[0\\]\\.shapes\\[0\\]\\.it\\[1\\]\\.pt: \\d+ star points; at most ${MAX_STAR_POINTS}$`));
  assert.match(got[1], new RegExp(`^layers\\[0\\]\\.shapes\\[0\\]\\.it\\[2\\]\\.r: \\d+ zig-zag ridges; at most ${MAX_ZIGZAG_RIDGES}$`));
  assert.deepEqual(lottieProblems(doc({ layers: [shapeLayer([rect, fill, repeater(eased(1, MAX_REPEATER_COPIES, 0.2, 1))])] })), []);
});

// ---- R1-1, runtime: every frame is time-limited ---------------------------------------------------------------------------

test('frameLimit: 10 s a frame; PA_FRAME_MS (a plain positive integer) replaces it in tests, anything else is ignored', () => {
  assert.equal(FRAME_MS, 10000);
  assert.equal(frameLimit({}), 10000);
  assert.equal(frameLimit({ PA_FRAME_MS: '25' }), 25);
  for (const bad of ['', '0', '-1', '1e3', ' 5', '5ms', '0x10']) assert.equal(frameLimit({ PA_FRAME_MS: bad }), 10000, JSON.stringify(bad));
});

test('boundPage: a seek or a screenshot that never finishes rejects in time, naming the frame and the time; anything else passes through', async () => {
  const stuck = { evaluate: (fn) => (String(fn).includes('.seek(') ? new Promise(() => {}) : Promise.resolve(42)), screenshot: () => new Promise(() => {}), url: () => 'u' };
  const page = boundPage(stuck, { ms: 40, hint: '; a hint', fps: 10 });
  assert.equal(await page.evaluate(() => 1), 42);
  assert.equal(page.url(), 'u');
  const started = Date.now();
  await assert.rejects(page.evaluate((s) => window.__motion.seek(s), 1.2), (e) => e.message === 'the frame at 1.2 s (frame 12) did not finish drawing within 0.04 s; a hint');
  await assert.rejects(page.screenshot({ type: 'png' }), (e) => e.message === 'the frame at 1.2 s (frame 12) did not finish drawing within 0.04 s; a hint');
  await assert.rejects(boundPage(stuck, { ms: 40 }).evaluate(async ([s]) => { await window.__motion.seek(s); }, [0.5, 1]), /^Error: the frame at 0\.5 s did not finish drawing within 0\.04 s$/);
  assert.ok(Date.now() - started < 2000);
});

// The real page with lottieProblems answering [] (the module is replaced on the wire): the static guard bypassed.
async function bypassedPage(dir) {
  const guard = readFileSync(path.join(root, 'template/lottie-guard.mjs'), 'utf8').replace('export function lottieProblems(json) {', 'export function lottieProblems(json) { return [];');
  assert.ok(guard.includes('{ return [];'), 'the bypass took');
  const srv = await startServer({ specPath: path.join(dir, 'motion.json'), mode: 'render' });
  const browser = await launchBrowser({ quiet: true });
  const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
  await page.route('**/template/lottie-guard.mjs', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: guard }));
  await page.goto(srv.url);
  return { page, close: async () => { await browser.close(); await srv.close(); } };
}

test('R1-1: with the static guard bypassed, the overshoot file is ready but a seek into the overshoot fails within the frame limit, and the browser closes', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const dir = folder(readJson(OVERSHOOT));
  const { page, close } = await bypassedPage(dir);
  const started = Date.now();
  try {
    const { ms, hint } = readyBudget(readJson(path.join(dir, 'motion.json')), {});
    await waitReady(page, ms, hint);
    const bounded = boundPage(page, { ms: 3000, hint, fps: 30 });
    await assert.rejects(bounded.evaluate((s) => window.__motion.seek(s), 1),
      (e) => e.message === 'the frame at 1 s (frame 30) did not finish drawing within 3 s; a lottie file too heavy to draw stops the page: "l" (anim.json)');
    assert.ok(Date.now() - started < 20000, `${Date.now() - started} ms`);
  } finally { await close(); }
  assert.ok(Date.now() - started < 30000, 'and the browser closed promptly');
});

// Every file left in `dir` after a failed run, but the spec and the lottie.
const leftovers = (dir) => readdirSync(dir, { recursive: true }).filter((f) => !['motion.json', 'anim.json'].includes(String(f)));

test('R1-1: render (one page and four), the contact sheet and check all time-limit each frame, and a timed-out render leaves no output', async (t) => {
  if (!(await requireRender(t))) return;
  const env = { ...process.env, PA_FRAME_MS: '1' };
  const message = /the frame at [\d.]+ s \(frame \d+\) did not finish drawing within 0\.001 s; a lottie file too heavy to draw stops the page: "l" \(anim\.json\)/;
  for (const args of [['--out', 'v.mp4', '--fps', '10'], ['--out', 'v.mp4', '--fps', '10', '--workers', '4'], ['--contact-sheet', '--out', 'sheet']]) {
    const dir = folder(doc({ layers: [shapeLayer([rect, fill], { ks: { ...KS, r: { a: 1, k: [{ t: 0, s: [0], o: { x: [0.5], y: [0.5] }, i: { x: [0.5], y: [0.5] } }, { t: 30, s: [90] }] } } })] }));
    const r = spawnSync(process.execPath, [RENDER, path.join(dir, 'motion.json'), ...args.map((a) => (a === 'v.mp4' || a === 'sheet' ? path.join(dir, a) : a))], { encoding: 'utf8', env, timeout: 120000 });
    assert.equal(r.status, 1, `${args.join(' ')}: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout + r.stderr, message, args.join(' '));
    assert.deepEqual(leftovers(dir).filter((f) => !String(f).startsWith('sheet') || String(f).endsWith('.png')), [], `${args.join(' ')}: no partial output`);
  }
  const dir = folder(doc());
  const c = spawnSync(process.execPath, [CHECK, path.join(dir, 'motion.json'), '--json'], { encoding: 'utf8', env, timeout: 120000 });
  assert.equal(c.status, 1, c.stdout + c.stderr);
  assert.match(JSON.parse(c.stdout).errors[0].message, /the frame at [\d.]+ s \(frame \d+\) did not finish drawing within 0\.001 s; a lottie file too heavy to draw stops the page: "l" \(anim\.json\)/);
});

test('R1-1: the overshoot file is refused before render opens a browser', () => {
  const dir = folder(readJson(OVERSHOOT));
  const r = spawnSync(process.execPath, [RENDER, path.join(dir, 'motion.json'), '--out', path.join(dir, 'v.mp4')], { encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /layers\[0\]\.shapes\[1\]\.c: \d+ repeater copies; at most 1000 \(in anim\.json\)/);
  assert.equal(existsSync(path.join(dir, 'v.mp4')), false);
});

// ---- R1-2: glyphs count once per typed letter -----------------------------------------------------------------------------

test('R1-2: the reviewer\'s 1,441-byte glyph file (a 1,000-copy glyph typed 200 times) is over the total', () => {
  const [problem] = said(lottieProblems(readJson(GLYPHS)));
  const m = /^\(root\): lottie-web would build about (\d+) shapes and layers \(repeaters, precomps and glyphs multiplied out\); at most 10000$/.exec(problem);
  assert.ok(m, problem);
  assert.ok(Number(m[1]) > 200000, m[1]);
});

test('R1-2: a glyph typed a few times is inside the total; the cost is the largest glyph times the longest text', () => {
  const small = doc({ fonts: FONTS, chars: [glyph([{ ty: 'gr', it: [rect, fill, TR] }])], layers: [textLayer('AAAA')] });
  assert.deepEqual(lottieProblems(small), []);
  const heavy = doc({ fonts: FONTS, chars: [glyph([{ ty: 'gr', it: [rect, fill, repeater(still(100)), TR] }])], layers: [textLayer('A'.repeat(60))] });
  assert.deepEqual(said(lottieProblems(heavy)), [`(root): lottie-web would build about 12061 shapes and layers (repeaters, precomps and glyphs multiplied out); at most ${MAX_LOTTIE_ELEMENTS}`]);
});

test('R5: a text document longer than the cap is refused by length', () => {
  assert.deepEqual(lottieProblems(doc({ fonts: FONTS, layers: [textLayer('A'.repeat(MAX_TEXT_CHARACTERS))] })), []);
  assert.deepEqual(said(lottieProblems(doc({ fonts: FONTS, layers: [textLayer('A'.repeat(MAX_TEXT_CHARACTERS + 1))] }))),
    [`layers[0].t.d.k[0].s.t: ${MAX_TEXT_CHARACTERS + 1} characters; at most ${MAX_TEXT_CHARACTERS}`]);
});

// ---- R1-3: no file string reaches a DOM attribute unless it is a plain value --------------------------------------------

test('R1-3: a solid layer\'s sc must be a #rgb or #rrggbb colour; the reviewer\'s three url() values are refused', () => {
  assert.deepEqual(said(lottieProblems(readJson(SOLID_SINK))), [0, 1, 2].map((i) => `layers[${i}].sc: must be a colour like #ff0000 (a solid layer's fill)`));
  const solid = (sc, extra = {}) => ({ ddd: 0, ind: 1, ty: 1, sc, sw: 100, sh: 100, sr: 1, ao: 0, ip: 0, op: 30, st: 0, bm: 0, ks: KS, ...extra });
  assert.deepEqual(lottieProblems(doc({ layers: [solid('#ff0000'), solid('#F0a')] })), []);
  for (const bad of ['red', '#ff00', 'rgb(1,2,3)', '#ff0000;x', ' #ff0000', 5]) assert.equal(lottieProblems(doc({ layers: [solid(bad)] })).length, 1, JSON.stringify(bad));
  assert.deepEqual(said(lottieProblems(doc({ layers: [solid('#000', { sw: '100" onload="x', sh: 'url(#g)' })] }))), ['layers[0].sw: must be a number', 'layers[0].sh: must be a number']);
});

test('R1-3: an image\'s pr, a layer\'s w and h, and a font\'s names are held to plain values', () => {
  const png = 'data:image/png;base64,AAAA';
  assert.deepEqual(lottieProblems(doc({ assets: [{ id: 'i', w: 4, h: 4, u: '', p: png, e: 1, pr: 'xMidYMid slice' }] })), []);
  assert.deepEqual(said(lottieProblems(doc({ assets: [{ id: 'i', w: 4, h: 4, u: '', p: png, e: 1, pr: 'url(#x)' }] }))), ['assets[0].pr: must be an SVG preserveAspectRatio value such as "xMidYMid meet"']);
  assert.deepEqual(said(lottieProblems(doc({ assets: [{ id: 'i', w: '4px', h: 4, u: '', p: png, e: 1 }] }))), ['assets[0].w: must be a number']);
  const precompLayer = { ...shapeLayer([]), ty: 0, refId: 'c', w: '100 Z M0,0', h: 100, shapes: [] };
  assert.deepEqual(said(lottieProblems(doc({ assets: [{ id: 'c', layers: [] }], layers: [precompLayer] }))), ['layers[0].w: must be a number']);
  assert.deepEqual(lottieProblems(doc({ fonts: { list: [{ fName: 'Roboto-Bold', fFamily: 'Roboto Slab', fStyle: 'Bold Italic', fWeight: '700', fOrigin: 'n' }] } })), []);
  const font = (extra) => doc({ fonts: { list: [{ fName: 'A', fFamily: 'Arial', fStyle: 'Regular', fOrigin: 'n', ...extra }] } });
  const plain = 'must be a plain font name (letters, digits, spaces and . , \' - _)';
  assert.deepEqual(said(lottieProblems(font({ fFamily: 'x; } body { background: url(http://e/x)' }))), [`fonts.list[0].fFamily: ${plain}`]);
  assert.deepEqual(said(lottieProblems(font({ fStyle: 'url(x)' }))), [`fonts.list[0].fStyle: ${plain}`]);
  assert.deepEqual(said(lottieProblems(font({ fWeight: 'bold"' }))), [`fonts.list[0].fWeight: ${plain}`]);
  assert.deepEqual(said(lottieProblems(font({ fName: '<b>' }))), [`fonts.list[0].fName: ${plain}`]);
});

test('R1-3: the page refuses the solid-sink file: no request beyond the page and the file, no CSP violation', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const dir = folder(readJson(SOLID_SINK));
  const srv = await startServer({ specPath: path.join(dir, 'motion.json'), mode: 'render' });
  const browser = await launchBrowser({ quiet: true });
  try {
    const page = await browser.newPage();
    const requests = [];
    const blocked = [];
    await guardNetwork(page, new URL(srv.url).origin, (u) => blocked.push(u));
    await page.addInitScript(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.blockedURI)); });
    page.on('request', (r) => requests.push(r.url()));
    await page.goto(srv.url);
    await page.waitForFunction(() => window.__motion);
    const ready = await page.evaluate(() => window.__motion.ready.then(() => true, (e) => e.message));
    assert.equal(ready, 'lottie anim.json: layers[0].sc: must be a colour like #ff0000 (a solid layer\'s fill)');
    assert.deepEqual(await page.evaluate(() => window.__csp), []);
    assert.deepEqual(blocked, []);
    assert.deepEqual(requests.filter((u) => /paint\.svg/.test(u)), []);
  } finally { await browser.close(); await srv.close(); }
});

// ---- R1-4 and R1-5 --------------------------------------------------------------------------------------------------------

test('R1-4: an empty-string x is no expression (lottie-web ignores it); a non-empty one still is', () => {
  const layer = (x) => shapeLayer([rect, fill], { ks: { ...KS, o: { a: 0, k: 100, x } } });
  assert.deepEqual(lottieProblems(doc({ layers: [layer('')] })), []);
  assert.deepEqual(said(lottieProblems(doc({ layers: [layer(' ')] }))), ['layers[0].ks.o.x: expressions are not supported']);
});

test('R1-5: a 200-precomp chain and 120 nested groups are budgeted without recursion trouble', () => {
  const assets = Array.from({ length: 200 }, (_, i) => ({ id: `c${i}`, layers: i < 199 ? [{ ...shapeLayer([]), ty: 0, refId: `c${i + 1}`, shapes: [] }] : [shapeLayer([rect, fill])] }));
  assert.deepEqual(lottieProblems(doc({ assets, layers: [{ ...shapeLayer([]), ty: 0, refId: 'c0', shapes: [] }] })), []);
  let group = { ty: 'gr', it: [rect, fill, TR] };
  for (let i = 0; i < 40; i++) group = { ty: 'gr', it: [group, TR] }; // each level is gr + it: 2 JSON levels
  assert.deepEqual(lottieProblems(doc({ layers: [{ ...shapeLayer([]), shapes: [group] }] })), []);
});

test('R1-5: a stack overflow inside lottie-web (300,000 characters, guard bypassed) fails the page with a message that names the cause', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const dir = folder(doc({ fonts: FONTS, layers: [textLayer('A'.repeat(300000))] }));
  const { page, close } = await bypassedPage(dir);
  try {
    await page.waitForFunction(() => window.__motion);
    const ready = await page.evaluate(() => window.__motion.ready.then(() => true, (e) => e.message));
    assert.match(String(ready), /^lottie anim\.json is too complex for lottie-web to draw \(it ran out of stack: Maximum call stack size exceeded\); simplify it: fewer characters, points, copies or nested groups$/);
  } finally { await close(); }
});
