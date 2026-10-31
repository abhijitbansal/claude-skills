import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { requireRender, renderHash, assertRendersIdentically, makeTestVideo } from './helpers/render.mjs';
import { createHash } from 'node:crypto';
import net from 'node:net';
import { probeVideo, probeArgs, decodeArgs, frameCacheKey, ffmpegVersion, decodeFrames, readCache, prepareVideo, videoAudioTracks, CACHE_ROOT } from '../scripts/lib/video.mjs';
import { validateSpec, withDefaults } from '../scripts/lib/spec.mjs';
import { encodeArgs, preflightArgs, probeAudioArgs } from '../scripts/lib/ffmpeg.mjs';
import { startServer } from '../scripts/lib/server.mjs';
import { launchBrowser } from '../scripts/lib/browser.mjs';
import { videoCache, CACHE_LIMIT_BYTES } from '../scripts/lib/requirements.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FOOTAGE_INTRO = path.join(root, 'references/examples/footage-intro.json');
const VIDEO_TOOLS = { need: ['ffmpeg', 'ffprobe'] };
const RENDER_TOOLS = { need: ['browser', 'ffmpeg', 'ffprobe'] };
const SMALL = ['--fps', '10', '--size', '320x180'];

const tmp = (prefix) => mkdtempSync(path.join(tmpdir(), prefix));
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

// A one-scene 320x180 spec beside `clip.mp4` in `dir`, holding one video element (320x180 at the centre, `video` merged in).
function videoSpec(dir, video = {}, { duration = 2 } = {}) {
  const file = path.join(dir, 'motion.json');
  const el = { id: 'clip', type: 'video', x: 160, y: 90, src: 'clip.mp4', width: 320, height: 180, ...video };
  writeFileSync(file, JSON.stringify({ size: [320, 180], fps: 30, scenes: [{ id: 's', duration, elements: [el] }] }));
  return file;
}

// "average:<dB>" from an ffmpeg psnr run; `inf` (identical frames) reads as Infinity.
function psnr(ffmpeg, args) {
  const r = spawnSync(ffmpeg, ['-hide_banner', ...args, '-f', 'null', '-'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const m = /average:(inf|\d+(?:\.\d+)?)/.exec(r.stderr);
  assert.ok(m, `no psnr average in:\n${r.stderr}`);
  return m[1] === 'inf' ? Infinity : Number(m[1]);
}

function streams(ffprobe, file) {
  const r = spawnSync(ffprobe, ['-v', 'error', '-show_streams', '-of', 'json', file], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout).streams;
}

test('probeVideo reads duration, size, fps and hasAudio from a generated clip', async (t) => {
  const tools = await requireRender(t, VIDEO_TOOLS);
  if (!tools) return;
  const file = path.join(tmp('video-probe-'), 'clip.mp4');
  makeTestVideo(tools.ffmpeg, file, { audio: true });
  const info = probeVideo(tools.ffprobe, file);
  assert.equal(info.error, undefined, info.error);
  assert.equal(info.duration, 2);
  assert.equal(info.width, 320);
  assert.equal(info.height, 180);
  assert.equal(info.fps, 10);
  assert.equal(info.hasAudio, true);
  assert.equal(info.hasAlpha, false);
  const silent = path.join(path.dirname(file), 'silent.mp4');
  makeTestVideo(tools.ffmpeg, silent);
  assert.equal(probeVideo(tools.ffprobe, silent).hasAudio, false);
  assert.ok(probeVideo(tools.ffprobe, path.join(root, 'package.json')).error, 'a file that is not a video is an error');
});

test('trimEnd past the clip length and trimStart >= trimEnd are errors naming the numbers', async (t) => {
  const tools = await requireRender(t, VIDEO_TOOLS);
  if (!tools) return;
  const dir = tmp('video-trim-');
  makeTestVideo(tools.ffmpeg, path.join(dir, 'clip.mp4'));
  const errs = (video) => {
    const spec = readJson(videoSpec(dir, video));
    return validateSpec(spec, { dir }).errors.map((e) => `${e.path}: ${e.message}`);
  };
  assert.deepEqual(errs({}), []);
  assert.deepEqual(errs({ trimEnd: 12 }), ['scenes[0].elements[0].trimEnd: trimEnd 12 exceeds the clip length 2s']);
  assert.deepEqual(errs({ trimStart: 1.5, trimEnd: 1 }), ['scenes[0].elements[0].trimStart: trimStart must be less than trimEnd']);
  assert.deepEqual(errs({ trimStart: 2 }), ['scenes[0].elements[0].trimStart: trimStart must be less than trimEnd'], 'trimEnd defaults to the clip length');
  assert.deepEqual(errs({ src: 'clip.gif' }), ['scenes[0].elements[0].src: file not found: clip.gif']);
  writeFileSync(path.join(dir, 'clip.gif'), 'GIF89a');
  assert.deepEqual(errs({ src: 'clip.gif' }), ['scenes[0].elements[0].src: unsupported video format ".gif"; use mp4, mov, webm or m4v']);
});

test('without ffprobe a spec with a video element gets one error that names the doctor fix', async (t) => {
  const tools = await requireRender(t, VIDEO_TOOLS);
  if (!tools) return;
  const dir = tmp('video-noprobe-');
  makeTestVideo(tools.ffmpeg, path.join(dir, 'clip.mp4'));
  const spec = { size: [320, 180], scenes: [{ id: 's', duration: 2, elements: [
    { id: 'a', type: 'video', x: 160, y: 90, src: 'clip.mp4', width: 320, height: 180 },
    { id: 'b', type: 'video', x: 160, y: 90, src: 'clip.mp4', width: 320, height: 180 },
  ] }] };
  const code = `const { validateSpec } = await import(${JSON.stringify(path.join(root, 'scripts/lib/spec.mjs'))});
    process.stdout.write(JSON.stringify(validateSpec(${JSON.stringify(spec)}, { dir: ${JSON.stringify(dir)} }).errors));`;
  const env = { ...process.env, PATH: tmp('video-nopath-'), FFMPEG_PATH: '', FFPROBE_PATH: '' };
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  const errors = JSON.parse(r.stdout);
  assert.equal(errors.length, 1, r.stdout);
  assert.equal(errors[0].path, 'scenes[0].elements[0].src');
  assert.match(errors[0].message, /^ffprobe not found \(needed to check video elements\); install ffmpeg: node .*doctor\.mjs --fix ffmpeg$/);
});

test('a 15 fps clip rendered at 10 fps: decodeFrames yields round((trimEnd-trimStart)*10) frames', async (t) => {
  const tools = await requireRender(t, VIDEO_TOOLS);
  if (!tools) return;
  const dir = tmp('video-decode-');
  const file = path.join(dir, 'clip.mp4');
  makeTestVideo(tools.ffmpeg, file, { fps: 15 });
  for (const [trimStart, trimEnd] of [[0, 2], [0.5, 2], [0.3, 1.25]]) {
    const out = path.join(dir, `frames-${trimStart}-${trimEnd}`);
    const { count } = decodeFrames(tools.ffmpeg, { file, trimStart, trimEnd, fps: 10, width: 320, height: 180, fit: 'contain', alpha: false, dir: out });
    const expected = Math.round((trimEnd - trimStart) * 10);
    assert.equal(count, expected, `${trimStart}-${trimEnd}`);
    assert.deepEqual(readdirSync(out).filter((f) => f.endsWith('.jpg')).length, expected);
    assert.ok(readdirSync(out).includes('done.json'));
  }
});

test('frameCacheKey changes with every input and is stable', () => {
  const base = { sha256: 'a'.repeat(64), trimStart: 0, trimEnd: 2, fps: 10, width: 320, height: 180, fit: 'contain', alpha: false, ffmpegVersion: 'ffmpeg version 8.1.1' };
  const key = frameCacheKey(base);
  assert.match(key, /^[0-9a-f]{64}$/);
  assert.equal(frameCacheKey({ ...base }), key);
  assert.equal(frameCacheKey(Object.fromEntries(Object.entries(base).reverse())), key, 'key order does not matter');
  const changed = { sha256: 'b'.repeat(64), trimStart: 0.5, trimEnd: 1.5, fps: 30, width: 640, height: 360, fit: 'cover', alpha: true, ffmpegVersion: 'ffmpeg version 7.1' };
  for (const [k, v] of Object.entries(changed)) assert.notEqual(frameCacheKey({ ...base, [k]: v }), key, k);
  // The cache format version is salted in: the same inputs keyed without it (the first cache layout) do not collide.
  const unsalted = createHash('sha256').update(JSON.stringify({ sha256: base.sha256, trimStart: 0, trimEnd: 2, fps: 10, width: 320, height: 180, fit: 'contain', alpha: false })).digest('hex');
  assert.notEqual(key, unsalted);
});

test('ffmpegVersion is the first line of ffmpeg -version, probed once per binary', async (t) => {
  const tools = await requireRender(t, VIDEO_TOOLS);
  if (!tools) return;
  assert.match(ffmpegVersion(tools.ffmpeg), /^ffmpeg version \S+/);
  assert.equal(ffmpegVersion(tools.ffmpeg), ffmpegVersion(tools.ffmpeg));
});

// The offline guarantee for media: a user file is only ever opened through the file (or pipe) protocol, so a playlist
// renamed to .mp4 or .mp3 cannot make ffmpeg fetch a URL or follow a reference out of the spec folder.
const WHITELIST = ['-protocol_whitelist', 'file,pipe'];
const whitelistedInput = (args, file) => {
  const i = args.findIndex((a, n) => a === '-i' && args[n + 1] === file);
  assert.ok(i >= 2, `no -i ${file} in ${args.join(' ')}`);
  assert.deepEqual(args.slice(i - 2, i), WHITELIST, `-i ${file} is not preceded by the whitelist: ${args.join(' ')}`);
};

test('every ffprobe and ffmpeg call that opens a user file allows only the file and pipe protocols', () => {
  const probe = probeArgs('/a/clip.mp4');
  assert.deepEqual(probe.slice(probe.indexOf('-protocol_whitelist'), probe.indexOf('-protocol_whitelist') + 2), WHITELIST);
  assert.ok(probe.indexOf('-protocol_whitelist') < probe.indexOf('/a/clip.mp4'));
  whitelistedInput(decodeArgs({ file: '/a/clip.mp4', trimStart: 0, trimEnd: 1, fps: 10, width: 32, height: 18, fit: 'contain', alpha: false, dir: '/c' }), '/a/clip.mp4');
  whitelistedInput(probeAudioArgs('/a/music.mp3'), '/a/music.mp3');
  const audio = [
    { file: '/a/music.mp3', start: 0, end: 2, volume: 1, fadeIn: 0, fadeOut: 0 },
    { file: '/a/clip.mp4', start: 0, end: 1, volume: 1, fadeIn: 0, fadeOut: 0, clipStart: 0.5 },
  ];
  for (const args of [encodeArgs({ fps: 10, out: 'o.mp4', audio, duration: 2 }), preflightArgs({ fps: 10, audio })]) {
    for (const { file } of audio) whitelistedInput(args, file);
  }
});

test('an HLS playlist named .mp4 is rejected with a clear error and no network request', async (t) => {
  const tools = await requireRender(t, VIDEO_TOOLS);
  if (!tools) return;
  let connections = 0;
  const listener = net.createServer((socket) => { connections++; socket.destroy(); });
  await new Promise((resolve) => { listener.listen(0, '127.0.0.1', resolve); });
  try {
    const dir = tmp('video-hls-');
    const playlist = `#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nhttp://127.0.0.1:${listener.address().port}/seg.ts\n#EXT-X-ENDLIST\n`;
    writeFileSync(path.join(dir, 'clip.mp4'), playlist);
    const errors = validateSpec(readJson(videoSpec(dir)), { dir }).errors.map((e) => `${e.path}: ${e.message}`);
    assert.equal(errors.length, 1, errors.join('\n'));
    assert.match(errors[0], /^scenes\[0\]\.elements\[0\]\.src: ffprobe cannot read clip\.mp4: /);
    assert.throws(() => prepareVideo(withDefaults(readJson(path.join(dir, 'motion.json'))), dir, tools.ffmpeg, tools.ffprobe, 10), /ffprobe cannot read clip\.mp4/);
    assert.throws(() => decodeFrames(tools.ffmpeg, { file: path.join(dir, 'clip.mp4'), trimStart: 0, trimEnd: 1, fps: 10, width: 32, height: 18, fit: 'contain', alpha: false, dir: path.join(dir, 'frames') }), /ffmpeg cannot decode/);
    // The playlist under its own name, so even a demuxer that sniffs by extension takes it as HLS: still no request.
    writeFileSync(path.join(dir, 'clip.m3u8'), playlist);
    assert.ok(probeVideo(tools.ffprobe, path.join(dir, 'clip.m3u8')).error);
    assert.equal(connections, 0, 'ffprobe or ffmpeg opened a network connection');
  } finally {
    listener.close();
  }
});

// A finished cache folder: done.json with { count } and frames 000001 to count.
function fakeCache(dir, count, { ext = 'jpg', done = { count } } = {}) {
  mkdirSync(dir, { recursive: true });
  for (let i = 1; i <= count; i++) writeFileSync(path.join(dir, `${String(i).padStart(6, '0')}.${ext}`), 'x');
  if (done !== null) writeFileSync(path.join(dir, 'done.json'), JSON.stringify(done));
}

test('readCache accepts only a whole decode: a positive integer count, and its first and last frames on disk', () => {
  const root = tmp('video-done-');
  const at = (name) => path.join(root, name);
  fakeCache(at('ok'), 3);
  assert.deepEqual(readCache(at('ok'), 'jpg'), { count: 3 });
  assert.equal(readCache(at('ok'), 'png'), null, 'frames of another format');
  fakeCache(at('none'), 3, { done: null });
  fakeCache(at('zero'), 0, { done: { count: 0 } });
  fakeCache(at('text'), 3, { done: { count: '3' } });
  fakeCache(at('frac'), 3, { done: { count: 2.5 } });
  fakeCache(at('short'), 2, { done: { count: 3 } });
  writeFileSync(at('junk.json'), '');
  fakeCache(at('bad'), 1);
  writeFileSync(path.join(at('bad'), 'done.json'), '{');
  rmSync(path.join(at('ok'), '000001.jpg'));
  for (const name of ['ok', 'none', 'zero', 'text', 'frac', 'short', 'bad', 'missing']) assert.equal(readCache(at(name), 'jpg'), null, name);
});

test('decodeFrames replaces an unfinished folder by renaming it aside, and never touches a finished one', async (t) => {
  const tools = await requireRender(t, VIDEO_TOOLS);
  if (!tools) return;
  const work = tmp('video-race-');
  const file = path.join(work, 'clip.mp4');
  makeTestVideo(tools.ffmpeg, file, { seconds: 1 });
  const opts = { file, trimStart: 0, trimEnd: 1, fps: 10, width: 32, height: 18, fit: 'contain', alpha: false };
  const dir = path.join(work, 'key');
  fakeCache(dir, 2, { done: null }); // a decode that died before done.json
  writeFileSync(path.join(dir, 'leftover'), 'x');
  assert.deepEqual(decodeFrames(tools.ffmpeg, { ...opts, dir }), { count: 10 });
  assert.deepEqual(readCache(dir, 'jpg'), { count: 10 });
  assert.equal(existsSync(path.join(dir, 'leftover')), false, 'the unfinished folder was replaced');
  // Another render finished this key first: its folder (which may be being served) stays exactly as it is.
  writeFileSync(path.join(dir, 'marker'), 'served');
  assert.deepEqual(decodeFrames(tools.ffmpeg, { ...opts, dir }), { count: 10 });
  assert.equal(readFileSync(path.join(dir, 'marker'), 'utf8'), 'served');
  assert.deepEqual(readdirSync(work).sort(), ['clip.mp4', 'key'], 'no .partial or .stale folder is left behind');
});

test('prepareVideo decodes again when the cached folder is damaged', async (t) => {
  const tools = await requireRender(t, VIDEO_TOOLS);
  if (!tools) return;
  const dir = tmp('video-damaged-');
  makeTestVideo(tools.ffmpeg, path.join(dir, 'clip.mp4'), { seconds: 1.3 }); // a length no other test uses: its own key
  const spec = withDefaults(readJson(videoSpec(dir, {}, { duration: 1.3 })));
  const { clip } = prepareVideo(spec, dir, tools.ffmpeg, tools.ffprobe, 10);
  const cache = path.join(CACHE_ROOT, clip.key);
  const last = path.join(cache, `${String(clip.count).padStart(6, '0')}.jpg`);
  rmSync(last);
  assert.deepEqual(prepareVideo(spec, dir, tools.ffmpeg, tools.ffprobe, 10), { clip });
  assert.ok(existsSync(last), 'the missing last frame is decoded again');
  writeFileSync(path.join(cache, 'done.json'), JSON.stringify({ count: 0 }));
  assert.deepEqual(prepareVideo(spec, dir, tools.ffmpeg, tools.ffprobe, 10), { clip });
  assert.deepEqual(readJson(path.join(cache, 'done.json')), { count: clip.count });
});

test('trackChain with clipStart 2 prepends atrim=start=2,asetpts=PTS-STARTPTS; without it the chain is unchanged', () => {
  const track = { file: 'a.mp4', start: 1, end: 3, volume: 1, fadeIn: 0, fadeOut: 0 };
  const graph = (t) => { const args = encodeArgs({ fps: 30, out: 'o.mp4', audio: [t], duration: 4 }); return args[args.indexOf('-filter_complex') + 1]; };
  const plain = graph(track);
  assert.equal(plain, '[1:a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=end=2,volume=1,adelay=1000:all=1[a0]');
  assert.equal(graph({ ...track, clipStart: 0 }), plain);
  assert.equal(graph({ ...track, clipStart: 2 }), '[1:a]atrim=start=2,asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo,atrim=end=2,volume=1,adelay=1000:all=1[a0]');
});

test('MP4 frame k matches cache frame k at PSNR >= 45 dB', async (t) => {
  const tools = await requireRender(t, RENDER_TOOLS);
  if (!tools) return;
  const dir = tmp('video-psnr-');
  makeTestVideo(tools.ffmpeg, path.join(dir, 'clip.mp4')); // movingbox: 10 px a frame, so an off-by-one drops PSNR below 20 dB
  const specPath = videoSpec(dir);
  const { out } = await renderHash(specPath, ['--fps', '10']);
  const spec = withDefaults(readJson(specPath));
  const { clip } = prepareVideo(spec, dir, tools.ffmpeg, tools.ffprobe, 10);
  assert.equal(clip.count, 20);
  const cache = path.join(CACHE_ROOT, clip.key);
  const average = psnr(tools.ffmpeg, ['-i', out, '-framerate', '10', '-i', path.join(cache, '%06d.jpg'), '-lavfi', '[0:v][1:v]psnr=shortest=1']);
  t.diagnostic(`PSNR MP4 vs cache: ${average} dB`);
  assert.ok(average >= 45, `PSNR ${average}`);
  const shifted = psnr(tools.ffmpeg, ['-i', out, '-framerate', '10', '-start_number', '2', '-i', path.join(cache, '%06d.jpg'), '-lavfi', '[0:v][1:v]psnr=shortest=1']);
  t.diagnostic(`PSNR one frame off: ${shifted} dB`);
  assert.ok(shifted < 30, `the fixture must show a one-frame shift (${shifted} dB)`);
});

test('MP4 frame k matches the source decoded independently, with trimStart 0.5 and a 15 fps source, at PSNR >= 40 dB', async (t) => {
  const tools = await requireRender(t, RENDER_TOOLS);
  if (!tools) return;
  const dir = tmp('video-source-');
  const clipFile = path.join(dir, 'clip.mp4');
  makeTestVideo(tools.ffmpeg, clipFile, { fps: 15 });
  const { out } = await renderHash(videoSpec(dir, { trimStart: 0.5 }, { duration: 1.5 }), ['--fps', '10']);
  // The reference shares no code with decodeFrames: no -ss, no -to, just the fps filter over the whole clip.
  const ref = tmp('video-ref-');
  const r = spawnSync(tools.ffmpeg, ['-v', 'error', '-i', clipFile, '-vf', 'fps=10', path.join(ref, 'src_%06d.png')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  // MP4 frame k (0-based) is source frame k + trimStart * fps = k + 5, which image2 numbers k + 6 (1-based).
  const average = psnr(tools.ffmpeg, ['-i', out, '-framerate', '10', '-start_number', '6', '-i', path.join(ref, 'src_%06d.png'), '-lavfi', '[0:v][1:v]psnr=shortest=1']);
  t.diagnostic(`PSNR MP4 vs independent source decode: ${average} dB`);
  assert.ok(average >= 40, `PSNR ${average}`);
  const shifted = psnr(tools.ffmpeg, ['-i', out, '-framerate', '10', '-start_number', '7', '-i', path.join(ref, 'src_%06d.png'), '-lavfi', '[0:v][1:v]psnr=shortest=1']);
  t.diagnostic(`PSNR one frame off: ${shifted} dB`);
  assert.ok(shifted < 30, `a one-frame shift must show (${shifted} dB)`);
});

// The page, in render mode with the frames prepared as render.mjs prepares them: a screenshot per scene time.
async function pageShots(specPath, dir, tools, times) {
  const spec = withDefaults(readJson(specPath));
  const videoFrames = prepareVideo(spec, dir, tools.ffmpeg, tools.ffprobe, 10);
  const server = await startServer({ specPath, mode: 'render', videoFrames });
  const browser = await launchBrowser({ quiet: true });
  try {
    const page = await browser.newPage({ viewport: { width: 320, height: 180 }, deviceScaleFactor: 1 });
    await page.goto(server.url);
    await page.waitForFunction(() => window.__motion);
    await page.evaluate(() => window.__motion.ready);
    const shots = {};
    for (const sec of times) {
      await page.evaluate((s) => window.__motion.seek(s), sec);
      const src = await page.evaluate(() => document.querySelector('.el.video img').getAttribute('src'));
      shots[sec] = { src, png: await page.screenshot({ type: 'png' }) };
    }
    return shots;
  } finally {
    await browser.close();
    await server.close();
  }
}

test('a 1.5 s movingbox clip in a 2 s scene holds its last frame: frames at 1.6 s and 1.9 s equal the frame at 1.4 s, and differ from the frame at 1.0 s', async (t) => {
  const tools = await requireRender(t, RENDER_TOOLS);
  if (!tools) return;
  const dir = tmp('video-hold-');
  makeTestVideo(tools.ffmpeg, path.join(dir, 'clip.mp4'), { seconds: 1.5 });
  const shots = await pageShots(videoSpec(dir), dir, tools, [0, 1.0, 1.4, 1.6, 1.9]);
  assert.match(shots[0].src, /\/000001\.jpg$/);
  assert.match(shots[1.4].src, /\/000015\.jpg$/, 'the last of 15 frames');
  assert.equal(shots[1.6].src, shots[1.4].src);
  assert.equal(shots[1.9].src, shots[1.4].src);
  assert.ok(shots[1.6].png.equals(shots[1.4].png), 'the held frame is drawn identically');
  assert.ok(shots[1.9].png.equals(shots[1.4].png));
  assert.ok(!shots[1.0].png.equals(shots[1.4].png), 'the box has moved between 1.0 s and 1.4 s');
});

test('a clip whose scene crossfades out freezes on its last in-scene frame under the incoming scene', async (t) => {
  const tools = await requireRender(t, RENDER_TOOLS);
  if (!tools) return;
  const dir = tmp('video-crossfade-');
  makeTestVideo(tools.ffmpeg, path.join(dir, 'clip.mp4')); // 2 s, longer than its 1 s scene
  const specPath = path.join(dir, 'motion.json');
  writeFileSync(specPath, JSON.stringify({ size: [320, 180], fps: 30, scenes: [
    { id: 'a', duration: 1, elements: [{ id: 'clip', type: 'video', x: 160, y: 90, src: 'clip.mp4', width: 320, height: 180 }] },
    { id: 'b', duration: 1, transition: 'crossfade', elements: [{ id: 'note', type: 'text', text: 'next', x: 160, y: 40, fontSize: 24 }] },
  ] }));
  const shots = await pageShots(specPath, dir, tools, [0.9, 1.0, 1.2, 1.3]);
  assert.match(shots[0.9].src, /\/000010\.jpg$/, 'the last frame scene "a" renders (t = 0.9 s at 10 fps)');
  for (const sec of [1.0, 1.2, 1.3]) assert.equal(shots[sec].src, shots[0.9].src, `${sec} s, during the crossfade`);
});

test('offset holds the first frame until playback starts', async (t) => {
  const tools = await requireRender(t, RENDER_TOOLS);
  if (!tools) return;
  const dir = tmp('video-offset-');
  makeTestVideo(tools.ffmpeg, path.join(dir, 'clip.mp4'), { seconds: 1 });
  const shots = await pageShots(videoSpec(dir, { offset: 0.5 }), dir, tools, [0, 0.4, 0.5, 0.8]);
  assert.match(shots[0].src, /\/000001\.jpg$/);
  assert.match(shots[0.4].src, /\/000001\.jpg$/);
  assert.match(shots[0.5].src, /\/000001\.jpg$/);
  assert.match(shots[0.8].src, /\/000004\.jpg$/);
});

test('preview mode seeks a muted <video> to trimStart + (scene time - offset), held inside the trimmed range', async (t) => {
  const tools = await requireRender(t, RENDER_TOOLS);
  if (!tools) return;
  const dir = tmp('video-preview-');
  makeTestVideo(tools.ffmpeg, path.join(dir, 'clip.mp4'));
  const server = await startServer({ specPath: videoSpec(dir, { trimStart: 0.5, trimEnd: 1.5, offset: 0.25 }), mode: 'preview' });
  const browser = await launchBrowser({ quiet: true });
  try {
    const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
    await page.goto(server.url);
    await page.waitForFunction(() => window.__motion?.seek);
    await page.evaluate(() => window.__motion.ready);
    const at = (sec) => page.evaluate((s) => { window.__motion.seek(s); const v = document.querySelector('.el.video video'); return { time: v.currentTime, muted: v.muted }; }, sec);
    assert.deepEqual(await at(0), { time: 0.5, muted: true }, 'before the offset: the first frame of the range');
    assert.equal((await at(1)).time, 1.25);
    assert.equal((await at(1.9)).time, 1.5, 'after the range: its last frame');
  } finally {
    await browser.close();
    await server.close();
  }
});

test('a video element without mute adds one AAC-mixed track; with mute the MP4 has no audio stream', async (t) => {
  const tools = await requireRender(t, RENDER_TOOLS);
  if (!tools) return;
  const dir = tmp('video-audio-');
  makeTestVideo(tools.ffmpeg, path.join(dir, 'clip.mp4'), { audio: true });
  const loud = await renderHash(videoSpec(dir), ['--fps', '10']);
  const audio = streams(tools.ffprobe, loud.out).filter((s) => s.codec_type === 'audio');
  assert.equal(audio.length, 1);
  assert.equal(audio[0].codec_name, 'aac');
  assert.match(loud.stdout, /^audio: .* LUFS integrated/m);
  const muted = await renderHash(videoSpec(dir, { mute: true }), ['--fps', '10']);
  assert.deepEqual(streams(tools.ffprobe, muted.out).map((s) => s.codec_type), ['video']);
  // trimStart reaches the mix as clipStart: ffmpeg accepts the atrim=start chain and the track still plays.
  const trimmed = await renderHash(videoSpec(dir, { trimStart: 0.5 }, { duration: 1.5 }), ['--fps', '10']);
  assert.equal(streams(tools.ffprobe, trimmed.out).filter((s) => s.codec_type === 'audio').length, 1);
  assert.match(trimmed.stdout, /^audio: -?\d+\.\d LUFS integrated/m, 'the trimmed clip is not silent');
});

test('a clip longer than its scene is silent once the scene ends: its track is cut at the scene end', async (t) => {
  const tools = await requireRender(t, RENDER_TOOLS);
  if (!tools) return;
  const dir = tmp('video-scene-end-');
  makeTestVideo(tools.ffmpeg, path.join(dir, 'clip.mp4'), { audio: true }); // 2 s of 440 Hz
  const specPath = path.join(dir, 'motion.json');
  const clip = { id: 'clip', type: 'video', x: 160, y: 90, src: 'clip.mp4', width: 320, height: 180, offset: 0.25 };
  writeFileSync(specPath, JSON.stringify({ size: [320, 180], fps: 30, scenes: [
    { id: 'a', duration: 1, elements: [clip] },
    { id: 'b', duration: 1.5, elements: [{ id: 'note', type: 'text', text: 'next', x: 160, y: 90, fontSize: 24 }] },
  ] }));
  const [track] = videoAudioTracks(withDefaults(readJson(specPath)), dir, tools.ffprobe, 2.5);
  assert.deepEqual({ start: track.start, end: track.end }, { start: 0.25, end: 1 }, 'cut at the end of scene "a", not 0.25 + 2 s');
  const { out } = await renderHash(specPath, ['--fps', '10']);
  const level = (from, to) => {
    const r = spawnSync(tools.ffmpeg, ['-hide_banner', '-ss', String(from), '-to', String(to), '-i', out, '-map', '0:a:0', '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    // ffmpeg may print an empty report for a first filter-graph instance; the last report is the measurement. No samples
    // at all means the mix has already ended: silence.
    if ([...r.stderr.matchAll(/n_samples: (\d+)/g)].at(-1)?.[1] === '0') return -Infinity;
    const m = /max_volume: (-?[\d.]+|-inf) dB/.exec(r.stderr);
    assert.ok(m, r.stderr);
    return m[1] === '-inf' ? -Infinity : Number(m[1]);
  };
  const during = level(0.4, 0.9);
  const after = level(1.1, 2.4);
  const [audio] = streams(tools.ffprobe, out).filter((s) => s.codec_type === 'audio');
  t.diagnostic(`max volume: ${during} dB during the clip's scene, ${after} dB after it; audio stream ${audio.duration} s`);
  assert.ok(during > -30, `the clip is heard in its scene (${during} dB)`);
  assert.ok(after < -80, `nothing after the scene ends (${after} dB)`);
  assert.ok(Number(audio.duration) < 1.1, `the mix ends with scene "a" (${audio.duration} s)`);
});

test('footage-intro renders byte-identical twice', async (t) => {
  const tools = await requireRender(t, RENDER_TOOLS);
  if (!tools) return;
  const hash = await assertRendersIdentically(t, FOOTAGE_INTRO, SMALL);
  // Decoding is deterministic too: with the cache cleared (as doctor --fix cache does), the next render matches.
  const { clip } = prepareVideo(withDefaults(readJson(FOOTAGE_INTRO)), path.dirname(FOOTAGE_INTRO), tools.ffmpeg, tools.ffprobe, 10);
  rmSync(path.join(CACHE_ROOT, clip.key), { recursive: true, force: true });
  assert.equal((await renderHash(FOOTAGE_INTRO, SMALL)).sha256, hash, 'a fresh decode renders the same bytes');
});

test('doctor: the frame cache passes under 2 GB and is listed past it, naming its size and the fix', async () => {
  const skillDir = tmp('video-doctor-');
  const req = videoCache();
  const ctx = { skillDir, platform: process.platform };
  assert.equal(req.required, false);
  assert.equal(await req.check(ctx), true, 'no cache folder at all');
  mkdirSync(path.join(skillDir, '.cache/video/k'), { recursive: true });
  const big = path.join(skillDir, '.cache/video/k/000001.jpg');
  writeFileSync(big, '');
  truncateSync(big, CACHE_LIMIT_BYTES - 1); // sparse: no real disk is used
  assert.equal(await req.check(ctx), true);
  truncateSync(big, CACHE_LIMIT_BYTES);
  assert.equal(await req.check(ctx), false);
  assert.equal(req.why(ctx), 'video frame cache is 2.0 GB; --fix cache clears it');
});

test('doctor --fix cache deletes the frame cache even while it is under the limit', () => {
  // A copy with only the doctor, its requirements and shared/: the cache folder is the copy's own.
  const skill = path.join(tmp('video-fix-'), 'make-motion');
  cpSync(path.join(root, 'shared'), path.join(skill, 'shared'), { recursive: true });
  mkdirSync(path.join(skill, 'scripts/lib'), { recursive: true });
  for (const f of ['scripts/doctor.mjs', 'scripts/lib/requirements.mjs']) copyFileSync(path.join(root, f), path.join(skill, f));
  mkdirSync(path.join(skill, '.cache/video/k'), { recursive: true });
  writeFileSync(path.join(skill, '.cache/video/k/000001.jpg'), 'x');
  const r = spawnSync(process.execPath, [path.join(skill, 'scripts/doctor.mjs'), '--fix', 'cache', '--json'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(JSON.parse(r.stdout)[0].ok, true, r.stdout);
  assert.equal(existsSync(path.join(skill, '.cache/video')), false);
  assert.equal(existsSync(path.join(skill, '.cache')), true, 'only the video cache goes');
});

test('preview mode serves the clip under /assets with byte ranges and the render page under /frames/<key>/000001.jpg; an unknown key is 404', async (t) => {
  const tools = await requireRender(t, VIDEO_TOOLS);
  if (!tools) return;
  const dir = tmp('video-serve-');
  makeTestVideo(tools.ffmpeg, path.join(dir, 'clip.mp4'));
  const specPath = videoSpec(dir);
  const preview = await startServer({ specPath, mode: 'preview' });
  try {
    const part = await fetch(new URL('/assets/clip.mp4', preview.url), { headers: { range: 'bytes=0-9' } });
    assert.equal(part.status, 206);
    assert.equal(part.headers.get('content-type'), 'video/mp4');
    assert.equal(part.headers.get('accept-ranges'), 'bytes');
    assert.equal((await part.arrayBuffer()).byteLength, 10);
    assert.deepEqual(await (await fetch(new URL('/frames.json', preview.url))).json(), {}, 'preview prepares no frames');
  } finally {
    await preview.close();
  }
  const spec = withDefaults(readJson(specPath));
  const videoFrames = prepareVideo(spec, dir, tools.ffmpeg, tools.ffprobe, 10);
  const render = await startServer({ specPath, mode: 'render', videoFrames });
  try {
    const { key } = videoFrames.clip;
    assert.deepEqual(await (await fetch(new URL('/frames.json', render.url))).json(), videoFrames);
    const frame = await fetch(new URL(`/frames/${key}/000001.jpg`, render.url));
    assert.equal(frame.status, 200);
    assert.equal(frame.headers.get('content-type'), 'image/jpeg');
    assert.equal((await fetch(new URL(`/frames/${'0'.repeat(64)}/000001.jpg`, render.url))).status, 404);
    assert.equal((await fetch(new URL(`/frames/${key}/done.json`, render.url))).status, 404);
    assert.equal((await fetch(new URL(`/frames/${key}/999999.jpg`, render.url))).status, 404);
    assert.equal((await fetch(new URL(`/frames/${key}/000001.png`, render.url))).status, 404, 'only the extension the key was decoded to');
  } finally {
    await render.close();
  }
});
