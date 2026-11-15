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
import { buildTimeline } from '../../engine/script/timing.mjs';
import { loadFilm } from './pipeline.mjs';
import { SpecError, anchorSpanErrors } from './spec.mjs';
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
const SHOT_NAMED_RE = /^shot "([^"]+)":/; // how a voice error names its shot in its message (voice/worker.mjs)
// describeError splits this at ". " into its message and its hint.
const OWN_VOICE_MESSAGE = 'voice from your own recording ({ src, words }) is not built yet. '
  + 'Write "voice": { "name": "af_heart" } to synthesise the narration, or remove "voice" for a film without narration';

// The real synthesiser, loaded only for a voiced film: a silent film imports nothing of the voice.
const synthesiseFilm = async (film, options) => (await import('./voice/synth.mjs')).synthesiseFilm(film, options);

const seconds = (started) => Math.round(((performance.now() - started) / MS_PER_SECOND) * MILLIS_DECIMALS) / MILLIS_DECIMALS;

const newState = () => ({
  validated: false, error: null, stages: [], findings: [], sheets: [], output: null, timed: null, voice: null, post: null, capture: null,
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

// A voice error that is the film's to fix: `kind: 'film'` and not a timeout. Anything else (`kind: 'machine'`, no kind,
// a timeout) is machine trouble.
const isFilmVoiceError = (err) => err?.kind === 'film' && err.timedOut !== true;

// The voice error of a film as a finding: at the say of the shot it names (its `shot` field, else a message that starts
// `shot "<id>":`), else at `voice`; its hint, when it has one, after the message.
function voiceFinding(film, err) {
  const id = typeof err.shot === 'string' ? err.shot : SHOT_NAMED_RE.exec(String(err.message))?.[1];
  const index = film.shots.findIndex((shot) => shot.id === id);
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
    made = await stage(state, io.log, 'voice', () => {
      if (film.voice.name === undefined) throw new Error(OWN_VOICE_MESSAGE);
      const { out } = outputPaths(options);
      return io.synthesise(film, { outDir: path.dirname(out), voice: film.voice.name, log: io.log });
    });
  } catch (err) {
    if (!isFilmVoiceError(err)) throw err;
    state.findings = [voiceFinding(film, err)];
    return null;
  }
  const seconds = made.sidecar.shots.reduce((sum, shot) => sum + shot.seconds, 0);
  state.voice = { cached: made.cached, seconds: Math.round(seconds * VOICE_SECONDS_STEPS) / VOICE_SECONDS_STEPS, model: made.sidecar.model };
  return made;
}

// The timeline the film is drawn with: measured from the sidecar when there is one, and then its anchors are checked
// against it (validateFilm could not: it had only estimated times). Anchor errors make the film invalid: they become
// findings in the validator's path form and null is returned.
async function timelineFor(film, made, state, log) {
  try {
    return await stage(state, log, 'timeline', () => {
      const timeline = buildTimeline(film, { fps: film.fps, words: made?.sidecar.shots });
      const errors = made ? anchorSpanErrors(film, timeline) : [];
      if (errors.length > 0) throw new SpecError(errors);
      return timeline;
    });
  } catch (err) {
    if (!(err instanceof SpecError)) throw err;
    state.findings = err.errors.map(validationFinding);
    return null;
  }
}

async function execute(options, state, io) {
  const loaded = await validate(options, state, io.log);
  if (!loaded) return;
  state.validated = true;
  const { film, specDir } = loaded;
  const made = film.voice === undefined ? null : await makeVoice(film, options, state, io);
  if (film.voice !== undefined && made === null) return;
  const timeline = await timelineFor(film, made, state, io.log);
  if (!timeline) return;
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
  return { exitCode: EXIT_MACHINE, error: machineError(err) };
}

// { message, hint } of machine trouble: an error's own one-line `hint` when it carries one (a voice error does), else
// describeError's reading of its first line.
function machineError(err) {
  if (typeof err?.hint === 'string' && err.hint !== '') return { message: machineMessage(err), hint: err.hint };
  return describeError(machineMessage(err));
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
