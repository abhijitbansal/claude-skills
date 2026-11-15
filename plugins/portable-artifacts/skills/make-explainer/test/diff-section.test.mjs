// PA-61 part 1: the `diff` section (schema, render, budget). SKILL.md advertises "diff review"; this is the section
// that carries a diff, with offline add/delete/hunk marking (no highlighter, no network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { SECTIONS } from '../scripts/lib/sections.mjs';
import { TYPES, LIMITS } from '../scripts/lib/schema.mjs';
import { validateSpec } from '../scripts/lib/spec.mjs';
import { buildPage } from '../scripts/lib/page.mjs';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const render = (section) => SECTIONS.diff.render({ type: 'diff', ...section }, { dir: process.cwd(), theme: {}, mode: 'page' });
const doc = (sections, extra = {}) => ({ title: 'Review', sections, ...extra });
const errorsOf = async (spec) => (await validateSpec(spec, { dir: FIXTURES })).errors;

const DIFF = [
  'diff --git a/src/a.js b/src/a.js',
  'index 1111111..2222222 100644',
  '--- a/src/a.js',
  '+++ b/src/a.js',
  '@@ -1,3 +1,3 @@ function a()',
  ' const x = 1;',
  '-const y = 2;',
  '+const y = 3; // <b>"changed"</b>',
  ' return x;',
  '\\ No newline at end of file',
].join('\n');

test('diff is a registered section type with a renderer and a closed schema', () => {
  assert.ok(TYPES.includes('diff'));
  assert.equal(typeof SECTIONS.diff.render, 'function');
});

test('every line is one marked row: add, delete, context, hunk, file header and note; the sign stays in the text', () => {
  const html = render({ diff: DIFF });
  const count = (cls) => (html.match(new RegExp(`class="dl dl-${cls}"`, 'g')) ?? []).length;
  assert.equal(count('add'), 1);
  assert.equal(count('del'), 1);
  assert.equal(count('ctx'), 2);
  assert.equal(count('hunk'), 1);
  assert.equal(count('meta'), 4, 'diff --git, index, --- and +++');
  assert.equal(count('note'), 1);
  assert.match(html, /<span class="dl dl-add">\+const y = 3;/);
  assert.match(html, /<span class="dl dl-del">-const y = 2;\n<\/span>/);
  assert.match(html, /<span class="dl dl-hunk">@@ -1,3 \+1,3 @@ function a\(\)\n<\/span>/);
});

test('the markup is a code figure, so the Copy button copies the diff as written, and every character is escaped', () => {
  const html = render({ diff: DIFF, file: 'src/a.js', caption: 'The **second** change' });
  assert.match(html, /^<figure class="code diff">/);
  assert.match(html, /<button type="button" class="btn copy" data-copy aria-label="Copy diff">Copy<\/button>/);
  assert.match(html, /<span class="code-lang">src\/a\.js<\/span>/);
  assert.match(html, /<figcaption>The <strong>second<\/strong> change<\/figcaption>/);
  assert.ok(!html.includes('<b>"changed"</b>'));
  assert.match(html, /&lt;b&gt;&quot;changed&quot;&lt;\/b&gt;/);
  assert.match(html, /<pre tabindex="0"><code>/);
});

test('a line that starts with plus or minus signs inside a hunk is still add or delete; "+++" before any hunk is a header', () => {
  const html = render({ diff: '--- a/x\n+++ b/x\n@@ -1 +1 @@\n---\n+++' });
  const classes = [...html.matchAll(/class="dl dl-(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(classes, ['meta', 'meta', 'hunk', 'del', 'add']);
});

test('a plain patch with no headers renders too, and an empty line stays a context row', () => {
  const html = render({ diff: '@@ -1,2 +1,2 @@\n a\n\n-b\n+c' });
  assert.deepEqual([...html.matchAll(/class="dl dl-(\w+)"/g)].map((m) => m[1]), ['hunk', 'ctx', 'ctx', 'del', 'add']);
});

test('validate accepts a diff, caps it at the line limit with the count in the message, and refuses unknown fields', async () => {
  assert.deepEqual(await errorsOf(doc([{ type: 'diff', diff: DIFF, file: 'src/a.js', caption: 'One change.' }])), []);
  assert.equal(LIMITS.diffLines, 200);
  const long = Array.from({ length: 201 }, (_, i) => `+line ${i}`).join('\n');
  assert.deepEqual(await errorsOf(doc([{ type: 'diff', diff: long }])), [
    { path: 'sections[0].diff', message: 'diff is 201 lines; the limit is 200 — show the hunks that matter or split it' },
  ]);
  const atLimit = Array.from({ length: 200 }, (_, i) => `+line ${i}`).join('\n');
  assert.deepEqual(await errorsOf(doc([{ type: 'diff', diff: atLimit }])), []);
  const bad = await errorsOf(doc([{ type: 'diff', diff: DIFF, lang: 'js' }]));
  assert.equal(bad[0].path, 'sections[0].lang');
  assert.deepEqual((await errorsOf(doc([{ type: 'diff' }]))).map((e) => e.path), ['sections[0].diff']);
});

test('the diff body is data, not prose: banned words and long lines in it pass, a TODO placeholder still fails', async () => {
  const lines = ['+We leverage the cache and delve into it', `+${'word '.repeat(80)}`].join('\n');
  assert.deepEqual(await errorsOf(doc([{ type: 'diff', diff: lines }])), []);
  const todo = await errorsOf(doc([{ type: 'diff', diff: '+TODO: finish' }]));
  assert.equal(todo.length, 1);
  assert.match(todo[0].message, /TODO placeholder/);
  const warnings = (await validateSpec(doc([{ type: 'diff', diff: lines }]), { dir: FIXTURES })).warnings;
  assert.deepEqual(warnings.filter((w) => w.path.startsWith('sections[0]')), [], 'the budget does not count a diff as prose');
});

test('in a deck a diff follows the code limit of 12 lines', async () => {
  const twelve = Array.from({ length: 12 }, (_, i) => `+l${i}`).join('\n');
  const thirteen = `${twelve}\n+l12`;
  assert.deepEqual(await errorsOf(doc([{ type: 'diff', title: 'The change', diff: twelve }], { mode: 'slides' })), []);
  assert.deepEqual(await errorsOf(doc([{ type: 'diff', title: 'The change', diff: thirteen }], { mode: 'slides' })), [
    { path: 'sections[0].diff', message: 'slide has 13 diff lines; the limit is 12 — show the key lines or split the section' },
  ]);
});

test('a page with a diff builds, lists it in the contents under its title, and carries the diff styles', async () => {
  const { html } = await buildPage(doc([{ type: 'diff', title: 'The auth change', diff: DIFF }]), { dir: FIXTURES });
  assert.match(html, /<span class="dl dl-add">/);
  assert.match(html, /The auth change/);
  assert.match(html, /\.dl-add/);
  assert.match(html, /\.dl-del/);
});

// ---- golden ---------------------------------------------------------------------------------------------

import fs from 'node:fs';

test('golden: the markup of a diff section is unchanged (UPDATE_GOLDEN=1 after reading the diff)', () => {
  const golden = fileURLToPath(new URL('./golden/diff.section.html', import.meta.url));
  const actual = `${render({ diff: DIFF, file: 'src/a.js', caption: 'The **second** change' })}\n`;
  if (process.env.UPDATE_GOLDEN === '1') fs.writeFileSync(golden, actual);
  assert.ok(fs.existsSync(golden), 'no golden file; create it with UPDATE_GOLDEN=1 after reviewing the output');
  assert.equal(actual, fs.readFileSync(golden, 'utf8'));
});
