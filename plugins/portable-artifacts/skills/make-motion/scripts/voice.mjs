#!/usr/bin/env node
// node scripts/voice.mjs "<text>" --out <file.wav> [--voice af_heart] [--speed 1] [--phonemes]
// node scripts/voice.mjs --text-file narration.txt --out <file.wav> [--phonemes]   (no shell expansion of $ or backticks)
// node scripts/voice.mjs --list-voices
// Synthesises a voiceover clip locally with Kokoro; reference the wav from motion.json `audio[].src`.
// Also writes <file>.json beside it with every sentence's start and end second (a captions `src`)
// and the phonemes Kokoro spoke for it.
// Prints three lines: the wav path, "<seconds> s, <voice>", and the sidecar path.
// With --phonemes, a "<sentence><TAB><phonemes>" line per sentence follows, to check how a word is read.
// The first synthesis downloads and checks the pinned Kokoro model files (about 92 MB); --list-voices does not.
import { UsageError } from './lib/spec.mjs';
import { USAGE, INSTALL_HINT } from './lib/voice.mjs';
import { runVoiceCli } from './lib/voice-cli.mjs';

const EXIT_USAGE = 2;
const EXIT_FAILURE = 1;

runVoiceCli(process.argv.slice(2)).catch((e) => {
  process.stderr.write(`${e.message}\n`);
  const usage = e instanceof UsageError;
  if (usage && e.message !== USAGE && e.message !== INSTALL_HINT) process.stderr.write(`${USAGE}\n`);
  process.exitCode = usage ? EXIT_USAGE : EXIT_FAILURE;
});
