// The body of scripts/preview.mjs, imported only after its preflight found node_modules (it imports ajv through spec.mjs).
import { spawn } from 'node:child_process';
import path from 'node:path';
import { loadSpec, validateSpec, UsageError as SpecUsageError } from './spec.mjs';
import { printResult } from '../../shared/errors.mjs';
import { UsageError, parseCli, exitUsage } from '../../shared/cli.mjs';
import { startServer } from './server.mjs';

const USAGE = 'node scripts/preview.mjs <motion.json> [--open]';
const OPTIONS = { open: { type: 'boolean', default: false } };

/** Serves the preview of the spec named in `argv` until SIGINT or SIGTERM; exit 1 for spec errors, 2 for usage or I/O. */
export async function main(argv) {
  try {
    const { values, positionals } = parseCli(argv, OPTIONS, USAGE);
    if (positionals.length !== 1) throw new UsageError(`expected one spec file; usage: ${USAGE}`);
    const [file] = positionals;
    const { spec, dir } = loadSpec(file);
    const result = validateSpec(spec, { dir });
    if (!result.ok) {
      printResult(result, { label: file });
      process.exitCode = 1;
      return;
    }
    const server = await startServer({ specPath: path.resolve(file), mode: 'preview' });
    process.stdout.write(`Preview: ${server.url}\nEdit ${file} and the page reloads. Ctrl+C to stop.\n`);
    if (values.open) {
      const opener = { darwin: 'open', win32: 'start' }[process.platform] ?? 'xdg-open';
      spawn(opener, [server.url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref();
    }
    // The server is the only thing keeping the process alive: once it is closed the loop drains and the exit code is 0.
    const stop = () => { server.close(); };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  } catch (e) {
    if (!(e instanceof UsageError || e instanceof SpecUsageError)) throw e;
    exitUsage(e);
  }
}
