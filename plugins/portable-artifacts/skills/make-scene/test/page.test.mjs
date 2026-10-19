// The page and the embeddable fragment: CSP, one runtime, text-only labels, fallback, determinism.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadTheme } from '../shared/theme.mjs';
import { buildScene, sceneFromGraph } from '../scripts/lib/api.mjs';
import { renderPage } from '../scripts/lib/page.mjs';
import { bundleHeader, readBundle } from '../scripts/lib/bundle.mjs';
import { PINNED_ENV, ROWS, citySpec } from './helpers/scene-fixtures.mjs';

const theme = loadTheme('dusk');
const HOSTILE = '<img src=x onerror=alert(1)>';
const SIBLING_VIEWER = new URL('../../make-diagram/template/viewer.html', import.meta.url);
const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:";

async function page(spec = citySpec(), { env = PINNED_ENV, idPrefix } = {}) {
  const built = await buildScene(spec, { dir: process.cwd(), theme, idPrefix });
  return { built, html: renderPage(spec, built, { theme, env }) };
}

const count = (text, needle) => text.split(needle).length - 1;
const dataBlock = (html, id = 'sc-data') => JSON.parse(new RegExp(`<script type="application/json" id="${id}">([^<]*)</script>`).exec(html)[1]);

test('page has the sibling CSP verbatim', async () => {
  const { html } = await page();
  assert.ok(html.includes(`<meta http-equiv="Content-Security-Policy" content="${CSP}">`));
  if (fs.existsSync(SIBLING_VIEWER)) {
    const sibling = fs.readFileSync(SIBLING_VIEWER, 'utf8').split('\n')[4];
    assert.ok(sibling.includes(CSP), 'the constant above is still the sibling string');
    assert.ok(html.includes(sibling), 'the whole meta line matches make-diagram/template/viewer.html:5');
  }
  assert.ok(!/\b(src|href)\s*=\s*["']https?:/i.test(html), 'no network references');
});

test('runtime inlined exactly once', async () => {
  const { html } = await page();
  assert.equal(count(html, bundleHeader()), 1);
  assert.equal(count(html, 'window.PAScene='), 1);
  assert.ok(html.includes(readBundle().split('\n')[1].slice(0, 200)), 'the bundle body is there');
});

test('labels render as text, never markup', async () => {
  const spec = citySpec({
    title: `Title ${HOSTILE}`,
    subtitle: HOSTILE,
    data: { rows: [{ group: HOSTILE, t: '2026-W30', value: 3, label: HOSTILE }, { group: 'b', t: '2026-W30', value: 4 }] },
    tour: [{ title: HOSTILE, caption: HOSTILE, focus: [HOSTILE] }],
  });
  const { html, built } = await page(spec);
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'), 'escaped text is present');
  assert.equal(count(html, '<img'), 0, 'no raw <img anywhere');
  const markup = html.replace(/<script[\s\S]*?<\/script>/g, ''); // script bodies are not parsed as HTML
  assert.ok(!/onerror=alert\(1\)(?!&gt;)/.test(markup), 'the attribute text only appears escaped');
  assert.equal(dataBlock(html).groups[0].name, HOSTILE, 'the data block round-trips the exact text');
  assert.ok(built.fallbackHtml.includes('&lt;img'));
});

test('data block cannot close its script tag', async () => {
  const evil = '</script><script>alert(1)</script><!--  ';
  const { html } = await page(citySpec({ data: { rows: [{ group: evil, value: 1 }] } }));
  assert.equal(count(html, '</script><script>alert(1)'), 0);
  assert.equal(dataBlock(html).groups[0].name, evil);
});

test('fallback table lists every item', async () => {
  const { built, html } = await page();
  assert.equal(count(built.fallbackHtml, '<tr>'), ROWS.length + 1, 'header row plus one per item');
  for (const [i, row] of ROWS.entries()) {
    for (const cell of [row.group, row.t, String(row.value)]) assert.ok(built.fallbackHtml.includes(`>${cell}<`), `row ${i} shows ${cell}`);
  }
  assert.ok(html.includes(built.fallbackHtml));
  assert.match(built.fallbackHtml, /<th scope="col">group<\/th>/);
});

test('galaxy links show as a second table; svg fallbacks ship both themes and css once', async () => {
  const { built } = await page(citySpec({ world: 'galaxy', links: [{ from: 'api', to: 'web', value: 1234567 }] }));
  assert.equal(count(built.fallbackHtml, '<table'), 2);
  assert.ok(built.fallbackHtml.includes('1,234,567'));
  assert.ok(built.fallbackHtml.includes('>from<'));

  const lifted = sceneFromGraph({ ...built.graph, fallback: { kind: 'svg', columns: ['x'], rows: [['1']], svg: '<svg id="light"></svg>', svgDark: '<svg id="dark"></svg>', css: '.lift-only{color:red}' } });
  const html = renderPage(citySpec(), lifted, { theme, env: PINNED_ENV });
  assert.equal(count(html, '.lift-only{color:red}'), 1, 'fallback css included once');
  assert.ok(html.includes('<svg id="light">') && html.includes('<svg id="dark">'));
  assert.match(html, /\.sc-fb-dark\s*\{[^}]*display:\s*none/);
  assert.match(html, /:root\[data-theme="dark"\]\s+\.sc-fb-light\s*\{[^}]*display:\s*none/);
});

test('same spec same bytes', async () => {
  const a = await page(citySpec(), { env: PINNED_ENV });
  const b = await page(citySpec(), { env: PINNED_ENV });
  assert.equal(a.html, b.html);
  const other = await page(citySpec(), { env: { SOURCE_DATE_EPOCH: '1760918400' } });
  assert.notEqual(other.html, a.html, 'the build date is the only thing that moves');
});

test('chrome: title, subtitle, theme toggle, favicon, generator and provenance', async () => {
  const spec = citySpec({ subtitle: 'two services', generatedBy: { model: 'haiku', effort: 'low', agent: 'test' } });
  const { html } = await page(spec);
  assert.match(html, /<title>Commits per folder<\/title>/);
  assert.match(html, /<h1>Commits per folder<\/h1>/);
  assert.ok(html.includes('two services'));
  assert.ok(html.includes('data-theme-toggle'));
  assert.match(html, /<link rel="icon" type="image\/svg\+xml"/);
  assert.match(html, /<meta name="generator" content="portable-artifacts make-scene; model=haiku; effort=low; agent=test">/);
  assert.match(html, /<p class="pa-provenance"[^>]*>make-scene · haiku · low effort · test · 19 Oct 2025<\/p>/);
  assert.match(html, /PAScene\.initAll\(\{\s*globalKeys:\s*true\s*\}\)/);
});

test('the fragment is embeddable: no document, idPrefix honoured, two scenes can share a page', async () => {
  const a = await buildScene(citySpec(), { dir: process.cwd(), theme, idPrefix: 'one' });
  const b = await buildScene(citySpec(), { dir: process.cwd(), theme, idPrefix: 'two' });
  assert.doesNotMatch(a.html, /<(html|head|body)\b/i);
  assert.ok(a.html.includes('id="one"') && a.html.includes('id="one-data"') && a.html.includes('data-pa-scene'));
  assert.ok(b.html.includes('id="two-data"'));
  assert.equal(count(a.html, 'id="two'), 0);
  assert.equal(a.runtime, readBundle());
  assert.equal(typeof a.css, 'string');
  assert.ok(a.bytes > 0 && a.bytes === Buffer.byteLength(a.html));
  await assert.rejects(buildScene(citySpec(), { dir: process.cwd(), theme, idPrefix: 'bad"><x' }), /idPrefix/);
});

test('tour beats map to graph tour entries by their first resolvable focus', async () => {
  const spec = citySpec({
    tour: [
      { title: 'Second focus resolves', caption: 'c', focus: ['nope', 'WEB'] },
      { title: 'Label focus', focus: ['API W30'] },
      { title: 'Nothing resolves', focus: ['ghost'] },
    ],
  });
  const { graph } = await buildScene(spec, { dir: process.cwd(), theme });
  assert.deepEqual(graph.tour, [
    { title: 'Second focus resolves', caption: 'c', focus: 'web', path: null, reverse: false },
    { title: 'Label focus', caption: '', focus: 'api w30', path: null, reverse: false },
    { title: 'Nothing resolves', caption: '', focus: 'ghost', path: null, reverse: false },
  ]);
});

test('autoplay is carried as an attribute only when there is a tour', async () => {
  const withTour = await buildScene(citySpec({ autoplay: true }), { dir: process.cwd(), theme });
  assert.ok(withTour.html.includes('data-autoplay'));
  const noTour = await buildScene(citySpec({ autoplay: true, tour: [] }), { dir: process.cwd(), theme });
  assert.ok(!noTour.html.includes('data-autoplay'));
});
