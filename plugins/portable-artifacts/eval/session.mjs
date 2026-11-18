// Read a Claude Code session stream (`claude -p --output-format stream-json --verbose --forward-subagent-text`) into
// evidence: did the director delegate, to which agent, which model each side ran as, who wrote the spec, ran make.mjs
// and viewed the result, which setting sources, plugins and hooks were live. The evidence is read from the session's own
// events, never from what an agent says about itself.
//
// PROVISIONAL: the event shapes below follow the plan and a hand-written fixture (test/helpers/stream-fixtures.mjs).
// Task 9's pilot checks them against a real capture; correct this file and its fixtures there, before the other cases run.
import fs from 'node:fs';
import path from 'node:path';

const DELEGATING_TOOLS = new Set(['Agent', 'Task']);
const SPEC_WRITERS = new Set(['Write', 'Edit', 'MultiEdit']);
const SPEC_NAME = /^(dashboard|diagram|explainer|scene|film)\.json$/;
const MAKE_COMMAND = /(?:^|[\s;&|(])node\s+[^;&|\n]*\bmake\.mjs\b/;
const VIEW_FILE = /\.(png|jpe?g|webp|gif|html?)$/i;

/** `ok` of the first make step, or null when there was none (or its result was not a report). */
export function firstBuildValid(steps) {
  const first = steps.find((s) => s.what === 'make');
  return first ? first.ok : null;
}

const unreadable = (reason) => ({
  readable: false, reason, directorModel: null, agentsListed: [], operatorModel: null, delegated: false, agent: null,
  requestedModel: null, delegations: [], settingSources: null, plugins: [], hooks: [], hooksFired: [], steps: [],
  firstBuildValid: null, costUsd: null, capped: false,
});

export function readSession(transcriptPath, opts) {
  let text;
  try {
    text = fs.readFileSync(transcriptPath, 'utf8');
  } catch (e) {
    return unreadable(`could not read ${path.basename(transcriptPath)}: ${e.code ?? e.message}`);
  }
  return parseSession(text, opts);
}

const names = (list) => (Array.isArray(list) ? list.map((x) => (typeof x === 'string' ? x : x?.name)).filter((x) => typeof x === 'string') : []);
const textOf = (content) => (Array.isArray(content) ? content.map((c) => (typeof c === 'string' ? c : c?.text ?? '')).join('\n') : String(content ?? ''));
const uniq = (list) => [...new Set(list)];

// The transcript is stdout and stderr together, so a line that is not an event is skipped, not an error.
function readEvents(text) {
  const events = [];
  for (const line of text.split('\n')) {
    try {
      const e = JSON.parse(line);
      if (e && typeof e === 'object' && typeof e.type === 'string') events.push(e);
    } catch { /* not an event */ }
  }
  return events;
}

// The make.mjs report inside a tool result: the last line that is one, or the span from the first { to the last }
// (a pretty-printed report; a failing command's result starts with "Exit code 1"). A report has a boolean `ok` and a
// `stages` array.
function reportIn(text) {
  const isReport = (o) => o && typeof o === 'object' && typeof o.ok === 'boolean' && Array.isArray(o.stages);
  const tries = [...text.split('\n').reverse(), text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)];
  for (const t of tries) {
    try {
      const o = JSON.parse(t);
      if (isReport(o)) return o;
    } catch { /* next candidate */ }
  }
  return null;
}

export function parseSession(text, { specName } = {}) {
  const events = readEvents(text);
  if (events.length === 0) return unreadable('no stream events: the transcript has no JSON lines with a "type"');
  const isSpec = (file) => (specName ? path.basename(file) === specName : SPEC_NAME.test(path.basename(file)));

  const init = events.find((e) => e.type === 'system' && e.subtype === 'init') ?? {};
  const results = new Map(); // tool_use id -> { text, isError }
  const calls = []; // every tool_use block, in order, with who made it
  const operatorModels = [];
  let directorModel = typeof init.model === 'string' ? init.model : null;
  const hooksFired = [];
  let final = null;
  for (const e of events) {
    const by = e.parent_tool_use_id ? 'operator' : 'director';
    if (e.type === 'assistant') {
      const model = typeof e.message?.model === 'string' ? e.message.model : null;
      if (model && by === 'operator') operatorModels.push(model);
      if (model && by === 'director' && !directorModel) directorModel = model;
      for (const block of Array.isArray(e.message?.content) ? e.message.content : []) {
        if (block?.type === 'tool_use') calls.push({ id: block.id, name: block.name, input: block.input ?? {}, by });
      }
    } else if (e.type === 'user') {
      for (const block of Array.isArray(e.message?.content) ? e.message.content : []) {
        if (block?.type === 'tool_result') results.set(block.tool_use_id, { text: textOf(block.content), isError: block.is_error === true });
      }
    } else if (e.type === 'system' && (e.subtype === 'hook_started' || e.subtype === 'hook_response')) {
      const name = e.hook_name ?? e.hook_event;
      if (typeof name === 'string') hooksFired.push(name);
    } else if (e.type === 'result') {
      final = e;
    }
  }

  const steps = [];
  const delegations = [];
  for (const c of calls) {
    const res = results.get(c.id);
    const toolOk = res ? !res.isError : null;
    const file = typeof c.input.file_path === 'string' ? c.input.file_path : '';
    if (DELEGATING_TOOLS.has(c.name)) {
      delegations.push({ id: c.id, agent: c.input.subagent_type ?? null, requestedModel: c.input.model ?? null });
    } else if (SPEC_WRITERS.has(c.name) && file && isSpec(file)) {
      steps.push({ what: 'spec', by: c.by, ok: toolOk, path: file });
    } else if (c.name === 'Bash' && typeof c.input.command === 'string' && MAKE_COMMAND.test(c.input.command)) {
      steps.push({ what: 'make', by: c.by, ok: res ? (reportIn(res.text)?.ok ?? null) : null });
    } else if (c.name === 'Read' && VIEW_FILE.test(file) && !file.split(path.sep).includes('skills')) {
      steps.push({ what: 'view', by: c.by, ok: toolOk, path: file });
    }
  }

  return {
    readable: true,
    directorModel,
    agentsListed: names(init.agents),
    operatorModel: operatorModels.length ? uniq(operatorModels).join(' + ') : null,
    delegated: delegations.length > 0,
    agent: delegations[0]?.agent ?? null,
    requestedModel: delegations[0]?.requestedModel ?? null,
    delegations,
    settingSources: init.setting_sources ?? init.settingSources ?? null,
    plugins: names(init.plugins),
    hooks: names(init.hooks),
    hooksFired: uniq(hooksFired),
    steps,
    firstBuildValid: firstBuildValid(steps),
    costUsd: typeof final?.total_cost_usd === 'number' ? final.total_cost_usd : null,
    capped: final?.subtype === 'error_max_budget_usd',
  };
}
