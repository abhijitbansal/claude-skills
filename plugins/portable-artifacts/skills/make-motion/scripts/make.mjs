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
// says which and how to fix it. Exit 130: stopped by SIGINT or SIGTERM (`error.message` is "interrupted"); a --preview that
// is already serving is the exception: stopping it is how it ends, exit 0. An exception nobody caught is exit 2 with
// its message as the error, in a preview and a batch too. The report keeps what was done before a stop. It never opens a dialog and never waits for input.
//
// A thin entry: it checks for node_modules with Node built-ins only, then loads the body (v2/make-main.mjs), which imports
// ajv and the rest. Without node_modules the one line names the doctor command and the exit is 2, with one JSON object on
// stdout under --json (shared/preflight.mjs); a raw ERR_MODULE_NOT_FOUND stack with exit 1 is what this prevents.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preflight } from '../shared/preflight.mjs';

const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (preflight(SKILL_ROOT)) await (await import('./v2/make-main.mjs')).main(process.argv.slice(2));
