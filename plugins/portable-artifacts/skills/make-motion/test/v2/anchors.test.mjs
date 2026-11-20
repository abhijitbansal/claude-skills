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

test('an anchor with a line terminator is an AnchorError, not a TypeError', () => {
  for (const bad of ['word:a\nb', 'start +1', 'end\r\n+1', 'sentence:0 ', ' start']) {
    assert.throws(() => resolveAnchor(bad, shot), (err) => err instanceof AnchorError, JSON.stringify(bad));
  }
});

test('a word with a hyphen and digits can be named whole, with or without an offset', () => {
  const covid = { id: 'c', duration: 3, words: [{ text: 'covid-19', start: 0.4, end: 0.9 }, { text: 'file.', start: 1, end: 1.5 }], sentences: [] };
  assert.equal(resolveAnchor('word:covid-19', covid), 0.4);
  assert.equal(resolveAnchor('word:COVID-19', covid), 0.4);
  assert.equal(resolveAnchor('word:covid-19+0.1', covid), 0.5);
  assert.equal(resolveAnchor('word:covid19', covid), 0.4);
  assert.equal(resolveAnchor('word:file-0.08', covid), 0.92);
});

test('a value echoed in an anchor error is cut to 80 characters', () => {
  for (const bad of ['x'.repeat(500), `word:${'y'.repeat(500)}`]) {
    assert.throws(() => resolveAnchor(bad, shot), (err) => {
      assert.ok(err.message.length < 400, `${err.message.length} characters`);
      assert.match(err.message, /\.\.\./);
      return true;
    });
  }
});

const numeric = {
  id: 'n',
  duration: 4,
  words: [
    { text: 'a', start: 0.1, end: 0.3 },
    { text: '31', start: 0.5, end: 0.9 },
    { text: '205', start: 1.2, end: 1.6 },
    { text: 'b', start: 2, end: 2.2 },
    { text: 'ab', start: 2.5, end: 2.9 },
  ],
  sentences: [],
};

test('word: followed by digits is always an index, with or without an offset', () => {
  assert.equal(resolveAnchor('word:3', numeric), 2);
  assert.equal(resolveAnchor('word:3+1', numeric), 3);
  assert.equal(resolveAnchor('word:2-0.5', numeric), 0.7);
  assert.throws(() => resolveAnchor('word:31', numeric), /word:31 is out of range in shot "n"/);
  assert.throws(() => resolveAnchor('word:205', numeric), /word:205 is out of range/);
});

test('whitespace inside a word anchor never matches a word', () => {
  for (const bad of ['word:a\nb', 'word:a b', 'word:a b', 'word:a\tb-0.5']) {
    assert.throws(() => resolveAnchor(bad, numeric), (err) => {
      assert.ok(err instanceof AnchorError);
      assert.match(err.message, /^cannot read anchor/);
      return true;
    }, JSON.stringify(bad));
  }
});

test('a cut inside a surrogate pair never happens', () => {
  const emoji = '\u{1F600}'.repeat(100);
  assert.throws(() => resolveAnchor(`word:${emoji}`, shot), (err) => {
    assert.ok(err.message.isWellFormed(), 'lone surrogate in the message');
    assert.ok(err.message.includes('...'));
    return true;
  });
  assert.throws(() => resolveAnchor(emoji, shot), (err) => err.message.isWellFormed());
});

test('the shot id is cut where it is echoed', () => {
  const longId = { ...shot, id: 'x'.repeat(500) };
  for (const bad of ['word:server', 'word:9']) {
    assert.throws(() => resolveAnchor(bad, longId), (err) => {
      assert.ok(err.message.length < 300, `${err.message.length} characters`);
      return true;
    });
  }
  assert.throws(() => resolveAnchor('word:0', { ...longId, words: [], sentences: [] }), (err) => err.message.length < 300);
  assert.throws(() => resolveAnchor('sentence:5', longId), (err) => err.message.length < 300);
});

test('a value that is not a string is shown as JSON, a string in quotes', () => {
  assert.throws(() => resolveAnchor({ at: 1 }, shot), /cannot read anchor \{"at":1\}; use/);
  assert.throws(() => resolveAnchor('middle', shot), /cannot read anchor "middle"; use/);
  assert.throws(() => resolveAnchor(null, shot), /cannot read anchor null; use/);
});

test('the shot is not mutated', () => {
  const before = JSON.stringify(shot);
  resolveAnchor('word:file-0.08', shot);
  assert.equal(JSON.stringify(shot), before);
});
