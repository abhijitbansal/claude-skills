// Bare imports resolve inside this folder, so kokoro-js and our `env` are one module instance of @huggingface/transformers.
export { KokoroTTS, TextSplitterStream } from 'kokoro-js';
export { env, RawAudio } from '@huggingface/transformers';
// Version 2 calls the timestamped Kokoro directly: onnxruntime-node runs it, phonemizer (eSpeak NG) turns clauses into phonemes.
export * as ort from 'onnxruntime-node';
export { phonemize } from 'phonemizer';
