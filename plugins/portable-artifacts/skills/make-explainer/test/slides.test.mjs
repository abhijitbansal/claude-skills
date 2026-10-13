import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { buildPage, BuildError } from '../scripts/lib/page.mjs';
import { validateSpec } from '../scripts/lib/spec.mjs';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const OUT = path.join(FIXTURES, '..', '.unused', 'deck.html');
const build = (spec, opts = {}) => buildPage(spec, { dir: FIXTURES, out: OUT, ...opts });
const text = (n, extra = {}) => ({ type: 'text', title: `Claim ${n}`, text: `Body ${n}.`, ...extra });
const deck = (sections, extra = {}) => ({ title: 'Deck', mode: 'slides', sections, ...extra });
const ids = (html) => [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);

// ---- budget (end to end: the same errors reach a build) ---------------------------------

test('an over-budget slide is a validation error with a path and the fix', async () => {
  const heavy = { type: 'table', title: 'Big', columns: ['a'], rows: Array.from({ length: 9 }, (_, i) => [String(i)]) };
  const r = await validateSpec(deck([heavy]), { dir: FIXTURES });
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors, [{ path: 'sections[0].rows', message: 'slide has 9 table rows; the limit is 8 — split the table across slides' }]);
});

// ---- markup --------------------------------------------------------------------------

test('slides mode builds: a title slide first, then one numbered slide per section', async () => {
  const { html } = await build(deck([text(1), text(2), text(3)], { subtitle: 'Sub', meta: { date: '2026-10-12' } }));
  const slides = [...html.matchAll(/<section class="slide[^"]*" id="(slide-\d+)" tabindex="-1" aria-label="([^"]+)"/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(slides, [
    ['slide-1', 'Slide 1 of 4: Deck'],
    ['slide-2', 'Slide 2 of 4: Claim 1'],
    ['slide-3', 'Slide 3 of 4: Claim 2'],
    ['slide-4', 'Slide 4 of 4: Claim 3'],
  ]);
  assert.equal((html.match(/<h1>/g) ?? []).length, 1);
  assert.match(html, /<section class="slide slide-cover" id="slide-1"[^>]*>[\s\S]*<h1>Deck<\/h1>[\s\S]*Sub[\s\S]*2026-10-12/);
  assert.match(html, /<h2 class="slide-title" id="slide-2-title">Claim 1<\/h2>/);
  assert.match(html, /<main[^>]*data-deck[^>]*data-slug="deck"[^>]*data-total="4"/);
});

test('preset "slides" alone selects slides mode, and a page build has no deck', async () => {
  const viaPreset = (await build({ title: 'T', preset: 'slides', sections: [text(1)] })).html;
  assert.ok(viaPreset.includes('data-deck'));
  const page = (await build({ title: 'T', sections: [text(1)] })).html;
  assert.ok(!page.includes('data-deck'));
  assert.ok(!page.includes('class="slide'));
});

test('no duplicate ids; spec ids are not emitted and no page-only classes leak in', async () => {
  const { html } = await build(deck([text(1, { id: 'slide-3' }), text(2, { id: 'claim-1' }), text(3)]));
  const found = ids(html);
  assert.equal(new Set(found).size, found.length, `duplicate ids: ${found.filter((x, i) => found.indexOf(x) !== i)}`);
  assert.ok(!html.includes('id="claim-1"'));
  assert.ok(!/class="sec[ "-]/.test(html), 'no .sec / .sec-<type> on slides');
  assert.ok(!html.includes("classList.add('rise-ready')"), 'the rise-in is never armed on a deck');
  assert.ok(!html.includes('class="toc'));
});

test('untitled sections get a type-based label; own-heading sections get no second heading', async () => {
  const { html } = await build(deck([
    { type: 'text', text: 'No title here.' },
    { type: 'callout', tone: 'info', title: 'Careful', text: 'x' },
  ]));
  assert.match(html, /aria-label="Slide 2 of 3: Text"/);
  assert.ok(!html.includes('id="slide-2-title"'));
  assert.match(html, /aria-label="Slide 3 of 3: Careful"/);
  assert.ok(!html.includes('id="slide-3-title"'));
});

test('an untitled section is labelled with a real word, not the raw type name', async () => {
  const { html } = await build(deck([{ type: 'kpis', items: [{ label: 'a', value: 1 }] }, { type: 'tldr', text: 'x' }]));
  assert.match(html, /aria-label="Slide 2 of 3: KPIs"/);
  assert.match(html, /aria-label="Slide 3 of 3: TL;DR"/);
});

test('the outline dialog lists every slide title as a link to its slide', async () => {
  const { html } = await build(deck([text(1), text(2)]));
  const dialog = html.match(/<dialog[^>]*data-outline[^>]*>[\s\S]*?<\/dialog>/)[0];
  assert.deepEqual([...dialog.matchAll(/<a href="(#slide-\d)"[^>]*data-slide="(\d)"[^>]*>([^<]*)</g)].map((m) => [m[1], m[2], m[3].trim()]), [
    ['#slide-1', '1', 'Deck'],
    ['#slide-2', '2', 'Claim 1'],
    ['#slide-3', '3', 'Claim 2'],
  ]);
  assert.match(dialog, /aria-labelledby="outline-title"/);
});

test('hostile titles stay inert in labels, the outline and the heading', async () => {
  const P = '<img src=x onerror=alert(1)>"\'';
  const { html } = await build(deck([{ type: 'text', title: P, text: 'b' }], { title: P }));
  assert.ok(!html.includes('<img src=x'));
  assert.match(html.match(/<section[^>]*id="slide-2"[^>]*>/)[0], /aria-label="Slide 2 of 2: &lt;img src=x onerror=alert\(1\)&gt;&quot;&#39;"/);
});

test('the CSP is unchanged and the page still loads no network resource', async () => {
  const { html } = await build(deck([text(1)]));
  assert.match(html, /Content-Security-Policy" content="default-src &#39;none&#39;; script-src &#39;unsafe-inline&#39;; style-src &#39;unsafe-inline&#39;; img-src data: blob:; font-src data:">/);
  assert.ok(!/<link\b/i.test(html));
  assert.ok(!/<script[^>]*\ssrc=/i.test(html));
  assert.match(html, /localStorage\.getItem\('pa-theme'\)/);
  assert.match(html, /data-theme-toggle/);
});

test('the runtime is still the last inline script, and the scripts cannot close their tag', async () => {
  const { html } = await build(deck([text(1)]));
  const at = html.lastIndexOf('<script>');
  assert.ok(html.slice(at).includes('window.paReady = true'));
  assert.equal((html.match(/<\/script>/g) ?? []).length, (html.match(/<script>/g) ?? []).length);
});

test('a renderer that throws, and a type with no renderer yet, are BuildErrors at their paths in slides mode', async () => {
  await assert.rejects(build(deck([text(1), { type: 'image', src: 'missing.png', alt: 'x' }])), (e) => {
    assert.ok(e instanceof BuildError);
    assert.equal(e.errors[0].path, 'sections[1]');
    return true;
  });
  await assert.rejects(build(deck([text(1), { type: 'motion', video: 'x.mp4' }])), (e) => {
    assert.deepEqual(e.errors.map((x) => x.path), ['sections[1].type']);
    return true;
  });
});

// ---- pa-lib: slide helpers (pure) -------------------------------------------------------

function loadLib() {
  const sandbox = {};
  sandbox.globalThis = sandbox;
  vm.runInNewContext(fs.readFileSync(new URL('../template/pa-lib.js', import.meta.url), 'utf8'), sandbox);
  return sandbox.PA;
}

test('pa-lib: clampSlide keeps a slide number in 1..total and treats junk as the first', () => {
  const PA = loadLib();
  assert.equal(PA.clampSlide(3, 5), 3);
  assert.equal(PA.clampSlide(0, 5), 1);
  assert.equal(PA.clampSlide(-4, 5), 1);
  assert.equal(PA.clampSlide(99, 5), 5);
  assert.equal(PA.clampSlide(2.7, 5), 2);
  assert.equal(PA.clampSlide(NaN, 5), 1);
  assert.equal(PA.clampSlide(undefined, 5), 1);
  assert.equal(PA.clampSlide(Infinity, 5), 5);
});

test('pa-lib: parseSlideHash reads #slide-N (1-based, clamped) and nothing else', () => {
  const PA = loadLib();
  assert.equal(PA.parseSlideHash('#slide-3', 5), 3);
  assert.equal(PA.parseSlideHash('#slide-1', 5), 1);
  assert.equal(PA.parseSlideHash('#slide-99', 5), 5);
  assert.equal(PA.parseSlideHash('#slide-0', 5), 1);
  assert.equal(PA.parseSlideHash('#slide-99999999999999999999', 5), 5);
  for (const junk of ['', '#', '#slide-', '#slide-x', '#slide--2', '#slide-2x', '#Slide-2', '#top', '#slide-2-title', 'slide-2', null, undefined, 3]) {
    assert.equal(PA.parseSlideHash(junk, 5), null, String(junk));
  }
});

test('pa-lib: parseResume reads a stored slide number, clamps a stale one, ignores junk', () => {
  const PA = loadLib();
  assert.equal(PA.parseResume('3', 5), 3);
  assert.equal(PA.parseResume('9', 5), 5);
  assert.equal(PA.parseResume('0', 5), 1);
  for (const junk of ['', 'x', '2.5', '1e1', '-1', ' 2', '{"a":1}', null, undefined, 4]) {
    assert.equal(PA.parseResume(junk, 5), null, String(junk));
  }
});

test('pa-lib: slideKey maps keys to moves; arrows up/down and other keys are left alone', () => {
  const PA = loadLib();
  assert.deepEqual({ ...PA.slideKey('ArrowRight', false) }, { to: 'next', paged: false });
  assert.deepEqual({ ...PA.slideKey('ArrowLeft', false) }, { to: 'prev', paged: false });
  assert.deepEqual({ ...PA.slideKey(' ', false) }, { to: 'next', paged: true });
  assert.deepEqual({ ...PA.slideKey(' ', true) }, { to: 'prev', paged: true });
  assert.deepEqual({ ...PA.slideKey('PageDown', false) }, { to: 'next', paged: true });
  assert.deepEqual({ ...PA.slideKey('PageUp', false) }, { to: 'prev', paged: true });
  assert.deepEqual({ ...PA.slideKey('Home', false) }, { to: 'first', paged: false });
  assert.deepEqual({ ...PA.slideKey('End', false) }, { to: 'last', paged: false });
  assert.deepEqual({ ...PA.slideKey('o', false) }, { to: 'outline', paged: false });
  assert.deepEqual({ ...PA.slideKey('O', true) }, { to: 'outline', paged: false });
  for (const key of ['ArrowUp', 'ArrowDown', 'Enter', 'Tab', 'Escape', 'a', '', undefined]) assert.equal(PA.slideKey(key, false), null, String(key));
});

test('pa-lib: moveTarget stays inside 1..total', () => {
  const PA = loadLib();
  assert.equal(PA.moveTarget('next', 2, 5), 3);
  assert.equal(PA.moveTarget('next', 5, 5), 5);
  assert.equal(PA.moveTarget('prev', 1, 5), 1);
  assert.equal(PA.moveTarget('prev', 3, 5), 2);
  assert.equal(PA.moveTarget('first', 4, 5), 1);
  assert.equal(PA.moveTarget('last', 2, 5), 5);
  assert.equal(PA.moveTarget('sideways', 2, 5), 2);
});

test('pa-lib: canScroll says whether a tall slide has more to show in a direction', () => {
  const PA = loadLib();
  const tall = (top) => ({ scrollTop: top, clientHeight: 500, scrollHeight: 900 });
  assert.equal(PA.canScroll(tall(0), 1), true);
  assert.equal(PA.canScroll(tall(0), -1), false);
  assert.equal(PA.canScroll(tall(200), 1), true);
  assert.equal(PA.canScroll(tall(200), -1), true);
  assert.equal(PA.canScroll(tall(400), 1), false, 'at the bottom (400 + 500 = 900)');
  assert.equal(PA.canScroll(tall(399.4), 1), false, 'sub-pixel slack counts as the bottom');
  assert.equal(PA.canScroll({ scrollTop: 0, clientHeight: 500, scrollHeight: 500 }, 1), false);
  assert.equal(PA.canScroll(tall(0), 0), false);
});

test('pa-lib: slideAtScroll names the slide the deck is scrolled to', () => {
  const PA = loadLib();
  assert.equal(PA.slideAtScroll(0, 800, 5), 1);
  assert.equal(PA.slideAtScroll(799, 800, 5), 2);
  assert.equal(PA.slideAtScroll(1200, 800, 5), 3);
  assert.equal(PA.slideAtScroll(99999, 800, 5), 5);
  assert.equal(PA.slideAtScroll(-50, 800, 5), 1);
  assert.equal(PA.slideAtScroll(100, 0, 5), 1);
});

test('pa-lib: safeStorage returns the storage, or undefined when reading it throws', () => {
  const PA = loadLib();
  assert.equal(PA.safeStorage('localStorage'), undefined, 'a missing storage reads as undefined');
});

test('pa-lib: safeStorage survives a getter that throws', () => {
  const sandbox = { window: undefined };
  sandbox.globalThis = sandbox;
  Object.defineProperty(sandbox, 'localStorage', { get() { throw new Error('denied'); } });
  vm.runInNewContext(fs.readFileSync(new URL('../template/pa-lib.js', import.meta.url), 'utf8'), sandbox);
  assert.equal(sandbox.PA.safeStorage('localStorage'), undefined);
});
