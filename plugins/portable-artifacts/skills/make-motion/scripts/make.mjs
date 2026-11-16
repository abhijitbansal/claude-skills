#!/usr/bin/env node
// make-motion 2, the one command: validate a film, build its timeline, write the review sheets and the audit, render
// the MP4. Read the JSON with --json (one object on stdout on every path, progress on stderr).
//
//   node scripts/make.mjs <film.json> [--out <file.mp4>] [--json] [--no-render | --sheets-only] [--exact] [--outline]
//   node scripts/make.mjs --list kinds|looks|modes|devices|cuts|fields [--all] [--json]   (--all: experimental looks too)
//
// Exit 0: the film is valid and has no mechanical finding. Exit 1: it is invalid, or a mechanical finding exists (the
// MP4 is still rendered when the film validated), or the page raised an error about it. Exit 2: a usage error or trouble
// with the machine (a missing file, no browser, no ffmpeg, ffmpeg failing, a crashed or closed browser page, a timeout, a
// lost WebGL context, a picture the browser cannot decode); `error: { message, hint }` in the JSON, or on stderr,
// says which and how to fix it. Exit 130: stopped by SIGINT or SIGTERM (`error.message` is "interrupted"). The report
// keeps what was done before a stop. It never opens a dialog and never waits for input.
import { UsageError } from '../shared/cli.mjs';
import { parseMakeArgs } from './v2/cli.mjs';
import { listEntries, formatList, COMMON_SHOT_FIELDS } from './v2/list.mjs';
import { runMake } from './v2/run.mjs';
import { describeError, errorReport, formatText, outlineLines } from './v2/report.mjs';

const EXIT_MACHINE = 2;
const EXIT_INTERRUPTED = 130;
const USAGE_MARK = '; usage: ';
const say = (text) => process.stdout.write(`${text}\n`);
const log = (line) => process.stderr.write(`${line}\n`);

function printList(options) {
  const entries = listEntries(options.list, { all: options.all });
  if (!options.json) return say(formatList(options.list, entries));
  const common = options.list === 'kinds' ? { common: COMMON_SHOT_FIELDS } : {};
  return say(JSON.stringify({ ok: true, list: options.list, ...common, entries }));
}

function printResult(options, { report, sheetsDir, outline }) {
  if (options.json) return say(JSON.stringify(outline ? { ...report, outline } : report));
  if (outline) return say(outlineLines(outline).join('\n'));
  if (report.error) log(`make: ${report.error.message}${report.error.hint ? `; ${report.error.hint}` : ''}`);
  if (report.error && report.timed === null) return undefined; // stopped before there was anything to report in text
  return say(formatText(report, { sheetsDir }));
}

// A problem with the command line: one line on stderr, or the report with its error under --json.
function printUsageError(err, json) {
  const [message, ...rest] = err.message.split('\n')[0].split(USAGE_MARK);
  if (json) say(JSON.stringify(errorReport({ message, hint: rest.length > 0 ? `usage: ${rest.join(USAGE_MARK)}` : '' })));
  else log(err.message.split('\n')[0]);
  process.exitCode = EXIT_MACHINE;
}

// The first stop request asks the run to wind down (it closes its server, browser and files) and the report says
// "interrupted"; a second one ends the process at once. An exception nobody caught does the same wind-down, and the
// report then carries it as its error.
function guard(controller) {
  const state = { signalled: false, fatal: null };
  const stop = (name) => {
    if (state.signalled) process.exit(EXIT_INTERRUPTED);
    state.signalled = true;
    log(`make: ${name} received, cleaning up`);
    controller.abort();
  };
  const crash = (err) => {
    state.fatal ??= err;
    controller.abort();
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('uncaughtException', crash);
  process.on('unhandledRejection', crash);
  return state;
}

// What a run that ended in a crash says: the report it had, with the crash as its error.
function crashed(result, fatal) {
  return { ...result, report: { ...result.report, ok: false, error: describeError(fatal) }, exitCode: EXIT_MACHINE };
}

async function execute(options, controller, guarded) {
  let result = await runMake(options, { signal: controller.signal, log });
  if (guarded.fatal) result = crashed(result, guarded.fatal);
  printResult(options, result);
  process.exitCode = result.exitCode;
}

async function main(argv) {
  const json = argv.includes('--json');
  const controller = new AbortController();
  const guarded = guard(controller);
  try {
    const options = parseMakeArgs(argv);
    if (options.list) return printList(options);
    await execute(options, controller, guarded);
  } catch (err) {
    if (err instanceof UsageError) return printUsageError(err, json);
    const fatal = guarded.fatal ?? err;
    if (json) say(JSON.stringify(errorReport(describeError(fatal))));
    else log(`make: ${describeError(fatal).message}`);
    process.exitCode = guarded.signalled ? EXIT_INTERRUPTED : EXIT_MACHINE;
  }
}

await main(process.argv.slice(2));
