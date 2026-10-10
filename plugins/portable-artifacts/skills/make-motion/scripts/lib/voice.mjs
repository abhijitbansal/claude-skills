// Voiceover synthesis with Kokoro (kokoro-js, Apache-2.0), run locally on the CPU.
// kokoro-js is installed on demand (it pulls onnxruntime, ~250 MB), never by `npm ci`.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError } from './spec.mjs';

const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const MODEL_CACHE_DIR = path.join(SKILL_ROOT, '.cache', 'models');
export const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
export const DEFAULT_VOICE = 'af_heart';
export const SAMPLE_RATE = 24000;
const MIN_SPEED = 0.5;
const MAX_SPEED = 2;
const DTYPE = 'q8'; // ~90 MB download on first use

export const USAGE = 'usage: node scripts/voice.mjs "<text>" --out <file.wav> [--voice af_heart] [--speed 1] | --list-voices';
export const INSTALL_HINT = 'kokoro-js is not installed. Run: npm install kokoro-js@1.2.1 --no-save --prefix <skill-dir>'
  + ' (about 250 MB; the voice model, about 90 MB, downloads once on first use)';

function takeValue(argv, i, flag) {
  const value = argv[i + 1];
  if (value === undefined || value.startsWith('--')) throw new UsageError(`${flag} needs a value`);
  return value;
}

export function parseVoiceArgs(argv) {
  const opts = { text: null, out: null, voice: DEFAULT_VOICE, speed: 1, listVoices: false };
  const texts = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--list-voices') opts.listVoices = true;
    else if (a === '--out' || a === '--voice' || a === '--speed') opts[a.slice(2)] = takeValue(argv, i++, a);
    else if (a.startsWith('--')) throw new UsageError(`unknown option ${a}`);
    else texts.push(a);
  }
  if (opts.listVoices) return opts;
  if (texts.length === 0) throw new UsageError(USAGE);
  if (texts.length > 1) throw new UsageError('pass exactly one text argument (quote it)');
  opts.text = texts[0];
  if (!opts.out) throw new UsageError('--out <file.wav> is required');
  if (path.extname(opts.out).toLowerCase() !== '.wav') throw new UsageError('--out must end in .wav');
  opts.speed = Number(opts.speed);
  if (!Number.isFinite(opts.speed) || opts.speed < MIN_SPEED || opts.speed > MAX_SPEED) {
    throw new UsageError(`--speed must be a number from ${MIN_SPEED} to ${MAX_SPEED}`);
  }
  return opts;
}

// The kokoro-js module, or a UsageError with the install command when it is absent.
export async function loadKokoro() {
  try {
    return await import('kokoro-js');
  } catch (e) {
    if (e?.code === 'ERR_MODULE_NOT_FOUND') throw new UsageError(INSTALL_HINT);
    throw e;
  }
}

export async function loadModel(kokoro) {
  const { env } = await import('@huggingface/transformers');
  env.cacheDir = MODEL_CACHE_DIR; // survives `npm ci`, which wipes node_modules
  return kokoro.KokoroTTS.from_pretrained(MODEL_ID, { dtype: DTYPE, device: 'cpu' });
}

// Writes a 24 kHz mono wav and returns its duration in seconds. The text is synthesised
// sentence by sentence (generate() truncates at ~510 tokens) and joined.
export async function synthesize(tts, kokoro, { text, voice, speed, out }) {
  const { RawAudio } = await import('@huggingface/transformers');
  // A plain string passed to tts.stream() is never closed, so the last sentence hangs forever.
  const splitter = new kokoro.TextSplitterStream();
  splitter.push(text);
  splitter.close();
  const chunks = [];
  for await (const { audio } of tts.stream(splitter, { voice, speed })) chunks.push(audio.audio);
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const joined = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) { joined.set(c, offset); offset += c.length; }
  await new RawAudio(joined, SAMPLE_RATE).save(out);
  return total / SAMPLE_RATE;
}
