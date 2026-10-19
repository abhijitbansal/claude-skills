// Sibling loading: the folder next to make-scene, the exact install command when it is missing, and the
// injectable root the lift tests use. Adapted from make-explainer's siblings tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { MISSING_HINT, SiblingError, installCommand, loadSibling, siblingDir } from '../scripts/lib/siblings.mjs';
import { tempDir } from './helpers/scene-fixtures.mjs';

const skillWith = (root, name, files) => {
  for (const [rel, body] of Object.entries(files)) {
    const file = path.join(root, name, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  }
};

test('siblingDir resolves next to make-scene, or under an injected root, without checking existence', (t) => {
  assert.equal(siblingDir('make-diagram'), path.resolve(new URL('../..', import.meta.url).pathname, 'make-diagram'));
  const root = tempDir(t);
  assert.equal(siblingDir('make-diagram', { root }), path.join(root, 'make-diagram'));
  assert.throws(() => siblingDir('../escape'), TypeError);
});

test('loadSibling imports a module from the sibling skill', async (t) => {
  const root = tempDir(t);
  skillWith(root, 'make-diagram', { 'scripts/api.mjs': 'export const answer = 42;\n' });
  assert.equal((await loadSibling('make-diagram', 'scripts/api.mjs', { root })).answer, 42);
});

test('MISSING_HINT is the exact install line', () => {
  assert.equal(
    MISSING_HINT(['make-diagram', 'make-dashboard']),
    'install it with: npx --yes skills@1.7.2 add abhijitbansal/claude-skills --skill make-diagram make-dashboard -y',
  );
});

test('a missing sibling directory throws SiblingError with the exact command, saying next to make-scene', async (t) => {
  const root = tempDir(t);
  await assert.rejects(
    () => loadSibling('make-diagram', 'scripts/lib/api.mjs', { root }),
    (e) => {
      assert.ok(e instanceof SiblingError);
      assert.equal(e.command, installCommand(['make-diagram']));
      assert.ok(e.message.startsWith(`make-diagram skill not found next to make-scene (looked in ${path.join(root, 'make-diagram')}); install it with: ${e.command}`));
      assert.match(e.message, /\(doctor: node .*doctor\.mjs.*, id make-diagram\)$/);
      return true;
    },
  );
});

test('a sibling folder without the module names the module', async (t) => {
  const root = tempDir(t);
  skillWith(root, 'make-diagram', { 'README.md': 'x' });
  await assert.rejects(() => loadSibling('make-diagram', 'scripts/lib/api.mjs', { root }), /make-diagram\/scripts\/lib\/api\.mjs not found in .*make-diagram; install it with/);
});

test('a module path that leaves the sibling folder is refused', async (t) => {
  const root = tempDir(t);
  await assert.rejects(() => loadSibling('make-diagram', '../make-scene/package.json', { root }), TypeError);
  await assert.rejects(() => loadSibling('make-diagram', '/etc/passwd', { root }), TypeError);
});
