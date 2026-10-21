// Plan mode, schema and semantic rules: the five plan section types (decision, approval, question, review,
// verdict), the `plan` preset, the optional root `key`, the non-prose fields and the slide budget.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { validateSpec } from '../scripts/lib/spec.mjs';
import { LIMITS, PRESETS } from '../scripts/lib/schema.mjs';
import { collectStrings } from '../scripts/lib/walk.mjs';
import { pointCount, slideBudget, slideTitle } from '../scripts/lib/slides.mjs';
import { PRESET_NAMES } from '../scripts/lib/presets.mjs';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const errorsOf = async (spec) => (await validateSpec(spec, { dir: FIXTURES })).errors;

const decision = (patch = {}) => ({
  type: 'decision',
  id: 'storage',
  question: 'Where do answers live?',
  options: [
    { label: 'Browser storage', pros: ['No server'], cons: ['One device only'] },
    { label: 'A save server', pros: ['Shared'], cons: ['Something to run'] },
  ],
  recommended: 'Browser storage',
  why: 'Nothing to deploy, and the export file carries the answers back.',
  ...patch,
});
const approval = (patch = {}) => ({ type: 'approval', id: 'ship-themes', item: 'Ship the two plan themes', why: 'They pass the contrast checks.', ...patch });
const question = (patch = {}) => ({ type: 'question', id: 'owner', text: 'Who owns the rollout?', ...patch });
const verdict = (patch = {}) => ({ type: 'verdict', ...patch });
const review = (patch = {}) => ({ type: 'review', items: [{ point: 'The storage choice', why: 'It decides the export.', target: 'storage' }], ...patch });
const plan = (sections, extra = {}) => ({ title: 'Plan mode for the explainer', preset: 'plan', key: 'plan-mode', sections, ...extra });

// ---- the minimal valid plan ---------------------------------------------------------------------

test('a minimal plan with one of each type validates with no errors', async () => {
  const r = await validateSpec(plan([review(), decision(), approval(), question({ default: 'The author owns it' }), verdict({ text: 'Approve the plan as a whole.' })]), { dir: FIXTURES });
  assert.deepEqual(r.errors, []);
  assert.equal(r.ok, true);
});

test('plan is a preset and the limits carry the plan counts', () => {
  assert.ok(PRESETS.includes('plan'));
  assert.deepEqual(LIMITS.planOptions, [2, 5]);
  assert.deepEqual(LIMITS.reviewItems, [1, 5]);
});

test('scaffold lists only the presets it can build (plan arrives with its builder)', () => {
  assert.deepEqual(PRESET_NAMES, ['recap', 'checklist', 'concept', 'slides']);
});

// ---- required fields ------------------------------------------------------------------------------

test('decision, approval and question require an id', async () => {
  const { id: _d, ...d } = decision();
  const { id: _a, ...a } = approval();
  const { id: _q, ...q } = question();
  assert.deepEqual(await errorsOf(plan([d, a, q])), [
    { path: 'sections[0].id', message: 'required' },
    { path: 'sections[1].id', message: 'required' },
    { path: 'sections[2].id', message: 'required' },
  ]);
});

test('decision requires question, options, recommended and why', async () => {
  assert.deepEqual(await errorsOf(plan([{ type: 'decision', id: 'd' }])), [
    { path: 'sections[0].question', message: 'required' },
    { path: 'sections[0].options', message: 'required' },
    { path: 'sections[0].recommended', message: 'required' },
    { path: 'sections[0].why', message: 'required' },
  ]);
});

test('an option needs a label; its fields are closed', async () => {
  const errors = await errorsOf(plan([decision({ options: [{ pros: ['a'] }, { label: 'B', con: ['x'] }] })]));
  assert.deepEqual(errors, [
    { path: 'sections[0].options[0].label', message: 'required' },
    { path: 'sections[0].options[1].con', message: 'unknown property; did you mean "cons"?' },
  ]);
});

test('approval requires item and why; question requires text; review requires items', async () => {
  assert.deepEqual(await errorsOf(plan([{ type: 'approval', id: 'a' }, { type: 'question', id: 'q' }, { type: 'review' }])), [
    { path: 'sections[0].item', message: 'required' },
    { path: 'sections[0].why', message: 'required' },
    { path: 'sections[1].text', message: 'required' },
    { path: 'sections[2].items', message: 'required' },
  ]);
});

test('a review item needs point and why', async () => {
  assert.deepEqual(await errorsOf(plan([decision(), review({ items: [{ target: 'storage' }] })])), [
    { path: 'sections[1].items[0].point', message: 'required' },
    { path: 'sections[1].items[0].why', message: 'required' },
  ]);
});

test('verdict has no required fields and a closed shape', async () => {
  assert.deepEqual(await errorsOf(plan([decision(), verdict()])), []);
  assert.deepEqual(await errorsOf(plan([decision(), verdict({ txt: 'x' })])), [
    { path: 'sections[1].txt', message: 'unknown property; did you mean "text"?' },
  ]);
});

// ---- counts ---------------------------------------------------------------------------------------

test('a decision has 2 to 5 options', async () => {
  const opt = (n) => ({ label: `Option ${n}` });
  assert.deepEqual(await errorsOf(plan([decision({ options: [opt(1)], recommended: 'Option 1' })])), [
    { path: 'sections[0].options', message: 'options has 1 entries; at least 2 required — add more' },
  ]);
  const six = [1, 2, 3, 4, 5, 6].map(opt);
  const errors = await errorsOf(plan([decision({ options: six, recommended: 'Option 1' })]));
  assert.equal(errors.length, 1);
  assert.equal(errors[0].path, 'sections[0].options');
  assert.match(errors[0].message, /^options has 6 entries; the limit is 5/);
});

test('a review has 1 to 5 items', async () => {
  const item = { point: 'Look here', why: 'It matters.' };
  assert.deepEqual(await errorsOf(plan([decision(), review({ items: [] })])), [
    { path: 'sections[1].items', message: 'items has 0 entries; at least 1 required — add more' },
  ]);
  const errors = await errorsOf(plan([decision(), review({ items: Array(6).fill(item) })]));
  assert.equal(errors.length, 1);
  assert.equal(errors[0].path, 'sections[1].items');
  assert.match(errors[0].message, /^items has 6 entries; the limit is 5/);
});

// ---- cross-field rules ----------------------------------------------------------------------------

test('recommended must equal an option label', async () => {
  const errors = await errorsOf(plan([decision({ recommended: 'Browser storag' })]));
  assert.equal(errors.length, 1);
  assert.equal(errors[0].path, 'sections[0].recommended');
  assert.match(errors[0].message, /^recommended "Browser storag" is not an option label; did you mean "Browser storage"\?/);
});

test('default, when set, must equal an option label', async () => {
  assert.deepEqual(await errorsOf(plan([decision({ default: 'A save server' })])), []);
  const errors = await errorsOf(plan([decision({ default: 'Nothing' })]));
  assert.equal(errors.length, 1);
  assert.equal(errors[0].path, 'sections[0].default');
  assert.match(errors[0].message, /^default "Nothing" is not an option label; .*"Browser storage", "A save server"/);
});

test('two options with one label are an error (answers key on the label)', async () => {
  const errors = await errorsOf(plan([decision({ options: [{ label: 'Same' }, { label: 'Same' }], recommended: 'Same' })]));
  assert.deepEqual(errors, [{ path: 'sections[0].options[1].label', message: 'duplicate option label "Same"; first used at sections[0].options[0].label; give each option its own label' }]);
});

test('ids are unique across decision, approval and question', async () => {
  const errors = await errorsOf(plan([decision({ id: 'same' }), approval({ id: 'same' }), question({ id: 'same' })]));
  assert.deepEqual(errors.map((e) => e.path), ['sections[1].id', 'sections[2].id']);
  assert.match(errors[0].message, /^duplicate id "same"; first used at sections\[0\]\.id/);
});

test('at most one verdict', async () => {
  const errors = await errorsOf(plan([decision(), verdict(), verdict()]));
  assert.deepEqual(errors, [
    { path: 'sections[1]', message: 'the verdict must be the last section; move it to the end' },
    { path: 'sections[2]', message: 'only one verdict per page; the first is at sections[1]; remove this one' },
  ]);
});

test('the verdict must be the last section', async () => {
  assert.deepEqual(await errorsOf(plan([verdict(), decision()])), [
    { path: 'sections[0]', message: 'the verdict must be the last section; move it to the end' },
  ]);
});

test('a review target must match an explicit section id', async () => {
  const errors = await errorsOf(plan([decision(), review({ items: [{ point: 'p', why: 'w.', target: 'storag' }] })]));
  assert.equal(errors.length, 1);
  assert.equal(errors[0].path, 'sections[1].items[0].target');
  assert.match(errors[0].message, /^target "storag" matches no section id; did you mean "storage"\?/);
});

test('a review target without a matching id lists the ids there are', async () => {
  const errors = await errorsOf(plan([decision(), review({ items: [{ point: 'p', why: 'w.', target: 'zzzzzzzz' }] })]));
  assert.match(errors[0].message, /^target "zzzzzzzz" matches no section id; set an explicit id on the section it points to; ids: storage$/);
});

test('a plan needs at least one decision, approval or question', async () => {
  assert.deepEqual(await errorsOf(plan([{ type: 'text', text: 'Only words.' }, verdict()])), [
    { path: 'sections', message: 'a plan needs at least one decision, approval or question' },
  ]);
  for (const one of [decision(), approval(), question()]) assert.deepEqual(await errorsOf(plan([one])), [], one.type);
});

test('plan types are accepted outside the plan preset', async () => {
  assert.deepEqual(await errorsOf({ title: 'T', sections: [decision(), verdict()] }), []);
});

// ---- root key -------------------------------------------------------------------------------------

test('key: optional on any preset; validated by pattern and length', async () => {
  assert.deepEqual(await errorsOf({ title: 'T', sections: [{ type: 'text', text: 'x' }] , key: 'release-2.1' }), []);
  assert.deepEqual(await errorsOf(plan([decision()], { key: undefined })), [], 'not required yet (Task 14 makes it required for plan)');
  assert.deepEqual(await errorsOf(plan([decision()], { key: 'Bad Key' })), [
    { path: 'key', message: 'key "Bad Key" is invalid; use lowercase letters, digits, . - and _, starting with a letter or digit' },
  ]);
  assert.deepEqual(await errorsOf(plan([decision()], { key: 'k'.repeat(LIMITS.checklistKey + 1) })), [
    { path: 'key', message: `key is ${LIMITS.checklistKey + 1} characters; the limit is ${LIMITS.checklistKey} — shorten it` },
  ]);
  assert.deepEqual(await errorsOf(plan([decision()], { key: 3 })), [{ path: 'key', message: 'must be string' }]);
});

// ---- walk / lint ----------------------------------------------------------------------------------

test('recommended, default and target are not prose', () => {
  const strings = collectStrings(plan([decision({ default: 'A save server' }), question({ default: 'Leave it' }), review()]));
  const byPath = Object.fromEntries(strings.map((s) => [s.path, s.prose]));
  assert.equal(byPath['sections[0].recommended'], false);
  assert.equal(byPath['sections[0].default'], false);
  assert.equal(byPath['sections[1].default'], false);
  assert.equal(byPath['sections[2].items[0].target'], false);
  assert.equal(byPath['sections[0].question'], true);
  assert.equal(byPath['sections[0].options[0].label'], true);
  assert.equal(byPath['sections[2].items[0].point'], true);
});

test('a placeholder in a non-prose plan field is still caught', async () => {
  const errors = await errorsOf(plan([question({ default: 'TODO: decide' })]));
  assert.deepEqual(errors, [{ path: 'sections[0].default', message: 'still has a TODO placeholder — replace it with real content' }]);
});

// ---- slides ---------------------------------------------------------------------------------------

test('slides: options count as points, review items too, the rest count none', () => {
  const five = [1, 2, 3, 4, 5].map((n) => ({ label: `Option ${n}` }));
  assert.equal(pointCount(decision({ options: five, recommended: 'Option 1' })), 5);
  assert.equal(pointCount(review({ items: Array(4).fill({ point: 'p', why: 'w' }) })), 4);
  assert.equal(pointCount(approval()), 0);
  assert.equal(pointCount(question()), 0);
  assert.equal(pointCount(verdict()), 0);
});

test('slides: a decision whose options push it past the word budget is an error', () => {
  const long = 'word '.repeat(20).trim();
  const opts = [1, 2, 3, 4, 5].map((n) => ({ label: `Option ${n}`, pros: [long] }));
  const errors = slideBudget({ title: 'Deck', mode: 'slides', sections: [decision({ options: opts, recommended: 'Option 1' })] });
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /^slide has \d+ words; the limit is 80/);
});

test('slides: untitled plan sections are named after their type', () => {
  assert.deepEqual(['decision', 'approval', 'question', 'verdict', 'review'].map((type) => slideTitle({ type })), ['Decision', 'Approval', 'Open question', 'Verdict', 'Review these first']);
});
