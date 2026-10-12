import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildProject } from './helpers/browser.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VALIDATE = path.join(ROOT, 'scripts/validate.mjs');
const CSP = `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:`;
const base = {
  title: 'T',
  sources: { sales: { type: 'csv', path: 'data/sales.csv' } },
  queries: { rev: 'SELECT region, SUM(amount) AS revenue FROM sales GROUP BY 1 ORDER BY 2 DESC' },
  charts: [{ id: 'c1', title: 'Chart', query: 'rev', vegaLite: { mark: 'bar', encoding: { x: { field: 'region', type: 'nominal' }, y: { field: 'revenue', type: 'quantitative' } } } }],
};

test('default build embeds the paper theme, its fonts and keeps the strict CSP', () => {
  const { html } = buildProject(base);
  assert.ok(html.includes(`content="${CSP}"`));
  assert.match(html, /--font-display:"Newsreader"/);
  assert.match(html, /@font-face\{font-family:"IBM Plex Sans"/);
  assert.ok(!/Roboto|Arial/.test(html.match(/<style>[\s\S]*?<\/style>/)[0]), 'old system font stack is gone');
  assert.ok(!/https?:\/\//.test(html.replace(/<script>[\s\S]*?<\/script>/g, '')), 'no network URLs outside vendored scripts');
});

test('spec theme and --theme both select a theme; --theme wins', () => {
  assert.match(buildProject({ ...base, theme: 'editorial' }).html, /--font-display:"Bricolage Grotesque"/);
  assert.match(buildProject({ ...base, theme: 'editorial' }, { theme: 'blueprint' }).html, /--font-display:"IBM Plex Sans"/);
});

test('unknown spec theme is a validation error with did-you-mean', () => {
  const { file } = buildProject(base);
  fs.writeFileSync(file, JSON.stringify({ ...base, theme: 'papr' }));
  const r = spawnSync(process.execPath, [VALIDATE, file], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^theme: unknown theme "papr"; did you mean "paper"\?/m);
});

test('page font payload stays within 200 KB', () => {
  const { html } = buildProject(base);
  const bytes = [...html.matchAll(/base64,([A-Za-z0-9+/=]+)\)/g)].reduce((n, m) => n + Buffer.from(m[1], 'base64').length, 0);
  assert.ok(bytes > 0 && bytes <= 200 * 1024, `${bytes} bytes`);
});

test('theme toggle ships with the "Theme: Auto" label', () => {
  const { html } = buildProject(base);
  assert.match(html, /data-theme-toggle aria-label="Theme: Auto\. Change theme">Theme: Auto<\/button>/);
});
