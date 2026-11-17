// The body of scripts/voice.mjs, imported only after its preflight found node_modules (it imports ajv through spec.mjs), and
// importable so a test can run it without the voice stack or the model (runVoiceCli's deps).
// Usage, in the entry script:
// node scripts/voice.mjs "<text>" --out <file.wav> [--voice af_heart] [--speed 1] [--phonemes]
// node scripts/voice.mjs --text-file narration.txt --out <file.wav> [--phonemes]   (no shell expansion of $ or backticks)
// node scripts/voice.mjs --dir <folder> [--voice af_heart] [--speed 1]   (every .txt in the folder -> <name>.wav beside it)
// node scripts/voice.mjs --list-voices   (a static table: no model is loaded or downloaded)
// Synthesises a voiceover clip locally with Kokoro; reference the wav from motion.json `audio[].src`.
// Also writes <file>.json beside it with every sentence's start and end second (a captions `src`)
// and the phonemes Kokoro spoke for it.
// Prints three lines: the wav path, "<seconds> s, <voice>", and the sidecar path.
// With --phonemes, a "<sentence><TAB><phonemes>" line per sentence follows, to check how a word is read.
// --dir loads the model once for every narration and prints one line per file: "<wav><TAB><seconds> s, <voice>", or
// "<wav><TAB>unchanged" for one whose text, voice and speed match what its sidecar records (nothing loads if all do).
// The first run downloads and checks the pinned model files (about 92 MB): one line per file goes to stderr. --help exits 0.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { UsageError } from './spec.mjs';
import { wantsHelp, printHelp } from './help.mjs';
import { voiceListText } from './voice-list.mjs';
import { parseVoiceArgs, loadKokoro, loadModel, synthesize, synthesizeDir, assertVoice, sidecarPath, phonemeLines, USAGE, INSTALL_HINT } from './voice.mjs';

const EXIT_USAGE = 2;
const EXIT_FAILURE = 1;

async function runOne(opts, load, write) {
  const session = await load();
  try {
    assertVoice(session.tts, opts.voice);
    const out = path.resolve(opts.out);
    mkdirSync(path.dirname(out), { recursive: true });
    const { seconds, sentences } = await synthesize(session.tts, session.kokoro, { ...opts, out });
    write(`${out}\n${seconds.toFixed(2)} s, ${opts.voice}\n${sidecarPath(out)}\n`);
    if (opts.phonemes) write(phonemeLines(sentences));
  } finally {
    await session.dispose();
  }
}

async function runDir(opts, load, write) {
  const results = await synthesizeDir(opts, { load });
  for (const { job, seconds, skipped } of results) write(`${job.out}\t${skipped ? 'unchanged' : `${seconds.toFixed(2)} s, ${opts.voice}`}\n`);
}

// The model session is always disposed before the process ends, on success and on failure:
// exiting with a live onnxruntime session aborts with "mutex lock failed" (SIGABRT), and so does
// process.exit(), so the caller sets the exit code and leaves the event loop to drain.
// `deps` replaces the voice stack, the model loader and the output, for tests.
export async function runVoiceCli(argv, deps = {}) {
  const {
    loadKokoro: loadStack = loadKokoro,
    loadModel: loadTts = loadModel,
    write = (text) => process.stdout.write(text),
    log = (line) => process.stderr.write(`voice: ${line}\n`),
  } = deps;
  const opts = parseVoiceArgs(argv);
  // The voice list is a static table (voice-list.mjs), so listing needs neither the voice stack nor the 92 MB model.
  if (opts.listVoices) { write(voiceListText()); return; }
  const load = async () => {
    const kokoro = await loadStack();
    const tts = await loadTts(kokoro, { log });
    return { kokoro, tts, dispose: () => tts.model.dispose() };
  };
  await (opts.dir === undefined ? runOne(opts, load, write) : runDir(opts, load, write));
}

async function main() {
  const argv = process.argv.slice(2);
  if (wantsHelp(argv)) return printHelp(USAGE);
  return runVoiceCli(argv);
}

export function run() {
  return main().catch((e) => {
    process.stderr.write(`${e.message}\n`);
    const usage = e instanceof UsageError;
    if (usage && e.message !== USAGE && e.message !== INSTALL_HINT) process.stderr.write(`${USAGE}\n`);
    process.exitCode = usage ? EXIT_USAGE : EXIT_FAILURE;
  });
}
