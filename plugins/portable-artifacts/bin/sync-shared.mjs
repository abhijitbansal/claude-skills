#!/usr/bin/env node
// Copy plugins/portable-artifacts/shared/ into every skill as skills/<skill>/shared/.
// Every install path (Claude plugin, bin/install.mjs, `npx skills add`) copies
// whole skill folders, so each skill must carry its own copy.
//   node bin/sync-shared.mjs                 write the copies
//   node bin/sync-shared.mjs --check         exit 1 and list drift, write nothing
//   --plugin <dir>                           operate on another plugin folder (tests)
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const PLUGIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXCLUDE_TOP = new Set(['test', 'README.md']);
export const GENERATED_NOTE = '# Generated copy\n\nDo not edit. The source is `plugins/portable-artifacts/shared/`.\nAfter editing it, run `node bin/sync-shared.mjs` from `plugins/portable-artifacts`.\n';

function walk(root, rel = '') {
  const out = [];
  for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${entry.name}` : entry.name;
    if (!rel && EXCLUDE_TOP.has(entry.name)) continue;
    if (entry.isDirectory()) out.push(...walk(root, r));
    else if (entry.isFile()) out.push(r);
  }
  return out;
}

// rel path -> Buffer, exactly what every copy must contain.
function expected(pluginDir) {
  const shared = path.join(pluginDir, 'shared');
  const files = new Map(walk(shared).map((r) => [r, fs.readFileSync(path.join(shared, r))]));
  files.set('GENERATED.md', Buffer.from(GENERATED_NOTE));
  return files;
}

function skills(pluginDir) {
  const root = path.join(pluginDir, 'skills');
  return fs.readdirSync(root)
    .filter((d) => fs.existsSync(path.join(root, d, 'SKILL.md')))
    .sort();
}

export function diffShared(pluginDir) {
  const want = expected(pluginDir);
  const problems = [];
  for (const skill of skills(pluginDir)) {
    const copy = path.join(pluginDir, 'skills', skill, 'shared');
    const have = fs.existsSync(copy) ? new Set(walk(copy)) : new Set();
    const files = [...new Set([...want.keys(), ...have])].sort();
    for (const file of files) {
      if (!want.has(file)) problems.push({ skill, file, problem: 'extra' });
      else if (!have.has(file)) problems.push({ skill, file, problem: 'missing' });
      else if (!fs.readFileSync(path.join(copy, file)).equals(want.get(file))) problems.push({ skill, file, problem: 'changed' });
    }
  }
  return problems;
}

export function syncShared(pluginDir) {
  const want = expected(pluginDir);
  for (const skill of skills(pluginDir)) {
    const copy = path.join(pluginDir, 'skills', skill, 'shared');
    fs.rmSync(copy, { recursive: true, force: true });
    for (const [file, body] of want) {
      fs.mkdirSync(path.dirname(path.join(copy, file)), { recursive: true });
      fs.writeFileSync(path.join(copy, file), body);
    }
  }
}

function main() {
  let values;
  try {
    ({ values } = parseArgs({ args: process.argv.slice(2), options: { check: { type: 'boolean' }, plugin: { type: 'string' } }, strict: true }));
  } catch (e) {
    process.stderr.write(`sync-shared: ${e.message.split('. ')[0]}; accepted: --check, --plugin <dir>\n`);
    process.exit(2);
  }
  const dir = path.resolve(values.plugin ?? PLUGIN);
  if (values.check) {
    const problems = diffShared(dir);
    for (const p of problems) process.stderr.write(`skills/${p.skill}/shared/${p.file}: ${p.problem}\n`);
    if (problems.length) {
      process.stderr.write('shared/ copies are out of date; run: node bin/sync-shared.mjs (from plugins/portable-artifacts)\n');
      process.exit(1);
    }
    process.stdout.write('shared/ copies are in sync\n');
    return;
  }
  syncShared(dir);
  process.stdout.write(`synced shared/ into ${skills(dir).join(', ')}\n`);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
