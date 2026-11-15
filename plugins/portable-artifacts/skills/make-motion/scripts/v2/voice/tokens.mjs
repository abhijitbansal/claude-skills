// Token ids for the Kokoro model: pad 0, one id per phoneme character, pad 0.
// Characters outside the vocab are dropped, as the pinned tokenizer.json (and so kokoro-js) does; the voice was made
// with that behaviour. They are returned in `dropped`, and word spans are computed on `kept`, so no later word shifts.
// Pure: the caller reads any tokenizer file. A user's own IPA hint is checked with `unknownChars` (an error there).

const PAD_ID = 0;

export class VoiceTextError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'VoiceTextError';
  }
}

// The vocab of the pinned tokenizer.json (Kokoro-82M-v1.0-ONNX-timestamped at dd4401a9, 3497 bytes), embedded so
// validation needs no download: index = id, null = an id with no character. 115 characters, ids 0..177.
// test/v2/voice-phonemes.test.mjs proves it equals the pinned file id for id.
export const VOCAB_CHARS = Object.freeze([
  '$', ';', ':', ',', '.', '!', '?', null, null, '—',
  '…', '"', '(', ')', '“', '”', ' ', '̃', 'ʣ', 'ʥ',
  'ʦ', 'ʨ', 'ᵝ', 'ꭧ', 'A', 'I', null, null, null, null,
  null, 'O', null, 'Q', null, 'S', 'T', null, null, 'W',
  null, 'Y', 'ᵊ', 'a', 'b', 'c', 'd', 'e', 'f', null,
  'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q',
  'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z', 'ɑ',
  'ɐ', 'ɒ', 'æ', null, null, 'β', 'ɔ', 'ɕ', 'ç', null,
  'ɖ', 'ð', 'ʤ', 'ə', null, 'ɚ', 'ɛ', 'ɜ', null, null,
  'ɟ', null, 'ɡ', null, null, null, null, null, null, 'ɥ',
  null, 'ɨ', 'ɪ', 'ʝ', null, null, null, null, null, null,
  'ɯ', 'ɰ', 'ŋ', 'ɳ', 'ɲ', 'ɴ', 'ø', null, 'ɸ', 'θ',
  'œ', null, null, 'ɹ', null, 'ɾ', 'ɻ', null, 'ʁ', 'ɽ',
  'ʂ', 'ʃ', 'ʈ', 'ʧ', null, 'ʊ', 'ʋ', null, 'ʌ', 'ɣ',
  'ɤ', null, 'χ', 'ʎ', null, null, null, 'ʒ', 'ʔ', null,
  null, null, null, null, null, null, 'ˈ', 'ˌ', 'ː', null,
  null, null, 'ʰ', null, 'ʲ', null, null, null, null, '↓',
  null, '→', '↗', '↘', null, null, null, 'ᵻ',
]);

/** VOCAB_CHARS as a character -> id Map, the same shape loadVocab returns. */
export const EMBEDDED_VOCAB = new Map(VOCAB_CHARS.flatMap((char, id) => (char === null ? [] : [[char, id]])));

/** The character -> id vocab of a parsed tokenizer.json (`model.vocab`). Throws when it has none or an id is not an integer. */
export function loadVocab(tokenizerJson) {
  const vocab = tokenizerJson?.model?.vocab;
  if (vocab === null || typeof vocab !== 'object') throw new TypeError('tokenizer.json: model.vocab is missing');
  const entries = Object.entries(vocab);
  const bad = entries.find(([, id]) => !Number.isInteger(id) || id < 0);
  if (bad) throw new TypeError(`tokenizer.json: model.vocab[${JSON.stringify(bad[0])}] is not a non-negative integer id`);
  return new Map(entries);
}

/** Each character of `text` outside the vocab, once, in order of first appearance. */
export function unknownChars(text, vocab) {
  return [...new Set([...text].filter((c) => !vocab.has(c)))];
}

/**
 * `{ ids, kept, dropped }` for a phoneme string: `kept` is the characters in the vocab, `ids` is [0, one id per kept
 * character, 0], and `dropped` lists each character outside the vocab as `{ char, index }` (index in code points of the
 * input). No length limit here.
 */
export function toIds(phonemes, vocab) {
  const chars = [...phonemes];
  const dropped = chars.flatMap((char, index) => (vocab.has(char) ? [] : [{ char, index }]));
  const kept = chars.filter((c) => vocab.has(c));
  return { ids: [PAD_ID, ...kept.map((c) => vocab.get(c)), PAD_ID], kept: kept.join(''), dropped };
}
