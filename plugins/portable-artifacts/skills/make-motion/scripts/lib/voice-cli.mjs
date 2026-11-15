// The body of scripts/voice.mjs, importable so a test can run it without the voice stack or the model.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { UsageError } from './spec.mjs';
import { parseVoiceArgs, loadKokoro, loadModel, synthesize, sidecarPath, phonemeLines } from './voice.mjs';

function listVoices(voices, write) {
  for (const [name, info] of Object.entries(voices ?? {})) {
    write(`${name}\t${info.language ?? ''}\t${info.gender ?? ''}\t${info.overallGrade ?? ''}\n`);
  }
}

async function run(opts, tts, kokoro, write) {
  if (!Object.hasOwn(tts.voices ?? {}, opts.voice)) throw new UsageError(`unknown voice "${opts.voice}"; run --list-voices`);
  const out = path.resolve(opts.out);
  mkdirSync(path.dirname(out), { recursive: true });
  const { seconds, sentences } = await synthesize(tts, kokoro, { ...opts, out });
  write(`${out}\n${seconds.toFixed(2)} s, ${opts.voice}\n${sidecarPath(out)}\n`);
  if (opts.phonemes) write(phonemeLines(sentences));
}

// The model session is always disposed before the process ends, on success and on failure:
// exiting with a live onnxruntime session aborts with "mutex lock failed" (SIGABRT), and so does
// process.exit(), so the caller sets the exit code and leaves the event loop to drain.
// `deps` replaces the voice stack, the model loader and the output, for tests.
export async function runVoiceCli(argv, deps = {}) {
  const {
    loadKokoro: load = loadKokoro,
    loadModel: loadTts = loadModel,
    write = (text) => process.stdout.write(text),
    log = (line) => process.stderr.write(`voice: ${line}\n`),
  } = deps;
  const opts = parseVoiceArgs(argv);
  const kokoro = await load();
  // The voice list is a constant in kokoro-js, so listing needs neither the 92 MB model nor a download.
  if (opts.listVoices) { listVoices(kokoro.KokoroTTS.prototype.voices, write); return; }
  const tts = await loadTts(kokoro, { log });
  try {
    await run(opts, tts, kokoro, write);
  } finally {
    await tts.model.dispose();
  }
}
