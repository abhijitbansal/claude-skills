import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILLS = fileURLToPath(new URL('../../skills/', import.meta.url));

// Tool names and paths that exist on one host only.
const HOST_ONLY = [
  /AskUserQuestion/, /TodoWrite/, /\bSkill\(/, /\bTask tool\b/, /\bsubagents?\b/i,
  /(~|\$HOME|%USERPROFILE%)[\\/]\.claude\b/,
  /\b(WebFetch|WebSearch|NotebookEdit)\b/, /\bmcp__/,
];
// Shell syntax that bash and zsh accept but PowerShell or cmd.exe do not.
const BASH_ONLY = [
  /\$\(/, /`[^`]*`/, /2>\/dev\/null/, /2>&1/, /\|\s*grep\b/, /\|\s*tee\b/, /&&/,
  /<<-?\s*['"]?\w+/, /\s>>?\s*[\w./~$]/,
  /^\s*export\s+\w+=/m, /^\s*\w+=\S*\s+\w/m,
  /(^|[;&|]\s*)source\s+\S+/m, // line-start only: `--source shop` is a CLI flag
  /(^|[;&|]\s*)\.\s+\S+/m,
  /(^|\s)~\//, /\$[A-Za-z_]\w*/, /(^|\s)\S*\*\S*/,
];
const SKILL_DIR_LINE = '`<skill-dir>` is the folder containing this SKILL.md.';
const INLINE_COMMAND = /^(?:(?:node|npm|npx|cat|cd|ls|export|source|echo|rm|cp|mv)\b|\w+=\S+\s+\w)/;

// Commands the agent runs: fenced blocks (``` or ~~~, any info string, json skipped)
// plus inline code that starts with a command word or an env assignment.
export function commands(raw) {
  const md = raw.replace(/\r\n?/g, '\n');
  const fenced = [];
  const prose = md.replace(/^[ \t]*(```|~~~)([^\n]*)\n([\s\S]*?)^[ \t]*\1[ \t]*$/gm, (_, _f, info, body) => {
    if (!/^\s*json/i.test(info)) fenced.push(body);
    return '';
  });
  const inline = [...prose.matchAll(/(``?)(?!`)(.+?)\1(?!`)/g)].map((m) => m[2].trim()).filter((c) => INLINE_COMMAND.test(c));
  return [...fenced, ...inline];
}

export function problems(md) {
  const out = [];
  for (const re of HOST_ONLY) if (re.test(md)) out.push(`host-only: ${re}`);
  for (const cmd of commands(md)) for (const re of BASH_ONLY) if (re.test(cmd)) out.push(`bash-only in "${cmd.trim().slice(0, 60)}": ${re}`);
  if (!md.includes(SKILL_DIR_LINE)) out.push('missing the <skill-dir> definition line');
  return out;
}

const L = `${SKILL_DIR_LINE}\n`;
const flagged = (body) => problems(L + body);

// One fixture per rule: the hit list must name that rule, so a rule cannot go dead unnoticed.
// Fixtures avoid tripping other rules, so a shared hit cannot mask a dead rule.
const FIXTURES = [
  ['Use AskUserQuestion.', 'AskUserQuestion'],
  ['Use TodoWrite.', 'TodoWrite'],
  ['Call Skill(x).', 'Skill'],
  ['Use the Task tool.', 'Task tool'],
  ['Spawn subagents.', 'subagent'],
  ['Save to ~/.claude/x.', '.claude'],
  ['Save to $HOME/.claude/x.', '.claude'],
  ['Save to %USERPROFILE%\\.claude.', '.claude'],
  ['Use WebFetch.', 'WebFetch'],
  ['call mcp__foo__bar', 'mcp__'],
  ['Run `node a.mjs $(pwd)`.', '\\$\\('],
  ['Run ``node a.mjs `pwd` ``.', '`'],
  ['```\nnode a.mjs 2>/dev/null\n```\n', 'dev/null'],
  ['```\nnode a.mjs 2>&1\n```\n', '2>&1'],
  ['```\nnode a.mjs | grep x\n```\n', 'grep'],
  ['Run `node a.mjs | tee log`.', 'tee'],
  ['Run `cd x && node a.mjs`.', '&&'],
  ['Run `node a.mjs <<EOF`.', '<<'],
  ['Run `node a.mjs > out.json`.', '>'],
  ['```sh\nexport X=1\n```\n', 'export'],
  ['   ```sh\n   export X=1\n   ```\n', 'export'],
  ['Run `PA_OUTPUT_DIR=out node build.mjs`.', 'bash-only'],
  ['```\nsource venv/bin/activate\n```\n', 'source'],
  ['```\n. venv/bin/activate\n```\n', 'bash-only'],
  ['Run `node build.mjs --out ~/x`.', '~'],
  ['Run `node build.mjs --out $HOME/x`.', 'bash-only'],
  ['Run `node validate.mjs *.json`.', '\\*'],
  ['```PowerShell\nnode a.mjs $(pwd)\n```\n', '\\$\\('],
  ['```bash\r\nnode a.mjs $(pwd)\r\n```\r\n', '\\$\\('],
  ['~~~\nnode a.mjs $(pwd)\n~~~\n', '\\$\\('],
];

test('guardrail proof: every rule fires on its own fixture', () => {
  for (const [body, needle] of FIXTURES) {
    assert.ok(flagged(body).some((x) => x.includes(needle) || new RegExp(needle).test(x)), `no problem containing "${needle}" for: ${JSON.stringify(body)}`);
  }
  assert.ok(problems('nothing here').some((x) => x.includes('<skill-dir>')), 'missing <skill-dir> line must fire');
});

test('guardrail proof: legitimate text is not flagged', () => {
  const ok = [
    'Run `node <skill-dir>/scripts/inspect.mjs --spec d.json --source shop`.',
    '```json\n{"note": "the source of truth"}\n```\n',
    'In Claude Code suggest prefixing it with `!`; Codex and Copilot CLI differ.',
    'Writes to ~/.agent/diagrams/ by default.',
  ];
  for (const body of ok) assert.deepEqual(flagged(body), [], body);
});

for (const skill of fs.readdirSync(SKILLS).filter((d) => fs.existsSync(path.join(SKILLS, d, 'SKILL.md')))) {
  test(`${skill}/SKILL.md is host-neutral`, () => {
    assert.deepEqual(problems(fs.readFileSync(path.join(SKILLS, skill, 'SKILL.md'), 'utf8')), []);
  });
}
