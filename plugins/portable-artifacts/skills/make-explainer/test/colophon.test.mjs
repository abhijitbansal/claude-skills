// The closing slide's colophon: one element, one line, the provenance words intact (the "not reported" wording is a
// truth rule: a field the agent did not report must say so).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { colophonText, colophonHtml } from '../scripts/lib/colophon.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPage } from '../scripts/lib/page.mjs';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const build = (spec) => buildPage(spec, { dir: FIXTURES, out: path.join(FIXTURES, '..', '.unused', 'deck.html') });

const DATE = new Date(Date.UTC(2026, 9, 14));

test('nothing reported: the three fields are named once, as not reported', () => {
  assert.equal(colophonText('make-explainer', undefined, DATE, 'paper'), 'make-explainer · model, effort, agent not reported · 14 Oct 2026 · Theme: paper');
});

test('reported fields print their value; the rest are still named as not reported', () => {
  const text = colophonText('make-explainer', { model: 'claude-x', agent: 'Claude Code' }, DATE, 'ink');
  assert.equal(text, 'make-explainer · claude-x · Claude Code · effort not reported · 14 Oct 2026 · Theme: ink');
  assert.equal(colophonText('make-explainer', { model: 'm', effort: 'high', agent: 'a' }, DATE), 'make-explainer · m · high effort · a · 14 Oct 2026');
});

test('markup: one footer holding one paragraph, one class, the full line in its title; hostile text is escaped', () => {
  const html = colophonHtml('make-explainer', { model: '<b>"x"</b>' }, DATE, 'paper');
  assert.match(html, /^<footer class="pa-footer"><p class="pa-colophon" title="[^"]*"><span class="pa-colophon-skill">make-explainer · <\/span>[^<]*<span class="pa-colophon-theme"> · Theme: paper<\/span><\/p><\/footer>$/);
  assert.ok(!html.includes('<b>'));
  assert.equal((html.match(/<p /g) ?? []).length, 1);
});

test('a built deck ends on the colophon: one paragraph in the last slide\'s footer, no page-style provenance and theme lines', async () => {
  const { html } = await build({ title: 'Deck', mode: 'slides', theme: 'paper', sections: [{ type: 'text', title: 'One', text: 'Body.' }] });
  const slides = html.split('<section class="slide ').slice(1);
  const footers = slides.map((s) => s.match(/<footer class="pa-footer">[\s\S]*?<\/footer>/)?.[0]).filter(Boolean);
  assert.equal(footers.length, 1, 'only the last slide has a footer');
  assert.match(footers[0], /<p class="pa-colophon"[^>]*><span class="pa-colophon-skill">make-explainer · <\/span>model, effort, agent not reported · [^<]*<span class="pa-colophon-theme"> · Theme: paper<\/span><\/p>/);
  assert.ok(!/pa-provenance|pa-theme/.test(footers[0]));
});
