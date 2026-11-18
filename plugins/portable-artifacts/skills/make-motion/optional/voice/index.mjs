// Bare imports resolve inside this folder, never in the skill's own node_modules.
// Version 2 calls the timestamped Kokoro directly: onnxruntime-node runs it, phonemizer (eSpeak NG) turns clauses into phonemes.
export * as ort from 'onnxruntime-node';
export { phonemize } from 'phonemizer';
