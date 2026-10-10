#!/usr/bin/env node
// node scripts/voice.mjs "<text>" --out <file.wav> [--voice af_heart] [--speed 1]
// node scripts/voice.mjs --list-voices
// Synthesises a voiceover clip locally with Kokoro; reference the wav from motion.json `audio[].src`.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { UsageError } from './lib/spec.mjs';
import { parseVoiceArgs, loadKokoro, loadModel, synthesize, USAGE } from './lib/voice.mjs';

function listVoices(tts) {
  const voices = tts.voices ?? {};
  for (const [name, info] of Object.entries(voices)) {
    process.stdout.write(`${name}\t${info.language ?? ''}\t${info.gender ?? ''}\t${info.overallGrade ?? ''}\n`);
  }
}

async function main() {
  const opts = parseVoiceArgs(process.argv.slice(2));
  const kokoro = await loadKokoro();
  const tts = await loadModel(kokoro);
  if (opts.listVoices) { listVoices(tts); return 0; }
  if (!(opts.voice in (tts.voices ?? {}))) throw new UsageError(`unknown voice "${opts.voice}"; run --list-voices`);
  const out = path.resolve(opts.out);
  mkdirSync(path.dirname(out), { recursive: true });
  const seconds = await synthesize(tts, kokoro, { ...opts, out });
  process.stdout.write(`${out}\n${seconds.toFixed(2)} s, ${opts.voice}\n`);
  await tts.model.dispose(); // onnxruntime aborts ("mutex lock failed") if the process exits with a live session
  return 0;
}

// Success returns normally: process.exit() while onnxruntime threads are alive crashes with SIGABRT.
main().then(() => {}, (e) => {
  process.stderr.write(`${e.message}\n`);
  if (e instanceof UsageError && e.message !== USAGE && !e.message.startsWith('kokoro-js')) process.stderr.write(`${USAGE}\n`);
  process.exit(e instanceof UsageError ? 2 : 1);
});
