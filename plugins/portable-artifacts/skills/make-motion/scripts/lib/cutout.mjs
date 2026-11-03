// Cutouts: a person lifted out of a photo or a clip with MODNet (Apache-2.0) on onnxruntime-node (MIT), run locally on the CPU.
// onnxruntime-node is installed on demand (`doctor --fix cutout`), never by `npm ci`; the weights download once, on first use,
// into <skill>/.cache/models/modnet/ and are checked against MODEL_SHA256 before every use. The image is decoded, shrunk,
// enlarged and re-encoded on a Playwright page canvas (no sharp); only the matte comes from the model.
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { UsageError } from './spec.mjs';
import { doctorCommand, npmInstallCutout } from './doctor-hint.mjs';
import { VIDEO_EXTENSIONS } from '../../template/media.mjs';
import { fileInput } from './ffmpeg.mjs';
import { fileSha256 } from './video.mjs';

const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// The weights are MODNet's photographic portrait matting checkpoint (https://github.com/ZHKKKe/MODNet, Apache-2.0) as ONNX.
// Xenova/modnet (Apache-2.0 on Hugging Face) serves them as onnx/model.onnx, pinned here to one commit; those bytes are
// identical (same sha256) to modnet_photographic_portrait_matting.onnx in PotterWhite/AlphaMattingModels.
export const MODEL_URL = 'https://huggingface.co/Xenova/modnet/resolve/fa2fa546052fba4c08921230a26cc69a333fca12/onnx/model.onnx';
export const MODEL_SHA256 = '07c308cf0fc7e6e8b2065a12ed7fc07e1de8febb7dc7839d7b7f15dd66584df9';
export const MODEL_BYTES = 25888640; // 24.7 MiB, "25 MB" in the docs
export const MODEL_FILE = 'modnet_photographic_portrait_matting.onnx';
export const MODEL_DIR = path.join(SKILL_ROOT, '.cache', 'models', 'modnet');
export const CUTOUT_CACHE = path.join(SKILL_ROOT, '.cache', 'cutout'); // gitignored; the alpha frames of a clip, keyed by its hash

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'];
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
const REF_SIZE = 512; // MODNet's reference size for the short side
const MULTIPLE = 32; // the network wants sides that are a multiple of this
const MAX_SIDE = 8192; // px; a bigger picture is refused rather than held in a canvas
const MAX_FPS = 60;
const DEFAULT_FPS_CAP = 30;
export const MAX_FRAMES = 900; // one run: 30 s at 30 fps
const DOWNLOAD_SLACK = 2; // a download this many times the expected size is refused
const MIN_FPS = 1;
const CACHE_VERSION = 1; // salted into every cutout cache key; bump it when the matte or the folder layout changes
const DONE = 'done.json';

export const USAGE = 'usage: node scripts/cutout.mjs <photo.png|clip.mp4> [--out <dir>] [--fps n]';
export const INSTALL_HINT = `onnxruntime-node is not installed. Run: ${npmInstallCutout()}`
  + ' (about 300 MB; the MODNet weights, 25 MB, download once on first use; '
  + `doctor: ${doctorCommand('--for', 'cutout')}, id cutout)`;

const firstLine = (e) => String(e?.message ?? e).split('\n')[0];
const extOf = (file) => path.extname(file).slice(1).toLowerCase();

/** 'image' or 'video' by extension, else null. */
export function fileKind(file) {
  const ext = extOf(file);
  if (IMAGE_EXTENSIONS.includes(ext)) return 'image';
  return VIDEO_EXTENSIONS.includes(ext) ? 'video' : null;
}

/** Where the cutout of `input` goes in folder `out`: <stem>.png for a photo, <stem>.webm for a clip. */
export const outputFile = (input, out, kind) => path.join(out, `${path.basename(input, path.extname(input))}.${kind === 'image' ? 'png' : 'webm'}`);

function takeValue(argv, i, flag) {
  const value = argv[i + 1];
  if (value === undefined || value.startsWith('--')) throw new UsageError(`${flag} needs a value`);
  return value;
}

// The same file by identity, not by spelling: a case-insensitive disk (macOS, Windows) or a link gives one file two names.
function isSameFile(a, b) {
  if (a === b) return true;
  try {
    const x = statSync(a);
    const y = statSync(b);
    return x.ino === y.ino && x.dev === y.dev;
  } catch {
    return false; // one of them does not exist yet: they cannot be the same file
  }
}

/** -> { input, kind, out, fps, output }: absolute paths; `fps` null when not given; `out` defaults to a cutout folder next to the input. */
export function parseCutoutArgs(argv) {
  const inputs = [];
  let out = null;
  let fps = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') out = takeValue(argv, i++, a);
    else if (a === '--fps') fps = takeValue(argv, i++, a);
    else if (a.startsWith('--')) throw new UsageError(`unknown option ${a}; accepted: --out, --fps`);
    else inputs.push(a);
  }
  if (inputs.length === 0) throw new UsageError(USAGE);
  if (inputs.length > 1) throw new UsageError('pass exactly one input (a photo or a clip)');
  const input = path.resolve(inputs[0]);
  const kind = fileKind(input);
  if (kind === null) {
    throw new UsageError(`${path.extname(input) || path.basename(input)} is not a photo or a clip; photos: ${IMAGE_EXTENSIONS.join(', ')}; clips: ${VIDEO_EXTENSIONS.join(', ')}`);
  }
  let rate = null;
  if (fps !== null) {
    if (kind === 'image') throw new UsageError('--fps is for clips; a photo has no frames');
    rate = Number(fps);
    if (!Number.isInteger(rate) || rate < MIN_FPS || rate > MAX_FPS) throw new UsageError(`--fps must be a whole number from ${MIN_FPS} to ${MAX_FPS}`);
  }
  const folder = out === null ? path.join(path.dirname(input), 'cutout') : path.resolve(out);
  const output = outputFile(input, folder, kind);
  if (isSameFile(output, input)) throw new UsageError(`--out would overwrite the input ${input}; choose another folder`);
  return { input, kind, out: folder, fps: rate, output };
}

/**
 * The size the network sees for a w x h picture, as MODNet's own inference does: the short side becomes 512 when the picture
 * is smaller than that or entirely bigger than it, else the size stays; both sides then round down to a multiple of 32.
 */
export function modelSize(w, h) {
  let rw = w;
  let rh = h;
  if (Math.max(w, h) < REF_SIZE || Math.min(w, h) > REF_SIZE) {
    if (w >= h) { rh = REF_SIZE; rw = Math.round((w / h) * REF_SIZE); } else { rw = REF_SIZE; rh = Math.round((h / w) * REF_SIZE); }
  }
  return [Math.max(MULTIPLE, rw - (rw % MULTIPLE)), Math.max(MULTIPLE, rh - (rh % MULTIPLE))];
}

// The response body, refused as soon as it passes `limit` bytes.
async function readLimited(res, limit, url, bytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.length;
    if (size > limit) throw new Error(`MODNet weights download failed: the response from ${url} is larger than the expected ${bytes} bytes; nothing was kept`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * The path of the weights in `dir`, downloading them first when absent or damaged: written to a partial file, checked
 * against `sha256`, and only then moved into place, so a half download or a tampered one is never used.
 * Options replace the constants (tests); `log` receives one line before a download.
 */
export async function ensureModel({ url = MODEL_URL, sha256 = MODEL_SHA256, bytes = MODEL_BYTES, dir = MODEL_DIR, fetchImpl = fetch, log = () => {} } = {}) {
  const file = path.join(dir, MODEL_FILE);
  if (existsSync(file) && fileSha256(file) === sha256) return file;
  mkdirSync(dir, { recursive: true });
  log(`cutout: downloading the MODNet weights (${Math.round(bytes / 1e6)} MB, once) from ${url}`);
  const partial = `${file}.partial-${process.pid}-${randomBytes(4).toString('hex')}`;
  try {
    let res;
    try { res = await fetchImpl(url); } catch (e) { throw new Error(`MODNet weights download failed: ${firstLine(e)} (${url}); check the connection and rerun`); }
    if (!res.ok) throw new Error(`MODNet weights download failed: HTTP ${res.status} from ${url}; rerun later`);
    const body = await readLimited(res, bytes * DOWNLOAD_SLACK, url, bytes);
    const got = createHash('sha256').update(body).digest('hex');
    if (got !== sha256) throw new Error(`sha256 mismatch for the MODNet weights from ${url}: expected ${sha256}, got ${got}; nothing was kept`);
    writeFileSync(partial, body);
    renameSync(partial, file);
    return file;
  } finally {
    rmSync(partial, { force: true }); // gone already once moved into place
  }
}

/** The onnxruntime-node module, or a UsageError with the install command when it is absent. `importer` is for tests. */
export async function loadOnnx(importer = (name) => import(name)) {
  try {
    const mod = await importer('onnxruntime-node');
    return mod.default?.InferenceSession ? mod.default : mod;
  } catch (e) {
    if (e?.code === 'ERR_MODULE_NOT_FOUND' && /onnxruntime-node/.test(e.message)) throw new UsageError(INSTALL_HINT);
    throw e;
  }
}

// ---- the page: decode, shrink, compose --------------------------------------------------------------------------------

// Installs window.cut on a blank page: load(b64, mime) -> [w, h]; small(w, h) -> base64 RGBA of the picture shrunk to w x h;
// compose(b64 alpha, w, h) -> base64 PNG of the picture with that matte, enlarged to the picture's size, as its alpha.
async function installCanvasTools(page) {
  await page.evaluate(() => {
    const toBase64 = (bytes) => new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.readAsDataURL(new Blob([bytes]));
    });
    const canvas = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });
    const state = { img: null };
    window.cut = {
      async load(b64, mime) {
        const img = new Image();
        img.src = `data:${mime};base64,${b64}`;
        await img.decode();
        state.img = img;
        return [img.naturalWidth, img.naturalHeight];
      },
      async small(w, h) {
        const c = canvas(w, h);
        const g = c.getContext('2d');
        g.imageSmoothingQuality = 'high';
        g.drawImage(state.img, 0, 0, w, h);
        return toBase64(g.getImageData(0, 0, w, h).data);
      },
      async compose(maskB64, w, h) {
        const alpha = Uint8Array.from(atob(maskB64), (ch) => ch.charCodeAt(0));
        const mask = canvas(w, h);
        const mg = mask.getContext('2d');
        const data = mg.createImageData(w, h);
        for (let i = 0; i < alpha.length; i++) data.data[4 * i + 3] = alpha[i];
        mg.putImageData(data, 0, 0);
        const { naturalWidth: iw, naturalHeight: ih } = state.img;
        const out = canvas(iw, ih);
        const g = out.getContext('2d');
        g.drawImage(state.img, 0, 0);
        g.globalCompositeOperation = 'destination-in';
        g.imageSmoothingQuality = 'high';
        g.drawImage(mask, 0, 0, iw, ih);
        return out.toDataURL('image/png').split(',')[1];
      },
    };
  });
}

/** A blank page with the canvas tools installed. Close the browser, not the page. */
export async function openCanvasPage(browser) {
  const page = await browser.newPage();
  await installCanvasTools(page);
  return page;
}

function toTensor(ort, rgba, w, h) {
  const plane = w * h;
  const data = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    data[i] = rgba[4 * i] / 127.5 - 1; // (x / 255 - 0.5) / 0.5
    data[plane + i] = rgba[4 * i + 1] / 127.5 - 1;
    data[2 * plane + i] = rgba[4 * i + 2] / 127.5 - 1;
  }
  return new ort.Tensor('float32', data, [1, 3, h, w]);
}

/** PNG bytes of `bytes` (a picture of type `mime`) with the person kept and everything else transparent. */
export async function cutoutPicture({ session, ort, page, bytes, mime }) {
  const [w, h] = await page.evaluate(({ b64, type }) => window.cut.load(b64, type), { b64: bytes.toString('base64'), type: mime });
  if (Math.max(w, h) > MAX_SIDE) throw new Error(`the picture is ${w}x${h}; cutouts take at most ${MAX_SIDE} px on a side. Shrink it first`);
  const [mw, mh] = modelSize(w, h);
  const small = Buffer.from(await page.evaluate(({ sw, sh }) => window.cut.small(sw, sh), { sw: mw, sh: mh }), 'base64');
  const result = await session.run({ [session.inputNames[0]]: toTensor(ort, small, mw, mh) });
  const matte = result[session.outputNames[0]].data;
  const alpha = Buffer.alloc(mw * mh);
  for (let i = 0; i < alpha.length; i++) alpha[i] = Math.round(Math.min(1, Math.max(0, matte[i])) * 255);
  return Buffer.from(await page.evaluate(({ mask, sw, sh }) => window.cut.compose(mask, sw, sh), { mask: alpha.toString('base64'), sw: mw, sh: mh }), 'base64');
}

function writeAtomic(file, bytes) {
  mkdirSync(path.dirname(file), { recursive: true });
  const partial = `${file}.partial-${process.pid}`;
  writeFileSync(partial, bytes);
  renameSync(partial, file);
}

/** Writes the cutout of a photo to `output` (RGBA PNG). -> output. */
export async function cutoutImage({ session, ort, page, input, output }) {
  const mime = MIME[extOf(input)];
  writeAtomic(output, await cutoutPicture({ session, ort, page, bytes: readFileSync(input), mime }));
  return output;
}

// ---- clips ---------------------------------------------------------------------------------------------------------------

const cacheKey = (inputSha, fps) => createHash('sha256').update(JSON.stringify({ v: CACHE_VERSION, input: inputSha, fps, model: MODEL_SHA256 })).digest('hex');
const frameName = (n) => `${String(n).padStart(6, '0')}.png`;

function readDone(dir) {
  try {
    const done = JSON.parse(readFileSync(path.join(dir, DONE), 'utf8'));
    const last = path.join(dir, 'alpha', frameName(done.count));
    return Number.isInteger(done.count) && done.count > 0 && existsSync(last) ? done : null;
  } catch { return null; }
}

function run(ffmpeg, args, what) {
  const r = spawnSync(ffmpeg, args, { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) {
    const detail = (r.stderr ?? '').trim().split('\n').filter(Boolean).at(-1) ?? r.error?.message ?? `exit ${r.status}`;
    const hint = /Unknown encoder|libvpx/i.test(detail) ? '; this ffmpeg has no libvpx-vp9 encoder (Homebrew and ffmpeg-static builds do)' : '';
    throw new Error(`ffmpeg ${what} failed: ${detail}${hint}`);
  }
}

/** The ffmpeg arguments that write the clip's frames at `fps`: never more than MAX_FRAMES, whatever duration the file claims. */
export function extractArgs(input, fps, pattern) {
  return ['-v', 'error', '-y', ...fileInput(input), '-vf', `fps=${fps}`, '-frames:v', String(MAX_FRAMES), pattern];
}

/**
 * Cuts the person out of every frame of the clip `input` at `fps` and encodes a VP9 alpha WebM at `output` (no sound: the
 * original clip carries it). The alpha frames are kept in .cache/cutout/<key>/ so a rerun of the same clip, rate and weights
 * only encodes. -> { output, frames, reused }.
 */
export async function cutoutVideo({ session, ort, page, ffmpeg, info, input, output, fps, log = () => {} }) {
  const frames = Math.ceil(info.duration * fps);
  if (frames > MAX_FRAMES) throw new UsageError(`${input} would be ${frames} frames at ${fps} fps; the limit is ${MAX_FRAMES}. Lower --fps or cut the clip shorter`);
  const dir = path.join(CUTOUT_CACHE, cacheKey(fileSha256(input), fps));
  let done = readDone(dir);
  const reused = done !== null;
  if (reused) log(`cutout: reusing the alpha frames of this clip at ${fps} fps from ${dir}`);
  else {
    const work = `${dir}.partial-${process.pid}-${randomBytes(4).toString('hex')}`;
    mkdirSync(path.join(work, 'src'), { recursive: true });
    mkdirSync(path.join(work, 'alpha'));
    try {
      run(ffmpeg, extractArgs(input, fps, path.join(work, 'src', '%06d.png')), 'frame extraction');
      const count = readdirSync(path.join(work, 'src')).filter((f) => /^\d{6}\.png$/.test(f)).length;
      if (count === 0) throw new Error(`ffmpeg decoded no frames from ${input}`);
      log(`cutout: cutting out ${count} frames at ${fps} fps`);
      for (let n = 1; n <= count; n++) {
        const png = await cutoutPicture({ session, ort, page, bytes: readFileSync(path.join(work, 'src', frameName(n))), mime: MIME.png });
        writeFileSync(path.join(work, 'alpha', frameName(n)), png);
      }
      rmSync(path.join(work, 'src'), { recursive: true, force: true });
      writeFileSync(path.join(work, DONE), JSON.stringify({ count }));
      rmSync(dir, { recursive: true, force: true }); // an unfinished folder of this key, never a whole one (readDone said no)
      renameSync(work, dir);
      done = { count };
    } finally {
      rmSync(work, { recursive: true, force: true }); // gone already once moved into place
    }
  }
  mkdirSync(path.dirname(output), { recursive: true });
  const partial = `${output}.partial-${process.pid}.webm`;
  try {
    run(ffmpeg, ['-v', 'error', '-y', '-framerate', String(fps), ...fileInput(path.join(dir, 'alpha', '%06d.png')), '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0', '-b:v', '0', '-crf', '24', partial], 'WebM encoding');
    renameSync(partial, output);
  } finally {
    rmSync(partial, { force: true });
  }
  return { output, frames: done.count, reused };
}

/** The frame rate to use for a clip: --fps, else the clip's own rounded, at most DEFAULT_FPS_CAP. */
export const clipFps = (requested, info) => requested ?? Math.max(MIN_FPS, Math.min(DEFAULT_FPS_CAP, Math.round(info.fps) || DEFAULT_FPS_CAP));
