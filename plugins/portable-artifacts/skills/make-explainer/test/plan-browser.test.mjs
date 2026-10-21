// Plan mode, the answer runtime (template/plan.js) in a real browser: choices, free text, comments, saved answers,
// a changed plan, blocked storage, and the Copy / Download export of the plan-answers/1 file.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildSpec, haveBrowser, openPage, closeSharedBrowser } from './helpers/browser.mjs';
import { checkPage } from '../scripts/check.mjs';

after(closeSharedBrowser);

const skipUnlessBrowser = async (t) => {
  if (await haveBrowser()) return false;
  t.skip('no browser (bundled Chromium or system Chrome)');
  return true;
};

const HOSTILE = 'Use "</script>" safely';
const STORE = 'pa-plan:plan-test';

const decision = (id, options, extra = {}) => ({
  type: 'decision', id, title: `Decision ${id}`, question: `Which for ${id}?`,
  options: options.map((label) => ({ label })), recommended: options[0], why: 'It is the simplest.', ...extra,
});
const spec = (sections, extra = {}) => ({
  title: 'Plan test', key: 'plan-test',
  sections: [...sections, { type: 'verdict', text: 'Ship it?' }], ...extra,
});
const BASE = [
  decision('storage', ['Browser storage', 'A save server', HOSTILE]),
  decision('theme', ['Mono', 'Brief'], { default: 'Brief' }),
  { type: 'approval', id: 'budget', title: 'Budget', item: 'Approve the budget', why: 'It is small.' },
  { type: 'question', id: 'owner', title: 'Owner', text: 'Who owns the rollout?', default: 'The author' },
];
const built = (sections = BASE, extra = {}) => buildSpec(spec(sections, extra));

const exported = (page) => page.evaluate(() => window.PA.planExport());
const pick = (page, id, value) => page.locator(`input[name="plan-${id}"]`).evaluateAll((els, v) => els.find((e) => e.value === v).click(), value);
const stored = (page) => page.evaluate((k) => localStorage.getItem(k), STORE);
const item = (id) => `[data-plan-item][data-id="${id}"]`;

test('a non-recommended option exports isRecommended false, the recommended one true', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built().url);
  await pick(page, 'storage', 'A save server');
  await pick(page, 'theme', 'Mono');
  const file = await exported(page);
  const [storage, theme] = file.answers;
  assert.deepEqual([storage.answered, storage.choice, storage.isRecommended], [true, 'A save server', false]);
  assert.deepEqual([theme.answered, theme.choice, theme.isRecommended], [true, 'Mono', true]);
  assert.deepEqual(problems, []);
  await context.close();
});

test('unanswered items export answered false, with the default as choice or text, or null', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, context } = await openPage(built().url);
  const file = await exported(page);
  assert.equal(file.schema, 'plan-answers/1');
  assert.equal(file.planKey, 'plan-test');
  assert.equal(file.planHash, '');
  assert.equal(file.reviewer, '');
  assert.equal(file.verdict, null);
  assert.deepEqual(file.answers, [
    { id: 'storage', kind: 'decision', question: 'Which for storage?', answered: false, choice: null, isRecommended: null, text: null, comment: null },
    { id: 'theme', kind: 'decision', question: 'Which for theme?', answered: false, choice: 'Brief', isRecommended: null, text: null, comment: null },
    { id: 'budget', kind: 'approval', question: 'Approve the budget', answered: false, choice: null, isRecommended: null, text: null, comment: null },
    { id: 'owner', kind: 'question', question: 'Who owns the rollout?', answered: false, choice: null, isRecommended: null, text: 'The author', comment: null },
  ]);
  await context.close();
});

test('every kind exports its answer; the verdict and the trimmed reviewer name come with it', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, context } = await openPage(built().url);
  await pick(page, 'budget', 'changes');
  await page.locator(`${item('budget')} [data-comment]`).fill('Cut it by half');
  await page.locator(`${item('owner')} [data-answer]`).fill('Dana');
  await pick(page, 'verdict', 'approve-with-changes');
  await page.locator('[data-reviewer]').fill('  Ada Lovelace  ');
  const file = await exported(page);
  assert.equal(file.verdict, 'approve-with-changes');
  assert.equal(file.reviewer, 'Ada Lovelace');
  const [, , budget, owner] = file.answers;
  assert.deepEqual(budget, { id: 'budget', kind: 'approval', question: 'Approve the budget', answered: true, choice: 'changes', isRecommended: null, text: null, comment: 'Cut it by half' });
  assert.deepEqual(owner, { id: 'owner', kind: 'question', question: 'Who owns the rollout?', answered: true, choice: null, isRecommended: null, text: 'Dana', comment: null });
  assert.equal(file.answers.length, 4, 'the verdict is not an answer row');
  await context.close();
});

test('a blank question answer counts as unanswered', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, context } = await openPage(built().url);
  await page.locator(`${item('owner')} [data-answer]`).fill('   ');
  const owner = (await exported(page)).answers[3];
  assert.deepEqual([owner.answered, owner.text], [false, 'The author']);
  await context.close();
});

test('answers come out in page order: two decisions, then an approval', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const sections = [decision('zeta', ['One', 'Two']), { type: 'approval', id: 'mid', title: 'Mid', item: 'Approve mid', why: 'Why.' }, decision('alpha', ['Red', 'Blue'])];
  const { page, context } = await openPage(built(sections).url);
  await pick(page, 'alpha', 'Blue');
  await pick(page, 'mid', 'approve');
  await pick(page, 'zeta', 'Two');
  const file = await exported(page);
  assert.deepEqual(file.answers.map((a) => [a.id, a.kind, a.choice]), [['zeta', 'decision', 'Two'], ['mid', 'approval', 'approve'], ['alpha', 'decision', 'Blue']]);
  await context.close();
});

test('choosing, typing and a verdict survive a reload under pa-plan:<key> as { hash, answers }', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built().url);
  await pick(page, 'storage', 'A save server');
  await page.locator(`${item('storage')} [data-comment]`).fill('Only if cheap');
  await pick(page, 'budget', 'reject');
  await page.locator(`${item('owner')} [data-answer]`).fill('Dana');
  await pick(page, 'verdict', 'not-yet');
  await page.locator('[data-reviewer]').fill('Ada');
  const before = await exported(page);
  const saved = JSON.parse(await stored(page));
  assert.equal(saved.hash, '');
  assert.deepEqual(saved.answers.storage, { choice: 'A save server', comment: 'Only if cheap' });
  assert.deepEqual(saved.answers.owner, { text: 'Dana' });
  await page.reload();
  await page.waitForFunction(() => window.paReady === true);
  assert.deepEqual(await exported(page), before);
  assert.equal(await page.locator('input[name="plan-storage"]:checked').inputValue(), 'A save server');
  assert.equal(await page.locator(`${item('owner')} [data-answer]`).inputValue(), 'Dana');
  assert.equal(await page.locator('[data-reviewer]').inputValue(), 'Ada');
  assert.equal(await page.locator('[data-plan-stale]').isHidden(), true);
  assert.equal(await page.locator('[data-plan-unsaved]').isHidden(), true);
  assert.deepEqual(problems, []);
  await context.close();
});

test('saved answers whose hash differs are ignored, a notice says the plan changed, and the next save carries the new hash', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const old = JSON.stringify({ hash: 'old-hash', answers: { storage: { choice: 'A save server' } } });
  const { page, problems, context } = await openPage(built().url, { seed: { [STORE]: old } });
  assert.equal(await page.locator('input[name="plan-storage"]:checked').count(), 0);
  assert.equal((await exported(page)).answers[0].answered, false);
  assert.equal(await page.locator('[data-plan-stale]').isVisible(), true);
  assert.match(await page.locator('[data-plan-stale]').textContent(), /plan changed/i);
  await pick(page, 'theme', 'Mono');
  assert.deepEqual(JSON.parse(await stored(page)), { hash: '', answers: { theme: { choice: 'Mono' } }, verdict: null, reviewer: '' });
  assert.deepEqual(problems, []);
  await context.close();
});

test('a page hash that matches the saved hash keeps the answers; a changed page hash drops them', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { file, html } = built();
  const withHash = (hash) => {
    const out = path.join(path.dirname(file), `hash-${hash}.html`);
    fs.writeFileSync(out, html.replace('data-plan-hash=""', `data-plan-hash="${hash}"`));
    return pathToFileURL(out).href;
  };
  const same = JSON.stringify({ hash: 'abc123', answers: { storage: { choice: 'A save server' } } });
  const a = await openPage(withHash('abc123'), { seed: { [STORE]: same } });
  assert.equal(await a.page.locator('input[name="plan-storage"]:checked').inputValue(), 'A save server');
  assert.equal((await exported(a.page)).planHash, 'abc123');
  assert.equal(await a.page.locator('[data-plan-stale]').isHidden(), true);
  await a.context.close();
  const b = await openPage(withHash('def456'), { seed: { [STORE]: same } });
  assert.equal(await b.page.locator('input[name="plan-storage"]:checked').count(), 0);
  assert.equal(await b.page.locator('[data-plan-stale]').isVisible(), true);
  await b.context.close();
});

test('junk in storage, or a saved choice that is no longer an option, is ignored without an error', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  for (const raw of ['not json', '[]', 'null', JSON.stringify({ hash: '', answers: { storage: { choice: 'Gone' }, owner: { text: 7 }, __proto__: { x: 1 } } })]) {
    const { page, problems, context } = await openPage(built().url, { seed: { [STORE]: raw } });
    assert.equal(await page.locator('input[name="plan-storage"]:checked').count(), 0, raw);
    assert.equal(await page.locator(`${item('owner')} [data-answer]`).inputValue(), '', raw);
    assert.deepEqual(problems, [], raw);
    await context.close();
  }
});

test('blocked storage: answering still works, the export has the answers, and a note says they are not saved', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built().url, { blockStorage: true });
  assert.equal(await page.locator('[data-plan-unsaved]').isVisible(), true);
  assert.match(await page.locator('[data-plan-unsaved]').textContent(), /won't be saved/);
  await pick(page, 'storage', 'Browser storage');
  await page.locator(`${item('owner')} [data-answer]`).fill('Dana');
  const file = await exported(page);
  assert.deepEqual([file.answers[0].choice, file.answers[3].text], ['Browser storage', 'Dana']);
  assert.deepEqual(problems, []);
  await context.close();
});

test('a write that fails after load shows the not-saved note', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, context } = await openPage(built().url);
  assert.equal(await page.locator('[data-plan-unsaved]').isHidden(), true);
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); }; });
  await pick(page, 'theme', 'Mono');
  assert.equal(await page.locator('[data-plan-unsaved]').isVisible(), true);
  assert.equal((await exported(page)).answers[1].choice, 'Mono');
  await context.close();
});

test('Copy answers writes the JSON to the clipboard and says so', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const init = () => { window.__copied = []; Object.defineProperty(navigator, 'clipboard', { value: { writeText: (s) => { window.__copied.push(s); return Promise.resolve(); } }, configurable: true }); };
  const { page, problems, context } = await openPage(built().url, { init });
  await pick(page, 'storage', 'Browser storage');
  await page.locator('[data-plan-copy]').click();
  const copied = await page.evaluate(() => window.__copied);
  assert.equal(copied.length, 1);
  assert.deepEqual(JSON.parse(copied[0]), await exported(page));
  assert.match(await page.locator('[data-plan-status]').textContent(), /copied/i);
  assert.deepEqual(problems, []);
  await context.close();
});

test('Copy answers falls back to selecting a readonly textarea when the clipboard API fails', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const init = () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) }, configurable: true });
    window.__exec = [];
    document.execCommand = (name) => { const a = document.activeElement; window.__exec.push([name, a && a.tagName, a && a.readOnly, a && a.value]); return true; };
  };
  const { page, problems, context } = await openPage(built().url, { init });
  await page.locator('[data-plan-copy]').click();
  await page.waitForFunction(() => window.__exec.length === 1);
  const [[name, tag, readOnly, value]] = await page.evaluate(() => window.__exec);
  assert.deepEqual([name, tag, readOnly], ['copy', 'TEXTAREA', true]);
  assert.deepEqual(JSON.parse(value), await exported(page));
  assert.equal(await page.locator('textarea[readonly]').count(), 0, 'the helper textarea is removed');
  assert.match(await page.locator('[data-plan-status]').textContent(), /copied/i);
  assert.deepEqual(problems, []);
  await context.close();
});

test('Download writes plan-answers.json whose contents equal PA.planExport()', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built().url);
  await pick(page, 'storage', HOSTILE);
  await pick(page, 'verdict', 'approve');
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-plan-download]').click()]);
  assert.equal(download.suggestedFilename(), 'plan-answers.json');
  const body = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
  assert.deepEqual(body, await exported(page));
  assert.equal(body.verdict, 'approve');
  assert.deepEqual(problems, []);
  await context.close();
});

test('a hostile option label and a 5,000 character comment round-trip unchanged', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const long = `${'0123456789'.repeat(499)}"</script>`;
  assert.equal(long.length, 5000);
  const { page, context } = await openPage(built().url);
  await pick(page, 'storage', HOSTILE);
  await page.locator(`${item('storage')} [data-comment]`).fill(long);
  const [row] = (await exported(page)).answers;
  assert.equal(row.choice, HOSTILE);
  assert.equal(row.comment, long);
  await page.reload();
  await page.waitForFunction(() => window.paReady === true);
  const again = (await exported(page)).answers[0];
  assert.equal(again.choice, HOSTILE);
  assert.equal(again.comment, long);
  assert.equal(again.isRecommended, false);
  await context.close();
});

test('selecting stays responsive: the option rows are not re-rendered', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, context } = await openPage(built().url);
  await page.evaluate(() => { window.__marks = [...document.querySelectorAll('[data-plan-item] input, [data-plan-item] textarea')]; });
  await pick(page, 'storage', 'A save server');
  await page.locator(`${item('owner')} [data-answer]`).fill('x');
  const same = await page.evaluate(() => [...document.querySelectorAll('[data-plan-item] input, [data-plan-item] textarea')].every((el, i) => el === window.__marks[i]));
  assert.equal(same, true);
  await context.close();
});

test('a built plan page passes scripts/check.mjs (no console errors, no sideways scroll at 1280 and 390)', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const result = await checkPage(built().file);
  assert.deepEqual(result.problems, []);
  assert.equal(result.status, 'ok');
  assert.equal(result.viewports, 2);
});
