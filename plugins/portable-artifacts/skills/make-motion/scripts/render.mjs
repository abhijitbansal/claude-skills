#!/usr/bin/env node
// node scripts/render.mjs <motion.json> [--out <file>] [--fps n] [--size WxH] [--contact-sheet]
// With --contact-sheet, --out is a directory; PNGs go to <out>/contact/<scene-id>.png.
import { spawn } from 'node:child_process';
import { mkdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { loadSpec, validateSpec, withDefaults, UsageError } from './lib/spec.mjs';
import { printResult } from '../shared/errors.mjs';
import { startServer } from './lib/server.mjs';
import { launchBrowser, guardNetwork } from './lib/browser.mjs';
import { findFfmpeg, encodeArgs, probeAudio, probeGraph } from './lib/ffmpeg.mjs';
import { resolveAsset } from './lib/paths.mjs';
import { resolveAudio } from '../template/audio.mjs';

const CONTACT_POINT = 0.85;
const PROGRESS_STEPS = 10;
const MAX_FPS = 120;
const MIN_SIDE = 16;
const MAX_SIDE = 3840;
const FFMPEG_GRACE_MS = 2000;
const EXIT_SIGINT = 130;
const EXIT_SIGTERM = 143;
const USAGE = 'usage: node scripts/render.mjs <motion.json> [--out <file>] [--fps n] [--size WxH] [--contact-sheet]';

function takeValue(argv, i, flag) {
  const value = argv[i + 1];
  if (value === undefined || value.startsWith('--')) throw new UsageError(`${flag} needs a value`);
  return value;
}

function parseSize(text) {
  const m = /^(\d+)x(\d+)$/.exec(text);
  if (!m) throw new UsageError('--size must look like 1920x1080');
  const size = [Number(m[1]), Number(m[2])];
  if (size.some((n) => n < MIN_SIDE || n > MAX_SIDE)) throw new UsageError(`--size sides must be ${MIN_SIDE}-${MAX_SIDE}`);
  if (size.some((n) => n % 2)) throw new UsageError('--size sides must be even (yuv420p MP4)');
  return size;
}

function parseArgs(argv) {
  const opts = { contact: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--contact-sheet') opts.contact = true;
    else if (a === '--out' || a === '--fps' || a === '--size') opts[a.slice(2)] = takeValue(argv, i++, a);
    else if (a.startsWith('--')) throw new UsageError(`unknown option ${a}`);
    else rest.push(a);
  }
  if (rest.length !== 1) throw new UsageError(USAGE);
  opts.spec = rest[0];
  if (opts.fps !== undefined) {
    opts.fps = Number(opts.fps);
    if (!Number.isInteger(opts.fps) || opts.fps < 1 || opts.fps > MAX_FPS) throw new UsageError(`--fps must be an integer from 1 to ${MAX_FPS}`);
  }
  if (opts.size !== undefined) opts.size = parseSize(opts.size);
  return opts;
}

function partialPath(out) {
  const p = path.parse(out);
  return path.join(p.dir, `${p.name}.partial${p.ext}`);
}

// Resolve each audio track to an absolute file and fail before the browser launches if ffmpeg cannot decode one.
function planAudio(spec, dir, ffmpeg, fps) {
  const audio = resolveAudio(spec).map((track, i) => {
    const { file } = resolveAsset(dir, track.src); // the path the validator already accepted (normalised, realpath)
    const problem = probeAudio(ffmpeg, file);
    if (problem) throw new Error(`audio[${i}].src: ffmpeg cannot decode ${track.src}: ${problem}`);
    return { ...track, file };
  });
  if (audio.length) {
    const problem = probeGraph(ffmpeg, { fps, audio }); // an old ffmpeg without amix normalize / adelay all fails here, not at frame 1
    if (problem) throw new Error(`audio: ffmpeg rejected the mix (needs ffmpeg >= 4.4): ${problem}`);
  }
  return audio;
}

// Validate the spec and work out every input before launching anything.
async function plan(opts) {
  const { spec: raw, dir } = loadSpec(opts.spec);
  const result = validateSpec(raw, { dir });
  if (!result.ok) {
    printResult(result, { label: opts.spec });
    return null;
  }
  const spec = withDefaults(raw);
  const specPath = path.resolve(opts.spec);
  const fps = opts.fps ?? spec.fps;
  const total = spec.scenes.reduce((a, s) => a + s.duration, 0);
  const frames = Math.round(total * fps);
  if (!opts.contact && frames < 1) throw new UsageError(`spec is too short for ${fps} fps: no frames to render`);
  const name = path.basename(specPath, path.extname(specPath));
  const defaultOut = opts.contact ? path.join(dir, 'out') : path.join(dir, 'out', `${name}.mp4`);
  const ffmpeg = opts.contact ? null : await findFfmpeg();
  return {
    spec, specPath, fps, frames, total, contact: opts.contact, size: opts.size ?? spec.size,
    out: path.resolve(opts.out ?? defaultOut), ffmpeg,
    audio: opts.contact ? [] : planAudio(spec, dir, ffmpeg, fps),
  };
}

function startEncoder(ffmpegPath, args) {
  const proc = spawn(ffmpegPath, args, { stdio: ['pipe', 'ignore', 'pipe'] });
  let stderr = '';
  proc.stderr.on('data', (c) => { stderr = (stderr + c).slice(-4000); });
  const closed = new Promise((resolve) => {
    proc.on('error', (error) => resolve({ code: -1, error }));
    proc.on('close', (code) => resolve({ code }));
  });
  proc.stdin.on('error', () => {}); // EPIPE etc. surface through write() and finish()
  const fail = async (cause) => {
    const ended = await Promise.race([closed, new Promise((r) => { setTimeout(r, FFMPEG_GRACE_MS); })]);
    const exit = ended?.code === undefined ? '' : ` (exit ${ended.code})`;
    throw new Error(`ffmpeg failed${exit}: ${stderr.trim() || cause.message}`);
  };
  const write = (buf) => new Promise((resolve, reject) => {
    if (proc.stdin.destroyed) reject(new Error('ffmpeg closed its input'));
    else proc.stdin.write(buf, (err) => (err ? reject(err) : resolve()));
  }).catch(fail);
  const finish = async () => {
    proc.stdin.end();
    const ended = await closed;
    if (ended.code !== 0) throw new Error(`ffmpeg failed (exit ${ended.code}): ${stderr.trim() || ended.error?.message}`);
  };
  const kill = () => { proc.kill('SIGKILL'); return closed; };
  return { write, finish, kill };
}

async function renderContactSheets(page, p, info) {
  const outDir = path.join(p.out, 'contact');
  mkdirSync(outDir, { recursive: true });
  for (const [i, scene] of p.spec.scenes.entries()) {
    await page.evaluate((s) => window.__motion.seek(s), info.sceneStarts[i] + scene.duration * CONTACT_POINT);
    await page.screenshot({ type: 'png', path: path.join(outDir, `${scene.id}.png`) });
  }
  process.stdout.write(`${outDir}\n${p.spec.scenes.length} contact sheet(s)\n`);
}

async function renderVideo(page, p, state) {
  mkdirSync(path.dirname(p.out), { recursive: true });
  state.partial = partialPath(p.out);
  state.encoder = startEncoder(p.ffmpeg, encodeArgs({ fps: p.fps, out: state.partial, audio: p.audio, duration: p.total }));
  let nextMark = 1;
  for (let i = 0; i < p.frames; i++) {
    await page.evaluate((s) => window.__motion.seek(s), i / p.fps);
    await state.encoder.write(await page.screenshot({ type: 'png' }));
    if ((i + 1) / p.frames >= nextMark / PROGRESS_STEPS) {
      process.stdout.write(`${nextMark * PROGRESS_STEPS}% (${i + 1}/${p.frames} frames)\n`);
      nextMark++;
    }
  }
  await state.encoder.finish();
  renameSync(state.partial, p.out);
  state.partial = null;
  process.stdout.write(`${p.out}\n${p.frames} frames @ ${p.fps} fps, ${p.size.join('x')}\n`);
}

async function cleanup(state) {
  await state.encoder?.kill();
  await state.browser?.close().catch(() => {});
  if (state.partial) rmSync(state.partial, { force: true });
}

function installSignalHandlers(state) {
  for (const [signal, code] of [['SIGINT', EXIT_SIGINT], ['SIGTERM', EXIT_SIGTERM]]) {
    process.once(signal, () => {
      state.exiting = true;
      cleanup(state).finally(() => process.exit(code));
    });
  }
}

async function openPage(p, server, state) {
  state.browser = await launchBrowser();
  const page = await state.browser.newPage({ viewport: { width: p.size[0], height: p.size[1] }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => process.stderr.write(`page error: ${e.message}\n`));
  await guardNetwork(page, new URL(server.url).origin, (url) => process.stderr.write(`blocked network request: ${url}\n`));
  await page.goto(server.url);
  await page.waitForFunction(() => window.__motion);
  await page.evaluate(() => window.__motion.ready);
  return page;
}

async function main() {
  const p = await plan(parseArgs(process.argv.slice(2)));
  if (!p) return 1;
  const state = { encoder: null, browser: null, partial: null, exiting: false };
  installSignalHandlers(state);
  const server = await startServer({ specPath: p.specPath, mode: 'render' });
  try {
    const page = await openPage(p, server, state);
    const info = await page.evaluate(() => ({ sceneStarts: window.__motion.sceneStarts }));
    await (p.contact ? renderContactSheets(page, p, info) : renderVideo(page, p, state));
    return 0;
  } catch (e) {
    if (state.exiting) return new Promise(() => {}); // the signal handler owns the exit
    throw e;
  } finally {
    if (!state.exiting) await cleanup(state);
    await server.close();
  }
}

main().then((code) => process.exit(code), (e) => {
  process.stderr.write(`${e.message}\n`);
  process.exit(e instanceof UsageError ? 2 : 1);
});
