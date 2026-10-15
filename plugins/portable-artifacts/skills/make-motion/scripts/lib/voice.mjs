// Voiceover synthesis with Kokoro (kokoro-js, Apache-2.0), run locally on the CPU.
// kokoro-js is installed on demand (it pulls onnxruntime, ~250 MB), never by `npm ci`.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError } from './spec.mjs';
import { doctorCommand, npmInstallKokoro } from './doctor-hint.mjs';

const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const MODEL_CACHE_DIR = path.join(SKILL_ROOT, '.cache', 'models');
export const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
export const DEFAULT_VOICE = 'af_heart';
export const SAMPLE_RATE = 24000;
// Kokoro truncates one generate() call at ~510 phoneme tokens (~27 s). 300 characters stays well under it.
export const MAX_CHUNK_CHARS = 300;
const MIN_SPEED = 0.5;
const MAX_SPEED = 2;
const DTYPE = 'q8'; // ~90 MB download on first use
const CLAUSE_BREAK = /(?<=[,;:—–])\s+/;

export const USAGE = 'usage: node scripts/voice.mjs "<text>" | --text-file <file> --out <file.wav> [--voice af_heart] [--speed 1] | --list-voices';
export const INSTALL_HINT = `kokoro-js is not installed. Run: ${npmInstallKokoro()}`
  + ' (about 250 MB; the voice model, about 90 MB, downloads once on first use; '
  + `doctor: ${doctorCommand('--for', 'voiceover')}, id kokoro)`;

function takeValue(argv, i, flag) {
  const value = argv[i + 1];
  if (value === undefined || value.startsWith('--')) throw new UsageError(`${flag} needs a value`);
  return value;
}

function readTextFile(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch (e) {
    throw new UsageError(`--text-file: cannot read ${file}: ${e.code ?? e.message}`);
  }
}

export function parseVoiceArgs(argv) {
  const opts = { text: null, out: null, voice: DEFAULT_VOICE, speed: 1, listVoices: false };
  const texts = [];
  let textFile = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--list-voices') opts.listVoices = true;
    else if (a === '--text-file') textFile = takeValue(argv, i++, a);
    else if (a === '--out' || a === '--voice' || a === '--speed') opts[a.slice(2)] = takeValue(argv, i++, a);
    else if (a.startsWith('--')) throw new UsageError(`unknown option ${a}`);
    else texts.push(a);
  }
  if (opts.listVoices) return opts;
  if (texts.length === 0 && textFile === null) throw new UsageError(USAGE);
  if (texts.length > 0 && textFile !== null) throw new UsageError('pass either a text argument or --text-file, not both');
  if (texts.length > 1) throw new UsageError('pass exactly one text argument (quote it)');
  opts.text = (textFile === null ? texts[0] : readTextFile(textFile)).trim();
  if (opts.text === '') throw new UsageError('text is empty: nothing to say');
  if (!opts.out) throw new UsageError('--out <file.wav> is required');
  if (path.extname(opts.out).toLowerCase() !== '.wav') throw new UsageError('--out must end in .wav');
  opts.speed = Number(opts.speed);
  if (!Number.isFinite(opts.speed) || opts.speed < MIN_SPEED || opts.speed > MAX_SPEED) {
    throw new UsageError(`--speed must be a number from ${MIN_SPEED} to ${MAX_SPEED}`);
  }
  return opts;
}

// Greedy packing of `parts` into strings no longer than `max` characters, joined by `sep`.
function pack(parts, max, sep) {
  const out = [];
  let current = '';
  for (const part of parts) {
    const joined = current ? `${current}${sep}${part}` : part;
    if (joined.length <= max || !current) current = joined;
    else { out.push(current); current = part; }
  }
  if (current) out.push(current);
  return out;
}

// A sentence longer than `max`: split at clause breaks, then at word boundaries, and re-pack.
function splitLong(sentence, max) {
  if (sentence.length <= max) return [sentence];
  const clauses = sentence.split(CLAUSE_BREAK).flatMap((c) => (c.length <= max ? [c] : pack(c.split(/\s+/), max, ' ')));
  return pack(clauses, max, ' ');
}

// Sentences (via kokoro's splitter when given), each capped at MAX_CHUNK_CHARS so no chunk is ever truncated.
export function chunkText(text, splitter = null, max = MAX_CHUNK_CHARS) {
  const sentences = splitter ? [...splitter(text)] : text.split(/(?<=[.!?…])\s+/);
  return sentences.map((s) => s.trim()).filter(Boolean).flatMap((s) => splitLong(s, max));
}

// The kokoro-js module, or a UsageError with the install command when it is absent.
export async function loadKokoro() {
  try {
    return await import('kokoro-js');
  } catch (e) {
    if (e?.code === 'ERR_MODULE_NOT_FOUND' && /kokoro-js/.test(e.message)) throw new UsageError(INSTALL_HINT);
    throw e;
  }
}

export async function loadModel(kokoro) {
  const { env } = await import('@huggingface/transformers');
  env.cacheDir = MODEL_CACHE_DIR; // survives `npm ci`, which wipes node_modules
  return kokoro.KokoroTTS.from_pretrained(MODEL_ID, { dtype: DTYPE, device: 'cpu' });
}

// kokoro's sentence splitter as a plain function (its stream form never closes for a string input).
function kokoroSplitter(kokoro) {
  return (text) => {
    const stream = new kokoro.TextSplitterStream();
    stream.push(text);
    stream.close();
    return stream; // its sync iterator flushes and yields every sentence
  };
}

// Writes a 24 kHz mono wav and returns its duration in seconds. Each chunk is generated
// on its own so nothing is truncated, then the chunks are joined.
export async function synthesize(tts, kokoro, { text, voice, speed, out }) {
  const { RawAudio } = await import('@huggingface/transformers');
  const chunks = [];
  for (const chunk of chunkText(text, kokoroSplitter(kokoro))) {
    chunks.push((await tts.generate(chunk, { voice, speed })).audio);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const joined = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) { joined.set(c, offset); offset += c.length; }
  await new RawAudio(joined, SAMPLE_RATE).save(out);
  return total / SAMPLE_RATE;
}
