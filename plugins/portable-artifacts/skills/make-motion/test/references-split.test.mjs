// The agent-facing reference files stay small enough to read and search (PA-35): references/schema.md is an index over
// references/schema/*.md, no line runs past about 1 KB, and the three sections SKILL.md points to live in their own files. No browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { schemaFiles, readSchema } from './helpers/schema-docs.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_LINE = 1000; // a line of prose or a list item
const MAX_TABLE_ROW = 1600; // a table row cannot wrap: it is a single line by definition of the format

const longLines = (file) => readFileSync(file, 'utf8').split('\n').flatMap((line, i) => {
  const limit = line.startsWith('|') ? MAX_TABLE_ROW : MAX_LINE;
  return line.length > limit ? [`${path.relative(root, file)}:${i + 1} is ${line.length} characters`] : [];
});

test('no line of any schema file is over about 1 KB (a table row, which cannot wrap, over 1.6 KB)', () => {
  assert.deepEqual(schemaFiles(root).flatMap(longLines), []);
});

test('guardrail proof: the check names a prose line over 1000 and a table row over 1600, and passes a table row between', () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'rs-')), 'bad.md');
  const prose = 'word '.repeat(MAX_LINE / 5 + 1).trimEnd(); // 1004 characters
  const row = (n) => `| ${'x'.repeat(n)} |`;
  writeFileSync(file, `${prose}\n${row(1200)}\n${row(MAX_TABLE_ROW)}\nshort\n`);
  const found = longLines(file);
  assert.equal(found.length, 2, found.join('; '));
  assert.match(found[0], /:1 is 1004 characters/, 'the long prose line');
  assert.match(found[1], /:3 is \d+ characters/, 'the table row over its limit; the 1200-character row is allowed');
});

test('schema.md is an index: it links every topic file and each one exists', () => {
  const index = readFileSync(path.join(root, 'references/schema.md'), 'utf8');
  const topics = readdirSync(path.join(root, 'references/schema')).filter((f) => f.endsWith('.md'));
  assert.ok(topics.length >= 6, topics.join(', '));
  for (const topic of topics) assert.ok(index.includes(`schema/${topic}`), `the index links ${topic}`);
  for (const link of index.matchAll(/`schema\/([a-z-]+\.md)`/g)) assert.ok(topics.includes(link[1]), `${link[1]} exists`);
  assert.ok(index.length < 2000, 'the index stays an index');
});

test('no content was lost in the split: every section of the old reference is in a topic file', () => {
  const text = readSchema(root);
  for (const heading of ['## Root', '### Variables', '### Beats', '### Viral mode', '## Scene', '### Transitions', '### Camera', '## Audio', '## Texture', '## Cues', '## Elements', '## Blocks', '## Keyframes', '## Captions', '## Cross-field errors (examples)', '## CLI']) {
    assert.ok(text.includes(heading), heading);
  }
  for (const phrase of ['| `kpi-counter` |', '| `flow-map` |', '| `text-behind-subject` |', 'at most 2 × workers PNG files', 'scene ids and element ids share one namespace']) assert.ok(text.includes(phrase), phrase);
});

test('storyboard.md, voiceover.md and block-tables.md hold what SKILL.md says about them', () => {
  const story = readFileSync(path.join(root, 'references/storyboard.md'), 'utf8');
  assert.match(story, /^0\. Storyboard \(only for a clip over 20 s/m);
  assert.match(story, /storyboard\.mjs brief\.json --out plan\.json/);
  const voice = readFileSync(path.join(root, 'references/voiceover.md'), 'utf8');
  assert.match(voice, /^## Voiceover and audio notes$/m);
  assert.match(voice, /`voice\.mjs` disposes the ORT session/);
  const blocks = readFileSync(path.join(root, 'references/block-tables.md'), 'utf8');
  assert.match(blocks, /^## Blocks$/m);
  assert.match(blocks, /^\| `title-card` \| an opening or section title \|/m);
  assert.match(blocks, /^\| block \| use it for \| params/m);
});
