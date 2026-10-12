import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

// A copy of siblings.mjs inside <root>/make-explainer/scripts/lib, so the
// default resolution (skill dir's parent) is exercised against a temp layout.
async function layout(siblings = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pa-sib-')));
  made.push(root);
  const lib = path.join(root, 'make-explainer/scripts/lib');
  fs.mkdirSync(lib, { recursive: true });
  fs.copyFileSync(new URL('../scripts/lib/siblings.mjs', import.meta.url), path.join(lib, 'siblings.mjs'));
  for (const [name, files] of Object.entries(siblings)) {
    for (const [rel, body] of Object.entries(files)) {
      const f = path.join(root, name, rel);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, body);
    }
  }
  const mod = await import(pathToFileURL(path.join(lib, 'siblings.mjs')).href);
  return { root, mod };
}

test('siblingDir resolves next to make-explainer without checking existence', async () => {
  const { root, mod } = await layout();
  assert.equal(mod.siblingDir('make-diagram'), path.join(root, 'make-diagram'));
});

test('loadSibling imports a module from the sibling skill', async () => {
  const { mod } = await layout({ 'make-diagram': { 'scripts/api.mjs': 'export const answer = 42;\n' } });
  const api = await mod.loadSibling('make-diagram', 'scripts/api.mjs');
  assert.equal(api.answer, 42);
});

test('MISSING_HINT is the exact install line', async () => {
  const { mod } = await layout();
  assert.equal(
    mod.MISSING_HINT(['make-diagram', 'make-dashboard']),
    'install it with: npx skills add abhijitbansal/claude-skills --skill make-explainer make-diagram make-dashboard',
  );
});

test('a missing sibling directory throws SiblingError with the exact command', async () => {
  const { root, mod } = await layout();
  await assert.rejects(
    () => mod.loadSibling('make-diagram', 'scripts/api.mjs'),
    (e) => {
      assert.ok(e instanceof mod.SiblingError);
      assert.equal(e.name, 'SiblingError');
      assert.equal(e.command, 'npx skills add abhijitbansal/claude-skills --skill make-explainer make-diagram');
      assert.equal(
        e.message,
        `make-diagram skill not found next to make-explainer (looked in ${path.join(root, 'make-diagram')}); install it with: ${e.command}`,
      );
      return true;
    },
  );
});

test('a sibling dir without the requested module throws SiblingError too', async () => {
  const { mod } = await layout({ 'make-diagram': { 'SKILL.md': 'x' } });
  await assert.rejects(
    () => mod.loadSibling('make-diagram', 'scripts/api.mjs'),
    (e) => e instanceof mod.SiblingError && /scripts\/api\.mjs/.test(e.message) && /npx skills add .* make-diagram$/.test(e.command),
  );
});

test('a sibling module that itself throws on import is not masked as missing', async () => {
  const { mod } = await layout({ 'make-diagram': { 'scripts/api.mjs': 'throw new Error("boom");\n' } });
  await assert.rejects(() => mod.loadSibling('make-diagram', 'scripts/api.mjs'), (e) => !(e instanceof mod.SiblingError) && /boom/.test(e.message));
});

test('sibling names must be plain skill names (no path escape)', async () => {
  const { mod } = await layout();
  assert.throws(() => mod.siblingDir('../etc'), /sibling name/);
  await assert.rejects(() => mod.loadSibling('make-diagram', '../../x.mjs'), /module path/);
});
