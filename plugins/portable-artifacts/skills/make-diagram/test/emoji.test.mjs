import { test } from 'node:test';
import assert from 'node:assert/strict';
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
