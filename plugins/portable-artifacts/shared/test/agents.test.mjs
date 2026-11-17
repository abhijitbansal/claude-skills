import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AGENT_HOSTS, AGENT_NAME, agentFile, INSTRUCTIONS, tomlString, writeAgentFile } from '../agents.mjs';

const PHRASES = [
  /already artifact-builder/,
  /Never delegate/,
  /scripts\/make\.mjs/,
  /--json/,
  /--out/,
  /"mechanical"/,
  /"creative"/,
  /at most 2 times/,
  /reply with only the last report/i,
  /Never report an output path for a build that did not run/,
];

function checkBody(body) {
  assert.ok(body.includes(INSTRUCTIONS), 'body contains INSTRUCTIONS exactly');
  for (const p of PHRASES) assert.match(body, p);
}

test('AGENT_NAME is artifact-builder', () => {
  assert.equal(AGENT_NAME, 'artifact-builder');
});

test('AGENT_HOSTS is claude, copilot, codex', () => {
  assert.deepEqual([...AGENT_HOSTS], ['claude', 'copilot', 'codex']);
});

// The operator runs one command. The old text told it to read SKILL.md, write the spec and run two scripts,
// which was wrong for make-motion (no build script) and let a cheap model choose the content.
test('the instructions name make.mjs and --json, and name no validate or build script', () => {
  assert.match(INSTRUCTIONS, /node <skill-dir>\/scripts\/make\.mjs <spec> --json/);
  assert.doesNotMatch(INSTRUCTIONS, /validate script/i);
  assert.doesNotMatch(INSTRUCTIONS, /build script/i);
  assert.doesNotMatch(INSTRUCTIONS, /validate\.mjs|build\.mjs/);
});

test('the instructions forbid writing a spec and acting on creative findings, and allow two fix rounds', () => {
  assert.match(INSTRUCTIONS, /Never create a spec/);
  assert.match(INSTRUCTIONS, /Never change wording, theme, look, layout, or data/);
  assert.match(INSTRUCTIONS, /Never act on a "creative" finding/);
  assert.match(INSTRUCTIONS, /change only the JSON paths those findings name/);
  assert.match(INSTRUCTIONS, /at most 2 times/);
  // Nothing in the text asks for a spec, a theme or new wording: every such verb is under a "Never".
  for (const sentence of INSTRUCTIONS.split(/(?<=\.)\s+/)) {
    if (/\b(write|create|choose|pick|reword|rewrite)\b[^.]*\b(spec|theme|look|wording)\b/i.test(sentence)) {
      assert.match(sentence, /\bNever\b|\bnever\b/, `unforbidden: ${sentence}`);
    }
  }
});

test('the instructions say to reply with the report only', () => {
  assert.match(INSTRUCTIONS, /Reply with only the last report, as JSON\. No other text\./);
  assert.match(INSTRUCTIONS, /cannot run/);
  assert.match(INSTRUCTIONS, /empty path/);
});

test('the claude agent file has name, description, model haiku and a tools line without a subagent tool or Write', () => {
  const { fileName, content } = agentFile('claude');
  assert.equal(fileName, 'artifact-builder.md');
  assert.ok(content.startsWith('---\n'));
  const front = content.slice(4, content.indexOf('\n---\n', 4));
  const lines = front.split('\n');
  assert.deepEqual(lines.map((l) => l.split(':')[0]), ['name', 'description', 'model', 'tools']);
  assert.equal(lines[0], 'name: artifact-builder');
  assert.equal(lines[2], 'model: haiku');
  const desc = lines[1].slice('description: '.length);
  assert.ok(desc.length > 0 && !desc.includes(': ') && !desc.includes(' #'), 'strict-YAML-safe one-line description');
  const tools = lines[3].slice('tools: '.length).split(',').map((t) => t.trim());
  assert.deepEqual(tools, ['Read', 'Edit', 'Bash']);
  for (const banned of ['Write', 'Agent', 'Task', 'NotebookEdit']) assert.ok(!tools.includes(banned), banned);
  checkBody(content.slice(content.indexOf('\n---\n', 4) + 5));
});

// The plugin ships agents/artifact-builder.md and install.mjs writes the same text for non-plugin installs.
const PLUGIN_AGENT = fileURLToPath(new URL('../../agents/artifact-builder.md', import.meta.url));
const matchesClaudeBuilder = (text) => text === agentFile('claude').content;

test('P/agents/artifact-builder.md equals agentFile(claude).content', () => {
  assert.ok(matchesClaudeBuilder(fs.readFileSync(PLUGIN_AGENT, 'utf8')));
});

test('guard: the equality check fails on a changed byte, a missing newline or an extra one', () => {
  const on = fs.readFileSync(PLUGIN_AGENT, 'utf8');
  assert.equal(matchesClaudeBuilder(on.replace('model: haiku', 'model: sonnet')), false);
  assert.equal(matchesClaudeBuilder(on.slice(0, -1)), false);
  assert.equal(matchesClaudeBuilder(`${on}\n`), false);
});

test('copilot agent file has cheap model list and frontmatter', () => {
  const { fileName, content } = agentFile('copilot');
  assert.equal(fileName, 'artifact-builder.agent.md');
  assert.ok(content.startsWith('---\n'));
  assert.match(content, /^name: artifact-builder$/m);
  assert.ok(content.split('\n').includes("model: ['Claude Haiku 5.5', 'GPT-5.4 nano']"));
  const desc = content.match(/^description: (.+)$/m);
  assert.ok(desc, 'single-line description');
  assert.ok(!desc[1].includes(': ') && !desc[1].includes(' #'), 'strict-YAML-safe description');
  checkBody(content.slice(content.indexOf('\n---\n', 4) + 5));
  assert.ok(!/^tools:/m.test(content), 'no tools key');
});

test('codex agent file has luna model, low effort, safe literal block', () => {
  const { fileName, content } = agentFile('codex');
  assert.equal(fileName, 'artifact-builder.toml');
  assert.match(content, /^name = "artifact-builder"$/m);
  assert.match(content, /^model = "gpt-6-luna"$/m);
  assert.match(content, /^model_reasoning_effort = "low"$/m);
  const open = content.indexOf("developer_instructions = '''");
  assert.ok(open >= 0);
  const inner = content.slice(open + "developer_instructions = '''".length);
  const close = inner.lastIndexOf("'''");
  assert.ok(close >= 0);
  assert.ok(!inner.slice(0, close).includes("'''"));
  checkBody(inner.slice(0, close));
  assert.ok(!/^(sandbox_mode|tools)\b/m.test(content), 'no sandbox_mode or tools');
});

test('tomlString escapes quotes, backslashes and newlines', () => {
  assert.equal(tomlString('a"b\\c\nd'), '"a\\"b\\\\c\\nd"');
});

test('unknown host throws', () => {
  assert.throws(() => agentFile('gemini'), /unknown agent host/);
});

test('INSTRUCTIONS has no three single quotes in a row (the TOML literal block would end early)', () => {
  assert.ok(!INSTRUCTIONS.includes("'''"));
});

// Writer + CLI: shared by bin/install.mjs and `doctor --fix builder_agent`.
const AGENTS = fileURLToPath(new URL('../agents.mjs', import.meta.url));
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'agents-'));

test('writeAgentFile: writes a new file, keeps an existing one without force, replaces with force', () => {
  const dir = path.join(tmpDir(), 'agents');
  const file = path.join(dir, 'a.md');
  assert.equal(writeAgentFile(dir, file, 'one', false), 'written');
  assert.equal(writeAgentFile(dir, file, 'two', false), 'kept');
  assert.equal(fs.readFileSync(file, 'utf8'), 'one');
  assert.equal(writeAgentFile(dir, file, 'two', true), 'written');
  assert.equal(fs.readFileSync(file, 'utf8'), 'two');
});

test('writeAgentFile: never writes through a symlink; a directory is not-file', () => {
  const root = tmpDir();
  const dir = path.join(root, 'agents');
  fs.mkdirSync(dir);
  const target = path.join(root, 'victim.txt');
  fs.writeFileSync(target, 'keep me');
  fs.symlinkSync(target, path.join(dir, 'a.md'));
  assert.equal(writeAgentFile(dir, path.join(dir, 'a.md'), 'new', false), 'kept');
  assert.equal(writeAgentFile(dir, path.join(dir, 'a.md'), 'new', true), 'written');
  assert.equal(fs.readFileSync(target, 'utf8'), 'keep me');
  fs.mkdirSync(path.join(dir, 'd.md'));
  assert.equal(writeAgentFile(dir, path.join(dir, 'd.md'), 'x', true), 'not-file');
});

test('cli: `write claude <dir>` creates artifact-builder.md and exits 0', () => {
  const dir = path.join(tmpDir(), 'agents');
  const r = spawnSync(process.execPath, [AGENTS, 'write', 'claude', dir], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(path.join(dir, 'artifact-builder.md'), 'utf8'), agentFile('claude').content);
  assert.match(r.stdout, /agent: .*artifact-builder\.md/);
});

test('cli: `write copilot <dir>` creates artifact-builder.agent.md and exits 0', () => {
  const dir = path.join(tmpDir(), 'agents');
  const r = spawnSync(process.execPath, [AGENTS, 'write', 'copilot', dir], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(path.join(dir, 'artifact-builder.agent.md'), 'utf8'), agentFile('copilot').content);
  assert.match(r.stdout, /agent: .*artifact-builder\.agent\.md/);
});

test('cli: `write codex <dir>` creates artifact-builder.toml; a second run keeps it', () => {
  const dir = path.join(tmpDir(), 'agents');
  assert.equal(spawnSync(process.execPath, [AGENTS, 'write', 'codex', dir]).status, 0);
  const again = spawnSync(process.execPath, [AGENTS, 'write', 'codex', dir], { encoding: 'utf8' });
  assert.equal(again.status, 0);
  assert.match(again.stdout, /kept existing/);
  assert.equal(fs.readFileSync(path.join(dir, 'artifact-builder.toml'), 'utf8'), agentFile('codex').content);
});

test('cli: a dir that looks like a flag is refused and nothing is created', () => {
  const cwd = tmpDir();
  const r = spawnSync(process.execPath, [AGENTS, 'write', 'copilot', '--force'], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage: /);
  assert.deepEqual(fs.readdirSync(cwd), []);
});

test('cli: runs through a symlinked agents.mjs (the npx skills layout)', () => {
  const root = tmpDir();
  const link = path.join(root, 'agents-link.mjs');
  fs.symlinkSync(AGENTS, link);
  const dir = path.join(root, 'agents');
  const r = spawnSync(process.execPath, [link, 'write', 'codex', dir], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(dir, 'artifact-builder.toml')));
});

test('importing the module never throws or writes, even when argv[1] is not a real path', () => {
  const cwd = tmpDir();
  const code = `import(${JSON.stringify(AGENTS)}).then((m) => console.log(typeof m.agentFile))`;
  const r = spawnSync(process.execPath, ['-e', code, 'no-such-path'], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), 'function');
  assert.deepEqual(fs.readdirSync(cwd), []);
});

test('cli: unknown host, missing dir or unknown command exit 2 with usage and write nothing', () => {
  const dir = path.join(tmpDir(), 'agents');
  for (const args of [['write', 'gemini', dir], ['write', 'copilot'], ['frobnicate'], []]) {
    const r = spawnSync(process.execPath, [AGENTS, ...args], { encoding: 'utf8' });
    assert.equal(r.status, 2, args.join(' '));
    assert.match(r.stderr, /usage: .*agents\.mjs write <claude\|copilot\|codex> <agents-dir>/);
  }
  assert.equal(fs.existsSync(dir), false);
});
