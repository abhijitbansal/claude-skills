#!/usr/bin/env node
// node scripts/voice.mjs "<text>" --out <file.wav> [--voice af_heart] [--speed 1] [--phonemes]
// node scripts/voice.mjs --text-file narration.txt --out <file.wav> [--phonemes]   (no shell expansion of $ or backticks)
// node scripts/voice.mjs --dir <folder> [--voice af_heart] [--speed 1]   (every .txt in the folder -> <name>.wav beside it)
// node scripts/voice.mjs --list-voices   (a static table: no model is loaded or downloaded)
// Synthesises a voiceover clip locally with Kokoro; the full description is at the top of lib/voice-cli.mjs. --help exits 0.
// A thin entry: it checks for node_modules with Node built-ins only, then loads the body (lib/voice-cli.mjs), which imports ajv
// through spec.mjs. Without node_modules the one line names the doctor command and the exit is 2 (shared/preflight.mjs).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preflight } from '../shared/preflight.mjs';

const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (preflight(SKILL_ROOT)) await (await import('./lib/voice-cli.mjs')).run();
