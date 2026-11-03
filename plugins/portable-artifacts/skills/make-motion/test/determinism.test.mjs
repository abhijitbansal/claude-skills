import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { requireRender, renderHash, assertRendersIdentically, makeTestVideo, BROWSER_ONLY } from './helpers/render.mjs';
import { launchBrowser } from '../scripts/lib/browser.mjs';
import { startServer } from '../scripts/lib/server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLE = path.join(root, 'references/examples/q3-revenue.json');
// Two images, one sliding in from off canvas, and a title that scales in: the moving parts a capture race shows on.
const SWIPE = path.join(root, 'references/examples/blocks/before-after-swipe.json');
const REPEATS = 3;
const NEED_ALL = { need: ['browser', 'ffmpeg', 'ffprobe'] };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayStamp = (d) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;

const commentTag = (ffprobe, file) => JSON.parse(spawnSync(ffprobe,
  ['-v', 'error', '-show_entries', 'format_tags=comment', '-of', 'json', file], { encoding: 'utf8' }).stdout).format.tags.comment;

test('q3-revenue renders byte-identical twice at 320x180 / 10 fps', async (t) => {
  if (!await requireRender(t)) return;
  await assertRendersIdentically(t, EXAMPLE, ['--fps', '10', '--size', '320x180']);
});

// The SHA-256 of the contact sheet render.mjs writes for SWIPE's one scene.
function swipeSheetHash() {
  const out = mkdtempSync(path.join(tmpdir(), 'det-sheet-'));
  try {
    const r = spawnSync(process.execPath, [path.join(root, 'scripts/render.mjs'), SWIPE, '--contact-sheet', '--out', out], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    return createHash('sha256').update(readFileSync(path.join(out, 'contact', 'before-after-swipe.png'))).digest('hex');
  } finally { rmSync(out, { recursive: true, force: true }); }
}

// The computed will-change of the page's one element, opened through `startServer` (`mode` undefined: its default).
// `dropMeta` serves the page without its motion-mode marker.
async function elementWillChange(browser, mode, { dropMeta = false } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'det-layers-'));
  const specPath = path.join(dir, 'm.json');
  writeFileSync(specPath, JSON.stringify({ size: [160, 90], scenes: [{ id: 's', duration: 1, elements: [
    { id: 'a', type: 'text', text: 'Hi', x: 80, y: 45, fontSize: 20 }] }] }));
  const srv = await startServer({ specPath, ...(mode === undefined ? {} : { mode }) });
  const page = await browser.newPage({ viewport: { width: 160, height: 90 } });
  try {
    if (dropMeta) {
      await page.route(srv.url, async (route) => {
        const res = await route.fetch();
        await route.fulfill({ response: res, body: (await res.text()).replace(/<meta name="motion-mode"[^>]*>/, '') });
      });
    }
    await page.goto(srv.url);
    await page.evaluate(() => window.__motion.ready);
    return await page.evaluate(() => getComputedStyle(document.querySelector('.el')).willChange);
  } finally {
    await page.close();
    await srv.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test('compositor layers (will-change) only when the page is explicitly in preview mode; render, unknown, default and missing modes get none', async (t) => {
  if (!await requireRender(t, BROWSER_ONLY)) return;
  const browser = await launchBrowser({ quiet: true });
  try {
    assert.equal(await elementWillChange(browser, 'preview'), 'transform, opacity', 'preview keeps its layers (the check can fire)');
    for (const [label, mode, opts] of [['render', 'render'], ['unknown mode', 'bogus'], ['startServer default', undefined],
      ['no motion-mode marker', 'preview', { dropMeta: true }]]) {
      assert.equal(await elementWillChange(browser, mode, opts), 'auto', `${label}: no per-element layers`);
    }
  } finally { await browser.close(); }
});

test(`a contact sheet with a sliding image and a scaling title is byte-identical over ${REPEATS} renders`, async (t) => {
  if (!await requireRender(t, BROWSER_ONLY)) return;
  const hashes = Array.from({ length: REPEATS }, swipeSheetHash);
  assert.deepEqual(hashes, Array(REPEATS).fill(hashes[0]), 'every contact sheet of the same spec must be byte-identical');
});

test(`an MP4 of the same spec at full size and 5 fps (0.2 s jumps between seeks) is byte-identical over ${REPEATS} renders`, async (t) => {
  if (!await requireRender(t)) return;
  const hashes = [];
  for (let i = 0; i < REPEATS; i++) hashes.push((await renderHash(SWIPE, ['--fps', '5'])).sha256);
  assert.deepEqual(hashes, Array(REPEATS).fill(hashes[0]), 'every render of the same spec must be byte-identical');
});

test('without SOURCE_DATE_EPOCH the comment tag carries today, with it 30 Oct 2026', async (t) => {
  const tools = await requireRender(t, NEED_ALL);
  if (!tools) return;
  const dir = mkdtempSync(path.join(tmpdir(), 'det-'));
  const spec = path.join(dir, 'm.json');
  writeFileSync(spec, JSON.stringify({ size: [160, 90], scenes: [{ id: 's', duration: 1, elements: [] }] }));
  const args = ['--fps', '10', '--size', '160x90'];
  const before = dayStamp(new Date());
  const dated = await renderHash(spec, args, { env: { SOURCE_DATE_EPOCH: '' } });
  const pinned = await renderHash(spec, args);
  const after = dayStamp(new Date());
  const today = commentTag(tools.ffprobe, dated.out);
  assert.ok(today.endsWith(before) || today.endsWith(after), `dated comment "${today}" should end in ${before} or ${after}`);
  assert.ok(commentTag(tools.ffprobe, pinned.out).endsWith('30 Oct 2026'), 'pinned comment should end in 30 Oct 2026');
});

test('makeTestVideo writes a video, with an audio stream only when asked', async (t) => {
  const tools = await requireRender(t, { need: ['ffmpeg', 'ffprobe'] });
  if (!tools) return;
  const dir = mkdtempSync(path.join(tmpdir(), 'mtv-'));
  const streams = (file) => JSON.parse(spawnSync(tools.ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,nb_frames',
    '-of', 'json', file], { encoding: 'utf8' }).stdout).streams;
  const silent = path.join(dir, 'a.mp4');
  makeTestVideo(tools.ffmpeg, silent);
  assert.deepEqual(streams(silent).map((s) => s.codec_type), ['video']);
  assert.equal(streams(silent)[0].width, 320);
  assert.equal(Number(streams(silent)[0].nb_frames), 20, '2 s at 10 fps');
  const withAudio = path.join(dir, 'b.mp4');
  makeTestVideo(tools.ffmpeg, withAudio, { seconds: 1, source: 'smptebars', audio: true });
  assert.deepEqual(streams(withAudio).map((s) => s.codec_type).sort(), ['audio', 'video']);
});
