import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildDiagram } from '../scripts/lib/api.mjs';

const BUILD = fileURLToPath(new URL('../scripts/build.mjs', import.meta.url));
const example = (n) => fileURLToPath(new URL(`../references/examples/${n}.diagram.json`, import.meta.url));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'diagram-chrome-'));
const run = (args) => spawnSync(process.execPath, [BUILD, ...args], { encoding: 'utf8', env: { ...process.env, PA_OUTPUT_DIR: tmp(), HOME: tmp(), SOURCE_DATE_EPOCH: '1792000000' } });

test('viewer page has favicon, generator meta, icon toggle and provenance', () => {
  const out = path.join(tmp(), 'a.html');
  const r = run([example('flow'), '--out', out, '--model', 'Claude Haiku 4.5', '--effort', 'low', '--agent', 'Claude Code']);
  assert.equal(r.status, 0, r.stderr);
  const html = fs.readFileSync(out, 'utf8');
  assert.equal(html.match(/<link rel="icon"/g)?.length, 1);
  assert.equal(html.match(/<meta name="generator"/g)?.length, 1);
  assert.match(html, /portable-artifacts make-diagram; model=Claude Haiku 4\.5; effort=low; agent=Claude Code/);
  assert.match(html, /<button[^>]*data-theme-toggle[^>]*data-mode="auto"/);
  assert.match(html, /make-diagram · Claude Haiku 4\.5 · low effort · Claude Code · /);
});

test('hostile --agent fails with exit 1', () => {
  const out = path.join(tmp(), 'b.html');
  const r = run([example('flow'), '--out', out, '--agent', '<img src=x>']);
  assert.equal(r.status, 1);
  assert.match(r.stdout + r.stderr, /generatedBy/);
  assert.equal(fs.existsSync(out), false);
});

test('generatedBy in the spec renders; flags override it', () => {
  const dir = tmp();
  const spec = JSON.parse(fs.readFileSync(example('flow'), 'utf8'));
  spec.generatedBy = { model: 'Claude Haiku 4.5', effort: 'low' };
  const file = path.join(dir, 'c.diagram.json');
  fs.writeFileSync(file, JSON.stringify(spec));
  const out = path.join(dir, 'c.html');
  assert.equal(run([file, '--out', out, '--agent', 'Codex']).status, 0);
  assert.match(fs.readFileSync(out, 'utf8'), /Claude Haiku 4\.5 · low effort · Codex/);
});

test('a non-object generatedBy in the spec is rejected', () => {
  const dir = tmp();
  const spec = JSON.parse(fs.readFileSync(example('flow'), 'utf8'));
  spec.generatedBy = 'Claude';
  const file = path.join(dir, 'd.diagram.json');
  fs.writeFileSync(file, JSON.stringify(spec));
  const out = path.join(dir, 'd.html');
  const r = run([file, '--out', out, '--model', 'X']);
  assert.equal(r.status, 1);
  assert.match(r.stdout + r.stderr, /generatedBy/);
  assert.equal(fs.existsSync(out), false);
});

test('buildDiagram (the embed API) stays chrome-free', async () => {
  const spec = JSON.parse(fs.readFileSync(example('flow'), 'utf8'));
  const built = await buildDiagram(spec, {});
  assert.doesNotMatch(built.svg + built.css, /data-theme-toggle|rel="icon"|pa-provenance/);
});
