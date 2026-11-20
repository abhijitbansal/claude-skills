// The body of scripts/make.mjs in make-dashboard, make-diagram, make-explainer and make-scene: the one command that
// checks the machine, validates a spec, builds the page and checks it, then prints one report (make-report.mjs).
// It runs the skill's own scripts (doctor, validate, build, check) as child processes with --json and maps what they
// print; it copies none of their logic. Never opens a dialog, never waits for input, never installs anything.
//
// Exit 0: valid and no mechanical finding. Exit 1: invalid, or a mechanical finding (the page is still written when the
// build ran). Exit 2: usage, or trouble with the machine (a missing spec file or dependency, a script that crashed);
// `error: { message, hint }` says which. Exit 130: stopped by SIGINT or SIGTERM. With --json stdout holds exactly one
// JSON object on every path and progress goes to stderr.
//
// PA_MAKE_TEST_SCRIPTS (tests only): a JSON object { doctor, validate, build, check } of script paths that replace the
// skill's own, so a test can stand in for a stage without a browser or a dependency.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { UsageError, parseCli } from './cli.mjs';
import { EXIT, INTERRUPTED, newRun, runStage, finding, reportOf, exitCodeOf, logMake } from './make-report.mjs';

const BASE_OPTIONS = Object.freeze({
  out: { type: 'string', usage: '[--out <path>]', stages: ['build'] },
  json: { type: 'boolean', usage: '[--json]', stages: [] },
  'no-check': { type: 'boolean', usage: '[--no-check]', stages: [] },
  theme: { type: 'string', usage: '[--theme <name>]', stages: ['build'] },
  model: { type: 'string', usage: '[--model <m>]', stages: ['build'] },
  effort: { type: 'string', usage: '[--effort <e>]', stages: ['build'] },
  agent: { type: 'string', usage: '[--agent <a>]', stages: ['build'] },
});
const USAGE_MARK = '; usage: ';
const SENTENCE_END = '. ';
const DID_YOU_MEAN = /did you mean "([^"]+)"/;
const SPEC_HINT = 'give the path of an existing spec .json file; a relative path is read from the current directory';

const firstLine = (e) => String(e?.message ?? e).split('\n')[0];
const say = (text) => process.stdout.write(`${text}\n`);
const log = (line) => process.stderr.write(`${line}\n`);

/** { message, hint } of an error line: the first sentence, then the rest. */
function describe(line) {
  const first = String(line).split('\n')[0];
  const cut = first.indexOf(SENTENCE_END);
  return cut > 0 ? { message: first.slice(0, cut), hint: first.slice(cut + SENTENCE_END.length) } : { message: first, hint: '' };
}

/** The fix a validator's did-you-mean carries: rename a misspelt key, or use the suggested value. */
export function fixOf(error) {
  const suggestion = DID_YOU_MEAN.exec(error.message)?.[1];
  if (suggestion === undefined) return undefined;
  if (!error.message.startsWith('unknown property')) return `use "${suggestion}"`;
  const key = String(error.path).split('.').pop().replace(/\[\d+\]$/, '');
  return `rename "${key}" to "${suggestion}"`;
}

const mechanical = ({ path: at = '', message }) => finding('mechanical', at, message, fixOf({ path: at, message }));
const creative = ({ path: at = '', message }) => finding('creative', at, message);

function optionTable(extra) {
  return { ...BASE_OPTIONS, ...Object.fromEntries(extra.map((e) => [e.name, { type: e.type, usage: e.type === 'boolean' ? `[--${e.name}]` : `[--${e.name} <${e.value ?? 'value'}>]`, stages: e.stages }])) };
}

function usageLine(table) {
  return `node scripts/make.mjs <spec> ${Object.values(table).map((o) => o.usage).join(' ')}`;
}

/** The flags of `stage` as argv: every option given on the command line that is routed to that stage. */
function stageArgs(stage, values, table) {
  return Object.entries(table).flatMap(([name, o]) => {
    if (!o.stages.includes(stage) || values[name] === undefined || values[name] === false) return [];
    return o.type === 'boolean' ? [`--${name}`] : [`--${name}`, values[name]];
  });
}

class Interrupted extends Error {}

/** Run one script as a child process: { status, stdout, stderr }. An abort kills it and rejects with Interrupted. */
function runChild(script, args, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Interrupted());
    const child = spawn(process.execPath, [script, ...args], { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
    let stdout = '';
    let stderr = '';
    const stop = () => child.kill('SIGTERM');
    signal.addEventListener('abort', stop, { once: true });
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => { signal.removeEventListener('abort', stop); reject(err); });
    child.on('close', (status) => {
      signal.removeEventListener('abort', stop);
      if (signal.aborted) reject(new Interrupted());
      else resolve({ status, stdout, stderr });
    });
  });
}

function parseJson(text) {
  const lines = String(text).trim().split('\n').filter(Boolean);
  for (const candidate of [lines.join('\n'), lines.at(-1)]) {
    try {
      const body = JSON.parse(candidate);
      if (body !== null && typeof body === 'object') return body;
    } catch {
      // try the last line alone, then give up
    }
  }
  return null;
}

/** What a child that did not run to a verdict (exit other than 0 or 1, or no JSON) says: the machine error. */
function machineError(stage, r, body) {
  const line = body?.errors?.[0]?.message ?? firstLine(r.stderr || `${stage} exited with status ${r.status} and printed no JSON`);
  const known = describe(line);
  return { message: known.message, hint: known.hint || (/^cannot read /.test(line) ? SPEC_HINT : '') };
}

const dedupe = (items) => {
  const seen = new Set();
  return items.filter((f) => !seen.has(`${f.kind}|${f.path}|${f.message}`) && seen.add(`${f.kind}|${f.path}|${f.message}`));
};
const addFindings = (state, items) => { state.findings = dedupe([...state.findings, ...items]); };

async function doctorStage(ctx) {
  const r = await runChild(ctx.script('doctor'), ['--json'], ctx.signal);
  const body = parseJson(r.stdout);
  if (r.status === 0 && body?.ok !== false) return { ok: true };
  if (body === null || !Array.isArray(body.missing)) return { ok: false, error: machineError('doctor', r, body) };
  const required = body.missing.filter((m) => m.required);
  const first = required[0] ?? body.missing[0];
  const message = `${ctx.skill} needs ${required.map((m) => m.id).join(', ')}${first?.why ? `: ${first.why}` : ''}`;
  return { ok: false, error: { message, hint: first?.fix?.manual ?? `run node ${path.join('scripts', 'doctor.mjs')}` } };
}

async function scriptStage(ctx, stage, args) {
  const r = await runChild(ctx.script(stage), [ctx.spec, '--json', ...args], ctx.signal);
  const body = parseJson(r.stdout);
  if ((r.status !== 0 && r.status !== 1) || body === null) return { ok: false, error: machineError(stage, r, body), body };
  addFindings(ctx.state, [...(body.errors ?? []).map(mechanical), ...(body.warnings ?? []).map(creative)]);
  return { ok: r.status === 0 && body.ok !== false, body };
}

async function checkStage(ctx) {
  const r = await runChild(ctx.script('check'), [ctx.state.output, '--json'], ctx.signal);
  const body = parseJson(r.stdout);
  if ((r.status !== 0 && r.status !== 1) || body === null) return { ok: false, error: machineError('check', r, body) };
  addFindings(ctx.state, [...(body.errors ?? []).map(mechanical), ...(body.warnings ?? []).map((w) => creative({ message: String(w) }))]);
  if (body.skipped === true) return { skipped: true };
  return { ok: r.status === 0 && body.ok !== false };
}

/** The stages in order; a stage that cannot go on sets state.error (machine trouble) and the run stops there. */
async function pipeline(ctx) {
  const { state, flags } = ctx;
  const stage = (name, fn) => runStage(state, name, fn, log);
  const stopped = (result) => {
    if (result.error) state.error = result.error;
    return !result.ok || Boolean(result.error);
  };
  if (stopped(await stage('doctor', () => doctorStage(ctx)))) return;
  const validated = await stage('validate', () => scriptStage(ctx, 'validate', flags.validate));
  if (stopped(validated)) return;
  state.validated = true;
  const built = await stage('build', () => scriptStage(ctx, 'build', flags.build));
  if (typeof built.body?.out === 'string') state.output = built.body.out;
  if (stopped(built) || flags.noCheck) return;
  const checked = await stage('check', () => checkStage(ctx));
  if (checked.error) state.error = checked.error;
}

function stubScripts() {
  try {
    return JSON.parse(process.env.PA_MAKE_TEST_SCRIPTS ?? '{}');
  } catch {
    return {};
  }
}

/** The text form: a verdict line, one line per finding as `kind: path: message`, then the page. */
export function formatText(report) {
  if (report.error) return report.error.message === INTERRUPTED ? INTERRUPTED : `failed: ${report.error.message}${report.error.hint ? `; ${report.error.hint}` : ''}`;
  const validated = report.stages.find((s) => s.name === 'validate')?.ok === true;
  const lines = [validated && report.stages.every((s) => s.ok) ? 'valid' : 'invalid'];
  for (const f of report.findings) lines.push(`${f.kind}: ${f.path}: ${f.message}${f.fix ? ` (fix: ${f.fix})` : ''}`);
  for (const s of report.stages.filter((x) => x.skipped)) lines.push(`${s.name}: skipped`);
  if (report.output) lines.push(`output: ${report.output}`);
  return lines.join('\n');
}

function usageReport(err, usage) {
  const first = err.message.split('\n')[0];
  const [message, ...rest] = first.split(USAGE_MARK);
  return reportOf({ ...newRun(), error: { message, hint: rest.length > 0 ? `usage: ${rest.join(USAGE_MARK)}` : `usage: ${usage}` } });
}

function emit(report, json) {
  logMake(report);
  if (json) say(JSON.stringify(report));
  else {
    if (report.error) log(`make: ${report.error.message}${report.error.hint ? `; ${report.error.hint}` : ''}`);
    if (!(report.error && report.stages.length === 0)) say(formatText(report));
  }
  process.exitCode = exitCodeOf(report);
}

/**
 * The whole command. `cfg`: { skill, scriptsDir (the skill's scripts folder), extra: [{ name, type, value?, stages }]
 * (the skill's pass-through flags; stages is a list of 'validate' and/or 'build') }.
 */
export async function makeMain(argv, cfg) {
  const json = argv.includes('--json');
  const table = optionTable(cfg.extra ?? []);
  const usage = usageLine(table);
  const controller = new AbortController();
  const state = newRun();
  let signalled = false;
  for (const name of ['SIGINT', 'SIGTERM']) {
    process.on(name, () => {
      if (signalled) process.exit(EXIT.INTERRUPTED);
      signalled = true;
      log(`make: ${name} received, cleaning up`);
      controller.abort();
    });
  }
  try {
    const parsed = parseCli(argv, Object.fromEntries(Object.entries(table).map(([k, o]) => [k, { type: o.type }])), usage);
    if (parsed.positionals.length !== 1) throw new UsageError(`expected one spec file${USAGE_MARK}${usage}`);
    const [spec] = parsed.positionals;
    if (!fs.existsSync(spec) || !fs.statSync(spec).isFile()) {
      state.error = { message: `cannot read ${spec}: no such file`, hint: SPEC_HINT };
      return emit(reportOf(state), json);
    }
    const stubs = stubScripts();
    const ctx = {
      state, spec, skill: cfg.skill, signal: controller.signal,
      script: (name) => stubs[name] ?? path.join(cfg.scriptsDir, `${name}.mjs`),
      flags: { validate: stageArgs('validate', parsed.values, table), build: stageArgs('build', parsed.values, table), noCheck: parsed.values['no-check'] === true },
    };
    await pipeline(ctx);
  } catch (err) {
    if (err instanceof UsageError) {
      if (err.help === true) return say(json ? JSON.stringify({ ok: true, usage: err.message }) : `usage: ${err.message}`);
      return emit(usageReport(err, usage), json);
    }
    state.error = err instanceof Interrupted || signalled ? { message: INTERRUPTED, hint: '' } : describe(firstLine(err));
  }
  if (signalled && state.error === null) state.error = { message: INTERRUPTED, hint: '' };
  return emit(reportOf(state), json);
}
