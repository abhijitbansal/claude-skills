// The stages behind scripts/make.mjs, in order: validate, voice (only for a film with `voice`), timeline, review (the
// sheets and the audit), render. One browser session serves review and render. runMake always returns a report
// (report.mjs) and an exit code: 0 ok, 1 not ok (the film does not validate, its anchors fall outside their shots on
// its measured timeline, a mechanical finding exists, or the page raised an error about it), 2 for trouble with the
// machine (a missing film file, a voice that cannot be made, no browser, no ffmpeg, ffmpeg failing, a crashed or closed
// browser page, a timeout, a lost WebGL context, a picture the browser cannot decode: `report.error` says which and how
// to fix it),
// 130 when stopped through `signal`. What was done before a stop stays in the report. It always closes what it opened,
// never prints to stdout and never waits for input.
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { findFfmpeg } from '../lib/ffmpeg.mjs';
import { PlacementError, buildTimeline } from '../../engine/script/timing.mjs';
import { loadFilm } from './pipeline.mjs';
import { SpecError, readRecording, timedAnchorErrors } from './spec.mjs';
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
const VOICE_SECONDS_STEPS = 1e4; // the report's voice.seconds, rounded as the sidecar's times are
const SIDECAR_MISMATCH_HINT = 'run again; if it keeps happening, delete the .voice folder beside the video so the voice is made afresh';
const roundSeconds = (seconds) => Math.round(seconds * VOICE_SECONDS_STEPS) / VOICE_SECONDS_STEPS;

// The real synthesiser, loaded only for a voiced film: a silent film never loads the synthesiser or its child process.
const synthesiseFilm = async (film, options) => (await import('./voice/synth.mjs')).synthesiseFilm(film, options);

// `made.sidecar` checked against the film (shot ids, word counts and texts, times inside each WAV), whoever made it: the
// injected synthesiser is a seam, and a sidecar that does not match would silently misplace every word.
async function checkedSidecar(made, film) {
  const { validateSidecar } = await import('./voice/sidecar.mjs');
  try {
    validateSidecar(made.sidecar, film);
  } catch (err) {
    throw Object.assign(new Error(`the voice does not match the film: ${err.message}`, { cause: err }), { hint: SIDECAR_MISMATCH_HINT });
  }
  return made;
}

const seconds = (started) => Math.round(((performance.now() - started) / MS_PER_SECOND) * MILLIS_DECIMALS) / MILLIS_DECIMALS;

const newState = () => ({
  validated: false, error: null, stages: [], findings: [], sheets: [], output: null, timed: null, voice: null, audio: null, post: null, capture: null,
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
async function reviewAndRender({ options, loaded, made, state, io: { signal, log } }) {
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
        return renderFilm({ out, exact: options.exact, session, signal, onProgress: progressLogger(log), voice: made ?? undefined });
      });
      Object.assign(state, { output: rendered.out, capture: rendered.capture, captured: rendered.captured, seconds: rendered.seconds, msPerFrame: rendered.msPerFrame, bytes: rendered.bytes, mbps: rendered.mbps, audio: rendered.audio });
    }
  } finally {
    state.findings = [...state.findings, ...sessionFindings(session)];
    await session.close();
  }
}

// A voice error that is the film's to fix: `kind: 'film'` and not a timeout. Anything else (`kind: 'machine'`, no kind,
// a timeout) is machine trouble; an interruption (an AbortError, no kind) ends the run as 130 through failureOutcome.
const isFilmVoiceError = (err) => err?.kind === 'film' && err.timedOut !== true;

// The voice error of a film as a finding: at the say of the shot it names (its `shot`, the shot's id, which
// synth.mjs's VoiceSynthError carries for a film error of one shot), else at `voice`; its hint, when it has one, after
// the message.
function voiceFinding(film, err) {
  const index = typeof err.shot === 'string' ? film.shots.findIndex((shot) => shot.id === err.shot) : -1;
  const at = index === -1 ? 'voice' : `shots[${index}].say`;
  const message = machineMessage(err);
  return validationFinding({ path: at, message: typeof err.hint === 'string' && err.hint !== '' ? `${message}; ${err.hint}` : message });
}

// The film's narration through `synthesise` (synthesiseFilm's signature), cached beside the video in <out dir>/.voice/,
// or null when the voice error is the film's own (it becomes a finding: exit 1). Machine trouble (the optional package
// missing, the model refused, a timeout) propagates: exit 2 with its hint.
async function makeVoice(film, options, state, io) {
  let made;
  try {
    made = await stage(state, io.log, 'voice', async () => {
      const { out } = outputPaths(options);
      const signal = io.signal === undefined ? {} : { signal: io.signal };
      return checkedSidecar(await io.synthesise(film, { outDir: path.dirname(out), voice: film.voice.name, log: io.log, ...signal }), film);
    });
  } catch (err) {
    // A stop that raced the voice's own error is a stop (exit 130), whatever the error says.
    if (!isFilmVoiceError(err) || io.signal?.aborted) throw err;
    state.findings = [voiceFinding(film, err)];
    return null;
  }
  const seconds = made.sidecar.shots.reduce((sum, shot) => sum + shot.seconds, 0);
  state.voice = { cached: made.cached, seconds: roundSeconds(seconds), model: made.sidecar.model };
  return made;
}

// An author's own recording (`voice: { src, words }`): nothing is synthesised. Its two files are read again, inside the
// film's folder, and its words fitted to the film (spec.mjs readRecording); a problem is the film's (findings, exit 1)
// and null is returned. -> { recording, sidecar, cached: false }, `recording` the file's real path (the only path that
// reaches ffmpeg) and `sidecar` its words in seconds from its start. voice.seconds is the narration's length in the
// file: its last word end.
async function recordVoice(film, specDir, state, log) {
  let read;
  try {
    read = await stage(state, log, 'voice', () => readRecording(film, specDir));
  } catch (err) {
    if (!(err instanceof SpecError)) throw err;
    state.findings = err.errors.map(validationFinding);
    return null;
  }
  state.voice = { cached: false, seconds: roundSeconds(Math.max(0, ...read.sidecar.shots.map((s) => s.seconds))), model: null };
  return { recording: read.src, sidecar: read.sidecar, cached: false };
}

// The timeline the film is drawn with: measured from the sidecar when there is one, and then everything about its
// anchors that depends on time is judged on it (validateFilm could not: it had only estimated times). Those errors make
// the film invalid: they become findings in the validator's path form and null is returned; the report still says what
// timeline was built.
async function timelineFor(film, made, state, log) {
  try {
    return await stage(state, log, 'timeline', () => {
      const timeline = buildTimeline(film, { fps: film.fps, words: made?.sidecar.shots, recording: made?.recording !== undefined });
      Object.assign(state, { timed: timeline.timed, frames: timeline.frameCount });
      const errors = made ? timedAnchorErrors(film, timeline) : [];
      if (errors.length > 0) throw new SpecError(errors);
      return timeline;
    });
  } catch (err) {
    if (!(err instanceof SpecError) && !(err instanceof PlacementError)) throw err;
    state.findings = err.errors.map(validationFinding);
    return null;
  }
}

async function execute(options, state, io) {
  const loaded = await validate(options, state, io.log);
  if (!loaded) return;
  state.validated = true;
  const { film, specDir } = loaded;
  const made = film.voice === undefined ? null
    : film.voice.name === undefined ? await recordVoice(film, specDir, state, io.log) : await makeVoice(film, options, state, io);
  if (film.voice !== undefined && made === null) return;
  io.signal?.throwIfAborted(); // the voice can take minutes, and a cache hit returns whatever the signal
  const timeline = await timelineFor(film, made, state, io.log);
  if (!timeline) return;
  if (options.outline) {
    state.outline = outlineOf(film, timeline);
    return;
  }
  if (!options.noRender) await findFfmpeg(); // fail before the browser starts, naming how to fix it
  io.signal?.throwIfAborted();
  await reviewAndRender({ options, loaded: { film, timeline, specDir }, made, state, io });
}

/**
 * What an error that stopped the run means: { exitCode, error } or { exitCode, finding }. A stop is an interrupt; the
 * page failing is the film's fault (a finding); anything else is the machine's.
 */
export function failureOutcome(err, signal) {
  if (signal?.aborted) return { exitCode: EXIT_INTERRUPTED, error: { message: 'interrupted', hint: '' } };
  const pageMessage = pageErrorMessage(err);
  if (pageMessage !== null) return { exitCode: EXIT_NOT_OK, finding: pageFinding('mechanical', `page: ${pageMessage}`) };
  return { exitCode: EXIT_MACHINE, error: machineError(err) };
}

// { message, hint } of machine trouble: an error's own one-line `hint` when it carries one (a voice error does), else
// describeError's reading of its first line. A message that is exactly its hint (a missing voice install's: "what. Run:
// how") is split by describeError rather than said twice; a message that merely mentions its hint keeps both.
function machineError(err) {
  const message = machineMessage(err);
  const hint = typeof err?.hint === 'string' ? err.hint : '';
  if (hint !== '' && message !== hint) return { message, hint };
  return describeError(message);
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
 * @param {{ signal?: AbortSignal, log?: (line: string) => void, synthesise?: Function }} [io] log gets progress lines
 *   (the caller sends them to stderr); synthesise makes a voiced film's narration (default: voice/synth.mjs
 *   synthesiseFilm, which tests replace with a fake that returns a sidecar)
 * @returns {Promise<{ report: object, exitCode: number, sheetsDir: string | null, outline: object[] | null }>}
 */
export async function runMake(options, { signal, log = () => {}, synthesise = synthesiseFilm } = {}) {
  const state = newState();
  let exitCode = null;
  try {
    await execute(options, state, { signal, log, synthesise });
  } catch (err) {
    exitCode = settle(state, err, signal);
  }
  state.findings = reportFindings(state.findings, exitCode);
  const report = reportOf(state);
  return { report, exitCode: exitCode ?? (report.ok ? EXIT_OK : EXIT_NOT_OK), sheetsDir: state.sheetsDir, outline: state.outline };
}
