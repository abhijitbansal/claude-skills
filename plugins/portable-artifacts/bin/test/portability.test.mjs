import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILLS = fileURLToPath(new URL('../../skills/', import.meta.url));
const HOST_ONLY = [/AskUserQuestion/, /TodoWrite/, /\bSkill\(/, /\bTask tool\b/, /\bsubagent\b/i, /~\/\.claude\b/];
const BASH_ONLY = [/\$\(/, /2>\/dev\/null/, /\|\s*grep\b/, /^\s*export\s+\w+=/m, /(?<![-\w])source\s+\S+/]; // lookbehind: allow the CLI flag `--source name`
const SKILL_DIR_LINE = '`<skill-dir>` is the folder containing this SKILL.md.';

// Commands the agent runs: fenced blocks plus inline code that starts with node/npm/npx.
export function commands(md) {
  const fenced = [...md.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((m) => m[1]);
  const inline = [...md.matchAll(/`((?:node|npm|npx) [^`]+)`/g)].map((m) => m[1]);
  return [...fenced, ...inline];
}

export function problems(md) {
  const out = [];
  for (const re of HOST_ONLY) if (re.test(md)) out.push(`host-only: ${re}`);
  for (const cmd of commands(md)) for (const re of BASH_ONLY) if (re.test(cmd)) out.push(`bash-only in "${cmd.trim().slice(0, 60)}": ${re}`);
  if (!md.includes(SKILL_DIR_LINE)) out.push('missing the <skill-dir> definition line');
  return out;
}

test('guardrail proof: a bad SKILL.md trips every rule', () => {
  const bad = 'Use AskUserQuestion. Save to ~/.claude/x.\n```\nnode a.mjs $(pwd) 2>/dev/null | grep x\n```\n';
  const p = problems(bad);
  assert.ok(p.some((x) => x.includes('AskUserQuestion')));
  assert.ok(p.some((x) => x.includes('.claude')));
  assert.ok(p.some((x) => x.includes('$\\(')));
  assert.ok(p.some((x) => x.includes('<skill-dir>')));
});

for (const skill of fs.readdirSync(SKILLS).filter((d) => fs.existsSync(path.join(SKILLS, d, 'SKILL.md')))) {
  test(`${skill}/SKILL.md is host-neutral`, () => {
    assert.deepEqual(problems(fs.readFileSync(path.join(SKILLS, skill, 'SKILL.md'), 'utf8')), []);
  });
}
