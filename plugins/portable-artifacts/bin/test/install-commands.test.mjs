// Every install command the plugin's documents print carries --ignore-scripts, as the doctor's own `--fix node_modules`,
// `dev_deps` and sister-skill steps do (shared/doctor.mjs): no dependency's install script runs on the user's machine from
// an install this plugin starts. A command is an `npm ci` inside a code span (backticks or <code>) or a fenced block.
// make-motion's own pages are also covered by make-motion-docs.test.mjs. Built-ins only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REPO = path.resolve(PLUGIN, '../..');
const DOCS = [
  'README.md', 'USAGE.md', 'plugins/portable-artifacts/README.md', 'plugins/portable-artifacts/USAGE.md', 'docs/features/portable-artifacts.html',
  ...['make-dashboard', 'make-diagram', 'make-explainer', 'make-motion', 'make-scene'].map((s) => `plugins/portable-artifacts/skills/${s}/README.md`),
  'plugins/portable-artifacts/skills/make-explainer/SKILL.md', 'plugins/portable-artifacts/skills/make-explainer/references/schema.md',
];

/** The `npm ci` commands in `text` (code spans and fenced lines) that lack --ignore-scripts. */
export function installCommandsWithoutFlag(text) {
  const found = [];
  let fenced = false;
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    const spans = fenced ? [line] : [...line.matchAll(/`([^`]*)`|<code>([^<]*)<\/code>/g)].map((m) => m[1] ?? m[2]);
    for (const span of spans) {
      const at = span.search(/\bnpm ci\b/);
      if (at !== -1 && !span.slice(at).includes('--ignore-scripts')) found.push(span.trim());
    }
  }
  return found;
}

test('every `npm ci` the plugin\'s documents print carries --ignore-scripts', () => {
  for (const doc of DOCS) {
    const file = path.join(REPO, doc);
    assert.ok(fs.existsSync(file), `${doc} exists`);
    assert.deepEqual(installCommandsWithoutFlag(fs.readFileSync(file, 'utf8')), [], doc);
  }
});

test('guardrail: a bare `npm ci`, an --omit=dev one and a fenced one are caught; the flagged forms pass', () => {
  assert.deepEqual(installCommandsWithoutFlag('run `npm ci` and <code>npm ci --omit=dev</code>\n```\nnpm ci --prefix x\n```'), ['npm ci', 'npm ci --omit=dev', 'npm ci --prefix x']);
  assert.deepEqual(installCommandsWithoutFlag('run `npm ci --ignore-scripts` and <code>npm ci --ignore-scripts --omit=dev</code>; `npm install --package-lock-only`'), []);
});
