#!/usr/bin/env node
// node scripts/voice.mjs "<text>" --out <file.wav> [--voice af_heart] [--speed 1]
// node scripts/voice.mjs --text-file narration.txt --out <file.wav>   (no shell expansion of $ or backticks)
// node scripts/voice.mjs --list-voices
// Synthesises a voiceover clip locally with Kokoro; reference the wav from motion.json `audio[].src`.
// Also writes <file>.json beside it with every sentence's start and end second (a captions `src`).
// Prints three lines: the wav path, "<seconds> s, <voice>", and the sidecar path.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { UsageError } from './lib/spec.mjs';
import { parseVoiceArgs, loadKokoro, loadModel, synthesize, sidecarPath, USAGE, INSTALL_HINT } from './lib/voice.mjs';

const EXIT_USAGE = 2;
const EXIT_FAILURE = 1;

function listVoices(tts) {
  for (const [name, info] of Object.entries(tts.voices ?? {})) {
    process.stdout.write(`${name}\t${info.language ?? ''}\t${info.gender ?? ''}\t${info.overallGrade ?? ''}\n`);
  }
}

async function run(opts, tts, kokoro) {
  if (opts.listVoices) { listVoices(tts); return; }
  if (!Object.hasOwn(tts.voices ?? {}, opts.voice)) throw new UsageError(`unknown voice "${opts.voice}"; run --list-voices`);
  const out = path.resolve(opts.out);
  mkdirSync(path.dirname(out), { recursive: true });
  const { seconds } = await synthesize(tts, kokoro, { ...opts, out });
  process.stdout.write(`${out}\n${seconds.toFixed(2)} s, ${opts.voice}\n${sidecarPath(out)}\n`);
}

// The model session is always disposed before the process ends, on success and on failure:
// exiting with a live onnxruntime session aborts with "mutex lock failed" (SIGABRT), and so does
// process.exit(), so the exit code is set and the event loop is left to drain.
async function main() {
  const opts = parseVoiceArgs(process.argv.slice(2));
  const kokoro = await loadKokoro();
  const tts = await loadModel(kokoro);
  try {
    await run(opts, tts, kokoro);
  } finally {
    await tts.model.dispose();
  }
}

main().catch((e) => {
  process.stderr.write(`${e.message}\n`);
  const usage = e instanceof UsageError;
  if (usage && e.message !== USAGE && e.message !== INSTALL_HINT) process.stderr.write(`${USAGE}\n`);
  process.exitCode = usage ? EXIT_USAGE : EXIT_FAILURE;
});
