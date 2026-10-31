#!/usr/bin/env node
// node scripts/blocks.mjs list | show <name>
// list: one line per block, its params (optional ones marked ?). show: what the block is for, a table of its params
// (param, type, required, default, description), where it goes on each format, then a ready-to-paste element as JSON.
// exit 0 ok, 2 usage (an unknown block names the closest one and lists them all)
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BLOCKS, BLOCK_NAMES } from '../template/blocks/index.mjs';
import { FORMATS, FORMAT_NAMES } from '../template/formats.mjs';
import { UsageError, parseCli, exitUsage } from '../shared/cli.mjs';
import { didYouMean } from '../shared/errors.mjs';

const USAGE = 'node scripts/blocks.mjs list | show <name>';
const COMMANDS = ['list', 'show'];
const COLUMN_GAP = 2;

const paramList = ({ params }) => Object.keys(params.properties).map((key) => (params.required.includes(key) ? key : `${key}?`)).join(', ');

// A param schema as one short type with its caps: string≤80, integer 0–4, number ±999999999999, left|right,
// string≤24[2–6] (2 to 6 strings of up to 24 characters).
function typeOf(schema) {
  if (schema.enum) return schema.enum.join('|');
  if (schema.type === 'array') return `${typeOf(schema.items)}[${schema.minItems}–${schema.maxItems}]`;
  if (schema.type === 'string') return schema.maxLength === undefined ? 'string' : `string≤${schema.maxLength}`;
  const { minimum: lo, maximum: hi } = schema;
  if (lo !== undefined && hi !== undefined) return lo === -hi ? `${schema.type} ±${hi}` : `${schema.type} ${lo}–${hi}`;
  return schema.type;
}

// Where the block goes on each format, as one line; `side` is passed to place() (lower-third).
function placeLine(def, side) {
  return FORMAT_NAMES.map((format) => {
    const { x, y } = def.place(FORMATS[format].size, format, side);
    return `${format} x ${Math.round(x)} y ${Math.round(y)}`;
  }).join('; ');
}

function table(rows) {
  const widths = rows[0].map((_, c) => Math.max(...rows.map((row) => row[c].length)));
  return rows.map((row) => row.map((cell, c) => (c === row.length - 1 ? cell : cell.padEnd(widths[c] + COLUMN_GAP))).join('')).join('\n');
}

function list() {
  return BLOCK_NAMES.map((name) => `${name}  params: ${paramList(BLOCKS[name])}`).join('\n');
}

function show(name) {
  const def = BLOCKS[name];
  const rows = Object.entries(def.params.properties).map(([key, schema]) => [
    key, typeOf(schema), def.params.required.includes(key) ? 'yes' : 'no', schema.default === undefined ? '-' : String(schema.default), def.describe[key],
  ]);
  // A block with a `side` param also gets a line for each other side.
  const side = def.params.properties.side;
  const otherSides = (side?.enum ?? []).filter((value) => value !== side.default);
  const { x, y } = def.place(FORMATS['16:9'].size, '16:9');
  const element = { id: name.split('-')[0], type: 'block', x: Math.round(x), y: Math.round(y), block: name, params: def.example };
  return [
    `${name}: ${def.summary}`,
    '',
    table([['param', 'type', 'required', 'default', 'description'], ...rows]),
    '',
    `place (x, y): ${placeLine(def)}`,
    ...otherSides.map((value) => `place with "side": ${JSON.stringify(value)} (x, y): ${placeLine(def, value)}`),
    '',
    'example element (1920x1080):',
    JSON.stringify(element, null, 2),
  ].join('\n');
}

function unknownBlock(name) {
  const near = didYouMean(name, BLOCK_NAMES);
  return new UsageError(`unknown block ${JSON.stringify(name)}${near ? `; did you mean ${JSON.stringify(near)}?` : ''} (blocks: ${BLOCK_NAMES.join(', ')})`);
}

export function main(argv) {
  try {
    const { positionals } = parseCli(argv, {}, USAGE);
    const [command, name, ...rest] = positionals;
    if (!COMMANDS.includes(command)) {
      const near = command === undefined ? null : didYouMean(command, COMMANDS);
      throw new UsageError(`${command === undefined ? 'no command' : `unknown command ${JSON.stringify(command)}`}${near ? `; did you mean ${JSON.stringify(near)}?` : ''}; usage: ${USAGE}`);
    }
    if (command === 'list') {
      if (name !== undefined) throw new UsageError(`list takes no arguments; usage: ${USAGE}`);
      process.stdout.write(`${list()}\n`);
      return 0;
    }
    if (name === undefined || rest.length) throw new UsageError(`show takes one block name; usage: ${USAGE}`);
    if (!BLOCKS[name]) throw unknownBlock(name);
    process.stdout.write(`${show(name)}\n`);
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
