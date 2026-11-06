#!/usr/bin/env node
// Find an icon ref without reading the catalogs, or import vendor cloud icons.
//   node scripts/icons.mjs search <word>                 matching refs, best first, one per line
//   node scripts/icons.mjs list [lucide|brand|cloud]     every ref (all catalogs when omitted)
//   node scripts/icons.mjs import <aws|gcp> <folder>     add the icons in an unpacked vendor download
// Exit 0 on success (a search with no match prints nothing), 2 on bad usage or an import that cannot run.
// import reads the folder only (no network, no prompt) and keeps the icons in
// $MAKE_DIAGRAM_ICON_DIR, else ~/.cache/portable-artifacts/make-diagram.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { UsageError, parseCli, exitUsage } from '../shared/cli.mjs';
import { searchIcons, listIcons, iconDir, bundledCloudNames } from './lib/icons.mjs';
import { importIcons, providerNames, ImportError } from './lib/icon-import.mjs';

const USAGE = 'icons.mjs search <word> | icons.mjs list [lucide|brand|cloud] | icons.mjs import <aws|gcp> <folder>';
const SETS = ['lucide', 'brand', 'cloud'];
const SKIPPED_SHOWN = 20;
const TERMS = "You are responsible for having accepted the vendor's terms for these icons; this command does not download them or check the terms.";

function importLines(provider, folder) {
  const dir = iconDir();
  let result;
  try {
    result = importIcons(provider, folder, dir);
  } catch (e) {
    if (e instanceof ImportError) throw new UsageError(e.message);
    throw e;
  }
  const { added, skipped } = result;
  const bundled = new Set(bundledCloudNames());
  const shadowed = added.filter((n) => bundled.has(n));
  const lines = [`added ${added.length}: ${added.join(', ')}`];
  if (shadowed.length) lines.push(`bundled icons of the same name win: ${shadowed.join(', ')}`);
  lines.push(`skipped ${skipped.length}${skipped.length ? ':' : ''}`);
  for (const s of skipped.slice(0, SKIPPED_SHOWN)) lines.push(`  ${s.file}: ${s.reason}`);
  if (skipped.length > SKIPPED_SHOWN) lines.push(`  ... and ${skipped.length - SKIPPED_SHOWN} more`);
  lines.push(`saved in ${dir}`, TERMS);
  return lines;
}

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
  if (command === 'import') {
    if (args.length !== 2) throw new UsageError(`import takes a provider (${providerNames().join(' or ')}) and a folder; usage: ${USAGE}`);
    if (!providerNames().includes(args[0])) throw new UsageError(`unknown provider ${JSON.stringify(args[0])}; accepted: ${providerNames().join(', ')}`);
    return importLines(args[0], args[1]);
  }
  throw new UsageError(`${command === undefined ? 'missing subcommand' : `unknown subcommand ${JSON.stringify(command)}`}; accepted: search, list, import; usage: ${USAGE}`);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const lines = run(process.argv.slice(2));
    if (lines.length) process.stdout.write(`${lines.join('\n')}\n`);
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    exitUsage(e);
  }
}
