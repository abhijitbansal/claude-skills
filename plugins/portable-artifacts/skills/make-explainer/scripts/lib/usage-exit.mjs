// Reporting a usage error for the spec-reading scripts. Kept apart from spec.mjs (which imports ajv) so an entry
// script can answer a bad flag or a missing install without loading its dependencies.
import { UsageError, exitUsage } from '../../shared/cli.mjs';
import { JsonSyntaxError } from './json-error.mjs';

export { UsageError, JsonSyntaxError };

/**
 * Report a UsageError the way exitUsage does (exit 2; JSON on stdout when asked, text on stderr), except that a
 * JSON syntax error also shows its offending line and caret: the shared helper prints only a message's first line.
 */
export function exitSpecUsage(error, { json = false } = {}) {
  if (!(error instanceof JsonSyntaxError)) return exitUsage(error, { json });
  const message = `${error.message}\n${error.snippet}`;
  if (json) process.stdout.write(`${JSON.stringify({ ok: false, errors: [{ path: '', message }] })}\n`);
  else process.stderr.write(`${message}\n`);
  process.exitCode = 2;
  return undefined;
}
