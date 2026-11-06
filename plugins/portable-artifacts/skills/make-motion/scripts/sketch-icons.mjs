#!/usr/bin/env node
// node scripts/sketch-icons.mjs search <word> | list
// The icon names a hand-drawn scene can draw (type "icon" `name`, a sketch block's `icon`). search: names that contain the
// word, the exact one first, then those that start with it (at most MAX_RESULTS lines). list: every name, one per line.
// exit 0 ok, 2 usage (an unknown command or flag names the accepted ones)
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import lucide from '../template/sketch/lucide.mjs';
import { UsageError, parseCli, exitUsage } from '../shared/cli.mjs';
import { didYouMean } from '../shared/errors.mjs';

const USAGE = 'node scripts/sketch-icons.mjs search <word> | list';
const COMMANDS = ['search', 'list'];
const MAX_RESULTS = 50;
const NAMES = Object.keys(lucide).sort();

// Exact match, then names that start with the word, then the rest in alphabetical order.
function search(word) {
  const w = word.toLowerCase();
  const rank = (name) => (name === w ? 0 : name.startsWith(w) ? 1 : 2);
  return NAMES.filter((name) => name.includes(w)).sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : 1));
}

function searchOutput(word) {
  const found = search(word);
  if (!found.length) {
    const near = didYouMean(word, NAMES);
    return `no icon name contains ${JSON.stringify(word)}${near ? `; did you mean ${JSON.stringify(near)}?` : ''}\n`;
  }
  const lines = found.slice(0, MAX_RESULTS);
  if (found.length > MAX_RESULTS) lines.push(`... ${found.length - MAX_RESULTS} more; narrow the search`);
  return `${lines.join('\n')}\n`;
}

export function main(argv) {
  try {
    const { positionals } = parseCli(argv, {}, USAGE);
    const [command, word, ...rest] = positionals;
    if (!COMMANDS.includes(command)) {
      const near = command === undefined ? null : didYouMean(command, COMMANDS);
      throw new UsageError(`${command === undefined ? 'no command' : `unknown command ${JSON.stringify(command)}`}${near ? `; did you mean ${JSON.stringify(near)}?` : ''}; usage: ${USAGE}`);
    }
    if (command === 'list') {
      if (word !== undefined) throw new UsageError(`list takes no arguments; usage: ${USAGE}`);
      process.stdout.write(`${NAMES.join('\n')}\n`);
      return 0;
    }
    if (word === undefined || rest.length) throw new UsageError(`search takes one word; usage: ${USAGE}`);
    process.stdout.write(searchOutput(word));
    return 0;
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    exitUsage(e);
    return 2;
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
