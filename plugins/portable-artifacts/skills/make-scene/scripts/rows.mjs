#!/usr/bin/env node
// node scripts/rows.mjs git [--weeks 12] [--depth 1] [--repo <dir>] [--out <rows.json>]
// Writes { "rows": [...] } (commits per top-level folder per ISO week) for a scene's data.file. A --repo inside a
// larger repository counts that folder alone, grouped by the folders inside it (one stderr note says so).
// exit 0 written, 2 usage/IO
import fs from 'node:fs';
import path from 'node:path';
import { UsageError, parseCli, exitUsage } from '../shared/cli.mjs';
import { exitInternal } from './lib/internal-error.mjs';
import { historyRows } from './lib/history-rows.mjs';

const USAGE = 'node scripts/rows.mjs git [--weeks 12] [--depth 1] [--repo <dir>] [--out <rows.json>]';
const OPTIONS = {
  weeks: { type: 'string' },
  depth: { type: 'string' },
  repo: { type: 'string' },
  out: { type: 'string' },
};
const MAX_WEEKS = 520;
const MAX_DEPTH = 8;
const DEFAULT_OUT = 'scene-rows.json';

function positiveInt(name, value, fallback, max) {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!/^\d+$/.test(value) || n < 1 || n > max) throw new UsageError(`--${name} must be a whole number from 1 to ${max}, got ${JSON.stringify(value)}; usage: ${USAGE}`);
  return n;
}

try {
  const { values, positionals } = parseCli(process.argv.slice(2), OPTIONS, USAGE);
  if (positionals[0] !== 'git' || positionals.length !== 1) {
    throw new UsageError(`the one source is "git"${positionals.length ? `, got ${JSON.stringify(positionals.join(' '))}` : ''}; usage: ${USAGE}`);
  }
  const weeks = positiveInt('weeks', values.weeks, 12, MAX_WEEKS);
  const depth = positiveInt('depth', values.depth, 1, MAX_DEPTH);
  const repo = values.repo ?? '.';
  const out = values.out ?? DEFAULT_OUT;

  const rows = historyRows({ repo, weeks, depth, warn: (m) => process.stderr.write(`${m}\n`) });
  try {
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(out, `${JSON.stringify({ rows })}\n`);
  } catch (e) {
    throw new UsageError(`cannot write ${out}: ${e.code ?? e.message}`);
  }
  const file = path.basename(out);
  const folder = path.dirname(path.resolve(out));
  process.stdout.write(`wrote ${rows.length} rows to ${out}\n`);
  process.stdout.write(`paste into scene.json: "data": { "file": ${JSON.stringify(file)} }\n`);
  // data.file is resolved from the scene's own folder and may not be absolute or contain "..".
  const where = folder === process.cwd() ? 'the same folder as' : `${folder}, the same folder as`;
  process.stdout.write(`scene.json must sit in ${where} ${file}\n`);
} catch (e) {
  if (e instanceof UsageError) exitUsage(e);
  else exitInternal(e);
}
