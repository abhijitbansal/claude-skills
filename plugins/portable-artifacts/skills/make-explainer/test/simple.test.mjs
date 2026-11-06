import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSpec, validateSpec } from '../scripts/lib/spec.mjs';
import { SIMPLE_SECTIONS, lintSimple, withSimple, hasSimple } from '../scripts/lib/simple.mjs';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const EXAMPLES = fileURLToPath(new URL('../references/examples/', import.meta.url));
const doc = (sections, extra = {}) => ({ title: 'T', sections, ...extra });
const validate = (spec, dir = FIXTURES) => validateSpec(spec, { dir });
const errorsOf = async (spec) => (await validate(spec)).errors;

// n plain words ending in a full stop: one sentence of exactly n words.
const sentence = (n) => `${Array(n).fill('word').join(' ')}.`;
const AT = 'sections[0]';
const textSection = (simpleText) => ({ type: 'text', text: 'Normal.', simple: { text: simpleText } });
const stepsSection = (simple) => ({ type: 'steps', items: [{ title: 'Run the build', text: 'Normal.' }], simple });
const lintText = (simpleText) => lintSimple(textSection(simpleText), AT);

const deepFreeze = (v) => {
  if (v !== null && typeof v === 'object') Object.values(v).forEach(deepFreeze);
  return Object.freeze(v);
};

// One valid section of every eligible type, each with a `simple` that stays inside the lint rules.
const ELIGIBLE = [
  { type: 'tldr', text: 'The cache is on.', points: ['It is faster.'], simple: { text: 'The cache is on.', points: ['It is quick.'] } },
  { type: 'text', text: 'The cache is on.', simple: { text: 'The cache is on.' } },
  { type: 'cards', items: [{ title: 'Fast', text: 'It is quick.' }], simple: { items: [{ title: 'Quick', text: 'It is fast.' }] } },
  {
    type: 'risks',
    items: [{ risk: 'Stale data.', severity: 'low', mitigation: 'Expire it.' }],
    simple: { items: [{ risk: 'Old data.', mitigation: 'Delete it.' }] },
  },
  stepsSection({ items: [{ title: 'Run the build', text: 'It takes a minute.' }] }),
  { type: 'timeline', items: [{ date: 'Mon', title: 'Start' }], simple: { items: [{ title: 'Begin' }] } },
  {
    type: 'compare',
    columns: [{ title: 'A', points: ['Fast.'] }, { title: 'B', points: ['Slow.'] }],
    verdict: 'A wins.',
    simple: { columns: [{ title: 'Plan A', points: ['It is fast.'] }], verdict: 'Plan A is best.' },
  },
  { type: 'callout', tone: 'info', title: 'Note', text: 'Careful.', simple: { title: 'Note', text: 'Be careful.' } },
  { type: 'details', summary: 'Why', text: 'Because.', simple: { summary: 'Why it works', text: 'It is simple.' } },
  {
    type: 'table',
    columns: ['Name', 'Time'],
    rows: [['a', 1]],
    simple: { caption: 'Times', columns: ['Name', 'Time taken'], rows: [['a', 1]] },
  },
];

// ---- schema -----------------------------------------------------------

test('SIMPLE_SECTIONS lists the ten eligible types', () => {
  assert.deepEqual([...SIMPLE_SECTIONS], ['tldr', 'text', 'cards', 'risks', 'steps', 'timeline', 'compare', 'callout', 'details', 'table']);
  assert.deepEqual(ELIGIBLE.map((s) => s.type), [...SIMPLE_SECTIONS]);
});

test('simple on an eligible section is valid', async () => {
  for (const section of ELIGIBLE) {
    const r = await validate(doc([section]));
    assert.deepEqual(r, { ok: true, errors: [], warnings: [] }, section.type);
  }
});

test('simple on a decision is an error listing the eligible types', async () => {
  const spec = structuredClone(loadSpec(path.join(FIXTURES, 'all-types.explainer.json')).spec);
  const at = spec.sections.findIndex((s) => s.type === 'decision');
  spec.sections[at].simple = { question: 'Which one?' };
  const errors = await errorsOf(spec);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].path, `sections[${at}].simple`);
  assert.match(errors[0].message, /decision/);
  for (const type of SIMPLE_SECTIONS) assert.ok(errors[0].message.includes(`"${type}"`), `lists ${type}`);
});

test('an unknown field inside simple is an error', async () => {
  assert.deepEqual(await errorsOf(doc([{ type: 'text', text: 'Body.', simple: { txt: 'Short.' } }])), [
    { path: 'sections[0].simple.txt', message: 'unknown property; did you mean "text"?' },
  ]);
});

test('simple takes prose fields only: a tone inside a card is an error', async () => {
  const section = { type: 'cards', items: [{ title: 'A', text: 'B.' }], simple: { items: [{ tone: 'good' }] } };
  const errors = await errorsOf(doc([section]));
  assert.equal(errors.length, 1);
  assert.equal(errors[0].path, 'sections[0].simple.items[0].tone');
});

test('a simple list longer than the normal list is an error', async () => {
  const section = { type: 'steps', items: [{ title: 'Run it' }], simple: { items: [{ title: 'Run it' }, { title: 'Stop it' }] } };
  const errors = await errorsOf(doc([section]));
  assert.equal(errors.length, 1);
  assert.equal(errors[0].path, 'sections[0].simple.items');
  assert.match(errors[0].message, /2 entries.*1/);
});

test('a banned phrase in simple text is an error, and a table cell in simple is exempt like a normal one', async () => {
  const errors = await errorsOf(doc([textSection('We leverage the cache.')]));
  assert.deepEqual(errors, [{ path: 'sections[0].simple.text', message: 'banned phrase "leverage"; replace it with "use"' }]);
  const table = { type: 'table', columns: ['A'], rows: [['x']], simple: { rows: [['leverage']] } };
  assert.deepEqual(await errorsOf(doc([table])), []);
});

// ---- withSimple, hasSimple -----------------------------------------------

test('withSimple merges by field, and a list by position; a field left out keeps normal text', () => {
  const section = {
    type: 'cards',
    id: 'why',
    title: 'Why',
    items: [
      { title: 'One', text: 'First.', tone: 'good' },
      { title: 'Two', text: 'Second.', tone: 'warn' },
      { title: 'Three', text: 'Third.' },
    ],
    simple: { title: 'Why it matters', items: [{ title: 'Uno' }, { text: 'Second, simply.' }] },
  };
  assert.deepEqual(withSimple(section), {
    type: 'cards',
    id: 'why',
    title: 'Why it matters',
    items: [
      { title: 'Uno', text: 'First.', tone: 'good' },
      { title: 'Two', text: 'Second, simply.', tone: 'warn' },
      { title: 'Three', text: 'Third.' },
    ],
  });
});

test('withSimple reaches lists inside lists and fills a field the normal section lacks', () => {
  const compare = {
    type: 'compare',
    columns: [{ title: 'A', points: ['a1', 'a2'] }, { title: 'B', points: ['b1'] }],
    simple: { columns: [{ points: ['a1 simple'] }, { title: 'Option B' }] },
  };
  assert.deepEqual(withSimple(compare).columns, [{ title: 'A', points: ['a1 simple', 'a2'] }, { title: 'Option B', points: ['b1'] }]);
  const step = { type: 'steps', items: [{ title: 'Run it' }], simple: { items: [{ text: 'It takes a minute.' }] } };
  assert.deepEqual(withSimple(step).items, [{ title: 'Run it', text: 'It takes a minute.' }]);
  const table = { type: 'table', columns: ['A', 'B'], rows: [['x', 1], ['y', 2]], simple: { rows: [['x!', 1]] } };
  assert.deepEqual(withSimple(table).rows, [['x!', 1], ['y', 2]]);
});

test('a null in simple is a field left out: it keeps the normal text', () => {
  const section = { type: 'cards', title: 'Why', items: [{ title: 'One', text: 'First.' }, { title: 'Two', text: 'Second.' }], simple: { title: null, items: [null, { text: null, title: 'Dos' }] } };
  assert.deepEqual(withSimple(section), { type: 'cards', title: 'Why', items: [{ title: 'One', text: 'First.' }, { title: 'Dos', text: 'Second.' }] });
  assert.deepEqual(withSimple({ type: 'text', text: 'Body.', simple: null }), { type: 'text', text: 'Body.' });
});

test('withSimple on a section without simple is an equal copy', () => {
  const section = { type: 'text', text: 'Body.' };
  const out = withSimple(section);
  assert.deepEqual(out, section);
  assert.notEqual(out, section);
});

test('the input is not changed', () => {
  const section = deepFreeze({
    type: 'steps',
    items: [{ title: 'Run it', text: 'Normal.' }],
    simple: { items: [{ text: 'Simple.' }] },
  });
  const before = structuredClone(section);
  const out = withSimple(section);
  assert.deepEqual(section, before);
  out.items[0].title = 'Changed';
  assert.equal(section.items[0].title, 'Run it');
});

test('hasSimple is true when a section carries simple text, false for none or an empty object', () => {
  assert.equal(hasSimple(doc([textSection('Short.')])), true);
  assert.equal(hasSimple(doc([{ type: 'text', text: 'Body.' }])), false);
  assert.equal(hasSimple(doc([{ type: 'text', text: 'Body.', simple: {} }])), false);
});

// ---- lint -------------------------------------------------------------

test('lintSimple gives nothing for a section with no simple, or clean simple text', () => {
  assert.deepEqual(lintSimple({ type: 'text', text: 'Body.' }, AT), []);
  assert.deepEqual(lintText('Run the build. It takes a minute.'), []);
});

test('a 26-word sentence warns in text, a 21-word sentence warns in steps, and 20 and 25 do not', () => {
  const warned = lintText(sentence(26));
  assert.equal(warned.length, 1);
  assert.equal(warned[0].path, 'sections[0].simple.text');
  assert.match(warned[0].message, /26 words.*25/);
  assert.deepEqual(lintText(sentence(25)), []);

  const steps = (n) => lintSimple(stepsSection({ items: [{ text: sentence(n) }] }), AT);
  const stepWarned = steps(21);
  assert.equal(stepWarned.length, 1);
  assert.equal(stepWarned[0].path, 'sections[0].simple.items[0].text');
  assert.match(stepWarned[0].message, /21 words.*20/);
  assert.deepEqual(steps(20), []);
  assert.deepEqual(lintText(sentence(21)), [], 'the 21-word sentence is fine outside steps');
});

test('7 sentences in a paragraph warn; 6 do not; a blank line starts a new paragraph', () => {
  const run = (n) => Array(n).fill('It runs.').join(' ');
  const warned = lintText(run(7));
  assert.equal(warned.length, 1);
  assert.match(warned[0].message, /7 sentences.*6/);
  assert.deepEqual(lintText(run(6)), []);
  assert.deepEqual(lintText(`${run(6)}\n\n${run(6)}`), []);
});

test('a semicolon warns', () => {
  const warned = lintText('It runs; it stops.');
  assert.equal(warned.length, 1);
  assert.match(warned[0].message, /semicolon/);
});

test('"in order to" warns and names "to"', () => {
  const warned = lintText('Wait in order to see the result.');
  assert.equal(warned.length, 1);
  assert.match(warned[0].message, /"in order to".*"to"/);
});

test('the word-swap list covers "utilize" and "prior to" too', () => {
  assert.match(lintText('Utilize the cache.')[0].message, /"use"/);
  assert.match(lintText('Wait prior to the restart.')[0].message, /"before"/);
});

test('"was deployed" warns as likely passive, once per sentence', () => {
  const warned = lintText('The build was deployed on Monday.');
  assert.equal(warned.length, 1);
  assert.match(warned[0].message, /passive.*"was deployed"/);
  assert.equal(lintText('The bug was found and was fixed.').length, 1);
  assert.deepEqual(lintText('The team deployed the build on Monday.'), []);
  assert.deepEqual(lintText('The sky is red.'), []);
});

test('"It is used." warns as likely passive; "The sky was blue." does not', () => {
  const warned = lintText('It is used.');
  assert.equal(warned.length, 1);
  assert.match(warned[0].message, /passive.*"is used"/);
  assert.deepEqual(lintText('The sky was blue.'), []);
  assert.deepEqual(lintText('The team used the cache.'), []);
});

test('words inside backticks are ignored by every rule', () => {
  assert.deepEqual(lintText('Run `in order to; was deployed utilize prior to` now.'), []);
  const longCode = `\`${Array(40).fill('word').join(' ')}\``;
  assert.deepEqual(lintText(`Run ${longCode} now.`), []);
  assert.deepEqual(lintSimple(stepsSection({ items: [{ title: '`The flag` is on' }] }), AT), []);
});

test('a step opening with "The" warns; one opening with "Run" does not', () => {
  const warned = lintSimple(stepsSection({ items: [{ title: 'The server restarts' }] }), AT);
  assert.equal(warned.length, 1);
  assert.equal(warned[0].path, 'sections[0].simple.items[0].title');
  assert.match(warned[0].message, /"The"/);
  assert.deepEqual(lintSimple(stepsSection({ items: [{ title: 'Run the build' }] }), AT), []);
  const card = { type: 'cards', items: [{ title: 'Cache', text: 'Fast.' }], simple: { items: [{ title: 'The cache' }] } };
  assert.deepEqual(lintSimple(card, AT), [], 'only steps are checked');
});

// ---- page-level warnings ----------------------------------------------

test('a page with some simple text warns on an eligible section with none; a page with none gives no such warning', async () => {
  const some = await validate(doc([textSection('Short.'), { type: 'cards', items: [{ title: 'A', text: 'B.' }] }, { type: 'code', code: 'x' }]));
  assert.equal(some.ok, true);
  assert.equal(some.warnings.length, 1);
  assert.equal(some.warnings[0].path, 'sections[1]');
  assert.match(some.warnings[0].message, /simple/);

  const none = await validate(doc([{ type: 'text', text: 'Body.' }, { type: 'cards', items: [{ title: 'A', text: 'B.' }] }]));
  assert.deepEqual(none.warnings, []);
});

test('an empty simple object counts as no simple text', async () => {
  const r = await validate(doc([textSection('Short.'), { type: 'text', text: 'Body.', simple: {} }]));
  assert.equal(r.warnings.length, 1);
  assert.equal(r.warnings[0].path, 'sections[1]');
});

test('simple text does not count toward page word budgets', async () => {
  // Six 24-word sentences: over the normal paragraph (60 words, 3 sentences) and text-section (120 words) caps, inside the simple rules.
  const long = Array(6).fill(sentence(24)).join(' ');
  assert.deepEqual(await validate(doc([textSection(long)])), { ok: true, errors: [], warnings: [] });
  const slides = await validate(doc([textSection(long)], { mode: 'slides' }));
  assert.deepEqual(slides, { ok: true, errors: [], warnings: [] });
});

test('a long simple title is exempt from the title word cap', async () => {
  const section = { type: 'callout', tone: 'info', title: 'Note', text: 'Careful.', simple: { title: 'Please read this note before you go on today', text: 'Be careful.' } };
  assert.deepEqual(await validate(doc([section])), { ok: true, errors: [], warnings: [] });
});

// ---- existing specs ---------------------------------------------------

test('an existing example spec validates with no new warnings; only the -simple examples carry simple text', async () => {
  const names = fs.readdirSync(EXAMPLES).filter((n) => n.endsWith('.explainer.json'));
  assert.ok(names.length >= 5);
  for (const name of names) {
    const { spec, dir } = loadSpec(path.join(EXAMPLES, name));
    const r = await validate(spec, dir);
    assert.equal(r.ok, true, name);
    assert.deepEqual(r.warnings.filter((w) => /simple/i.test(w.message)), [], name);
    assert.equal(hasSimple(spec), name.endsWith('-simple.explainer.json'), name);
  }
});
