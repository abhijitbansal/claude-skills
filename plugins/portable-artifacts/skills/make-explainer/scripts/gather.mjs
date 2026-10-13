#!/usr/bin/env node
// node scripts/gather.mjs git [--base <branch>] [--repo <folder>] [--json]
// Prints the facts of the checked-out branch as JSON: branch, base, merge base, commits,
// changed files (with +/- counts, renames and binaries), test files, date. Committed work
// only; nothing is written. Feed the output to scaffold.mjs --facts.
// exit 0 ok, 2 usage / not a repository / no such base
import { gatherGit } from './lib/git.mjs';
import { UsageError, parseCli, exitUsage, evalLog } from '../shared/cli.mjs';

const USAGE = 'node scripts/gather.mjs git [--base <branch>] [--repo <folder>] [--json]';
const OPTIONS = { base: { type: 'string' }, repo: { type: 'string' }, json: { type: 'boolean' } };
const SOURCES = ['git'];

const argv = process.argv.slice(2);
const json = argv.includes('--json');
try {
  const { values, positionals } = parseCli(argv, OPTIONS, USAGE);
  const [source, ...extra] = positionals;
  if (source === undefined) throw new UsageError(`expected a subcommand (${SOURCES.join(', ')}); usage: ${USAGE}`);
  if (!SOURCES.includes(source)) throw new UsageError(`unknown source "${source}"; the only source is ${SOURCES.join(', ')}; usage: ${USAGE}`);
  if (extra.length > 0) throw new UsageError(`unexpected argument "${extra[0]}"; usage: ${USAGE}`);
  const facts = gatherGit({ repo: values.repo, base: values.base });
  process.stdout.write(`${JSON.stringify(facts, null, values.json ? 0 : 2)}\n`);
  evalLog(true, 0);
} catch (e) {
  if (!(e instanceof UsageError)) throw e;
  evalLog(false, 1);
  exitUsage(e, { json });
}
