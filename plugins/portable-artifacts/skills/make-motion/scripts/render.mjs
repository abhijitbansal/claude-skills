#!/usr/bin/env node
// node scripts/render.mjs <motion.json> [--out <file>] [--fps n] [--size WxH] [--theme <name>] [--model <m>] [--effort <e>] [--agent <a>] [--contact-sheet]
// --theme: a shared theme for a spec that names none (a spec's own `theme` wins). The first stdout line names
// the theme drawn: `theme: <name>`.
// --model/--effort/--agent override the spec's generatedBy; they are stamped into the MP4 comment/artist tags.
// With --contact-sheet, --out is a directory; one tiled, timestamped PNG per scene goes to <out>/contact/<scene-id>.png.
import { spawn } from 'node:child_process';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadSpec, validateSpec, typingErrors, withDefaults, UsageError } from './lib/spec.mjs';
import { printResult, didYouMean } from '../shared/errors.mjs';
import { listThemes } from '../shared/theme.mjs';
import { startServer } from './lib/server.mjs';
import { launchBrowser, guardNetwork } from './lib/browser.mjs';
import { findFfmpeg, encodeArgs, probeAudio, probeGraph, measureLoudness } from './lib/ffmpeg.mjs';
import { synthesiseCues } from './lib/cues.mjs';
import { resolveAsset } from './lib/paths.mjs';
import { withGeneratedBy, provenanceText, buildDate } from '../shared/provenance.mjs';
import { resolveAudio } from '../template/audio.mjs';
import { MOTION_THEME } from './lib/default-theme.mjs';
import { sheetMoments, tileSheet, PHONE_WIDTH } from './lib/sheet.mjs';

const PROGRESS_STEPS = 10;
const MAX_FPS = 120;
const MIN_SIDE = 16;
const MAX_SIDE = 3840;
const FFMPEG_GRACE_MS = 2000;
const EXIT_SIGINT = 130;
const EXIT_SIGTERM = 143;
const USAGE = 'usage: node scripts/render.mjs <motion.json> [--out <file>] [--fps n] [--size WxH] [--theme <name>] [--model <m>] [--effort <e>] [--agent <a>] [--contact-sheet]';

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
    else if (a === '--out' || a === '--fps' || a === '--size' || a === '--theme' || a === '--model' || a === '--effort' || a === '--agent') opts[a.slice(2)] = takeValue(argv, i++, a);
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
  return opts;
}

function partialPath(out) {
  const p = path.parse(out);
  return path.join(p.dir, `${p.name}.partial${p.ext}`);
}

// Resolve each audio track to an absolute file and fail before the browser launches if ffmpeg cannot decode one.
// Cues are synthesised into a temp folder (`cueDir`, removed by cleanup) and join the mix as more tracks.
function planAudio(spec, dir, ffmpeg, fps, state) {
  const files = resolveAudio(spec).map((track, i) => {
    const { file } = resolveAsset(dir, track.src); // the path the validator already accepted (normalised, realpath)
    const problem = probeAudio(ffmpeg, file);
    if (problem) throw new Error(`audio[${i}].src: ffmpeg cannot decode ${track.src}: ${problem}`);
    return { ...track, file };
  });
  const { dir: cueDir, tracks } = synthesiseCues(spec, os.tmpdir());
  state.cueDir = cueDir; // recorded at once: the signal handlers (installed before planning) remove it on an interrupt
  const audio = [...files, ...tracks];
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
  // --fps replaces the spec's frame rate after validation, and a typing text's last frame depends on it.
  const slow = opts.fps === undefined ? [] : typingErrors(raw, fps);
  if (slow.length) {
    printResult({ ok: false, errors: slow }, { label: opts.spec });
    return null;
  }
  const total = spec.scenes.reduce((a, s) => a + s.duration, 0);
  const frames = Math.round(total * fps);
  if (!opts.contact && frames < 1) throw new UsageError(`spec is too short for ${fps} fps: no frames to render`);
  const name = path.basename(specPath, path.extname(specPath));
  const defaultOut = opts.contact ? path.join(dir, 'out') : path.join(dir, 'out', `${name}.mp4`);
  const ffmpeg = opts.contact ? null : await findFfmpeg();
  return {
    theme: opts.theme, themeName: loaded.theme ?? opts.theme ?? MOTION_THEME, spec, specPath, fps, frames, total, contact: opts.contact, size: opts.size ?? spec.size,
    out: path.resolve(opts.out ?? defaultOut), ffmpeg,
    metadata: { comment: provenanceText('make-motion', spec.generatedBy, buildDate()), artist: spec.generatedBy?.model },
    ...(opts.contact ? { audio: [] } : planAudio(spec, dir, ffmpeg, fps, state)),
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
  const seek = (sec, label) => page.evaluate(([s, text]) => { window.__motion.seek(s); window.__motion.stamp(text); }, [sec, label]);
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

async function renderVideo(page, p, state) {
  mkdirSync(path.dirname(p.out), { recursive: true });
  state.partial = partialPath(p.out);
  state.encoder = startEncoder(p.ffmpeg, encodeArgs({ fps: p.fps, out: state.partial, audio: p.audio, duration: p.total, metadata: p.metadata }));
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
  if (p.audio.length) reportLoudness(p.ffmpeg, p.out);
}

// One line after any render with audio: how loud the mix came out. Information only; it never fails a render.
function reportLoudness(ffmpeg, file) {
  const level = measureLoudness(ffmpeg, file);
  if (!level) return process.stderr.write('audio: loudness could not be measured\n');
  const db = (n, unit) => (Number.isFinite(n) ? `${n.toFixed(1)} ${unit}` : `silent (${unit})`);
  return process.stdout.write(`audio: ${db(level.lufs, 'LUFS')} integrated, true peak ${db(level.truePeak, 'dBTP')}\n`);
}

async function cleanup(state) {
  await state.encoder?.kill();
  await state.browser?.close().catch(() => {});
  if (state.partial) rmSync(state.partial, { force: true });
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
  // The handlers go in before planning: planning writes the cue folder, and an interrupt with no handler would kill the
  // process and leave it behind.
  const state = { encoder: null, browser: null, partial: null, cueDir: null, exiting: false };
  installSignalHandlers(state);
  const p = await plan(parseArgs(process.argv.slice(2)), state);
  if (!p) return 1;
  process.stdout.write(`theme: ${p.themeName}\n`);
  let server;
  try {
    server = await startServer({ specPath: p.specPath, mode: 'render', theme: p.theme });
    const page = await openPage(p, server, state);
    const info = await page.evaluate(() => ({ sceneStarts: window.__motion.sceneStarts }));
    await (p.contact ? renderContactSheets(page, p, info, state.browser) : renderVideo(page, p, state));
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
