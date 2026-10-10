import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { launchBrowser } from '../scripts/lib/browser.mjs';
import { startServer } from '../scripts/lib/server.mjs';
import { writeWav } from './helpers/wav.mjs';
import { gainAt } from '../template/preview-audio.mjs';

const WAV_SECONDS = 3;
const SCENE_SECONDS = 4;
const PLAY_TIMEOUT_MS = 3000;

async function haveBrowser() {
  try { await (await launchBrowser({ quiet: true })).close(); return true; } catch { return false; }
}

function fixture(track = { src: 'voice.wav', scene: 's', at: 0, duration: WAV_SECONDS }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'pa-'));
  writeWav(path.join(dir, 'voice.wav'), { seconds: WAV_SECONDS });
  const spec = {
    scenes: [{ id: 's', duration: SCENE_SECONDS, elements: [{ id: 't', type: 'text', text: 'hi', x: 960, y: 540 }] }],
    audio: [track],
  };
  writeFileSync(path.join(dir, 'm.json'), JSON.stringify(spec));
  return path.join(dir, 'm.json');
}

async function withPage(mode, fn, track) {
  const srv = await startServer({ specPath: fixture(track), mode });
  const browser = await launchBrowser({ quiet: true });
  try {
    const page = await browser.newPage();
    await page.goto(srv.url);
    await page.evaluate(() => window.__motion.ready);
    await fn(page);
  } finally { await browser.close(); await srv.close(); }
}

const audioState = (page) => page.evaluate(() => ({
  count: document.querySelectorAll('audio').length,
  srcs: [...document.querySelectorAll('audio')].map((a) => a.src),
  paused: [...document.querySelectorAll('audio')].map((a) => a.paused),
  inStage: document.querySelectorAll('#stage audio').length,
  exposed: (window.__motion.audio ?? []).length,
}));

test('gainAt ramps linearly over fadeIn after start and fadeOut before end', () => {
  const track = { start: 2, end: 10, volume: 0.8, fadeIn: 2, fadeOut: 4 };
  assert.equal(gainAt(track, 2), 0);
  assert.ok(Math.abs(gainAt(track, 3) - 0.4) < 1e-9);
  assert.ok(Math.abs(gainAt(track, 4) - 0.8) < 1e-9);
  assert.ok(Math.abs(gainAt(track, 6) - 0.8) < 1e-9); // fadeOut window opens at end - fadeOut = 6
  assert.ok(Math.abs(gainAt(track, 8) - 0.4) < 1e-9);
  assert.equal(gainAt(track, 10), 0);
  assert.equal(gainAt({ start: 0, end: 5, volume: 1, fadeIn: 0, fadeOut: 0 }, 0), 1);
  assert.equal(gainAt({ start: 0, end: 5, volume: 2, fadeIn: 0, fadeOut: 0 }, 1), 1); // el.volume is capped at 1
});

test('preview mounts one idle <audio> per track, outside the stage', async (t) => {
  if (!(await haveBrowser())) return t.skip('browser unavailable');
  await withPage('preview', async (page) => {
    const s = await audioState(page);
    assert.equal(s.count, 1);
    assert.ok(s.srcs[0].endsWith('/assets/voice.wav'), s.srcs[0]);
    assert.deepEqual(s.paused, [true]);
    assert.equal(s.inStage, 0);
    assert.equal(s.exposed, 1);
    const track = await page.evaluate(() => {
      const { start, end, volume, fadeIn, fadeOut } = window.__motion.audio[0];
      return { start, end, volume, fadeIn, fadeOut };
    });
    assert.deepEqual(track, { start: 0, end: WAV_SECONDS, volume: 1, fadeIn: 0, fadeOut: 0 });
  });
  return undefined;
});

test('render mode creates no <audio> element', async (t) => {
  if (!(await haveBrowser())) return t.skip('browser unavailable');
  await withPage('render', async (page) => {
    assert.equal((await audioState(page)).count, 0);
  });
  return undefined;
});

test('Play starts the track, Space pauses it, scrubbing pauses it', async (t) => {
  if (!(await haveBrowser())) return t.skip('browser unavailable');
  await withPage('preview', async (page) => {
    await page.click('#play');
    await page.waitForFunction(() => window.__motion.audio[0].el.paused === false, null, { timeout: PLAY_TIMEOUT_MS });
    await page.keyboard.press('Space');
    assert.equal(await page.evaluate(() => window.__motion.audio[0].el.paused), true);
    await page.click('#play');
    await page.waitForFunction(() => window.__motion.audio[0].el.paused === false, null, { timeout: PLAY_TIMEOUT_MS });
    await page.evaluate(() => {
      const scrub = document.getElementById('scrub');
      scrub.value = '1';
      scrub.dispatchEvent(new Event('input'));
    });
    assert.equal(await page.evaluate(() => window.__motion.audio[0].el.paused), true);
  });
  return undefined;
});

test('M toggles mute and the mute button reflects it', async (t) => {
  if (!(await haveBrowser())) return t.skip('browser unavailable');
  await withPage('preview', async (page) => {
    await page.click('#play');
    await page.waitForFunction(() => window.__motion.audio[0].el.paused === false, null, { timeout: PLAY_TIMEOUT_MS });
    await page.keyboard.press('m');
    assert.equal(await page.evaluate(() => window.__motion.audio[0].el.muted), true);
    assert.equal(await page.getAttribute('#mute', 'aria-pressed'), 'true');
    await page.click('#mute');
    assert.equal(await page.evaluate(() => window.__motion.audio[0].el.muted), false);
    assert.equal(await page.getAttribute('#mute', 'aria-pressed'), 'false');
  });
  return undefined;
});

test('a spec reload replaces the audio holder without starting playback', async (t) => {
  if (!(await haveBrowser())) return t.skip('browser unavailable');
  await withPage('preview', async (page) => {
    await page.evaluate(() => window.__reload());
    const s = await audioState(page);
    assert.equal(s.count, 1);
    assert.deepEqual(s.paused, [true]);
  });
  return undefined;
});

const scrubTo = (page, sec) => page.evaluate((v) => {
  const scrub = document.getElementById('scrub');
  scrub.value = String(v);
  scrub.dispatchEvent(new Event('input'));
}, sec);

test('Play from a scrubbed position starts the track at the matching offset', async (t) => {
  if (!(await haveBrowser())) return t.skip('browser unavailable');
  const track = { src: 'voice.wav', scene: 's', at: 0.5, duration: WAV_SECONDS };
  await withPage('preview', async (page) => {
    await scrubTo(page, 2);
    await page.click('#play');
    await page.waitForFunction(() => window.__motion.audio[0].el.paused === false, null, { timeout: PLAY_TIMEOUT_MS });
    const offset = await page.evaluate(() => window.__motion.audio[0].el.currentTime);
    assert.ok(Math.abs(offset - 1.5) < 0.5, `expected about 1.5s into the file, got ${offset}`);
  }, track);
  return undefined;
});

test('a track outside the playhead stays paused and fades apply to el.volume while scrubbing', async (t) => {
  if (!(await haveBrowser())) return t.skip('browser unavailable');
  const track = { src: 'voice.wav', scene: 's', at: 1, duration: 2, fadeIn: 2, volume: 0.5 };
  await withPage('preview', async (page) => {
    await scrubTo(page, 0.5);
    await page.click('#play');
    assert.equal(await page.evaluate(() => window.__motion.audio[0].el.paused), true, 'before track start');
    await page.keyboard.press('Space');
    await scrubTo(page, 2);
    const volume = await page.evaluate(() => window.__motion.audio[0].el.volume);
    assert.ok(Math.abs(volume - 0.25) < 1e-6, `volume ${volume}`); // 0.5 * (1s into a 2s fade-in)
  }, track);
  return undefined;
});
