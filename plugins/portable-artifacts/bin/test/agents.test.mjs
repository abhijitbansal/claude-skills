import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AGENT_NAME, agentFile, INSTRUCTIONS, tomlString } from '../agents.mjs';

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
