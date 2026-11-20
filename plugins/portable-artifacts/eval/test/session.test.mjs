// Tests for eval/session.mjs. Every stream here is a PROVISIONAL, SYNTHETIC fixture (see helpers/stream-fixtures.mjs):
// no real `claude` stream was captured yet. Task 9's pilot replaces them and the parser is corrected against the capture.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSession, readSession, firstBuildValid } from '../session.mjs';
import * as F from './helpers/stream-fixtures.mjs';

const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const SPEC_NAME = 'film.json';
const parse = (events, opts = { specName: SPEC_NAME }) => parseSession(F.lines(events), opts);
const stepOf = (s, what) => s.steps.filter((x) => x.what === what);

test('a session with no subagent reports every step as director and operatorModel null', () => {
  const s = parse(F.directorOnlySession());
  assert.equal(s.readable, true);
  assert.equal(s.delegated, false);
  assert.equal(s.agent, null);
  assert.equal(s.operatorModel, null);
  assert.equal(s.directorModel, F.DIRECTOR_MODEL);
  assert.deepEqual(s.steps.map((x) => [x.what, x.by]), [['spec', 'director'], ['make', 'director'], ['view', 'director']]);
});

test('a session where a subagent ran make.mjs reports make by operator and the subagent model, spec and view by director', () => {
  const s = parse(F.delegatedSession());
  assert.equal(s.delegated, true);
  assert.equal(s.agent, F.AGENT_LISTED);
  assert.deepEqual(s.agentsListed, [F.AGENT_LISTED, 'general-purpose']);
  assert.equal(s.operatorModel, F.OPERATOR_MODEL);
  assert.equal(s.directorModel, F.DIRECTOR_MODEL);
  assert.deepEqual(s.steps.map((x) => [x.what, x.by]), [['spec', 'director'], ['make', 'operator'], ['view', 'director']]);
});

test('the spec write is attributed to whoever made it', () => {
  const events = [
    F.init(),
    F.toolUse({ id: 't2', name: 'Agent', input: { subagent_type: F.AGENT_LISTED } }),
    F.toolUse({ id: 's1', name: 'Write', input: { file_path: F.SPEC, content: '{}' }, model: F.OPERATOR_MODEL, parent: 't2' }),
    F.toolResult({ id: 's1', content: 'ok', parent: 't2' }),
  ];
  assert.deepEqual(stepOf(parse(events), 'spec').map((x) => x.by), ['operator']);
  assert.deepEqual(stepOf(parse(F.delegatedSession()), 'spec').map((x) => x.by), ['director']);
  // an operator's mechanical fix is an Edit of the spec: it counts too
  const fix = [...events, F.toolUse({ id: 's2', name: 'Edit', input: { file_path: F.SPEC, old_string: 'a', new_string: 'b' }, parent: 't2' })];
  assert.deepEqual(stepOf(parse(fix), 'spec').map((x) => x.by), ['operator', 'operator']);
});

test('a write to a file that is not the spec is not a spec step', () => {
  const events = [F.init(), F.toolUse({ id: 't1', name: 'Write', input: { file_path: '/work/notes.json', content: '{}' } })];
  assert.deepEqual(parse(events).steps, []);
});

test('first build valid is the first make report ok, not the last', () => {
  const events = [
    F.init(),
    F.toolUse({ id: 'a', name: 'Bash', input: { command: F.MAKE } }),
    F.toolResult({ id: 'a', content: F.report(false) }),
    F.toolUse({ id: 'b', name: 'Bash', input: { command: F.MAKE } }),
    F.toolResult({ id: 'b', content: F.report(true) }),
  ];
  const s = parse(events);
  assert.deepEqual(stepOf(s, 'make').map((x) => x.ok), [false, true]);
  assert.equal(s.firstBuildValid, false);
  assert.equal(firstBuildValid(s.steps), false);
  assert.equal(firstBuildValid([{ what: 'view', by: 'director', ok: null }]), null);
  assert.equal(firstBuildValid([]), null);
});

test('a stream that is not JSON lines returns a record that says unreadable', () => {
  for (const text of ['hello\nworld\n', '', '[1,2,3]\n"x"\n{"no":"type"}\n']) {
    const s = parseSession(text, { specName: SPEC_NAME });
    assert.equal(s.readable, false, JSON.stringify(text));
    assert.match(s.reason, /no stream events/);
    assert.deepEqual(s.steps, []);
    assert.equal(s.delegated, false);
    assert.equal(s.firstBuildValid, null);
  }
});

test('readSession reads a file, and a missing file is unreadable with the reason', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-session-test-'));
  made.push(d);
  fs.writeFileSync(path.join(d, 't.txt'), F.lines(F.directorOnlySession()));
  assert.equal(readSession(path.join(d, 't.txt'), { specName: SPEC_NAME }).readable, true);
  const gone = readSession(path.join(d, 'missing.txt'));
  assert.equal(gone.readable, false);
  assert.match(gone.reason, /could not read/);
});

test('lines that are not events (a stderr warning mixed into the transcript) are skipped, the stream stays readable', () => {
  const text = `warning: something on stderr\n${F.lines(F.directorOnlySession())}[spawn error] none\n`;
  const s = parseSession(text, { specName: SPEC_NAME });
  assert.equal(s.readable, true);
  assert.equal(stepOf(s, 'make').length, 1);
});

test('a make command whose result is not a report is counted with ok null', () => {
  const events = [
    F.init(),
    F.toolUse({ id: 'a', name: 'Bash', input: { command: F.MAKE } }),
    F.toolResult({ id: 'a', content: 'valid\nbuilt out/film.mp4' }),
    F.toolUse({ id: 'b', name: 'Bash', input: { command: F.MAKE } }),
  ];
  const s = parse(events);
  assert.deepEqual(stepOf(s, 'make').map((x) => x.ok), [null, null], 'one result that is not a report, one call with no result');
  assert.equal(s.firstBuildValid, null);
});

test('a failing make run is still read: an error-prefixed result, array content and pretty-printed JSON all parse', () => {
  const pretty = JSON.stringify(JSON.parse(F.report(false)), null, 2);
  const events = [
    F.init(),
    F.toolUse({ id: 'a', name: 'Bash', input: { command: F.MAKE } }),
    F.toolResult({ id: 'a', content: `Exit code 1\n${F.report(false)}`, isError: true }),
    F.toolUse({ id: 'b', name: 'Bash', input: { command: F.MAKE } }),
    F.toolResult({ id: 'b', content: [{ type: 'text', text: pretty }] }),
    F.toolUse({ id: 'c', name: 'Bash', input: { command: F.MAKE } }),
    F.toolResult({ id: 'c', content: '{"ok":true,"note":"an object that is not a report"}' }),
    F.toolUse({ id: 'd', name: 'Bash', input: { command: F.MAKE } }),
    F.toolResult({ id: 'd', content: `Exit code 1\n${pretty}`, isError: true }),
    F.toolUse({ id: 'e', name: 'Bash', input: { command: F.MAKE } }),
    F.toolResult({ id: 'e', content: `${F.report(true)}\n[stderr] {not a report}` }),
  ];
  assert.deepEqual(stepOf(parse(events), 'make').map((x) => x.ok), [false, false, null, false, true]);
});

// A REAL stream: the Task 9 pilot (statement-hook, Claude Code 2.1.327, claude-director). Image bytes and long text are
// trimmed, every event and field is kept. Expected values are read from that stream by hand, not from the parser.
test('the real pilot stream: agent as listed, subagent steps attributed by parent id, both models, cost, no hooks', () => {
  const text = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'helpers', 'real-stream-pilot-2026-11-18.jsonl'), 'utf8');
  const s = parseSession(text, { specName: SPEC_NAME });
  assert.equal(s.readable, true);
  assert.equal(s.directorModel, 'claude-opus-5-5');
  assert.equal(s.operatorModel, 'claude-haiku-5-5');
  assert.deepEqual(s.agentsListed, ['artifact-builder', 'claude', 'Explore', 'general-purpose', 'Plan', 'statusline-setup']);
  assert.equal(s.delegated, true);
  assert.equal(s.agent, 'artifact-builder');
  assert.equal(s.requestedModel, null);
  assert.deepEqual(s.plugins, ['cc-plugin-agents-md', 'cc-plugin-telemetry', 'cc-plugin-privacy', 'cc-plugin-plugin-authoring']);
  assert.deepEqual(s.hooksFired, []);
  assert.equal(s.settingSources, null, 'this version does not list setting sources in the init event');
  assert.deepEqual(s.steps.map((x) => [x.what, x.by, x.ok]), [
    ['spec', 'director', true], ['make', 'operator', true], ['view', 'director', true], ['view', 'director', true], ['view', 'director', true],
  ]);
  assert.equal(s.firstBuildValid, true);
  assert.equal(s.costUsd, 0.39786671);
  assert.equal(s.capped, false);
});

// Captured in the Task 9 pilot: the director ran `make.mjs --list kinds` and `make.mjs film.json --outline` (text, not
// reports) before handing the build over. They are looks at the film, not builds, so they are not make steps and the
// first build is the operator's run.
test('make.mjs --list and --outline are not builds: first build valid is the first real build report', () => {
  const events = [
    F.init(),
    F.toolUse({ id: 'l', name: 'Bash', input: { command: 'node skills/make-motion/scripts/make.mjs --list kinds' } }),
    F.toolResult({ id: 'l', content: 'kinds (16)\nfree  Raw scene nodes' }),
    F.toolUse({ id: 'o', name: 'Bash', input: { command: 'node skills/make-motion/scripts/make.mjs film.json --outline' } }),
    F.toolResult({ id: 'o', content: 'make: validate ok (0.004 s)\nhook  statement  0.00–3.90s' }),
    F.toolUse({ id: 'oj', name: 'Bash', input: { command: 'node skills/make-motion/scripts/make.mjs film.json --outline --json' } }),
    F.toolResult({ id: 'oj', content: F.report(true) }),
    F.toolUse({ id: 'm', name: 'Bash', input: { command: F.MAKE }, parent: 'agent-1' }),
    F.toolResult({ id: 'm', content: F.report(false), parent: 'agent-1' }),
  ];
  const s = parse(events);
  assert.deepEqual(stepOf(s, 'make').map((x) => [x.by, x.ok]), [['operator', false]]);
  assert.equal(firstBuildValid(s.steps), false);
});

test('a command that only mentions make.mjs is not a make step', () => {
  const events = [
    F.init(),
    F.toolUse({ id: 'a', name: 'Bash', input: { command: 'cat skills/make-motion/scripts/make.mjs' } }),
    F.toolUse({ id: 'b', name: 'Bash', input: { command: 'ls skills/make-motion/scripts' } }),
    F.toolUse({ id: 'c', name: 'Read', input: { file_path: '/work/skills/make-motion/scripts/make.mjs' } }),
  ];
  assert.deepEqual(parse(events).steps, []);
});

test('a delegating call that names a model is reported as an override with that model; none named is null', () => {
  assert.equal(parse(F.delegatedSession({ requestedModel: 'sonnet' })).requestedModel, 'sonnet');
  assert.equal(parse(F.delegatedSession()).requestedModel, null);
  assert.equal(parse(F.directorOnlySession()).requestedModel, null);
});

test('the delegating tool may be called Agent or Task, and the agent name is its subagent_type', () => {
  const task = [F.init(), F.toolUse({ id: 'd', name: 'Task', input: { subagent_type: 'artifact-builder', model: 'haiku' } })];
  const s = parse(task);
  assert.equal(s.delegated, true);
  assert.equal(s.agent, 'artifact-builder');
  assert.equal(s.requestedModel, 'haiku');
  assert.deepEqual(s.delegations, [{ id: 'd', agent: 'artifact-builder', requestedModel: 'haiku' }]);
  assert.equal(parse([F.init(), F.toolUse({ id: 'x', name: 'Skill', input: { skill: 'a' } })]).delegated, false);
});

test('a view is a read of a sheet or a built page; the skill file and files under skills/ are not views', () => {
  const read = (id, file) => F.toolUse({ id, name: 'Read', input: { file_path: file } });
  const events = [
    F.init(),
    read('a', '/work/skills/make-motion/SKILL.md'),
    read('b', '/work/skills/make-diagram/template/page.html'),
    read('c', '/work/out/sheets/contact.png'),
    read('d', '/work/out/diagram.html'),
    read('e', '/work/data/sales.csv'),
  ];
  assert.deepEqual(stepOf(parse(events), 'view').map((x) => x.path), ['/work/out/sheets/contact.png', '/work/out/diagram.html']);
});

test('a read that returned an error is a failed step, a successful one is ok', () => {
  const events = [
    F.init(),
    F.toolUse({ id: 'a', name: 'Read', input: { file_path: '/work/out/a.png' } }),
    F.toolResult({ id: 'a', content: 'File does not exist', isError: true }),
    F.toolUse({ id: 'b', name: 'Read', input: { file_path: '/work/out/b.png' } }),
    F.toolResult({ id: 'b', content: 'image' }),
  ];
  assert.deepEqual(stepOf(parse(events), 'view').map((x) => x.ok), [false, true]);
});

test('the setting sources, plugins and hooks the init event lists are kept, and hook events name the hooks that fired', () => {
  const s = parse([
    F.init({ settingSources: ['project'], plugins: [{ name: 'some-plugin', path: '/p' }, 'other'], hooks: ['SessionStart'] }),
    F.hook({ name: 'SessionStart:startup' }),
    F.hook({ name: 'SessionStart:startup', subtype: 'hook_response' }),
    F.hook({ name: 'PreToolUse:Bash' }),
  ]);
  assert.deepEqual(s.settingSources, ['project']);
  assert.deepEqual(s.plugins, ['some-plugin', 'other']);
  assert.deepEqual(s.hooks, ['SessionStart']);
  assert.deepEqual(s.hooksFired, ['SessionStart:startup', 'PreToolUse:Bash']);
  const bare = parse(F.directorOnlySession());
  assert.deepEqual([bare.settingSources, bare.plugins, bare.hooks, bare.hooksFired], [null, [], [], []]);
});

test('the result event gives the cost, and a budget stop is reported as capped', () => {
  const ok = parse([F.init(), F.result({ cost: 1.25 })]);
  assert.equal(ok.costUsd, 1.25);
  assert.equal(ok.capped, false);
  const capped = parse([F.init(), F.result({ cost: 2.01, subtype: 'error_max_budget_usd' })]);
  assert.equal(capped.capped, true);
  assert.equal(parse([F.init()]).costUsd, null);
});

test('the director model falls back to the first top-level assistant message when init names none; subagent messages never count as the director', () => {
  const noInit = [
    { type: 'system', subtype: 'init' },
    F.toolUse({ id: 's', name: 'Bash', input: { command: 'ls' }, model: F.OPERATOR_MODEL, parent: 't' }),
    F.toolUse({ id: 'a', name: 'Bash', input: { command: 'ls' }, model: F.DIRECTOR_MODEL }),
  ];
  const s = parse(noInit);
  assert.equal(s.directorModel, F.DIRECTOR_MODEL);
  assert.equal(s.operatorModel, F.OPERATOR_MODEL);
});

test('two operator models are both kept, joined, so a mixed run is not hidden', () => {
  const events = [
    F.init(),
    F.toolUse({ id: 'a', name: 'Bash', input: { command: 'ls' }, model: 'm1', parent: 't' }),
    F.toolUse({ id: 'b', name: 'Bash', input: { command: 'ls' }, model: 'm2', parent: 't' }),
    F.toolUse({ id: 'c', name: 'Bash', input: { command: 'ls' }, model: 'm1', parent: 't' }),
  ];
  assert.equal(parse(events).operatorModel, 'm1 + m2');
});

test('without a spec name any skill spec file name counts; with one only that file does', () => {
  const events = [F.init(), F.toolUse({ id: 'a', name: 'Write', input: { file_path: '/w/diagram.json', content: '{}' } })];
  assert.equal(stepOf(parseSession(F.lines(events)), 'spec').length, 1);
  assert.equal(stepOf(parseSession(F.lines(events), { specName: 'film.json' }), 'spec').length, 0);
});

test('without a spec name, film.json is make-motion\'s spec file and the version 1 motion.json is not', () => {
  const wrote = (file) => [F.init(), F.toolUse({ id: 'a', name: 'Write', input: { file_path: file, content: '{}' } })];
  assert.equal(stepOf(parseSession(F.lines(wrote('/w/film.json'))), 'spec').length, 1);
  assert.equal(stepOf(parseSession(F.lines(wrote('/w/motion.json'))), 'spec').length, 0);
});
