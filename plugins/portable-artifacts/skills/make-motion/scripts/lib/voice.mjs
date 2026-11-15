// Voiceover synthesis with Kokoro (kokoro-js, Apache-2.0), run locally on the CPU.
// kokoro-js is installed on demand (`doctor --fix kokoro`: npm ci from optional/voice's lockfile, ~250 MB), never by the
// skill's own `npm ci`, and loaded from that folder (optional.mjs).
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError } from './spec.mjs';
import { doctorCommand, optionalInstall } from './doctor-hint.mjs';
import { importOptional } from './optional.mjs';
import { ensurePinnedFile } from './pinned-file.mjs';
import { sidecarPath } from './voice-sidecar.mjs';

const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const MODEL_CACHE_DIR = path.join(SKILL_ROOT, '.cache', 'models');
export const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
// The model (Apache-2.0) is downloaded by us, never by transformers.js: kokoro-js passes no revision, so transformers would
// read the branch head, unhashed. These are the four files it reads for dtype 'q8', at one commit, each with its SHA-256.
// Obtained 2026-11-15 with the command in docs/superpowers/plans/2026-11-15-pa2-security-pins.md Task 5 (main at that date);
// the model file's sha256 and size equal the Hugging Face LFS metadata for that commit. About 92 MB in all.
export const KOKORO_BASE_URL = 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/';
export const KOKORO_FILES = Object.freeze([
  Object.freeze({ file: 'config.json', sha256: 'df34b4f930b23447cd4dc410fabfb42eb3f24e803e6c3f97d618fb359380a36f', bytes: 44 }),
  Object.freeze({ file: 'tokenizer.json', sha256: '77a02c8e164413299b4b4c403b14f8e0e1c1b727db4d46a09d6327b861060a34', bytes: 3497 }),
  Object.freeze({ file: 'tokenizer_config.json', sha256: 'be1cb066d6ef6b074b3f15e6a6dd21ac88ff3cdaedf325f0aaed686c70f75d20', bytes: 113 }),
  Object.freeze({ file: 'onnx/model_quantized.onnx', sha256: 'fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478', bytes: 92361116 }),
]);
export const KOKORO_DIR = path.join(MODEL_CACHE_DIR, MODEL_ID);
export const DEFAULT_VOICE = 'af_heart';
export const SAMPLE_RATE = 24000;
// Kokoro truncates one generate() call at ~510 phoneme tokens (~27 s). 300 characters stays well under it.
export const MAX_CHUNK_CHARS = 300;
const MIN_SPEED = 0.5;
const MAX_SPEED = 2;
const DTYPE = 'q8'; // ~90 MB download on first use
const CLAUSE_BREAK = /(?<=[,;:—–])\s+/;

export const USAGE = 'usage: node scripts/voice.mjs "<text>" | --text-file <file> --out <file.wav> [--voice af_heart] [--speed 1] [--phonemes] | --list-voices';
export const INSTALL_HINT = `kokoro-js is not installed. Run: ${optionalInstall('kokoro')}`
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
  const opts = { text: null, out: null, voice: DEFAULT_VOICE, speed: 1, listVoices: false, phonemes: false };
  const texts = [];
  let textFile = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--list-voices') opts.listVoices = true;
    else if (a === '--phonemes') opts.phonemes = true;
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

// The voice stack (KokoroTTS, TextSplitterStream, env, RawAudio) from optional/voice, or a UsageError with the install command
// when it is absent. `opts` ({ root, importer, exists }) is for tests.
export const loadKokoro = (opts = {}) => importOptional({ name: 'voice', pkg: 'kokoro-js', hint: INSTALL_HINT, ...opts });

/**
 * The folder of the verified model files, downloading any that is absent or whose SHA-256 differs (see ensurePinnedFile).
 * Options replace the constants (tests); `log` receives one line before each download.
 */
export async function ensureKokoroModel({ dir = KOKORO_DIR, base = KOKORO_BASE_URL, files = KOKORO_FILES, fetchImpl = fetch, log = () => {} } = {}) {
  for (const { file, sha256, bytes } of files) {
    await ensurePinnedFile({ url: `${base}${file}`, sha256, bytes, file: path.join(dir, file), label: `Kokoro voice model file ${file}`, fetchImpl, log });
  }
  return dir;
}

// Points transformers.js at the verified folder and turns off remote loading and its file cache, so only bytes that
// ensureKokoroModel checked can reach the model (getModelFile tries the FS cache, then localModelPath, then remote).
// The folder survives `npm ci`, which wipes node_modules.
export function loadModel(kokoro, { root = MODEL_CACHE_DIR } = {}) {
  const { env } = kokoro;
  env.localModelPath = root;
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  env.useFSCache = false;
  return kokoro.KokoroTTS.from_pretrained(MODEL_ID, { dtype: DTYPE, device: 'cpu' });
}

// A closed kokoro TextSplitterStream holding `text`. tts.stream() waits forever on an open one.
function closedSplitter(kokoro, text) {
  const stream = new kokoro.TextSplitterStream();
  stream.push(text);
  stream.close();
  return stream; // its sync iterator flushes and yields every sentence
}

// kokoro's sentence splitter as a plain function (its stream form never closes for a string input).
const kokoroSplitter = (kokoro) => (text) => closedSplitter(kokoro, text);

const roundMs = (seconds) => Math.round(seconds * 1000) / 1000;

// Start and end second of every chunk. Computed from cumulative sample counts, so the
// 3-decimal rounding never accumulates drift across a long narration.
export function sentenceTimes(chunks, sampleRate) {
  let samples = 0;
  return chunks.map(({ text, samples: n }) => {
    const start = roundMs(samples / sampleRate);
    samples += n;
    return { text, start, end: roundMs(samples / sampleRate) };
  });
}

// One "<sentence>\t<phonemes>\n" line per sentence, for --phonemes. Whitespace inside a field is
// collapsed to one space so a tab or newline in the narration never breaks the two columns.
export function phonemeLines(sentences) {
  const field = (s) => s.replace(/\s+/g, ' ');
  return sentences.map((s) => `${field(s.text)}\t${field(s.phonemes)}\n`).join('');
}

// The sentence-timing sidecar sits beside the wav: voice/intro.wav -> voice/intro.json (voice-sidecar.mjs, a leaf the voice
// step imports without loading this module).
export { sidecarPath };

// Writes a 24 kHz mono wav plus its sentence-timing sidecar, and returns the duration in
// seconds and the timed sentences. Each chunk is generated on its own so nothing is
// truncated, then the chunks are joined. Each chunk goes through tts.stream() so kokoro also
// reports the phonemes it spoke; a chunk it splits further joins into one audio and one phoneme
// string. `deps.RawAudio` lets tests skip the model stack.
export async function synthesize(tts, kokoro, { text, voice, speed, out }, deps = {}) {
  const RawAudio = deps.RawAudio ?? kokoro.RawAudio;
  const spoken = [];
  for (const chunk of chunkText(text, kokoroSplitter(kokoro))) {
    const parts = [];
    for await (const part of tts.stream(closedSplitter(kokoro, chunk), { voice, speed })) parts.push(part);
    const audio = new Float32Array(parts.reduce((n, p) => n + p.audio.audio.length, 0));
    let at = 0;
    for (const p of parts) { audio.set(p.audio.audio, at); at += p.audio.audio.length; }
    spoken.push({ text: chunk, audio, phonemes: parts.map((p) => p.phonemes).join(' ') });
  }
  const total = spoken.reduce((n, c) => n + c.audio.length, 0);
  const joined = new Float32Array(total);
  let offset = 0;
  for (const c of spoken) { joined.set(c.audio, offset); offset += c.audio.length; }
  await new RawAudio(joined, SAMPLE_RATE).save(out);
  const times = sentenceTimes(spoken.map((c) => ({ text: c.text, samples: c.audio.length })), SAMPLE_RATE);
  const sentences = times.map((t, i) => ({ ...t, phonemes: spoken[i].phonemes }));
  writeFileSync(sidecarPath(out), `${JSON.stringify({ sampleRate: SAMPLE_RATE, voice, sentences }, null, 2)}\n`);
  return { seconds: total / SAMPLE_RATE, sentences };
}
