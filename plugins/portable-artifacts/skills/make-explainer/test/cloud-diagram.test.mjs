// A make-explainer page embedding a make-diagram figure that uses cloud icons.
// make-explainer loads make-diagram's own scripts through loadSibling (it keeps no copy of the
// icon catalog), so the page draws the sibling's cloud:<name> markup and scopes its ids per figure.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildPage } from '../scripts/lib/page.mjs';
import { validateSpec } from '../scripts/lib/spec.mjs';
import { buildFile, haveBrowser } from './helpers/browser.mjs';

// Never read the machine's imported-icon folder: point it at an empty temp one.
const ICON_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-cloud-icons-'));
process.env.MAKE_DIAGRAM_ICON_DIR = ICON_DIR;
after(() => fs.rmSync(ICON_DIR, { recursive: true, force: true }));

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHECK = path.join(ROOT, 'scripts/check.mjs');
const CLOUD_EXAMPLE = path.join(ROOT, '../make-diagram/references/examples/cloud-architecture.diagram.json');

const diagram = () => JSON.parse(fs.readFileSync(CLOUD_EXAMPLE, 'utf8'));
const doc = () => ({
  title: 'Cloud doc',
  sections: [
    { type: 'text', title: 'Before', text: 'Intro.' },
    { type: 'diagram', title: 'First figure', diagram: diagram() },
    { type: 'diagram', title: 'Second figure', diagram: diagram() },
  ],
});
const idsOf = (html) => [...html.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1]);

test('a spec embedding a cloud-icon diagram validates', async () => {
  const { ok, errors } = await validateSpec(doc(), { dir: ICON_DIR });
  assert.equal(ok, true, JSON.stringify(errors));
});

test('a missing cloud icon in an embedded diagram fails validation at the field, naming the import command', async () => {
  const bad = diagram();
  bad.nodes[0].icon = 'cloud:aws-zzzz-unlisted-service';
  const { errors } = await validateSpec({ title: 'D', sections: [{ type: 'diagram', diagram: bad }] }, { dir: ICON_DIR });
  assert.equal(errors[0].path, 'sections[0].diagram.nodes[0].icon');
  assert.match(errors[0].message, /icons\.mjs import <aws\|gcp> <folder>/);
});

test('the page draws each figure\'s cloud icons, and two figures share no id', async () => {
  const { html } = await buildPage(doc(), { dir: ICON_DIR });
  assert.equal((html.match(/<g class="pa-icon pa-icon-cloud"/g) ?? []).length, 14, 'seven cloud icons in each of two figures');
  const ids = idsOf(html);
  assert.ok(ids.some((id) => /-ic\d+-/.test(id)), 'cloud icon ids are scoped');
  assert.equal(new Set(ids).size, ids.length, `duplicate ids: ${ids.filter((x, i) => ids.indexOf(x) !== i)}`);
  const refs = [...html.matchAll(/="url\(#([^)]*)\)"/g)].map((m) => m[1]);
  assert.ok(refs.length > 0);
  for (const id of refs) assert.ok(ids.includes(id), `dangling url(#${id})`);
  assert.doesNotMatch(html, /<script[^>]*>[^<]*foreignObject/);
});

test('the built cloud-icon page passes check', async (t) => {
  if (!(await haveBrowser())) { t.skip('no browser (bundled Chromium or system Chrome)'); return; }
  const specFile = path.join(ICON_DIR, 'cloud.explainer.json');
  fs.writeFileSync(specFile, JSON.stringify(doc()));
  const built = buildFile(specFile);
  const r = spawnSync(process.execPath, [CHECK, built.file], { encoding: 'utf8', env: { ...process.env, EVAL_LOG: '' } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout, /skipped/, 'the check ran, it did not skip');
});
