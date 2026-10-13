// Final fix wave B2: the rise-in safety net, deck ids, check.mjs probes, the example poster,
// motion child processes, deck focus and the diagram's sideways scroll.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildSpec, buildFile, exampleFile, haveBrowser, openPage, closeSharedBrowser } from './helpers/browser.mjs';
import { checkPage } from '../scripts/check.mjs';
import { buildPage } from '../scripts/lib/page.mjs';
import { validateSpec } from '../scripts/lib/spec.mjs';
import { runChild, posterFrame, renderMotion, renderFailure } from '../scripts/lib/motion-render.mjs';

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const made = [];
after(async () => {
  await closeSharedBrowser();
  for (const d of made) fs.rmSync(d, { recursive: true, force: true });
});
const skipUnlessBrowser = async (t) => {
  if (await haveBrowser()) return false;
  t.skip('no browser (bundled Chromium or system Chrome)');
  return true;
};
const tmp = (prefix) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  made.push(dir);
  return dir;
};

const topic = (n, extra = {}) => ({ type: 'text', title: `Topic ${n}`, text: `Body ${n}.`, ...extra });
const deckSpec = (count, extra = {}) => ({ title: 'Deck', mode: 'slides', sections: Array.from({ length: count }, (_, i) => topic(i + 1)), ...extra });
const current = (page) => page.evaluate(() => Number(document.querySelector('[data-deck]').dataset.current));
const settled = (page, n) => page.waitForFunction((want) => Number(document.querySelector('[data-deck]').dataset.current) === want, n);

// A copy of a built page with `extra` markup placed before </body>.
function withExtra(built, extra, name) {
  const file = path.join(path.dirname(built.file), `${name}.html`);
  fs.writeFileSync(file, built.html.replace('</body>', `${extra}\n</body>`));
  return file;
}

const flow = (title) => ({
  title,
  type: 'flow',
  nodes: [{ id: 'a', label: 'Start', kind: 'start' }, { id: 'b', label: 'Do it' }, { id: 'c', label: 'Done', kind: 'end' }],
  edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }],
});

// ---- 1. rise-in safety net -------------------------------------------------------------------

test('rise-in: with no scrolling at all, every section is visible once the page has been loaded for a moment', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(buildFile(exampleFile('concept')).url, { reducedMotion: 'no-preference' });
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('rise-ready')), true, 'armed: this page rises in');
  const total = await page.evaluate(() => document.querySelectorAll('.sec').length);
  assert.ok(total > 3);
  // The first screen is up at once; the sections below it wait (the flash guard stays).
  const early = await page.evaluate(() => document.querySelectorAll('.sec:not(.in)').length);
  assert.ok(early > 0, 'sections below the fold are still hidden right after load');
  // No scroll, no print: a capture that never scrolls must still find every section.
  await page.waitForFunction(() => document.querySelectorAll('.sec:not(.in)').length === 0, null, { timeout: 5000 });
  await page.waitForFunction(() => [...document.querySelectorAll('.sec')].every((s) => getComputedStyle(s).opacity === '1'), null, { timeout: 3000 });
  assert.equal(await page.evaluate(() => window.scrollY), 0, 'nothing scrolled');
  assert.deepEqual(problems, []);
  await context.close();
});

test('rise-in: beforeprint reveals every section at once', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, context } = await openPage(buildFile(exampleFile('concept')).url, { reducedMotion: 'no-preference' });
  assert.ok(await page.evaluate(() => document.querySelectorAll('.sec:not(.in)').length) > 0);
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  assert.equal(await page.evaluate(() => document.querySelectorAll('.sec:not(.in)').length), 0);
  await context.close();
});

// ---- 2. deck deep links honour explicit section ids ---------------------------------------------

const withIds = () => deckSpec(4, { sections: [topic(1, { id: 'overview' }), topic(2), topic(3, { id: 'the-risks' }), topic(4)] });

function loadLib() {
  const sandbox = {};
  sandbox.globalThis = sandbox;
  vm.runInNewContext(fs.readFileSync(new URL('../template/pa-lib.js', import.meta.url), 'utf8'), sandbox);
  return sandbox.PA;
}

test('pa-lib: parseSlideHash reads #<id> from the slide ids it is given; unknown hashes stay null', () => {
  const PA = loadLib();
  const ids = ['', 'overview', '', 'the-risks', ''];
  assert.equal(PA.parseSlideHash('#overview', 5, ids), 2);
  assert.equal(PA.parseSlideHash('#the-risks', 5, ids), 4);
  assert.equal(PA.parseSlideHash('#slide-3', 5, ids), 3, '#slide-N still works');
  for (const junk of ['#nope', '#Overview', '#overview-title', '#', '', '#slide-2-title', null, undefined]) {
    assert.equal(PA.parseSlideHash(junk, 5, ids), null, String(junk));
  }
  assert.equal(PA.parseSlideHash('#overview', 5), null, 'without ids nothing but #slide-N is read');
});

test('a deck marks each slide that has an explicit id, and the outline links to it', async () => {
  const { html } = await buildPage(withIds(), { dir: SKILL, out: path.join(tmp('b2-ids-'), 'd.html') });
  assert.match(html, /<section class="slide slide-text" id="slide-2" data-sid="overview"/);
  assert.match(html, /<section class="slide slide-text" id="slide-4" data-sid="the-risks"/);
  assert.ok(!/<section class="slide slide-text" id="slide-3" data-sid/.test(html), 'a slide without an id gets no data-sid');
  const dialog = html.match(/<dialog[^>]*data-outline[^>]*>[\s\S]*?<\/dialog>/)[0];
  const links = [...dialog.matchAll(/<a href="(#[^"]+)"[^>]*data-slide="(\d)"/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(links, [['#slide-1', '1'], ['#overview', '2'], ['#slide-3', '3'], ['#the-risks', '4'], ['#slide-5', '5']]);
  assert.ok(!/\sid="(overview|the-risks)"/.test(html), 'the id is not an element id: no clash with slide-N');
});

test('deep link: #<id> opens that slide, after load too; an unknown hash is ignored; the outline uses the id', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { url } = buildSpec(withIds());
  for (const [suffix, want] of [['#overview', 2], ['#the-risks', 4], ['#slide-3', 3], ['#nope', 1], ['#Overview', 1]]) {
    const { page, problems, context } = await openPage(url + suffix);
    assert.equal(await current(page), want, suffix);
    assert.deepEqual(problems, []);
    await context.close();
  }
  const { page, context } = await openPage(url);
  await page.evaluate(() => { location.hash = '#the-risks'; });
  await settled(page, 4);
  assert.equal(await page.evaluate(() => location.hash), '#the-risks', 'the address bar keeps the id link');
  await page.evaluate(() => { location.hash = '#nope'; });
  await page.waitForTimeout(200);
  assert.equal(await current(page), 4, 'an unknown hash does not move the deck');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await page.evaluate(() => location.hash), '#slide-3', 'a slide without an id shows #slide-N');
  await page.keyboard.press('o');
  await page.locator('[data-outline] a[href="#overview"]').click();
  await settled(page, 2);
  assert.equal(await page.evaluate(() => location.hash), '#overview');
  await context.close();
});

// ---- 3. check.mjs ----------------------------------------------------------------------------------

test('check: content clipped sideways inside a slide is reported with its slide number', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const built = buildSpec(deckSpec(3));
  const wide = '<script>var d = document.createElement("div"); d.id = "wide-thing"; d.style.cssText = "width:3000px;height:12px"; d.textContent = "wide"; document.querySelector("#slide-3 .slide-inner").appendChild(d);</script>';
  const result = await checkPage(withExtra(built, wide, 'clipped'));
  assert.equal(result.status, 'failed');
  assert.ok(result.problems.some((p) => /^390px: slide 3: #wide-thing is 3000px wide and is clipped by the slide$/.test(p)), result.problems.join('\n'));
  assert.ok(result.problems.some((p) => /^1280px: slide 3: #wide-thing is 3000px wide and is clipped by the slide$/.test(p)), result.problems.join('\n'));
  // A table that scrolls on its own inside a slide is by design.
  const table = buildSpec({ title: 'D', mode: 'slides', sections: [{ type: 'table', title: 'Wide table', columns: ['a', 'b', 'c', 'd', 'e', 'f'], rows: [['one long cell value', 'two long cell value', 'three long cell value', 'four long cell value', 'five long cell value', 'six long cell value']] }] });
  assert.deepEqual((await checkPage(table.file)).problems, []);
});

const diagramPage = (count = 1) => buildSpec({ title: 'Figures', sections: [{ type: 'text', text: 'Intro.' }, ...Array.from({ length: count }, (_, i) => ({ type: 'diagram', title: `Path ${i + 1}`, diagram: flow(`Path ${i + 1}`) }))] });

test('check: a covered Present button is one clear line per viewport, not a crash', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const cover = '<div style="position:fixed;left:0;top:0;right:0;bottom:0;z-index:99999"></div>';
  const t0 = Date.now();
  const result = await checkPage(withExtra(diagramPage(), cover, 'covered'));
  assert.equal(result.status, 'failed');
  assert.ok(!result.problems.some((p) => /crashed/.test(p)), result.problems.join('\n'));
  for (const label of ['1280px', '390px']) {
    const lines = result.problems.filter((p) => p.startsWith(`${label}: `) && /Present button/.test(p));
    assert.equal(lines.length, 1, result.problems.join('\n'));
    assert.match(lines[0], /^\d+px: the Present button of diagram 1 is covered by another element$/);
  }
  assert.ok(Date.now() - t0 < 9000, `took ${Date.now() - t0} ms`);
});

test('check: a crash in one probe keeps the rest of that viewport and its counts', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  // The counter is gone, so the deck probe throws; the diagram overlay on slide 3 is still presented.
  const built = buildSpec({ title: 'Deck', mode: 'slides', sections: [topic(1), { type: 'diagram', title: 'Path', diagram: flow('Path') }] });
  const result = await checkPage(withExtra(built, '<script>document.querySelector(".deck-count").remove();</script>', 'crash'));
  assert.equal(result.status, 'failed');
  for (const label of ['1280px', '390px']) {
    assert.ok(result.problems.some((p) => p.startsWith(`${label}: deck check crashed: `)), result.problems.join('\n'));
  }
  assert.equal(result.presented, 1, 'the overlay probe still ran');
  assert.equal(result.slides, 3, 'the slide count survives');
});

test('check: an unmounted diagram viewer is reported, and each dialog is paired with its own figure', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const hideFirst = '<script>document.querySelector("[data-dg-present]").hidden = true;</script>';
  const result = await checkPage(withExtra(diagramPage(2), hideFirst, 'unmounted'));
  assert.equal(result.status, 'failed');
  assert.ok(result.problems.includes('1280px: the diagram 1 viewer did not mount (its Present button is hidden)'), result.problems.join('\n'));
  assert.ok(result.problems.includes('390px: the diagram 1 viewer did not mount (its Present button is hidden)'));
  assert.equal(result.problems.length, 2, `diagram 2 presents fine: ${result.problems.join('\n')}`);
  assert.equal(result.presented, 1);
});

test('check: body { overflow-x: hidden } no longer hides a wide element', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const built = buildFile(exampleFile('concept'));
  const extra = '<style>body { overflow-x: hidden }</style><div id="forced" style="width:3000px;height:10px">wide</div>';
  const result = await checkPage(withExtra(built, extra, 'body-hidden'));
  assert.ok(result.problems.some((p) => /^390px: #forced is 3000px wide/.test(p)), result.problems.join('\n'));
  assert.ok(result.problems.some((p) => /^1280px: #forced is 3000px wide/.test(p)));
});

test('check: a dialog the page opens reads "an alert dialog", "a confirm dialog"', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const built = buildFile(exampleFile('concept'));
  const alerted = await checkPage(withExtra(built, '<script>alert("x")</script>', 'alerts'));
  assert.ok(alerted.problems.includes('1280px: the page opened an alert dialog'), alerted.problems.join('\n'));
  const confirmed = await checkPage(withExtra(built, '<script>confirm("x")</script>', 'confirms'));
  assert.ok(confirmed.problems.includes('1280px: the page opened a confirm dialog'), confirmed.problems.join('\n'));
});

// ---- 4. the slides example's video has a poster -------------------------------------------------------

test('the slides example gives its video a poster taken from the clip, and it builds into the page', async () => {
  const spec = JSON.parse(fs.readFileSync(exampleFile('slides'), 'utf8'));
  const video = spec.sections.find((s) => s.type === 'motion');
  assert.equal(video.poster, 'clip-poster.png');
  const file = path.join(SKILL, 'references/examples', video.poster);
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
  assert.ok(bytes.length < 60 * 1024, `a small poster, got ${bytes.length} bytes`);
  const checked = await validateSpec(spec, { dir: path.join(SKILL, 'references/examples') });
  assert.deepEqual(checked.errors, []);
  const { html } = await buildPage(spec, { dir: path.join(SKILL, 'references/examples'), out: path.join(tmp('b2-poster-'), 's.html') });
  assert.match(html, /<video controls[^>]* poster="data:image\/png;base64,/);
});

// ---- 5. motion child processes ----------------------------------------------------------------------------

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const gone = async (pid, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (!alive(pid)) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return !alive(pid);
};
const readPid = async (file) => {
  const end = Date.now() + 3000;
  while (Date.now() < end) {
    const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : '';
    if (/^\d+$/.test(text)) return Number(text);
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('the grandchild never wrote its pid');
};
const NO_GROUPS = process.platform === 'win32';
const killQuietly = (pid) => { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } };

// A child that starts a grandchild (which outlives it) and then waits.
const shell = (dir, body) => {
  const file = path.join(dir, 'child.sh');
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return file;
};

test('runChild: on timeout the whole process group goes, so a grandchild is not orphaned and cannot hold the call open', { skip: NO_GROUPS }, async () => {
  const dir = tmp('b2-group-');
  const pidFile = path.join(dir, 'pid');
  // The grandchild keeps the child's stdout and stderr open, as Chromium does.
  const file = shell(dir, `sleep 60 &\necho $! > ${pidFile}\nwait`);
  const t0 = Date.now();
  const run = runChild(file, [], { cwd: dir, env: process.env, timeoutMs: 1500, graceMs: 300 });
  const grandchild = await readPid(pidFile);
  const r = await run;
  try {
    assert.ok(Date.now() - t0 < 5000, `took ${Date.now() - t0} ms`);
    assert.equal(r.timedOut, true);
    assert.equal(await gone(grandchild), true, 'the grandchild is gone');
  } finally {
    killQuietly(grandchild);
  }
});

test('runChild: a child that ignores SIGTERM still loses its grandchild to the SIGKILL of the group', { skip: NO_GROUPS }, async () => {
  const dir = tmp('b2-group-kill-');
  const pidFile = path.join(dir, 'pid');
  const file = shell(dir, `trap '' TERM\nsleep 60 >/dev/null 2>&1 &\necho $! > ${pidFile}\nwhile true; do sleep 1; done`);
  const run = runChild(file, [], { cwd: dir, env: process.env, timeoutMs: 1500, graceMs: 300 });
  const grandchild = await readPid(pidFile);
  const r = await run;
  try {
    assert.equal(r.timedOut, true);
    assert.equal(r.signal, 'SIGKILL');
    assert.equal(await gone(grandchild), true, 'the grandchild is gone');
  } finally {
    killQuietly(grandchild);
  }
});

test('runChild: a parent stopped with SIGINT takes its detached children with it', { skip: NO_GROUPS }, async () => {
  const dir = tmp('b2-sigint-');
  const pidFile = path.join(dir, 'pid');
  const child = shell(dir, `sleep 60 >/dev/null 2>&1 &\necho $! > ${pidFile}\nwait`);
  const driver = path.join(dir, 'driver.mjs');
  const lib = new URL('../scripts/lib/motion-render.mjs', import.meta.url).href;
  fs.writeFileSync(driver, `import { runChild } from ${JSON.stringify(lib)};\nawait runChild(${JSON.stringify(child)}, [], { cwd: ${JSON.stringify(dir)}, env: process.env, timeoutMs: 60000 });\n`);
  const parent = spawn(process.execPath, [driver], { stdio: 'ignore' });
  const exited = new Promise((resolve) => parent.on('exit', (code, signal) => resolve({ code, signal })));
  const grandchild = await readPid(pidFile);
  parent.kill('SIGINT');
  const result = await exited;
  try {
    assert.equal(result.signal, 'SIGINT', 'the parent still dies of the signal');
    assert.equal(await gone(grandchild), true, 'the grandchild is gone too');
  } finally {
    killQuietly(grandchild);
  }
});

test('posterFrame: an ffmpeg that leaves a grandchild behind does not orphan it on timeout', { skip: NO_GROUPS }, async () => {
  const dir = tmp('b2-poster-group-');
  const pidFile = path.join(dir, 'pid');
  const file = shell(dir, `sleep 60 >/dev/null 2>&1 &\necho $! > ${pidFile}\nwait`);
  const saved = process.env.FFMPEG_PATH;
  process.env.FFMPEG_PATH = file;
  try {
    const run = posterFrame(path.join(dir, 'v.mp4'), dir, 1, { timeoutMs: 1500, graceMs: 300 });
    const grandchild = await readPid(pidFile);
    try {
      assert.equal(await run, undefined);
      assert.equal(await gone(grandchild), true, 'the grandchild is gone');
    } finally {
      killQuietly(grandchild);
    }
  } finally {
    if (saved === undefined) delete process.env.FFMPEG_PATH; else process.env.FFMPEG_PATH = saved;
  }
});

test('renderFailure has no special case for ENOBUFS: runChild never reports it', () => {
  assert.match(renderFailure({ error: Object.assign(new Error('stdout maxBuffer length exceeded'), { code: 'ENOBUFS' }) }), /^make-motion could not start: /);
});

test('make-motion exiting 0 without writing the video is a clear error keyed to the spec, not a raw ENOENT', async () => {
  const dir = tmp('b2-nofile-');
  const script = path.join(dir, 'render.mjs');
  fs.writeFileSync(script, 'process.exitCode = 0;\n');
  await assert.rejects(
    renderMotion(path.join(SKILL, 'test/fixtures/motion.json'), { scenes: [{ duration: 1 }] }, process.env, { script }),
    (e) => {
      assert.equal(e.name, 'SectionErrors');
      assert.equal(e.errors.length, 1);
      assert.equal(e.errors[0].path, 'spec');
      assert.match(e.errors[0].message, /^make-motion finished without writing the video; run its scripts\/render\.mjs by hand to see why$/);
      assert.ok(!/ENOENT/.test(e.errors[0].message));
      return true;
    },
  );
});

// ---- 6. decks: focus after the outline, motion test tolerance ---------------------------------------------------

test('outline opened while the page body has focus: closing it puts focus on the current slide', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, context } = await openPage(buildSpec(deckSpec(4)).url);
  await page.keyboard.press('ArrowRight');
  await page.evaluate(() => document.activeElement.blur());
  assert.equal(await page.evaluate(() => document.activeElement === document.body), true, 'body has focus');
  await page.keyboard.press('o');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.activeElement.id === 'slide-2'); // the dialog's close event hands focus over
  await context.close();
});

// ---- 7. diagram: Present keeps the inline slot's sideways scroll ----------------------------------------------------

const NAMES = ['Client', 'Gateway', 'Auth service', 'Orders service', 'Orders store', 'Audit log'];
const wide = () => ({
  title: 'Wide',
  type: 'flow',
  direction: 'right',
  nodes: NAMES.map((label, i) => ({ id: `n${i}`, label })),
  edges: NAMES.slice(1).map((_, i) => ({ from: `n${i}`, to: `n${i + 1}` })),
  steps: [{ title: 'One', show: ['n0'] }, { title: 'Two', show: ['n1'] }],
});

for (const mode of ['page', 'slides']) {
  test(`diagram: opening and closing Present keeps the slot's sideways scroll (${mode})`, async (t) => {
    if (await skipUnlessBrowser(t)) return;
    const built = buildSpec({ title: 'Doc', ...(mode === 'slides' ? { mode } : {}), sections: [{ type: 'diagram', title: 'Wide path', diagram: wide() }] });
    const { page, problems, context } = await openPage(built.url + (mode === 'slides' ? '#slide-2' : ''), { width: 390, height: 844 });
    const slot = page.locator('[data-dg-slot]');
    const room = await slot.evaluate((el) => el.scrollWidth - el.clientWidth);
    assert.ok(room > 120, `the slot scrolls sideways (${room} px of room)`);
    await slot.evaluate((el) => { el.scrollLeft = 120; });
    assert.equal(await slot.evaluate((el) => el.scrollLeft), 120);
    await page.locator('[data-dg-present]').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.querySelector('[data-dg-dialog]').open), true);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[data-dg-dialog]').open);
    assert.equal(await slot.evaluate((el) => el.scrollLeft), 120, 'back where it was');
    assert.deepEqual(problems, []);
    await context.close();
  });
}
