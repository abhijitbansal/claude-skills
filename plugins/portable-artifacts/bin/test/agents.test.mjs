import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AGENT_NAME, agentFile } from '../agents.mjs';

const BODY_PHRASES = [
  /SKILL\.md/,
  /spec JSON/i,
  /validate/i,
  /build/i,
  /output path/i,
  /last line/i,
  /already `?artifact-builder`?/,
  /not delegate/i,
];

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
  for (const p of BODY_PHRASES) assert.match(content, p);
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
  for (const p of BODY_PHRASES) assert.match(content, p);
});

test('unknown host throws', () => {
  assert.throws(() => agentFile('claude'), /unknown agent host/);
});
