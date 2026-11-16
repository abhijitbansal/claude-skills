// make.mjs <film> --poster <seconds> [--poster-out <file>]: one still of the film's own frame round(seconds * fps), post
// pass included, captions left out, and no MP4. A silent film's poster needs no ffmpeg. Browser tests skip without one.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HERE, browserAvailable } from './helpers/session.mjs';
import '../../scripts/v2/list.mjs';
import { loadFilm } from '../../scripts/v2/pipeline.mjs';
import { openSession } from '../../scripts/v2/session.mjs';
import { readPng } from '../../scripts/v2/png.mjs';
import { posterFrame } from '../../scripts/v2/poster.mjs';

const MAKE = path.resolve(HERE, '../../../scripts/make.mjs');
const NO_FFMPEG = { FFMPEG_PATH: '/nonexistent/ffmpeg', FFPROBE_PATH: '/nonexistent/ffprobe', PATH: '/nonexistent' };
const make = (args, env = {}) => spawnSync(process.execPath, [MAKE, ...args], { encoding: 'utf8', timeout: 120_000, env: { ...process.env, ...env } });
const BAR = (fill) => ({ type: 'path', id: 'bar', props: { d: 'M300 500H1620V580H300Z', fill } });
const FILM = { version: 2, fps: 30, shots: [
  { id: 'a', show: 'free', hold: 1, background: '#f3eee3', nodes: [BAR('#15130f')] },
  { id: 'b', show: 'free', hold: 1, background: '#1f4e8c', cut: 'cut', nodes: [BAR('#ffe14a')] },
] };

let dir;
before(() => { dir = mkdtempSync(path.join(tmpdir(), 'mm-poster-')); });
after(() => rmSync(dir, { recursive: true, force: true }));
const writeFilm = (name, film) => {
  const file = path.join(dir, `${name}.json`);
  writeFileSync(file, JSON.stringify(film));
  return file;
};

test('posterFrame: round(seconds * fps); past the last frame is refused with the film\'s length', () => {
  const timeline = { fps: 30, frameCount: 60, duration: 2 };
  assert.equal(posterFrame(1.5, timeline), 45);
  assert.equal(posterFrame(0, timeline), 0);
  assert.throws(() => posterFrame(40, timeline), /^Error: --poster 40: past the end \(the film is 2\.0 s\)$/);
});

test('a silent film\'s poster needs no ffmpeg: the frame as the film draws it, at the film\'s size, and no MP4', async (t) => {
  if (!await browserAvailable()) return t.skip('no browser');
  const film = writeFilm('silent', FILM);
  const out = path.join(dir, 'still.png');
  const run = make([film, '--poster', '1.5', '--poster-out', out, '--json'], NO_FFMPEG);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const report = JSON.parse(run.stdout);
  assert.deepEqual(report.poster, { file: out, frame: 45, seconds: 1.5 });
  assert.equal(report.output, null);
  assert.equal(existsSync(path.join(dir, 'out')), false, 'no MP4 and no sheets');
  const still = readPng(readFileSync(out));
  assert.deepEqual([still.width, still.height], [1920, 1080]);
  const session = await openSession(loadFilm(film));
  try {
    await session.page.evaluate((i) => window.__seek(i), 45);
    const exact = readPng(await session.page.screenshot({ type: 'png' }));
    assert.ok(still.data.equals(exact.data), 'the poster is the film\'s own frame 45');
  } finally {
    await session.close();
  }
  return undefined;
});

test('the default poster is poster.jpg beside where the MP4 would go', async (t) => {
  if (!await browserAvailable()) return t.skip('no browser');
  const run = make([writeFilm('default', FILM), '--poster', '0', '--json'], NO_FFMPEG);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const file = path.join(dir, 'out', 'poster.jpg');
  assert.equal(JSON.parse(run.stdout).poster.file, file);
  assert.deepEqual([...readFileSync(file).subarray(0, 3)], [0xff, 0xd8, 0xff], 'a JPEG');
  return undefined;
});

test('a time past the end is exit 2 with the film\'s length', async (t) => {
  if (!await browserAvailable()) return t.skip('no browser');
  const run = make([writeFilm('past', FILM), '--poster', '40'], NO_FFMPEG);
  assert.equal(run.status, 2);
  assert.match(run.stderr, /--poster 40: past the end \(the film is 2\.0 s\)/);
  return undefined;
});

test('refused pairs and a wrong --poster-out extension are usage errors', () => {
  for (const extra of [['--out', 'x.mp4'], ['--no-render'], ['--sheets-only'], ['--outline'], ['--batch', 'rows.json']]) {
    assert.equal(make(['f.json', '--poster', '1', ...extra]).status, 2, extra.join(' '));
  }
  assert.equal(make(['f.json', '--poster-out', 'p.jpg']).status, 2);
  assert.match(make(['f.json', '--poster', '1', '--poster-out', 'p.gif']).stderr, /\.jpg, \.jpeg, \.png/);
  assert.match(make(['f.json', '--poster', 'soon']).stderr, /--poster takes a time in seconds/);
});

test('a captioned film\'s poster has no caption ink; the rest of the frame is the film\'s', { todo: 'needs the engine: window.__seek(i, { captions: false }) in engine/page/stage.mjs (see the report, For the engine)' }, async () => {
  assert.fail('the page cannot leave captions out yet');
});
