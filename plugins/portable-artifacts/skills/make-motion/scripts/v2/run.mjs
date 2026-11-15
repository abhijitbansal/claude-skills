// The stages behind scripts/make.mjs, in order: validate, timeline, review (the sheets and the audit), render. One
// browser session serves review and render. runMake returns the report and the exit code; it throws for trouble with
// the machine (no browser, no ffmpeg, an unreadable file) and always closes what it opened, also when stopped through
// `signal`. It never prints to stdout and never waits for input.
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { findFfmpeg } from '../lib/ffmpeg.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { loadFilm } from './pipeline.mjs';
import { SpecError } from './spec.mjs';
import { openSession } from './session.mjs';
import { writeSheets } from './sheets.mjs';
import { renderFilm } from './render.mjs';
import { invalidReport, outlineOf, reviewFinding, validationFinding } from './report.mjs';

const MS_PER_SECOND = 1000;
const MILLIS_DECIMALS = 1000;
const PROGRESS_STEPS = 10;
const EXIT_OK = 0;
const EXIT_NOT_OK = 1;

const seconds = (started) => Math.round(((performance.now() - started) / MS_PER_SECOND) * MILLIS_DECIMALS) / MILLIS_DECIMALS;

// The stage log of a run: `list` holds { name, ok, seconds } for each stage that ran, and each is also said to `log`.
function stageRecorder(log) {
  const list = [];
  const record = (name, ok, started) => {
    const entry = { name, ok, seconds: seconds(started) };
    list.push(entry);
    log(`make: ${name} ${ok ? 'ok' : 'failed'} (${entry.seconds} s)`);
  };
  // Runs fn and records its stage whether it returns or throws.
  const run = async (name, fn) => {
    const started = performance.now();
    try {
      const value = await fn();
      record(name, true, started);
      return value;
    } catch (err) {
      record(name, false, started);
      throw err;
    }
  };
  return { list, record, run };
}

// { loaded } for a film that validates, { findings } for one that does not. Anything else (a missing or unreadable
// file) is the machine's trouble and propagates.
function validate(specPath, recorder) {
  const started = performance.now();
  try {
    const loaded = loadFilm(specPath);
    recorder.record('validate', true, started);
    return { loaded };
  } catch (err) {
    recorder.record('validate', false, started);
    if (err instanceof SpecError) return { findings: err.errors.map(validationFinding) };
    throw err;
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

/**
 * @param {{ specPath: string, out: string | null, exact: boolean, noRender: boolean, outline: boolean }} options
 * @param {{ signal?: AbortSignal, log?: (line: string) => void }} [io] log gets progress lines (the caller sends them to stderr)
 * @returns {Promise<{ report: object, exitCode: number, sheetsDir: string | null, outline?: object[] }>}
 */
export async function runMake(options, { signal, log = () => {} } = {}) {
  const recorder = stageRecorder(log);
  const stages = recorder.list;
  const checked = validate(options.specPath, recorder);
  if (!checked.loaded) return { report: invalidReport({ stages, findings: checked.findings }), exitCode: EXIT_NOT_OK, sheetsDir: null };
  const { film, specDir } = checked.loaded;
  const timeline = await recorder.run('timeline', () => buildTimeline(film, { fps: film.fps }));
  if (options.outline) {
    const report = { ok: true, stages, outline: outlineOf(film, timeline) };
    return { report, exitCode: EXIT_OK, sheetsDir: null, outline: report.outline };
  }
  if (!options.noRender) await findFfmpeg(); // fail before the browser starts, naming how to fix it
  signal?.throwIfAborted();
  return reviewAndRender({ options, loaded: { film, timeline, specDir }, io: { recorder, signal, log } });
}

// Where the video goes: --out, else out/<film name>.mp4 next to the film file. The sheets go in a folder beside it.
function outputPaths(options, specDir) {
  const name = path.basename(options.specPath, path.extname(options.specPath));
  const out = options.out ? path.resolve(options.out) : path.join(specDir, 'out', `${name}.mp4`);
  return { out, sheetsDir: path.join(path.dirname(out), 'sheets') };
}

// The stages that need the page: the sheets and the audit, then (unless --no-render) the video.
async function reviewAndRender({ options, loaded, io: { recorder, signal, log } }) {
  const { out, sheetsDir } = outputPaths(options, loaded.specDir);
  const session = await openSession(loaded);
  try {
    const review = await recorder.run('review', () => writeSheets({ session, dir: sheetsDir, signal }));
    const rendered = options.noRender ? null : await recorder.run('render', () => {
      log('make: render started');
      return renderFilm({ out, exact: options.exact, session, signal, onProgress: progressLogger(log) });
    });
    const report = buildReport({ loaded, session, review, rendered, stages: recorder.list });
    return { report, exitCode: report.ok ? EXIT_OK : EXIT_NOT_OK, sheetsDir };
  } finally {
    await session.close();
  }
}

// ok is false when any mechanical finding exists; creative ones are advice.
function buildReport({ loaded, session, review, rendered, stages }) {
  const findings = review.findings.map(reviewFinding);
  return {
    ok: findings.every((f) => f.kind !== 'mechanical'),
    output: rendered?.out ?? null,
    sheets: review.files,
    timed: loaded.timeline.timed,
    post: session.info.post,
    capture: rendered?.capture ?? null,
    stages,
    frames: loaded.timeline.frameCount,
    captured: rendered?.captured ?? 0,
    msPerFrame: rendered?.msPerFrame ?? null,
    findings,
  };
}
