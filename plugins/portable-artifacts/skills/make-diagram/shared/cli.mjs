// Shared CLI plumbing: strict argument parsing and the exit-2 (usage/IO) path.
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { didYouMean } from './errors.mjs';

export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

// An unknown --flag close to a real one: "; did you mean '--facts'". Short flags and far-off words get none.
function flagHint(message, options) {
  const flag = /^Unknown option '--([^']+)'/.exec(message)?.[1];
  const hint = flag === undefined ? null : didYouMean(flag, Object.keys(options));
  return hint === null ? '' : `; did you mean '--${hint}'`;
}

// --help / -h: not an error. A UsageError with help = true and the usage line as its message, so a script's
// existing `catch (e) { if (e instanceof UsageError) exitUsage(e, { json }) }` prints it and exits 0.
class HelpRequested extends UsageError {
  constructor(usage) {
    super(usage);
    this.help = true;
  }
}

// Strict parseArgs; any problem becomes a one-line UsageError. --help and -h (unless the script declares
// its own) throw a help request first, so they win over any other flag problem.
export function parseCli(argv, options, usage) {
  const wantsHelp = argv.some((a) => (a === '--help' && !('help' in options)) || (a === '-h' && !('h' in options)));
  if (wantsHelp) throw new HelpRequested(usage);
  try {
    const { values, positionals } = parseArgs({ args: argv, options, allowPositionals: true, strict: true });
    return { values, positionals };
  } catch (e) {
    const message = String(e.message).split('. ')[0].replace(/\.$/, '');
    throw new UsageError(`${message}${flagHint(message, options)}; usage: ${usage}`);
  }
}

export function parseTimeout(value, fallbackSeconds) {
  if (value === undefined) return fallbackSeconds * 1000;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) throw new UsageError(`--timeout must be a positive number of seconds, got ${JSON.stringify(value)}`);
  return Math.round(seconds * 1000);
}

// Exit 2 with one line: JSON on stdout when asked, plain text on stderr otherwise.
// A help request prints the usage line on stdout and exits 0 instead.
// Sets exitCode and returns (callers must stop): process.exit() right after a
// pipe write intermittently SIGSEGVs on Node 24.7.
export function exitUsage(error, { json = false } = {}) {
  if (error.help === true) {
    if (json) process.stdout.write(`${JSON.stringify({ ok: true, usage: error.message })}\n`);
    else process.stdout.write(`usage: ${error.message}\n`);
    process.exitCode = 0;
    return;
  }
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
