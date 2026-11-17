#!/usr/bin/env node
// make-motion 2, the one command: validate a film, build its timeline, write the review sheets and the audit, render
// the MP4. Read the JSON with --json (one object on stdout on every path, progress on stderr).
//
//   node scripts/make.mjs <film.json> [--out <file.mp4>] [--json] [--no-render | --sheets-only] [--exact] [--outline]
//   node scripts/make.mjs <film.json> --preview [--open]   (a loopback page with a scrubber, served until Ctrl-C)
//   node scripts/make.mjs --list kinds|looks|modes|devices|moves|cuts|fields|voices [--all] [--json]   (--all: experimental looks and parked kinds too)
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
import { readingLines } from './v2/voice/reading.mjs';
import { runBatch } from './v2/batch.mjs';
import { runPreview } from './v2/viewer-run.mjs';
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

function printResult(options, { report, sheetsDir, outline, outlineNote, reading }) {
  if (reading) return say(options.json ? JSON.stringify({ ...report, reading }) : readingLines(reading).join('\n'));
  const note = outlineNote ? { outlineNote } : {};
  if (options.json) return say(JSON.stringify(outline ? { ...report, outline, ...note } : report));
  if (outline) return say([...outlineLines(outline), ...(outlineNote ? [`note: ${outlineNote}`] : [])].join('\n'));
  if (report.error) log(`make: ${report.error.message}${report.error.hint ? `; ${report.error.hint}` : ''}`);
  if (report.error && report.timed === null) return undefined; // stopped before there was anything to report in text
  return say(formatText(report, { sheetsDir }));
}

// { message, hint } of a usage error: an error that carries its own hint (a removed flag: what to do instead, then the
// accepted flags) ends its message with it; any other is split where its usage text begins.
function usageParts(err) {
  const first = err.message.split('\n')[0];
  if (typeof err.hint === 'string' && first.endsWith(`: ${err.hint}`)) return { message: first.slice(0, -(err.hint.length + 2)), hint: err.hint };
  const [message, ...rest] = first.split(USAGE_MARK);
  return { message, hint: rest.length > 0 ? `usage: ${rest.join(USAGE_MARK)}` : '' };
}

// A problem with the command line: one line on stderr, or the report with its error under --json. --help is not a problem:
// the usage line on stdout and exit 0, as every entry script does (shared/cli.mjs exitUsage).
function printUsageError(err, json) {
  if (err.help === true) {
    say(json ? JSON.stringify({ ok: true, usage: err.message }) : `usage: ${err.message}`);
    process.exitCode = 0;
    return;
  }
  if (json) say(JSON.stringify(errorReport(usageParts(err))));
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

// --batch: one line per row (or the refusals), or the batch report under --json.
async function executeBatch(options, controller) {
  const { report, exitCode } = await runBatch(options, { signal: controller.signal, log, runRow: runMake });
  if (options.json) say(JSON.stringify(report));
  else {
    for (const e of report.errors) log(`make: ${e}`);
    for (const row of report.rows) say(`row ${row.index}: ${row.status} ${row.file}`);
    if (report.manifest) say(`manifest: ${report.manifest}`);
  }
  process.exitCode = exitCode;
}

// --preview: the URL line (or { ok, preview: { url } } under --json) once the page is up, then served until SIGINT or
// SIGTERM, which ends it cleanly (exit 0). A film that does not validate at the start is exit 1 with its lines.
async function executePreview(options, controller) {
  const result = await runPreview(options, { signal: controller.signal, log, say });
  if (result.findings) {
    if (options.json) say(JSON.stringify({ ok: false, findings: result.findings }));
    else for (const line of result.findings) log(`make: ${line}`);
  }
  if (result.error) {
    if (options.json) say(JSON.stringify(errorReport(describeError(new Error(result.error)))));
    else log(`make: ${result.error}`);
  }
  process.exitCode = result.exitCode;
}

async function execute(options, controller, guarded) {
  if (options.batch) return executeBatch(options, controller);
  if (options.preview) return executePreview(options, controller);
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
