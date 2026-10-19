import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from '../scripts/lib/browser.mjs';
import { safeMargin } from '../scripts/check.mjs';

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

// A one-scene spec in a temp folder.
function specFile(elements, { size = [1920, 1080], duration = 2 } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'motion-check-'));
  const file = path.join(dir, 'motion.json');
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
  assert.deepEqual(lines(r.stdout), ['scenes[0]: scene "outro" ends with every element invisible (at 1.97s)', 'check: 1 problem']);
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
