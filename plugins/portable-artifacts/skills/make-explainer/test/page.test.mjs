import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { buildPage, BuildError, contentSecurityPolicy, sectionIds, headingIds } from '../scripts/lib/page.mjs';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const CORE = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'core.explainer.json'), 'utf8'));
const OUT = path.join(FIXTURES, '..', '.unused', 'page.html');
const build = (spec, opts = {}) => buildPage(spec, { dir: FIXTURES, out: OUT, ...opts });
const text = (n) => ({ type: 'text', title: `Claim ${n}`, text: `Body ${n}.` });
const doc = (sections, extra = {}) => ({ title: 'T', sections, ...extra });

test('the core fixture builds into one document with the CSP and no network references', async () => {
  const { html, assets } = await build(CORE);
  assert.deepEqual(assets, []);
  assert.match(html, /<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; script-src &#39;unsafe-inline&#39;; style-src &#39;unsafe-inline&#39;; img-src data: blob:; font-src data:">/);
  assert.ok(!/<link\b/i.test(html), 'no <link>');
  assert.ok(!/<script[^>]*\ssrc=/i.test(html), 'no external script');
  assert.ok(!/url\(\s*["']?https?:/i.test(html), 'no css url() to the network');
  assert.ok(!/@import/.test(html));
  assert.equal((html.match(/<h1>/g) ?? []).length, 1);
});

test('CSP: media-src only when a motion section exists', () => {
  assert.ok(!contentSecurityPolicy(doc([text(1)])).includes('media-src'));
  assert.ok(contentSecurityPolicy(doc([text(1), { type: 'motion', video: 'a.mp4' }])).endsWith("; media-src 'self' file: blob:"));
  assert.ok(contentSecurityPolicy(doc([text(1)])).startsWith("default-src 'none'; script-src 'unsafe-inline'"));
});

test('title, subtitle, meta, ids and headings are all escaped', async () => {
  const P = '<i>X</i>"\'';
  const spec = doc([{ type: 'text', title: P, text: P }], { title: P, subtitle: P, meta: { date: P, branch: P } });
  const { html } = await build(spec);
  assert.ok(!html.includes('<i>X'), 'raw tag leaked');
  assert.ok(!html.includes('X</i>'));
  assert.match(html, /<title>&lt;i&gt;X&lt;\/i&gt;&quot;&#39;<\/title>/);
});

test('a hostile section id cannot break out of an attribute', async () => {
  const { html } = await build(doc([{ type: 'text', id: '"><script>x</script>', title: 'A', text: 'b' }]));
  assert.ok(!html.includes('<script>x'));
  assert.ok(html.includes('id="&quot;&gt;&lt;script&gt;x&lt;/script&gt;"'));
});

test('text containing a template marker is not substituted a second time', async () => {
  const { html } = await build(doc([{ type: 'text', title: 'A', text: 'see <!--@SECTIONS--> and <!--@RUNTIME-->' }]));
  assert.ok(html.includes('&lt;!--@SECTIONS--&gt;'));
  assert.equal(html.split('Skip to content').length, 2);
});

test('headings: id from the title, own ids kept, duplicates numbered, untitled get section-N', () => {
  const ids = sectionIds([
    { type: 'text', title: 'Same claim', text: 'x' },
    { type: 'text', title: 'Same claim', text: 'x' },
    { type: 'text', id: 'same-claim-2', text: 'x' },
    { type: 'text', text: 'x' },
    { type: 'text', title: '2024 plan & `code`', text: 'x' },
    { type: 'text', title: '日本語', text: 'x' },
  ]);
  assert.equal(ids[0], 'same-claim');
  assert.equal(ids[2], 'same-claim-2');
  assert.notEqual(ids[1], 'same-claim');
  assert.notEqual(ids[1], 'same-claim-2');
  assert.equal(ids[3], 'section-4');
  assert.equal(ids[4], 's-2024-plan-code');
  assert.equal(ids[5], 'section-6');
  assert.equal(new Set(ids).size, ids.length);
});

test('generated ids: the suffix goes on the prefixed id, never leaving a digit-leading id', () => {
  const same = { type: 'text', title: '2024 plan', text: 'x' };
  const ids = sectionIds([same, same, same]);
  assert.deepEqual(ids, ['s-2024-plan', 's-2024-plan-2', 's-2024-plan-3']);
  assert.ok(ids.every((id) => /^[a-z][a-z0-9-]*$/.test(id)));
  assert.deepEqual(sectionIds([{ type: 'text', text: 'x' }, { type: 'text', id: 'section-1', text: 'x' }]), ['section-1-2', 'section-1']);
});

test('no two elements on a built page share an id, including heading ids', async () => {
  // "a" gets heading id "a-title"; an explicit section called "a-title" would collide with it.
  const spec = doc([
    { type: 'text', title: 'A', text: 'x' },
    { type: 'text', id: 'a-title', title: 'B', text: 'x' },
    { type: 'text', title: 'A title', text: 'x' },
    { type: 'text', title: 'A', text: 'x' },
    { type: 'text', id: 'b-title', title: 'B', text: 'x' },
    { type: 'text', id: 'b', title: 'B', text: 'x' },
  ]);
  const ids = sectionIds(spec.sections);
  assert.equal(new Set(ids).size, ids.length);
  const titles = headingIds(ids);
  assert.equal(new Set([...ids, ...titles]).size, ids.length * 2, 'section ids and heading ids are all distinct');
  const { html } = await build(spec);
  const found = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(found).size, found.length, `duplicate ids: ${found.filter((x, i) => found.indexOf(x) !== i)}`);
});

test('contents: absent below four titled sections, present from four, callouts excluded', async () => {
  const three = (await build(doc([text(1), text(2), text(3)]))).html;
  assert.ok(!three.includes('<nav class="toc"'));
  assert.match(three, /<body class="">/);
  const four = (await build(doc([text(1), text(2), text(3), text(4)]))).html;
  assert.equal((four.match(/<li><a href="#claim-\d">/g) ?? []).length, 4);
  assert.match(four, /<body class="has-toc">/);
  const callouts = (await build(doc([text(1), text(2), text(3), { type: 'callout', tone: 'info', title: 'Note', text: 'x' }]))).html;
  assert.ok(!callouts.includes('<nav class="toc"'), 'a callout title is not a contents entry');
});

test('sections without a title render no heading and no label', async () => {
  const { html } = await build(doc([{ type: 'text', text: 'x' }]));
  assert.ok(!html.includes('<h2'));
  assert.ok(!html.includes('aria-labelledby'));
});

test('slides mode and sections without a renderer are reported with paths, all at once', async () => {
  await assert.rejects(build(doc([text(1), { type: 'checklist', key: 'k', groups: [] }, { type: 'chart' }], { mode: 'slides' })), (e) => {
    assert.ok(e instanceof BuildError);
    assert.deepEqual(e.errors.map((x) => x.path), ['mode', 'sections[1].type', 'sections[2].type']);
    assert.match(e.errors[1].message, /"checklist" sections have no renderer yet/);
    return true;
  });
});

test('a renderer that throws becomes a BuildError at the section path', async () => {
  await assert.rejects(build(doc([text(1), { type: 'image', src: 'missing.png', alt: 'x' }])), (e) => {
    assert.ok(e instanceof BuildError);
    assert.equal(e.errors[0].path, 'sections[1]');
    assert.match(e.errors[0].message, /file not found/);
    return true;
  });
});

test('theme: --theme override beats spec.theme; unknown names throw with the list', async () => {
  const blueprint = (await build(doc([text(1)], { theme: 'paper' }), { theme: 'blueprint' })).html;
  const paper = (await build(doc([text(1)], { theme: 'paper' }))).html;
  assert.notEqual(blueprint, paper);
  await assert.rejects(build(doc([text(1)]), { theme: 'nope' }), /unknown theme "nope"; available: /);
});

test('the dark theme and the toggle with its pre-paint script are in the page', async () => {
  const { html } = await build(doc([text(1)]));
  assert.match(html, /localStorage\.getItem\('pa-theme'\)/);
  assert.match(html, /<button type="button" class="theme-toggle" data-theme-toggle aria-label="Theme: Auto\. Change theme">Theme: Auto<\/button>/);
  assert.match(html, /:root\[data-theme="dark"\]/);
  assert.match(html, /prefers-reduced-motion: reduce/);
  assert.match(html, /@media print/);
});

// ---- pa-lib.js (pure helpers, loaded the way the page loads it) ---------------------

function loadLib() {
  const sandbox = {};
  sandbox.globalThis = sandbox;
  vm.runInNewContext(fs.readFileSync(new URL('../template/pa-lib.js', import.meta.url), 'utf8'), sandbox);
  return sandbox.PA;
}

test('pa-lib: nextTheme cycles auto, light, dark and treats junk as auto', () => {
  const { nextTheme } = loadLib();
  assert.equal(nextTheme('auto'), 'light');
  assert.equal(nextTheme('light'), 'dark');
  assert.equal(nextTheme('dark'), 'auto');
  assert.equal(nextTheme('weird'), 'light');
});

test('pa-lib: storage helpers tolerate a missing or throwing store', () => {
  const { readStore, writeStore } = loadLib();
  const thrower = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.equal(readStore(undefined, 'k'), null);
  assert.equal(readStore(thrower, 'k'), null);
  assert.doesNotThrow(() => writeStore(thrower, 'k', 'v'));
  assert.doesNotThrow(() => writeStore(undefined, 'k', 'v'));
});

test('pa-lib: activeIndex follows the reading line, the first section before any, the last at the end', () => {
  const { activeIndex } = loadLib();
  assert.equal(activeIndex([], 100, false), -1);
  assert.equal(activeIndex([200, 600, 1000], 100, false), 0);
  assert.equal(activeIndex([-500, 50, 400], 100, false), 1);
  assert.equal(activeIndex([-500, -300, 400], 100, false), 1);
  assert.equal(activeIndex([-500, -300, 400], 100, true), 2);
});

test('the inlined scripts cannot close their own tag', async () => {
  const { html } = await build(doc([text(1)]));
  const scripts = html.match(/<script>[\s\S]*?<\/script>/g);
  assert.ok(scripts.length >= 3);
  for (const s of scripts) assert.equal((s.match(/<\/script/gi) ?? []).length, 1);
});
