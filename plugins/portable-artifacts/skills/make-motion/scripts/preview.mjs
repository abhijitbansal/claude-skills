#!/usr/bin/env node
// node scripts/preview.mjs <motion.json> [--open]
import { spawn } from 'node:child_process';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadSpec, validateSpec, UsageError } from './lib/spec.mjs';
import { printResult } from './lib/errors.mjs';
import { startServer } from './lib/server.mjs';

const USAGE = 'usage: node scripts/preview.mjs <motion.json> [--open]';
try {
  let parsed;
  try {
    parsed = parseArgs({ allowPositionals: true, options: { open: { type: 'boolean', default: false } } });
  } catch (e) {
    throw new UsageError(`${e.message}\n${USAGE}`);
  }
  const [file, ...extra] = parsed.positionals;
  if (!file || extra.length) throw new UsageError(USAGE);
  const { spec, dir } = loadSpec(file);
  const result = validateSpec(spec, { dir });
  if (!result.ok) {
    printResult(result, { label: file });
    process.exit(1);
  }
  const server = await startServer({ specPath: path.resolve(file), mode: 'preview' });
  process.stdout.write(`Preview: ${server.url}\nEdit ${file} and the page reloads. Ctrl+C to stop.\n`);
  if (parsed.values.open) {
    const opener = { darwin: 'open', win32: 'start' }[process.platform] ?? 'xdg-open';
    spawn(opener, [server.url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref();
  }
  const stop = () => server.close().then(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
} catch (e) {
  if (!(e instanceof UsageError)) throw e;
  process.stderr.write(`${e.message}\n`);
  process.exit(2);
}
