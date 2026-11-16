// --batch end to end: three rows of a silent welcome film give three MP4s whose first frames differ where the name is,
// a manifest whose sha256 values match the files, and one browser for the run; a row that fails while rendering is
// marked failed and the others still render. Needs a browser and ffmpeg (skips without; PA_REQUIRE_BROWSER=1 fails).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { browserAvailable, ffmpegOrNull } from './helpers/session.mjs';
import '../../scripts/v2/list.mjs';
import { runBatch } from '../../scripts/v2/batch.mjs';
import { runMake } from '../../scripts/v2/run.mjs';
import { launchRunBrowser as launchBrowser } from '../../scripts/v2/session.mjs';

const FILM = { version: 2, look: 'desk', vars: { name: { type: 'string', default: 'Ada' } }, shots: [
  { id: 'hello', show: 'statement', say: 'Welcome aboard, {{name}}.' },
] };
const ROWS = [{ name: 'Grace' }, { name: 'Linus' }, { name: 'Margaret' }];

let dir;
before(() => { dir = mkdtempSync(path.join(tmpdir(), 'mm-batch-browser-')); });
after(() => rmSync(dir, { recursive: true, force: true }));

async function needs(t) {
  if (!await browserAvailable()) { t.skip('no browser'); return null; }
  const ffmpeg = await ffmpegOrNull();
  if (!ffmpeg) { t.skip('no ffmpeg'); return null; }
  return ffmpeg;
}

const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
// The video's true last frame: every frame of its last second decoded, each overwriting one PNG (-update 1), so a seek
// that lands between packets cannot return nothing. The PNG goes in this test's own temp folder.
function lastFrame(ffmpeg, file) {
  const png = `${file}.last.png`;
  const r = spawnSync(ffmpeg, ['-v', 'error', '-y', '-sseof', '-1', '-i', file, '-update', '1', '-c:v', 'png', png], { encoding: 'utf8', timeout: 60_000 });
  assert.equal(r.status, 0, `ffmpeg could not read the last frame of ${file}: ${r.stderr}`);
  return readFileSync(png);
}
const counted = () => {
  const launches = [];
  return { launches, launch: async (options) => { launches.push(options); return launchBrowser(options); } };
};

test('three rows: three MP4s that differ where the name is, a manifest of their hashes, one browser', async (t) => {
  const ffmpeg = await needs(t);
  if (!ffmpeg) return;
  const specPath = path.join(dir, 'welcome.json');
  writeFileSync(specPath, JSON.stringify(FILM));
  writeFileSync(path.join(dir, 'rows.json'), JSON.stringify(ROWS));
  const { launches, launch } = counted();
  const { report, exitCode } = await runBatch({ specPath, batch: path.join(dir, 'rows.json'), out: path.join(dir, 'renders', '{name}.mp4'), exact: false, noRender: false, outline: false }, { log: () => {}, launch, runRow: runMake });
  assert.equal(exitCode, 0, JSON.stringify(report));
  assert.equal(launches.length, 1, 'one browser for the run');
  const manifest = JSON.parse(readFileSync(path.join(dir, 'renders', 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.rows.map((r) => [r.index, r.status, r.values.name]), [[1, 'ok', 'Grace'], [2, 'ok', 'Linus'], [3, 'ok', 'Margaret']]);
  for (const row of manifest.rows) assert.equal(row.sha256, sha(row.file), row.file);
  const frames = manifest.rows.map((r) => lastFrame(ffmpeg, r.file));
  assert.ok(frames.every((f) => f.length > 0));
  assert.equal(new Set(frames.map((f) => createHash('sha256').update(f).digest('hex'))).size, 3, 'each row shows its own name');
});

test('a row that fails while rendering is failed; the other two are ok', async (t) => {
  const ffmpeg = await needs(t);
  if (!ffmpeg) return;
  const specPath = path.join(dir, 'welcome-fail.json');
  writeFileSync(specPath, JSON.stringify(FILM));
  writeFileSync(path.join(dir, 'rows-fail.json'), JSON.stringify(ROWS));
  const runRow = async (options, io) => {
    if (options.values.name === 'Linus') throw new Error('an injected render error');
    return runMake(options, io);
  };
  const { report, exitCode } = await runBatch({ specPath, batch: path.join(dir, 'rows-fail.json'), out: path.join(dir, 'fail', '{name}.mp4'), exact: false, noRender: false, outline: false }, { log: () => {}, runRow });
  assert.equal(exitCode, 1);
  assert.deepEqual(report.rows.map((r) => r.status), ['ok', 'failed', 'ok']);
  const manifest = JSON.parse(readFileSync(path.join(dir, 'fail', 'manifest.json'), 'utf8'));
  assert.match(manifest.rows[1].error, /injected render error/);
  assert.equal(manifest.rows[1].sha256, null);
});

test('a run given a browser opens its page there and leaves it open: no second browser', async (t) => {
  if (!await browserAvailable()) return t.skip('no browser');
  const specPath = path.join(dir, 'shared.json');
  writeFileSync(specPath, JSON.stringify({ ...FILM, vars: undefined, shots: [{ id: 'hello', show: 'statement', say: 'Welcome aboard.' }] }));
  const shared = await launchBrowser({ ownSignals: true });
  try {
    let contexts = 0;
    const spy = { newContext: (...args) => { contexts += 1; return shared.newContext(...args); } };
    const { exitCode } = await runMake({ specPath, out: path.join(dir, 'shared', 'film.mp4'), exact: false, noRender: true, outline: false }, { browser: spy });
    assert.equal(exitCode, 0);
    assert.equal(contexts, 1, 'the page was opened in the given browser');
    assert.equal(shared.isConnected(), true, 'and the browser is left open');
  } finally {
    await shared.close();
  }
  return undefined;
});
