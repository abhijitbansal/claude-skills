// scripts/lib/help.mjs: --help and -h for the scripts that read their own flags (beats.mjs, the cut-out tool). No browser, no model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wantsHelp, printHelp } from '../scripts/lib/help.mjs';

test('wantsHelp is true for --help or -h anywhere in the arguments, and for nothing else', () => {
  assert.equal(wantsHelp(['--help']), true);
  assert.equal(wantsHelp(['song.wav', '-h']), true);
  assert.equal(wantsHelp(['song.wav', '--out', 'x.json']), false);
  assert.equal(wantsHelp([]), false);
  assert.equal(wantsHelp(['--helpful']), false);
});

test('printHelp writes one usage line to stdout, adds the prefix once, and leaves the exit code 0', () => {
  const write = process.stdout.write.bind(process.stdout);
  const savedCode = process.exitCode;
  let seen = '';
  process.stdout.write = (chunk) => { seen += chunk; return true; };
  try {
    printHelp('node scripts/beats.mjs <audio>');
    printHelp('usage: node scripts/cutout.mjs <picture>');
  } finally {
    process.stdout.write = write;
    process.exitCode = savedCode;
  }
  assert.equal(seen, 'usage: node scripts/beats.mjs <audio>\nusage: node scripts/cutout.mjs <picture>\n');
});
