import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// `npx skills` (vercel-labs/skills) parses SKILL.md frontmatter as strict YAML
// and silently skips a skill whose plain-scalar value contains ": " or " #".
// The repo's own registry parser wants single-line values. Keep both happy.
const SKILLS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../skills');

for (const skill of fs.readdirSync(SKILLS).filter((d) => fs.existsSync(path.join(SKILLS, d, 'SKILL.md')))) {
  test(`${skill}/SKILL.md frontmatter is strict-YAML-safe single-line key: value`, () => {
    const md = fs.readFileSync(path.join(SKILLS, skill, 'SKILL.md'), 'utf8');
    const m = md.match(/^---\n([\s\S]*?)\n---\n/);
    assert.ok(m, 'frontmatter block');
    const fields = {};
    for (const line of m[1].split('\n')) {
      const kv = line.match(/^([a-z][a-z-]*): (.+)$/);
      assert.ok(kv, `not a single-line key: value: ${line}`);
      const [, key, value] = kv;
      assert.ok(!/^[>|]/.test(value), `${key}: folded/literal scalars are not allowed`);
      assert.ok(!value.includes(': '), `${key}: value contains ": " (strict YAML rejects it)`);
      assert.ok(!value.includes(' #'), `${key}: value contains " #" (YAML comment)`);
      assert.ok(!/^["'&*!%@`{[]/.test(value), `${key}: value starts with a YAML indicator`);
      fields[key] = value;
    }
    assert.equal(fields.name, skill, 'name matches the folder');
    assert.ok(fields.description?.length > 40 && fields.description.length <= 1024, 'description 41-1024 chars');
  });
}
