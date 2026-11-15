#!/usr/bin/env node
// make-motion 2, the one command: validate a film, build its timeline, write the review sheets and the audit, render
// the MP4. Read the JSON with --json (one object on stdout, progress on stderr).
//
//   node scripts/make.mjs <film.json> [--out <file.mp4>] [--json] [--no-render | --sheets-only] [--exact] [--outline]
//   node scripts/make.mjs --list kinds|looks|modes|devices|cuts|fields [--json]
//
// Exit 0: the film is valid and has no mechanical finding. Exit 1: it is invalid, or a mechanical finding exists (the
// MP4 is still rendered when the film validated). Exit 2: a usage error or trouble with the machine (a missing file, no
// browser, no ffmpeg); the message says which and how to fix it. It never opens a dialog and never waits for input.
import { UsageError, exitUsage } from '../shared/cli.mjs';
import { parseMakeArgs } from './v2/cli.mjs';
import { listEntries, formatList, COMMON_SHOT_FIELDS } from './v2/list.mjs';
import { runMake } from './v2/run.mjs';
import { formatText, outlineLines } from './v2/report.mjs';

const EXIT_INTERRUPTED = 130;
const say = (text) => process.stdout.write(`${text}\n`);
const log = (line) => process.stderr.write(`${line}\n`);

function printList(options) {
  const entries = listEntries(options.list);
  if (!options.json) return say(formatList(options.list, entries));
  const common = options.list === 'kinds' ? { common: COMMON_SHOT_FIELDS } : {};
  return say(JSON.stringify({ ok: true, list: options.list, ...common, entries }));
}

function printResult(options, { report, sheetsDir }) {
  if (options.json) return say(JSON.stringify(report));
  if (report.outline) return say(outlineLines(report.outline).join('\n'));
  return say(formatText(report, { sheetsDir }));
}

// The first stop request asks the run to wind down (it closes its server, browser and files); a second one ends it now.
function stopOnSignal(controller) {
  let asked = false;
  const stop = (signal) => {
    if (asked) process.exit(EXIT_INTERRUPTED);
    asked = true;
    log(`make: ${signal} received, cleaning up`);
    controller.abort();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

async function main(argv) {
  const json = argv.includes('--json');
  let options;
  try {
    options = parseMakeArgs(argv);
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    return exitUsage(err, { json });
  }
  if (options.list) return printList(options);
  const controller = new AbortController();
  stopOnSignal(controller);
  try {
    const result = await runMake(options, { signal: controller.signal, log });
    printResult(options, result);
    process.exitCode = result.exitCode;
  } catch (err) {
    if (controller.signal.aborted) {
      log('make: stopped; its browser, server and partial files are cleaned up');
      process.exitCode = EXIT_INTERRUPTED;
      return;
    }
    exitUsage(err, { json });
  }
}

await main(process.argv.slice(2));
