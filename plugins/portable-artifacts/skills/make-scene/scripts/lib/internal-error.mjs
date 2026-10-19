// A failure that is neither a spec error nor a usage error is a bug in the tool:
// say so in one line (exit 1) instead of printing a stack trace.

/** Print "internal error: <message>; please report it" (JSON on stdout when asked, else stderr) and set exit code 1. */
export function exitInternal(error, { json = false } = {}) {
  const first = String(error?.message ?? error).split('\n')[0];
  const message = `internal error: ${first}; please report it`;
  if (json) process.stdout.write(`${JSON.stringify({ ok: false, errors: [{ path: '', message }] })}\n`);
  else process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
