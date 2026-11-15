// The stages behind scripts/make.mjs, in order: validate, timeline, review (the sheets and the audit), render. One
// browser session serves review and render. runMake always returns a report (report.mjs) and an exit code: 0 ok, 1 not
// ok (the film does not validate, or a mechanical finding exists, or the page raised an error about it), 2 for trouble
// with the machine (a missing film file, no browser, no ffmpeg, ffmpeg failing, a crashed or closed browser page, a
// timeout, a lost WebGL context, a picture the browser cannot decode: `report.error` says which and how to fix it),
// 130 when stopped through `signal`. What was done before a stop stays in the report. It always closes what it opened,
// never prints to stdout and never waits for input.
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { findFfmpeg } from '../lib/ffmpeg.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { loadFilm } from './pipeline.mjs';
import { SpecError } from './spec.mjs';
import { openSession, pageErrorMessage, machineMessage } from './session.mjs';
import { writeSheets } from './sheets.mjs';
import { renderFilm } from './render.mjs';
import { sessionFindings } from './review.mjs';
import { describeError, outlineOf, pageFinding, reportOf, reviewFinding, validationFinding } from './report.mjs';

const MS_PER_SECOND = 1000;
const MILLIS_DECIMALS = 1000;
const PROGRESS_STEPS = 10;
const EXIT_OK = 0;
const EXIT_NOT_OK = 1;
const EXIT_MACHINE = 2;
const EXIT_INTERRUPTED = 130;
const PAGE_PREFIX = 'page: '; // a finding about the page itself (sessionFindings, failureOutcome)

const seconds = (started) => Math.round(((performance.now() - started) / MS_PER_SECOND) * MILLIS_DECIMALS) / MILLIS_DECIMALS;

const newState = () => ({
  validated: false, error: null, stages: [], findings: [], sheets: [], output: null, timed: null, post: null, capture: null,
  frames: 0, captured: 0, seconds: null, msPerFrame: null, bytes: null, mbps: null, outline: null, sheetsDir: null,
});

// Runs fn and records its stage in state.stages whether it returns or throws; each stage is also said to `log`.
async function stage(state, log, name, fn) {
  const started = performance.now();
  const record = (ok) => {
    const entry = { name, ok, seconds: seconds(started) };
    state.stages.push(entry);
    log(`make: ${name} ${ok ? 'ok' : 'failed'} (${entry.seconds} s)`);
  };
  try {
    const value = await fn();
    record(true);
    return value;
  } catch (err) {
    record(false);
    throw err;
  }
}

// The film as loaded, or null when it does not validate (its errors become findings). Anything else (a missing or
// unreadable file) is the machine's trouble and propagates.
async function validate(options, state, log) {
  try {
    return await stage(state, log, 'validate', () => loadFilm(options.specPath));
  } catch (err) {
    if (!(err instanceof SpecError)) throw err;
    state.findings = err.errors.map(validationFinding);
    return null;
  }
}

const progressLogger = (log) => {
  let step = -1;
  return ({ frame, frames, captured }) => {
    const now = Math.floor((frame * PROGRESS_STEPS) / frames);
    if (now === step) return;
    step = now;
    log(`make: render ${frame}/${frames} frames (${captured} captured)`);
  };
};

// Where the video goes: --out, else out/<film name>.mp4 beside the film file; paths stay as the user gave them (relative
// ones relative to the current directory). The sheets go in a folder named for the video, beside it.
function outputPaths(options) {
  const name = path.basename(options.specPath, path.extname(options.specPath));
  const out = options.out ?? path.join(path.dirname(options.specPath), 'out', `${name}.mp4`);
  return { out, sheetsDir: path.join(path.dirname(out), `${path.basename(out, path.extname(out))}.sheets`) };
}

// The stages that need the page: the sheets and the audit, then (unless --no-render) the video.
async function reviewAndRender({ options, loaded, state, io: { signal, log } }) {
  const { out, sheetsDir } = outputPaths(options);
  state.sheetsDir = sheetsDir;
  const session = await openSession(loaded);
  try {
    state.post = session.info.post;
    const review = await stage(state, log, 'review', () => writeSheets({ session, dir: sheetsDir, signal }));
    state.sheets = review.files;
    state.findings = review.findings.map(reviewFinding);
    if (!options.noRender) {
      const rendered = await stage(state, log, 'render', () => {
        log('make: render started');
        return renderFilm({ out, exact: options.exact, session, signal, onProgress: progressLogger(log) });
      });
      Object.assign(state, { output: rendered.out, capture: rendered.capture, captured: rendered.captured, seconds: rendered.seconds, msPerFrame: rendered.msPerFrame, bytes: rendered.bytes, mbps: rendered.mbps });
    }
  } finally {
    state.findings = [...state.findings, ...sessionFindings(session)];
    await session.close();
  }
}

async function execute(options, state, io) {
  const loaded = await validate(options, state, io.log);
  if (!loaded) return;
  state.validated = true;
  const { film, specDir } = loaded;
  const timeline = await stage(state, io.log, 'timeline', () => buildTimeline(film, { fps: film.fps }));
  Object.assign(state, { timed: timeline.timed, frames: timeline.frameCount });
  if (options.outline) {
    state.outline = outlineOf(film, timeline);
    return;
  }
  if (!options.noRender) await findFfmpeg(); // fail before the browser starts, naming how to fix it
  io.signal?.throwIfAborted();
  await reviewAndRender({ options, loaded: { film, timeline, specDir }, state, io });
}

/**
 * What an error that stopped the run means: { exitCode, error } or { exitCode, finding }. A stop is an interrupt; the
 * page failing is the film's fault (a finding); anything else is the machine's.
 */
export function failureOutcome(err, signal) {
  if (signal?.aborted) return { exitCode: EXIT_INTERRUPTED, error: { message: 'interrupted', hint: '' } };
  const pageMessage = pageErrorMessage(err);
  if (pageMessage !== null) return { exitCode: EXIT_NOT_OK, finding: pageFinding('mechanical', `page: ${pageMessage}`) };
  return { exitCode: EXIT_MACHINE, error: describeError(machineMessage(err)) };
}

/**
 * The findings a report carries: each once (kind, message, path), and after trouble with the machine (exit 2) none of
 * the page's own errors (`page: ...`): a crashed or closed page, a lost context, logs those too, and they are not the
 * film's to fix.
 */
export function reportFindings(findings, exitCode) {
  const kept = exitCode === EXIT_MACHINE ? findings.filter((f) => !f.message.startsWith(PAGE_PREFIX)) : findings;
  return kept.filter((f, i, all) => all.findIndex((g) => g.kind === f.kind && g.message === f.message && g.path === f.path) === i);
}

// Records what failureOutcome says in the run's state and returns the exit code.
function settle(state, err, signal) {
  const { exitCode, error, finding } = failureOutcome(err, signal);
  if (error) state.error = error;
  if (finding) state.findings = [...state.findings, finding];
  return exitCode;
}

/**
 * @param {{ specPath: string, out: string | null, exact: boolean, noRender: boolean, outline: boolean }} options
 * @param {{ signal?: AbortSignal, log?: (line: string) => void }} [io] log gets progress lines (the caller sends them to stderr)
 * @returns {Promise<{ report: object, exitCode: number, sheetsDir: string | null, outline: object[] | null }>}
 */
export async function runMake(options, { signal, log = () => {} } = {}) {
  const state = newState();
  let exitCode = null;
  try {
    await execute(options, state, { signal, log });
  } catch (err) {
    exitCode = settle(state, err, signal);
  }
  state.findings = reportFindings(state.findings, exitCode);
  const report = reportOf(state);
  return { report, exitCode: exitCode ?? (report.ok ? EXIT_OK : EXIT_NOT_OK), sheetsDir: state.sheetsDir, outline: state.outline };
}
