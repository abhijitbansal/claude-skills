import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintText, lintPlaceholders, loadBannedPhrases, rawMarkdownWarnings, labelTitleWarnings, LABEL_TITLES } from '../scripts/lib/lint.mjs';
import { validateSpec } from '../scripts/lib/spec.mjs';

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

test('emoji is allowed: lint never reports it (density is a budget warning)', () => {
  assert.deepEqual(errorsOf('Launch 🚀 day'), []);
  assert.deepEqual(errorsOf('Done ✅ and 🙂, flag 🇺🇸, key 1️⃣'), []);
  assert.deepEqual(errorsOf('🙂 🙃 😀 😁'), []);
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
    'banned phrase "delve"; replace it with "dig into"',
  ]);
});

// ---- raw markdown and label titles are warnings (PA-19) ---------------------------------------------

const mdWarn = (text) => rawMarkdownWarnings(text, P);

test('a heading, a numbered list or a table in prose prints literally, so each warns once with the fix', () => {
  const heading = mdWarn('Intro.\n\n## Design\n\nMore.');
  assert.equal(heading.length, 1);
  assert.equal(heading[0].path, P);
  assert.match(heading[0].message, /heading/);
  assert.match(heading[0].message, /bold|section/);
  const numbered = mdWarn('Steps:\n1. Open it\n2. Run it');
  assert.equal(numbered.length, 1);
  assert.match(numbered[0].message, /numbered list/);
  assert.match(numbered[0].message, /steps section|"- " list/);
  const table = mdWarn('| a | b |\n|---|---|\n| 1 | 2 |');
  assert.equal(table.length, 1);
  assert.match(table[0].message, /table/);
  assert.equal(mdWarn('# One\n\n1. a\n\n| a |\n|---|').length, 3, 'one warning per pattern, not per line');
});

test('bold, italic, code, links, dash lists, a hash inside a line and a year with a dot do not warn', () => {
  assert.deepEqual(mdWarn('**Bold**, *italic*, `code`, [a link](https://example.com) and issue #12 in a line.'), []);
  assert.deepEqual(mdWarn('- one\n- two'), []);
  assert.deepEqual(mdWarn('It shipped in 2026. Then more.'), []);
  assert.deepEqual(mdWarn('Use a pipe | in prose, and a|b too.'), []);
  assert.deepEqual(mdWarn('#hashtag is not a heading'), []);
});

test('a label title warns; the scaffold\'s own generated titles do not', () => {
  for (const title of ['Overview', 'summary', 'Introduction:', ' Changes ', 'Background.', 'Conclusion']) {
    const found = labelTitleWarnings(title, 'sections[1].title');
    assert.equal(found.length, 1, title);
    assert.match(found[0].message, /label, not a claim/);
  }
  assert.deepEqual(labelTitleWarnings('Search now ignores case', 'sections[1].title'), []);
  assert.deepEqual(labelTitleWarnings('Overview of the cache layer', 'sections[1].title'), [], 'only a title that is the label alone');
  for (const generated of ['The branch in numbers', 'Files changed', 'How the branch got here', 'Regression checks', 'Repository root', 'Other areas', 'Approve, change or stop this plan']) {
    assert.deepEqual(labelTitleWarnings(generated, 'x'), [], generated);
  }
  assert.deepEqual(LABEL_TITLES, ['overview', 'summary', 'introduction', 'changes', 'background', 'conclusion']);
});

test('validate reports them as warnings only, at the string path, and never for table cells or code', async () => {
  const r = await validateSpec({ title: 'T', sections: [
    { type: 'text', title: 'Overview', text: 'Intro.\n\n## Design' },
    { type: 'table', title: 'Numbers', columns: ['a'], rows: [['# not prose']] },
    { type: 'code', code: '# a comment\n1. x' },
  ] });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.warnings.filter((w) => /label, not a claim|heading/.test(w.message)).map((w) => w.path), ['sections[0].title', 'sections[0].text']);
});
