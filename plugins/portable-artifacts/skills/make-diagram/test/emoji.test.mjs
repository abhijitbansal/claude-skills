import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isOneEmoji, graphemeCount } from '../scripts/lib/emoji.mjs';

test('one emoji: a pictograph, with a skin tone, a ZWJ family, a flag, a keycap, a variation selector', () => {
  for (const s of ['🛒', '👍🏽', '👨‍👩‍👧', '🧑‍💻', '🇯🇵', '1️⃣', '#️⃣', '❤️', '🏳️‍🌈']) assert.equal(isOneEmoji(s), true, s);
});

test('not one emoji: letters, digits, two emoji, a lone regional indicator, a trailing space, empty', () => {
  for (const s of ['A', 'ab', 'ok', '1', '#', '👍👍', '🇯', '💳 ', '', ' ']) assert.equal(isOneEmoji(s), false, JSON.stringify(s));
});

test('graphemeCount counts what a reader sees as one character', () => {
  assert.equal(graphemeCount('👨‍👩‍👧'), 1);
  assert.equal(graphemeCount('🇯🇵'), 1);
  assert.equal(graphemeCount('👍👍'), 2);
  assert.equal(graphemeCount('ab'), 2);
  assert.equal(graphemeCount(''), 0);
});

const ZWJ = '\u200d';

test('structure: at most four joined parts, no empty part, one skin tone per part, ten code points', () => {
  assert.equal(isOneEmoji(['\u{1f9d1}\u{1f3fb}', '\u2764\ufe0f', '\u{1f48b}', '\u{1f9d1}\u{1f3fc}'].join(ZWJ)), true, 'the longest common sequence: four parts, ten code points');
  assert.equal(isOneEmoji('\u{1f3f4}\u{e0067}\u{e0062}\u{e0065}\u{e006e}\u{e0067}\u{e007f}'), true, 'a subdivision flag: one base, six tag letters');
  assert.equal(isOneEmoji(Array.from({ length: 50 }, () => '\u{1f44d}').join(ZWJ)), false, 'a 50-part ZWJ chain is one grapheme but not one emoji');
  assert.equal(isOneEmoji('\u{1f44d}\u{1f3fd}\u{1f3fd}'), false, 'two skin tones');
  assert.equal(isOneEmoji('\u{1f44d}' + ZWJ), false, 'a trailing joiner');
  assert.equal(isOneEmoji(Array.from({ length: 5 }, () => '\u{1f9d1}').join(ZWJ)), false, 'five parts');
});

test('well-formedness: one base per ZWJ part, one VS16 per part, tag letters only on a black flag with a cancel tag', () => {
  assert.equal(isOneEmoji('\u{1f44d}' + ZWJ + '\u{1f3fd}'), false, 'a part holding only a skin tone');
  assert.equal(isOneEmoji('\u{1f44d}' + ZWJ + '\ufe0f'), false, 'a part holding only a variation selector');
  assert.equal(isOneEmoji('\u2764' + '\ufe0f'.repeat(5)), false, 'five variation selectors');
  assert.equal(isOneEmoji('\u{1f44d}\u{e0067}\u{e0067}'), false, 'tag letters on a non-flag base, no cancel tag');
  assert.equal(isOneEmoji('\u{1f3f4}\u{e0067}\u{e0067}'), false, 'a flag base with tags but no cancel tag');
  assert.equal(isOneEmoji('\u{1f44d}\u{e0067}\u{e007f}'), false, 'tags on a non-flag base');
  assert.equal(isOneEmoji('\u{1f9d1}\u{1f3fb}' + ZWJ + '\u{1f4bb}'), true);
});

test('the source spells its invisible characters as escapes', () => {
  const src = fs.readFileSync(new URL('../scripts/lib/emoji.mjs', import.meta.url), 'utf8');
  assert.ok(!/[\u200d\ufe0f\u20e3]/.test(src), 'a literal ZWJ, VS16 or keycap combiner is invisible in an editor');
});
