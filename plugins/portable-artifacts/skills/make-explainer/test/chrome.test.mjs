import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BUILD = fileURLToPath(new URL('../scripts/build.mjs', import.meta.url));
const EXAMPLES = fileURLToPath(new URL('../references/examples/', import.meta.url));
const run = (args) => spawnSync(process.execPath, [BUILD, ...args], {
  encoding: 'utf8', env: { ...process.env, EVAL_LOG: '', PA_OUTPUT_DIR: '', SOURCE_DATE_EPOCH: '1792000000' },
});
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-chrome-')));

function buildExample(name, extra = []) {
  const out = path.join(tmp(), `${name}.html`);
  const r = run([path.join(EXAMPLES, `${name}.explainer.json`), '--out', out, ...extra]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  return fs.readFileSync(out, 'utf8');
}

for (const name of ['recap', 'slides']) {
  test(`${name}: one favicon, one generator meta, one icon toggle, a provenance line`, () => {
    const html = buildExample(name, ['--model', 'Claude Opus 5.5', '--effort', 'high', '--agent', 'Claude Code']);
    assert.equal(html.match(/<link rel="icon"/g)?.length, 1);
    assert.equal(html.match(/<meta name="generator"/g)?.length, 1);
    assert.match(html, /content="portable-artifacts make-explainer; model=Claude Opus 5.5; effort=high; agent=Claude Code"/);
    assert.equal(html.match(/<button[^>]*data-theme-toggle/g)?.length, 1);
    assert.equal(html.match(/__paThemeToggle = true/g)?.length, 1);
    assert.match(html, /data-mode="auto"/);
    assert.match(html, /class="pa-ti pa-ti-light"/);
    assert.doesNotMatch(html, />Theme: Auto</);
    assert.match(html, /make-explainer · Claude Opus 5.5 · high effort · Claude Code · /);
  });
}

test('generatedBy in the spec renders; flags override it', () => {
  const dir = tmp();
  const spec = JSON.parse(fs.readFileSync(path.join(EXAMPLES, 'concept.explainer.json'), 'utf8'));
  spec.generatedBy = { model: 'Claude Haiku 4.5', effort: 'low' };
  const file = path.join(dir, 'c.explainer.json');
  fs.writeFileSync(file, JSON.stringify(spec));
  fs.copyFileSync(path.join(EXAMPLES, 'pipeline.svg'), path.join(dir, 'pipeline.svg')); // the concept example embeds it
  const out = path.join(dir, 'c.html');
  assert.equal(run([file, '--out', out, '--agent', 'Codex']).status, 0);
  assert.match(fs.readFileSync(out, 'utf8'), /Claude Haiku 4\.5 · low effort · Codex/);
});

test('hostile --model fails validation with exit 1 and writes nothing', () => {
  const out = path.join(tmp(), 'x.html');
  const r = run([path.join(EXAMPLES, 'recap.explainer.json'), '--out', out, '--model', 'x"><script>alert(1)</script>']);
  assert.equal(r.status, 1);
  assert.match(r.stderr + r.stdout, /generatedBy/);
  assert.equal(fs.existsSync(out), false);
});

test('a non-object generatedBy in the spec is rejected at /generatedBy', () => {
  const dir = tmp();
  const spec = JSON.parse(fs.readFileSync(path.join(EXAMPLES, 'concept.explainer.json'), 'utf8'));
  spec.generatedBy = 'Claude';
  const file = path.join(dir, 'c.explainer.json');
  fs.writeFileSync(file, JSON.stringify(spec));
  const out = path.join(dir, 'c.html');
  const r = run([file, '--out', out, '--model', 'X']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /generatedBy/);
  assert.equal(fs.existsSync(out), false);
});

test('an embedded diagram adds no second favicon, meta or toggle', () => {
  const out = path.join(tmp(), 'all.html');
  const fixture = fileURLToPath(new URL('./fixtures/all-types.explainer.json', import.meta.url));
  const r = run([fixture, '--out', out]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const html = fs.readFileSync(out, 'utf8');
  assert.equal(html.match(/<link rel="icon"/g)?.length, 1);
  assert.equal(html.match(/<meta name="generator"/g)?.length, 1);
  assert.equal(html.match(/<button[^>]*data-theme-toggle/g)?.length, 1);
  assert.equal(html.match(/__paThemeToggle = true/g)?.length, 1);
});
