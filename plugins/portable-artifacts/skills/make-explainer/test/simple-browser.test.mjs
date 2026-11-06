// Simple English in a real browser (template/simple.js, scripts/lib/simple-view.mjs): the toggle, both copies of a
// section's text, the saved choice, print and no-JS, a deck, and a plan page. The spec data is inline so every
// assertion names the text it expects.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildSpec, haveBrowser, openPage as openFile, openServed as openPage, closeSharedBrowser } from './helpers/browser.mjs';
import { checkPage } from '../scripts/check.mjs';

after(closeSharedBrowser);

const skipUnlessBrowser = async (t) => {
  if (await haveBrowser()) return false;
  t.skip('no browser (bundled Chromium or system Chrome)');
  return true;
};

const TOGGLE = '[data-simple-toggle]';
const STORE = 'pa-simple';

// Text a reader sees in the hero card and the sections, not the contents list (innerText leaves out what is not displayed).
const seen = (page, selector = '.hero, main') => page.evaluate((s) => [...document.querySelectorAll(s)].map((e) => e.innerText).join('\n'), selector);
const toggled = (page) => page.click(TOGGLE);

const SECTIONS = [
  {
    type: 'tldr', id: 'verdict', title: 'Normal verdict heading', label: 'The verdict',
    text: 'Normal lead sentence.', points: ['Normal point one.', 'Normal point two.'], tone: 'good',
    simple: { title: 'Simple verdict heading', text: 'Simple lead sentence.', points: ['Simple point one.'] },
  },
  {
    type: 'text', id: 'why', title: 'Normal why heading', text: 'Normal why body.',
    simple: { title: 'Simple why heading', text: 'Simple why body.' },
  },
  {
    type: 'cards', id: 'parts', title: 'Normal parts heading',
    items: [{ title: 'Card one', text: 'Normal card one text.', icon: 'lucide:database' }, { title: 'Card two', text: 'Normal card two text.' }],
    simple: { items: [{ text: 'Simple card one text.' }] },
  },
  {
    type: 'steps', id: 'how', title: 'Normal how heading',
    items: [{ title: 'Run the build', text: 'Normal step text.' }],
    simple: { items: [{ title: 'Start the build', text: 'Simple step text.' }] },
  },
  {
    type: 'risks', id: 'risks', title: 'Normal risks heading',
    items: [{ risk: 'Normal risk text.', severity: 'low', mitigation: 'Normal risk fix.' }],
    simple: { items: [{ risk: 'Simple risk text.', mitigation: 'Simple risk fix.' }] },
  },
  {
    type: 'timeline', id: 'when', title: 'Normal timeline heading',
    items: [{ date: '2026-11-06', title: 'Normal timeline text', text: 'Normal timeline note.' }],
    simple: { items: [{ title: 'Simple timeline text', text: 'Simple timeline note.' }] },
  },
  {
    type: 'compare', id: 'options', title: 'Normal compare heading',
    columns: [{ title: 'Left', points: ['Normal compare text.'] }, { title: 'Right', points: ['Right point.'] }],
    verdict: 'Normal compare verdict.',
    simple: { columns: [{ points: ['Simple compare text.'] }], verdict: 'Simple compare verdict.' },
  },
  {
    type: 'callout', id: 'note', tone: 'info', title: 'Normal callout heading', text: 'Normal callout text.',
    simple: { title: 'Simple callout heading', text: 'Simple callout text.' },
  },
  {
    type: 'details', id: 'more', title: 'Normal details heading', summary: 'Normal details summary', text: 'Normal details text.',
    simple: { summary: 'Simple details summary', text: 'Simple details text.' },
  },
  {
    type: 'table', id: 'grid', title: 'Normal table heading', columns: ['Name', 'Time'], rows: [['Normal table text', 12]],
    simple: { columns: ['Name', 'Time taken'], rows: [['Simple table text', 12]] },
  },
  { type: 'code', id: 'cmd', title: 'Commands stay exact', code: 'npm run build' },
];
const ELIGIBLE_TYPES = ['tldr', 'text', 'cards', 'risks', 'steps', 'timeline', 'compare', 'callout', 'details', 'table'];
// One sentence of body text that each eligible section shows in the normal view, and the one it shows in the simple view.
const MARKERS = {
  tldr: ['Normal lead sentence.', 'Simple lead sentence.'],
  text: ['Normal why body.', 'Simple why body.'],
  cards: ['Normal card one text.', 'Simple card one text.'],
  risks: ['Normal risk text.', 'Simple risk text.'],
  steps: ['Normal step text.', 'Simple step text.'],
  timeline: ['Normal timeline text', 'Simple timeline text'],
  compare: ['Normal compare text.', 'Simple compare text.'],
  callout: ['Normal callout text.', 'Simple callout text.'],
  details: ['Normal details summary', 'Simple details summary'], // a closed block shows only its summary
  table: ['Normal table text', 'Simple table text'],
};
const recap = (extra = {}) => ({ title: 'Simple English recap', subtitle: 'A page with two versions of its text', preset: 'recap', sections: SECTIONS, ...extra });

const withoutSimple = (sections) => sections.map(({ simple, ...rest }) => rest);

// ---- markup (no browser) --------------------------------------------------

test('a spec with no simple text ships no toggle, no second copy and no simple script', () => {
  const { html } = buildSpec(recap({ sections: withoutSimple(SECTIONS) }));
  for (const needle of ['data-simple-toggle', 'data-text=', 'pa-simple', '__paSimple', 'simple-toggle']) {
    assert.equal(html.includes(needle), false, needle);
  }
});

test('a section with simple holds its body twice, and every id on the page is unique', () => {
  const { html } = buildSpec(recap());
  assert.equal(SECTIONS.filter((s) => s.simple).length, ELIGIBLE_TYPES.length, 'the fixture covers all ten eligible types');
  assert.equal(html.match(/<div data-text="normal">/g).length, ELIGIBLE_TYPES.length, 'one pair for each section with simple text');
  assert.equal(html.match(/<div data-text="simple" hidden>/g).length, ELIGIBLE_TYPES.length);
  assert.ok(html.includes('<svg'), 'the card icon is drawn');
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids.filter((id, i) => ids.indexOf(id) !== i), []);
});

test('an empty simple object does not make a pair, and a page of only empty simple objects has no toggle', () => {
  const { html } = buildSpec(recap({ sections: SECTIONS.map((s) => (s.type === 'code' ? s : { ...s, simple: {} })) }));
  assert.equal(html.includes('data-simple-toggle'), false);
  assert.equal(html.includes('data-text='), false);
});

// ---- the toggle -----------------------------------------------------------

test('the page opens with normal text, and the toggle reads Simple English and is not pressed', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(buildSpec(recap()).url);
  assert.equal((await page.locator(TOGGLE).textContent()).trim(), 'Simple English');
  assert.equal(await page.locator(TOGGLE).getAttribute('aria-pressed'), 'false');
  const text = await seen(page);
  for (const normal of ['Normal verdict heading', 'Normal lead sentence.', 'Normal why body.', 'Normal card one text.', 'Normal step text.']) assert.ok(text.includes(normal), normal);
  for (const simple of ['Simple verdict heading', 'Simple lead sentence.', 'Simple why body.', 'Simple card one text.', 'Simple step text.']) assert.ok(!text.includes(simple), simple);
  assert.deepEqual(problems, []);
  await context.close();
});

test('clicking shows simple text and hides normal text; clicking again restores it', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(buildSpec(recap()).url);
  const before = await seen(page);
  await toggled(page);
  assert.equal(await page.locator(TOGGLE).getAttribute('aria-pressed'), 'true');
  const text = await seen(page);
  for (const simple of ['Simple verdict heading', 'Simple lead sentence.', 'Simple why heading', 'Simple why body.', 'Simple card one text.', 'Simple step text.', 'Start the build']) assert.ok(text.includes(simple), simple);
  for (const normal of ['Normal verdict heading', 'Normal lead sentence.', 'Normal why heading', 'Normal why body.', 'Normal card one text.', 'Normal step text.', 'Run the build']) assert.ok(!text.includes(normal), normal);
  await toggled(page);
  assert.equal(await page.locator(TOGGLE).getAttribute('aria-pressed'), 'false');
  assert.equal(await seen(page), before);
  assert.deepEqual(problems, []);
  await context.close();
});

test('all ten eligible types switch: each shows its normal sentence first, its simple one after, and no id repeats in the DOM', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(buildSpec(recap()).url);
  const ids = () => page.evaluate(() => [...document.querySelectorAll('[id]')].map((e) => e.id));
  const repeated = (list) => list.filter((id, i) => list.indexOf(id) !== i);
  const normal = await seen(page);
  for (const type of ELIGIBLE_TYPES) {
    assert.ok(normal.includes(MARKERS[type][0]) && !normal.includes(MARKERS[type][1]), `${type} opens on normal text`);
  }
  assert.deepEqual(repeated(await ids()), []);
  await toggled(page);
  const simple = await seen(page);
  for (const type of ELIGIBLE_TYPES) {
    assert.ok(simple.includes(MARKERS[type][1]) && !simple.includes(MARKERS[type][0]), `${type} shows simple text`);
  }
  assert.deepEqual(repeated(await ids()), []);
  assert.ok(simple.includes('npm run build'), 'code stays');
  assert.deepEqual(problems, []);
  await context.close();
});

test('a details block keeps its open state across the toggle, in both directions', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, context } = await openPage(buildSpec(recap()).url);
  const state = () => page.evaluate(() => ({
    normal: document.querySelector('#more [data-text="normal"] details').open,
    simple: document.querySelector('#more [data-text="simple"] details').open,
  }));
  assert.deepEqual(await state(), { normal: false, simple: false });
  await page.click('#more [data-text="normal"] summary');
  assert.deepEqual(await state(), { normal: true, simple: false });
  await toggled(page);
  assert.equal((await state()).simple, true, 'opened in the normal view, open in the simple view');
  assert.ok((await seen(page)).includes('Simple details text.'), 'and its text is showing');
  await page.click('#more [data-text="simple"] summary');
  await toggled(page);
  assert.equal((await state()).normal, false, 'closed in the simple view, closed again in the normal view');
  await context.close();
});

test('a field left out of simple shows its normal text in the simple view; code and the contents do not change', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, context } = await openPage(buildSpec(recap()).url);
  const contents = () => page.locator('.toc a').allTextContents();
  const labelsBefore = await contents();
  await toggled(page);
  const text = await seen(page);
  assert.ok(text.includes('Card one') && text.includes('Card two'), 'card titles were left out of simple');
  assert.ok(text.includes('Normal card two text.'), 'the second card has no simple entry');
  assert.ok(text.includes('Normal point one.') === false && text.includes('Simple point one.') && text.includes('Normal point two.'), 'simple has one point; the second keeps its normal text');
  assert.ok(text.includes('npm run build'));
  assert.deepEqual(await contents(), labelsBefore, 'contents labels keep the normal titles');
  assert.ok(labelsBefore.includes('Normal why heading'));
  await context.close();
});

test('contents links and section ids are the same in both views, and no id is duplicated', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, context } = await openPage(buildSpec(recap()).url);
  const snapshot = () => page.evaluate(() => ({
    ids: [...document.querySelectorAll('[id]')].map((e) => e.id),
    sections: [...document.querySelectorAll('section.sec, .hero-tldr')].map((e) => e.id),
    links: [...document.querySelectorAll('.toc a')].map((a) => a.getAttribute('href')),
    names: [...document.querySelectorAll('section.sec, .hero-tldr')].map((e) => e.getAttribute('aria-labelledby')),
    heads: [...document.querySelectorAll('.sec-title, .hero-tldr-title')].map((e) => e.id),
  }));
  const normal = await snapshot();
  await toggled(page);
  const simple = await snapshot();
  assert.deepEqual(simple, normal);
  assert.equal(new Set(simple.ids).size, simple.ids.length, 'no id appears twice');
  for (const href of simple.links) assert.ok(simple.sections.includes(href.slice(1)), href);
  const named = await page.evaluate(() => [...document.querySelectorAll('[aria-labelledby]')].map((e) => document.getElementById(e.getAttribute('aria-labelledby')).innerText.replace(/#$/, '').trim()));
  assert.ok(named.includes('Simple why heading'), 'a section is named after the heading that shows');
  await context.close();
});

// ---- remembering ----------------------------------------------------------

test('the choice survives a reload, and switching back is remembered too', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(buildSpec(recap()).url);
  await toggled(page);
  assert.equal(await page.evaluate((k) => localStorage.getItem(k), STORE), 'on');
  await page.reload();
  await page.waitForFunction(() => window.paReady === true);
  assert.equal(await page.locator(TOGGLE).getAttribute('aria-pressed'), 'true');
  assert.ok((await seen(page)).includes('Simple why body.'));
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-simple')), 'on');
  await toggled(page);
  await page.reload();
  await page.waitForFunction(() => window.paReady === true);
  assert.equal(await page.locator(TOGGLE).getAttribute('aria-pressed'), 'false');
  assert.ok((await seen(page)).includes('Normal why body.'));
  assert.deepEqual(problems, []);
  await context.close();
});

test('the saved choice is applied before first paint: the script sits in the head, and a stored "on" opens on simple text', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const built = buildSpec(recap());
  assert.ok(built.html.indexOf('__paSimple') > 0 && built.html.indexOf('__paSimple') < built.html.indexOf('<body'), 'the script runs before the body is parsed');
  assert.ok(built.html.indexOf('data-simple="on"] [data-text') > 0 && built.html.indexOf('data-simple="on"] [data-text') < built.html.indexOf('<body'), 'and so does the stylesheet it relies on');
  const { page, context } = await openPage(built.url, { seed: { [STORE]: 'on' } });
  assert.equal(await page.locator(TOGGLE).getAttribute('aria-pressed'), 'true');
  assert.ok((await seen(page)).includes('Simple why body.'));
  await context.close();
});

test('a blocked localStorage does not throw: the page opens on normal text and the toggle still works', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openFile(buildSpec(recap()).url, { blockStorage: true });
  assert.ok((await seen(page)).includes('Normal why body.'));
  await toggled(page);
  assert.ok((await seen(page)).includes('Simple why body.'));
  await toggled(page);
  assert.ok((await seen(page)).includes('Normal why body.'));
  assert.deepEqual(problems, []);
  await context.close();
});

// ---- no simple text -------------------------------------------------------

test('no toggle appears on a page with no simple text', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(buildSpec(recap({ sections: withoutSimple(SECTIONS) })).url);
  assert.equal(await page.locator(TOGGLE).count(), 0);
  assert.equal(await page.locator('[data-theme-toggle]').count(), 1, 'the theme toggle is still there');
  assert.deepEqual(problems, []);
  await context.close();
});

// ---- keyboard -------------------------------------------------------------

test('the toggle is reachable by Tab, carries aria-pressed, and Space and Enter switch it', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, context } = await openPage(buildSpec(recap()).url);
  let reached = false;
  for (let i = 0; i < 12 && !reached; i++) {
    await page.keyboard.press('Tab');
    reached = await page.evaluate(() => document.activeElement?.hasAttribute('data-simple-toggle'));
  }
  assert.equal(reached, true, 'Tab reaches the toggle');
  assert.equal(await page.evaluate(() => document.activeElement.tagName), 'BUTTON');
  await page.keyboard.press('Space');
  assert.equal(await page.locator(TOGGLE).getAttribute('aria-pressed'), 'true');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator(TOGGLE).getAttribute('aria-pressed'), 'false');
  await context.close();
});

// ---- print and no script --------------------------------------------------

test('print shows normal text only, even after the reader chose simple', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, context } = await openPage(buildSpec(recap()).url);
  await toggled(page);
  await page.emulateMedia({ media: 'print' });
  const text = await seen(page);
  assert.ok(text.includes('Normal why body.') && text.includes('Normal why heading') && text.includes('Normal verdict heading'));
  assert.ok(!text.includes('Simple why body.') && !text.includes('Simple why heading') && !text.includes('Simple lead sentence.'));
  assert.equal(await page.locator(TOGGLE).isVisible(), false, 'the toggle is not printed');
  await context.close();
});

test('with JavaScript off, the page shows normal text only', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, context } = await openFile(buildSpec(recap()).url, { javaScript: false });
  const text = await seen(page);
  assert.ok(text.includes('Normal why body.') && text.includes('Normal why heading'));
  assert.ok(!text.includes('Simple why body.') && !text.includes('Simple why heading'));
  await context.close();
});

// ---- a deck ---------------------------------------------------------------

const DECK = {
  title: 'Simple English deck', subtitle: 'Two versions of a slide', preset: 'slides',
  sections: [
    { type: 'tldr', title: 'Normal deck verdict', text: 'Normal deck lead.', points: ['Normal deck point.'], simple: { title: 'Simple deck verdict', text: 'Simple deck lead.' } },
    { type: 'text', title: 'Normal slide heading', text: 'Normal slide body.', simple: { title: 'Simple slide heading', text: 'Simple slide body.' } },
    { type: 'steps', title: 'Normal slide steps', items: [{ title: 'Run it', text: 'Normal slide step.' }], simple: { items: [{ text: 'Simple slide step.' }] } },
  ],
};

test('a deck switches text on the current slide, and the slide count is unchanged', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(buildSpec(DECK, { name: 'deck' }).url);
  const count = () => page.locator('section.slide').count();
  const slides = await count();
  assert.equal(await page.locator(TOGGLE).count(), 1);
  assert.equal(await page.evaluate(() => document.querySelector('.deck-bar [data-simple-toggle]') !== null), true, 'the toggle sits in the deck bar');
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('[data-deck]').dataset.current === '2');
  assert.ok((await seen(page, '#slide-2')).includes('Normal deck lead.'));
  await toggled(page);
  assert.ok((await seen(page, '#slide-2')).includes('Simple deck lead.'));
  assert.ok(!(await seen(page, '#slide-2')).includes('Normal deck lead.'));
  assert.equal(await page.evaluate(() => document.querySelector('[data-deck]').dataset.current), '2', 'the toggle does not move the deck');
  assert.match(await page.locator('#slide-2').getAttribute('aria-label'), /Slide 2 of 4: Simple deck verdict/);
  assert.equal(await count(), slides);
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('[data-deck]').dataset.current === '3');
  assert.ok((await seen(page, '#slide-3')).includes('Simple slide body.'));
  assert.equal(await page.locator('#slide-3 .slide-title').getAttribute('id'), 'slide-3-title');
  await toggled(page);
  assert.ok((await seen(page, '#slide-3')).includes('Normal slide body.'));
  assert.match(await page.locator('#slide-3').getAttribute('aria-label'), /Slide 3 of 4: Normal slide heading/);
  assert.equal(await count(), slides);
  const outline = await page.locator('[data-outline] a').allTextContents();
  assert.ok(outline.includes('Normal slide heading') && !outline.some((label) => /Simple (deck|slide)/.test(label)), 'the outline keeps the normal titles');
  assert.deepEqual(problems, []);
  await context.close();
});

test('at 320 px the deck bar holds its controls inside the screen, without overlap, in both views', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  for (const on of [false, true]) {
    const { page, problems, context } = await openPage(buildSpec(DECK, { name: 'deck320' }).url, { width: 320, height: 640, seed: { [STORE]: on ? 'on' : 'off' } });
    const boxes = await page.evaluate(() => [...document.querySelectorAll('.deck-controls > *')].map((el) => {
      const r = el.getBoundingClientRect();
      return { what: el.className || el.tagName, left: r.left, right: r.right, top: r.top, bottom: r.bottom, visible: r.width > 0 };
    }));
    assert.ok(boxes.length >= 4, 'Outline, theme, Simple English and the counter');
    for (const b of boxes) assert.ok(b.right <= 320 + 0.5 && b.left >= -0.5, `${b.what} inside 320 px (${b.left}..${b.right}) simple=${on}`);
    for (let i = 1; i < boxes.length; i++) {
      const a = boxes[i - 1];
      const b = boxes[i];
      const sameRow = b.top < a.bottom - 1 && a.top < b.bottom - 1;
      assert.ok(!sameRow || b.left >= a.right - 0.5, `${a.what} and ${b.what} do not overlap simple=${on}`);
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    assert.deepEqual(problems, []);
    await context.close();
  }
});

// ---- a plan page ----------------------------------------------------------

const PLAN = {
  title: 'Simple English plan', key: 'plan-simple-test', preset: 'plan',
  sections: [
    { type: 'tldr', title: 'Normal plan verdict', text: 'Normal plan lead.', simple: { text: 'Simple plan lead.' } },
    {
      type: 'decision', id: 'store', title: 'Where answers live', question: 'Where do answers live?',
      options: [{ label: 'In the browser' }, { label: 'On a server' }], recommended: 'In the browser', why: 'It needs no server.',
    },
    { type: 'verdict', text: 'Ship it?' },
  ],
};

test('a plan page: an answer given before toggling is still there after, and the export is unchanged', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(buildSpec(PLAN, { name: 'plan' }).url);
  await page.locator('input[name="plan-store"]').evaluateAll((els) => els.find((e) => e.value === 'On a server').click());
  const exported = () => page.evaluate(() => window.PA.planExport());
  const before = await exported();
  assert.equal(before.answers[0].choice, 'On a server');
  await toggled(page);
  assert.ok((await seen(page)).includes('Simple plan lead.'));
  assert.equal(await page.locator('input[name="plan-store"][value="On a server"]').isChecked(), true);
  assert.deepEqual(await exported(), before);
  await toggled(page);
  assert.deepEqual(await exported(), before);
  assert.deepEqual(problems, []);
  await context.close();
});

test('a plan page saved while Simple English is on does not keep that view: the copy opens on normal text, even with JavaScript off', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const built = buildSpec(PLAN, { name: 'plan-save' });
  const { page, context } = await openPage(built.url);
  await toggled(page);
  assert.ok((await seen(page)).includes('Simple plan lead.'));
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-plan-save-html]').click()]);
  const html = fs.readFileSync(await download.path(), 'utf8');
  assert.equal(/<html[^>]*data-simple/.test(html), false, 'no root state in the saved copy');
  assert.equal(/<(div|span) data-text="normal"[^>]*hidden/.test(html), false, 'the normal copy is not hidden');
  assert.match(html, /<div data-text="simple" hidden(="")?>/, 'the simple copy is hidden');
  assert.match(html, /data-simple-toggle[^>]*aria-pressed="false"/, 'the toggle starts unpressed');
  assert.equal(await seen(page).then((s) => s.includes('Simple plan lead.')), true, 'the live page is still on simple text');
  const saved = path.join(path.dirname(built.file), 'saved.html');
  fs.writeFileSync(saved, html);
  const off = await openFile(pathToFileURL(saved).href, { javaScript: false });
  const text = await seen(off.page);
  assert.ok(text.includes('Normal plan lead.') && !text.includes('Simple plan lead.'));
  await off.context.close();
  await context.close();
});

// ---- whole-page checks ----------------------------------------------------

test('a built recap and deck with simple text pass scripts/check.mjs', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  for (const spec of [recap(), DECK]) {
    const result = await checkPage(buildSpec(spec, { name: 'check' }).file);
    assert.deepEqual(result.problems, []);
    assert.equal(result.status, 'ok');
  }
});

// A number-plus-unit token is kept on one line, so one this long cannot wrap and spills out of its slide.
const OVERSIZED = 'It took 12345678901234567890123456789012345678901234567890123456789012345678901234567890 ms in total.';
const wideDeck = ({ normal = 'Short normal text.', simple = 'Short simple text.', withSimple = true } = {}) => ({
  title: 'Wide text deck', preset: 'slides',
  sections: [{ type: 'text', title: 'One claim', text: normal, ...(withSimple ? { simple: { text: simple } } : {}) }],
});

test('guardrail: check.mjs fails a deck whose oversized text is only in the simple view, and says so', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const result = await checkPage(buildSpec(wideDeck({ simple: OVERSIZED }), { name: 'wide-simple' }).file);
  assert.equal(result.status, 'failed');
  assert.ok(result.problems.length > 0);
  assert.ok(result.problems.every((p) => p.includes('(simple)')), result.problems.join('\n'));
  assert.ok(result.problems.some((p) => /clipped by the slide/.test(p)));
});

test('guardrail: the same text only in the normal view fails once, in the normal pass, and the simple pass adds nothing', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const result = await checkPage(buildSpec(wideDeck({ normal: OVERSIZED }), { name: 'wide-normal' }).file);
  assert.equal(result.status, 'failed');
  assert.ok(result.problems.every((p) => !p.includes('(simple)')), result.problems.join('\n'));
  const alone = await checkPage(buildSpec(wideDeck({ normal: OVERSIZED, withSimple: false }), { name: 'wide-none' }).file);
  assert.deepEqual(result.problems, alone.problems, 'a page with no simple text reports the same problems, from one pass');
});

test('in the simple view nothing scrolls sideways on a phone or a desktop', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  for (const spec of [recap(), DECK]) {
    const { url } = buildSpec(spec, { name: 'wide' });
    for (const width of [1280, 390]) {
      const { page, problems, context } = await openPage(url, { width, height: 800, seed: { [STORE]: 'on' } });
      assert.equal(await page.locator(TOGGLE).getAttribute('aria-pressed'), 'true');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, `${spec.title} at ${width}`);
      assert.deepEqual(problems, []);
      await context.close();
    }
  }
});
