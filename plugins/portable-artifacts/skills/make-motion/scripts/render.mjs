#!/usr/bin/env node
// node scripts/render.mjs <motion.json> [--out <file>] [--fps n] [--size WxH] [--theme <name>] [--model <m>] [--effort <e>] [--agent <a>] [--workers n|auto] [--quality draft|final] [--contact-sheet]
// --theme: a shared theme for a spec that names none (a spec's own `theme` wins). The first stdout line names
// the theme drawn: `theme: <name>`.
// --workers: capture frames on that many pages of one browser (1-16, or auto); the MP4 is byte-identical to --workers 1.
// --quality draft: half the size on each side and a faster encode, for a quick look; final (the default) is the full render.
// --loudness <lufs>|off (-30 to -5) and --true-peak <dbtp> (-3 to 0): normalise the mix with a two-pass loudnorm after the
// encode. Without a flag a spec's root `loudness` (viral mode sets -14 / -1) is the target; off disables it.
// Both notes (`workers: N`, `quality: draft (WxH)`) go to stderr; stdout is the same either way.
// --model/--effort/--agent override the spec's generatedBy; they are stamped into the MP4 comment/artist tags.
// With --contact-sheet, --out is a directory; one tiled, timestamped PNG per scene goes to <out>/contact/<scene-id>.png.
// --batch rows.json --out "renders/{name}.mp4": one MP4 per row of var values ({index} or a {var} in the file name), every
// row checked before the first frame, then rendered in turn; manifest.json beside them records each row's result.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadSpec, validateSpec, checkVars, frameRateErrors, withDefaults, UsageError } from './lib/spec.mjs';
import { declaresBeats, resolveSpecBeats } from './lib/beats-file.mjs';
import { frameCount } from '../template/frames.mjs';
import { printResult, didYouMean } from '../shared/errors.mjs';
import { listThemes } from '../shared/theme.mjs';
import { startServer, assetSrcs } from './lib/server.mjs';
import { launchBrowser, guardNetwork } from './lib/browser.mjs';
import { findFfmpeg, findFfprobe, encodeArgs, probeAudio, probeGraph, measureLoudness, draftSize, QUALITIES } from './lib/ffmpeg.mjs';
import { parseWorkers, captureInOrder } from './lib/workers.mjs';
import { specHasVideo, prepareVideo, videoAudioTracks } from './lib/video.mjs';
import { synthesiseCues } from './lib/cues.mjs';
import { resolveAsset, freshFile } from './lib/paths.mjs';
import { readRows, outTemplate, outputFor, collisionKey, columnWarnings, batchTempPath, tempClashes, inputClashes, recheckRows, checkManifestSlot, sha256File, writeManifest, NEEDS_TEMPLATE } from './lib/batch.mjs';
import { declaresVars, varValues, substituteVars } from '../template/vars.mjs';
import { withGeneratedBy, provenanceText, buildDate } from '../shared/provenance.mjs';
import { warnIfStaleCopy } from '../shared/stale-copy.mjs';
import { resolveAudio } from '../template/audio.mjs';
import { MOTION_THEME } from './lib/default-theme.mjs';
import { sheetMoments, tileSheet, PHONE_WIDTH } from './lib/sheet.mjs';
import { normalizeFile, normalizedPath, parseLoudnessFlag, parseTruePeakFlag, resolveTarget, parseFfmpegVersion, limiterSupported, ffmpegVersionLine, LIMITER_MIN_VERSION, LIMITER_NOTE_DB, NAME_MAX_BYTES } from './lib/loudness.mjs';

const PROGRESS_STEPS = 10;
const MAX_FPS = 120;
const MIN_SIDE = 16;
const MAX_SIDE = 3840;
const FFMPEG_GRACE_MS = 2000;
const FRAME_DIR_RETRIES = 5;
const FRAME_DIR_RETRY_MS = 100;
const EXIT_SIGINT = 130;
const EXIT_SIGTERM = 143;
const USAGE = 'usage: node scripts/render.mjs <motion.json> [--out <file>] [--fps n] [--size WxH] [--theme <name>] [--model <m>] [--effort <e>] [--agent <a>] [--workers n|auto] [--quality draft|final] [--loudness <lufs>|off] [--true-peak <dbtp>] [--contact-sheet] [--batch <rows.json> --out "<dir>/{index}.mp4"]';
const VALUE_FLAGS = ['--out', '--fps', '--size', '--theme', '--model', '--effort', '--agent', '--workers', '--quality', '--loudness', '--true-peak', '--batch'];
const FLAGS = [...VALUE_FLAGS, '--contact-sheet'];

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
    else if (VALUE_FLAGS.includes(a)) opts[a.slice(2)] = takeValue(argv, i++, a);
    else if (a.startsWith('--')) {
      const near = didYouMean(a, FLAGS);
      throw new UsageError(`unknown option ${a}${near ? `; did you mean ${near}?` : ''} (accepted: ${FLAGS.join(', ')})`);
    }
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
  checkLoudness(opts);
  checkBatch(opts);
  return opts;
}

// --batch writes one MP4 per row, so --out must name each row's file; the template's names are checked against the spec's
// vars once it is loaded (outTemplate). Without --batch, a placeholder in --out is a forgotten --batch, not a file name.
const OUT_PLACEHOLDER = /\{(index|[a-z][a-zA-Z0-9_]*)\}/;
function checkBatch(opts) {
  const placeholder = OUT_PLACEHOLDER.exec(path.basename(opts.out ?? '')); // a folder may be named {draft}
  if (opts.batch === undefined && placeholder) {
    throw new UsageError(`--out has a ${placeholder[0]} placeholder but no --batch; add --batch <rows.json>, or write the file name without braces`);
  }
  if (opts.batch === undefined) return;
  if (opts.contact) throw new UsageError('--batch does not apply to --contact-sheet (a batch writes one MP4 per row); leave one out');
  if (!/\{[^{}]*\}/.test(opts.out ?? '')) throw new UsageError(NEEDS_TEMPLATE);
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

// --loudness and --true-peak: a value out of range is a usage error, and so is one a contact sheet would ignore. Whether
// there is a target for --true-peak to apply to depends on the spec, so resolveTarget decides that once it is loaded.
function checkLoudness(opts) {
  const peak = opts['true-peak'];
  delete opts['true-peak'];
  if (opts.contact && opts.loudness !== undefined) throw new UsageError('--loudness does not apply to --contact-sheet (a sheet has no audio); leave it out');
  if (opts.contact && peak !== undefined) throw new UsageError('--true-peak does not apply to --contact-sheet (a sheet has no audio); leave it out');
  if (opts.loudness !== undefined) opts.loudness = parseLoudnessFlag(opts.loudness);
  if (peak !== undefined) opts.truePeak = parseTruePeakFlag(peak);
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

// The spec as it renders with one batch row's `values` (`{}`: the defaults), as `{ errors }` or `{ errors: [], raw, served }`.
// Its vars are checked and substituted first, then its beats resolved (a var may feed a beat index, and each row resolves
// after its own substitution), and only then are --model/--effort/--agent stamped into its generatedBy, so a flag's value
// is never substituted. `served` is the spec without that stamp: what a batch row's page draws. Then the spec's own checks,
// and (with --fps, which replaces the spec's frame rate after validation) the checks that depend on the frame rate: a
// typing text's or code's last frame, a block's own schedule (a terminal-run's last line) and a block's typing parts,
// which frameRateErrors names by param.
function specErrors(opts, loaded, dir, values) {
  const varErrors = checkVars(loaded, values);
  if (varErrors.length) return { errors: varErrors };
  const beats = resolveSpecBeats(substituteVars(loaded, values), dir);
  if (beats.errors) return { errors: beats.errors };
  const raw = withGeneratedBy(beats.spec, { model: opts.model, effort: opts.effort, agent: opts.agent });
  const result = validateSpec(raw, { dir });
  if (!result.ok) return { errors: result.errors };
  return { errors: opts.fps === undefined ? [] : frameRateErrors(raw, opts.fps), raw, served: beats.spec };
}

// Validate the spec and work out every input before launching anything.
async function plan(opts, state) {
  const { spec: loaded, dir } = loadSpec(opts.spec);
  const { errors, raw, served } = specErrors(opts, loaded, dir, {});
  if (errors.length) {
    printResult({ ok: false, errors }, { label: opts.spec });
    return null;
  }
  // A spec that names beats is drawn from the very spec that was just checked, not read again from the file (a beats file
  // edited in between would resolve to times nobody validated); any other spec is served as the file, as ever.
  return prepare(opts, { raw, loaded, dir, served: declaresBeats(loaded) ? served : undefined }, state);
}

// Every input of one render of `raw` (valid: plan and planBatch checked it). `served`: the spec the page draws in place
// of the file (a batch row's); `out`: the MP4 (a batch row's), else --out or the default; `partial`: where it encodes
// before the rename (a batch row's batchTempPath), else <name>.partial<ext> beside it.
async function prepare(opts, { raw, loaded, dir, served, out, partial }, state) {
  const spec = withDefaults(raw);
  const specPath = path.resolve(opts.spec);
  const fps = opts.fps ?? spec.fps;
  const total = spec.scenes.reduce((a, s) => a + s.duration, 0);
  const frames = frameCount(total, fps); // template/frames.mjs: the grid every cut-off check judges against
  if (!opts.contact && frames < 1) throw new UsageError(`spec is too short for ${fps} fps: no frames to render`);
  const name = path.basename(specPath, path.extname(specPath));
  const defaultOut = opts.contact ? path.join(dir, 'out') : path.join(dir, 'out', `${name}.mp4`);
  // A single MP4 render (a batch checked its rows in planBatch) never replaces a file it reads: the spec, or a clip,
  // image, sound or captions file it names. Exit 2 before anything is written.
  if (out === undefined && !opts.contact) {
    const output = path.resolve(opts.out ?? defaultOut);
    const inputs = [{ file: specPath, what: 'the spec' }, ...assetSrcs(raw).map((src) => ({ file: path.resolve(dir, String(src)), what: src }))];
    const [clash] = inputClashes([{ index: 0, out: output }], inputs, { reader: 'this render', fix: 'choose another --out' });
    if (clash) throw new UsageError(`--out: ${clash.message}`);
  }
  // Video elements need ffmpeg to decode their frames, contact sheets included.
  const hasVideo = specHasVideo(spec);
  const ffmpeg = opts.contact && !hasVideo ? null : await findFfmpeg();
  const ffprobe = hasVideo ? findFfprobe({ ffmpeg }) : null;
  const quality = opts.quality ?? 'final';
  const size = opts.size ?? spec.size;
  const loudness = loudnessFor(opts, spec);
  return {
    theme: opts.theme, themeName: substituteVars(loaded).theme ?? opts.theme ?? MOTION_THEME, spec, served, specPath, fps, frames, total, contact: opts.contact, quality,
    // A draft page is half the size: the stage scales to fit it exactly as it does for --size, so captions, the safe area and fonts shrink with it.
    size: quality === 'draft' ? draftSize(size) : size,
    workers: opts.workers,
    loudness: loudness.target, loudnessReport: loudness.report, loudnessFlagged: loudness.flagged, loudnessOff: loudness.off,
    out: out ?? path.resolve(opts.out ?? defaultOut), partial, ffmpeg,
    metadata: { comment: provenanceText('make-motion', spec.generatedBy, buildDate()), artist: spec.generatedBy?.model },
    videoFrames: hasVideo ? prepareVideo(spec, dir, ffmpeg, ffprobe, fps) : {},
    ...(opts.contact ? { audio: [] } : planAudio(spec, dir, ffmpeg, ffprobe, fps, total, state)),
  };
}

// The `loudness` target a render normalises to (`target`: flags, then the spec's field; null for none or off) and the one
// it reports against (`report`: the same, or the spec's own when --loudness off skipped the normalising). `flagged`: a flag
// asked for it, so a spec with no audio says it ignored it. A usage error for a flag with nothing to apply to: raised for a
// batch's rows up front too, in planBatch.
function loudnessFor(opts, spec) {
  const target = resolveTarget(opts, spec.loudness);
  return { target, report: target ?? spec.loudness, off: opts.loudness === 'off', flagged: target !== null && (typeof opts.loudness === 'number' || opts.truePeak !== undefined) };
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

// Before any browser is launched: the temp files of this render must have names the file system takes (255 bytes). The
// normalised copy's is nine bytes longer than the encode's (a batch checked both in planBatch). A usage error (exit 2).
function checkTempNames(p) {
  if (p.contact) return;
  const partial = p.partial ?? partialPath(p.out);
  const names = [partial, ...(p.loudness && p.audio.length ? [normalizedPath(partial)] : [])];
  for (const name of names) {
    const bytes = Buffer.byteLength(path.basename(name));
    if (bytes > NAME_MAX_BYTES) throw new UsageError(`--out: the temporary file name ${path.basename(name)} is ${bytes} bytes; at most ${NAME_MAX_BYTES}, so shorten the --out file name${name === partial ? '' : ', or pass --loudness off'}`);
  }
}

// One page: seek, screenshot, encode, frame by frame. Several pages: they take the frames in turn, write PNG files (at
// most two per page at once) and the encoder takes the frames in order (workers.mjs); every frame is the same bytes
// whichever page draws it.
async function renderVideo(pages, p, state) {
  mkdirSync(path.dirname(p.out), { recursive: true });
  state.partial = p.partial ?? partialPath(p.out);
  freshFile(state.partial); // a symlink left at the temp name is replaced by a new file before ffmpeg -y opens it by name (not race-proof)
  if (p.loudnessFlagged && !p.audio.length) process.stderr.write('loudness: this spec has no audio, so --loudness and --true-peak are ignored\n');
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
  const finished = p.loudness && p.audio.length ? await normalise(p, state) : state.partial;
  renameSync(finished, p.out);
  rmSync(state.partial, { force: true }); // the encode, when the normalised copy replaced it (else it was just renamed away)
  Object.assign(state, { partial: null, normalized: null });
  process.stdout.write(`${p.out}\n${p.frames} frames @ ${p.fps} fps, ${p.size.join('x')}\n`);
  if (p.audio.length) reportLoudness(p.ffmpeg, p.out, p.loudnessReport, p.loudnessOff);
}

// The two-pass loudnorm from the encode (state.partial) into a second fresh temp; returns the file to rename onto the
// output: the normalised temp, or the encode itself when the mix is silent (nothing to scale). cleanup() removes the temp
// and stops ffmpeg if this is interrupted or fails.
async function normalise(p, state) {
  state.normalized = normalizedPath(state.partial);
  freshFile(state.normalized);
  // The limiter stage needs ffmpeg 5.1; an older one gets one gain, and a note, rather than a failure after the frames.
  const track = (job) => { state.job = job; };
  const { silent, unavailable, reduction } = await normalizeFile(p.ffmpeg, { input: state.partial, out: state.normalized, target: p.loudness.integrated, truePeak: p.loudness.truePeak, duration: p.total, limiter: () => limiterSupported(p.ffmpeg, track), track });
  state.job = null;
  if (unavailable) {
    const version = parseFfmpegVersion(ffmpegVersionLine(p.ffmpeg)); // for the message only; limiterSupported asked the ffmpeg itself
    process.stderr.write(`loudness: this mix needs the limiter stage to reach the target, which needs ffmpeg ${LIMITER_MIN_VERSION.major}.${LIMITER_MIN_VERSION.minor} or later (this is ${version ? `${version.major}.${version.minor}` : 'an ffmpeg that rejected the stage'}); it is normalised with a plain gain capped at the true-peak ceiling, so it may read off target\n`);
  }
  if (reduction > LIMITER_NOTE_DB) process.stderr.write(`loudness: the limiter reduces this mix's peaks by up to ${reduction} dB (more than ${LIMITER_NOTE_DB} dB) to reach ${p.loudness.integrated} LUFS; the mix is quiet or peaky for that target, so consider raising its level or lowering the target\n`);
  if (!silent) return state.normalized;
  process.stderr.write('loudness: the mix is silent, so there is nothing to normalise\n');
  rmSync(state.normalized, { force: true });
  state.normalized = null;
  return state.partial;
}

// The mix is on a `loudness` target when its integrated loudness is within this many LU of it and its true peak is at
// or below the target's.
const LOUDNESS_TOLERANCE_LU = 1;

// One line after any render with audio: how loud the mix came out; with a `loudness` target (a flag, or the spec's field:
// viral mode sets one), a second line measures the finished file against it. Information only; it never fails a render. A
// normalised mix reads `on target`; with `--loudness off` (`flagOff`) a mix that is not reads `off target; --loudness off`,
// so the line is not taken for a fault.
function reportLoudness(ffmpeg, file, target, flagOff = false) {
  const level = measureLoudness(ffmpeg, file);
  if (!level) return process.stderr.write('audio: loudness could not be measured\n');
  const db = (n, unit) => (Number.isFinite(n) ? `${n.toFixed(1)} ${unit}` : `silent (${unit})`);
  process.stdout.write(`audio: ${db(level.lufs, 'LUFS')} integrated, true peak ${db(level.truePeak, 'dBTP')}\n`);
  if (!target) return true;
  const on = Math.abs(level.lufs - target.integrated) <= LOUDNESS_TOLERANCE_LU && level.truePeak <= target.truePeak; // silence (-Infinity) is off
  process.stdout.write(`loudness: target ${target.integrated} LUFS / ${target.truePeak} dBTP; measured ${db(level.lufs, 'LUFS')} / ${db(level.truePeak, 'dBTP')} (${on ? 'on target' : flagOff ? 'off target; --loudness off' : 'off target'})\n`);
  return true;
}

// Cleanup is best effort: every step runs on its own, so one that fails (a permission error, a busy file) is named on
// stderr and never skips the rest (the cue folder, the browser) or escapes a batch row.
async function attempt(label, step) {
  try { await step(); } catch (e) { process.stderr.write(`cleanup: ${label}: ${e.message}\n`); }
}

// Each field is cleared once handled, so a batch can use the same state for its next row.
async function cleanup(state) {
  await attempt('encoder', () => state.encoder?.kill());
  await attempt('loudnorm pass', () => state.job?.kill()); // before its temp files go, so ffmpeg cannot write one back
  await attempt('browser', () => state.browser?.close());
  if (state.partial) await attempt(state.partial, () => rmSync(state.partial, { force: true }));
  if (state.normalized) await attempt(state.normalized, () => rmSync(state.normalized, { force: true }));
  // A screenshot a page had already taken can land in the folder while it is removed (an interrupt), so retry on ENOTEMPTY.
  if (state.frameDir) await attempt(state.frameDir, () => rmSync(state.frameDir, { recursive: true, force: true, maxRetries: FRAME_DIR_RETRIES, retryDelay: FRAME_DIR_RETRY_MS }));
  if (state.cueDir) await attempt(state.cueDir, () => rmSync(state.cueDir, { recursive: true, force: true }));
  Object.assign(state, { encoder: null, job: null, browser: null, partial: null, normalized: null, frameDir: null, cueDir: null });
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

// One planned render (plan or prepare): the server, the pages, the frames. Throws on failure; cleans up either way.
async function runRender(p, state) {
  process.stdout.write(`theme: ${p.themeName}\n`);
  const pageCount = p.contact ? 1 : Math.min(p.workers, p.frames); // no page without a frame to take
  if (p.quality === 'draft') process.stderr.write(`quality: draft (${p.size.join('x')})\n`);
  if (pageCount > 1) process.stderr.write(`workers: ${pageCount}\n`);
  let server;
  try {
    checkTempNames(p);
    // Frames of a parallel render wait here, outside the spec folder; cleanup() removes the folder on every exit.
    if (pageCount > 1) state.frameDir = mkdtempSync(path.join(os.tmpdir(), 'motion-frames-'));
    server = await startServer({ specPath: p.specPath, mode: 'render', theme: p.theme, videoFrames: p.videoFrames, spec: p.served });
    const pages = await openPages(p, server, state, pageCount);
    const info = await pages[0].evaluate(() => ({ sceneStarts: window.__motion.sceneStarts }));
    await (p.contact ? renderContactSheets(pages[0], p, info, state.browser) : renderVideo(pages, p, state));
  } catch (e) {
    if (state.exiting) await new Promise(() => {}); // the signal handler owns the exit
    throw e;
  } finally {
    if (!state.exiting) await cleanup(state); // also removes the cue folder when the server never started
    await server?.close();
  }
}

// Every row of a batch, checked before anything renders: its values against the spec's vars, the spec with them
// substituted (every validator path, so a value that names a file outside the spec folder fails where it lands), the
// frame-rate checks, and its output file (inside the --out folder, and neither another row's output nor another row's
// temp file). The --out folder must not hold a manifest.json that is not a batch's (exit 2). Prints every failure as
// `row <i>: <path>: <message>` and returns null when there is one; extra columns are only warnings on stderr.
function planBatch(opts) {
  const { spec: loaded, dir } = loadSpec(opts.spec);
  const rows = readRows(opts.batch);
  const template = outTemplate(opts.out, declaresVars(loaded) && loaded.vars !== null && typeof loaded.vars === 'object' ? Object.keys(loaded.vars) : []);
  checkManifestSlot(template.dir);
  const errors = [];
  const jobs = [];
  const taken = new Map();
  const fail = (index, list) => { errors.push(...list.map((e) => `row ${index}: ${e.path || '(root)'}: ${e.message}`)); };
  rows.forEach((row, index) => {
    for (const warning of columnWarnings(loaded, row)) process.stderr.write(`row ${index}: ${warning}\n`);
    const { errors: problems, raw, served } = specErrors(opts, loaded, dir, row);
    if (problems.length) return fail(index, problems);
    const normalised = resolveTarget(opts, withDefaults(raw).loudness) !== null; // a --true-peak with no target fails the whole batch (exit 2), not row by row
    const values = varValues(loaded, row);
    const target = outputFor(template, index, values, { normalised });
    if (target.error) return fail(index, [{ path: '--out', message: target.error }]);
    const key = collisionKey(target.out);
    if (taken.has(key)) return fail(index, [{ path: '--out', message: `${path.basename(target.out)} is also row ${taken.get(key)}'s output; add {index} to --out, or give the rows different values` }]);
    taken.set(key, index);
    return jobs.push({ index, values, out: target.out, partial: batchTempPath(target.out, index), raw, served });
  });
  // No row may encode over, or be renamed onto, another row's MP4 (batchTempPath keeps temps out of reach of outputs).
  for (const clash of tempClashes(jobs)) fail(clash.index, [clash]);
  for (const clash of tempClashes(jobs.map((job) => ({ ...job, partial: normalizedPath(job.partial) })))) fail(clash.index, [clash]); // --loudness' second temp
  // Nor onto a file the batch reads: the spec, the rows, or any row's clip, image, sound or captions (a later row decodes it).
  const inputs = [{ file: opts.spec, what: 'the spec' }, { file: opts.batch, what: 'the rows file' },
    ...jobs.flatMap((job) => assetSrcs(job.served).map((src) => ({ file: path.resolve(dir, String(src)), what: src })))];
  for (const clash of inputClashes(jobs, inputs)) fail(clash.index, [clash]);
  if (!errors.length) return { jobs, dir, folder: template.dir };
  for (const line of errors) process.stdout.write(`${line}\n`);
  process.stdout.write(`${opts.batch}: ${errors.length} error${errors.length === 1 ? '' : 's'}; nothing rendered\n`);
  return null;
}

// One row after another; a row that fails is recorded as failed (its partial MP4 removed by cleanup) and the rest still
// render. Each row encodes into its own hidden temp file and is renamed onto its output only when complete, so an older
// file under that name is replaced on success and left as it was on failure: a reader judges a row by its `status`, and
// a `failed` row's `out` is never vouched for. The manifest is rewritten after every row, and once more after the last,
// with every ok row's file checked again (recheckRows; failed rows pass through by status). Exit 1 when any row failed.
async function renderBatch(opts, state) {
  const batch = planBatch(opts);
  if (!batch) return 1;
  const rows = [];
  for (const job of batch.jobs) {
    process.stdout.write(`row ${job.index}: ${job.out}\n`);
    const entry = { index: job.index, vars: { ...job.values }, status: 'failed', out: path.basename(job.out), sha256: null, duration: null };
    try {
      const p = await prepare(opts, { raw: job.raw, loaded: job.served, served: job.served, dir: batch.dir, out: job.out, partial: job.partial }, state);
      entry.duration = p.total;
      await runRender(p, state);
      Object.assign(entry, { status: 'ok', sha256: sha256File(job.out) }); // the final file, after the rename
    } catch (e) {
      if (state.exiting) await new Promise(() => {}); // the signal handler owns the exit
      await cleanup(state); // a row that failed while planning (its cue folder) as well as while rendering
      entry.error = String(e.message).split('\n')[0];
      process.stderr.write(`row ${job.index}: failed: ${entry.error}\n`);
    }
    rows.push(entry);
    writeManifest(batch.folder, rows);
  }
  const checked = recheckRows(batch.folder, rows);
  checked.forEach((row, i) => { if (row.status !== rows[i].status) process.stderr.write(`row ${row.index}: failed: ${row.error}\n`); });
  const manifest = writeManifest(batch.folder, checked);
  const failed = checked.filter((r) => r.status === 'failed').length;
  process.stdout.write(`${manifest}\n${checked.length - failed} of ${checked.length} rows rendered${failed ? `, ${failed} failed` : ''}\n`);
  return failed ? 1 : 0;
}

async function main() {
  warnIfStaleCopy();
  // The handlers go in before planning: planning writes the cue folder, and an interrupt with no handler would kill the
  // process and leave it behind.
  const state = { encoder: null, job: null, browser: null, partial: null, normalized: null, frameDir: null, cueDir: null, exiting: false };
  installSignalHandlers(state);
  const opts = parseArgs(process.argv.slice(2));
  if (opts.batch !== undefined) return renderBatch(opts, state);
  const p = await plan(opts, state);
  if (!p) return 1;
  await runRender(p, state);
  return 0;
}

main().then((code) => process.exit(code), (e) => {
  process.stderr.write(`${e.message}\n`);
  process.exit(e instanceof UsageError ? 2 : 1);
});
