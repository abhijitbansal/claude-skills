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
