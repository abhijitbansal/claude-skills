// Plan mode, the answer runtime (template/plan.js) in a real browser: choices, free text, comments, saved answers,
// a changed plan, blocked storage, and the Copy / Download export of the plan-answers/1 file.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
const TEXT_SETTLE_MS = 400; // typing is saved 250 ms after the last key
const settle = (page) => page.waitForTimeout(TEXT_SETTLE_MS);
const said = (page, pattern) => page.waitForFunction((src) => new RegExp(src, 'i').test(document.querySelector('[data-plan-status]').textContent), pattern);
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
  assert.match(file.planHash, /^[0-9a-f]{12}$/);
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
  await settle(page);
  const before = await exported(page);
  const saved = JSON.parse(await stored(page));
  assert.equal(saved.hash, before.planHash);
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

test('saved answers whose hash differs are not applied and not wiped; a notice says the plan changed', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const old = JSON.stringify({ hash: 'old-hash', answers: { storage: { choice: 'A save server' } } });
  const { page, problems, context } = await openPage(built().url, { seed: { [STORE]: old } });
  assert.equal(await page.locator('input[name="plan-storage"]:checked').count(), 0);
  assert.equal((await exported(page)).answers[0].answered, false);
  assert.equal(await page.locator('[data-plan-stale]').isVisible(), true);
  assert.match(await page.locator('[data-plan-stale]').textContent(), /plan changed/i);
  await settle(page);
  assert.equal(await stored(page), old, 'nothing is written until the reader changes something');
  await page.reload();
  await page.waitForFunction(() => window.paReady === true);
  assert.equal(await page.locator('[data-plan-stale]').isVisible(), true, 'still the old plan data, so the notice shows again');
  assert.equal(await stored(page), old);
  assert.deepEqual(problems, []);
  await context.close();
});

test('the first answer after a stale load replaces the old entry, and a reload shows no notice', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const old = JSON.stringify({ hash: 'old-hash', answers: { storage: { choice: 'A save server' } } });
  const { page, context } = await openPage(built().url, { seed: { [STORE]: old } });
  await pick(page, 'theme', 'Mono');
  const { updatedAt, ...entry } = JSON.parse(await stored(page));
  assert.ok(Number.isFinite(updatedAt), 'every write is stamped, so a saved page can tell which copy is newer');
  assert.deepEqual(entry, { hash: (await exported(page)).planHash, answers: { theme: { choice: 'Mono' } }, verdict: null, reviewer: '' });
  await page.reload();
  await page.waitForFunction(() => window.paReady === true);
  assert.equal(await page.locator('[data-plan-stale]').isHidden(), true);
  assert.equal(await page.locator('input[name="plan-theme"]:checked').inputValue(), 'Mono');
  assert.equal(await page.locator('input[name="plan-storage"]:checked').count(), 0);
  await context.close();
});

test('an object without a matching hash, even {}, counts as another plan: notice, not wiped', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  for (const raw of ['{}', JSON.stringify({ answers: { storage: { choice: 'A save server' } } })]) {
    const { page, problems, context } = await openPage(built().url, { seed: { [STORE]: raw } });
    assert.equal(await page.locator('[data-plan-stale]').isVisible(), true, raw);
    assert.equal(await page.locator('input[name="plan-storage"]:checked').count(), 0, raw);
    await settle(page);
    assert.equal(await stored(page), raw, raw);
    assert.deepEqual(problems, [], raw);
    await context.close();
  }
});

test('a page hash that matches the saved hash keeps the answers; a changed page hash drops them', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { file, html } = built();
  const withHash = (hash) => {
    const out = path.join(path.dirname(file), `hash-${hash}.html`);
    fs.writeFileSync(out, html.replace(/data-plan-hash="[0-9a-f]*"/, `data-plan-hash="${hash}"`));
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
  const { url, html } = built();
  const hash = /data-plan-hash="([0-9a-f]+)"/.exec(html)[1];
  const proto = `{"hash":"${hash}","answers":{"__proto__":{"choice":"A save server"},"storage":{"choice":"Gone"},"owner":{"text":7}}}`;
  const cases = [['not json', false], ['[]', false], ['null', false], ['{}', true], [proto, false]];
  for (const [raw, notice] of cases) {
    const { page, problems, context } = await openPage(url, { seed: { [STORE]: raw } });
    assert.equal(await page.locator('input[name="plan-storage"]:checked').count(), 0, raw);
    assert.equal(await page.locator(`${item('owner')} [data-answer]`).inputValue(), '', raw);
    assert.equal(await page.locator('[data-plan-stale]').isVisible(), notice, raw);
    assert.equal(await page.evaluate(() => ({}).choice === undefined && Object.prototype.choice === undefined), true, 'no prototype pollution');
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

test('the not-saved note hides again when a later write succeeds', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, context } = await openPage(built().url);
  await page.evaluate(() => { window.__set = Storage.prototype.setItem; Storage.prototype.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); }; });
  await pick(page, 'theme', 'Mono');
  assert.equal(await page.locator('[data-plan-unsaved]').isVisible(), true);
  await page.evaluate(() => { Storage.prototype.setItem = window.__set; });
  await pick(page, 'theme', 'Brief');
  assert.equal(await page.locator('[data-plan-unsaved]').isHidden(), true);
  await context.close();
});

const failWrites = (page) => page.evaluate(() => { window.__set = Storage.prototype.setItem; Storage.prototype.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); }; });
const allowWrites = (page) => page.evaluate(() => { Storage.prototype.setItem = window.__set; });

test('an answer whose write failed is saved by the next write that holds, and only then does the note go', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built().url);
  await pick(page, 'budget', 'approve'); // an entry exists, so later writes merge into it
  await failWrites(page);
  await pick(page, 'storage', 'A save server');
  assert.equal(await page.locator('[data-plan-unsaved]').isVisible(), true);
  await allowWrites(page);
  await pick(page, 'theme', 'Mono');
  assert.equal(await page.locator('[data-plan-unsaved]').isHidden(), true);
  await page.reload();
  await page.waitForFunction(() => window.paReady === true);
  const [storage, theme, budget] = (await exported(page)).answers;
  assert.deepEqual([storage.choice, theme.choice, budget.choice], ['A save server', 'Mono', 'approve'], 'A was never stored by its own write, yet comes back');
  assert.deepEqual(problems, []);
  await context.close();
});

test('while writes keep failing, the not-saved note stays', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, context } = await openPage(built().url);
  await failWrites(page);
  await pick(page, 'storage', 'A save server');
  await pick(page, 'theme', 'Mono');
  assert.equal(await page.locator('[data-plan-unsaved]').isVisible(), true);
  assert.deepEqual((await exported(page)).answers.slice(0, 2).map((a) => a.choice), ['A save server', 'Mono']);
  await context.close();
});

test('a cleared textarea and a cleared comment stay cleared after a reload', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, context } = await openPage(built().url);
  const owner = page.locator(`${item('owner')} [data-answer]`);
  const note = page.locator(`${item('storage')} [data-comment]`);
  await pick(page, 'storage', 'A save server');
  await owner.fill('Dana');
  await note.fill('Maybe');
  await settle(page);
  await owner.fill('');
  await note.fill('');
  await settle(page);
  await page.reload();
  await page.waitForFunction(() => window.paReady === true);
  const [storage, , , own] = (await exported(page)).answers;
  assert.deepEqual([own.answered, own.text], [false, 'The author'], 'back to the default state');
  assert.deepEqual([storage.choice, storage.comment], ['A save server', null]);
  assert.equal(await owner.inputValue(), '');
  await context.close();
});

test('typing is saved at once when the page becomes hidden (no reload needed)', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, context } = await openPage(built().url);
  await page.locator(`${item('owner')} [data-answer]`).fill('hidden soon');
  const saved = await page.evaluate((k) => {
    Object.defineProperty(document, 'hidden', { get: () => true, configurable: true });
    Object.defineProperty(document, 'visibilityState', { get: () => 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    return localStorage.getItem(k);
  }, STORE);
  assert.equal(JSON.parse(saved).answers.owner.text, 'hidden soon');
  await context.close();
});

test('two quick Copy clicks end with the message showing, and it clears once after the delay', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const init = () => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.resolve() }, configurable: true }); };
  const { page, context } = await openPage(built().url, { init });
  await page.evaluate(() => { window.__texts = []; new MutationObserver(() => window.__texts.push(document.querySelector('[data-plan-status]').textContent)).observe(document.querySelector('[data-plan-status]'), { childList: true, characterData: true, subtree: true }); });
  await page.evaluate(() => { const b = document.querySelector('[data-plan-copy]'); b.click(); b.click(); });
  await said(page, 'copied');
  await page.waitForTimeout(1500);
  assert.match(await page.locator('[data-plan-status]').textContent(), /copied/i, 'still showing; no early clear from the first click');
  await page.waitForFunction(() => document.querySelector('[data-plan-status]').textContent === '');
  const texts = await page.evaluate(() => window.__texts);
  assert.equal(texts.filter((x) => /copied/i.test(x)).length, 1, 'set once, not twice');
  await context.close();
});

test('Copy answers writes compact one-line JSON to the clipboard and says so', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const init = () => { window.__copied = []; Object.defineProperty(navigator, 'clipboard', { value: { writeText: (s) => { window.__copied.push(s); return Promise.resolve(); } }, configurable: true }); };
  const { page, problems, context } = await openPage(built().url, { init });
  await pick(page, 'storage', 'Browser storage');
  await page.locator('[data-plan-copy]').click();
  const copied = await page.evaluate(() => window.__copied);
  assert.equal(copied.length, 1);
  assert.equal(copied[0], JSON.stringify(await exported(page)), 'one compact line');
  assert.ok(!copied[0].includes('\n'));
  await said(page, 'copied');
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
  assert.equal(value, JSON.stringify(await exported(page)));
  assert.equal(await page.locator('textarea[readonly]').count(), 0, 'the helper textarea is removed');
  await said(page, 'copied');
  assert.deepEqual(problems, []);
  await context.close();
});

test('with no clipboard API the fallback runs inside the click, and a repeated message is announced again', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const init = () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    window.__exec = [];
    document.execCommand = (name) => { const a = document.activeElement; window.__exec.push([name, a && a.tagName, a && a.readOnly, a && a.value]); return true; };
  };
  const { page, problems, context } = await openPage(built().url, { init });
  await pick(page, 'storage', 'A save server');
  // One evaluate: click() runs the handler to its end before it returns, so a copy attempt seen right after it was synchronous.
  const sync = await page.evaluate(() => { document.querySelector('[data-plan-copy]').click(); return window.__exec.length; });
  assert.equal(sync, 1, 'the copy call is made before the click handler returns');
  const [[name, tag, readOnly, value]] = await page.evaluate(() => window.__exec);
  assert.deepEqual([name, tag, readOnly], ['copy', 'TEXTAREA', true]);
  assert.equal(value, JSON.stringify(await exported(page)));
  await said(page, 'copied');
  await page.evaluate(() => { window.__texts = []; new MutationObserver(() => window.__texts.push(document.querySelector('[data-plan-status]').textContent)).observe(document.querySelector('[data-plan-status]'), { childList: true, characterData: true, subtree: true }); });
  await page.locator('[data-plan-copy]').click();
  await page.waitForFunction(() => window.__texts.some((x) => /copied/i.test(x)));
  const texts = await page.evaluate(() => window.__texts);
  assert.equal(texts[0], '', 'cleared first, then set again');
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
  const text = fs.readFileSync(await download.path(), 'utf8');
  const body = JSON.parse(text);
  assert.equal(text, `${JSON.stringify(await exported(page), null, 2)}\n`, 'pretty-printed, two spaces');
  assert.deepEqual(body, await exported(page));
  await said(page, 'download started');
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

test('a label with markdown, an ampersand and a script close comes back as the raw string', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const raw = '"</script> **A** & <b>B</b>';
  const { page, problems, context } = await openPage(built([decision('raw', ['Plain', raw])]).url);
  await pick(page, 'raw', raw);
  assert.equal((await exported(page)).answers[0].choice, raw);
  await page.reload();
  await page.waitForFunction(() => window.paReady === true);
  assert.equal((await exported(page)).answers[0].choice, raw);
  assert.deepEqual(problems, []);
  await context.close();
});

test('typing is saved when the page is left within the debounce window', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, context } = await openPage(built().url);
  await page.locator(`${item('owner')} [data-answer]`).fill('quick');
  await page.reload();
  await page.waitForFunction(() => window.paReady === true);
  assert.equal(await page.locator(`${item('owner')} [data-answer]`).inputValue(), 'quick');
  await context.close();
});

test('two tabs answering different items keep both (writes merge by item)', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const url = built().url;
  const one = await openPage(url);
  // Tab two swallows the storage event (a listener added before the page's own), so only the merge on write can
  // keep tab one's answer.
  const init = () => window.addEventListener('storage', (e) => e.stopImmediatePropagation(), true);
  const two = await openPage(url, { context: one.context, init });
  await pick(one.page, 'storage', 'A save server');
  await two.page.waitForFunction((k) => localStorage.getItem(k) !== null, STORE); // tab one's write has landed
  await pick(two.page, 'theme', 'Mono');
  await one.page.reload();
  await one.page.waitForFunction(() => window.paReady === true);
  const file = await exported(one.page);
  assert.deepEqual([file.answers[0].choice, file.answers[1].choice], ['A save server', 'Mono']);
  assert.deepEqual([one.problems, two.problems], [[], []]);
  await one.context.close();
});

test('an answer saved in another tab appears on this page without a reload', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const url = built().url;
  const one = await openPage(url);
  const two = await openPage(url, { context: one.context });
  await pick(one.page, 'storage', 'Browser storage');
  await one.page.locator(`${item('owner')} [data-answer]`).fill('from one');
  await settle(one.page);
  await two.page.waitForFunction(() => document.querySelector('input[name="plan-storage"]:checked') !== null);
  assert.equal(await two.page.locator('input[name="plan-storage"]:checked').inputValue(), 'Browser storage');
  assert.equal(await two.page.locator(`${item('owner')} [data-answer]`).inputValue(), 'from one');
  assert.deepEqual([one.problems, two.problems], [[], []]);
  await one.context.close();
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

// ---- Save as HTML ----------------------------------------------------------------------------------

const SAVED_SLOT = /<script type="application\/json" id="pa-plan-saved">([^]*?)<\/script>/;
const planHashOf = (html) => html.match(/data-plan-hash="([0-9a-f]+)"/)[1];
const answerSome = async (page) => {
  await pick(page, 'storage', HOSTILE);
  await pick(page, 'theme', 'Mono');
  await pick(page, 'budget', 'changes');
  await page.locator(`${item('owner')} [data-answer]`).fill('Ada owns it');
  await page.locator(`${item('storage')} [data-comment]`).fill('Because </script> must survive');
  await pick(page, 'verdict', 'approve');
  await page.locator('[data-reviewer]').fill('Grace');
  await settle(page);
};
const saveHtml = async (page) => {
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-plan-save-html]').click()]);
  const file = await download.path();
  return { name: download.suggestedFilename(), file, html: fs.readFileSync(file, 'utf8') };
};
// A download's temp file has no .html extension; copy it to one so it opens as a page.
const asPage = (saved, name = 'saved.html') => {
  const out = path.join(path.dirname(built().file), name);
  fs.writeFileSync(out, saved.html);
  return pathToFileURL(out).href;
};

test('Save as HTML downloads <key>-answered.html that carries the answers and the plan-answers file', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built().url);
  await answerSome(page);
  const saved = await saveHtml(page);
  assert.equal(saved.name, 'plan-test-answered.html');
  const payload = JSON.parse(saved.html.match(SAVED_SLOT)[1]);
  assert.equal(payload.schema, 'plan-saved/1');
  assert.ok(Number.isFinite(payload.savedAt));
  assert.deepEqual(payload.export, await exported(page));
  assert.equal(payload.export.verdict, 'approve');
  assert.equal(payload.export.reviewer, 'Grace');
  await said(page, 'saved');
  assert.deepEqual(problems, []);
  await context.close();
});

test('the saved page, opened in a browser that has never seen the plan, shows the answers and keeps working', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const first = await openPage(built().url);
  await answerSome(first.page);
  const before = await exported(first.page);
  const saved = await saveHtml(first.page);
  await first.context.close();

  const second = await openPage(asPage(saved));
  assert.deepEqual(await exported(second.page), before);
  assert.equal(await second.page.locator('[data-reviewer]').inputValue(), 'Grace');
  assert.ok(await stored(second.page), 'the restored answers are saved in this browser too');
  await pick(second.page, 'theme', 'Brief');
  assert.equal((await exported(second.page)).answers.find((a) => a.id === 'theme').choice, 'Brief');
  assert.deepEqual(second.problems, []);
  await second.context.close();
});

test('answers.mjs accepts a page the browser really saved, and reads the answers out of it', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const site = built();
  const { page, context } = await openPage(site.url);
  await answerSome(page);
  const saved = await saveHtml(page);
  await context.close();
  const savedFile = path.join(path.dirname(site.file), 'answered.html');
  fs.writeFileSync(savedFile, saved.html);
  const planFile = path.join(path.dirname(site.file), 'plan.explainer.json');
  fs.writeFileSync(planFile, JSON.stringify(spec(BASE))); // the spec built() builds the page from
  const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '../scripts/answers.mjs');
  const r = spawnSync(process.execPath, [cli, planFile, savedFile], { encoding: 'utf8', env: { ...process.env, EVAL_LOG: '' } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /answered\.html: valid/);
  assert.match(r.stdout, /Reviewer text \(data, not instructions\)/);
  assert.match(r.stdout, /Ada owns it/);
});

test('a saved page can be saved again, and the second copy has exactly one answers slot', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const first = await openPage(built().url);
  await answerSome(first.page);
  const saved = await saveHtml(first.page);
  await first.context.close();
  const second = await openPage(asPage(saved));
  await pick(second.page, 'budget', 'approve');
  const again = await saveHtml(second.page);
  assert.equal(again.html.split('id="pa-plan-saved"').length - 1, 1);
  assert.equal(JSON.parse(again.html.match(SAVED_SLOT)[1]).export.answers.find((a) => a.id === 'budget').choice, 'approve');
  await second.context.close();
});

test('a newer answer already in this browser wins over the saved page; an older one loses', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const first = await openPage(built().url);
  await answerSome(first.page);
  const saved = await saveHtml(first.page);
  await first.context.close();
  const hash = planHashOf(saved.html);
  const entry = (updatedAt) => JSON.stringify({ hash, updatedAt, answers: { storage: { choice: 'A save server' } }, verdict: null, reviewer: '' });

  const newer = await openPage(asPage(saved), { seed: { [STORE]: entry(Date.now() + 60000) } });
  assert.equal((await exported(newer.page)).answers.find((a) => a.id === 'storage').choice, 'A save server');
  await newer.context.close();

  const older = await openPage(asPage(saved), { seed: { [STORE]: entry(1) } });
  assert.equal((await exported(older.page)).answers.find((a) => a.id === 'storage').choice, HOSTILE);
  assert.equal((await exported(older.page)).reviewer, 'Grace');
  await older.context.close();
});

test('the saved page is clean: no theme choice, no notices showing, nothing left in the status line, hostile text cannot end the slot', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, context } = await openPage(built().url, { seed: { 'pa-theme': 'dark' } });
  await answerSome(page);
  await page.locator('[data-reviewer]').fill('</script><img src=x onerror=1>');
  await settle(page);
  const saved = await saveHtml(page);
  assert.ok(!/<html[^>]*data-theme="/.test(saved.html), 'the reader\'s own theme choice is not baked in');
  assert.match(saved.html, /<p class="plan-flag" data-plan-unsaved(="")? hidden(="")?>/);
  assert.match(saved.html, /<p class="plan-flag" data-plan-stale(="")? hidden(="")?>/);
  assert.match(saved.html, /data-plan-status(="")? role="status"><\/p>/);
  assert.match(saved.html, /data-plan-save-status(="")? role="status"><\/p>/);
  assert.equal(JSON.parse(saved.html.match(SAVED_SLOT)[1]).export.reviewer, '</script><img src=x onerror=1>');
  assert.ok(!SAVED_SLOT.exec(saved.html)[1].includes('<'), 'every < in the slot is escaped');
  const again = await openPage(asPage(saved, 'hostile.html'));
  assert.equal((await exported(again.page)).reviewer, '</script><img src=x onerror=1>');
  assert.deepEqual(again.problems, []);
  await again.context.close();
  await context.close();
});

test('Save as HTML works with storage blocked (the saved file is the only copy)', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, context, problems } = await openPage(built().url, { blockStorage: true });
  await answerSome(page);
  const saved = await saveHtml(page);
  assert.equal(JSON.parse(saved.html.match(SAVED_SLOT)[1]).export.verdict, 'approve');
  assert.deepEqual(problems, []);
  await context.close();
});

test('the Save button stays in view while the page scrolls, on a wide screen and a phone', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  for (const [width, height] of [[1280, 800], [390, 800]]) {
    const { page, context } = await openPage(built().url, { width, height });
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(150);
    const button = page.locator('[data-plan-save-html]');
    assert.ok(await button.isVisible(), `${width}px: visible`);
    const box = await button.boundingBox();
    assert.ok(box.y >= 0 && box.y + box.height <= height, `${width}px: inside the viewport at the end of the page (y=${box.y})`);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight / 2));
    await page.waitForTimeout(150);
    const mid = await button.boundingBox();
    assert.ok(mid.y >= 0 && mid.y + mid.height <= height, `${width}px: inside the viewport mid-page (y=${mid.y})`);
    await context.close();
  }
});
