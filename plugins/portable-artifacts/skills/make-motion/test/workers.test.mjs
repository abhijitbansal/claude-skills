import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, existsSync, readdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseWorkers, parseFailAt, captureInOrder } from '../scripts/lib/workers.mjs';
import { encodeArgs, draftSize } from '../scripts/lib/ffmpeg.mjs';
import { UsageError } from '../scripts/lib/spec.mjs';
import { requireRender, renderHash, assertRendersIdentically, makeTestVideo, BROWSER_ONLY } from './helpers/render.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RENDER = path.join(root, 'scripts/render.mjs');
const EXAMPLE = path.join(root, 'references/examples/q3-revenue.json');
const SWIPE = path.join(root, 'references/examples/blocks/before-after-swipe.json');
const CUES = path.join(root, 'references/examples/sample-cues.json');
const SMALL = ['--fps', '10', '--size', '320x180'];
const NEED_ALL = { need: ['browser', 'ffmpeg', 'ffprobe'] };
const cli = (args, env = {}) => spawnSync(process.execPath, [RENDER, EXAMPLE, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });

test('parseWorkers: 1-16 or auto; anything else is a usage error that lists the accepted values', () => {
  assert.equal(parseWorkers(undefined), 1);
  assert.equal(parseWorkers('1'), 1);
  assert.equal(parseWorkers('16'), 16);
  assert.equal(parseWorkers('auto', 10), 8, 'auto caps at 8');
  assert.equal(parseWorkers('auto', 4), 3, 'auto leaves one core free');
  assert.equal(parseWorkers('auto', 1), 1, 'auto never goes below 1');
  for (const bad of ['0', '17', 'abc', '', '1.5', '-2', '4x', ' 4', '0x4', '+4', 'AUTO']) {
    assert.throws(() => parseWorkers(bad), (e) => e instanceof UsageError && /--workers must be an integer from 1 to 16 or "auto"/.test(e.message), JSON.stringify(bad));
  }
});

test('parseFailAt: a strict non-negative integer, anything else is ignored', () => {
  assert.equal(parseFailAt('5'), 5);
  assert.equal(parseFailAt('0'), 0);
  for (const bad of [undefined, '', 'abc', '5x', ' 5', '5 ', '-1', '5.0', '0x5', '1e1', '+5', 'null']) assert.equal(parseFailAt(bad), null, JSON.stringify(bad));
});

// Fake pages: a page seeks (a frame index) and screenshots it. Later pages are faster, so frames are ready out of order.
// `log` collects { dir files at the moment a page wrote, page index } so a test can see how many PNGs waited on disk.
function fakePages(count, { failFrame = null, dir = null, filesSeen = [] } = {}) {
  return Array.from({ length: count }, (_, k) => {
    let last = -1;
    return {
      evaluate: async (_fn, sec) => {
        await new Promise((r) => { setTimeout(r, (count - k) * 3); });
        last = Math.round(sec * 10);
        if (last === failFrame) throw new Error('page crashed');
      },
      screenshot: async () => {
        if (dir) filesSeen.push(readdirSync(dir).length + 1); // the files already there, and the one this page is about to write
        return Buffer.from(String(last));
      },
    };
  });
}

test('captureInOrder: frames reach onFrame in order whatever order the pages finish, and their files are deleted', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'wk-'));
  const seen = [];
  await captureInOrder({ pages: fakePages(4), frames: 10, fps: 10, dir, onFrame: async (buf) => { seen.push(Number(buf.toString())); } });
  assert.deepEqual(seen, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(readdirSync(dir), [], 'every frame file was removed once consumed');
});

test('captureInOrder: at most 2 PNG files per page exist at once, however slow the consumer is (the disk bound)', async () => {
  for (const pageCount of [1, 3, 4]) {
    const dir = mkdtempSync(path.join(tmpdir(), 'wk-'));
    const filesSeen = [];
    const seen = [];
    // A slow encoder: the pages would run far ahead of it if nothing held them back.
    const onFrame = async (buf) => { await new Promise((r) => { setTimeout(r, 12); }); seen.push(Number(buf.toString())); };
    await captureInOrder({ pages: fakePages(pageCount, { dir, filesSeen }), frames: 40, fps: 10, dir, onFrame });
    assert.equal(seen.length, 40);
    assert.deepEqual(seen, seen.toSorted((a, b) => a - b), 'still in order');
    assert.ok(Math.max(...filesSeen) <= 2 * pageCount, `${pageCount} pages: at most ${2 * pageCount} files at once, saw ${Math.max(...filesSeen)}`);
  }
});

test('captureInOrder: the disk bound is what holds the files back (guardrail proof: with the bound lifted the same run piles frames up)', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'wk-'));
  const filesSeen = [];
  const onFrame = async () => { await new Promise((r) => { setTimeout(r, 12); }); };
  await captureInOrder({ pages: fakePages(4, { dir, filesSeen }), frames: 40, fps: 10, dir, onFrame, ahead: Infinity });
  assert.ok(Math.max(...filesSeen) > 2 * 4, `without the bound the files waiting reached ${Math.max(...filesSeen)}`);
});

test('captureInOrder: an `ahead` under 1 would wait forever, so it is clamped to 1 and the run still finishes in order', async () => {
  for (const ahead of [0, -3, 0.4, NaN]) {
    const dir = mkdtempSync(path.join(tmpdir(), 'wk-'));
    const seen = [];
    const run = captureInOrder({ pages: fakePages(3), frames: 8, fps: 10, dir, ahead, onFrame: async (buf) => { seen.push(Number(buf.toString())); } });
    const timeout = new Promise((_, reject) => { setTimeout(() => reject(new Error(`ahead ${ahead}: still waiting after 5 s (deadlock)`)), 5000).unref(); });
    await Promise.race([run, timeout]);
    assert.deepEqual(seen, [0, 1, 2, 3, 4, 5, 6, 7], `ahead ${ahead}`);
  }
});

test('captureInOrder: a page error rejects with "worker <k> failed at frame <j>: <message>" (k counts from 0)', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'wk-'));
  const seen = [];
  await assert.rejects(
    captureInOrder({ pages: fakePages(4, { failFrame: 7 }), frames: 10, fps: 10, dir, onFrame: async (buf) => { seen.push(Number(buf.toString())); } }),
    /worker [0-3] failed at frame 7: page crashed/,
  );
  assert.deepEqual(seen, seen.map((_, i) => i), 'what was consumed before the failure was in order');
});

test('captureInOrder: an onFrame error (the encoder) stops the run and is rethrown unchanged', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'wk-'));
  await assert.rejects(
    captureInOrder({ pages: fakePages(2), frames: 6, fps: 10, dir, onFrame: async () => { throw new Error('ffmpeg failed (exit 1)'); } }),
    /^Error: ffmpeg failed \(exit 1\)$/,
  );
});

test('schema.md documents what --workers costs: the disk bound, memory per page, the 0-based worker index', () => {
  const doc = readFileSync(path.join(root, 'references/schema.md'), 'utf8');
  assert.match(doc, /at most 2 × workers PNG files exist at once/);
  assert.match(doc, /memory grows with `--workers`/);
  assert.match(doc, /k counts from 0/);
  assert.doesNotMatch(doc, /replays the frames/, 'the warm-up is gone');
});

test('draftSize halves each side, rounds down to even, and never goes under the 16 px minimum side', () => {
  assert.deepEqual(draftSize([1920, 1080]), [960, 540]);
  assert.deepEqual(draftSize([320, 180]), [160, 90]);
  assert.deepEqual(draftSize([1080, 1920]), [540, 960]);
  assert.deepEqual(draftSize([322, 182]), [160, 90], '161 and 91 round down to even');
  assert.deepEqual(draftSize([1000, 1000]), [500, 500]);
  assert.deepEqual(draftSize([20, 20]), [16, 16], 'the review found 10x10 here');
  assert.deepEqual(draftSize([16, 3840]), [16, 1920]);
});

test('encodeArgs: draft adds -crf 30 -preset veryfast; without quality (or final) the arguments are unchanged', () => {
  const base = { fps: 30, out: 'o.mp4' };
  const plain = encodeArgs(base);
  assert.deepEqual(encodeArgs({ ...base, quality: 'final' }), plain);
  assert.deepEqual(encodeArgs({ ...base, quality: undefined }), plain);
  assert.ok(!plain.includes('-crf') && !plain.includes('-preset'));
  const draft = encodeArgs({ ...base, quality: 'draft' });
  assert.deepEqual(draft.slice(draft.indexOf('-crf'), draft.indexOf('-crf') + 4), ['-crf', '30', '-preset', 'veryfast']);
  assert.deepEqual(draft.toSpliced(draft.indexOf('-crf'), 4), plain, 'nothing else moves');
  const audio = [{ file: 'a.wav', start: 0, end: 1, volume: 1, fadeIn: 0, fadeOut: 0, clipStart: 0 }];
  assert.ok(encodeArgs({ ...base, audio, duration: 1, quality: 'draft' }).includes('veryfast'), 'draft with audio');
  assert.throws(() => encodeArgs({ ...base, quality: 'fast' }), /quality must be "draft" or "final"/);
});

test('render: a bad --workers or --quality exits 2 and lists the accepted values; nothing is written', () => {
  for (const [args, pattern] of [
    [['--workers', '0'], /--workers must be an integer from 1 to 16 or "auto"/],
    [['--workers', '17'], /--workers must be an integer from 1 to 16 or "auto"/],
    [['--workers', 'abc'], /--workers must be an integer from 1 to 16 or "auto"/],
    [['--workers'], /--workers needs a value/],
    [['--quality', 'fast'], /--quality must be "draft" or "final"/],
    [['--quality', 'draft', '--contact-sheet'], /--quality does not apply to --contact-sheet/],
    [['--workers', '4', '--contact-sheet'], /--workers does not apply to --contact-sheet/],
    [['--workers', '1', '--contact-sheet'], /--workers does not apply to --contact-sheet/], // any value: one outcome whatever the core count
    [['--workers', 'auto', '--contact-sheet'], /--workers does not apply to --contact-sheet/],
  ]) {
    const r = cli(args);
    assert.equal(r.status, 2, `${args.join(' ')}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, pattern);
    assert.equal(r.stdout, '', 'a usage error prints nothing on stdout');
  }
});

test('render: --workers 1 and --workers 4 give the same MP4 (q3-revenue at 320x180 / 10 fps), and the note goes to stderr only', async (t) => {
  if (!await requireRender(t)) return;
  const one = await renderHash(EXAMPLE, [...SMALL, '--workers', '1']);
  const out = path.join(mkdtempSync(path.join(tmpdir(), 'wk-')), 'v.mp4');
  const r = cli(['--out', out, ...SMALL, '--workers', '4'], { SOURCE_DATE_EPOCH: '1793318400' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /^workers: 4$/m);
  assert.doesNotMatch(r.stdout, /workers/, 'stdout is unchanged');
  assert.match(r.stdout, /100 frames @ 10 fps, 320x180/);
  assert.equal(createHash('sha256').update(readFileSync(out)).digest('hex'), one.sha256);
  const progress = (text) => text.split('\n').filter((l) => /^\d+% /.test(l));
  assert.deepEqual(progress(r.stdout), progress(one.stdout), 'the same progress lines');
});

test('render: --workers 1 and --workers 4 give the same MP4 for a spec with a sliding image and a scaling title', async (t) => {
  if (!await requireRender(t)) return;
  const one = await renderHash(SWIPE, [...SMALL, '--workers', '1']);
  const four = await renderHash(SWIPE, [...SMALL, '--workers', '4']);
  assert.equal(four.sha256, one.sha256);
});

test('render: --workers 4 renders byte-identical twice (the pages interleave differently each time)', async (t) => {
  if (!await requireRender(t)) return;
  await assertRendersIdentically(t, EXAMPLE, [...SMALL, '--workers', '4']);
});

// The smallest spec for the seek-order bug (test/seek-order.test.mjs): a text that fades in early and sits at full opacity
// for the rest, so every page but the one that took the first frames meets it after the fade.
test('render: a text that faded in before a page\'s first frame is drawn the same bytes at 1 and 4 workers', async (t) => {
  if (!await requireRender(t)) return;
  const dir = mkdtempSync(path.join(tmpdir(), 'wk-'));
  const spec = path.join(dir, 'm.json');
  writeFileSync(spec, JSON.stringify({ size: [320, 180], fps: 30, scenes: [{ id: 'a', duration: 4, elements: [
    { id: 't', type: 'text', text: 'Revenue Q1 $32.0M', x: 160, y: 90, fontSize: 24, fontWeight: 600, keyframes: [{ t: 0.5, opacity: 0 }, { t: 1, opacity: 1 }] }] }] }));
  const one = await renderHash(spec, ['--fps', '10', '--workers', '1']);
  const four = await renderHash(spec, ['--fps', '10', '--workers', '4']);
  assert.equal(four.sha256, one.sha256);
});

// Its own clip (a length no other test uses, so its own frame cache folder: video.test.mjs deletes and rebuilds the
// footage-intro one while files run in parallel). A moving box that fades in, then a second scene with a title.
test('render: --workers 1 and --workers 4 give the same MP4 for a spec with a video element', async (t) => {
  const tools = await requireRender(t, NEED_ALL);
  if (!tools) return;
  const dir = mkdtempSync(path.join(tmpdir(), 'wk-'));
  makeTestVideo(tools.ffmpeg, path.join(dir, 'clip.mp4'), { seconds: 1.7 });
  const spec = path.join(dir, 'm.json');
  writeFileSync(spec, JSON.stringify({ size: [320, 180], fps: 30, scenes: [
    { id: 'a', duration: 2, elements: [{ id: 'clip', type: 'video', x: 160, y: 90, src: 'clip.mp4', width: 320, height: 180, keyframes: [{ t: 0, opacity: 0 }, { t: 0.5, opacity: 1 }] }] },
    { id: 'b', duration: 1.5, transition: 'fade', elements: [{ id: 'title', type: 'text', text: 'After the clip', x: 160, y: 90, fontSize: 24 }] }] }));
  const one = await renderHash(spec, ['--fps', '10', '--workers', '1']);
  const four = await renderHash(spec, ['--fps', '10', '--workers', '4']);
  assert.equal(four.sha256, one.sha256);
});

test('render: --workers does not touch audio: a spec with cues gives the same MP4 at 1 and 3 workers', async (t) => {
  if (!await requireRender(t)) return;
  const one = await renderHash(CUES, [...SMALL, '--workers', '1']);
  const three = await renderHash(CUES, [...SMALL, '--workers', '3']);
  assert.equal(three.sha256, one.sha256);
});

test('render: more workers than frames still renders (the extra workers are not started)', async (t) => {
  if (!await requireRender(t)) return;
  const one = await renderHash(EXAMPLE, ['--fps', '1', '--size', '320x180', '--workers', '1']);
  const many = await renderHash(EXAMPLE, ['--fps', '1', '--size', '320x180', '--workers', '16']);
  assert.equal(many.sha256, one.sha256);
});

test('render: a worker that fails at frame 5 exits 1 naming the worker and frame, leaving no .partial.mp4, output or temp frames', async (t) => {
  if (!await requireRender(t)) return;
  const dir = mkdtempSync(path.join(tmpdir(), 'wk-'));
  const scratch = mkdtempSync(path.join(tmpdir(), 'wk-tmp-'));
  const r = cli(['--out', path.join(dir, 'o.mp4'), ...SMALL, '--workers', '2'], { PA_WORKER_FAIL_AT: '5', TMPDIR: scratch });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /worker \d+ failed at frame 5: /);
  assert.deepEqual(readdirSync(dir), [], 'neither the partial nor the MP4 is left');
  assert.deepEqual(readdirSync(scratch), [], 'the temp frame folder is gone');
});

test('render: PA_WORKER_FAIL_AT is ignored unless it is a plain integer', async (t) => {
  if (!await requireRender(t)) return;
  for (const value of ['abc', '5x', '']) {
    const dir = mkdtempSync(path.join(tmpdir(), 'wk-'));
    const r = cli(['--out', path.join(dir, 'o.mp4'), '--fps', '2', '--size', '320x180', '--workers', '2'], { PA_WORKER_FAIL_AT: value });
    assert.equal(r.status, 0, `${JSON.stringify(value)}: ${r.stderr}`);
    assert.ok(existsSync(path.join(dir, 'o.mp4')));
  }
});

// Playwright closes the browser and exits 130 by itself on Ctrl+C unless the caller opts out (launchBrowser ownSignals),
// which used to leave the partial MP4 behind mid-render, with one page as much as with several.
for (const workers of ['1', '4']) {
  test(`render: an interrupt mid-render with --workers ${workers} removes the partial MP4 and any temp frame folder (exit 130)`, async (t) => {
    if (!await requireRender(t, BROWSER_ONLY)) return;
    const dir = mkdtempSync(path.join(tmpdir(), 'wk-'));
    const scratch = mkdtempSync(path.join(tmpdir(), 'wk-tmp-'));
    // A stand-in encoder that creates its output at once (the real one waits to probe the input) and drains the frames.
    const fake = path.join(mkdtempSync(path.join(tmpdir(), 'wk-bin-')), 'ffmpeg');
    writeFileSync(fake, '#!/bin/sh\nfor last; do :; done\n: > "$last"\ncat > /dev/null\n');
    chmodSync(fake, 0o755);
    const child = spawn(process.execPath, [RENDER, EXAMPLE, '--out', path.join(dir, 'o.mp4'), '--fps', '60', '--size', '320x180', '--workers', workers], { env: { ...process.env, TMPDIR: scratch, FFMPEG_PATH: fake } });
    const closed = new Promise((resolve) => child.on('close', (code, signal) => resolve({ code, signal })));
    // The first progress line (10%) means the browser is up and frames are reaching the encoder, with 90% still to render.
    let out = '';
    child.stdout.on('data', (c) => { out += c; });
    const deadline = Date.now() + 60000;
    while (!/^10% /m.test(out) && Date.now() < deadline) await new Promise((r) => { setTimeout(r, 10); });
    assert.match(out, /^10% /m, 'the render is under way');
    assert.deepEqual(readdirSync(dir), ['o.partial.mp4'], 'a partial MP4 exists to be removed');
    if (workers !== '1') assert.ok(readdirSync(scratch).some((f) => f.startsWith('motion-frames-')), 'the frame folder exists');
    child.kill('SIGINT');
    const { code, signal } = await closed;
    assert.deepEqual([code, signal], [130, null]);
    assert.deepEqual(readdirSync(scratch), [], 'the frame folder (and the browser profile) are gone');
    assert.deepEqual(readdirSync(dir), [], 'no partial MP4');
  });
}

test('render: --quality draft encodes at half size (160x90 for a 320x180 run), says so on stderr, and leaves stdout alone', async (t) => {
  const tools = await requireRender(t, NEED_ALL);
  if (!tools) return;
  const out = path.join(mkdtempSync(path.join(tmpdir(), 'wk-')), 'd.mp4');
  const r = cli(['--out', out, ...SMALL, '--quality', 'draft']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /^quality: draft \(160x90\)$/m);
  assert.doesNotMatch(r.stdout, /quality/);
  assert.match(r.stdout, /100 frames @ 10 fps, 160x90\n$/);
  const probe = spawnSync(tools.ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,nb_frames', '-of', 'csv=p=0', out], { encoding: 'utf8' });
  assert.equal(probe.stdout.trim(), '160,90,100');
});

test('render: --quality final is the default: same MP4 and no quality line', async (t) => {
  if (!await requireRender(t)) return;
  const plain = await renderHash(EXAMPLE, SMALL);
  const final = await renderHash(EXAMPLE, [...SMALL, '--quality', 'final']);
  assert.equal(final.sha256, plain.sha256);
  const r = cli(['--out', path.join(mkdtempSync(path.join(tmpdir(), 'wk-')), 'f.mp4'), ...SMALL, '--quality', 'final']);
  assert.doesNotMatch(r.stderr, /quality|workers/);
});

test('render: a draft render is byte-identical at 1 and 4 workers', async (t) => {
  if (!await requireRender(t)) return;
  const one = await renderHash(EXAMPLE, [...SMALL, '--quality', 'draft', '--workers', '1']);
  const four = await renderHash(EXAMPLE, [...SMALL, '--quality', 'draft', '--workers', '4']);
  assert.equal(four.sha256, one.sha256);
});
