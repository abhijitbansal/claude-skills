// The docs follow the code: every schema property is named in schema.md, the
// limits in its table are the schema's, SKILL.md teaches stories and not steps,
// and the key tables say F is full screen and 0 fits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SCHEMA, LIMITS } from '../scripts/lib/schema.mjs';
import { FAMILIES } from '../scripts/lib/kinds.mjs';
import { STYLE_WORD } from '../scripts/lib/legend.mjs';

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const schemaDoc = read('references/schema.md');
const skill = read('SKILL.md');
const readme = read('README.md');
const kinds = read('references/kinds.md');
const featurePage = fs.readFileSync(new URL('../../../../../docs/features/portable-artifacts.html', import.meta.url), 'utf8');

test('schema.md names every root, node, participant and beat property', () => {
  const beat = SCHEMA.properties.stories.items.properties.beats.items.properties;
  const names = [...Object.keys(SCHEMA.properties), ...Object.keys(SCHEMA.properties.nodes.items.properties), ...Object.keys(SCHEMA.properties.participants.items.properties), ...Object.keys(beat)];
  for (const name of new Set(names)) assert.ok(schemaDoc.includes(`\`${name}\``), `schema.md names \`${name}\``);
});

test('schema.md carries the story limits from the schema and marks steps as the older form', () => {
  assert.ok(schemaDoc.includes(`| stories / beats in all | ${LIMITS.stories} / ${LIMITS.beats} |`), 'stories and beats row');
  assert.ok(schemaDoc.includes(`| story title / beat title / caption | ${LIMITS.storyTitle} / ${LIMITS.beatTitle} / ${LIMITS.caption} characters |`), 'story lengths row');
  assert.ok(schemaDoc.includes(`| detail | ${LIMITS.detail} characters |`), 'detail row');
  assert.match(schemaDoc, /^## steps\[\] \(the older form\)$/m);
  assert.match(schemaDoc, /`F` .*full screen/);
  assert.match(schemaDoc, /`0`.*fit/);
});

test('SKILL.md teaches stories, emoji and detail and no longer teaches steps', () => {
  assert.match(skill, /^## Stories$/m);
  assert.ok(!/^## Presentation steps$/m.test(skill), 'the steps section is gone');
  for (const word of ['`emoji`', '`detail`', '`autoplay`', '"stories"', '"beats"', '"caption"', '"focus"']) assert.ok(skill.includes(word), word);
  assert.match(skill, /"beats": \[[\s\S]*"from"[\s\S]*"to"/, 'a beat example uses from and to');
  const fm = skill.match(/^---\n([\s\S]*?)\n---/)[1];
  assert.match(fm, /^description: .*stories/m, 'the description sells stories');
  assert.ok(!fm.includes('step-by-step'));
});

test('README says F is full screen and 0 fits; kinds.md describes every colour family', () => {
  assert.match(readme, /\| `F` \| full screen/);
  assert.match(readme, /\| `0`, double-click \| fit/);
  assert.ok(!/\| `F`, double-click \| fit/.test(readme), 'the old row is gone');
  assert.ok(!featurePage.includes('F</code> to fit'), 'the feature page no longer says F fits');
  for (const f of FAMILIES) assert.match(kinds, new RegExp(`^\\| \`${f}\` \\|`, 'm'), `kinds.md has a row for ${f}`);
});

test('SKILL.md and schema.md name the words the legend prints for each edge style', () => {
  assert.deepEqual(STYLE_WORD, { solid: 'call', dashed: 'secondary', async: 'event' });
  for (const [style, word] of Object.entries(STYLE_WORD)) {
    for (const [name, doc] of [['SKILL.md', skill], ['schema.md', schemaDoc]]) {
      assert.match(doc, new RegExp(`\`${style}\`[^\\n]{0,60}key "${word}"`), `${name} says the legend keys \`${style}\` as "${word}"`);
    }
  }
  assert.ok(!/legend[^\n]*optional/i.test(skill + schemaDoc), 'no doc calls dashed "optional"');
});
