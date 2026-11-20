// The report every skill's scripts/make.mjs prints (one JSON object with --json), and the run state that builds it.
// make-motion's make.mjs keeps its own richer report; the four page skills share this core:
//   ok, output, stages, findings, and `error: { message, hint }` only when the machine or the command line stopped the run.
//   A stage is { name, ok, seconds } (plus skipped: true for one that could not run for want of a browser).
//   A finding is { kind, path, message } (plus fix, a short instruction, only where the validator named one).
//   kind "mechanical": a JSON path the operator may change as the message says; "creative": the director decides.
// The run state is a plain accumulator: newRun(), then runStage(...) per stage, then reportOf(state). Impure only in
// reportOf (it checks that the output file exists) and logMake (the EVAL_LOG line).
import fs from 'node:fs';

export const EXIT = Object.freeze({ OK: 0, NOT_OK: 1, MACHINE: 2, INTERRUPTED: 130 });
export const INTERRUPTED = 'interrupted'; // the error message of a run stopped by SIGINT or SIGTERM
export const KINDS = Object.freeze(['mechanical', 'creative']);
const SECOND_DECIMALS = 100;
const now = () => Number(process.hrtime.bigint()) / 1e9;

/** The state of a run that has not started: not validated, no error, no output, no stages, no findings. */
export const newRun = () => ({ validated: false, error: null, output: null, stages: [], findings: [] });

/**
 * Run one stage and record it. `fn` may return { skipped: true } (recorded ok and skipped), a value with ok === false
 * (recorded not ok, returned to the caller), or anything else (ok). A throw records the stage as not ok and rethrows.
 * `log` receives one progress line per stage (stderr in make.mjs).
 */
export async function runStage(state, name, fn, log = () => {}) {
  const start = now();
  const record = (extra) => {
    const seconds = Math.round((now() - start) * SECOND_DECIMALS) / SECOND_DECIMALS;
    state.stages.push({ name, ok: extra.ok, seconds, ...(extra.skipped ? { skipped: true } : {}) });
  };
  let result;
  try {
    result = await fn();
  } catch (err) {
    record({ ok: false });
    log(`make: ${name} failed`);
    throw err;
  }
  const skipped = result?.skipped === true;
  const ok = skipped || result?.ok !== false;
  record({ ok, skipped });
  log(`make: ${name} ${skipped ? 'skipped' : ok ? 'ok' : 'failed'}`);
  return result;
}

/** One finding. `fix` is left out when undefined. Throws on a kind that is not mechanical or creative. */
export function finding(kind, path, message, fix) {
  if (!KINDS.includes(kind)) throw new Error(`finding kind must be one of: ${KINDS.join(', ')}; got ${JSON.stringify(kind)}`);
  return fix === undefined ? { kind, path, message } : { kind, path, message, fix };
}

const outputIfWritten = (file) => (typeof file === 'string' && fs.existsSync(file) ? file : null);

/** The report of a run. ok: validation passed, no error, every stage ok, and no mechanical finding. */
export function reportOf(state) {
  const mechanical = state.findings.some((f) => f.kind === 'mechanical');
  return {
    ok: state.validated && state.error === null && state.stages.every((s) => s.ok) && !mechanical,
    output: outputIfWritten(state.output),
    stages: state.stages,
    findings: state.findings,
    ...(state.error === null ? {} : { error: state.error }),
  };
}

/** 0 ok, 1 not ok, 2 an error (usage or machine), 130 an interrupt. */
export function exitCodeOf(report) {
  if (report.error) return report.error.message === INTERRUPTED ? EXIT.INTERRUPTED : EXIT.MACHINE;
  return report.ok ? EXIT.OK : EXIT.NOT_OK;
}

/** Append { ts, command: "make", ok, mechanical, creative } to $EVAL_LOG when it is set. Never throws. */
export function logMake(report, env = process.env) {
  if (!env.EVAL_LOG) return;
  const count = (kind) => report.findings.filter((f) => f.kind === kind).length;
  try {
    const line = { ts: new Date().toISOString(), command: 'make', ok: report.ok, mechanical: count('mechanical'), creative: count('creative') };
    fs.appendFileSync(env.EVAL_LOG, `${JSON.stringify(line)}\n`);
  } catch {
    // a broken log path never changes the outcome of the run
  }
}
