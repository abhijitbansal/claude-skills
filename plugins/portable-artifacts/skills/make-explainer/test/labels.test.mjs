import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { slideBudget } from '../scripts/lib/slides.mjs';

const BUILD = fileURLToPath(new URL('../scripts/build.mjs', import.meta.url));
const doc = (sections) => ({ title: 'T', sections });
const text = (title, label) => ({ type: 'text', title, ...(label ? { label } : {}), text: 'Short paragraph.' });
async function html(spec) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-labels-'));
  const file = path.join(dir, 's.explainer.json');
  const out = path.join(dir, 's.html');
  fs.writeFileSync(file, JSON.stringify(spec));
  const r = spawnSync(process.execPath, [BUILD, file, '--out', out], { encoding: 'utf8', env: { ...process.env, EVAL_LOG: '', PA_OUTPUT_DIR: '' } });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  return fs.readFileSync(out, 'utf8');
}

test('TOC uses label when present, title otherwise', async () => {
  const h = await html(doc([text('Haiku passed all thirty prompts', 'Eval results'), text('Second'), text('Third'), text('Fourth')]));
  assert.match(h, /<nav class="toc"[\s\S]*>Eval results<\/a>[\s\S]*>Second<\/a>/);
});

test('label renders as an eyebrow above the heading', async () => {
  const h = await html(doc([text('Finding', 'Context')]));
  assert.match(h, /<p class="sec-eyebrow pa-label">Context<\/p>\s*<h2 class="sec-title"/);
});

test('a leading tldr renders in the hero, once', async () => {
  const h = await html(doc([{ type: 'tldr', text: 'Lead.', points: ['a', 'b'] }, text('Next')]));
  assert.match(h, /<header class="hero"[\s\S]*class="hero-tldr"[\s\S]*Lead\.[\s\S]*<\/header>/);
  assert.equal(h.match(/Lead\./g).length, 1);
});

test('a tldr that is not first stays in the flow', async () => {
  const h = await html(doc([text('First'), { type: 'tldr', text: 'Later.' }]));
  assert.doesNotMatch(h, /class="hero-tldr"/);
});

test('a section label does not count toward the slide word budget', () => {
  const words = (n) => Array.from({ length: n }, () => 'w').join(' ');
  const spec = { title: 'T', mode: 'slides', sections: [{ type: 'text', title: 'A claim', label: 'Four word label here', text: words(80) }] };
  assert.deepEqual(slideBudget(spec), []);
});

// ---- review round 1 -----------------------------------------------------------------------

test('the band set is exactly kpis, cards, compare, diagram and chart', async () => {
  const { SECTIONS } = await import('../scripts/lib/sections.mjs');
  const banded = Object.entries(SECTIONS).filter(([, def]) => def.band).map(([type]) => type).sort();
  assert.deepEqual(banded, ['cards', 'chart', 'compare', 'diagram', 'kpis']);
});

test('the band starts on the first visual section and alternates (1st, 3rd, ...)', async () => {
  const kpis = (title) => ({ type: 'kpis', title, items: [{ label: 'n', value: 1 }] });
  const cards = (title) => ({ type: 'cards', title, items: [{ title: 'c', text: 't' }] });
  const h = await html(doc([text('Intro'), kpis('One'), text('Between'), cards('Two'), kpis('Three'), cards('Four')]));
  const classes = [...h.matchAll(/<section class="(sec sec-(?:kpis|cards)[^"]*)"/g)].map((m) => m[1].includes('sec-alt'));
  assert.deepEqual(classes, [true, false, true, false]);
});

test('a title-less hero tldr is named "Summary"; a label on it shows as its eyebrow and names it', async () => {
  const bare = await html(doc([{ type: 'tldr', text: 'Lead.' }, text('Next')]));
  assert.match(bare, /<div class="hero-tldr[^"]*" id="[^"]+" role="region" aria-label="Summary">/);
  const header = bare.slice(bare.indexOf('<header'), bare.indexOf('</header>'));
  assert.doesNotMatch(header, /sec-eyebrow/);
  const labelled = await html(doc([{ type: 'tldr', label: 'In short', text: 'Lead.' }, text('Next')]));
  assert.match(labelled, /<div class="hero-tldr[^"]*" id="[^"]+" role="region" aria-label="In short">\s*<p class="sec-eyebrow pa-label">In short<\/p>/);
});

test('with a label, the hero card keeps its title for screen readers only', async () => {
  const h = await html(doc([{ type: 'tldr', title: 'The finding', label: 'Verdict', text: 'Lead.' }, text('Next')]));
  assert.match(h, /aria-labelledby="([^"]+)">\s*<p class="sec-eyebrow pa-label">Verdict<\/p>\s*<h2 class="hero-tldr-title sr-only" id="\1">The finding<\/h2>/);
});

test('the hero card carries the tldr tone so its rule can follow it', async () => {
  const h = await html(doc([{ type: 'tldr', tone: 'warn', text: 'Lead.' }, text('Next')]));
  assert.match(h, /<div class="hero-tldr tone-warn"/);
});

test('a tldr that is the only section stays in <main>, so the skip link has a target with content', async () => {
  const h = await html(doc([{ type: 'tldr', text: 'Only.' }]));
  assert.doesNotMatch(h, /class="hero-tldr/);
  assert.match(h, /<main id="content" class="sections">\s*<section class="sec sec-tldr"/);
});
