import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SOFT_CAPS, warnBudget, emojiDensityWarnings, MIN_EMOJI_FOR_DENSITY, words, sentences } from '../scripts/lib/budget.mjs';

const w = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
const spec = (sections) => ({ title: 'T', sections });
const paths = (s) => warnBudget(s).map((x) => x.path);

test('counting helpers', () => {
  assert.equal(words('one two  three'), 3);
  assert.equal(sentences('One. Two! Three? e.g. not split'), 3);
});

test('caps are the agreed values', () => {
  assert.deepEqual(SOFT_CAPS, { titleWords: 8, labelWords: 4, paragraphWords: 60, paragraphSentences: 3, textSectionWords: 120, cardWords: 30, itemWords: 20, pageWords: 900, planPageWords: 1800, tldrPoints: 3 });
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
  assert.ok(warnBudget(spec([{ type: 'text', title: 'T', text }])).some((x) => /keep it to 120/.test(x.message)));
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

test('a plan page under 1,800 words gets no page-prose warning; a concept page over 900 still does', () => {
  const sections = Array.from({ length: 15 }, () => ({ type: 'text', title: 'T', text: `${w(55)}.\n\n${w(40)}.` }));
  assert.equal(sections.length * 95 > 900, true);
  const rootWarnings = (s) => warnBudget(s).filter((x) => x.path === '');
  assert.deepEqual(rootWarnings({ title: 'T', preset: 'plan', sections }), []);
  assert.equal(rootWarnings({ title: 'T', preset: 'concept', sections }).length, 1);
  assert.equal(rootWarnings({ title: 'T', sections }).length, 1);
  const tooLong = Array.from({ length: 20 }, () => ({ type: 'text', title: 'T', text: `${w(55)}.\n\n${w(40)}.` }));
  const over = rootWarnings({ title: 'T', preset: 'plan', sections: tooLong });
  assert.equal(over.length, 1);
  assert.match(over[0].message, /aim for 1800/);
});

test('code, tables and file lists are not prose', () => {
  assert.deepEqual(paths(spec([{ type: 'code', title: 'T', code: w(500) }])), []);
  assert.deepEqual(paths(spec([{ type: 'table', title: 'T', columns: ['a'], rows: [[w(80)]] }])), []);
  assert.deepEqual(paths(spec([{ type: 'files', title: 'T', items: [{ path: 'a', change: 'added', note: w(80) }] }])), []);
});

test('every warning suggests a conversion', () => {
  const all = warnBudget(spec([{ type: 'text', title: w(12), label: w(6), text: w(200) }]));
  assert.ok(all.some((x) => x.path === 'sections[0].label'));
  assert.ok(all.length >= 4);
  for (const x of all) assert.match(x.message, /→|cards|steps|split|state the finding|name the topic/);
});

test('the five shipped examples are inside the caps', () => {
  for (const n of ['recap', 'checklist', 'concept', 'slides', 'plan']) {
    const s = JSON.parse(fs.readFileSync(new URL(`../references/examples/${n}.explainer.json`, import.meta.url)));
    assert.deepEqual(warnBudget(s), [], n);
  }
});

const at = (sections) => warnBudget(spec(sections));
const msgs = (sections) => at(sections).map((x) => x.message);

test('I-1: risk and mitigation are list items and count toward the page', () => {
  const risks = [{ type: 'risks', title: 'T', items: [{ risk: w(130), severity: 'low', mitigation: 'm' }] }];
  assert.deepEqual(paths(spec(risks)), ['sections[0].items[0].risk']);
  const page = [{ type: 'risks', title: 'T', items: [{ risk: w(20), severity: 'low', mitigation: w(20) }] }];
  const many = Array.from({ length: 23 }, () => page[0]);
  assert.equal(at(many).filter((x) => x.path === '').length, 1);
});

test('I-4: verdict and summary are prose; nested titles are capped', () => {
  assert.ok(paths(spec([{ type: 'compare', title: 'T', columns: [{ title: 'A', points: ['a'] }], verdict: w(61) }])).includes('sections[0].verdict'));
  assert.ok(paths(spec([{ type: 'details', summary: w(61), text: 'x' }])).includes('sections[0].summary'));
  assert.ok(paths(spec([{ type: 'cards', title: 'T', items: [{ title: w(9), text: 'x' }] }])).includes('sections[0].items[0].title'));
  assert.ok(paths(spec([{ type: 'compare', title: 'T', columns: [{ title: w(9), points: ['a'] }] }])).includes('sections[0].columns[0].title'));
});

test('I-4: backstop prose warns over 120 words but never counts toward the page total', () => {
  const cl = (t) => ({ type: 'checklist', title: 'T', key: 'k', intro: t, groups: [{ title: 'g', items: [{ text: 'x' }] }] });
  assert.deepEqual(paths(spec([cl(w(120))])), []);
  assert.deepEqual(paths(spec([cl(w(121))])), ['sections[0].intro']);
  assert.ok(paths(spec([{ type: 'image', title: 'T', src: 'a.png', alt: 'a', caption: w(121) }])).includes('sections[0].caption'));
  assert.ok(paths(spec([{ type: 'timeline', title: 'T', items: [{ date: 'd', title: 't', text: w(121) }] }])).includes('sections[0].items[0].text'));
  assert.ok(paths(spec([{ type: 'files', title: 'T', items: [{ path: 'a', change: 'added', note: w(121) }] }])).includes('sections[0].items[0].note'));
  const many = Array.from({ length: 10 }, () => cl(w(100)));
  assert.deepEqual(warnBudget(spec(many)), []);
});

test('I-4: table cells, headers and hrefs never count', () => {
  assert.deepEqual(paths(spec([{ type: 'table', title: 'T', columns: [w(200)], rows: [[w(200)]] }])), []);
});

test('M-1: details and callout get the 120-word section cap', () => {
  const half = `${w(55)}.\n\n${w(55)}.\n\n${w(55)}.`;
  assert.ok(warnBudget(spec([{ type: 'details', summary: 's', text: half }])).some((x) => /details section is \d+ words/.test(x.message)));
  assert.ok(warnBudget(spec([{ type: 'callout', tone: 'info', title: 'T', text: half }])).some((x) => /callout section/.test(x.message)));
});

test('M-2: a bullet is measured against the list-item cap', () => {
  assert.deepEqual(msgs([{ type: 'text', title: 'T', text: `- ${w(25)}\n- short` }]), [`list item 1 of 2 is 25 words; keep it to 20 → cut it, or move the detail into a text section`]);
});

test('M-3: sentence counting', () => {
  assert.equal(sentences('Mr. Smith ran it. It passed.'), 2);
  assert.equal(sentences('Dr. No. Mrs. Yes. Jr. Done.'), 3);
  assert.equal(sentences('U.S. teams ship it. Fine.'), 2);
  assert.equal(sentences('Wait... then it broke. Fixed.'), 2);
  assert.equal(sentences('He said "stop." Then it stopped.'), 2);
  assert.equal(sentences('(See above.) Next one.'), 2);
  assert.equal(sentences('Apples, pears, etc. Then more.'), 2);
  assert.equal(sentences('Apples, pears, etc. and more. Done.'), 2);
});

test('M-4: caps are inclusive in the wording; exactly 120 words is silent', () => {
  const para = (n) => `${w(n)}.`;
  assert.deepEqual(paths(spec([{ type: 'text', title: 'T', text: [para(40), para(40), para(40)].join('\n\n') }])), []);
  assert.ok(msgs([{ type: 'text', title: 'T', text: w(61) }])[0].includes('keep it to 60'));
});

test('M-5: several paragraphs in one field are named', () => {
  assert.match(msgs([{ type: 'text', title: 'T', text: `short.\n\n${w(61)}` }])[0], /^paragraph 2 of 2 is 61 words/);
});

test('NI-1: diagram, chart and motion sections still cap their own title', () => {
  const secs = [
    { type: 'diagram', title: w(12), diagram: 'd.json' },
    { type: 'chart', title: w(12), chart: 'c.json' },
    { type: 'motion', title: w(12), video: 'v.mp4' },
  ];
  assert.deepEqual(paths(spec(secs)), ['sections[0].title', 'sections[1].title', 'sections[2].title']);
  assert.deepEqual(paths(spec([{ type: 'diagram', title: 'T', diagram: { title: w(12), nodes: [] } }])), []);
});

test('NI-3: single-letter initials are not sentence ends', () => {
  assert.equal(sentences('See J. Smith. Then go.'), 2);
  assert.equal(sentences('A. B. C. D.'), 4);
});

test('NI-4: paragraphs and list items are numbered apart', () => {
  const text = `- ${w(25)}\n- ${w(25)}\n\n${w(61)}`;
  assert.deepEqual(msgs([{ type: 'text', title: 'T', text }]).map((m) => m.split(' is ')[0]), ['list item 1 of 2', 'list item 2 of 2', 'paragraph']);
});

// ---- emoji density ---------------------------------------------------------------------------

const EM = '\u{1F680}';
const emojiWarn = (s) => emojiDensityWarnings(spec(s));

test('emoji density: 5 emoji in 100 chars warns once, naming emoji', () => {
  const text = `${EM.repeat(5)}${'x'.repeat(95)}`;
  const r = emojiWarn([{ type: 'text', title: 'T', text }]);
  assert.equal(r.length, 1);
  assert.equal(r[0].path, 'sections[0].text');
  assert.match(r[0].message, /emoji/);
});

test('emoji density needs the ratio and at least MIN_EMOJI_FOR_DENSITY emoji', () => {
  const at = (n, len) => emojiWarn([{ type: 'text', title: 'T', text: `${EM.repeat(n)}${'x'.repeat(len - n)}` }]).length;
  assert.equal(MIN_EMOJI_FOR_DENSITY, 3);
  assert.equal(at(1, 6), 0, '1 emoji in 6 chars');
  assert.equal(at(2, 10), 0, '2 emoji in 10 chars');
  assert.equal(at(3, 30), 1, '3 emoji in 30 chars');
  assert.equal(at(3, 200), 0, '3 emoji in 200 chars: ratio too low');
  assert.equal(at(1, 200), 0);
});

test('multi-codepoint emoji count once each', () => {
  const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}';
  for (const g of [family, '\u{1F1FA}\u{1F1F8}', '\u{1F44D}\u{1F3FD}', '1\uFE0F\u20E3']) {
    // three glyphs in 20 chars warns and reports exactly 3, not 6 or 9
    const r = emojiWarn([{ type: 'text', title: 'T', text: `${g}${g}${g}${'x'.repeat(14)}` }]);
    assert.equal(r.length, 1, g);
    assert.match(r[0].message, /^3 emoji/, g);
    // two glyphs never reach the floor, even though they hold 4+ codepoints
    assert.deepEqual(emojiWarn([{ type: 'text', title: 'T', text: `${g}${g}` }]), [], g);
  }
  // two family emoji in a title stay under the title limit
  assert.deepEqual(emojiWarn([{ type: 'text', title: `${family}${family}`, text: 'x'.repeat(400) }]), []);
});

test('text-presentation symbols count 0 toward density', () => {
  assert.deepEqual(emojiWarn([{ type: 'text', title: 'T', text: '→ ✓ ✔ ↔ ▶ ★ ❤ ⚠ ℹ → ✓ ✔ ↔' }]), []);
});

test('a title with emoji does not also count toward prose density', () => {
  assert.deepEqual(emojiWarn([{ type: 'text', title: `Hi ${EM.repeat(3)}`, text: 'ok' }]), []);
});

test('emoji in code spans and link urls are not counted', () => {
  assert.deepEqual(emojiWarn([{ type: 'text', title: 'T', text: `\`${EM.repeat(5)}\` [a](https://x.test/${EM.repeat(5)}) plain words here` }]), []);
});

test('emoji title: 3 silent, 4 warns at the title path', () => {
  assert.deepEqual(emojiWarn([{ type: 'text', title: `Hi ${EM.repeat(3)}`, text: 'x'.repeat(400) }]), []);
  const r = emojiWarn([{ type: 'text', title: `Hi ${EM.repeat(4)}`, text: 'x'.repeat(400) }]);
  assert.equal(r.length, 1);
  assert.equal(r[0].path, 'sections[0].title');
  assert.match(r[0].message, /emoji/);
});

test('emoji density is a warning through warnBudget, never an error', () => {
  const s = spec([{ type: 'text', title: 'T', text: `${EM.repeat(5)}${'x'.repeat(95)}` }]);
  assert.ok(warnBudget(s).some((x) => /emoji/.test(x.message)));
});
