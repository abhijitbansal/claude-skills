// Voiceover synthesis with Kokoro (kokoro-js, Apache-2.0), run locally on the CPU.
// kokoro-js is installed on demand (it pulls onnxruntime, about 465 MB on macOS), never by `npm ci`.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { UsageError } from './spec.mjs';
import { doctorCommand, npmInstallKokoro } from './doctor-hint.mjs';
import { modelsDir } from './model-cache.mjs';
import { sidecarPath } from './voice-sidecar.mjs';

export const MODEL_CACHE_DIR = modelsDir(); // a per-user folder that survives a plugin update (model-cache.mjs)
export const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
// The Hub commit the model is downloaded at (main on 2025-02-08, the last change to that repo at the time of pinning), so a
// later push to the repo cannot change the model or tokenizer under an install (loadModel passes it to transformers.js
// itself, as kokoro-js ignores it). The files are not hash-checked: the transformers cache keeps no hash of them.
export const KOKORO_REVISION = '1939ad2a8e416c0acfeecc08a694d14ef25f2231';
export const DEFAULT_VOICE = 'af_heart';
export const SAMPLE_RATE = 24000;
// Kokoro truncates one generate() call at ~510 phoneme tokens (~27 s). 300 characters stays well under it.
export const MAX_CHUNK_CHARS = 300;
const MIN_SPEED = 0.5;
const MAX_SPEED = 2;
const DTYPE = 'q8'; // ~90 MB download on first use
const CLAUSE_BREAK = /(?<=[,;:—–])\s+/;

export const USAGE = 'usage: node scripts/voice.mjs "<text>" | --text-file <file> --out <file.wav> [--voice af_heart] [--speed 1] [--phonemes] | --dir <folder> [--voice af_heart] [--speed 1] | --list-voices';
export const INSTALL_HINT = `kokoro-js is not installed. Run: ${npmInstallKokoro()}`
  + ' (about 465 MB, which kokoro-js shares with cutout\'s onnxruntime-node; the voice model, about 90 MB, downloads once on first use; '
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

// --dir <folder>: the narration comes from the folder's .txt files and each lands beside its source, so the flags that name
// one text or one output are errors, not ignored. --phonemes prints per file in the one-text form only.
function dirOptions(opts, dir, { texts, textFile }) {
  if (texts.length > 0 || textFile !== null) throw new UsageError('--dir reads the narration from the folder\'s .txt files; leave out the text argument and --text-file');
  if (opts.out) throw new UsageError('--dir writes <name>.wav beside each .txt; leave out --out');
  if (opts.phonemes) throw new UsageError('--phonemes does not apply to --dir (it prints for one text); each sidecar carries the phonemes');
  const speed = Number(opts.speed);
  if (!Number.isFinite(speed) || speed < MIN_SPEED || speed > MAX_SPEED) throw new UsageError(`--speed must be a number from ${MIN_SPEED} to ${MAX_SPEED}`);
  return { ...opts, dir, speed };
}

export function parseVoiceArgs(argv) {
  const opts = { text: null, out: null, voice: DEFAULT_VOICE, speed: 1, listVoices: false, phonemes: false };
  const texts = [];
  let textFile = null;
  let dir = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--list-voices') opts.listVoices = true;
    else if (a === '--phonemes') opts.phonemes = true;
    else if (a === '--text-file') textFile = takeValue(argv, i++, a);
    else if (a === '--dir') dir = takeValue(argv, i++, a);
    else if (a === '--out' || a === '--voice' || a === '--speed') opts[a.slice(2)] = takeValue(argv, i++, a);
    else if (a.startsWith('--')) throw new UsageError(`unknown option ${a}`);
    else texts.push(a);
  }
  if (opts.listVoices) return opts;
  if (dir !== null) return dirOptions(opts, dir, { texts, textFile });
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

const PROGRESS_BAND_PERCENT = 10;
const MB = 1e6;

/**
 * The `progress_callback` of the model download: one line on stderr each time a file passes into a new 10 % band
 * (`downloading model_quantized.onnx: 40% (36 of 90 MB)`), so a first run of about 90 MB is not silent. Events without a
 * `total` (and every event of a cached file) print nothing. `write` is for tests.
 */
export function downloadProgress(write = (line) => process.stderr.write(line)) {
  const bands = new Map();
  return (info) => {
    if (info?.status !== 'progress' || !(info.total > 0) || !Number.isFinite(info.progress)) return;
    const band = Math.floor(info.progress / PROGRESS_BAND_PERCENT);
    if (bands.get(info.file) === band) return;
    bands.set(info.file, band);
    write(`downloading ${info.file}: ${Math.round(info.progress)}% (${Math.round(info.loaded / MB)} of ${Math.round(info.total / MB)} MB)\n`);
  };
}

// kokoro-js 1.2.1's KokoroTTS.from_pretrained destructures only dtype, device and progress_callback, so a `revision` handed to it
// is dropped. The model and tokenizer are therefore fetched here through transformers.js, which honours `revision`, and passed to
// the KokoroTTS constructor (which kokoro-js exports and from_pretrained itself calls). The voice .bin files are not fetched from
// the Hub in Node: kokoro-js reads them from its own package's voices/ folder, so the exact-version install (KOKORO_PIN in
// shared/doctor.mjs) pins them. `transformers` is for tests.
export async function loadModel(kokoro, { onProgress = downloadProgress(), transformers = null } = {}) {
  const { env, StyleTextToSpeech2Model, AutoTokenizer } = transformers ?? await import('@huggingface/transformers');
  env.cacheDir = MODEL_CACHE_DIR; // survives `npm ci`, which wipes node_modules, and a plugin update (model-cache.mjs)
  const pinned = { revision: KOKORO_REVISION, progress_callback: onProgress };
  const [model, tokenizer] = await Promise.all([
    StyleTextToSpeech2Model.from_pretrained(MODEL_ID, { ...pinned, dtype: DTYPE, device: 'cpu' }),
    AutoTokenizer.from_pretrained(MODEL_ID, pinned),
  ]);
  return new kokoro.KokoroTTS(model, tokenizer);
}

// ---- --dir: many narrations, one model load -----------------------------------------------------------------------------

/** What a narration's audio is a function of; the sidecar of a finished one records it (`textHash`) so an unchanged one is skipped. */
export const textHash = ({ text, voice, speed }) => createHash('sha256').update(JSON.stringify([text, voice, speed])).digest('hex');

// A wav whose sidecar records this hash: made from this very text, voice and speed. A wav deleted, or a sidecar missing,
// unreadable or from an older run (no `textHash`), is not fresh.
function isFresh(out, hash) {
  if (!existsSync(out)) return false;
  try {
    return JSON.parse(readFileSync(sidecarPath(out), 'utf8')).textHash === hash;
  } catch {
    return false;
  }
}

/** The narrations of `opts.dir`: one `{ file, text, out, hash, fresh }` per .txt file, in name order, `out` beside it. */
export function dirJobs(opts) {
  let files;
  try {
    files = readdirSync(opts.dir).filter((name) => name.toLowerCase().endsWith('.txt')).sort();
  } catch (e) {
    throw new UsageError(`--dir: cannot read ${opts.dir}: ${e.code ?? e.message}`);
  }
  if (files.length === 0) throw new UsageError(`--dir: no .txt files in ${opts.dir}; each is one narration, written to <name>.wav beside it`);
  const names = new Map();
  return files.map((file) => {
    const stem = file.slice(0, -'.txt'.length);
    if (names.has(stem.toLowerCase())) throw new UsageError(`--dir: ${file} and ${names.get(stem.toLowerCase())} would both write ${stem}.wav; rename one`);
    names.set(stem.toLowerCase(), file);
    const text = readTextFile(path.join(opts.dir, file)).trim();
    if (text === '') throw new UsageError(`--dir: ${file} is empty: nothing to say`);
    const out = path.join(opts.dir, `${stem}.wav`);
    const hash = textHash({ text, voice: opts.voice, speed: opts.speed });
    return { file, text, out, hash, fresh: isFresh(out, hash) };
  });
}

// An unknown or prototype name ("constructor") is refused against the loaded model's own list.
export function assertVoice(tts, voice) {
  if (!Object.hasOwn(tts.voices ?? {}, voice)) throw new UsageError(`unknown voice "${voice}"; run --list-voices`);
}

/**
 * Every narration of `opts.dir` made in turn on one model session, skipping those that are up to date. `load()` returns
 * `{ kokoro, tts, dispose }` and is called once, and only when something has to be made, so a folder of unchanged
 * narrations loads nothing; the session is disposed before this settles, on success and on failure.
 * -> [{ job, seconds }] for a narration made, [{ job, skipped: true }] for one left alone, in name order.
 */
export async function synthesizeDir(opts, { load, deps = {} }) {
  const jobs = dirJobs(opts);
  const results = [];
  let session = null;
  try {
    for (const job of jobs) {
      if (job.fresh) { results.push({ job, skipped: true }); continue; }
      if (session === null) {
        session = await load();
        assertVoice(session.tts, opts.voice);
      }
      const { seconds } = await synthesize(session.tts, session.kokoro, { text: job.text, voice: opts.voice, speed: opts.speed, out: job.out, hash: job.hash }, deps);
      results.push({ job, seconds });
    }
  } finally {
    await session?.dispose();
  }
  return results;
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
export async function synthesize(tts, kokoro, { text, voice, speed, out, hash }, deps = {}) {
  const RawAudio = deps.RawAudio ?? (await import('@huggingface/transformers')).RawAudio;
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
  // `textHash` only for a --dir run (its `hash`): the one-text form keeps its sidecar as it was.
  writeFileSync(sidecarPath(out), `${JSON.stringify({ sampleRate: SAMPLE_RATE, voice, ...(hash === undefined ? {} : { textHash: hash }), sentences }, null, 2)}\n`);
  return { seconds: total / SAMPLE_RATE, sentences };
}
