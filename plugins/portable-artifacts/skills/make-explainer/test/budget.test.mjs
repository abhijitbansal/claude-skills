import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SOFT_CAPS, warnBudget, words, sentences } from '../scripts/lib/budget.mjs';

const w = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
const spec = (sections) => ({ title: 'T', sections });
const paths = (s) => warnBudget(s).map((x) => x.path);

test('counting helpers', () => {
  assert.equal(words('one two  three'), 3);
  assert.equal(sentences('One. Two! Three? e.g. not split'), 3);
});

test('caps are the agreed values', () => {
  assert.deepEqual(SOFT_CAPS, { titleWords: 8, labelWords: 4, paragraphWords: 60, paragraphSentences: 3, textSectionWords: 120, cardWords: 30, itemWords: 20, pageWords: 900, tldrPoints: 3 });
});

test('title: 8 words silent, 9 warns', () => {
  assert.deepEqual(paths(spec([{ type: 'text', id: 'a', title: w(8), text: 'x' }])), []);
  assert.deepEqual(paths(spec([{ type: 'text', id: 'a', title: w(9), text: 'x' }])), ['sections[0].title']);
});

test('label: 4 silent, 5 warns', () => {
  assert.deepEqual(paths(spec([{ type: 'text', title: 'T', label: w(4), text: 'x' }])), []);
  assert.deepEqual(paths(spec([{ type: 'text', title: 'T', label: w(5), text: 'x' }])), ['sections[0].label']);
});

test('paragraph: 60 words silent, 61 warns; 4 sentences warns', () => {
  assert.deepEqual(paths(spec([{ type: 'text', title: 'T', text: w(60) }])), []);
  assert.ok(paths(spec([{ type: 'text', title: 'T', text: w(61) }])).includes('sections[0].text'));
  assert.ok(paths(spec([{ type: 'text', title: 'T', text: 'A. B. C. D.' }])).includes('sections[0].text'));
});

test('list lines are counted one by one', () => {
  const list = Array(10).fill('- two words').join('\n');
  assert.deepEqual(paths(spec([{ type: 'text', title: 'T', text: list }])), []);
  const longLine = `- short\n- ${w(61)}`;
  assert.deepEqual(paths(spec([{ type: 'text', title: 'T', text: longLine }])), ['sections[0].text']);
});

test('text section over 120 words warns even when every paragraph is short', () => {
  const text = [w(50), w(50), w(30)].join('\n\n');
  assert.ok(warnBudget(spec([{ type: 'text', title: 'T', text }])).some((x) => /120 words/.test(x.message)));
});

test('card text over 30, list item over 20, tldr over 3 points warn', () => {
  assert.ok(paths(spec([{ type: 'cards', title: 'T', items: [{ title: 'c', text: w(31) }] }])).includes('sections[0].items[0].text'));
  assert.deepEqual(paths(spec([{ type: 'cards', title: 'T', items: [{ title: 'c', text: w(30) }] }])), []);
  assert.ok(paths(spec([{ type: 'tldr', text: 'x', points: [w(21)] }])).includes('sections[0].points[0]'));
  assert.ok(paths(spec([{ type: 'tldr', text: 'x', points: ['a', 'b', 'c', 'd'] }])).includes('sections[0].points'));
  assert.deepEqual(paths(spec([{ type: 'tldr', text: 'x', points: ['a', 'b', 'c'] }])), []);
});

test('compare points count as list items', () => {
  const columns = [{ title: 'A', points: [w(21)] }];
  assert.ok(paths(spec([{ type: 'compare', title: 'T', columns }])).includes('sections[0].columns[0].points[0]'));
});

test('page over 900 words of prose warns once at the root', () => {
  const sections = Array.from({ length: 10 }, () => ({ type: 'text', title: 'T', text: `${w(55)}.\n\n${w(40)}.` }));
  assert.deepEqual(warnBudget(spec(sections)).filter((x) => x.path === '').length, 1);
  assert.deepEqual(warnBudget(spec(sections.slice(0, 9))).filter((x) => x.path === ''), []);
});

test('code, tables and file lists are not prose', () => {
  assert.deepEqual(paths(spec([{ type: 'code', title: 'T', code: w(500) }])), []);
  assert.deepEqual(paths(spec([{ type: 'table', title: 'T', columns: ['a'], rows: [[w(80)]] }])), []);
  assert.deepEqual(paths(spec([{ type: 'files', title: 'T', items: [{ path: 'a', change: 'added', note: w(80) }] }])), []);
});

test('every warning suggests a conversion', () => {
  const all = warnBudget(spec([{ type: 'text', title: w(12), text: w(200) }]));
  assert.ok(all.length >= 3);
  for (const x of all) assert.match(x.message, /→|cards|steps|split|state the finding/);
});

test('the four shipped examples are inside the caps', () => {
  for (const n of ['recap', 'checklist', 'concept', 'slides']) {
    const s = JSON.parse(fs.readFileSync(new URL(`../references/examples/${n}.explainer.json`, import.meta.url)));
    assert.deepEqual(warnBudget(s), [], n);
  }
});
