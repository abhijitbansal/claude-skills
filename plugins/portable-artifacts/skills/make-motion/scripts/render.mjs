#!/usr/bin/env node
// node scripts/render.mjs <motion.json> [--out <file>] [--fps n] [--size WxH] [--theme <name>] [--model <m>] [--effort <e>] [--agent <a>] [--workers n|auto] [--quality draft|final] [--contact-sheet]
// --theme: a shared theme for a spec that names none (a spec's own `theme` wins). The first stdout line names
// the theme drawn: `theme: <name>`.
// --workers: capture frames on that many pages of one browser (1-16, or auto); the MP4 is byte-identical to --workers 1.
// --quality draft: half the size on each side and a faster encode, for a quick look; final (the default) is the full render.
// Both notes (`workers: N`, `quality: draft (WxH)`) go to stderr; stdout is the same either way.
// --model/--effort/--agent override the spec's generatedBy; they are stamped into the MP4 comment/artist tags.
// With --contact-sheet, --out is a directory; one tiled, timestamped PNG per scene goes to <out>/contact/<scene-id>.png.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadSpec, validateSpec, frameRateErrors, withDefaults, UsageError } from './lib/spec.mjs';
import { frameCount } from '../template/frames.mjs';
import { printResult, didYouMean } from '../shared/errors.mjs';
import { listThemes } from '../shared/theme.mjs';
import { startServer } from './lib/server.mjs';
import { launchBrowser, guardNetwork } from './lib/browser.mjs';
import { findFfmpeg, findFfprobe, encodeArgs, probeAudio, probeGraph, measureLoudness, draftSize, QUALITIES } from './lib/ffmpeg.mjs';
import { parseWorkers, captureInOrder } from './lib/workers.mjs';
import { specHasVideo, prepareVideo, videoAudioTracks } from './lib/video.mjs';
import { synthesiseCues } from './lib/cues.mjs';
import { resolveAsset } from './lib/paths.mjs';
import { withGeneratedBy, provenanceText, buildDate } from '../shared/provenance.mjs';
import { warnIfStaleCopy } from '../shared/stale-copy.mjs';
import { resolveAudio } from '../template/audio.mjs';
import { MOTION_THEME } from './lib/default-theme.mjs';
import { sheetMoments, tileSheet, PHONE_WIDTH } from './lib/sheet.mjs';

const PROGRESS_STEPS = 10;
const MAX_FPS = 120;
const MIN_SIDE = 16;
const MAX_SIDE = 3840;
const FFMPEG_GRACE_MS = 2000;
const FRAME_DIR_RETRIES = 5;
const FRAME_DIR_RETRY_MS = 100;
const EXIT_SIGINT = 130;
const EXIT_SIGTERM = 143;
const USAGE = 'usage: node scripts/render.mjs <motion.json> [--out <file>] [--fps n] [--size WxH] [--theme <name>] [--model <m>] [--effort <e>] [--agent <a>] [--workers n|auto] [--quality draft|final] [--contact-sheet]';

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

function checkTheme(name) {
  const themes = listThemes();
  if (themes.includes(name)) return;
  const near = didYouMean(name, themes);
  throw new UsageError(`--theme: unknown theme ${JSON.stringify(name)}; ${near ? `did you mean ${JSON.stringify(near)}?` : `available: ${themes.join(', ')}`}`);
}

function parseArgs(argv) {
  const opts = { contact: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--contact-sheet') opts.contact = true;
    else if (['--out', '--fps', '--size', '--theme', '--model', '--effort', '--agent', '--workers', '--quality'].includes(a)) opts[a.slice(2)] = takeValue(argv, i++, a);
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
  if (opts.theme !== undefined) checkTheme(opts.theme);
  checkCapture(opts);
  return opts;
}

// --workers and --quality: a value outside the accepted set is a usage error, and so is one a contact sheet would ignore.
function checkCapture(opts) {
  const workers = parseWorkers(opts.workers);
  if (opts.quality !== undefined && !QUALITIES.includes(opts.quality)) {
    throw new UsageError(`--quality must be ${QUALITIES.map((q) => JSON.stringify(q)).join(' or ')} (got ${JSON.stringify(opts.quality)})`);
  }
  if (opts.contact && opts.workers !== undefined) throw new UsageError('--workers does not apply to --contact-sheet (it captures a few frames on one page); leave it out');
  if (opts.contact && opts.quality === 'draft') throw new UsageError('--quality does not apply to --contact-sheet (a sheet is always full size); leave it out');
  opts.workers = workers;
}

function partialPath(out) {
  const p = path.parse(out);
  return path.join(p.dir, `${p.name}.partial${p.ext}`);
}

// Resolve each audio track to an absolute file and fail before the browser launches if ffmpeg cannot decode one.
// The sound of each video element (unless muted) joins as a track that starts with the clip.
// Cues are synthesised into a temp folder (`cueDir`, removed by cleanup) and join the mix as more tracks.
function planAudio(spec, dir, ffmpeg, ffprobe, fps, total, state) {
  const files = resolveAudio(spec).map((track, i) => {
    const { file } = resolveAsset(dir, track.src); // the path the validator already accepted (normalised, realpath)
    const problem = probeAudio(ffmpeg, file);
    if (problem) throw new Error(`audio[${i}].src: ffmpeg cannot decode ${track.src}: ${problem}`);
    return { ...track, file };
  });
  const clips = videoAudioTracks(spec, dir, ffprobe, total);
  const { dir: cueDir, tracks } = synthesiseCues(spec, os.tmpdir());
  state.cueDir = cueDir; // recorded at once: the signal handlers (installed before planning) remove it on an interrupt
  const audio = [...files, ...clips, ...tracks];
  if (audio.length) {
    const problem = probeGraph(ffmpeg, { fps, audio }); // an old ffmpeg without amix normalize / adelay all fails here, not at frame 1
    if (problem) {
      if (cueDir) rmSync(cueDir, { recursive: true, force: true });
      state.cueDir = null;
      throw new Error(`audio: ffmpeg rejected the mix (needs ffmpeg >= 4.4): ${problem}`);
    }
  }
  return { audio };
}

// Validate the spec and work out every input before launching anything.
async function plan(opts, state) {
  const { spec: loaded, dir } = loadSpec(opts.spec);
  const raw = withGeneratedBy(loaded, { model: opts.model, effort: opts.effort, agent: opts.agent });
  const result = validateSpec(raw, { dir });
  if (!result.ok) {
    printResult(result, { label: opts.spec });
    return null;
  }
  const spec = withDefaults(raw);
  const specPath = path.resolve(opts.spec);
  const fps = opts.fps ?? spec.fps;
  // --fps replaces the spec's frame rate after validation, and a typing text's or code's last frame depends on it;
  // so do a block's own schedule (a terminal-run's last line) and a block's typing parts: frameRateErrors names the param.
  const slow = opts.fps === undefined ? [] : frameRateErrors(raw, fps);
  if (slow.length) {
    printResult({ ok: false, errors: slow }, { label: opts.spec });
    return null;
  }
  const total = spec.scenes.reduce((a, s) => a + s.duration, 0);
  const frames = frameCount(total, fps); // template/frames.mjs: the grid every cut-off check judges against
  if (!opts.contact && frames < 1) throw new UsageError(`spec is too short for ${fps} fps: no frames to render`);
  const name = path.basename(specPath, path.extname(specPath));
  const defaultOut = opts.contact ? path.join(dir, 'out') : path.join(dir, 'out', `${name}.mp4`);
  // Video elements need ffmpeg to decode their frames, contact sheets included.
  const hasVideo = specHasVideo(spec);
  const ffmpeg = opts.contact && !hasVideo ? null : await findFfmpeg();
  const ffprobe = hasVideo ? findFfprobe({ ffmpeg }) : null;
  const quality = opts.quality ?? 'final';
  const size = opts.size ?? spec.size;
  return {
    theme: opts.theme, themeName: loaded.theme ?? opts.theme ?? MOTION_THEME, spec, specPath, fps, frames, total, contact: opts.contact, quality,
    // A draft page is half the size: the stage scales to fit it exactly as it does for --size, so captions, the safe area and fonts shrink with it.
    size: quality === 'draft' ? draftSize(size) : size,
    workers: opts.workers,
    out: path.resolve(opts.out ?? defaultOut), ffmpeg,
    metadata: { comment: provenanceText('make-motion', spec.generatedBy, buildDate()), artist: spec.generatedBy?.model },
    videoFrames: hasVideo ? prepareVideo(spec, dir, ffmpeg, ffprobe, fps) : {},
    ...(opts.contact ? { audio: [] } : planAudio(spec, dir, ffmpeg, ffprobe, fps, total, state)),
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

async function renderContactSheets(page, p, info, browser) {
  const outDir = path.join(p.out, 'contact');
  mkdirSync(outDir, { recursive: true });
  // seek() resolves once every video frame it set is decoded, so the screenshot never catches an old one.
  const seek = (sec, label) => page.evaluate(async ([s, text]) => { await window.__motion.seek(s); window.__motion.stamp(text); }, [sec, label]);
  for (const [i, scene] of p.spec.scenes.entries()) {
    const { times, total } = sheetMoments(scene, p.fps);
    if (total > times.length) process.stderr.write(`${scene.id}: ${total} moments, showing ${times.length}\n`);
    const tiles = [];
    for (const t of times) {
      const label = `${scene.id} · ${t.toFixed(2)}s`;
      await seek(info.sceneStarts[i] + t, label);
      tiles.push({ png: await page.screenshot({ type: 'png' }), label });
    }
    if (p.size[0] > PHONE_WIDTH) { // a phone-width copy of the last frame, without the stamp
      const lastLabel = tiles[tiles.length - 1].label;
      await seek(info.sceneStarts[i] + times[times.length - 1], '');
      tiles.push({ png: await page.screenshot({ type: 'png' }), label: `${lastLabel} · ${PHONE_WIDTH}px phone`, width: PHONE_WIDTH });
    }
    writeFileSync(path.join(outDir, `${scene.id}.png`), await tileSheet(browser, tiles));
  }
  process.stdout.write(`${outDir}\n${p.spec.scenes.length} contact sheet(s)\n`);
}

// One page: seek, screenshot, encode, frame by frame. Several pages: they take the frames in turn, write PNG files (at
// most two per page at once) and the encoder takes the frames in order (workers.mjs); every frame is the same bytes
// whichever page draws it.
async function renderVideo(pages, p, state) {
  mkdirSync(path.dirname(p.out), { recursive: true });
  state.partial = partialPath(p.out);
  state.encoder = startEncoder(p.ffmpeg, encodeArgs({ fps: p.fps, out: state.partial, audio: p.audio, duration: p.total, metadata: p.metadata, quality: p.quality }));
  let written = 0;
  let nextMark = 1;
  const onFrame = async (png) => {
    await state.encoder.write(png);
    written++;
    if (written / p.frames >= nextMark / PROGRESS_STEPS) {
      process.stdout.write(`${nextMark * PROGRESS_STEPS}% (${written}/${p.frames} frames)\n`);
      nextMark++;
    }
  };
  if (pages.length > 1) {
    await captureInOrder({ pages, frames: p.frames, fps: p.fps, dir: state.frameDir, onFrame });
  } else {
    for (let i = 0; i < p.frames; i++) {
      await pages[0].evaluate((s) => window.__motion.seek(s), i / p.fps);
      await onFrame(await pages[0].screenshot({ type: 'png' }));
    }
  }
  await state.encoder.finish();
  renameSync(state.partial, p.out);
  state.partial = null;
  process.stdout.write(`${p.out}\n${p.frames} frames @ ${p.fps} fps, ${p.size.join('x')}\n`);
  if (p.audio.length) reportLoudness(p.ffmpeg, p.out, p.spec.loudness);
}

// The mix is on a `loudness` target when its integrated loudness is within this many LU of it and its true peak is at
// or below the target's.
const LOUDNESS_TOLERANCE_LU = 1;

// One line after any render with audio: how loud the mix came out; with a `loudness` target (viral mode sets one), a
// second line measures it against the target. Information only; it never fails a render.
function reportLoudness(ffmpeg, file, target) {
  const level = measureLoudness(ffmpeg, file);
  if (!level) return process.stderr.write('audio: loudness could not be measured\n');
  const db = (n, unit) => (Number.isFinite(n) ? `${n.toFixed(1)} ${unit}` : `silent (${unit})`);
  process.stdout.write(`audio: ${db(level.lufs, 'LUFS')} integrated, true peak ${db(level.truePeak, 'dBTP')}\n`);
  if (!target) return true;
  const on = Math.abs(level.lufs - target.integrated) <= LOUDNESS_TOLERANCE_LU && level.truePeak <= target.truePeak; // silence (-Infinity) is off
  return process.stdout.write(`loudness: target ${target.integrated} LUFS / ${target.truePeak} dBTP; measured ${db(level.lufs, 'LUFS')} / ${db(level.truePeak, 'dBTP')} (${on ? 'on' : 'off'} target)\n`);
}

async function cleanup(state) {
  await state.encoder?.kill();
  await state.browser?.close().catch(() => {});
  if (state.partial) rmSync(state.partial, { force: true });
  // A screenshot a page had already taken can land in the folder while it is removed (an interrupt), so retry on ENOTEMPTY.
  if (state.frameDir) rmSync(state.frameDir, { recursive: true, force: true, maxRetries: FRAME_DIR_RETRIES, retryDelay: FRAME_DIR_RETRY_MS });
  if (state.cueDir) rmSync(state.cueDir, { recursive: true, force: true });
}

function installSignalHandlers(state) {
  for (const [signal, code] of [['SIGINT', EXIT_SIGINT], ['SIGTERM', EXIT_SIGTERM]]) {
    process.once(signal, () => {
      state.exiting = true;
      cleanup(state).finally(() => process.exit(code));
    });
  }
}

// One browser, `count` pages. Every page opens exactly the same way: the same viewport and scale factor, the same
// network guard, and the same wait for fonts and video frames, so a frame is the same bytes whichever page draws it.
async function openPages(p, server, state, count) {
  state.browser = await launchBrowser({ ownSignals: true }); // the signal handlers above remove the partial MP4 and temp frames
  const origin = new URL(server.url).origin;
  const open = async () => {
    const page = await state.browser.newPage({ viewport: { width: p.size[0], height: p.size[1] }, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => process.stderr.write(`page error: ${e.message}\n`));
    await guardNetwork(page, origin, (url) => process.stderr.write(`blocked network request: ${url}\n`));
    await page.goto(server.url);
    await page.waitForFunction(() => window.__motion);
    await page.evaluate(() => window.__motion.ready);
    return page;
  };
  return Promise.all(Array.from({ length: count }, open));
}

async function main() {
  warnIfStaleCopy();
  // The handlers go in before planning: planning writes the cue folder, and an interrupt with no handler would kill the
  // process and leave it behind.
  const state = { encoder: null, browser: null, partial: null, frameDir: null, cueDir: null, exiting: false };
  installSignalHandlers(state);
  const p = await plan(parseArgs(process.argv.slice(2)), state);
  if (!p) return 1;
  process.stdout.write(`theme: ${p.themeName}\n`);
  const pageCount = p.contact ? 1 : Math.min(p.workers, p.frames); // no page without a frame to take
  if (p.quality === 'draft') process.stderr.write(`quality: draft (${p.size.join('x')})\n`);
  if (pageCount > 1) process.stderr.write(`workers: ${pageCount}\n`);
  let server;
  try {
    // Frames of a parallel render wait here, outside the spec folder; cleanup() removes the folder on every exit.
    if (pageCount > 1) state.frameDir = mkdtempSync(path.join(os.tmpdir(), 'motion-frames-'));
    server = await startServer({ specPath: p.specPath, mode: 'render', theme: p.theme, videoFrames: p.videoFrames });
    const pages = await openPages(p, server, state, pageCount);
    const info = await pages[0].evaluate(() => ({ sceneStarts: window.__motion.sceneStarts }));
    await (p.contact ? renderContactSheets(pages[0], p, info, state.browser) : renderVideo(pages, p, state));
    return 0;
  } catch (e) {
    if (state.exiting) return new Promise(() => {}); // the signal handler owns the exit
    throw e;
  } finally {
    if (!state.exiting) await cleanup(state); // also removes the cue folder when the server never started
    await server?.close();
  }
}

main().then((code) => process.exit(code), (e) => {
  process.stderr.write(`${e.message}\n`);
  process.exit(e instanceof UsageError ? 2 : 1);
});
