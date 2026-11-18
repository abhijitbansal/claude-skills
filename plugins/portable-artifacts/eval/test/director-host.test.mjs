// Task 8: the eval harness can see a delegation. The `claude-director` host, --budget, the agent file in the workdir,
// the prompt, and the summary columns. Nothing here calls a billed host: the host is a fake `claude` that prints a
// PROVISIONAL, SYNTHETIC stream (see helpers/stream-fixtures.mjs); Task 9's pilot replaces it with a captured one.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildPrompt, expandCmd, prepareWorkdir, summarize, readValidateLog, countValidateRuns, SKILLS } from '../lib.mjs';
import { parseSession } from '../session.mjs';
import { agentFile } from '../../shared/agents.mjs';
import * as F from './helpers/stream-fixtures.mjs';

const made = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-director-test-')); made.push(d); return d; };
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

const evalDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillsRoot = path.resolve(evalDir, '../skills');
const hosts = JSON.parse(fs.readFileSync(path.join(evalDir, 'hosts.json'), 'utf8'));
const director = hosts['claude-director'];

const cfg = { dir: 'fake', spec: 'spec.json' };

// --- hosts.json ---

test('hosts.json: claude-director streams the session, reads only project settings, may start a subagent, caps spend', () => {
  assert.ok(director, 'claude-director is defined');
  const cmd = director.cmd;
  assert.deepEqual(cmd.slice(0, 3), ['claude', '-p', '{prompt}']);
  const at = (flag) => cmd.indexOf(flag);
  assert.deepEqual(cmd.slice(at('--output-format'), at('--output-format') + 2), ['--output-format', 'stream-json']);
  for (const flag of ['--verbose', '--forward-subagent-text', '--include-hook-events']) assert.ok(cmd.includes(flag), flag);
  assert.deepEqual(cmd.slice(at('--setting-sources'), at('--setting-sources') + 2), ['--setting-sources', 'project']);
  assert.ok(at('--setting-sources') < at('--allowedTools'), 'the variadic --allowedTools comes last so it cannot swallow another flag');
  const tools = cmd.slice(at('--allowedTools') + 1);
  for (const t of ['Agent', 'Task', 'Read', 'Write', 'Edit', 'Bash(node:*)']) assert.ok(tools.includes(t), t);
  for (const t of tools) assert.doesNotMatch(t, /^Bash\((rm|curl|wget|sh|bash|git|mv|cp)\b/, `${t} is not read-only`);
  assert.deepEqual(director.budgetArgs, ['--max-budget-usd', '{budget}']);
  assert.equal(director.agentFile, 'claude');
  assert.deepEqual(director.check, ['claude', '--version']);
});

test('hosts.json: claude-director names no model (the account default is what a user gets) and has no agentArgs', () => {
  assert.equal(director.modelArgs, undefined);
  assert.equal(director.agentArgs, undefined);
  assert.ok(!director.cmd.includes('--model') && !director.cmd.includes('--agent'));
});

test('hosts.json: only claude-director has budgetArgs and agentFile', () => {
  assert.deepEqual(Object.keys(hosts).filter((h) => hosts[h].budgetArgs), ['claude-director']);
  assert.deepEqual(Object.keys(hosts).filter((h) => hosts[h].agentFile), ['claude-director']);
});

// --- expandCmd ---

test('expandCmd substitutes {budget} and appends budgetArgs only when a budget is given', () => {
  const host = { cmd: ['h', '{prompt}'], budgetArgs: ['--cap', '{budget}'] };
  assert.deepEqual(expandCmd(host, { prompt: 'p', cwd: '/w' }), ['h', 'p']);
  assert.deepEqual(expandCmd(host, { prompt: 'p', cwd: '/w', budget: '2' }), ['h', 'p', '--cap', '2']);
  assert.deepEqual(expandCmd({ cmd: ['h', '{prompt}'] }, { prompt: 'p', cwd: '/w', budget: '2' }), ['h', 'p'], 'a host without budgetArgs ignores it (run-eval refuses earlier)');
  assert.deepEqual(expandCmd(host, { prompt: 'cost {budget}', cwd: '/w', budget: '2' }), ['h', 'cost {budget}', '--cap', '2'], 'one pass: the prompt is not re-substituted');
});

test('expandCmd on the real claude-director host ends with the cap, after the tool list', () => {
  const argv = expandCmd(director, { prompt: 'p', cwd: '/w', budget: '2' });
  assert.deepEqual(argv.slice(-2), ['--max-budget-usd', '2']);
  assert.equal(argv.includes('{budget}'), false);
});

// --- buildPrompt ---

const CLAUDE_PROMPT = 'Read skills/fake/SKILL.md and follow its workflow exactly. The skill\'s scripts are in skills/fake/scripts/ and its dependencies are already installed. Work only inside the current directory. Do not start serve.mjs or preview.mjs (they never exit); stop after validate and build/render. Task: Do X. Save the spec as ./spec.json.';

test('buildPrompt: no host, or a host without agentFile, gives the prompt byte for byte as before', () => {
  assert.equal(buildPrompt(cfg, 'Do X.'), CLAUDE_PROMPT);
  assert.equal(buildPrompt(cfg, 'Do X.', hosts.claude), CLAUDE_PROMPT);
  assert.equal(buildPrompt(cfg, 'Do X.', hosts.copilot), CLAUDE_PROMPT);
});

test('buildPrompt: a host with agentFile has no "stop after validate" sentence and follows the Director and operator section', () => {
  const p = buildPrompt(cfg, 'Do X.', director);
  assert.doesNotMatch(p, /stop after validate/);
  assert.match(p, /follow the skill's Director and operator section; stop when the build is done/);
  assert.match(p, /Do not start serve\.mjs or preview\.mjs \(they never exit\)/);
  assert.match(p, /Task: Do X\. Save the spec as \.\/spec\.json\.$/);
  assert.match(p, /^Read skills\/fake\/SKILL\.md and follow its workflow exactly\./);
});

// --- prepareWorkdir ---

test('prepareWorkdir: a host with agentFile gets .claude/agents/artifact-builder.md from the claude builder; others do not', () => {
  const args = (host) => ({ skillCfg: SKILLS.diagram, skillsRoot, evalDir, tmpDir: tmp(), host });
  const withAgent = prepareWorkdir({ id: 'x' }, args(director));
  const file = path.join(withAgent.work, '.claude', 'agents', agentFile('claude').fileName);
  assert.equal(fs.readFileSync(file, 'utf8'), agentFile('claude').content);
  assert.equal(path.basename(file), 'artifact-builder.md');
  for (const host of [undefined, hosts.claude, hosts.copilot]) {
    const { work } = prepareWorkdir({ id: 'x' }, args(host));
    assert.equal(fs.existsSync(path.join(work, '.claude')), false, `no .claude folder for ${host ? 'a host without agentFile' : 'no host'}`);
  }
});

// --- the validate log ---

test('the validate log skips the make lines make.mjs writes: validate runs and first try count validate calls only', () => {
  const d = tmp();
  const log = path.join(d, 'log');
  const make = (ok) => JSON.stringify({ ts: 't', command: 'make', ok, mechanical: 0, creative: 0 });
  fs.writeFileSync(log, [JSON.stringify({ ts: 't', ok: false, errors: 2 }), make(false), JSON.stringify({ ts: 't', ok: true, errors: 0 }), make(true), ''].join('\n'));
  assert.deepEqual(readValidateLog(log).map((r) => r.ok), [false, true]);
  assert.equal(countValidateRuns(log), 2);
});

// --- summarize ---

const base = { specExists: true, finalValid: true, validateRuns: 1, outputOk: true, seconds: 3, errors: [], model: '-' };
const session = (events) => parseSession(F.lines(events), { specName: 'film.json' });
const cellsOf = (md, id) => md.split('\n').find((l) => l.startsWith(`| ${id} |`)).split('|').map((c) => c.trim());
const headerOf = (md) => md.split('\n').find((l) => l.startsWith('| id |')).split('|').map((c) => c.trim());

const sessionRows = () => [
  { id: 'a', ...base, session: session(F.delegatedSession()) },
  { id: 'b', ...base, session: session(F.directorOnlySession()) },
  { id: 'c', ...base, session: session(F.delegatedSession({ requestedModel: 'sonnet' })) },
  { id: 'd', ...base, session: parseSession('not a stream\n') },
];

test('summarize: rows with a session get five more columns after first try, and the self-reported column says so', () => {
  const md = summarize(sessionRows(), { host: 'claude-director', skill: 'motion' });
  const header = headerOf(md);
  assert.deepEqual(header.slice(header.indexOf('first try')), ['first try', 'first build valid', 'spec by', 'make by', 'operator model', 'director model', '']);
  assert.ok(header.includes('model reported (self-reported)'));
  const separator = md.split('\n').find((l) => l.startsWith('|---')).split('|');
  assert.equal(separator.length, header.length, 'the separator row has one cell per column');
  const a = cellsOf(md, 'a');
  assert.deepEqual(['first build valid', 'spec by', 'make by', 'operator model', 'director model'].map((h) => a[header.indexOf(h)]), ['✓', 'director', 'operator', F.OPERATOR_MODEL, F.DIRECTOR_MODEL]);
});

test('summarize: a case where nobody delegated says "director ran it", it is not dropped', () => {
  const md = summarize(sessionRows(), { host: 'claude-director', skill: 'motion' });
  const header = headerOf(md);
  const b = cellsOf(md, 'b');
  assert.equal(b[header.indexOf('operator model')], 'director ran it');
  assert.equal(b[header.indexOf('make by')], 'director');
  assert.equal(b[header.indexOf('director model')], F.DIRECTOR_MODEL);
});

test('summarize: a delegating call that named a model is marked as an override of the agent file', () => {
  const md = summarize(sessionRows(), { host: 'claude-director', skill: 'motion' });
  const cell = cellsOf(md, 'c')[headerOf(md).indexOf('operator model')];
  assert.match(cell, new RegExp(`^${F.OPERATOR_MODEL} \\(director requested sonnet: overrides the agent file\\)$`));
});

test('summarize: an unreadable stream says unreadable in every session column and in the notes', () => {
  const md = summarize(sessionRows(), { host: 'claude-director', skill: 'motion' });
  const header = headerOf(md);
  const d = cellsOf(md, 'd');
  for (const h of ['first build valid', 'spec by', 'make by', 'operator model', 'director model']) assert.equal(d[header.indexOf(h)], 'unreadable', h);
  assert.match(d[header.indexOf('notes')], /session stream unreadable/);
});

test('summarize: totals line counts delegations, first builds and unreadable streams', () => {
  const md = summarize(sessionRows(), { host: 'claude-director', skill: 'motion' });
  assert.match(md, /Delegated 2\/4 · first build valid 3\/3 · session unreadable 1/);
});

test('summarize: who made several steps reads as a count or a mix', () => {
  const make = (id, parent) => [F.toolUse({ id, name: 'Bash', input: { command: F.MAKE }, parent }), F.toolResult({ id, content: F.report(true), parent })];
  const twice = session([F.init(), ...make('a', 't'), ...make('b', 't')]);
  const mixed = session([F.init(), ...make('a', 't'), ...make('b', null)]);
  const none = session([F.init()]);
  const md = summarize([{ id: 'x', ...base, session: twice }, { id: 'y', ...base, session: mixed }, { id: 'z', ...base, session: none }], { host: 'claude-director', skill: 'motion' });
  const header = headerOf(md);
  assert.deepEqual(['x', 'y', 'z'].map((id) => cellsOf(md, id)[header.indexOf('make by')]), ['operator×2', 'director+operator×2', '-']);
  assert.equal(cellsOf(md, 'z')[header.indexOf('first build valid')], '-');
});

test('summarize: a hostile model string cannot break the table row', () => {
  const events = F.delegatedSession({ operatorModel: 'evil | model\nnext | row' });
  const md = summarize([{ id: 'h', ...base, session: session(events) }], { host: 'claude-director', skill: 'motion' });
  const rowLines = md.split('\n').filter((l) => l.startsWith('| h |'));
  assert.equal(rowLines.length, 1);
  assert.ok(rowLines[0].includes('evil \\| model next \\| row'));
  const long = session(F.delegatedSession({ operatorModel: 'm'.repeat(500) }));
  const cell = summarize([{ id: 'l', ...base, session: long }], { host: 'claude-director', skill: 'motion' }).split('\n').find((l) => l.startsWith('| l |'));
  assert.ok(cell.length < 400, 'the model cell is capped');
});

test('summarize: the notes carry a budget stop and the hooks that fired', () => {
  const events = [F.init(), F.hook({ name: 'SessionStart:startup' }), F.result({ cost: 2.03, subtype: 'error_max_budget_usd' })];
  const md = summarize([{ id: 'n', ...base, session: session(events) }], { host: 'claude-director', skill: 'motion' });
  const notes = cellsOf(md, 'n')[headerOf(md).indexOf('notes')];
  assert.match(notes, /hit the budget cap/);
  assert.match(notes, /hooks fired: SessionStart:startup/);
});

test('summarize: a line names the setting sources, plugins and hooks the stream shows, or says it does not', () => {
  const live = session([F.init({ settingSources: ['project'], plugins: ['some-plugin'] }), F.hook({ name: 'SessionStart:startup' })]);
  const md = summarize([{ id: 'a', ...base, session: live }], { host: 'claude-director', skill: 'motion' });
  assert.match(md, /Session setup \(read from the stream\): setting sources project; plugins some-plugin; hooks fired SessionStart:startup\./);
  const bare = summarize(sessionRows().slice(1, 2), { host: 'claude-director', skill: 'motion' });
  assert.match(bare, /setting sources not listed in the stream; plugins none; hooks fired none\./);
});

test('summarize: rows without a session keep the old header and totals exactly', () => {
  const md = summarize([{ id: 'a', ...base }], { host: 'claude', skill: 'motion' });
  assert.ok(md.includes('| id | spec | valid | validate runs | output | seconds | model reported | notes | check | feature | first try |\n'));
  assert.doesNotMatch(md, /Delegated|Session setup|self-reported|operator model/);
});

// --- run-eval: --budget, and the host end to end (fake claude) ---

function fakeClaudeBin(streamText) {
  const bin = tmp();
  const marker = path.join(bin, 'calls.jsonl');
  const fixture = path.join(bin, 'stream.txt');
  fs.writeFileSync(fixture, streamText);
  fs.writeFileSync(path.join(bin, 'claude'), `#!${process.execPath}
const fs = require('fs');
if (process.argv[2] === '--version') { console.log('9.9.9 (fake)'); process.exit(0); }
fs.appendFileSync(${JSON.stringify(marker)}, JSON.stringify({ argv: process.argv.slice(2), agentFile: fs.existsSync('.claude/agents/artifact-builder.md'), subagentModel: process.env.CLAUDE_CODE_SUBAGENT_MODEL ?? null, anthropicModel: process.env.ANTHROPIC_MODEL ?? null }) + '\\n');
process.stdout.write(fs.readFileSync(${JSON.stringify(fixture)}, 'utf8'));
`, { mode: 0o755 });
  return { bin, marker };
}

const evalWith = (bin, args, extraEnv = {}) => spawnSync(process.execPath, [path.join(evalDir, 'run-eval.mjs'), '--skill', 'dashboard', ...args], {
  encoding: 'utf8', env: { ...process.env, ...extraEnv, PATH: bin }, timeout: 60000,
});

test('run-eval: --budget on a host without budgetArgs is a usage error before any host runs', () => {
  const { bin, marker } = fakeClaudeBin('');
  const r = evalWith(bin, ['--host', 'claude', '--only', '__none__', '--budget', '2']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /host "claude" has no budgetArgs, so --budget would be ignored/);
  assert.equal(fs.existsSync(marker), false);
});

test('run-eval: a host with budgetArgs needs --budget, and the figure must be a positive number', () => {
  const { bin, marker } = fakeClaudeBin('');
  const missing = evalWith(bin, ['--host', 'claude-director', '--only', '__none__']);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /host "claude-director" is billed per prompt and needs --budget <usd>/);
  for (const bad of ['0', 'abc', '-1', '', 'Infinity']) {
    const r = evalWith(bin, ['--host', 'claude-director', '--only', '__none__', `--budget=${bad}`]);
    assert.equal(r.status, 2, `--budget=${bad}`);
    assert.match(r.stderr, /--budget must be a positive number of dollars/, `--budget=${bad}`);
  }
  assert.equal(fs.existsSync(marker), false, 'no host executable may be launched');
  // a valid budget gets past the budget check and the host check; the only thing left to refuse is the made-up case id
  const ok = evalWith(bin, ['--host', 'claude-director', '--only', '__none__', '--budget', '2']);
  assert.equal(ok.status, 2);
  assert.match(ok.stderr, /unknown --only id\(s\): __none__/);
  assert.doesNotMatch(ok.stderr.split('\n')[0], /budget/, 'the error line is about the case id, not the budget');
});

test('run-eval: claude-director refuses --model and --agent (the director runs as the account default)', () => {
  const { bin, marker } = fakeClaudeBin('');
  assert.match(evalWith(bin, ['--host', 'claude-director', '--only', '__none__', '--budget', '2', '--model', 'haiku']).stderr, /has no modelArgs/);
  assert.match(evalWith(bin, ['--host', 'claude-director', '--only', '__none__', '--budget', '2', '--agent', 'x']).stderr, /has no agentArgs/);
  assert.equal(fs.existsSync(marker), false);
});

test('run-eval usage text lists --budget', () => {
  const { bin } = fakeClaudeBin('');
  assert.match(evalWith(bin, ['--help']).stdout, /\[--budget usd\]/);
});

test('run-eval: a claude-director case passes the cap and the stream flags, finds the agent file in its workdir, and records the session', (t) => {
  if (!fs.existsSync(path.join(skillsRoot, 'make-dashboard', 'node_modules'))) {
    if (process.env.CI) assert.fail('make-dashboard has no node_modules; CI installs it');
    t.skip('make-dashboard has no node_modules here');
    return;
  }
  const stream = F.lines(F.delegatedSession({ spec: '/work/dashboard.json' }));
  const { bin, marker } = fakeClaudeBin(stream);
  const out = tmp();
  const r = evalWith(bin, ['--host', 'claude-director', '--only', 'rev-by-region', '--budget', '2', '--out', out]);
  assert.equal(r.status, 0, r.stderr);
  const call = JSON.parse(fs.readFileSync(marker, 'utf8').trim());
  assert.equal(call.agentFile, true, 'the agent file sits in the workdir when the host starts');
  const at = (flag) => call.argv.indexOf(flag);
  assert.deepEqual(call.argv.slice(-2), ['--max-budget-usd', '2']);
  assert.equal(call.argv[at('--setting-sources') + 1], 'project');
  assert.equal(call.argv[at('--output-format') + 1], 'stream-json');
  assert.ok(!call.argv.join(' ').includes('stop after validate'), 'the director prompt does not steer around make.mjs');
  const dir = path.join(out, 'claude-director-dashboard');
  const results = JSON.parse(fs.readFileSync(path.join(dir, 'results.json'), 'utf8'));
  assert.equal(results.budget, '2');
  const row = results.rows[0];
  assert.equal(row.session.delegated, true);
  assert.equal(row.session.operatorModel, F.OPERATOR_MODEL);
  assert.deepEqual(row.session.steps.map((s) => [s.what, s.by]), [['spec', 'director'], ['make', 'operator'], ['view', 'director']]);
  assert.equal(fs.readFileSync(path.join(dir, 'rev-by-region', 'transcript.txt'), 'utf8').trim(), stream.trim());
  const summary = fs.readFileSync(path.join(dir, 'summary.md'), 'utf8');
  assert.match(summary, /\| operator model \| director model \|/);
  assert.match(summary, /Delegated 1\/1/);
});

// Pilot finding (Task 9): the owner's shell exports CLAUDE_CODE_SUBAGENT_MODEL=sonnet, which `--setting-sources project`
// does not remove and which overrides the operator's model. Decision 14 asks for isolation, so the director host drops
// the variables that pick a model; the plain `claude` host keeps passing the environment through unchanged.
const MODEL_ENV = { CLAUDE_CODE_SUBAGENT_MODEL: 'sonnet', ANTHROPIC_MODEL: 'some-model' };
const skipWithoutDashboard = (t) => {
  if (fs.existsSync(path.join(skillsRoot, 'make-dashboard', 'node_modules'))) return false;
  if (process.env.CI) assert.fail('make-dashboard has no node_modules; CI installs it');
  t.skip('make-dashboard has no node_modules here');
  return true;
};

test('run-eval: the claude-director host does not inherit the variables that pick a model', (t) => {
  if (skipWithoutDashboard(t)) return;
  const { bin, marker } = fakeClaudeBin(F.lines(F.delegatedSession({ spec: '/work/dashboard.json' })));
  const r = evalWith(bin, ['--host', 'claude-director', '--only', 'rev-by-region', '--budget', '2', '--out', tmp()], MODEL_ENV);
  assert.equal(r.status, 0, r.stderr);
  const call = JSON.parse(fs.readFileSync(marker, 'utf8').trim());
  assert.equal(call.subagentModel, null, 'CLAUDE_CODE_SUBAGENT_MODEL would override the agent file and the evidence');
  assert.equal(call.anthropicModel, null, 'ANTHROPIC_MODEL would move the director off the account default');
});

test('run-eval: the plain claude host still passes its environment through', (t) => {
  if (skipWithoutDashboard(t)) return;
  const { bin, marker } = fakeClaudeBin('plain text, not a stream\n');
  const r = evalWith(bin, ['--host', 'claude', '--only', 'rev-by-region', '--out', tmp()], MODEL_ENV);
  assert.equal(r.status, 0, r.stderr);
  const call = JSON.parse(fs.readFileSync(marker, 'utf8').trim());
  assert.equal(call.subagentModel, 'sonnet');
  assert.equal(call.anthropicModel, 'some-model');
});

test('run-eval: a claude host case records no session and its summary keeps the old shape', (t) => {
  if (!fs.existsSync(path.join(skillsRoot, 'make-dashboard', 'node_modules'))) {
    if (process.env.CI) assert.fail('make-dashboard has no node_modules; CI installs it');
    t.skip('make-dashboard has no node_modules here');
    return;
  }
  const { bin } = fakeClaudeBin('plain text, not a stream\n');
  const out = tmp();
  const r = evalWith(bin, ['--host', 'claude', '--only', 'rev-by-region', '--out', out]);
  assert.equal(r.status, 0, r.stderr);
  const dir = path.join(out, 'claude-dashboard');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'results.json'), 'utf8')).rows[0].session, undefined);
  assert.doesNotMatch(fs.readFileSync(path.join(dir, 'summary.md'), 'utf8'), /operator model|self-reported/);
});
