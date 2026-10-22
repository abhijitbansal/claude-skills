import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// A kokoro install must run from inside the skill folder so npm applies the skill's package.json
// "overrides" (patched sharp and global-agent). The doctor, the runtime hint and every doc state the
// same command; PR #45 fixed the doctor and missed voice.mjs's hint and schema.md.
const KOKORO_INSTALL = /npm install kokoro-js@\S+[^\n]*/g;

function prefixInstalls(text) {
  return (text.match(KOKORO_INSTALL) ?? []).filter((cmd) => cmd.includes('--prefix'));
}

const DOCS = ['README.md', 'USAGE.md', 'skills/make-motion/README.md', 'skills/make-motion/SKILL.md', 'skills/make-motion/references/schema.md'];

for (const rel of DOCS) {
  test(`${rel} never tells the reader to install kokoro with --prefix`, () => {
    assert.deepEqual(prefixInstalls(fs.readFileSync(path.join(PLUGIN, rel), 'utf8')), []);
  });
}

test('guardrail proof: the check flags the --prefix form and passes the in-folder form', () => {
  assert.equal(prefixInstalls('run `npm install kokoro-js@1.2.1 --no-save --prefix <skill-dir>` first').length, 1);
  assert.equal(prefixInstalls('run `cd <skill-dir> && npm install kokoro-js@1.2.1 --no-save` first').length, 0);
});
