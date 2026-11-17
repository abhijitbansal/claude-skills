// PROVISIONAL, SYNTHETIC fixtures: hand-written stand-ins for a `claude -p --output-format stream-json --verbose
// --forward-subagent-text` stream. Nobody captured a real one yet (Task 8 calls no billed host). The shapes follow what
// the plan expects: a `system`/`init` event naming the model, agents and plugins; `assistant` events whose
// `message.content` holds `tool_use` blocks; `user` events whose content holds `tool_result` blocks; a subagent's events
// carry `parent_tool_use_id`; a final `result` event. Task 9's pilot replaces these with a captured stream, and
// `eval/session.mjs` is corrected against it before the other nine cases run. Model names here are made up on purpose.

export const DIRECTOR_MODEL = 'model-director-x';
export const OPERATOR_MODEL = 'model-operator-y';
export const AGENT_LISTED = 'portable-artifacts:artifact-builder';

export const init = ({ model = DIRECTOR_MODEL, agents = [AGENT_LISTED, 'general-purpose'], plugins = [], hooks, settingSources } = {}) => ({
  type: 'system',
  subtype: 'init',
  model,
  tools: ['Read', 'Write', 'Edit', 'Bash', 'Agent'],
  agents,
  plugins,
  ...(hooks === undefined ? {} : { hooks }),
  ...(settingSources === undefined ? {} : { setting_sources: settingSources }),
});

// One assistant event with one tool_use block. `parent` is the delegating call's id for a subagent's event, else null.
export const toolUse = ({ id, name, input, model = DIRECTOR_MODEL, parent = null }) => ({
  type: 'assistant',
  parent_tool_use_id: parent,
  message: { model, content: [{ type: 'tool_use', id, name, input }] },
});

export const toolResult = ({ id, content, isError = false, parent = null }) => ({
  type: 'user',
  parent_tool_use_id: parent,
  message: { content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] },
});

export const hook = ({ name, subtype = 'hook_started' }) => ({ type: 'system', subtype, hook_name: name });

export const result = ({ cost = 0.42, subtype = 'success' } = {}) => ({ type: 'result', subtype, is_error: subtype !== 'success', total_cost_usd: cost });

export const report = (ok, extra = {}) => JSON.stringify({ ok, output: ok ? '/work/out/film.mp4' : null, stages: [{ name: 'validate', ok, seconds: 0.1 }], findings: [], ...extra });

export const lines = (events) => `${events.map((e) => JSON.stringify(e)).join('\n')}\n`;

export const SPEC = '/work/motion.json';
export const MAKE = 'node skills/make-motion/scripts/make.mjs motion.json --json';

// The director writes the spec, delegates, the operator runs make.mjs once and the director views the sheet.
export function delegatedSession({ requestedModel, makeOk = true, operatorModel = OPERATOR_MODEL, spec = SPEC } = {}) {
  return [
    init(),
    toolUse({ id: 't1', name: 'Write', input: { file_path: spec, content: '{}' } }),
    toolResult({ id: 't1', content: 'ok' }),
    toolUse({ id: 't2', name: 'Agent', input: { subagent_type: AGENT_LISTED, prompt: 'build', ...(requestedModel ? { model: requestedModel } : {}) } }),
    toolUse({ id: 's1', name: 'Bash', input: { command: MAKE }, model: operatorModel, parent: 't2' }),
    toolResult({ id: 's1', content: report(makeOk), parent: 't2' }),
    toolResult({ id: 't2', content: 'done' }),
    toolUse({ id: 't3', name: 'Read', input: { file_path: '/work/out/sheets/contact.png' } }),
    toolResult({ id: 't3', content: 'image' }),
    result(),
  ];
}

// The director does everything itself: no Agent call at all.
export function directorOnlySession({ makeOk = true } = {}) {
  return [
    init(),
    toolUse({ id: 't1', name: 'Write', input: { file_path: SPEC, content: '{}' } }),
    toolResult({ id: 't1', content: 'ok' }),
    toolUse({ id: 't2', name: 'Bash', input: { command: MAKE } }),
    toolResult({ id: 't2', content: report(makeOk) }),
    toolUse({ id: 't3', name: 'Read', input: { file_path: '/work/out/sheets/contact.png' } }),
    toolResult({ id: 't3', content: 'image' }),
    result(),
  ];
}
