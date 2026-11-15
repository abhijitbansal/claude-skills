// Word times from Kokoro's per-token durations. No model run here: fixtures/voice/durations.json holds recorded calls
// (kept phonemes, float durations, waveform sample count, parseSay tokens, per-token phonemes, and the spike's spans).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  END_CAP_FRAMES, FRAME_SAMPLES, LEAD, SAMPLE_RATE, framesOf, wordSpans, wordTimes,
} from '../../scripts/v2/voice/words.mjs';
import { VoiceTextError, loadVocab, toIds } from '../../scripts/v2/voice/tokens.mjs';
import { toPhonemes } from '../../scripts/v2/voice/phonemes.mjs';

const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'voice');
const readFixture = (name) => JSON.parse(readFileSync(path.join(FIXTURE_DIR, name), 'utf8'));
const CALLS = readFixture('durations.json').calls;
const DROPPED_ENTRIES = readFixture('dropped.json').entries;
const REORDER_ENTRIES = readFixture('reorder.json').entries;
const vocab = loadVocab(readFixture('tokenizer.json'));

const MIN_FIXTURE_CALLS = 8;
const OFF_BY_ONE_MIN_MEDIAN_S = 0.02;
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const spanText = (kept, span) => [...kept].slice(span.first - 1, span.last).join('');
const timesOf = (call) => {
  const spans = wordSpans(call.kept, call.tokenPhonemes);
  return { spans, times: wordTimes({ kept: call.kept, frames: framesOf(call.durations), spans }) };
};
const callNamed = (id) => {
  const call = CALLS.find((c) => c.id === id);
  assert.ok(call, `fixture call ${id} is missing`);
  return call;
};

test('constants match the plan', () => {
  assert.equal(FRAME_SAMPLES, 600);
  assert.equal(SAMPLE_RATE, 24000);
  assert.deepEqual({ ...LEAD }, { afterPunctuationMs: 42, callStartBaseMs: -119, callStartPerPadFrameMs: 12, midPhraseMs: 75 });
  assert.equal(END_CAP_FRAMES, 2);
});

test('the fixture covers the required calls', () => {
  assert.ok(CALLS.length >= MIN_FIXTURE_CALLS);
  const texts = CALLS.flatMap((c) => c.sayTokens.map((t) => t.text));
  for (const needed of ['2024,', '12,500', 'in', 'so']) assert.ok(texts.includes(needed), needed);
  assert.ok(CALLS.some((c) => c.speed === 0.8));
});

test('framesOf: integer frames times 600 equal the waveform length for every fixture call', () => {
  for (const call of CALLS) {
    assert.equal(call.durations.length, [...call.kept].length + 2, call.id);
    const frames = framesOf(call.durations);
    assert.ok(frames.every((f) => Number.isInteger(f) && f >= 1), call.id);
    assert.equal(sum(frames) * FRAME_SAMPLES, call.sampleCount, call.id);
  }
});

test('framesOf rounds half to even and never gives less than one frame', () => {
  assert.deepEqual(framesOf([0.2, 2.5, 3.5, 1.49, 0]), [1, 2, 4, 1, 1]);
});

test('wordSpans: one ascending, non-overlapping span per say token, equal to the spike spans', () => {
  for (const call of CALLS) {
    const spans = wordSpans(call.kept, call.tokenPhonemes);
    assert.equal(spans.length, call.sayTokens.length, call.id);
    spans.forEach((s, i) => {
      assert.ok(s.first >= 1 && s.last >= s.first - 1 && s.last <= [...call.kept].length, `${call.id} token ${i}`);
      if (i > 0) assert.ok(s.first > spans[i - 1].last, `${call.id} token ${i} overlaps`);
    });
    assert.deepEqual(spans, call.spike.spans, call.id);
  }
});

test('wordSpans splits the linked "in the" (espeak: one group) by alignment', () => {
  const call = callNamed('linked-in-the');
  assert.equal(call.spike.method, 'align');
  const spans = wordSpans(call.kept, call.tokenPhonemes);
  const k = call.sayTokens.findIndex((t) => t.text === 'in');
  assert.equal(call.sayTokens[k + 1].text, 'the');
  assert.equal(spanText(call.kept, spans[k]), 'ɪn');
  assert.equal(spanText(call.kept, spans[k + 1]), 'ðə');
  assert.equal(spans[k + 1].first, spans[k].last + 1);
});

test('wordSpans gives a number token that is several spoken words one span over all of them', () => {
  const call = callNamed('numbers');
  const spans = wordSpans(call.kept, call.tokenPhonemes);
  const at = (text) => spanText(call.kept, spans[call.sayTokens.findIndex((t) => t.text === text)]);
  assert.equal(at('2024,'), 'twˈɛnti twˈɛnti fˈoːɹ');
  assert.equal(at('12,500'), 'twˈɛlv θˈaʊzənd fˈaɪv hˈʌndɹɪd');
});

test('wordSpans gives a say token with no phonemes (a spaced dash) a zero-length span after the previous span', () => {
  // kept "ɐ — bˈiː": ɐ is token 1, space 2, dash 3, space 4, bˈiː tokens 5..8. The dash token counts zero phoneme words.
  // Zero-length span: first = previous last + 1, last = previous last.
  assert.deepEqual(wordSpans('ɐ — bˈiː', ['ɐ', '—', 'bˈiː']), [{ first: 1, last: 1 }, { first: 2, last: 1 }, { first: 5, last: 8 }]);
});

test('wordSpans falls back to alignment when the counts add up but a linked pair and a split word cancel out', () => {
  // Clause groups ɪnðə | kæn | nˈɑːt (3); per-token counts 1 + 1 + 1 (3). Counts alone would give "in" = ɪnðə,
  // "the" = kæn, "cannot" = nˈɑːt. The assigned text disagrees with each token's own phonemes, so alignment decides.
  // kept: ɪ1 n2 ð3 ə4 space5 k6 æ7 n8 space9 n10 ˈ11 ɑ12 ː13 t14 (token indexes).
  const kept = 'ɪnðə kæn nˈɑːt';
  const spans = wordSpans(kept, ['ɪn', 'ðə', 'kˈænɑːt']);
  assert.deepEqual(spans.map((s) => spanText(kept, s)), ['ɪn', 'ðə', 'kæn nˈɑːt']);
  assert.deepEqual(spans, [{ first: 1, last: 2 }, { first: 3, last: 4 }, { first: 6, last: 14 }]);
});

test('the cancel-out probe is placed one by one: no token is merged', () => {
  const spans = wordSpans('ɪnðə kæn nˈɑːt', ['ɪn', 'ðə', 'kˈænɑːt']);
  assert.ok(spans.every((s) => s.merged === undefined));
});

test('adjacent tokens reduced in context ("to the" as tə ðɪ) stay separate: they are not reordered, only reduced', () => {
  // Both fail the exact sound check (tuː/tə, ðə/ðɪ), but neither token's own sound appears elsewhere in the run.
  // kept: t1 ə2 space3 ð4 ɪ5 space6 ˈ7 ɛ8 n9 d10.
  const spans = wordSpans('tə ðɪ ˈɛnd', ['tˈuː', 'ðˈə', 'ˈɛnd']);
  assert.deepEqual(spans, [{ first: 1, last: 2 }, { first: 4, last: 5 }, { first: 7, last: 10 }]);
});

const placedTokens = async (entry) => {
  const replay = replayPhonemize(entry.phonemize);
  const kept = toIds(await toPhonemes(entry.text, replay), vocab).kept;
  const tokenPhonemes = [];
  for (const text of entry.tokenTexts) tokenPhonemes.push(toIds(await toPhonemes(text, replay), vocab).kept);
  return { kept, spans: wordSpans(kept, tokenPhonemes) };
};

// Hand-checked from the recorded espeak output: normalize turns "$5 million" into "5 million dollars", so "$5" and
// "million." cannot be placed one by one; they share one merged span. Words outside the run keep their own spans.
const EXPECTED_REORDER = [
  { say: 'It cost $5 million.', texts: ['ɪt', 'kˈɔst', 'fˈaɪv mˈɪliən dˈɑːlɚz', 'fˈaɪv mˈɪliən dˈɑːlɚz'], merged: [2, 3] },
  { say: 'We raised $3 billion last year.', texts: ['wiː', 'ɹˈeɪzd', 'θɹˈiː bˈɪliən dˈɑːlɚz', 'θɹˈiː bˈɪliən dˈɑːlɚz', 'lˈæst', 'jˈɪɹ'], merged: [2, 3] },
  { say: 'Only £2 thousand left.', texts: ['ˈoʊnli', 'tˈuː θˈaʊzənd pˈaʊndz', 'tˈuː θˈaʊzənd pˈaʊndz', 'lˈɛft'], merged: [1, 2] },
  {
    say: 'It cost $5 million, and then $3 more.',
    texts: ['ɪt', 'kˈɔst', 'fˈaɪv mˈɪliən dˈɑːlɚz', 'fˈaɪv mˈɪliən dˈɑːlɚz', 'ænd', 'ðˈɛn', 'θɹˈiː dˈɑːlɚz', 'mˈoːɹ'],
    merged: [2, 3],
  },
];

test('reordered words (normalize: "$5 million" -> "5 million dollars") share one merged span; other words are unchanged', async () => {
  assert.deepEqual(REORDER_ENTRIES.map((e) => e.say), EXPECTED_REORDER.map((e) => e.say));
  for (const [i, entry] of REORDER_ENTRIES.entries()) {
    const { kept, spans } = await placedTokens(entry);
    assert.equal(kept, entry.kept, entry.say);
    assert.deepEqual(spans.map((s) => spanText(kept, s)), EXPECTED_REORDER[i].texts, entry.say);
    const merged = spans.flatMap((s, k) => (s.merged === true ? [k] : []));
    assert.deepEqual(merged, EXPECTED_REORDER[i].merged, entry.say);
  }
});

test('"It cost $5 million.": $5 and million. get one span over "5 million dollars"; It and cost keep theirs', async () => {
  const entry = REORDER_ENTRIES.find((e) => e.say === 'It cost $5 million.');
  const { spans } = await placedTokens(entry);
  // kept: ɪ1 t2 space3 k4 ˈ5 ɔ6 s7 t8 space9 f10 ˈ11 a12 ɪ13 v14 space15 m16 ... z30 .31
  assert.deepEqual(spans, [
    { first: 1, last: 2 }, { first: 4, last: 8 }, { first: 10, last: 30, merged: true }, { first: 10, last: 30, merged: true },
  ]);
});

test('wordTimes gives merged tokens the same start and end, and times every other word as usual', async () => {
  for (const entry of REORDER_ENTRIES) {
    const { kept, spans } = await placedTokens(entry);
    const times = wordTimes({ kept, frames: framesOf(entry.durations), spans });
    assert.equal(times.length, entry.tokenTexts.length, entry.say);
    spans.forEach((s, k) => {
      if (k > 0 && s.merged && spans[k - 1].merged) assert.deepEqual(times[k], times[k - 1], `${entry.say} token ${k}`);
      else if (k > 0) assert.ok(times[k].start > times[k - 1].start, `${entry.say} token ${k} starts after the previous word`);
      assert.ok(times[k].end > times[k].start, `${entry.say} token ${k}`);
    });
  }
});

test('wordTimes accepts merged spans that repeat, and still rejects an unmarked repeated span', () => {
  // kept "ab cd": a1 b2 space3 c4 d5, frames [12, 2, 3, 3, 4, 5, 1]. Tokens 2 and 3 share the merged span {4, 5}.
  const merged = { first: 4, last: 5, merged: true };
  const times = wordTimes({ kept: 'ab cd', frames: [12, 2, 3, 3, 4, 5, 1], spans: [{ first: 1, last: 2 }, merged, merged] });
  assert.deepEqual(times, [{ start: 0.275, end: 0.3875 }, { start: 0.3875, end: 0.65 }, { start: 0.3875, end: 0.65 }]);
  assert.throws(
    () => wordTimes({ kept: 'ab cd', frames: [12, 2, 3, 3, 4, 5, 1], spans: [{ first: 1, last: 2 }, { first: 4, last: 5 }, { first: 4, last: 5 }] }),
    RangeError,
  );
});

test('wordSpans ignores characters outside the vocab in token phonemes (a caller that skipped toIds)', () => {
  // "«" is not in the vocab: the "(" token then has no phonemes and gets a zero-length span instead of a throw.
  // kept "wˈʌn tˈuː": w1 ˈ2 ʌ3 n4 space5 t6 ˈ7 u8 ː9.
  assert.deepEqual(wordSpans('wˈʌn tˈuː', ['wˈʌn', '«', 'tˈuː']), [{ first: 1, last: 4 }, { first: 5, last: 4 }, { first: 6, last: 9 }]);
});

test('alignment gives a leading unmatched clause phone to the first token that has phonemes, not to a leading dash', () => {
  // Clause "ə bˈiː" (2 groups); tokens "—" (0) and "bˈiː" (1): counts do not add up, so alignment.
  // The clause's ə has no partner; it belongs to "bˈiː" (token 1), and the dash keeps a zero-length span.
  // kept: ə1 space2 b3 ˈ4 i5 ː6.
  assert.deepEqual(wordSpans('ə bˈiː', ['—', 'bˈiː']), [{ first: 1, last: 0 }, { first: 1, last: 6 }]);
});

test('wordSpans still throws VoiceTextError for a token whose phonemes cannot be found in the call', () => {
  // Counts 1 + 1 do not match the clause's one group; alignment places no phone of token 1.
  assert.throws(
    () => wordSpans('ɐ', ['ɐ', 'bˈiː']),
    (error) => error instanceof VoiceTextError && error.message.includes('say token 1'),
  );
});

test('wordTimes gives a zero-length token the start of the next word, or the end of the previous word when last', () => {
  // kept "ɐ — bˈiː", frames [12, 3, 2, 4, 2, 2, 3, 2, 2, 1]. Word 1: raw 300 ms, lead -119 + 144 = 25 ms, start 275 ms;
  // followed by punctuation, so its end is capped: cum[1] + min(3, 2) = 14 frames = 350 ms.
  // Word 3 after "— ": raw = cum[5] = 12 + 3 + 2 + 4 + 2 = 23 frames = 575 ms, start 533 ms;
  // last in the call, so end = cum[8] + min(2, 2) = 30 + 2 = 32 frames = 800 ms.
  // The dash token: start = end = 533 ms (next word's start).
  const frames = [12, 3, 2, 4, 2, 2, 3, 2, 2, 1];
  const spans = wordSpans('ɐ — bˈiː', ['ɐ', '—', 'bˈiː']);
  assert.deepEqual(wordTimes({ kept: 'ɐ — bˈiː', frames, spans }), [
    { start: 0.275, end: 0.35 }, { start: 0.533, end: 0.533 }, { start: 0.533, end: 0.8 },
  ]);
  // kept "ɐ —", the dash last: frames [12, 3, 2, 4, 1]. Word 1 ends capped at 14 frames = 350 ms; the dash sits at 350 ms.
  const lastSpans = wordSpans('ɐ —', ['ɐ', '—']);
  assert.deepEqual(lastSpans, [{ first: 1, last: 1 }, { first: 2, last: 1 }]);
  assert.deepEqual(wordTimes({ kept: 'ɐ —', frames: [12, 3, 2, 4, 1], spans: lastSpans }), [
    { start: 0.275, end: 0.35 }, { start: 0.35, end: 0.35 },
  ]);
});

const replayPhonemize = (recorded) => async (text, lang) => {
  const hit = recorded.find((r) => r.input === text && r.lang === lang);
  if (!hit) throw new Error(`unrecorded phonemize call (${lang}): ${JSON.stringify(text)}`);
  return hit.output;
};

// Hand-checked: each token's phonemes in the kept clause string (characters outside the vocab already dropped).
const EXPECTED_SPAN_TEXT = [
  ['ʃˈɪpt', 'fˈaɪnəli', 'tədˈeɪ'],
  ['ðə', 'bˈɑːɾəl', 'ðə', 'lˈɪɾəl', 'kˈɪʔn'],
  ['ɐ', 'bˈʌʔn', 'ɹˈɪʔn', 'ɪn', 'sˈɜːʔn', 'wˈɜːdz', 'stˈɪl', 'kˈaʊnts'],
  ['wˈeɪt', '', 'wˈʌt'],
];

test('real narration with dropped characters: every word span is still right and times follow the model output', async () => {
  for (const [i, entry] of DROPPED_ENTRIES.entries()) {
    const replay = replayPhonemize(entry.phonemize);
    const { kept } = toIds(await toPhonemes(entry.text, replay), vocab);
    const tokenPhonemes = [];
    for (const text of entry.tokenTexts) tokenPhonemes.push(toIds(await toPhonemes(text, replay), vocab).kept);
    const spans = wordSpans(kept, tokenPhonemes);
    assert.deepEqual(spans.map((s) => spanText(kept, s)), EXPECTED_SPAN_TEXT[i], entry.say);
    const frames = framesOf(entry.durations);
    assert.equal(sum(frames) * FRAME_SAMPLES, entry.sampleCount, entry.say);
    const times = wordTimes({ kept, frames, spans });
    assert.equal(times.length, entry.tokenTexts.length, entry.say);
    times.forEach((t, k) => assert.ok(t.end >= t.start && (k === 0 || t.start >= times[k - 1].start), `${entry.say} word ${k}`));
  }
});

test('"Wait — what?": the dash token gets one zero-length time at the start of "what?"', async () => {
  const entry = DROPPED_ENTRIES.find((e) => e.say === 'Wait — what?');
  assert.deepEqual(entry.tokenTexts, ['Wait', '—', 'what?']);
  const replay = replayPhonemize(entry.phonemize);
  const tokenPhonemes = [];
  for (const text of entry.tokenTexts) tokenPhonemes.push(toIds(await toPhonemes(text, replay), vocab).kept);
  const spans = wordSpans(entry.kept, tokenPhonemes);
  assert.deepEqual(spans, [{ first: 1, last: 5 }, { first: 6, last: 5 }, { first: 9, last: 12 }]);
  const times = wordTimes({ kept: entry.kept, frames: framesOf(entry.durations), spans });
  assert.equal(times[1].start, times[2].start);
  assert.equal(times[1].end, times[2].start);
  assert.ok(times[0].end <= times[2].start, 'Wait (before punctuation) ends capped, before what? starts');
});

test('wordTimes: starts never decrease, every end is at or after its start, all inside the call', () => {
  for (const call of CALLS) {
    const { times } = timesOf(call);
    const callSeconds = call.sampleCount / SAMPLE_RATE;
    assert.equal(times.length, call.sayTokens.length, call.id);
    times.forEach((t, i) => {
      assert.ok(t.start >= 0 && t.end >= t.start && t.end <= callSeconds, `${call.id} word ${i}`);
      if (i > 0) assert.ok(t.start >= times[i - 1].start, `${call.id} word ${i} starts before the previous word`);
    });
  }
});

// Synthetic calls. Token k is kept character k - 1; tokens 0 and n + 1 are the pads. 1 frame = 25 ms.

test('first word of a call: start = raw - (-119 + 12 * pad frames) ms', () => {
  // kept "ab": tokens [pad, a, b, pad], frames [10, 4, 6, 3]. raw = cum[1] = 10 frames = 250 ms.
  // lead = -119 + 12 * 10 = 1 ms, so start = 249 ms. Last word: end = (cum[2] + min(6, 2)) = (14 + 2) frames = 400 ms.
  const times = wordTimes({ kept: 'ab', frames: [10, 4, 6, 3], spans: [{ first: 1, last: 2 }] });
  assert.deepEqual(times, [{ start: 0.249, end: 0.4 }]);
});

test('after punctuation: start = raw - 42 ms; a word followed by punctuation ends with its last token capped at 2 frames', () => {
  // kept "ab, cd": tokens a1 b2 ,3 space4 c5 d6, frames [12, 2, 3, 5, 4, 2, 6, 1].
  // word 1: raw = 12 frames = 300 ms, lead = -119 + 12 * 12 = 25 ms, start = 275 ms.
  // word 2: raw = cum[5] = 12 + 2 + 3 + 5 + 4 = 26 frames = 650 ms, start = 650 - 42 = 608 ms.
  // word 1 is followed by ", ": end = cum[2] + min(3, 2) = 14 + 2 = 16 frames = 400 ms (not 608 ms, the next start).
  // word 2 ends at cum[6] + min(6, 2) = 28 + 2 = 30 frames = 750 ms.
  const times = wordTimes({ kept: 'ab, cd', frames: [12, 2, 3, 5, 4, 2, 6, 1], spans: [{ first: 1, last: 2 }, { first: 5, last: 6 }] });
  assert.deepEqual(times, [{ start: 0.275, end: 0.4 }, { start: 0.608, end: 0.75 }]);
});

test('a word followed directly by another word, with only a space between, ends at that word start', () => {
  // kept "ab cd", frames [12, 2, 5, 3, 4, 5, 1]: word 1's last token b has 5 frames, but only a space follows, so no cap.
  // word 2: raw = cum[4] = 12 + 2 + 5 + 3 = 22 frames = 550 ms; lead = 3 / 2 * 25 + 75 = 112.5 ms; start = 437.5 ms.
  // word 1 ends at 437.5 ms (capped it would be cum[2] + 2 = 16 frames = 400 ms).
  const times = wordTimes({ kept: 'ab cd', frames: [12, 2, 5, 3, 4, 5, 1], spans: [{ first: 1, last: 2 }, { first: 4, last: 5 }] });
  assert.equal(times[0].end, 0.4375);
  assert.equal(times[0].end, times[1].start);
});

test('mid-phrase: start = raw - (space frames / 2) * 25 ms - 75 ms', () => {
  // kept "ab cd": tokens a1 b2 space3 c4 d5, frames [12, 2, 3, 3, 4, 5, 1].
  // word 2: raw = cum[4] = 12 + 2 + 3 + 3 = 20 frames = 500 ms; lead = 3 / 2 * 25 + 75 = 112.5 ms; start = 387.5 ms.
  // word 2 ends at cum[5] + min(5, 2) = 24 + 2 = 26 frames = 650 ms.
  const times = wordTimes({ kept: 'ab cd', frames: [12, 2, 3, 3, 4, 5, 1], spans: [{ first: 1, last: 2 }, { first: 4, last: 5 }] });
  assert.deepEqual(times, [{ start: 0.275, end: 0.3875 }, { start: 0.3875, end: 0.65 }]);
});

test('mid-phrase after a run of spaces (a dropped bracket): the lead uses the summed frames of the run', () => {
  // kept "ab  cd": a1 b2 space3 space4 c5 d6, frames [12, 2, 3, 2, 2, 4, 5, 1].
  // word 2: raw = cum[5] = 12 + 2 + 3 + 2 + 2 = 21 frames = 525 ms; lead = (2 + 2) / 2 * 25 + 75 = 125 ms; start = 400 ms.
  // word 1 (only spaces follow) ends at 400 ms; word 2 ends at cum[6] + min(5, 2) = 25 + 2 = 27 frames = 675 ms.
  const times = wordTimes({ kept: 'ab  cd', frames: [12, 2, 3, 2, 2, 4, 5, 1], spans: [{ first: 1, last: 2 }, { first: 5, last: 6 }] });
  assert.deepEqual(times, [{ start: 0.275, end: 0.4 }, { start: 0.4, end: 0.675 }]);
});

test('mid-phrase inside a linked group (no space before the word): start = raw - 75 ms', () => {
  // kept "ɪnðə": tokens ɪ1 n2 ð3 ə4, frames [10, 2, 2, 3, 2, 1].
  // word 1: raw = 250 ms, lead = -119 + 120 = 1 ms, start = 249 ms. word 2: raw = cum[3] = 14 frames = 350 ms, start = 275 ms.
  // word 2 ends at cum[4] + min(2, 2) = 17 + 2 = 19 frames = 475 ms.
  const times = wordTimes({ kept: 'ɪnðə', frames: [10, 2, 2, 3, 2, 1], spans: [{ first: 1, last: 2 }, { first: 3, last: 4 }] });
  assert.deepEqual(times, [{ start: 0.249, end: 0.275 }, { start: 0.275, end: 0.475 }]);
});

test('a start never precedes the previous word start', () => {
  // kept "a bc": tokens a1 space2 b3 c4, frames [5, 1, 1, 2, 2, 1].
  // word 1: raw = 5 frames = 125 ms, lead = -119 + 60 = -59 ms, clamped to 0, so start = 125 ms.
  // word 2: raw = cum[3] = 7 frames = 175 ms, lead = 1 / 2 * 25 + 75 = 87.5 ms, so 87.5 ms, clamped up to 125 ms.
  // word 1 (only a space follows) ends at 125 ms; word 2 ends at cum[4] + min(2, 2) = 9 + 2 = 11 frames = 275 ms.
  const times = wordTimes({ kept: 'a bc', frames: [5, 1, 1, 2, 2, 1], spans: [{ first: 1, last: 1 }, { first: 3, last: 4 }] });
  assert.deepEqual(times, [{ start: 0.125, end: 0.125 }, { start: 0.125, end: 0.275 }]);
});

test('the word before the call end has its last token capped at 2 frames (phrase-final lengthening)', () => {
  // kept "ab.": tokens a1 b2 .3, frames [12, 3, 14, 6, 1]. raw = 300 ms, start = 300 - 25 = 275 ms.
  // Uncapped the word would end at cum[3] = 29 frames = 725 ms; capped: cum[2] + 2 = 17 frames = 425 ms.
  const times = wordTimes({ kept: 'ab.', frames: [12, 3, 14, 6, 1], spans: [{ first: 1, last: 2 }] });
  assert.deepEqual(times, [{ start: 0.275, end: 0.425 }]);
});

test('the call-start lead is clamped to at least 0: a short pad never moves a start later than raw', () => {
  // kept "a": frames [2, 1, 1]. raw = 50 ms, lead = -119 + 24 = -95 ms, clamped to 0, so start = 50 ms (not 145 ms);
  // capped end = cum[1] + min(1, 2) = 3 frames = 75 ms.
  assert.deepEqual(wordTimes({ kept: 'a', frames: [2, 1, 1], spans: [{ first: 1, last: 1 }] }), [{ start: 0.05, end: 0.075 }]);
  // kept "ab": frames [9, 4, 6, 3]. raw = 225 ms, lead = -119 + 108 = -11 ms, clamped to 0: start = 225 ms;
  // end = cum[2] + min(6, 2) = 13 + 2 = 15 frames = 375 ms.
  assert.deepEqual(wordTimes({ kept: 'ab', frames: [9, 4, 6, 3], spans: [{ first: 1, last: 2 }] }), [{ start: 0.225, end: 0.375 }]);
  // kept "ab": frames [5, 4, 6, 3]. raw = cum[1] = 5 frames = 125 ms, lead = -119 + 60 = -59 ms, clamped to 0:
  // start equals raw, 125 ms (unclamped it would be 184 ms). End = cum[2] + min(6, 2) = 9 + 2 = 11 frames = 275 ms.
  assert.deepEqual(wordTimes({ kept: 'ab', frames: [5, 4, 6, 3], spans: [{ first: 1, last: 2 }] }), [{ start: 0.125, end: 0.275 }]);
  // At the boundary, pad 10 frames: lead = -119 + 120 = 1 ms, positive, so it applies: raw 250 ms, start 249 ms.
  assert.equal(wordTimes({ kept: 'ab', frames: [10, 4, 6, 3], spans: [{ first: 1, last: 2 }] })[0].start, 0.249);
});

test('wordTimes rejects frames that do not match the kept phonemes', () => {
  assert.throws(() => wordTimes({ kept: 'ab', frames: [1, 1, 1], spans: [{ first: 1, last: 2 }] }), /frames/);
});

test('wordTimes rejects frames that are not integers of at least 1 (raw float durations passed by mistake)', () => {
  const spans = [{ first: 1, last: 1 }];
  assert.throws(() => wordTimes({ kept: 'a', frames: [2, 1.5, 1], spans }), (error) => error instanceof RangeError && /frames\[1\]/.test(error.message));
  assert.throws(() => wordTimes({ kept: 'a', frames: [2, 0, 1], spans }), (error) => error instanceof RangeError && /frames\[1\]/.test(error.message));
});

// Pinned behaviour, not measurement: the current wordTimes output for every recorded call (durations.json and
// dropped.json), written by .scratch/voice/make-word-times-golden.mjs. A change here means context classification or
// the end rule changed on real lines; regenerate only for an intended change and say so in the commit.
test('pinned: wordTimes output for the recorded calls is unchanged', async () => {
  const golden = readFixture('word-times.json').calls;
  const actual = [];
  for (const call of CALLS) actual.push({ id: call.id, times: timesOf(call).times });
  for (const entry of DROPPED_ENTRIES) {
    const replay = replayPhonemize(entry.phonemize);
    const tokenPhonemes = [];
    for (const text of entry.tokenTexts) tokenPhonemes.push(toIds(await toPhonemes(text, replay), vocab).kept);
    const spans = wordSpans(entry.kept, tokenPhonemes);
    actual.push({ id: entry.say, times: wordTimes({ kept: entry.kept, frames: framesOf(entry.durations), spans }) });
  }
  assert.deepEqual(actual, golden);
});

test('mutation check: an off-by-one token shift moves the starts by more than 20 ms in the median', () => {
  for (const call of CALLS) {
    const { spans, times } = timesOf(call);
    const shifted = spans.map((s) => ({ first: s.first + 1, last: s.last + 1 }));
    const wrong = wordTimes({ kept: call.kept, frames: framesOf(call.durations), spans: shifted });
    const moved = times.map((t, i) => Math.abs(wrong[i].start - t.start));
    assert.ok(median(moved) > OFF_BY_ONE_MIN_MEDIAN_S, `${call.id}: median shift ${median(moved)} s`);
  }
});
