// The pinned timestamped Kokoro model (Apache-2.0) that version 2 narrates with, and its verified download.
// Version 1 read a different model (its scripts/lib/voice.mjs, deleted at cut-over) from the folder scripts/lib/model-cache.mjs names.
// Every file is fetched through ensurePinnedFile at one commit, with its byte count and SHA-256; nothing here calls the network itself.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensurePinnedFile } from '../../lib/pinned-file.mjs';

const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX-timestamped';
const MODEL_COMMIT = 'dd4401a9add81ac692d20e240d22ec9dda82cc29';
const CACHE_PARTS = ['.cache', 'models'];

const MODEL_BASE = 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX-timestamped/resolve/dd4401a9add81ac692d20e240d22ec9dda82cc29/';
const PINNED_FILES = [
  { path: 'config.json', bytes: 44, sha256: 'df34b4f930b23447cd4dc410fabfb42eb3f24e803e6c3f97d618fb359380a36f' },
  { path: 'tokenizer.json', bytes: 3497, sha256: '77a02c8e164413299b4b4c403b14f8e0e1c1b727db4d46a09d6327b861060a34' },
  { path: 'tokenizer_config.json', bytes: 113, sha256: 'be1cb066d6ef6b074b3f15e6a6dd21ac88ff3cdaedf325f0aaed686c70f75d20' },
  { path: 'onnx/model_quantized.onnx', bytes: 92361055, sha256: 'c0c02b3299fd97c34ea92a98e6d41eaa1a739c8f77bf685aac34bd7b34c1132c' },
  { path: 'voices/af_heart.bin', bytes: 522240, sha256: 'd583ccff3cdca2f7fae535cb998ac07e9fcb90f09737b9a41fa2734ec44a8f0b' },
];

export const VOICE_MODEL = Object.freeze({
  id: MODEL_ID,
  commit: MODEL_COMMIT,
  base: MODEL_BASE,
  files: Object.freeze(PINNED_FILES.map((file) => Object.freeze(file))),
});

/** The cache folder of the model under `root` (the skill folder by default). */
export const voiceModelDir = (root = SKILL_ROOT) => path.join(root, ...CACHE_PARTS, VOICE_MODEL.id);

/**
 * Test seam, not part of the API: downloads and verifies the files of any table. Only tests call it with a table other than
 * VOICE_MODEL (a standing rule in bin/test/dependency-pins.test.mjs fails any other caller outside test files).
 * `log` receives one line before each download. A refused file rejects naming that file. -> dir.
 */
export async function ensureModelFiles(model, { dir, fetchImpl, log = () => {} }) {
  for (const { path: file, bytes, sha256 } of model.files) {
    await ensurePinnedFile({ url: `${model.base}${file}`, sha256, bytes, file: path.join(dir, file), label: `voice model file ${file}`, fetchImpl, log });
  }
  return dir;
}

const ENSURE_OPTIONS = new Set(['dir', 'fetchImpl', 'log']);

/**
 * The folder of the verified model files of VOICE_MODEL, fetching only the files that are absent or whose SHA-256 differs.
 * It accepts `dir`, `fetchImpl` and `log` and refuses any other option, so no caller can swap in a table of its own. -> dir.
 */
export function ensureVoiceModel(options = {}) {
  const unknown = Object.keys(options).filter((key) => !ENSURE_OPTIONS.has(key));
  if (unknown.length > 0) return Promise.reject(new TypeError(`ensureVoiceModel: unknown option ${unknown.join(', ')} (accepted: ${[...ENSURE_OPTIONS].join(', ')})`));
  return ensureModelFiles(VOICE_MODEL, { ...options, dir: options.dir ?? voiceModelDir() });
}
