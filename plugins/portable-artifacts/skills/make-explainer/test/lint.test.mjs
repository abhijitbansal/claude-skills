import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintText, lintPlaceholders, loadBannedPhrases } from '../scripts/lib/lint.mjs';

const P = 'sections[0].text';
const errorsOf = (text, opts) => lintText(text, P, opts).errors;
const clean = 'The build reads the spec and writes one page.';

test('clean prose has no errors and no warnings', () => {
  assert.deepEqual(lintText(clean, P), { errors: [] });
});

test('TODO: placeholder is an error', () => {
  assert.deepEqual(errorsOf('TODO: summarise the change'), [{ path: P, message: 'still has a TODO placeholder — replace it with real content' }]);
  assert.deepEqual(lintPlaceholders('see TODO: later', 'x'), [{ path: 'x', message: 'still has a TODO placeholder — replace it with real content' }]);
  assert.deepEqual(errorsOf('todo list and a TODO without colon'), []);
});

test('lorem ipsum is an error, case-insensitive', () => {
  const expected = [{ path: P, message: 'still has lorem ipsum placeholder text — replace it with real content' }];
  assert.deepEqual(errorsOf('Lorem ipsum dolor sit amet'), expected);
  assert.deepEqual(errorsOf('LOREM   IPSUM'), expected);
});

test('emoji is an error and names what it found', () => {
  assert.deepEqual(errorsOf('Shipped 🚀'), [{ path: P, message: 'contains emoji "🚀"; remove it and say it in words' }]);
  assert.deepEqual(errorsOf('Done ✅ and 🙂'), [{ path: P, message: 'contains emoji "✅", "🙂"; remove them and say it in words' }]);
  assert.deepEqual(errorsOf('🙂 🙃 😀 😁'), [{ path: P, message: 'contains emoji "🙂", "🙃", "😀", …; remove them and say it in words' }]);
  assert.equal(errorsOf('Flag 🇺🇸').length, 1);
  assert.equal(errorsOf('Key 1️⃣').length, 1);
});

test('text symbols are not emoji', () => {
  assert.deepEqual(errorsOf('Copyright © 2026, Acme® and Acme™ → next ✓ done — fin'), []);
});

test('banned phrases are errors with the replacement from references/style.md', () => {
  assert.deepEqual(errorsOf('Let us delve into it'), [{ path: P, message: 'banned phrase "delve"; replace it with "dig into"' }]);
  assert.deepEqual(errorsOf('We leverage the cache'), [{ path: P, message: 'banned phrase "leverage"; replace it with "use"' }]);
  assert.deepEqual(errorsOf('A seamless flow'), [{ path: P, message: 'banned phrase "seamless"; replace it with "smooth"' }]);
  assert.deepEqual(errorsOf('Runs seamlessly'), [{ path: P, message: 'banned phrase "seamlessly"; replace it with "smoothly"' }]);
  assert.deepEqual(errorsOf('In today\'s fast-paced world'), [{ path: P, message: 'banned phrase "In today\'s fast-paced"; cut it' }]);
  assert.deepEqual(errorsOf('A robust and scalable design'), [{ path: P, message: 'banned phrase "robust and scalable"; say what it handles' }]);
  assert.deepEqual(errorsOf('Pure synergy'), [{ path: P, message: 'banned phrase "synergy"; say what combines' }]);
});

test('every phrase in style.md fires', () => {
  const phrases = loadBannedPhrases();
  for (const required of ['delve', 'elevate', 'seamless', 'seamlessly', 'unleash', 'game-changer', 'revolutionize', 'cutting-edge', "in today's fast-paced", 'robust and scalable', 'leverage', 'utilize', 'a testament to', 'embark', 'tapestry', 'synergy', 'paradigm shift', 'unlock the power of']) {
    assert.ok(phrases.some((p) => p.phrase === required), `style.md is missing ${required}`);
  }
  for (const { phrase } of phrases) {
    const errors = errorsOf(`We say ${phrase} here.`);
    assert.equal(errors.length, 1, phrase);
    assert.match(errors[0].message, /^banned phrase /, phrase);
  }
});

test('banned phrases match whole words, case-insensitively', () => {
  assert.equal(errorsOf('DELVE deeper').length, 1);
  assert.deepEqual(errorsOf('DELVE deeper'), [{ path: P, message: 'banned phrase "DELVE"; replace it with "dig into"' }]);
  assert.equal(errorsOf('A game changer').length, 1);
  assert.deepEqual(errorsOf('Pre-leverage, the leveraged buyout'), [{ path: P, message: 'banned phrase "leverage"; replace it with "use"' }, { path: P, message: 'banned phrase "leveraged"; replace it with "used"' }]);
  assert.deepEqual(errorsOf('The delvers and a tapestries note'), []);
  assert.deepEqual(errorsOf('Embarkation point'), []);
  assert.equal(errorsOf('in today’s fast-paced life').length, 1);
});

test('a heading ending in ! is an error only when it is a heading', () => {
  const expected = [{ path: P, message: 'heading ends with "!"; drop the exclamation mark and state the claim plainly' }];
  assert.deepEqual(errorsOf('Ship it!', { heading: true }), expected);
  assert.deepEqual(errorsOf('Ship it!  ', { heading: true }), expected);
  assert.deepEqual(errorsOf('Ship it!'), []);
  assert.deepEqual(errorsOf('Ship it', { heading: true }), []);
});

test('numbered section titles are errors', () => {
  const opts = { heading: true, sectionTitle: true };
  assert.deepEqual(errorsOf('01 Overview', opts), [{ path: P, message: 'title starts with the number "01"; drop it — the page already orders sections' }]);
  assert.equal(errorsOf('02. Design', opts).length, 1);
  assert.equal(errorsOf('03 — Risks', opts).length, 1);
  assert.deepEqual(errorsOf('01 Overview', { heading: true }), []);
  assert.deepEqual(errorsOf('2026 plan', opts), []);
  assert.deepEqual(errorsOf('3 reasons to ship', opts), []);
  assert.deepEqual(errorsOf('007 agents', opts), []);
});

test('length is no longer linted here; budget.mjs owns the soft caps', () => {
  assert.deepEqual(lintText(Array(300).fill('word').join(' '), P), { errors: [] });
});

test('several problems in one string are all reported', () => {
  const r = lintText('TODO: delve 🚀', P);
  assert.deepEqual(r.errors.map((e) => e.message), [
    'still has a TODO placeholder — replace it with real content',
    'contains emoji "🚀"; remove it and say it in words',
    'banned phrase "delve"; replace it with "dig into"',
  ]);
});
