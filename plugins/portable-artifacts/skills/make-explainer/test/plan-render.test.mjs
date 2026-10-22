// Plan mode, rendering: the markup contract the answer runtime (template/plan.js) reads, escaping of every
// spec string, the read-only deck form, and what buildPage adds to a page that has plan items.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SECTIONS } from '../scripts/lib/sections.mjs';
import { buildPage } from '../scripts/lib/page.mjs';
import { loadTheme } from '../shared/theme.mjs';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const OUT = path.join(FIXTURES, '..', '.unused', 'plan.html');
const PLAN_CSS = fs.readFileSync(new URL('../template/plan.css', import.meta.url), 'utf8');
const PLAN_JS = fs.readFileSync(new URL('../template/plan.js', import.meta.url), 'utf8');
const pageCtx = { dir: FIXTURES, icons: null, theme: loadTheme('mono'), mode: 'page', slug: 'plan', idFor: () => 'sec' };
const slidesCtx = { ...pageCtx, mode: 'slides' };

const HOSTILE = '<img src=x onerror=x>"\'</script>';
const HOSTILE_ESC = '&lt;img src=x onerror=x&gt;&quot;&#39;&lt;/script&gt;';

const decision = (patch = {}) => ({
  type: 'decision',
  id: 'storage',
  question: 'Where do answers live?',
  options: [
    { label: 'Browser storage', pros: ['No server', 'Works offline'], cons: ['One device only'] },
    { label: 'A save server', pros: ['Shared'], cons: ['Something to run'] },
    { label: 'Both' },
  ],
  recommended: 'Browser storage',
  why: 'Nothing to deploy; the export file carries the answers back.',
  ...patch,
});
const approval = (patch = {}) => ({ type: 'approval', id: 'themes', item: 'Ship the two plan themes', why: 'They pass the contrast checks.', impact: 'Every skill can use them', owner: 'Design', ...patch });
const question = (patch = {}) => ({ type: 'question', id: 'owner', text: 'Who owns the rollout?', default: 'The author owns it', ...patch });
const verdict = (patch = {}) => ({ type: 'verdict', text: 'Approve the plan as a whole.', ...patch });
const review = (patch = {}) => ({ type: 'review', items: [{ point: 'The storage choice', why: 'It decides the export.', target: 'storage' }, { point: 'Theme contrast', why: 'Checked by script only.' }], ...patch });

const render = (section, ctx = pageCtx) => SECTIONS[section.type].render(section, ctx);
const radios = (html) => [...html.matchAll(/<input type="radio"([^>]*)>/g)].map((m) => m[1]);
const attr = (s, name) => s.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];

// ---- decision -------------------------------------------------------------------------------------

test('decision: a plan-item container carries the id, the kind and the escaped question', () => {
  const html = render(decision({ question: 'Pick "one" <b>now</b>' }));
  assert.match(html, /^<div class="plan-item plan-decision" data-plan-item data-id="storage" data-kind="decision" data-question="Pick &quot;one&quot; &lt;b&gt;now&lt;\/b&gt;" data-default="">/);
});

test('decision and question carry data-default: escaped when set, empty when not; approval has none', () => {
  assert.match(render(decision({ default: 'A save server' })), /^<div [^>]*data-default="A save server">/);
  assert.match(render(decision({ options: [{ label: HOSTILE }, { label: 'B' }], recommended: 'B', default: HOSTILE })), new RegExp(`^<div [^>]*data-default="${HOSTILE_ESC}">`));
  assert.match(render(question({ default: HOSTILE })), new RegExp(`^<div [^>]*data-default="${HOSTILE_ESC}">`));
  assert.match(render(question({ default: undefined })), /^<div [^>]*data-default="">/);
  assert.ok(!/^<div [^>]*data-default/.test(render(approval())));
  assert.ok(!/^<div [^>]*data-default/.test(render(verdict())));
});

test('decision: every option is a radio named after the id, its value the label; only the recommended one is marked', () => {
  const html = render(decision());
  const r = radios(html);
  assert.equal(r.length, 3);
  assert.deepEqual(r.map((a) => attr(a, 'name')), ['plan-storage', 'plan-storage', 'plan-storage']);
  assert.deepEqual(r.map((a) => attr(a, 'value')), ['Browser storage', 'A save server', 'Both']);
  assert.deepEqual(r.map((a) => attr(a, 'data-recommended')), ['true', 'false', 'false']);
  assert.equal((html.match(/>Recommended</g) ?? []).length, 1, 'one Recommended chip');
  assert.match(html, /<span class="chip tone-accent">[^]*?<span>Recommended<\/span><\/span>/);
});

test('decision: the why sits in an open <details>, pros and cons are listed with a glyph and a word for screen readers', () => {
  const html = render(decision());
  assert.match(html, /<details class="plan-why" open>\s*<summary>[^]*?<\/summary>[^]*?Nothing to deploy/);
  assert.match(html, /<li class="plan-pro">[^]*?<span><span class="sr-only">Pro: <\/span>No server<\/span><\/li>/);
  assert.match(html, /<li class="plan-con">[^]*?<span><span class="sr-only">Con: <\/span>One device only<\/span><\/li>/);
});

test('decision: a radio is named by its label (and the Recommended chip) and described by its pros and cons', () => {
  const html = render(decision());
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const [first, second, third] = radios(html);
  assert.equal(attr(first, 'aria-labelledby'), 'pl_storage_1_label pl_storage_1_rec');
  assert.equal(attr(first, 'aria-describedby'), 'pl_storage_1_pc');
  assert.equal(attr(second, 'aria-labelledby'), 'pl_storage_2_label');
  assert.equal(attr(third, 'aria-describedby'), undefined, 'no pros or cons, no description');
  for (const ref of ['pl_storage_1_label', 'pl_storage_1_rec', 'pl_storage_1_pc', 'pl_storage_2_label']) assert.ok(ids.has(ref), ref);
  assert.match(html, /<span class="plan-opt-label" id="pl_storage_1_label">Browser storage<\/span>/);
});

test('comment boxes name their item for screen readers', () => {
  assert.match(render(decision()), /Comment or override \(optional\)<span class="sr-only">: Where do answers live\?<\/span>/);
  assert.match(render(approval()), /Comment \(optional\)<span class="sr-only">: Ship the two plan themes<\/span>/);
  assert.ok(!render(approval({ item: HOSTILE })).includes('<img'));
});

test('decision: the default is stated when set, and a comment box takes an override', () => {
  assert.match(render(decision({ default: 'A save server' })), /If nobody answers[^]*?A save server/);
  assert.ok(!render(decision()).includes('If nobody answers'));
  assert.match(render(decision()), /<textarea[^>]*data-comment[^>]*><\/textarea>/);
});

test('decision: a hostile label, question, why, pro and default appear only escaped', () => {
  const html = render(decision({
    question: HOSTILE,
    options: [{ label: HOSTILE, pros: [HOSTILE], cons: [HOSTILE] }, { label: 'B' }],
    recommended: HOSTILE,
    default: HOSTILE,
    why: HOSTILE,
  }));
  assert.ok(!html.includes('<img'), html);
  assert.ok(!html.includes('</script>'), html);
  assert.ok(!html.includes('"\''), 'no raw quote pair');
  assert.equal(attr(radios(html)[0], 'value'), HOSTILE_ESC);
  assert.ok(html.split(HOSTILE_ESC).length - 1 >= 7, 'question attr, legend, value, label, pro, con, why, default all escaped');
});

test('decision: numbers with units in an option stay bound (nowrap span), inside one text span in a flex row', () => {
  const html = render(decision({ options: [{ label: 'Cut p95 by 120 ms', pros: ['Saves 87% of it'] }, { label: 'Leave it' }], recommended: 'Leave it' }));
  assert.match(html, /<span class="nw">120 ms<\/span>/);
  // Regression: bare text beside the nowrap span became separate flex items with a gap ("Saves  87%  of it").
  assert.match(html, /<li class="plan-pro"><svg[^]*?<\/svg><span><span class="sr-only">Pro: <\/span>Saves <span class="nw">87%<\/span> of it<\/span><\/li>/);
});

test('a very long label is inert and complete', () => {
  const long = `${'x'.repeat(5000)}<i>`;
  const html = render(decision({ options: [{ label: long }, { label: 'B' }], recommended: 'B' }));
  assert.equal(attr(radios(html)[0], 'value'), `${'x'.repeat(5000)}&lt;i&gt;`);
  assert.ok(!html.includes('<i>'));
});

// ---- approval, question ---------------------------------------------------------------------------

test('approval: three radios approve | changes | reject, a comment box, impact and owner shown', () => {
  const html = render(approval());
  assert.match(html, /^<div class="plan-item plan-approval" data-plan-item data-id="themes" data-kind="approval" data-question="Ship the two plan themes">/);
  const r = radios(html);
  assert.deepEqual(r.map((a) => attr(a, 'value')), ['approve', 'changes', 'reject']);
  assert.deepEqual(r.map((a) => attr(a, 'name')), ['plan-themes', 'plan-themes', 'plan-themes']);
  for (const word of ['Approve', 'Needs changes', 'Reject']) assert.ok(html.includes(`<span>${word}</span>`), word);
  assert.match(html, /<textarea[^>]*data-comment/);
  assert.match(html, /Impact<\/dt><dd>Every skill can use them<\/dd>/);
  assert.match(html, /Owner<\/dt><dd>Design<\/dd>/);
});

test('approval: hostile item, why, impact and owner appear only escaped', () => {
  const html = render(approval({ item: HOSTILE, why: HOSTILE, impact: HOSTILE, owner: HOSTILE }));
  assert.ok(!html.includes('<img') && !html.includes('</script>'), html);
  assert.ok(html.split(HOSTILE_ESC).length - 1 >= 5);
});

test('question: a free-text answer box named by the question, the default stated', () => {
  const html = render(question());
  assert.match(html, /^<div class="plan-item plan-question" data-plan-item data-id="owner" data-kind="question" data-question="Who owns the rollout\?" data-default="The author owns it">/);
  assert.match(html, /<textarea[^>]*data-answer[^>]*aria-label="Answer: Who owns the rollout\?"[^>]*><\/textarea>/);
  assert.match(html, /blank answer[^]*?The author owns it/i);
  assert.equal(radios(html).length, 0);
});

test('question: hostile text and default appear only escaped', () => {
  const html = render(question({ text: HOSTILE, default: HOSTILE }));
  assert.ok(!html.includes('<img') && !html.includes('</script>'), html);
});

// ---- verdict, review ------------------------------------------------------------------------------

test('verdict: three radios approve | approve-with-changes | not-yet, a reviewer name input and the export controls', () => {
  const html = render(verdict());
  assert.match(html, /^<div class="plan-item plan-verdict" data-plan-item data-kind="verdict" data-question="Overall verdict">/);
  const r = radios(html);
  assert.deepEqual(r.map((a) => attr(a, 'value')), ['approve', 'approve-with-changes', 'not-yet']);
  assert.deepEqual(r.map((a) => attr(a, 'name')), ['plan-verdict', 'plan-verdict', 'plan-verdict']);
  assert.match(html, /<input type="text"[^>]*data-reviewer/);
  assert.match(html, /<button type="button" class="btn plan-btn" data-plan-copy>Copy answers<\/button>/);
  assert.match(html, /<button type="button" class="btn plan-btn" data-plan-download>Download plan-answers\.json<\/button>/);
  assert.match(html, /data-plan-status/);
  assert.match(html, /data-plan-unsaved hidden/);
  assert.match(html, /data-plan-stale hidden/);
});

test('verdict: no data-id even with an explicit id (the runtime keys it by data-kind); hostile text is escaped', () => {
  const html = render(verdict({ id: 'overall', text: HOSTILE }));
  assert.ok(!html.includes('data-id'), html);
  assert.ok(!html.includes('<img') && !html.includes('</script>'), html);
});

test('review: an ordered list whose targets are in-page links, named by the target title when known', () => {
  const html = render(review(), { ...pageCtx, targets: new Map([['storage', 'Where answers live']]) });
  assert.match(html, /^<ol class="plan-review">/);
  assert.match(html, /<a class="plan-review-go" href="#storage">[^]*?Where answers live[^]*?<\/a>/);
  assert.equal((html.match(/<li/g) ?? []).length, 2);
  assert.equal((html.match(/<a /g) ?? []).length, 1, 'an item without a target has no link');
  assert.match(render(review()), /href="#storage">[^]*?storage[^]*?<\/a>/, 'falls back to the id');
});

test('review: hostile point, why and target are escaped', () => {
  const html = render(review({ items: [{ point: HOSTILE, why: HOSTILE, target: '"><script>x</script>' }] }));
  assert.ok(!html.includes('<img') && !html.includes('<script'), html);
  assert.ok(html.includes('href="#&quot;&gt;&lt;script&gt;x&lt;/script&gt;"'));
});

// ---- slides: read only ----------------------------------------------------------------------------

for (const make of [decision, approval, question, verdict]) {
  test(`slides: ${make().type} renders read only with the page-version note`, () => {
    const html = render(make(), slidesCtx);
    assert.ok(!html.includes('<input'), html);
    assert.ok(!html.includes('<textarea'), html);
    assert.ok(!html.includes('data-plan-item'), 'the runtime never binds a slide');
    assert.ok(html.includes('Answers are collected in the page version.'));
  });
}

test('slides: a decision shows the question, every option, the recommendation chip and the why', () => {
  const html = render(decision(), slidesCtx);
  for (const s of ['Where do answers live?', 'Browser storage', 'A save server', 'Both', 'Nothing to deploy']) assert.ok(html.includes(s), s);
  assert.match(html, /<li class="plan-opt-static is-rec">[^]*?Browser storage[^]*?<span>Recommended<\/span>/);
});

test('slides: a hostile decision stays escaped', () => {
  const html = render(decision({ question: HOSTILE, options: [{ label: HOSTILE }, { label: 'B' }], recommended: HOSTILE, why: HOSTILE }), slidesCtx);
  assert.ok(!html.includes('<img') && !html.includes('</script>'), html);
});

// ---- page parts -----------------------------------------------------------------------------------

test('page(): the four interactive types ship plan.css and plan.js; a deck gets the css only; review ships the css', () => {
  for (const type of ['decision', 'approval', 'question', 'verdict']) {
    assert.deepEqual(SECTIONS[type].page(pageCtx), { css: PLAN_CSS.replace(/\n$/, ''), js: [PLAN_JS] }, type);
    assert.deepEqual(SECTIONS[type].page(slidesCtx), { css: PLAN_CSS.replace(/\n$/, ''), js: [] }, type);
  }
  assert.deepEqual(SECTIONS.review.page(pageCtx), { css: PLAN_CSS.replace(/\n$/, ''), js: [] });
});

const plan = (sections, extra = {}) => ({ title: 'Plan', preset: 'plan', key: 'plan-mode', theme: 'mono', sections, ...extra });
const build = (spec) => buildPage(spec, { dir: FIXTURES, out: OUT });
const PLAN_CSS_MARK = PLAN_CSS.split('\n')[0];
const PLAN_JS_MARK = PLAN_JS.split('\n')[0];

test('a built plan page: the theme name, the plan key and the plan hash on <html>; plan.css and plan.js once', async () => {
  const { html } = await build(plan([decision(), approval(), question(), review(), verdict()]));
  assert.match(html, /<html lang="en" data-flavor="classic" data-theme-name="mono" data-preset="plan" data-plan-key="plan-mode" data-plan-hash="[0-9a-f]{12}">/);
  assert.equal(html.split(PLAN_CSS_MARK).length - 1, 1, 'plan.css once');
  assert.equal(html.split(PLAN_JS_MARK).length - 1, 1, 'plan.js once');
  assert.match(html, /<a class="plan-review-go" href="#storage">/);
});

test('a page with no plan items has no plan attributes, and a key-less plan writes a key derived from its title', async () => {
  const plain = (await build({ title: 'T', sections: [{ type: 'text', text: 'x' }] })).html;
  assert.match(plain, /<html lang="en" data-flavor="dusk" data-theme-name="dusk">/);
  assert.ok(!plain.includes('data-plan-key'));
  const keyless = (await build(plan([question()], { key: undefined }))).html;
  assert.match(keyless, /data-plan-key="plan-plan" data-plan-hash="[0-9a-f]{12}"/);
});

test('a hostile key cannot leave its attribute', async () => {
  const { html } = await build(plan([question()], { key: '"><script>x</script>' }));
  assert.ok(html.includes('data-plan-key="&quot;&gt;&lt;script&gt;x&lt;/script&gt;"'));
});

test('a plan as a deck: no inputs, no plan runtime, no plan attributes, the note on each answerable slide', async () => {
  const { html } = await build(plan([decision(), approval(), question(), verdict()], { mode: 'slides' }));
  assert.ok(!/<input type="radio"/.test(html));
  assert.ok(!html.includes('<textarea'));
  assert.ok(!html.includes(PLAN_JS_MARK));
  assert.ok(!html.includes('data-plan-key'));
  assert.match(html, /<html lang="en" data-flavor="classic" data-theme-name="mono" data-preset="plan">/);
  assert.equal(html.split('Answers are collected in the page version.').length - 1, 4);
});

test('a page with a review and no answerable item ships plan.css once and no plan.js or plan attributes', async () => {
  const { html } = await build({ title: 'T', sections: [{ type: 'text', id: 'notes', title: 'Notes', text: 'x' }, review({ items: [{ point: 'p', why: 'w', target: 'notes' }] })] });
  assert.equal(html.split(PLAN_CSS_MARK).length - 1, 1);
  assert.ok(!html.includes(PLAN_JS_MARK));
  assert.ok(!html.includes('data-plan-key'));
});

test('two items never share a radio group: each name belongs to one item', async () => {
  const { html } = await build(plan([decision({ id: 'verdict-call' }), approval({ id: 'storage' }), question(), verdict()]));
  const groups = new Map();
  for (const m of html.matchAll(/<div class="plan-item [^"]*" data-plan-item[^>]*>[^]*?(?=<div class="plan-item |<\/main>)/g)) {
    for (const r of radios(m[0])) {
      const name = attr(r, 'name');
      groups.set(name, (groups.get(name) ?? new Set()).add(m.index));
    }
  }
  assert.deepEqual([...groups.keys()].sort(), ['plan-storage', 'plan-verdict', 'plan-verdict-call']);
  for (const [name, owners] of groups) assert.equal(owners.size, 1, name);
});

test('review links fall back to the start of the target question when it has no title or label', async () => {
  const long = 'Should every reviewer answer every question before the plan can move on to the build phase at all?';
  const { html } = await build(plan([decision({ id: 'short', question: 'Keep it <short>?' }), decision({ id: 'long', question: long }), review({ items: [{ point: 'a', why: 'b', target: 'short' }, { point: 'c', why: 'd', target: 'long' }] }), verdict()]));
  assert.match(html, /href="#short"><span>Go to Keep it &lt;short&gt;\?<\/span>/);
  const text = html.match(/href="#long"><span>Go to ([^<]*)<\/span>/)[1];
  assert.ok(text.endsWith('…') && text.length <= 62, text);
  assert.ok(long.startsWith(text.slice(0, -1)), text);
});

test('slides: a question with no default says nothing about blank answers', () => {
  assert.ok(!render(question({ default: undefined }), slidesCtx).includes('blank answer'));
  assert.ok(render(question({ default: undefined })).includes('A blank answer leaves it open.'));
});

// ---- Save as HTML: the sticky button and the slot the saved answers go into ------------------

const SAVE_SLOT = '<script type="application/json" id="pa-plan-saved">null</script>';
const SAVE_BUTTON = '<button type="button" class="btn plan-btn plan-save-btn" data-plan-save-html>';

test('a plan page has one Save as HTML button and an empty saved-answers slot, inside the contents nav when there is one', async () => {
  const { html } = await build(plan([decision({ title: 'Storage' }), approval({ title: 'Themes' }), question({ title: 'Owner' }), { type: 'text', title: 'Context', text: 'x' }, review(), verdict()]));
  assert.equal(html.split(SAVE_BUTTON).length - 1, 1);
  assert.equal(html.split(SAVE_SLOT).length - 1, 1);
  const nav = html.match(/<nav class="toc"[^]*?<\/nav>/);
  assert.ok(nav && nav[0].includes('data-plan-save-html') && nav[0].includes(SAVE_SLOT), 'the block sits in the sticky contents nav');
});

test('a plan page too short for a contents list still gets the button, as a standalone block', async () => {
  const { html } = await build(plan([question(), verdict()]));
  assert.ok(!html.includes('<nav class="toc"'));
  assert.equal(html.split(SAVE_BUTTON).length - 1, 1);
  assert.match(html, /<aside class="plan-save plan-save-solo"/);
});

test('pages and decks without answerable items have no Save button and no slot', async () => {
  const plain = (await build({ title: 'T', sections: [{ type: 'text', text: 'x' }] })).html;
  const deck = (await build(plan([decision(), approval(), question(), verdict()], { mode: 'slides' }))).html;
  for (const html of [plain, deck]) {
    assert.ok(!html.includes(SAVE_BUTTON));
    assert.ok(!html.includes('pa-plan-saved'));
  }
});

test('print hides the Save block', () => {
  assert.match(PLAN_CSS, /@media print[^]*\.plan-save/);
});
