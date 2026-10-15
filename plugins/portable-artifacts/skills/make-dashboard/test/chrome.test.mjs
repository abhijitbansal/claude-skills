import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLE = path.join(ROOT, 'references/examples/sales-overview.json');
const BUILD = path.join(ROOT, 'scripts/build.mjs');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dash-chrome-'));
const build = (args) => spawnSync(process.execPath, [BUILD, ...args], { encoding: 'utf8', env: { ...process.env, SOURCE_DATE_EPOCH: '1792000000' } });
const readPage = (out) => fs.readFileSync(path.join(out, 'index.html'), 'utf8');

test('dashboard page has favicon, generator meta, icon toggle and provenance', () => {
  const out = tmp();
  const r = build([EXAMPLE, '--out', out, '--model', 'Claude Haiku 4.5', '--effort', 'low', '--agent', 'Claude Code']);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const html = readPage(out);
  assert.equal(html.match(/<link rel="icon"/g)?.length, 1);
  assert.equal(html.match(/<meta name="generator"/g)?.length, 1);
  assert.match(html, /portable-artifacts make-dashboard; model=Claude Haiku 4\.5; effort=low; agent=Claude Code/);
  assert.match(html, /<button[^>]*data-theme-toggle[^>]*data-mode="auto"/);
  assert.doesNotMatch(html, /Theme: Auto<\/button>/);
  assert.match(html, /make-dashboard · Claude Haiku 4\.5 · low effort · Claude Code · 14 Oct 2026</); // SOURCE_DATE_EPOCH=1792000000
});

test('hostile --agent fails with exit 1 and writes nothing', () => {
  const out = tmp();
  const r = build([EXAMPLE, '--out', out, '--agent', '<img src=x>']);
  assert.equal(r.status, 1);
  assert.match(r.stdout + r.stderr, /generatedBy/);
  assert.equal(fs.existsSync(path.join(out, 'index.html')), false);
});

test('generatedBy in the spec renders; flags override it', () => {
  const dir = tmp();
  const spec = JSON.parse(fs.readFileSync(EXAMPLE, 'utf8'));
  spec.generatedBy = { model: 'Claude Haiku 4.5', effort: 'low' };
  fs.cpSync(path.join(ROOT, 'references/examples'), dir, { recursive: true });
  const file = path.join(dir, 'c.json');
  fs.writeFileSync(file, JSON.stringify(spec));
  const out = path.join(dir, 'dist');
  const r = build([file, '--out', out, '--agent', 'Codex']);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(readPage(out), /Claude Haiku 4\.5 · low effort · Codex/);
});

test('a non-object generatedBy in the spec is rejected', () => {
  const dir = tmp();
  const spec = JSON.parse(fs.readFileSync(EXAMPLE, 'utf8'));
  spec.generatedBy = 'Claude';
  fs.cpSync(path.join(ROOT, 'references/examples'), dir, { recursive: true });
  const file = path.join(dir, 'd.json');
  fs.writeFileSync(file, JSON.stringify(spec));
  const out = path.join(dir, 'dist');
  const r = build([file, '--out', out, '--model', 'X']);
  assert.equal(r.status, 1);
  assert.match(r.stdout + r.stderr, /generatedBy/);
  assert.equal(fs.existsSync(path.join(out, 'index.html')), false);
});

test('refresh time sits in the footer beside the stamp', () => {
  const out = tmp();
  assert.equal(build([EXAMPLE, '--out', out]).status, 0);
  const html = readPage(out);
  assert.match(html, /<footer class="pa-footer"><p class="refreshed">Refreshed [\s\S]+?<\/p><p class="pa-provenance" title="[^"]*">make-dashboard · /);
  assert.doesNotMatch(html, /<header[\s\S]*class="refreshed"[\s\S]*<\/header>/);
});

test('without SOURCE_DATE_EPOCH the stamp date is the build date', () => {
  const out = tmp();
  const env = { ...process.env };
  delete env.SOURCE_DATE_EPOCH;
  const r = spawnSync(process.execPath, [BUILD, EXAMPLE, '--out', out], { encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  const d = new Date();
  const want = `${d.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  assert.match(readPage(out), new RegExp(`not reported · ${want}<`));
});

test('inline scripts cannot close their element or open an HTML comment', async () => {
  const { renderPage } = await import('../scripts/lib/html.mjs');
  const { loadTheme } = await import('../shared/theme.mjs');
  const vendor = { vega: 'var a="</script><!--";', vegaLite: '', vegaEmbed: '' };
  const html = renderPage({ title: 'T' }, {}, { vendor, theme: loadTheme('paper'), charts: [] });
  assert.doesNotMatch(html, /var a="<\/script>/);
  assert.doesNotMatch(html, /var a="[^"]*<!--/);
  assert.match(html, /var a="<\\\/script><\\!--";/);
});
