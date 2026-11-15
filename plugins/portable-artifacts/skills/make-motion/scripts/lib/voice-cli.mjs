// The body of scripts/voice.mjs, imported only after its preflight found node_modules (it imports ajv through spec.mjs).
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
// The first run downloads about 90 MB of model files: progress goes to stderr. --help exits 0.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { UsageError } from './spec.mjs';
import { wantsHelp, printHelp } from './help.mjs';
import { voiceListText } from './voice-list.mjs';
import { parseVoiceArgs, loadKokoro, loadModel, synthesize, synthesizeDir, assertVoice, sidecarPath, phonemeLines, USAGE, INSTALL_HINT } from './voice.mjs';

const EXIT_USAGE = 2;
const EXIT_FAILURE = 1;

async function loadSession() {
  const kokoro = await loadKokoro();
  const tts = await loadModel(kokoro);
  return { kokoro, tts, dispose: () => tts.model.dispose() };
}

async function runOne(opts) {
  const session = await loadSession();
  try {
    assertVoice(session.tts, opts.voice);
    const out = path.resolve(opts.out);
    mkdirSync(path.dirname(out), { recursive: true });
    const { seconds, sentences } = await synthesize(session.tts, session.kokoro, { ...opts, out });
    process.stdout.write(`${out}\n${seconds.toFixed(2)} s, ${opts.voice}\n${sidecarPath(out)}\n`);
    if (opts.phonemes) process.stdout.write(phonemeLines(sentences));
  } finally {
    await session.dispose();
  }
}

async function runDir(opts) {
  const results = await synthesizeDir(opts, { load: loadSession });
  for (const { job, seconds, skipped } of results) process.stdout.write(`${job.out}\t${skipped ? 'unchanged' : `${seconds.toFixed(2)} s, ${opts.voice}`}\n`);
}

// The model session is always disposed before the process ends, on success and on failure:
// exiting with a live onnxruntime session aborts with "mutex lock failed" (SIGABRT), and so does
// process.exit(), so the exit code is set and the event loop is left to drain.
async function main() {
  const argv = process.argv.slice(2);
  if (wantsHelp(argv)) return printHelp(USAGE);
  const opts = parseVoiceArgs(argv);
  if (opts.listVoices) {
    process.stdout.write(voiceListText());
    return undefined;
  }
  return opts.dir === undefined ? runOne(opts) : runDir(opts);
}

export function run() {
  return main().catch((e) => {
    process.stderr.write(`${e.message}\n`);
    const usage = e instanceof UsageError;
    if (usage && e.message !== USAGE && e.message !== INSTALL_HINT) process.stderr.write(`${USAGE}\n`);
    process.exitCode = usage ? EXIT_USAGE : EXIT_FAILURE;
  });
}
