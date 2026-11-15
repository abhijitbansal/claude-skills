import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAnchor, AnchorError } from '../../engine/script/anchors.mjs';

const shot = {
  id: 'a',
  duration: 2,
  words: [{ text: 'One', start: 0, end: 0.3 }, { text: 'file.', start: 0.3, end: 0.8 }],
  sentences: [{ start: 0, end: 0.8 }],
};
const twoSentences = {
  id: 'b',
  duration: 4,
  words: [
    { text: 'Hi.', start: 0.1, end: 0.4 },
    { text: 'Then', start: 1.5, end: 1.8 },
    { text: 'this.', start: 1.8, end: 2.2 },
  ],
  sentences: [{ start: 0.1, end: 0.4 }, { start: 1.5, end: 2.2 }],
};
const silent = { id: 'quiet', duration: 3, words: [], sentences: [] };

// --- binding test from the brief ---

test('word by index, by text, with an offset, clamped', () => {
  assert.equal(resolveAnchor('word:1', shot), 0.3);
  assert.equal(resolveAnchor('word:FILE', shot), 0.3);
  assert.equal(resolveAnchor('word:file-0.08', shot), 0.22);
  assert.equal(resolveAnchor('start-1', shot), 0);
  assert.equal(resolveAnchor('end', shot), 2);
});

// --- edge cases named in prose ---

test('a number is seconds, and so is a numeric string', () => {
  assert.equal(resolveAnchor(1.25, shot), 1.25);
  assert.equal(resolveAnchor('1.5', shot), 1.5);
  assert.equal(resolveAnchor(0, shot), 0);
});

test('seconds are clamped to the shot', () => {
  assert.equal(resolveAnchor(99, shot), 2);
  assert.equal(resolveAnchor(-3, shot), 0);
  assert.equal(resolveAnchor('end+5', shot), 2);
});

test('start and end take an offset', () => {
  assert.equal(resolveAnchor('start+0.5', shot), 0.5);
  assert.equal(resolveAnchor('end-0.25', shot), 1.75);
});

test('word text ignores case and punctuation on both sides', () => {
  assert.equal(resolveAnchor('word:file.', shot), 0.3);
  assert.equal(resolveAnchor('word:One', shot), 0);
  assert.equal(resolveAnchor('word:one+0.1', shot), 0.1);
});

test('the first word that matches wins', () => {
  const repeat = { id: 'r', duration: 3, words: [{ text: 'go', start: 0.2, end: 0.4 }, { text: 'go', start: 0.9, end: 1.1 }], sentences: [] };
  assert.equal(resolveAnchor('word:go', repeat), 0.2);
});

test('sentence by index', () => {
  assert.equal(resolveAnchor('sentence:0', twoSentences), 0.1);
  assert.equal(resolveAnchor('sentence:1', twoSentences), 1.5);
  assert.equal(resolveAnchor('sentence:1+0.2', twoSentences), 1.7);
});

test('a word index past the end lists how many words there are', () => {
  assert.throws(() => resolveAnchor('word:5', shot), (err) => {
    assert.ok(err instanceof AnchorError);
    assert.match(err.message, /word:5 is out of range in shot "a"; it has 2 words \(word:0 to word:1\)/);
    return true;
  });
});

test('a sentence index past the end lists how many sentences there are', () => {
  assert.throws(() => resolveAnchor('sentence:2', twoSentences), /sentence:2 is out of range in shot "b"; it has 2 sentences \(sentence:0 to sentence:1\)/);
});

test('an unknown word lists the words of the shot', () => {
  assert.throws(() => resolveAnchor('word:server', shot), (err) => {
    assert.ok(err instanceof AnchorError);
    assert.equal(err.message, 'no word "server" in shot "a"; its words are: One, file.');
    return true;
  });
});

test('a shot with no narration says so for word and sentence anchors', () => {
  assert.throws(() => resolveAnchor('word:0', silent), /shot "quiet" has no narration/);
  assert.throws(() => resolveAnchor('sentence:0', silent), /shot "quiet" has no narration/);
  assert.equal(resolveAnchor('start', silent), 0);
  assert.equal(resolveAnchor('end', silent), 3);
});

test('beat anchors are refused until music exists', () => {
  assert.throws(() => resolveAnchor('beat:2', shot), (err) => {
    assert.ok(err instanceof AnchorError);
    assert.equal(err.message, 'beat anchors need music, which this build does not have yet');
    return true;
  });
  assert.throws(() => resolveAnchor('beat:2+0.1', shot), /beat anchors need music/);
});

test('an anchor that fits no form lists the accepted forms', () => {
  for (const bad of ['middle', 'word:', 'sentence:x', 'word:1+', '', 'start+abc', '1.5s']) {
    assert.throws(() => resolveAnchor(bad, shot), (err) => {
      assert.ok(err instanceof AnchorError, `${bad}: not an AnchorError`);
      assert.match(err.message, /start/);
      assert.match(err.message, /end/);
      assert.match(err.message, /word:<n>/);
      assert.match(err.message, /word:<text>/);
      assert.match(err.message, /sentence:<n>/);
      assert.match(err.message, /\+<s>/);
      return true;
    }, `anchor ${JSON.stringify(bad)}`);
  }
});

test('a value that is neither a number nor a string is refused with the forms', () => {
  assert.throws(() => resolveAnchor(null, shot), AnchorError);
  assert.throws(() => resolveAnchor(NaN, shot), AnchorError);
  assert.throws(() => resolveAnchor({ at: 1 }, shot), /word:<n>/);
});

test('results are rounded to 1e-6 seconds', () => {
  assert.equal(resolveAnchor('word:1-0.08', shot), 0.22);
  assert.equal(resolveAnchor(0.1 + 0.2, shot), 0.3);
});

test('the shot is not mutated', () => {
  const before = JSON.stringify(shot);
  resolveAnchor('word:file-0.08', shot);
  assert.equal(JSON.stringify(shot), before);
});
