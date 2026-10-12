#!/usr/bin/env node
// Find an icon ref without reading the catalogs.
//   node scripts/icons.mjs search <word>        matching refs, best first, one per line
//   node scripts/icons.mjs list [lucide|brand]  every ref (both catalogs when omitted)
// Exit 0 on success (a search with no match prints nothing), 2 on bad usage.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { UsageError, parseCli, exitUsage } from '../shared/cli.mjs';
import { searchIcons, listIcons } from './lib/icons.mjs';

const USAGE = 'icons.mjs search <word> | icons.mjs list [lucide|brand]';
const SETS = ['lucide', 'brand'];

export function run(argv) {
  const { positionals } = parseCli(argv, {}, USAGE);
  const [command, ...args] = positionals;
  if (command === 'search') {
    if (args.length !== 1) throw new UsageError(`search takes exactly one word; usage: ${USAGE}`);
    return searchIcons(args[0]);
  }
  if (command === 'list') {
    if (args.length > 1) throw new UsageError(`list takes at most one catalog; usage: ${USAGE}`);
    if (args.length === 1 && !SETS.includes(args[0])) {
      throw new UsageError(`unknown catalog ${JSON.stringify(args[0])}; accepted: ${SETS.join(', ')}`);
    }
    return listIcons(args[0]);
  }
  throw new UsageError(`${command === undefined ? 'missing subcommand' : `unknown subcommand ${JSON.stringify(command)}`}; accepted: search, list; usage: ${USAGE}`);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const refs = run(process.argv.slice(2));
    if (refs.length) process.stdout.write(`${refs.join('\n')}\n`);
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    exitUsage(e);
  }
}
