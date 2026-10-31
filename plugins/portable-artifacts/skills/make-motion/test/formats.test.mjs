// Task 6: format presets (16:9, 9:16, 1:1, 4:5), the safe-area rect and the caption zone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { FORMATS, SAFE_MARGIN_PX, SAFE_REFERENCE_SIDE, DEFAULT_CAPTION_TOP, safeMargin, safeInsets, captionZone } from '../template/formats.mjs';
import { validateSpec, withDefaults, loadSpec } from '../scripts/lib/spec.mjs';
import * as checkModule from '../scripts/check.mjs';
import { startServer } from '../scripts/lib/server.mjs';
import { requireRender, BROWSER_ONLY, assertRendersIdentically, renderHash } from './helpers/render.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = path.join(root, 'scripts/check.mjs');
const FIXTURES = path.join(root, 'test/fixtures');
const VERTICAL = path.join(root, 'references/examples/vertical-hook.json');
const check = (args) => spawnSync(process.execPath, [CHECK, ...args], { encoding: 'utf8', env: process.env });
const lines = (stdout) => stdout.trim().split('\n');

const scene = { id: 's', duration: 2, elements: [{ id: 't', type: 'text', text: 'hi', x: 540, y: 960 }] };
const spec = (extra = {}) => ({ scenes: [scene], ...extra });
const errs = (motion) => validateSpec(motion).errors.map((e) => `${e.path}: ${e.message}`);

function get(url, rawPath) {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    http.get({ host: u.hostname, port: u.port, path: rawPath }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

// ---- the table ----------------------------------------------------------------------------------

test('FORMATS holds the four presets with their sizes and caption tops', () => {
  assert.deepEqual(FORMATS, {
    '16:9': { size: [1920, 1080], captionTop: 0.78 },
    '9:16': { size: [1080, 1920], captionTop: 0.72 },
    '1:1': { size: [1080, 1080], captionTop: 0.78 },
    '4:5': { size: [1080, 1350], captionTop: 0.72 },
  });
  assert.deepEqual([SAFE_MARGIN_PX, SAFE_REFERENCE_SIDE, DEFAULT_CAPTION_TOP], [60, 1080, 0.78]);
});

// ---- spec: format sets the size ------------------------------------------------------------------

test('withDefaults turns a format into its size, keeps the format, and does not touch the input', () => {
  for (const [name, { size }] of Object.entries(FORMATS)) {
    const input = spec({ format: name });
    const out = withDefaults(input);
    assert.deepEqual(out.size, size, name);
    assert.equal(out.format, name, 'the format stays on the spec for the caption zone');
    assert.ok(!('size' in input), 'input not mutated');
  }
  assert.deepEqual(withDefaults(spec()).size, [1920, 1080], 'no format, no size: 16:9 as before');
  assert.equal(withDefaults(spec()).format, undefined);
  assert.deepEqual(withDefaults(spec({ size: [640, 360] })).size, [640, 360], 'a size alone is kept');
});

test('format is one of the four; a size that matches it is fine; a size that differs is an error with the fix', () => {
  assert.deepEqual(errs(spec({ format: '9:16' })), []);
  assert.deepEqual(errs(spec({ format: '9:16', size: [1080, 1920] })), []);
  assert.deepEqual(errs(spec({ format: '9:16', size: [1920, 1080] })), ['size: [1920,1080] does not match format "9:16" (1080x1920); drop one of them']);
  assert.deepEqual(errs(spec({ format: '4:5', size: [1080, 1080] })), ['size: [1080,1080] does not match format "4:5" (1080x1350); drop one of them']);
  const bad = errs(spec({ format: '9:17' }));
  assert.equal(bad.length, 1, bad.join('\n'));
  assert.match(bad[0], /^format: /);
  for (const name of Object.keys(FORMATS)) assert.ok(bad[0].includes(name), `the error lists ${name}: ${bad[0]}`);
});

// ---- the zones ----------------------------------------------------------------------------------

test('safeMargin is 60 px at 1080 on the short side; safeInsets gives it on all four sides', () => {
  assert.equal(safeMargin([1920, 1080]), 60);
  assert.equal(safeMargin([1080, 1920]), 60);
  assert.equal(safeMargin([3840, 2160]), 120);
  assert.deepEqual(safeInsets([1920, 1080]), { top: 60, right: 60, bottom: 60, left: 60 });
  assert.deepEqual(safeInsets([3840, 2160]), { top: 120, right: 120, bottom: 120, left: 120 });
  assert.equal(checkModule.safeMargin, safeMargin, 'check.mjs still exports the one function');
});

test('captionZone sits in the lower part of the safe area: top at 78 % (72 % for 9:16 and 4:5)', () => {
  assert.deepEqual(captionZone([1920, 1080]), { left: 60, top: 842, right: 1860, bottom: 1020 });
  assert.deepEqual(captionZone([1920, 1080], '16:9'), { left: 60, top: 842, right: 1860, bottom: 1020 });
  assert.deepEqual(captionZone([1080, 1920], '9:16'), { left: 60, top: 1382, right: 1020, bottom: 1860 });
  assert.deepEqual(captionZone([1080, 1080], '1:1'), { left: 60, top: 842, right: 1020, bottom: 1020 });
  assert.deepEqual(captionZone([1080, 1350], '4:5'), { left: 60, top: 972, right: 1020, bottom: 1290 });
  assert.deepEqual(captionZone([1080, 1920]), { left: 60, top: 1498, right: 1020, bottom: 1860 }, 'a size with no format uses 78 %');
});

test('a zone or insets argument is refused until viral mode defines it, never ignored', () => {
  assert.throws(() => safeInsets([1080, 1920], { top: 290 }), /safeInsets: a zone/);
  assert.throws(() => captionZone([1080, 1920], '9:16', { left: 120 }), /captionZone: insets/);
});

// ---- server: the art follows the format ---------------------------------------------------------

test('/art/<scene>.svg is drawn at the format size when the spec sets a format and no size', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'motion-format-'));
  const specPath = path.join(dir, 'm.json');
  writeFileSync(specPath, JSON.stringify({ format: '9:16', scenes: [{ id: 'open', duration: 1, background: 'art', elements: [] }] }));
  const srv = await startServer({ specPath, mode: 'preview' });
  try {
    const art = await get(srv.url, '/art/open.svg');
    assert.equal(art.status, 200);
    assert.match(art.body, /viewBox="0 0 1080 1920" width="1080" height="1920"/);
  } finally { await srv.close(); }
});

// ---- check.mjs ---------------------------------------------------------------------------------

test('check.mjs prints the same safe-area line for bad-safe-area.json as before the rect', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const r = check([path.join(FIXTURES, 'bad-safe-area.json')]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.deepEqual(lines(r.stdout), ['scenes[0].elements[0]: text "title" leaves the safe area (top) at 1.00s', 'check: 1 problem']);
});

test('check.mjs judges a format spec on the preset canvas: a title 10 px from the top of a 9:16 frame leaves the safe area', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const dir = mkdtempSync(path.join(tmpdir(), 'motion-format-'));
  const file = path.join(dir, 'motion.json');
  writeFileSync(file, JSON.stringify(spec({ format: '9:16', scenes: [{ id: 's', duration: 2, elements: [
    { id: 'high', type: 'text', text: 'Too high', x: 540, y: 10, fontSize: 64 },
    { id: 'right', type: 'text', text: 'Too far right to fit', x: 1050, y: 960, fontSize: 64 },
  ] }] })));
  const r = check([file]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.deepEqual(lines(r.stdout), [
    'scenes[0].elements[0]: text "high" leaves the safe area (top) at 0.10s',
    'scenes[0].elements[1]: text "right" leaves the safe area (right) at 0.10s',
    'check: 2 problems',
  ]);
});

// ---- the example --------------------------------------------------------------------------------

test('vertical-hook.json sets format 9:16 (and the size it stands for, so the example loops that read size.0 keep working)', () => {
  const { spec: motion, dir } = loadSpec(VERTICAL);
  assert.equal(motion.format, '9:16');
  assert.deepEqual(motion.size, FORMATS['9:16'].size);
  assert.deepEqual(validateSpec(motion, { dir }).errors, []);
});

test('vertical-hook.json renders 1080x1920 twice to the same bytes, and a copy with the format alone renders the same bytes', async (t) => {
  if (!(await requireRender(t))) return;
  const first = await renderHash(VERTICAL, ['--fps', '10']);
  assert.match(first.stdout, /frames @ 10 fps, 1080x1920\n/);
  assert.equal(await assertRendersIdentically(t, VERTICAL, ['--fps', '10']), first.sha256);
  const { spec: motion } = loadSpec(VERTICAL);
  delete motion.size;
  const alone = path.join(mkdtempSync(path.join(tmpdir(), 'motion-format-')), 'motion.json');
  writeFileSync(alone, JSON.stringify(motion));
  const bare = await renderHash(alone, ['--fps', '10']);
  assert.match(bare.stdout, /1080x1920\n/);
  assert.equal(bare.sha256, first.sha256, 'format alone gives the same video as format plus its own size');
});
