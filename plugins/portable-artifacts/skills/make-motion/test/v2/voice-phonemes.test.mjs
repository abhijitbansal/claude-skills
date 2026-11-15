// Phoneme strings and token ids for Kokoro narration. No phonemizer and no model run here: `phonemize` is a fake that
// replays recorded phonemizer 1.2.1 output, and the expected strings are kokoro-js 1.2.1's own
// (fixtures/voice/phonemes.json, and fixtures/voice/dropped.json for characters outside the vocab).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalize, promoteStress, toPhonemes } from '../../scripts/v2/voice/phonemes.mjs';
import { EMBEDDED_VOCAB, VOCAB_CHARS, loadVocab, toIds, unknownChars } from '../../scripts/v2/voice/tokens.mjs';

const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'voice');
const readFixture = (name) => JSON.parse(readFileSync(path.join(FIXTURE_DIR, name), 'utf8'));
const PHONEME_CALLS = readFixture('phonemes.json').calls;
const DROPPED_ENTRIES = readFixture('dropped.json').entries;
const NORMALIZE_CALLS = readFixture('normalize.json').calls;
const vocab = loadVocab(readFixture('tokenizer.json'));

const EXPECTED_PHONEME_CALLS = 21;
const VOCAB_SIZE = 115;
const LONG_PHONEMES = 600;

// A phonemizer that only knows the recorded inputs; anything else is a transcription error, so it throws.
function replayPhonemize(recorded) {
  const byInput = new Map(recorded.map(({ input, lang, output }) => [`${lang}\u0000${input}`, output]));
  return async (text, lang) => {
    const key = `${lang}\u0000${text}`;
    if (!byInput.has(key)) throw new Error(`unrecorded phonemize call (${lang}): ${JSON.stringify(text)}`);
    return byInput.get(key);
  };
}

test('the phoneme fixture holds the 21 calls the spike verified', () => {
  assert.equal(PHONEME_CALLS.length, EXPECTED_PHONEME_CALLS);
});

test('toPhonemes builds the same string as kokoro-js 1.2.1 for every fixture call', async () => {
  for (const call of PHONEME_CALLS) {
    const actual = await toPhonemes(call.text, replayPhonemize(call.phonemize));
    assert.equal(actual, call.phonemes, call.text);
  }
});

test('toPhonemes matches kokoro-js 1.2.1 on the normalize branches the spike fixtures miss', async () => {
  const branches = new Set(NORMALIZE_CALLS.map((c) => c.branch));
  for (const needed of ['titles', 'decimals', 'ranges', 'yeah', 'plural-years', 'dotted-initials', 'curly-quotes', 'pounds']) {
    assert.ok(branches.has(needed), needed);
  }
  for (const call of NORMALIZE_CALLS) {
    assert.equal(await toPhonemes(call.text, replayPhonemize(call.phonemize)), call.phonemes, `${call.branch}: ${call.text}`);
  }
});

test('normalize spells numbers the way kokoro-js does', () => {
  assert.equal(normalize('In 2024, we fixed 12,500 issues.'), 'In 20 24, we fixed 12500 issues.');
  assert.equal(normalize('At 3:30, go.'), 'At 3 30, go.');
});

test('promoteStress adds a primary stress before the first vowel when the word has none', () => {
  assert.equal(promoteStress('ɪz'), 'ˈɪz');
});

test('promoteStress turns a secondary stress into a primary one', () => {
  assert.ok(promoteStress('ˌɑːntuː').startsWith('ˈ'));
  assert.equal(promoteStress('ˌɑːntuː'), 'ˈɑːntuː');
});

test('promoteStress leaves a word with primary stress unchanged', () => {
  assert.equal(promoteStress('ɹˈɪli'), 'ɹˈɪli');
});

test('promoteStress promotes each space-separated group of a multi-word token on its own', () => {
  assert.equal(promoteStress('ɪn ðə'), 'ˈɪn ðˈə');
});

test('loadVocab reads the 115-entry vocab of the pinned tokenizer', () => {
  assert.equal(vocab.size, VOCAB_SIZE);
  assert.equal(vocab.get('$'), 0);
  assert.equal(vocab.get(' '), 16);
  assert.equal(vocab.get('ˈ'), 156);
});

test('toIds pads both ends and gives one id per kept character', () => {
  const { ids, kept } = toIds('bˈæk', vocab);
  assert.equal(ids.length, 6);
  assert.deepEqual(ids, [0, 44, 156, 72, 53, 0]);
  assert.equal(kept, 'bˈæk');
});

test('toIds drops a character outside the vocab, as kokoro-js does, and reports it with its index', () => {
  const { ids, kept, dropped } = toIds('a˞b', vocab);
  assert.deepEqual(ids, [0, 43, 44, 0]);
  assert.equal(kept, 'ab');
  assert.deepEqual(dropped, [{ char: '˞', index: 1 }]);
});

test('toIds reports nothing dropped when every character is in the vocab', () => {
  assert.deepEqual(toIds('bˈæk', vocab).dropped, []);
});

test('unknownChars lists each character outside the vocab once, in order (for IPA hint validation)', () => {
  assert.deepEqual(unknownChars('a˞bɝ˞', vocab), ['˞', 'ɝ']);
  assert.deepEqual(unknownChars('kˈoʊkəɹoʊ', vocab), []);
});

test('unknownChars treats the pad character $ as unknown, so a hint cannot inject a pad', () => {
  assert.deepEqual(unknownChars('h$ɪ', vocab), ['$']);
  assert.deepEqual(unknownChars('h$ɪ', EMBEDDED_VOCAB), ['$']);
});

test('the embedded vocab equals the pinned tokenizer.json vocab, id for id', () => {
  assert.ok(Object.isFrozen(VOCAB_CHARS));
  assert.equal(EMBEDDED_VOCAB.size, VOCAB_SIZE);
  assert.deepEqual([...EMBEDDED_VOCAB].sort((a, b) => a[1] - b[1]), [...vocab].sort((a, b) => a[1] - b[1]));
  vocab.forEach((id, char) => assert.equal(VOCAB_CHARS[id], char, `id ${id}`));
  assert.equal(VOCAB_CHARS.filter((c) => c !== null).length, VOCAB_SIZE);
});

// Real narration whose kokoro-js phonemes hold characters outside the vocab: « » (from parentheses) and U+0329 (syllabic n).
const SYLLABIC = '̩';
const EXPECTED_DROPPED = [['«', '»'], [SYLLABIC], [SYLLABIC, SYLLABIC, SYLLABIC], []];

test('real narration: toPhonemes matches kokoro-js, toIds drops only « » and U+0329, and kept matches the model input', async () => {
  assert.equal(DROPPED_ENTRIES.length, EXPECTED_DROPPED.length);
  for (const [i, entry] of DROPPED_ENTRIES.entries()) {
    const phonemes = await toPhonemes(entry.text, replayPhonemize(entry.phonemize));
    assert.equal(phonemes, entry.phonemes, entry.say);
    const { kept, dropped } = toIds(phonemes, vocab);
    assert.equal(kept, entry.kept, entry.say);
    assert.deepEqual(dropped.map((d) => d.char), EXPECTED_DROPPED[i], entry.say);
    dropped.forEach((d) => assert.equal([...phonemes][d.index], d.char, `${entry.say} index ${d.index}`));
  }
});

test('toIds does not truncate a long phoneme string (the length rule belongs to the call planner)', () => {
  const phonemes = 'a'.repeat(LONG_PHONEMES);
  const { ids, kept } = toIds(phonemes, vocab);
  assert.equal(ids.length, LONG_PHONEMES + 2);
  assert.equal(kept.length, LONG_PHONEMES);
});
