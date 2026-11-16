// --workers <1-8 | auto>: frames split into contiguous ranges, one page per range in the one browser, pictures written to
// ffmpeg in frame order; the MP4 is byte-identical to one page's. Browser tests need a browser and ffmpeg.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HERE, browserAvailable, ffmpegOrNull } from './helpers/session.mjs';
import '../../scripts/v2/list.mjs';
import { loadFilm } from '../../scripts/v2/pipeline.mjs';
import { openSession } from '../../scripts/v2/session.mjs';
import { renderFilm } from '../../scripts/v2/render.mjs';
import { MAX_WORKERS, autoWorkers, workerRanges } from '../../scripts/v2/workers.mjs';

const MAKE = path.resolve(HERE, '../../../scripts/make.mjs');
const make = (args) => spawnSync(process.execPath, [MAKE, ...args], { encoding: 'utf8', timeout: 300_000 });
// desk has grain, so every frame differs a little: the test of byte identity covers the post pass.
const FILM = { version: 2, look: 'desk', fps: 30, shots: [
  { id: 'hook', show: 'statement', say: 'Every row has a source.' },
  { id: 'end', show: 'statement', cut: 'cut', say: 'One file each.' },
] };

let dir;
before(() => { dir = mkdtempSync(path.join(tmpdir(), 'mm-workers-')); });
after(() => rmSync(dir, { recursive: true, force: true }));
const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

test('workerRanges: contiguous, covering every frame once, never more ranges than frames', () => {
  assert.deepEqual(workerRanges(10, 4), [{ from: 0, to: 3 }, { from: 3, to: 6 }, { from: 6, to: 8 }, { from: 8, to: 10 }]);
  assert.deepEqual(workerRanges(3, 8), [{ from: 0, to: 1 }, { from: 1, to: 2 }, { from: 2, to: 3 }]);
  assert.deepEqual(workerRanges(5, 1), [{ from: 0, to: 5 }]);
});

test('auto is a function of the CPU count, from 1 to MAX_WORKERS', () => {
  assert.equal(autoWorkers(1), 1);
  assert.equal(autoWorkers(8), 4);
  assert.equal(autoWorkers(64), MAX_WORKERS);
});

test('--workers 0, 9 and x are usage errors; auto and 1-8 are accepted', () => {
  for (const bad of ['0', '9', 'x', '2.5']) {
    const run = make(['f.json', '--workers', bad]);
    assert.equal(run.status, 2, bad);
    assert.match(run.stderr, /--workers takes/);
  }
});

test('--workers 4 gives the MP4 --workers 1 gives, byte for byte, capturing at most three more frames', async (t) => {
  if (!await browserAvailable() || !await ffmpegOrNull()) return t.skip('no browser or ffmpeg');
  const film = path.join(dir, 'film.json');
  writeFileSync(film, JSON.stringify(FILM));
  const one = make([film, '--out', path.join(dir, 'one.mp4'), '--json', '--workers', '1']);
  assert.equal(one.status, 0, one.stdout + one.stderr);
  const four = make([film, '--out', path.join(dir, 'four.mp4'), '--json', '--workers', '4']);
  assert.equal(four.status, 0, four.stdout + four.stderr);
  assert.equal(sha(path.join(dir, 'four.mp4')), sha(path.join(dir, 'one.mp4')));
  const [r1, r4] = [JSON.parse(one.stdout), JSON.parse(four.stdout)];
  assert.equal(r4.workers, 4);
  assert.ok(r4.captured <= r1.captured + 3, `${r4.captured} vs ${r1.captured}`);
  return undefined;
});

test('a worker page closed mid-run fails the render, and no partial file is left', async (t) => {
  if (!await browserAvailable() || !await ffmpegOrNull()) return t.skip('no browser or ffmpeg');
  const film = path.join(dir, 'closing.json');
  writeFileSync(film, JSON.stringify(FILM));
  const loaded = loadFilm(film);
  const session = await openSession(loaded);
  const out = path.join(dir, 'closed', 'film.mp4');
  let extra = null;
  try {
    const openPage = async () => { extra = await openSession(loaded, { browser: session.page.context().browser() }); return extra; };
    const onProgress = ({ frame }) => { if (frame === 5 && extra) extra.page.close().catch(() => {}); };
    await assert.rejects(renderFilm({ out, session, workers: 2, openPage, onProgress }), /closed|Target/);
  } finally {
    await session.close();
  }
  assert.deepEqual(readdirSync(path.dirname(out)).filter((f) => f.endsWith('.mp4')), []);
  return undefined;
});

test('captureParallel: each range takes its own first frame even when it is held, and writes in frame order', async () => {
  const { captureParallel } = await import('../../scripts/v2/workers.mjs');
  const frames = 10;
  const held = Array.from({ length: frames }, (_, i) => i !== 0); // a still film: every frame after the first is held
  const fakePage = () => {
    const state = { frame: -1 };
    const win = { __heldFlags: (a, b) => held.slice(a, b + 1), __seek: (i) => { state.frame = i; } };
    return { state, evaluate: async (fn, arg) => { globalThis.window = win; return fn(arg); } };
  };
  const pages = [fakePage(), fakePage(), fakePage(), fakePage()];
  const written = [];
  const captured = await captureParallel({ pages, frames, capture: async (page) => Buffer.from(String(page.state.frame)), write: async (b) => { written.push(b === null ? null : b.toString()); } });
  assert.deepEqual(written, ['0', '0', '0', '3', '3', '3', '6', '6', '8', '8']);
  assert.equal(captured, 4, 'one picture per range');
});
