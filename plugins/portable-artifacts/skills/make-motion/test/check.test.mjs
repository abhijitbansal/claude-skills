import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from '../scripts/lib/browser.mjs';
import * as checkModule from '../scripts/check.mjs';

const { safeMargin } = checkModule;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = path.join(root, 'scripts/check.mjs');
const FIXTURES = path.join(root, 'test/fixtures');
const EXAMPLES = path.join(root, 'references/examples');
const check = (args, env = {}) => spawnSync(process.execPath, [CHECK, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });

let browserPresent;
async function skipUnlessBrowser(t) {
  browserPresent ??= await launchBrowser({ quiet: true }).then((b) => b.close().then(() => true), () => false);
  if (!browserPresent) t.skip('no browser (bundled Chromium or system Chrome)');
  return !browserPresent;
}

// A one-scene spec in a temp folder; `files` maps extra file names to their contents.
function specFile(elements, { size = [1920, 1080], duration = 2, files = {} } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'motion-check-'));
  const file = path.join(dir, 'motion.json');
  for (const [name, body] of Object.entries(files)) writeFileSync(path.join(dir, name), body);
  writeFileSync(file, JSON.stringify({ size, fps: 30, scenes: [{ id: 's', duration, elements }] }));
  return file;
}

const lines = (stdout) => stdout.trim().split('\n');

for (const name of readdirSync(EXAMPLES).filter((f) => f.endsWith('.json'))) {
  test(`every spec in references/examples passes with exit 0: ${name}`, async (t) => {
    if (await skipUnlessBrowser(t)) return;
    const r = check([path.join(EXAMPLES, name)]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^check: ok \(\d+ scenes?, \d+ moments\)\n$/);
    assert.equal(r.stderr, '', 'a shipped example carries no warning, or the warning gets ignored');
  });
}

test('bad-safe-area: a title at y 10 on a 1080p canvas is outside the safe area once it has landed', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const r = check([path.join(FIXTURES, 'bad-safe-area.json')]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  // The dusk `rise` preset lands the title at 0.9 s; the first sheet time at or after that is 1.0 s.
  assert.deepEqual(lines(r.stdout), ['scenes[0].elements[0]: text "title" leaves the safe area (top) at 1.00s', 'check: 1 problem']);
});

test('bad-empty-end: a scene that fades every element out has nothing on screen at its last frame', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const r = check([path.join(FIXTURES, 'bad-empty-end.json')]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.deepEqual(lines(r.stdout), ['scenes[0]: scene "outro" ends with nothing on screen: every element is invisible or off the canvas (at 1.97s)', 'check: 1 problem']);
});

test('bad-overlap: two visible text boxes that overlap are reported once, naming both ids', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const r = check([path.join(FIXTURES, 'bad-overlap.json')]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.deepEqual(lines(r.stdout), ['scenes[0].elements[1]: text "second" overlaps text "first" at 0.10s', 'check: 1 problem']);
});

test('--json lists each finding with its path', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const r = check([path.join(FIXTURES, 'bad-overlap.json'), '--json']);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), {
    ok: false,
    errors: [{ path: 'scenes[0].elements[1]', message: 'text "second" overlaps text "first" at 0.10s' }],
  });
  const ok = check([path.join(EXAMPLES, 'launch-title.json'), '--json']);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  const body = JSON.parse(ok.stdout);
  assert.equal(body.ok, true);
  assert.equal(body.scenes, 2);
  assert.ok(body.moments > 2);
});

test('settled: text sliding in from off-canvas is not flagged while it moves', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  // Fully opaque and off the left edge at the 0.1 s first look, landed in the middle at 0.6 s.
  const file = specFile([{ id: 'slide', type: 'text', text: 'Hello', x: 960, y: 540, fontSize: 64,
    keyframes: [{ t: 0, x: -400 }, { t: 0.6, x: 960, ease: 'outCubic' }] }]);
  const r = check([file]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('settled: text whose last keyframe lands outside the safe area is flagged at its landing', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const file = specFile([{ id: 'drift', type: 'text', text: 'Hello', x: 960, y: 540, fontSize: 64,
    keyframes: [{ t: 0, x: 960 }, { t: 0.6, x: 1880, ease: 'outCubic' }] }]);
  const r = check([file]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.deepEqual(lines(r.stdout), ['scenes[0].elements[0]: text "drift" leaves the safe area (right) at 0.70s', 'check: 1 problem']);
});

test('safeMargin: 60 px at 1080 on the short side, on every side', () => {
  assert.equal(safeMargin([1920, 1080]), 60);
  assert.equal(safeMargin([1080, 1350]), 60);
  assert.equal(safeMargin([1080, 1080]), 60);
  assert.equal(safeMargin([1080, 1920]), 60);
  assert.equal(safeMargin([3840, 2160]), 120);
});

test('the safe area scales with the short side in the real page: 60 px at 1920x1080, 120 px at 3840x2160', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  // A 40 px line is 46 px tall (line-height 1.15), so y 103 puts its top 80 px from the frame edge.
  const el = (x) => [{ id: 'note', type: 'text', text: 'Hi', x, y: 103, fontSize: 40 }];
  const hd = check([specFile(el(960))]);
  assert.equal(hd.status, 0, hd.stdout + hd.stderr);
  const uhd = check([specFile(el(1920), { size: [3840, 2160] })]);
  assert.equal(uhd.status, 1, uhd.stdout + uhd.stderr);
  assert.deepEqual(lines(uhd.stdout), ['scenes[0].elements[0]: text "note" leaves the safe area (top) at 0.10s', 'check: 1 problem']);
});

test('an invisible text is never flagged for the safe area or overlaps', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const file = specFile([
    { id: 'shown', type: 'text', text: 'Shown', x: 960, y: 540, fontSize: 64 },
    { id: 'hidden', type: 'text', text: 'Hidden', x: 960, y: 10, fontSize: 64, opacity: 0 },
    { id: 'ghost', type: 'text', text: 'Ghost', x: 960, y: 540, fontSize: 64, opacity: 0.04 },
  ]);
  const r = check([file]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('without a browser the check skips cleanly with exit 0 and names the doctor', () => {
  const r = check([path.join(EXAMPLES, 'q3-revenue.json')], { PA_NO_BROWSER: '1' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^check: skipped \(no browser: PA_NO_BROWSER=1; ask the user, then run: node \S*doctor\.mjs\S* --for check --fix chromium\)\n$/);
  const json = check([path.join(EXAMPLES, 'q3-revenue.json'), '--json'], { PA_NO_BROWSER: '1' });
  assert.equal(json.status, 0);
  assert.equal(JSON.parse(json.stdout).skipped, true);
});

test('usage errors exit 2: no spec, two specs, an unknown flag, a missing file', () => {
  for (const args of [[], ['a.json', 'b.json'], ['--frobnicate', 'a.json'], [path.join(FIXTURES, 'no-such.json')]]) {
    const r = check(args, { PA_NO_BROWSER: '1' });
    assert.equal(r.status, 2, `${JSON.stringify(args)}: ${r.stdout}${r.stderr}`);
  }
});

test('an invalid spec exits 1 with the validation errors, before any browser starts', () => {
  const file = specFile([{ id: 'x', type: 'text', x: 0, y: 0 }]);
  const r = check([file], { PA_NO_BROWSER: '1' });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /scenes\[0\]\.elements\[0\]/);
});

// ---- review round 1 ------------------------------------------------------------------------------

test('ok-crossfade: a text swap in one spot (one fades out as the other fades in) is not an overlap', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const r = check([path.join(FIXTURES, 'ok-crossfade.json')]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('ok-slide-out: an opaque exit that leaves the canvas entirely is gone, not clipped', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const r = check([path.join(FIXTURES, 'ok-slide-out.json')]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('a box only partly off the canvas still leaves the safe area', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  // "Hello" at x 1900 straddles the right edge.
  const r = check([specFile([{ id: 'edge', type: 'text', text: 'Hello', x: 1900, y: 540, fontSize: 64 }])]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.deepEqual(lines(r.stdout), ['scenes[0].elements[0]: text "edge" leaves the safe area (right) at 0.10s', 'check: 1 problem']);
});

test('counters are checked like text: the safe area and overlaps', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const high = check([specFile([{ id: 'big', type: 'counter', to: 42, x: 960, y: 5, fontSize: 96 }])]);
  assert.equal(high.status, 1, high.stdout + high.stderr);
  assert.deepEqual(lines(high.stdout), ['scenes[0].elements[0]: counter "big" leaves the safe area (top) at 0.10s', 'check: 1 problem']);
  const onTop = check([specFile([
    { id: 'label', type: 'text', text: 'Revenue', x: 960, y: 540, fontSize: 64 },
    { id: 'num', type: 'counter', to: 42, x: 960, y: 550, fontSize: 64 },
  ])]);
  assert.equal(onTop.status, 1, onTop.stdout + onTop.stderr);
  assert.deepEqual(lines(onTop.stdout), ['scenes[0].elements[1]: counter "num" overlaps text "label" at 0.10s', 'check: 1 problem']);
});

test('a crash prints "check crashed: ..." alone (no tally) and JSON says crashed', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  // A .png that is not an image passes validation (the file exists) but the page cannot decode it.
  const file = specFile([{ id: 'pic', type: 'image', src: 'broken.png', x: 960, y: 540, width: 200, height: 200 }], { files: { 'broken.png': 'not a png' } });
  const r = check([file]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.deepEqual(lines(r.stdout), ['check crashed: image failed to load: broken.png']);
  const json = check([file, '--json']);
  assert.equal(json.status, 1);
  assert.deepEqual(JSON.parse(json.stdout), { ok: false, crashed: true, errors: [{ path: '', message: 'check crashed: image failed to load: broken.png' }] });
});

test('waitReady: a page that never becomes ready fails fast with a clear message', async () => {
  const stuck = { waitForFunction: async () => {}, evaluate: () => new Promise(() => {}) };
  const started = Date.now();
  await assert.rejects(checkModule.waitReady(stuck, 50), /the page did not become ready within 0\.05 s/);
  assert.ok(Date.now() - started < 2000);
});

test('--theme draws a spec that names no theme in that theme (poster slams the title in by 0.5 s)', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const r = check([path.join(FIXTURES, 'bad-safe-area.json'), '--theme', 'poster']);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.deepEqual(lines(r.stdout), ['scenes[0].elements[0]: text "title" leaves the safe area (top) at 0.60s', 'check: 1 problem']);
});

test('--theme reaches the page: the same title is 950 px wide in dusk, 762 px in poster (measured)', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  // Right edge at x + width / 2: dusk 1905 (past the 1860 safe line), poster 1811 (inside).
  const file = specFile([{ id: 'title', type: 'text', role: 'title', text: 'Quarterly results', x: 1430, y: 540, fontSize: 120 }]);
  const dusk = check([file]);
  assert.equal(dusk.status, 1, dusk.stdout + dusk.stderr);
  assert.match(dusk.stdout, /text "title" leaves the safe area \(right\)/);
  const poster = check([file, '--theme', 'poster']);
  assert.equal(poster.status, 0, poster.stdout + poster.stderr);
});

test('--theme: an unknown name or a missing value exits 2', () => {
  for (const args of [['--theme', 'nope'], ['--theme']]) {
    const r = check([path.join(FIXTURES, 'bad-safe-area.json'), ...args], { PA_NO_BROWSER: '1' });
    assert.equal(r.status, 2, `${JSON.stringify(args)}: ${r.stdout}${r.stderr}`);
  }
});

// ---- review round 2: judge holds, not "after the last keyframe" ---------------------------------

test('bad-overlap-then-exit: an overlap held on screen is caught even though one text fades out at the end', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const r = check([path.join(FIXTURES, 'bad-overlap-then-exit.json')]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.deepEqual(lines(r.stdout), ['scenes[0].elements[1]: text "second" overlaps text "first" at 0.10s', 'check: 1 problem']);
});

test('bad-safe-area-then-exit: a title held at the top edge is caught even though it later slides off the canvas', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const r = check([path.join(FIXTURES, 'bad-safe-area-then-exit.json')]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.deepEqual(lines(r.stdout), ['scenes[0].elements[0]: text "title" leaves the safe area (top) at 0.10s', 'check: 1 problem']);
});

test('a scene whose only element has slid wholly off the canvas (still opaque) ends empty', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const file = specFile([{ id: 'gone', type: 'text', text: 'Bye', x: 960, y: 540, fontSize: 64,
    keyframes: [{ t: 1, x: 960 }, { t: 1.5, x: 2600, ease: 'inCubic' }] }]);
  const r = check([file]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.deepEqual(lines(r.stdout), ['scenes[0]: scene "s" ends with nothing on screen: every element is invisible or off the canvas (at 1.97s)', 'check: 1 problem']);
});

// ---- opt-in exits (Task 10) ----------------------------------------------------------------------

test('a title with exit: true in a middle scene passes: its exit is motion, not a clip or an overlap', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const dir = mkdtempSync(path.join(tmpdir(), 'motion-check-'));
  const file = path.join(dir, 'motion.json');
  const title = (id, text) => ({ id, type: 'text', role: 'title', text, x: 960, y: 420, fontSize: 120, exit: true });
  const sub = (id) => ({ id, type: 'text', text: 'Q3 2026', x: 960, y: 640, fontSize: 48 });
  writeFileSync(file, JSON.stringify({ size: [1920, 1080], fps: 30, scenes: [
    { id: 'a', duration: 3, elements: [title('t1', 'Revenue'), sub('s1')] },
    { id: 'b', duration: 4, elements: [title('t2', 'Costs'), sub('s2')] },
    { id: 'c', duration: 3, elements: [title('t3', 'Margin'), sub('s3')] },
  ] }));
  const r = check([file]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

// Three scenes; the middle one holds `elements` and lasts `duration` s.
function middleScene(elements, duration) {
  const dir = mkdtempSync(path.join(tmpdir(), 'motion-check-'));
  const file = path.join(dir, 'motion.json');
  const filler = (id) => ({ id, type: 'text', text: id, x: 960, y: 540, fontSize: 64 });
  writeFileSync(file, JSON.stringify({ size: [1920, 1080], fps: 30, scenes: [
    { id: 'a', duration: 2, elements: [filler('fa')] },
    { id: 'b', duration, elements },
    { id: 'c', duration: 2, elements: [filler('fc')] },
  ] }));
  return file;
}

test('a lone exit: true title in a middle scene passes: its applied exit is the author leaving on purpose', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const r = check([middleScene([{ id: 'card', type: 'text', role: 'title', text: 'Chapter two', x: 960, y: 540, fontSize: 120, exit: true }], 4)]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('a lone title is judged normally when no exit preset was applied: dropped on a short scene, or author keyframes', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  // 0.5 s is too short for the exit (the entrance is still running at 90 %); base opacity 0 keeps it invisible.
  const dropped = check([middleScene([{ id: 'card', type: 'text', role: 'title', text: 'Gone', x: 960, y: 540, fontSize: 120, exit: true, opacity: 0 }], 0.5)]);
  assert.equal(dropped.status, 1, dropped.stdout + dropped.stderr);
  assert.match(dropped.stdout, /^scenes\[1\]: scene "b" ends with nothing on screen/m);
  const own = check([middleScene([{ id: 'card', type: 'text', role: 'title', text: 'Fades', x: 960, y: 540, fontSize: 120, exit: true,
    keyframes: [{ t: 3, opacity: 1 }, { t: 3.8, opacity: 0 }] }], 4)]);
  assert.equal(own.status, 1, own.stdout + own.stderr);
  assert.match(own.stdout, /^scenes\[1\]: scene "b" ends with nothing on screen/m);
});

// ---- frame-0 warning and crossfades (P2) ---------------------------------------------------------

// A spec in a temp folder from whole scenes.
function scenesFile(scenes) {
  const dir = mkdtempSync(path.join(tmpdir(), 'motion-check-'));
  const file = path.join(dir, 'motion.json');
  writeFileSync(file, JSON.stringify({ size: [1920, 1080], fps: 30, scenes }));
  return file;
}
const word = (id, extra = {}) => ({ id, type: 'text', text: id, x: 960, y: 540, fontSize: 64, ...extra });

test('a first scene that fades in warns that frame 0 is blank, and still exits 0 with the same verdict line', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const r = check([scenesFile([{ id: 'intro', duration: 2, transition: 'fade', elements: [word('hello')] }])]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^check: ok \(1 scene, \d+ moments\)\n$/);
  assert.match(r.stderr, /^warning: scenes\[0\]: scene "intro" shows nothing at 0\.00s: the first frame, the video's thumbnail, is blank; /);
});

test('--json carries the frame-0 warning under warnings and leaves the key out when there is none', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const blank = JSON.parse(check([scenesFile([{ id: 'intro', duration: 2, transition: 'fade', elements: [word('hello')] }]), '--json']).stdout);
  assert.equal(blank.ok, true);
  assert.equal(blank.warnings.length, 1);
  assert.equal(blank.warnings[0].path, 'scenes[0]');
  assert.match(blank.warnings[0].message, /^scene "intro" shows nothing at 0\.00s/);
  const shown = JSON.parse(check([scenesFile([{ id: 'intro', duration: 2, elements: [word('hello')] }]), '--json']).stdout);
  assert.equal('warnings' in shown, false);
});

test('a first scene with a title already on screen at t = 0 does not warn', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const r = check([scenesFile([{ id: 'intro', duration: 2, elements: [word('hello')] }])]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.stderr, '');
});

test('a first scene whose only element enters later (opacity 0 at t = 0) warns, and is still not a failure', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const r = check([scenesFile([{ id: 'intro', duration: 2, elements: [word('late', { keyframes: [{ t: 0, opacity: 0 }, { t: 0.5, opacity: 1 }] })] }])]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stderr, /^warning: scenes\[0\]: scene "intro" shows nothing at 0\.00s/);
});

test('a crossfade pair is green: the old scene under the new one is not an overlap, and nothing else is reported', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const r = check([scenesFile([
    { id: 'a', duration: 2, elements: [word('first')] },
    { id: 'b', duration: 2, transition: 'crossfade', elements: [word('second')] },
  ])]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^check: ok \(2 scenes, \d+ moments\)\n$/);
  assert.equal(r.stderr, '');
});

test('a crossfade does not hide a real problem in the incoming scene: an overlap inside it is still reported', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const r = check([scenesFile([
    { id: 'a', duration: 2, elements: [word('first')] },
    { id: 'b', duration: 2, transition: 'crossfade', elements: [word('one'), word('two')] },
  ])]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^scenes\[1\]\.elements\[1\]: text "two" overlaps text "one"/m);
});
