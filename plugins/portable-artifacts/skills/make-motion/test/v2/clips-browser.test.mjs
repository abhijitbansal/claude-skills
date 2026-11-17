// A video clip drawn in the page and rendered: its frames move with the film, every page draws the same frames, the
// clip route serves only decoded frames, the review sheets and the render take clip frames, the clip's sound is mixed,
// and --workers 4 gives the same bytes as one. Skips without a browser or ffmpeg.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync as copy, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { HERE, browserAvailable } from './helpers/session.mjs';
import '../../scripts/v2/list.mjs';
import { loadFilm } from '../../scripts/v2/pipeline.mjs';
import { openSession } from '../../scripts/v2/session.mjs';
import { prepareClips } from '../../scripts/v2/clips.mjs';
import { runMake } from '../../scripts/v2/run.mjs';

const CLIP = path.resolve(HERE, '../../../references/examples/v2/media-clip.mp4'); // HERE is test/v2/helpers
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
const FILM = { version: 2, fps: 30, look: 'desk', seed: 3, shots: [
  { id: 'open', show: 'free', hold: 1, background: '#f3eee3', nodes: [{ type: 'path', id: 'bar', props: { d: 'M300 500H1620V580H300Z', fill: '#15130f' } }] },
  { id: 'reel', show: 'media', cut: 'cut', src: 'clip.mp4', in: 1, hold: 1.5 },
] };

let dir, ready = false;
before(async () => {
  ready = hasFfmpeg && await browserAvailable();
  dir = mkdtempSync(path.join(tmpdir(), 'mm-clips-b-'));
  copy(CLIP, path.join(dir, 'clip.mp4'));
  writeFileSync(path.join(dir, 'film.json'), JSON.stringify(FILM));
});
after(() => rmSync(dir, { recursive: true, force: true }));

const options = (extra) => ({ specPath: path.join(dir, 'film.json'), out: null, exact: false, noRender: false, outline: false, provenance: { noProvenance: true }, ...extra });

async function clipSession() {
  const loaded = loadFilm(path.join(dir, 'film.json'));
  const clips = await prepareClips({ ...loaded, cacheDir: mkdtempSync(path.join(dir, 'w-')), canvas: { w: 1920, h: 1080 } });
  return openSession({ ...loaded, clips });
}

const sourceHash = (page, i) => page.evaluate(async (frame) => {
  await window.__seek(frame);
  const blob = await window.__source.convertToBlob({ type: 'image/png' });
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}, i);

test('the clip plays: its frames differ through the shot, none is held, and two pages draw the same frames', async (t) => {
  if (!ready) return t.skip('no browser or ffmpeg');
  const [a, b] = [await clipSession(), await clipSession()];
  try {
    const frames = [31, 32, 45, 65]; // the clip shot runs from frame 30
    const hashes = [];
    for (const i of frames) hashes.push(await sourceHash(a.page, i));
    assert.equal(new Set(hashes).size, frames.length, 'each clip frame is its own picture');
    for (const [k, i] of frames.entries()) assert.equal(await sourceHash(b.page, i), hashes[k], `frame ${i} is the same in a second page`);
    // the picture shows clip frame (t - shot start) * fps from its in: frame 31 is the clip's frame 1, 45 its 15
    const shown = await a.page.evaluate((list) => list.map((i) => {
      const find = (nodes) => nodes.reduce((hit, n) => hit ?? (n.props?.video ? n : find(n.children)), null);
      return find(window.__snapshot(i)).frame;
    }), [31, 45, 65]);
    assert.deepEqual(shown.map((v) => Math.round(v)), [1, 15, 35]);
    const held = await a.page.evaluate(() => window.__heldFlags(31, 70, true));
    assert.ok(held.every((h) => h === false), 'a playing clip is never taken for a held frame');
  } finally {
    await a.close();
    await b.close();
  }
});

test('the clip route serves decoded frames by canonical index only', async (t) => {
  if (!ready) return t.skip('no browser or ffmpeg');
  const s = await clipSession();
  try {
    const status = (p) => s.page.evaluate(async (url) => (await fetch(url)).status, p);
    const first = await s.page.evaluate(async () => { const r = await fetch('/clip/0/0'); return [r.status, r.headers.get('content-type'), r.headers.get('content-security-policy') !== null]; });
    assert.deepEqual(first, [200, 'image/png', true]);
    assert.equal(await status('/clip/0/9999'), 404);
    assert.equal(await status('/clip/1/0'), 404);
    assert.equal(await status('/clip/00/1'), 404);
    assert.equal(await status('/asset/0'), 404, 'a clip is not served as a picture');
  } finally {
    await s.close();
  }
});

test('the review sheets take clip frames, and the run reports no finding', async (t) => {
  if (!ready) return t.skip('no browser or ffmpeg');
  const out = path.join(dir, 'sheets', 'film.mp4');
  const { report, exitCode } = await runMake(options({ out, noRender: true }));
  assert.equal(exitCode, 0, JSON.stringify(report.findings ?? report.error));
  assert.deepEqual(report.findings, []);
  assert.ok(report.stages.some((s) => s.name === 'clips' && s.ok));
  assert.ok(readdirSync(path.join(dir, 'sheets', 'film.sheets')).some((f) => f.endsWith('.png')));
});

const videoHash = (file) => createHash('sha256').update(spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:v:0', '-c', 'copy', '-f', 'data', '-'], { maxBuffer: 1 << 28 }).stdout).digest('hex');

test('a render mixes the clip\'s sound, and --workers 4 gives the same video as one worker', async (t) => {
  if (!ready) return t.skip('no browser or ffmpeg');
  const one = path.join(dir, 'r1', 'film.mp4');
  const four = path.join(dir, 'r4', 'film.mp4');
  const r1 = await runMake(options({ out: one }));
  assert.equal(r1.exitCode, 0, JSON.stringify(r1.report.findings ?? r1.report.error));
  assert.equal(r1.report.audio.tracks, 1, 'the clip\'s own sound is one extra track');
  const streams = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', one], { encoding: 'utf8' }).stdout.trim().split('\n').map((s) => s.replace(/,+$/, ''));
  assert.deepEqual(streams.sort(), ['audio', 'video']);
  const r4 = await runMake(options({ out: four, workers: 4 }));
  assert.equal(r4.exitCode, 0);
  assert.equal(videoHash(four), videoHash(one));
  assert.ok(existsSync(one) && readFileSync(one).length > 0);
});

test('a muted clip has no sound to mix: the film stays silent', async (t) => {
  if (!ready) return t.skip('no browser or ffmpeg');
  writeFileSync(path.join(dir, 'muted.json'), JSON.stringify({ ...FILM, shots: FILM.shots.map((s) => (s.show === 'media' ? { ...s, muted: true } : s)) }));
  const out = path.join(dir, 'm', 'film.mp4');
  const { exitCode, report } = await runMake(options({ specPath: path.join(dir, 'muted.json'), out }));
  assert.equal(exitCode, 0);
  assert.equal(report.audio, null);
});
