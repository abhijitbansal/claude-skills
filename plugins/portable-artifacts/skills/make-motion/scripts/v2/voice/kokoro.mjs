// The timestamped Kokoro model on onnxruntime-node, and the model input for one synthesis call.
// Tensors (docs/superpowers/plans/2026-11-15-pa2-voice-spike-report.md, "Tensors"): input_ids int64 [1, T] (pad, one id
// per kept phoneme character, pad; T at most MAX_IDS), style float32 [1, 256] (row clamp(T - 2, 0, 509) of the voice
// file read as float32 rows of 256), speed float32 [1]. Outputs: waveform float32 [1, N] at 24 kHz mono, durations
// float32 [1, T] (unrounded frames, one per input token).
// `ort` and `phonemize` are injected: they come from the optional voice package, which only the worker process loads.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { MAX_IDS, hintPhonemes, planCalls } from './calls.mjs';
import { VOICE_MODEL } from './model.mjs';
import { promoteStress, toPhonemes } from './phonemes.mjs';
import { VoiceTextError, toIds } from './tokens.mjs';
import { isEmptySpan, isMergedWith, wordSpans } from './words.mjs';

export const ACCEPTED_VOICES = Object.freeze(['af_heart']);
export const STYLE_DIM = 256;
export const MODEL_FILE = 'onnx/model_quantized.onnx';
/** The model as the sidecar records it: the pin and the file that is run. */
export const MODEL_INFO = Object.freeze({
  id: VOICE_MODEL.id,
  commit: VOICE_MODEL.commit,
  file: MODEL_FILE,
  sha256: VOICE_MODEL.files.find((f) => f.path === MODEL_FILE).sha256,
});
const STYLE_ROWS = 510;
const PAD_COUNT = 2;
const FLOAT_BYTES = 4;

/** Throws a TypeError naming `voice` and the accepted voices unless it is one of them. */
export function checkVoice(voice) {
  if (!ACCEPTED_VOICES.includes(voice)) {
    throw new TypeError(`voice ${JSON.stringify(voice)} is not available; accepted: ${ACCEPTED_VOICES.join(', ')}`);
  }
  return voice;
}

function readStyles(modelDir, voice) {
  const file = path.join(modelDir, 'voices', `${voice}.bin`);
  const bytes = readFileSync(file);
  const expected = STYLE_ROWS * STYLE_DIM * FLOAT_BYTES;
  if (bytes.byteLength !== expected) throw new RangeError(`${file}: ${bytes.byteLength} bytes, expected ${expected} (${STYLE_ROWS} style rows of ${STYLE_DIM} floats)`);
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

function checkCall({ ids, speed }) {
  if (!Array.isArray(ids) || ids.length < PAD_COUNT) throw new TypeError('speak: ids must be an array of at least the two pad ids');
  if (ids.length > MAX_IDS) throw new RangeError(`speak: ${ids.length} ids, over the model's limit of ${MAX_IDS}`);
  if (!Number.isFinite(speed) || speed <= 0) throw new RangeError(`speak: speed must be a positive number, got ${speed}`);
}

/**
 * Opens the model in `modelDir` with `ort` (onnxruntime-node) for `voice`. -> Promise<{ speak, close }>, where
 * `speak({ ids, speed }) -> Promise<{ waveform: Float32Array, durations: Float32Array }>` runs one call and `close()`
 * releases the session.
 */
export async function openKokoro({ ort, modelDir, voice }) {
  checkVoice(voice);
  const styles = readStyles(modelDir, voice);
  const session = await ort.InferenceSession.create(path.join(modelDir, MODEL_FILE), { executionProviders: ['cpu'] });
  const speak = async ({ ids, speed }) => {
    checkCall({ ids, speed });
    const row = Math.min(Math.max(ids.length - PAD_COUNT, 0), STYLE_ROWS - 1);
    const out = await session.run({
      input_ids: new ort.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, ids.length]),
      style: new ort.Tensor('float32', styles.slice(row * STYLE_DIM, (row + 1) * STYLE_DIM), [1, STYLE_DIM]),
      speed: new ort.Tensor('float32', Float32Array.from([speed]), [1]),
    });
    return { waveform: Float32Array.from(out.waveform.data), durations: Float32Array.from(out.durations.data) };
  };
  return { speak, close: async () => session.release?.() };
}

// The phonemes kokoro-js would build for `text`, cached per text (the same clause is asked for again while planning).
function phonemeCache(phonemize, vocab) {
  const cache = new Map();
  return (text) => {
    if (!cache.has(text)) cache.set(text, toPhonemes(text, phonemize).then((p) => toIds(p, vocab)));
    return cache.get(text);
  };
}

// The token's own phonemes in the call: its IPA hint (through hintPhonemes, the same check spec.mjs runs, so a refused
// character is a VoiceTextError, never dropped), or the clause's phonemes with stress promoted when it is emphasised,
// or the clause's phonemes as they are.
function ownPhonemes(token, slice) {
  if (token.ipa !== undefined) return hintPhonemes(token.ipa);
  return token.emphasis ? promoteStress(slice) : slice;
}

// The index after the merged run that starts at token k (wordSpans gives its tokens one shared span, merged: true).
function mergedRunEnd(spans, k) {
  let end = k + 1;
  while (end < spans.length && isMergedWith(spans[end], spans[end - 1])) end++;
  return end;
}

// One token standing for a merged run: emphasised when any of its tokens is. An IPA hint cannot be placed inside a
// run the voice reorders ("$5 million" is spoken "5 million dollars"), so it is refused rather than misplaced.
function runToken(tokens, k, end) {
  const run = tokens.slice(k, end);
  if (run.length === 1) return run[0];
  const hinted = run.find((t) => t.ipa !== undefined);
  if (hinted) {
    throw new VoiceTextError(`"${hinted.text}" carries a pronunciation hint, but the voice reads "${run.map((t) => t.text).join(' ')}" in another word order, so the hint has no place; drop the hint or write the words out`);
  }
  return { ...run[0], emphasis: run.some((t) => t.emphasis) };
}

/**
 * Rebuilds the kept characters with each token's phonemes edited, and the token spans over the result. Token t is kept
 * character t - 1 (the leading pad is token 0), so a span over characters [a, b] is { first: a + 1, last: b + 1 }. A
 * zero-length span stays zero-length, right after the previous span (where wordSpans put it). A merged run is edited
 * once and every token of it keeps the one shared span (merged: true). Exported for tests.
 */
export function editCall(chars, spans, tokens) {
  const out = [];
  const edited = [];
  let at = 0;
  for (let k = 0; k < spans.length;) {
    const span = spans[k];
    const end = mergedRunEnd(spans, k);
    if (isEmptySpan(span)) {
      edited.push({ first: out.length + 1, last: out.length });
      k = end;
      continue;
    }
    out.push(...chars.slice(at, span.first - 1));
    const own = [...ownPhonemes(runToken(tokens, k, end), chars.slice(span.first - 1, span.last).join(''))];
    const first = out.length + 1;
    out.push(...own);
    at = span.last;
    const placed = span.merged ? { first, last: first + own.length - 1, merged: true } : { first, last: first + own.length - 1 };
    for (let j = k; j < end; j++) edited.push({ ...placed });
    k = end;
  }
  return { kept: [...out, ...chars.slice(at)].join(''), spans: edited };
}

/**
 * The model input of the call over `indexes` of `tokens` (parseSay tokens): the clause (the tokens' texts joined by
 * spaces) phonemised whole, each token located in it, emphasised tokens' stress promoted and IPA hints put in place.
 * -> { kept, ids, spans, dropped }: `ids` are what the model is given, `spans` the token range of each say token in
 * them (pads counted, for wordTimes), `dropped` the phonemizer characters outside the vocab (kokoro-js drops them too).
 */
export async function prepareCall(tokens, indexes, { phonemize, vocab, phonemesOf = phonemeCache(phonemize, vocab) }) {
  const own = indexes.map((i) => tokens[i]);
  const base = await phonemesOf(own.map((t) => t.text).join(' '));
  const alone = await Promise.all(own.map(async (t) => (await phonemesOf(t.text)).kept));
  const { kept, spans } = editCall([...base.kept], wordSpans(base.kept, alone), own);
  return { kept, ids: toIds(kept, vocab).ids, spans, dropped: base.dropped };
}

/**
 * planCalls for one shot with exact id counts. planCalls asks `countIds` synchronously and needs a finite number, but
 * phonemes come from an async phonemizer. So a pass answers each count it already knows exactly and answers 0 for one
 * it does not, recording it; the recorded calls are then prepared and planning runs again. A pass with nothing
 * recorded used only exact counts, so its plan is the answer. Each pass adds at least one prepared call, and there
 * are finitely many token runs, so this ends.
 * -> planCalls's items (speech, silence, skip), each speech call with its model `input` (prepareCall's result) attached.
 * `planner` is planCalls; a test seam.
 */
export async function planShotCalls(tokens, { speed, emphasisPause, shotId, phonemize, vocab, planner = planCalls }) {
  const phonemesOf = phonemeCache(phonemize, vocab);
  const prepare = (indexes) => prepareCall(tokens, indexes, { phonemize, vocab, phonemesOf });
  const prepared = new Map();
  for (;;) {
    const missing = new Map();
    const countIds = (indexes) => {
      const key = indexes.join(',');
      if (prepared.has(key)) return prepared.get(key).ids.length;
      missing.set(key, indexes);
      return 0;
    };
    const items = planner(tokens, { speed, emphasisPause, countIds, shotId });
    if (missing.size === 0) {
      return Promise.all(items.map(async (item) => (item.kind === 'speech'
        ? { ...item, input: prepared.get(item.tokens.join(',')) ?? await prepare(item.tokens) }
        : item)));
    }
    for (const [key, indexes] of missing) prepared.set(key, await prepare(indexes));
  }
}
