// Shared CLI plumbing: strict argument parsing and the exit-2 (usage/IO) path.
import fs from 'node:fs';
import { parseArgs } from 'node:util';

export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

// Strict parseArgs; any problem becomes a one-line UsageError.
export function parseCli(argv, options, usage) {
  try {
    const { values, positionals } = parseArgs({ args: argv, options, allowPositionals: true, strict: true });
    return { values, positionals };
  } catch (e) {
    throw new UsageError(`${String(e.message).split('. ')[0].replace(/\.$/, '')}; usage: ${usage}`);
  }
}

export function parseTimeout(value, fallbackSeconds) {
  if (value === undefined) return fallbackSeconds * 1000;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) throw new UsageError(`--timeout must be a positive number of seconds, got ${JSON.stringify(value)}`);
  return Math.round(seconds * 1000);
}

// Exit 2 with one line: JSON on stdout when asked, plain text on stderr otherwise.
// Sets exitCode and returns (callers must stop): process.exit() right after a
// pipe write intermittently SIGSEGVs on Node 24.7.
export function exitUsage(error, { json = false } = {}) {
  const message = String(error.message).split('\n')[0];
  if (json) process.stdout.write(`${JSON.stringify({ ok: false, errors: [{ path: '', message }] })}\n`);
  else process.stderr.write(`${message}\n`);
  process.exitCode = 2;
}

// Append one { ts, ok, errors } JSON line to $EVAL_LOG when it is set. Best
// effort: a broken log path must never change the validation outcome.
export function evalLog(ok, errorCount) {
  if (!process.env.EVAL_LOG) return;
  try {
    fs.appendFileSync(process.env.EVAL_LOG, `${JSON.stringify({ ts: new Date().toISOString(), ok, errors: errorCount })}\n`);
  } catch {
    // ignored on purpose
  }
}
