// Task 28: cutouts on demand. scripts/cutout.mjs runs MODNet on onnxruntime-node (installed on demand, never by `npm ci`) and writes
// an RGBA PNG or an alpha WebM that the text-behind-subject block draws over the text. Tests that need onnxruntime-node and the
// downloaded weights skip without them, unless PA_REQUIRE_CUTOUT=1 (then a missing piece is a failure).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { UsageError } from '../scripts/lib/spec.mjs';
import {
  MODEL_URL, MODEL_SHA256, MODEL_BYTES, MODEL_FILE, MODEL_DIR, INSTALL_HINT, USAGE,
  parseCutoutArgs, modelSize, ensureModel, loadOnnx, fileKind,
} from '../scripts/lib/cutout.mjs';
import { probeVideo, decodeFrames, decodeArgs } from '../scripts/lib/video.mjs';
import { findFfmpeg, findFfprobe } from '../scripts/lib/ffmpeg.mjs';
import { requireRender, BROWSER_ONLY } from './helpers/render.mjs';
import { drawPortrait, alphaAt } from './helpers/portrait.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(root, 'scripts/cutout.mjs');
const made = [];
const tmp = (prefix) => { const d = mkdtempSync(path.join(tmpdir(), prefix)); made.push(d); return d; };
process.on('exit', () => { for (const d of made) rmSync(d, { recursive: true, force: true }); });

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
const hasOrt = existsSync(path.join(root, 'node_modules/onnxruntime-node'));
const hasModel = existsSync(path.join(MODEL_DIR, MODEL_FILE));

/** True when the model test can run; false (after t.skip) when a piece is absent and PA_REQUIRE_CUTOUT is not 1. */
function haveCutout(t) {
  if (hasOrt && hasModel) return true;
  const missing = [...(hasOrt ? [] : ['onnxruntime-node']), ...(hasModel ? [] : [`the MODNet weights in ${MODEL_DIR}`])].join(' and ');
  if (process.env.PA_REQUIRE_CUTOUT === '1') throw new Error(`PA_REQUIRE_CUTOUT=1 but ${missing} is missing; run the doctor: --fix cutout, then cutout.mjs once`);
  t.skip(`${missing} is missing`);
  return false;
}

// ---- the model constants ----------------------------------------------------------------------------------------------

test('the model constants: a commit-pinned https URL, a sha256, the byte size and the file name', () => {
  assert.match(MODEL_URL, /^https:\/\/huggingface\.co\/Xenova\/modnet\/resolve\/[0-9a-f]{40}\/onnx\/model\.onnx$/, 'pinned to a commit, not "main"');
  assert.match(MODEL_SHA256, /^[0-9a-f]{64}$/);
  assert.equal(MODEL_FILE, 'modnet_photographic_portrait_matting.onnx');
  assert.ok(Number.isInteger(MODEL_BYTES) && MODEL_BYTES > 1e6);
  assert.equal(path.relative(root, MODEL_DIR), path.join('.cache', 'models', 'modnet'));
});

test('when the weights are in the cache their bytes match MODEL_SHA256 and MODEL_BYTES', (t) => {
  if (!hasModel) { t.skip('the weights are not downloaded'); return; }
  const bytes = readFileSync(path.join(MODEL_DIR, MODEL_FILE));
  assert.equal(bytes.length, MODEL_BYTES);
  assert.equal(sha256(bytes), MODEL_SHA256);
});

// ---- arguments ---------------------------------------------------------------------------------------------------------

test('parseCutoutArgs: a photo or a clip, --out and --fps; everything else is a usage error that lists what is accepted', () => {
  const photo = parseCutoutArgs(['shots/a.png']);
  assert.equal(photo.kind, 'image');
  assert.equal(photo.input, path.resolve('shots/a.png'));
  assert.equal(photo.out, path.resolve('shots/cutout'), 'next to the photo, in a cutout folder, so the original is never overwritten');
  assert.equal(photo.fps, null);
  const clip = parseCutoutArgs(['clip.MP4', '--out', 'o', '--fps', '12']);
  assert.deepEqual([clip.kind, clip.out, clip.fps], ['video', path.resolve('o'), 12]);
  for (const [argv, message] of [
    [[], USAGE],
    [['a.png', 'b.png'], /exactly one input/],
    [['--nope', 'a.png'], /unknown option --nope; accepted: --out, --fps/],
    [['a.png', '--out'], /--out needs a value/],
    [['a.gif'], /\.gif is not a photo or a clip; photos: .*png.*; clips: .*mp4/],
    [['noext'], /not a photo or a clip/],
    [['a.mp4', '--fps', '0'], /--fps must be a whole number from 1 to 60/],
    [['a.mp4', '--fps', '60.5'], /--fps must be a whole number from 1 to 60/],
    [['a.png', '--fps', '12'], /--fps is for clips/],
  ]) {
    assert.throws(() => parseCutoutArgs(argv), (e) => e instanceof UsageError && (message instanceof RegExp ? message.test(e.message) : e.message === message), JSON.stringify(argv));
  }
  assert.throws(() => parseCutoutArgs(['a/shot.png', '--out', 'a']), /--out would overwrite the input/);
});

test('fileKind: photos and clips by extension, anything else null', () => {
  assert.deepEqual(['a.png', 'a.JPG', 'a.jpeg', 'a.webp', 'a.mp4', 'a.mov', 'a.webm', 'a.m4v', 'a.gif', 'a'].map(fileKind), ['image', 'image', 'image', 'image', 'video', 'video', 'video', 'video', null, null]);
});

test('modelSize follows MODNet: the short side becomes 512 unless the picture is already near it, both sides a multiple of 32', () => {
  assert.deepEqual(modelSize(1920, 1080), [896, 512]);
  assert.deepEqual(modelSize(1080, 1920), [512, 896]);
  assert.deepEqual(modelSize(512, 512), [512, 512]);
  assert.deepEqual(modelSize(64, 64), [512, 512], 'small pictures are scaled up');
  assert.deepEqual(modelSize(700, 600), [576, 512], 'both sides above 512: the short side becomes 512');
  assert.deepEqual(modelSize(700, 400), [672, 384], 'one side each way of 512: left alone, then rounded down to 32');
  const [w, h] = modelSize(4000, 3000);
  assert.deepEqual([w % 32, h % 32], [0, 0]);
});

// ---- the weights: downloaded once, verified before use ------------------------------------------------------------------

const BYTES = Buffer.from('not really an onnx file');
const goodOpts = (dir, fetchImpl) => ({ url: 'https://example.invalid/m.onnx', sha256: sha256(BYTES), bytes: BYTES.length, dir, fetchImpl });
const answer = (body, init = {}) => async () => new Response(body, { status: 200, ...init });

test('ensureModel downloads once, verifies the sha256, and never fetches again when the file is good', async () => {
  const dir = tmp('cutout-model-');
  let calls = 0;
  const fetchImpl = async (url) => { calls++; assert.equal(url, 'https://example.invalid/m.onnx'); return new Response(BYTES); };
  const file = await ensureModel(goodOpts(dir, fetchImpl));
  assert.equal(file, path.join(dir, MODEL_FILE));
  assert.deepEqual(readFileSync(file), BYTES);
  assert.deepEqual(readdirSync(dir), [MODEL_FILE], 'no partial file left behind');
  assert.equal(await ensureModel(goodOpts(dir, fetchImpl)), file);
  assert.equal(calls, 1);
});

test('ensureModel refuses bytes that do not match the sha256 (nothing is kept), and replaces a damaged cached file', async () => {
  const dir = tmp('cutout-model-');
  await assert.rejects(() => ensureModel(goodOpts(dir, answer('x'.repeat(BYTES.length)))), /sha256 mismatch.*expected [0-9a-f]{64}.*got [0-9a-f]{64}/s);
  assert.deepEqual(readdirSync(dir), [], 'a download that fails the check is deleted');
  writeFileSync(path.join(dir, MODEL_FILE), 'corrupt');
  const file = await ensureModel(goodOpts(dir, answer(BYTES)));
  assert.deepEqual(readFileSync(file), BYTES);
});

test('ensureModel names the URL and the fix when the download fails or is far bigger than expected', async () => {
  const dir = tmp('cutout-model-');
  await assert.rejects(() => ensureModel(goodOpts(dir, async () => new Response('no', { status: 503 }))), /download failed: HTTP 503 from https:\/\/example\.invalid\/m\.onnx/);
  await assert.rejects(() => ensureModel(goodOpts(dir, async () => { throw new TypeError('fetch failed'); })), /download failed: fetch failed.*https:\/\/example\.invalid\/m\.onnx/s);
  await assert.rejects(() => ensureModel(goodOpts(dir, answer(Buffer.alloc(BYTES.length * 3)))), /larger than the expected/);
  assert.deepEqual(readdirSync(dir), []);
});

// ---- onnxruntime-node is optional ----------------------------------------------------------------------------------------

test('loadOnnx turns a missing onnxruntime-node into a UsageError that carries the install command and the doctor id', async () => {
  const missing = async () => { throw Object.assign(new Error("Cannot find package 'onnxruntime-node' imported from x"), { code: 'ERR_MODULE_NOT_FOUND' }); };
  await assert.rejects(() => loadOnnx(missing), (e) => e instanceof UsageError && e.message === INSTALL_HINT);
  assert.match(INSTALL_HINT, /npm install onnxruntime-node@\d+\.\d+\.\d+ --no-save/);
  assert.doesNotMatch(INSTALL_HINT, /--prefix/);
  assert.match(INSTALL_HINT, /doctor\.mjs.* --for cutout, id cutout\)/);
  assert.match(INSTALL_HINT, /25 MB/);
  const other = async () => { throw new Error('boom'); };
  await assert.rejects(() => loadOnnx(other), /boom/, 'any other failure passes through');
  const ok = await loadOnnx(async () => ({ default: { InferenceSession: 1 } }));
  assert.deepEqual(ok, { InferenceSession: 1 });
});

test('cutout.mjs: no arguments and unknown options exit 2 with the usage; a missing file exits 2 before anything is loaded', () => {
  const none = cli();
  assert.equal(none.status, 2);
  assert.equal(none.stderr, `${USAGE}\n`);
  const unknown = cli('a.png', '--nope');
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /^unknown option --nope; accepted: --out, --fps\nusage: /);
  const absent = cli(path.join(tmp('cutout-none-'), 'nobody.png'));
  assert.equal(absent.status, 2);
  assert.match(absent.stderr, /^cannot read .*nobody\.png/);
});

test('without onnxruntime-node installed, cutout.mjs exits 2 with the install command (a machine with it installed skips this)', async (t) => {
  if (hasOrt) { t.skip('onnxruntime-node is installed here'); return; }
  const dir = tmp('cutout-noort-');
  writeFileSync(path.join(dir, 'p.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
  const r = cli(path.join(dir, 'p.png'));
  assert.equal(r.status, 2);
  assert.equal(r.stderr.trim().split('\n')[0], INSTALL_HINT);
});

// ---- the cutout itself -------------------------------------------------------------------------------------------------

test('a drawn portrait cut out: alpha is above 0.9 on the face and below 0.1 in a corner, and the original is untouched', async (t) => {
  if (!haveCutout(t) || !(await requireRender(t, BROWSER_ONLY))) return;
  const dir = tmp('cutout-img-');
  const photo = path.join(dir, 'portrait.png');
  const png = await drawPortrait({ width: 960, height: 540 });
  writeFileSync(photo, png);
  const r = cli(photo, '--out', path.join(dir, 'out'));
  assert.equal(r.status, 0, r.stderr);
  const out = path.join(dir, 'out', 'portrait.png');
  assert.equal(r.stdout, `${out}\n`);
  assert.deepEqual(readFileSync(photo), png, 'the original photo is not rewritten');
  const [face, shoulder, corner, farCorner] = await alphaAt(readFileSync(out), [[480, 230], [480, 520], [6, 6], [953, 6]]);
  assert.ok(face > 0.9, `alpha on the face is ${face}`);
  assert.ok(shoulder > 0.9, `alpha on the shoulders is ${shoulder}`);
  assert.ok(corner < 0.1 && farCorner < 0.1, `alpha in the corners is ${corner} and ${farCorner}`);
});

test('a clip is cut out into a VP9 alpha WebM that probes as alpha and decodes with its alpha; the frame cache is reused', async (t) => {
  if (!haveCutout(t) || !(await requireRender(t))) return;
  const ffmpeg = await findFfmpeg();
  const dir = tmp('cutout-vid-');
  const photo = path.join(dir, 'portrait.png');
  writeFileSync(photo, await drawPortrait({ width: 640, height: 360 }));
  const clip = path.join(dir, 'clip.mp4');
  const made = spawnSync(ffmpeg, ['-v', 'error', '-y', '-loop', '1', '-i', photo, '-t', '0.5', '-r', '6', '-pix_fmt', 'yuv420p', clip], { encoding: 'utf8' });
  assert.equal(made.status, 0, made.stderr);
  const r = cli(clip, '--out', path.join(dir, 'out'), '--fps', '6');
  assert.equal(r.status, 0, r.stderr);
  const out = path.join(dir, 'out', 'clip.webm');
  assert.equal(r.stdout, `${out}\n`);
  const probe = probeVideo(findFfprobe({ ffmpeg }), out);
  assert.equal(probe.hasAlpha, true, 'a VP9 alpha stream says yuv420p; alpha_mode tells');
  assert.equal(probe.width, 640);
  const frames = path.join(dir, 'frames');
  const { count } = decodeFrames(ffmpeg, { file: out, trimStart: 0, trimEnd: probe.duration, fps: 6, width: 640, height: 360, fit: 'contain', alpha: true, dir: frames, decoder: probe.alphaDecoder });
  assert.ok(count >= 2, `${count} frames`);
  const [face, corner] = await alphaAt(readFileSync(path.join(frames, '000001.png')), [[320, 150], [4, 4]]);
  assert.ok(face > 0.9 && corner < 0.1, `alpha ${face} on the face, ${corner} in the corner`);
  const again = cli(clip, '--out', path.join(dir, 'out2'), '--fps', '6');
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stderr, /reusing/, 'the alpha frames of the same clip, fps and weights come from .cache/cutout');
});

// ---- video.mjs: VP9 alpha ------------------------------------------------------------------------------------------------

test('video.mjs: a VP9 alpha WebM probes as alpha (pix_fmt says yuv420p, alpha_mode says 1) and decodes to PNGs with alpha; an ordinary clip is unchanged', async (t) => {
  const tools = await requireRender(t, { need: ['ffmpeg', 'ffprobe'] });
  if (!tools) return;
  const dir = tmp('cutout-alpha-');
  const webm = path.join(dir, 'a.webm');
  const make = (args) => spawnSync(tools.ffmpeg, ['-v', 'error', '-y', ...args], { encoding: 'utf8' });
  assert.equal(make(['-f', 'lavfi', '-i', 'color=c=red@0.5:s=64x64:r=10:d=0.4,format=rgba', '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0', webm]).status, 0);
  const info = probeVideo(tools.ffprobe, webm);
  assert.equal(info.hasAlpha, true);
  assert.equal(info.alphaDecoder, 'libvpx-vp9');
  const frames = path.join(dir, 'f');
  decodeFrames(tools.ffmpeg, { file: webm, trimStart: 0, trimEnd: info.duration, fps: 10, width: 64, height: 64, fit: 'contain', alpha: info.hasAlpha, dir: frames, decoder: info.alphaDecoder });
  const probePng = spawnSync(tools.ffprobe, ['-v', 'error', '-show_entries', 'stream=pix_fmt', '-of', 'csv=p=0', path.join(frames, '000001.png')], { encoding: 'utf8' });
  assert.equal(probePng.stdout.trim(), 'rgba');
  const mp4 = path.join(dir, 'a.mp4');
  assert.equal(make(['-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=10:d=0.4', '-pix_fmt', 'yuv420p', mp4]).status, 0);
  const plain = probeVideo(tools.ffprobe, mp4);
  assert.deepEqual([plain.hasAlpha, plain.alphaDecoder], [false, undefined]);
  const args = { file: '/a/clip.mp4', trimStart: 0, trimEnd: 1, fps: 10, width: 32, height: 18, fit: 'contain', alpha: false, dir: '/c' };
  assert.ok(!decodeArgs(args).includes('-c:v'), 'no decoder flag for a clip without one: the argument array is as before');
  const withDecoder = decodeArgs({ ...args, alpha: true, decoder: 'libvpx-vp9' });
  assert.ok(withDecoder.join(' ').includes('-c:v libvpx-vp9 -protocol_whitelist'), 'the decoder comes before the input');
});

// ---- the install path is one command everywhere ---------------------------------------------------------------------------

test('audit-on-demand-deps.sh audits every on-demand pin the doctor owns (the audit itself runs in CI weekly and by hand: it needs the registry)', () => {
  const script = readFileSync(path.resolve(root, '../../../../scripts/audit-on-demand-deps.sh'), 'utf8');
  assert.match(script, /KOKORO_PIN/);
  assert.match(script, /CUTOUT_PIN/);
  assert.match(script, /for pin in /, 'one loop over the pins');
});
