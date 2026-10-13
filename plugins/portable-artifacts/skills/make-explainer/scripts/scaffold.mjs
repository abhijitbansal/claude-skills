#!/usr/bin/env node
// node scripts/scaffold.mjs <recap|checklist|concept|slides> [--facts facts.json] [--title <text>]
// Prints a starter explainer.json on stdout. Facts (from gather.mjs) fill the numbers, files,
// commits and folders; every sentence is a "TODO: ..." string that validate.mjs rejects until
// it is replaced. Redirect the output to a file: scaffold.mjs recap --facts f.json > explainer.json
// exit 0 ok, 2 usage / unreadable facts
import fs from 'node:fs';
import { scaffold, PRESET_NAMES } from './lib/presets.mjs';
import { CHANGES } from './lib/schema.mjs';
import { didYouMean } from '../shared/errors.mjs';
import { UsageError, parseCli, exitUsage, evalLog } from '../shared/cli.mjs';

const USAGE = `node scripts/scaffold.mjs <${PRESET_NAMES.join('|')}> [--facts facts.json] [--title <text>]`;
const OPTIONS = { facts: { type: 'string' }, title: { type: 'string' } };

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const bad = (path, what) => new UsageError(`facts.${path} must be ${what}; produce the file with: node scripts/gather.mjs git > facts.json`);

function checkStrings(value, path, keys) {
  for (const key of keys) {
    if (value[key] !== undefined && typeof value[key] !== 'string') throw bad(path ? `${path}.${key}` : key, 'a string');
  }
}

function checkCount(file, path, key) {
  const n = file[key];
  if (n !== undefined && n !== null && !(Number.isInteger(n) && n >= 0)) throw bad(`${path}.${key}`, 'a whole number or null');
}

// The shape scaffold relies on, nothing more: unknown extra fields are fine.
function checkFacts(facts) {
  if (!isObject(facts)) throw new UsageError('the facts file must be a JSON object (the output of gather.mjs)');
  checkStrings(facts, '', ['branch', 'base', 'repo', 'date']);
  for (const key of ['commits', 'files']) {
    if (!Array.isArray(facts[key])) throw bad(key, 'an array');
  }
  if (facts.tests !== undefined && !(Array.isArray(facts.tests) && facts.tests.every((t) => typeof t === 'string'))) throw bad('tests', 'an array of paths');
  facts.commits.forEach((c, i) => {
    if (!isObject(c) || typeof c.subject !== 'string') throw bad(`commits[${i}].subject`, 'a string');
    checkStrings(c, `commits[${i}]`, ['sha', 'date']);
  });
  facts.files.forEach((f, i) => {
    const at = `files[${i}]`;
    if (!isObject(f) || typeof f.path !== 'string') throw bad(`${at}.path`, 'a string');
    if (!CHANGES.includes(f.change)) throw bad(`${at}.change`, `one of ${CHANGES.join(', ')}`);
    checkStrings(f, at, ['oldPath']);
    checkCount(f, at, 'add');
    checkCount(f, at, 'del');
  });
  return { ...facts, tests: facts.tests ?? [] };
}

function readFacts(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    throw new UsageError(`cannot read ${file}: ${e.code ?? e.message}`);
  }
  try {
    return checkFacts(JSON.parse(text));
  } catch (e) {
    if (e instanceof SyntaxError) throw new UsageError(`${file} is not valid JSON: ${e.message}`);
    throw e;
  }
}

function presetFrom(positionals) {
  const list = PRESET_NAMES.join(', ');
  if (positionals.length === 0) throw new UsageError(`expected a preset (${list}); usage: ${USAGE}`);
  if (positionals.length > 1) throw new UsageError(`expected one preset, got ${positionals.length} (${list}); usage: ${USAGE}`);
  const [preset] = positionals;
  if (PRESET_NAMES.includes(preset)) return preset;
  const guess = didYouMean(preset, PRESET_NAMES);
  throw new UsageError(`unknown preset "${preset}"; it must be one of ${list}${guess ? `; did you mean "${guess}"?` : ''}`);
}

const argv = process.argv.slice(2);
try {
  const { values, positionals } = parseCli(argv, OPTIONS, USAGE);
  const preset = presetFrom(positionals);
  const facts = values.facts === undefined ? null : readFacts(values.facts);
  process.stdout.write(`${JSON.stringify(scaffold(preset, { facts, title: values.title }), null, 2)}\n`);
  evalLog(true, 0);
} catch (e) {
  if (!(e instanceof UsageError)) throw e;
  evalLog(false, 1);
  exitUsage(e);
}
