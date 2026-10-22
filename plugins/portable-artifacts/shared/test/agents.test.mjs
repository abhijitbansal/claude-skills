import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AGENT_NAME, agentFile, INSTRUCTIONS, tomlString, writeAgentFile } from '../agents.mjs';

const PHRASES = [
  /SKILL\.md/,
  /spec JSON/,
  /build script/,
  /validate script/,
  /last line/,
  /already artifact-builder/,
  /Do not delegate/,
  /--out/,
  /exactly as SKILL\.md shows/,
  /fix the spec and rerun it, up to 2 times/,
  /fails? after 2 fix attempts/,
  /Never report an output path for a build that did not run/,
];

function checkBody(body) {
  assert.ok(body.includes(INSTRUCTIONS), 'body contains INSTRUCTIONS exactly');
  for (const p of PHRASES) assert.match(body, p);
}

test('AGENT_NAME is artifact-builder', () => {
  assert.equal(AGENT_NAME, 'artifact-builder');
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
  assert.throws(() => agentFile('claude'), /unknown agent host/);
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

test('cli: unknown host, missing dir or unknown command exit 2 with usage and write nothing', () => {
  const dir = path.join(tmpDir(), 'agents');
  for (const args of [['write', 'gemini', dir], ['write', 'copilot'], ['frobnicate'], []]) {
    const r = spawnSync(process.execPath, [AGENTS, ...args], { encoding: 'utf8' });
    assert.equal(r.status, 2, args.join(' '));
    assert.match(r.stderr, /usage: .*agents\.mjs write <copilot\|codex> <agents-dir>/);
  }
  assert.equal(fs.existsSync(dir), false);
});
