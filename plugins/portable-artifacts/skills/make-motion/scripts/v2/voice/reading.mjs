// How a film's narration will be read (make.mjs --phonemes): each word of each narrated shot with the phonemes the
// voice will be given, from the same phonemizer and the same call preparation synthesis uses (kokoro.mjs
// planShotCalls: a whole clause phonemised at once, a pronunciation hint put in place, an emphasised word's stress
// promoted). No model is loaded and no audio is made: only the phonemizer of the optional voice package runs.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSay } from '../../../engine/script/say.mjs';
import { planShotCalls } from './kokoro.mjs';
import { EMBEDDED_VOCAB } from './tokens.mjs';

const PLAN_SPEED = 1; // speed and pauses shape only the silences between calls, which carry no words
const PLAN_EMPHASIS_PAUSE = 0;
// <skill>/optional, where the optional voice package is installed (as scripts/lib/optional.mjs OPTIONAL_ROOT; not
// imported: version 2 takes nothing from version 1).
export const OPTIONAL_VOICE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../optional/voice');
const PADDED = 1; // a call's kept characters are token 1 on: token 0 is the leading pad

// The words of one shot's calls: { text, phonemes } for each token, in order.
async function shotWords(shot, { phonemize, vocab }) {
  const { tokens } = parseSay(shot.say);
  const items = await planShotCalls(tokens, { speed: PLAN_SPEED, emphasisPause: PLAN_EMPHASIS_PAUSE, shotId: shot.id, phonemize, vocab });
  const phonemesOf = new Map();
  for (const item of items.filter((i) => i.kind === 'speech')) {
    const kept = [...item.input.kept]; // one vocab character per element, as the spans count them
    item.tokens.forEach((index, j) => {
      const { first, last } = item.input.spans[j];
      phonemesOf.set(index, kept.slice(first - PADDED, last - PADDED + 1).join(''));
    });
  }
  return tokens.map((token, index) => ({ text: token.text, phonemes: phonemesOf.get(index) ?? '' }));
}

/**
 * [{ shot, words: [{ text, phonemes }] }] for each shot of `film` that has a say, in order. `phonemize` is the voice
 * package's phonemizer (loadPhonemizer); `vocab` the model's characters (default: the embedded copy of its vocab).
 */
export async function readingOf(film, { phonemize, vocab = EMBEDDED_VOCAB }) {
  const narrated = film.shots.filter((shot) => typeof shot.say === 'string');
  const words = await Promise.all(narrated.map((shot) => shotWords(shot, { phonemize, vocab })));
  return narrated.map((shot, i) => ({ shot: shot.id, words: words[i] }));
}

/** The phonemizer of the optional voice package at `runtime` (default <skill>/optional/voice), or its install hint. */
export async function loadPhonemizer(runtime = OPTIONAL_VOICE) {
  const { loadRuntime } = await import('./worker.mjs');
  return (await loadRuntime(runtime)).phonemize;
}

/** The text form: the shot id, then one line per word: two spaces, the word, two spaces, /phonemes/. */
export const readingLines = (reading) => reading.flatMap(({ shot, words }) => [shot, ...words.map((w) => `  ${w.text}  /${w.phonemes}/`)]);
