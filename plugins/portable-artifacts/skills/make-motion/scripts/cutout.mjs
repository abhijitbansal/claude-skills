#!/usr/bin/env node
// node scripts/cutout.mjs <photo.png|clip.mp4> [--out <dir>] [--fps n]
// Cuts the person out of a photo (writes <out>/<stem>.png, RGBA) or a clip (writes <out>/<stem>.webm, VP9 with alpha, no
// sound) with MODNet, locally. <out> defaults to a `cutout` folder next to the input. Prints the path written.
// Pass the original as `src` and this file as `cutout` of a `text-behind-subject` block.
// Needs `doctor --fix cutout` (onnxruntime-node, on demand); the 25 MB weights download once on first use.
import { existsSync } from 'node:fs';
import { UsageError } from './lib/spec.mjs';
import { launchBrowser } from './lib/browser.mjs';
import { findFfmpeg, findFfprobe } from './lib/ffmpeg.mjs';
import { probeVideo } from './lib/video.mjs';
import { USAGE, INSTALL_HINT, parseCutoutArgs, loadOnnx, ensureModel, openCanvasPage, cutoutImage, cutoutVideo, clipFps } from './lib/cutout.mjs';

const EXIT_USAGE = 2;
const EXIT_FAILURE = 1;
const log = (line) => process.stderr.write(`${line}\n`);

async function cutOut(opts, tools) {
  if (opts.kind === 'image') return cutoutImage({ ...tools, input: opts.input, output: opts.output });
  const ffmpeg = await findFfmpeg();
  const ffprobe = findFfprobe({ ffmpeg });
  if (!ffprobe) throw new Error('ffprobe not found (needed to read the clip); it comes with ffmpeg');
  const info = probeVideo(ffprobe, opts.input);
  if (info.error) throw new Error(`ffprobe cannot read ${opts.input}: ${info.error}`);
  return (await cutoutVideo({ ...tools, ffmpeg, info, input: opts.input, output: opts.output, fps: clipFps(opts.fps, info), log })).output;
}

// The model session is always released before the process ends, on success and on failure: exiting with a live
// onnxruntime session aborts with "mutex lock failed" (SIGABRT), and so does process.exit(), so the exit code is set and
// the event loop is left to drain (the same rule as voice.mjs).
async function main() {
  const opts = parseCutoutArgs(process.argv.slice(2));
  if (!existsSync(opts.input)) throw new UsageError(`cannot read ${opts.input}: no such file`);
  const ort = await loadOnnx();
  const model = await ensureModel({ log });
  const session = await ort.InferenceSession.create(model);
  let browser;
  try {
    browser = await launchBrowser({ quiet: true });
    const page = await openCanvasPage(browser);
    process.stdout.write(`${await cutOut(opts, { session, ort, page })}\n`);
  } finally {
    await browser?.close();
    await session.release();
  }
}

main().catch((e) => {
  process.stderr.write(`${e.message}\n`);
  const usage = e instanceof UsageError;
  if (usage && e.message !== USAGE && e.message !== INSTALL_HINT) process.stderr.write(`${USAGE}\n`);
  process.exitCode = usage ? EXIT_USAGE : EXIT_FAILURE;
});
