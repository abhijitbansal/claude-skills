import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SECTIONS } from '../scripts/lib/sections.mjs';
import { loadSibling } from '../scripts/lib/siblings.mjs';
import { loadTheme } from '../shared/theme.mjs';
import { plain, rawText, glyph, toneChip } from '../scripts/lib/render/ui.mjs';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

// A string no renderer may let through as markup: a tag, both quote kinds.
const P = '<i>X</i>"\'';
const ESCAPED_P = '&lt;i&gt;X&lt;/i&gt;&quot;&#39;';

const ctx = { dir: FIXTURES, icons: null, theme: loadTheme('paper'), mode: 'page', slug: 'page', assetsDir: path.join(FIXTURES, 'page.assets'), idFor: () => 'sec' };

// One section per type with the hostile string in every free-text field.
const HOSTILE = {
  tldr: { type: 'tldr', text: P, points: [P, P], tone: 'good' },
  text: { type: 'text', text: `${P}\n\n- ${P}` },
  kpis: { type: 'kpis', items: [{ label: P, value: P, delta: P, tone: 'warn', note: P }] },
  cards: { type: 'cards', items: [{ title: P, text: P, tag: P, tone: 'bad' }] },
  table: { type: 'table', columns: [P, P], rows: [[P, P], [1, P]], caption: P },
  risks: { type: 'risks', items: [{ risk: P, severity: 'high', mitigation: P, owner: P }] },
  files: { type: 'files', items: [{ path: `d<b>"'/f<b>"'`, change: 'added', note: P, add: 1, del: 2 }] },
  steps: { type: 'steps', items: [{ title: P, text: P, status: 'doing' }] },
  timeline: { type: 'timeline', items: [{ date: P, title: P, text: P }] },
  compare: { type: 'compare', columns: [{ title: P, points: [P], tone: 'good' }, { title: P, points: [P] }], verdict: P },
  callout: { type: 'callout', tone: 'warn', title: P, text: P },
  code: { type: 'code', code: P, language: P, caption: P },
  details: { type: 'details', summary: P, text: P },
  image: { type: 'image', src: 'pixel.png', alt: P, caption: P },
  motion: { type: 'motion', video: 'demo.mp4', poster: 'poster.png', caption: P },
  diagram: { type: 'diagram', caption: P, diagram: { title: P, type: 'flow', nodes: [{ id: 'a', label: P }, { id: 'b', label: P, note: P }], edges: [{ from: 'a', to: 'b', label: P }] } },
  chart: { type: 'chart', title: P, caption: P, kind: 'bar', x: 'cat', y: 'n', data: [{ cat: P, n: 1 }, { cat: 'b', n: 2 }] },
  scene: { type: 'scene', caption: P, scene: { title: 'Commits', world: 'city', data: { rows: [{ group: P, t: P, value: 3 }, { group: 'b', t: 'y', value: 2 }] } } },
  checklist: { type: 'checklist', key: 'k', intro: P, onFail: P, groups: [{ title: P, items: [{ text: P, note: P, tag: 'visual' }] }] },
};

function countLeaves(value, target) {
  if (typeof value === 'string') return value.split(target).length - 1;
  if (Array.isArray(value)) return value.reduce((n, v) => n + countLeaves(v, target), 0);
  if (value && typeof value === 'object') return Object.values(value).reduce((n, v) => n + countLeaves(v, target), 0);
  return 0;
}

test('every section type has a renderer under test', () => {
  assert.deepEqual(Object.keys(HOSTILE).sort(), Object.keys(SECTIONS).sort());
});

for (const [type, section] of Object.entries(HOSTILE)) {
  test(`${type}: hostile text is escaped everywhere, never markup`, async () => {
    const c = { ...ctx, diagrams: { items: new Map(), css: '', runtime: '' } };
    if (SECTIONS[type].prepare) await SECTIONS[type].prepare(section, c, 0);
    const html = SECTIONS[type].render(section, c);
    assert.ok(!html.includes('<i>'), `raw <i> leaked:\n${html}`);
    assert.ok(!html.includes('X</i>'), 'raw closing tag leaked');
    const seen = html.split(ESCAPED_P).length - 1;
    assert.ok(seen >= countLeaves(section, P) - (type === 'files' ? 1 : 0), `${type}: found ${seen} escaped copies, fixture has ${countLeaves(section, P)}`);
  });
}

test('files: a hostile path is escaped in the title attribute and the folder names', () => {
  const html = SECTIONS.files.render(HOSTILE.files, ctx);
  assert.ok(html.includes('title="d&lt;b&gt;&quot;&#39;/f&lt;b&gt;&quot;&#39;"'));
  assert.ok(html.includes('<span class="dir">d&lt;b&gt;&quot;&#39;/</span>'));
  assert.ok(!html.includes('<b>'));
});

test('markdown-lite injection stays inert in a text section', () => {
  const html = SECTIONS.text.render({ type: 'text', text: '[x](javascript:alert(1)) <img src=x onerror=alert(1)> **<b>** [a](https://ok.example "x)' }, ctx);
  assert.ok(!html.includes('href="javascript'));
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('<b>'));
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('enum-like values never reach the markup: an unknown tone, severity or status falls back', () => {
  const junk = '"><script>x</script>';
  const out = [
    SECTIONS.risks.render({ type: 'risks', items: [{ risk: 'r', severity: junk, mitigation: 'm' }] }, ctx),
    SECTIONS.steps.render({ type: 'steps', items: [{ title: 't', status: junk }] }, ctx),
    SECTIONS.callout.render({ type: 'callout', tone: junk, title: 't', text: 'x' }, ctx),
    SECTIONS.kpis.render({ type: 'kpis', items: [{ label: 'l', value: 1, tone: junk }] }, ctx),
    SECTIONS.cards.render({ type: 'cards', columns: junk, items: [{ title: 't', text: 'x', tone: junk }] }, ctx),
    SECTIONS.files.render({ type: 'files', items: [{ path: 'a', change: junk }] }, ctx),
  ].join('\n');
  assert.ok(!out.includes('<script'), out);
  assert.ok(!out.includes(junk));
});

test('ui: plain strips markup and stays escaped; rawText unescapes; unknown glyph and tone are safe', () => {
  assert.equal(plain('A **b** `c` [d](https://e.example) <x>'), 'A b c d &lt;x&gt;');
  assert.equal(rawText('Tom & "Jerry" <x>'), 'Tom & "Jerry" <x>');
  assert.match(glyph('nope'), /<circle/);
  assert.equal(toneChip('neutral'), '');
  assert.equal(toneChip('toString'), '');
});

// ---- behaviour of individual renderers --------------------------------------------

test('table: numeric columns right-align, the first column is a row header, caption is a real caption', () => {
  const html = SECTIONS.table.render({ type: 'table', columns: ['Name', 'KB', 'Note'], rows: [['a', 410, 'x'], ['b', '1,200', 'y']], caption: 'Sizes' }, ctx);
  assert.match(html, /<th scope="row" class="a-l">a<\/th>/);
  assert.match(html, /<td class="a-r">410<\/td>/);
  assert.match(html, /<td class="a-r">1,200<\/td>/);
  assert.match(html, /<td class="a-l">x<\/td>/);
  assert.match(html, /<caption>Sizes<\/caption>/);
  assert.match(html, /role="region" aria-label="Sizes" tabindex="0"/);
});

test('table: explicit align wins over detection', () => {
  const html = SECTIONS.table.render({ type: 'table', columns: ['A', 'B'], rows: [['x', 1]], align: ['center', 'left'] }, ctx);
  assert.match(html, /<th scope="row" class="a-c">x<\/th>/);
  assert.match(html, /<td class="a-l">1<\/td>/);
});

test('risks and steps: status is a word and a shape, not colour', () => {
  const risks = SECTIONS.risks.render({ type: 'risks', items: [{ risk: 'r', severity: 'critical', mitigation: 'm' }] }, ctx);
  assert.match(risks, /<span class="chip tone-critical"><svg[^>]*>.*<\/svg><span>Critical<\/span><\/span>/s);
  assert.ok(!risks.includes('Owner'), 'no owner column when nobody has an owner');
  const steps = SECTIONS.steps.render({ type: 'steps', items: [{ title: 'a', status: 'done' }, { title: 'b' }] }, ctx);
  assert.match(steps, /<span>Done<\/span>/);
  assert.equal(steps.split('class="chip').length - 1, 1, 'a step without status has no chip');
});

test('files: groups by folder, folds single-child chains, counts and totals', () => {
  const html = SECTIONS.files.render({ type: 'files', items: [
    { path: 'a/b/c/x.mjs', change: 'added', add: 3 },
    { path: 'a/b/c/y.mjs', change: 'modified', add: 1, del: 1 },
    { path: 'README.md', change: 'deleted', del: 5 },
  ] }, ctx);
  assert.match(html, /<span class="dir">a\/b\/c\/<\/span><span class="count">2 files<\/span>/);
  assert.match(html, /3 files · 1 added, 1 modified, 1 deleted · \+4 −6 lines/);
  assert.ok(html.indexOf('README.md') < html.indexOf('a/b/c/'), 'root files come before folders');
});

test('cards: an icon needs the loaded catalog; with it the svg is aria-hidden and painted by kind', async () => {
  const icons = await loadSibling('make-diagram', 'scripts/lib/icons.mjs');
  const item = { title: 't', text: 'x', icon: 'lucide:palette' };
  const without = SECTIONS.cards.render({ type: 'cards', items: [item] }, ctx);
  assert.ok(!without.includes('card-icon'));
  const withIcons = SECTIONS.cards.render({ type: 'cards', items: [item, { ...item, icon: 'brand:github' }], columns: 2 }, { ...ctx, icons });
  assert.match(withIcons, /class="cards cols-2"/);
  assert.match(withIcons, /<svg class="card-icon"[^>]*stroke="currentColor"[^>]*aria-hidden="true"/);
  assert.match(withIcons, /<svg class="card-icon"[^>]*fill="currentColor"[^>]*aria-hidden="true"/);
});

test('code: trailing newlines are dropped, a copy button is present', () => {
  const html = SECTIONS.code.render({ type: 'code', code: 'a\nb\n\n', language: 'sh' }, ctx);
  assert.match(html, /<code>a\nb<\/code>/);
  assert.match(html, /data-copy/);
});

test('callout owns its heading', () => {
  assert.equal(SECTIONS.callout.ownHeading, true);
  assert.equal(SECTIONS.text.ownHeading, false);
});

test('image: renders a data URI, and refuses a missing or unsafe file', () => {
  const html = SECTIONS.image.render({ type: 'image', src: 'pixel.png', alt: 'p' }, ctx);
  assert.match(html, /<img src="data:image\/png;base64,[A-Za-z0-9+/=]+" alt="p">/);
  assert.throws(() => SECTIONS.image.render({ type: 'image', src: 'nope.png', alt: 'p' }, ctx), /file not found/);
  assert.throws(() => SECTIONS.image.render({ type: 'image', src: '../x.png', alt: 'p' }, ctx), /outside the spec folder/);
});

test('image: an svg with a script is refused at render time too', () => {
  const dir = fs.mkdtempSync(path.join(FIXTURES, '..', '.tmp-img-'));
  try {
    fs.writeFileSync(path.join(dir, 'bad.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    assert.throws(() => SECTIONS.image.render({ type: 'image', src: 'bad.svg', alt: 'p' }, { ...ctx, dir }), /not safe to inline/);
  } finally { fs.rmSync(dir, { recursive: true }); }
});
