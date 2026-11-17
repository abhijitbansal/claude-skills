// The stages behind scripts/make.mjs, in order: validate, voice (only for a film with `voice`), timeline, sound (only
// for a film with sound: cues planned from its events, a bed fitted to its cuts, a music file checked), review (the
// sheets and the audit), render. One browser session serves review and render. runMake always returns a report
// (report.mjs) and an exit code: 0 ok, 1 not ok (the film does not validate, its anchors fall outside their shots on
// its measured timeline, a mechanical finding exists, or the page raised an error about it), 2 for trouble with the
// machine (a missing film file, a voice that cannot be made, no browser, no ffmpeg, ffmpeg failing, a crashed or closed
// browser page, a timeout, a lost WebGL context, a picture the browser cannot decode: `report.error` says which and how
// to fix it),
// 130 when stopped through `signal`. What was done before a stop stays in the report. It always closes what it opened,
// never prints to stdout and never waits for input.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { findFfmpeg, findFfprobe } from '../lib/ffmpeg.mjs';
import { registries } from '../../engine/registry.mjs';
import { PlacementError, buildTimeline } from '../../engine/script/timing.mjs';
import { loadFilm } from './pipeline.mjs';
import { SpecError, readRecording, timedAnchorErrors } from './spec.mjs';
import { openSession, pageErrorMessage, machineMessage } from './session.mjs';
import { writeSheets } from './sheets.mjs';
import { renderFilm } from './render.mjs';
import { sessionFindings } from './review.mjs';
import { stampTags, tagArgs } from './stamp.mjs';
import { readBeatsFile } from './sound/beats-file.mjs';
import { snapFilm } from './sound/snap.mjs';
import { posterFrame, posterPath, writePoster } from './poster.mjs';
import { writeSubtitles } from './subtitles.mjs';
import { NOT_RENDERED_NOTE, describeError, experimentalLook, experimentalKinds, experimentalKindLine, outlineOf, pageFinding, reportOf, reviewFinding, validationFinding } from './report.mjs';

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
  frames: 0, captured: 0, seconds: null, msPerFrame: null, bytes: null, mbps: null, outline: null, sheetsDir: null, provenance: null,
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
    return await stage(state, log, 'validate', () => loadFilm(options.specPath, { values: options.values ?? {} }));
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
async function reviewAndRender({ options, loaded, made, sound, state, io: { signal, log, browser } }) {
  const { out, sheetsDir } = outputPaths(options);
  state.sheetsDir = sheetsDir;
  const session = await openSession(loaded, { browser });
  try {
    state.post = session.info.post;
    state.cuts = session.info.cuts ?? null; // the shader cuts the page ran or replaced (engine/page/post.mjs)
    const review = await stage(state, log, 'review', () => writeSheets({ session, dir: sheetsDir, signal }));
    state.sheets = review.files;
    state.findings = review.findings.map(reviewFinding);
    if (!options.noRender) {
      const tags = stampTags({ generatedBy: loaded.film.generatedBy, flags: options.provenance ?? {}, provenance: loaded.film.provenance });
      const rendered = await stage(state, log, 'render', () => {
        log('make: render started');
        return renderFilm({ out, exact: options.exact, session, signal, onProgress: progressLogger(log), voice: made ?? undefined, sound: sound ?? undefined, stamp: tagArgs(tags),
          workers: options.workers ?? 1, openPage: () => openSession(loaded, { browser: session.page.context().browser() }) });
      });
      Object.assign(state, { output: rendered.out, capture: rendered.capture, captured: rendered.captured, seconds: rendered.seconds, msPerFrame: rendered.msPerFrame, bytes: rendered.bytes, mbps: rendered.mbps, audio: rendered.audio, provenance: tags, workers: rendered.workers > 1 ? rendered.workers : null });
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

const FFPROBE_HINT = 'install ffmpeg with its ffprobe (they come together), or set FFPROBE_PATH to an ffprobe you trust';
const lastWordEnd = (sidecar) => Math.max(0, ...sidecar.shots.map((s) => s.seconds));

// The recording as read (spec.mjs readRecording), once ffprobe says it is plain audio of an accepted format, long enough
// for its words (voice/master.mjs probeRecording, recordingProblem); otherwise a SpecError at voice.src. No ffprobe, or
// one that fails to run, is machine trouble.
async function probedRecording(film, read, signal) {
  const ffprobe = findFfprobe({ ffmpeg: await findFfmpeg() });
  if (ffprobe === null) throw Object.assign(new Error('ffprobe not found: it is needed to check a recording of your own'), { hint: FFPROBE_HINT });
  const { probeRecording, recordingProblem } = await import('./voice/master.mjs');
  const problem = recordingProblem(await probeRecording({ ffprobe, file: read.src, signal }), lastWordEnd(read.sidecar));
  if (problem !== null) throw new SpecError([{ path: 'voice.src', message: `${JSON.stringify(film.voice.src)} ${problem}` }]);
  return read;
}

// An author's own recording (`voice: { src, words }`): nothing is synthesised. Its two files are read again, inside the
// film's folder, its words fitted to the film (spec.mjs readRecording), and the audio probed before anything decodes it;
// a problem is the film's (findings, exit 1) and null is returned. -> { recording, sidecar, cached: false },
// `recording` the file's real path (the only path that reaches ffmpeg) and `sidecar` its words in seconds from its
// start. voice.seconds is the narration's length in the file: its last word end.
async function recordVoice(film, specDir, state, io) {
  let read;
  try {
    read = await stage(state, io.log, 'voice', () => probedRecording(film, readRecording(film, specDir), io.signal));
  } catch (err) {
    if (!(err instanceof SpecError) || io.signal?.aborted) throw err;
    state.findings = err.errors.map(validationFinding);
    return null;
  }
  state.voice = { cached: false, seconds: roundSeconds(lastWordEnd(read.sidecar)), model: null };
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

// ---- the sound stage ----------------------------------------------------------------------------------------------------

// The sound stage's modules, loaded only for a film with sound. (The validator loads sound/synth.mjs for every film, for
// its list of cue names: spec-sound.mjs KNOWN_CUES.)
async function soundSteps() {
  const [cues, bed, synth, duck, beatsFile, snap] = await Promise.all([
    import('./sound/cues.mjs'), import('./sound/bed.mjs'), import('./sound/synth.mjs'), import('./sound/duck.mjs'),
    import('./sound/beats-file.mjs'), import('./sound/snap.mjs'),
  ]);
  return {
    planCues: cues.planCues, ...bed, renderCues: synth.renderCues, duckEnvelope: duck.duckEnvelope, heardWordSpans: duck.heardWordSpans,
    readBeatsFile: beatsFile.readBeatsFile, snapFilm: snap.snapFilm,
  };
}

// Whether `film` (defaults filled) has sound to make: not "sound": "off", and music, its own cue list, "sound": "on",
// or a mode whose cues play by default.
const wantsSound = (film) => film.sound !== 'off'
  && (film.music !== undefined || Array.isArray(film.cues) || film.sound === 'on' || registries.modes.get(film.mode).cues === true || film.audio?.length > 0);

// A film error thrown by the cue plan (sound/cues.mjs): its message starts with the path of the cue at fault.
const CUE_PATH_RE = /^(cues\[\d+\](?:\.[a-z]+)?): ([\s\S]+)$/;

// The findings of an error the film is to blame for (a cue list it got wrong, a music file it named badly), or null
// for anything else, which is the machine's trouble.
function soundFindings(err) {
  if (err instanceof SpecError) return err.errors.map(validationFinding);
  const cue = typeof err?.message === 'string' ? CUE_PATH_RE.exec(err.message) : null;
  return cue === null ? null : [validationFinding({ path: cue[1], message: cue[2] })];
}

const cutTimes = (timeline) => timeline.shots.slice(1).map((s) => s.start);
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

// A user's music file: its tempo from its beats (null without a steady beat) and how many cuts fall within a frame of one.
function fileSummary(input, timeline, end, landEpsilon) {
  const beats = input.beats;
  const cuts = cutTimes(timeline);
  const landed = beats === null ? null : cuts.filter((c) => beats.some((b) => Math.abs(b - c) <= 1 / timeline.fps + landEpsilon)).length;
  const bpm = beats === null ? null : Math.round((60 / median(beats.slice(1).map((b, k) => b - beats[k]))) * 100) / 100;
  return { kind: 'file', bed: null, bpm, landed, cuts: cuts.length, short: end.short };
}

// The beats `music.snap` moves the cuts onto, or a SpecError at music.snap when the music has no steady beat.
function snapBeats(film, input) {
  if (film.music.snap !== true || input.beats !== null) return input.beats;
  throw new SpecError([{ path: 'music.snap', message: `no steady beat was found in ${JSON.stringify(film.music.src)}, so there is nothing to move the cuts onto; run scripts/beats.mjs on it (with --bpm for a tempo you know) and name its file in music.beats, or remove snap` }]);
}

// The film's anchors judged again on the snapped timeline (validateFilm judged them on the unsnapped one): a moved cut
// can shorten a shot past an anchor in it. A SpecError at each anchor's path, saying the snap did it.
function snappedAnchorCheck(film, snapped) {
  if (!Array.isArray(snapped.moved) || snapped.moved.length === 0) return;
  const errors = timedAnchorErrors(film, snapped.timeline);
  if (errors.length > 0) throw new SpecError(errors.map((e) => ({ ...e, message: `${e.message} (after music.snap moved the cuts onto the beats)` })));
}

// A user's music file checked and probed (musicInput), its beats read from music.beats when the film names a beats file
// (sound/beats-file.mjs: then nothing is detected), and the cuts moved onto them with music.snap (sound/snap.mjs).
// -> { input, end, summary, timeline }: `timeline` the one the film is drawn with, the given one without snap.
async function fileMusicPlan(steps, film, timeline, specDir, signal) {
  const beats = film.music.beats === undefined ? undefined : steps.readBeatsFile(film.music.beats, specDir).beats;
  const input = await steps.musicInput(film, specDir, { signal, seconds: timeline.duration, beats }); // silent for the film's length: refused
  const snapped = steps.snapFilm(film, timeline, snapBeats(film, input));
  snappedAnchorCheck(film, snapped);
  const end = steps.musicEnd(input.seconds, snapped.timeline.duration);
  const moved = snapped.moved === null ? {} : { moved: snapped.moved }; // only with snap: a film without it reports what it did
  return { input, end, timeline: snapped.timeline, summary: { ...fileSummary(input, snapped.timeline, end, steps.LAND_EPSILON), ...moved } };
}

// The film's music as data: a bed fitted to the cuts, or a user's file (fileMusicPlan). Null for none.
async function musicPlan(steps, film, timeline, specDir, signal) {
  const music = film.music;
  if (music === undefined) return null;
  if (music.bed !== undefined) {
    const grid = steps.fitBeatGrid(cutTimes(timeline), { bpm: music.bpm, seconds: timeline.duration, fps: timeline.fps });
    return { bed: music.bed, grid, timeline, summary: { kind: 'bed', bed: music.bed, bpm: grid.bpm, landed: grid.landed, cuts: grid.cuts, short: false } };
  }
  return fileMusicPlan(steps, film, timeline, specDir, signal);
}


// The cue track and the music written into `work` for the render: { cues, music } as renderFilm takes them, or null when
// there is nothing to put in the film.
async function soundFiles(steps, { film, timeline, cues, music, tracks = [], work }) {
  const seconds = timeline.duration;
  // The count is of the cues the track holds: the plan holds every cue inside the film, so none is dropped today, but
  // the report would say so if one were.
  const rendered = cues.length === 0 ? null : await steps.renderCues(cues, { seconds, seed: film.seed, out: path.join(work, 'cues.wav') });
  const cueTrack = rendered === null ? null : { file: rendered.file, count: cues.length - rendered.dropped };
  let musicTrack = null;
  if (music !== null) {
    // The bed ducks under the words as they are heard (sound/duck.mjs heardWordSpans), for a film with a voice only.
    const duck = steps.duckEnvelope(film.voice === undefined ? [] : steps.heardWordSpans(timeline), { seconds });
    musicTrack = music.input === undefined
      ? { file: await steps.renderBed({ bed: music.bed, grid: music.grid, seconds, seed: film.seed, out: path.join(work, 'bed.wav') }), recording: false, fadeFrom: null, duck, summary: music.summary }
      : { file: music.input.file, recording: true, fadeFrom: music.end.fadeFrom, duck, summary: music.summary };
  }
  // The extra audio files duck under the words as the music does.
  const duck = tracks.length === 0 ? [] : steps.duckEnvelope(film.voice === undefined ? [] : steps.heardWordSpans(timeline), { seconds });
  const extra = tracks.map((track) => ({ ...track, duck }));
  return cueTrack === null && musicTrack === null && extra.length === 0 ? null : { cues: cueTrack, music: musicTrack, tracks: extra };
}

// A problem musicInput found with an extra audio file, at that file's path (musicInput names music.src).
const atTrack = (err, i) => new SpecError(err.errors.map((e) => ({ ...e, path: e.path === 'music.src' ? `audio[${i}].src` : e.path })));

// The film's extra audio files, each checked, probed and measured as a music file is (sound/bed.mjs musicInput, nothing
// decoded for beats), and placed at `at`: [{ file, recording: true, fadeFrom: null, at }]. One starting after the film
// ends is the film's mistake, at audio[i].at.
async function audioTracks(steps, film, timeline, specDir, signal) {
  const tracks = [];
  for (const [i, item] of (film.audio ?? []).entries()) {
    const at = item.at ?? 0;
    if (at >= timeline.duration) throw new SpecError([{ path: `audio[${i}].at`, message: `starts at ${at} s, after the film ends (${timeline.duration.toFixed(2)} s)` }]);
    let input;
    try {
      input = await steps.musicInput({ music: { src: item.src } }, specDir, { signal, seconds: timeline.duration - at, beats: [] });
    } catch (err) {
      throw err instanceof SpecError ? atTrack(err, i) : err;
    }
    tracks.push({ file: input.file, recording: true, fadeFrom: null, at });
  }
  return tracks;
}

/**
 * The sound stage, for a film with sound (wantsSound): the cue plan (sound/cues.mjs), the bed fitted to the cuts or the
 * music file checked (sound/bed.mjs), recorded in the report's audio (planned, not yet measured); with `work` (a render
 * follows) the cue and bed WAVs are written there. -> { sound } (renderFilm's plan, or null), or null when the film is
 * at fault (its errors become findings: exit 1). Machine trouble (ffprobe or ffmpeg failing) and a stop propagate.
 * The result's `timeline` is the one to draw: the given one, or its cuts moved onto the music's beats (music.snap); the
 * cues are planned on it.
 */
async function makeSound(loaded, timeline, state, io, work) {
  const { film, specDir } = loaded;
  try {
    return await stage(state, io.log, 'sound', async () => {
      io.signal?.throwIfAborted();
      const steps = await soundSteps();
      const music = await musicPlan(steps, film, timeline, specDir, io.signal);
      const drawn = music?.timeline ?? timeline;
      const cues = steps.planCues(film, drawn);
      io.signal?.throwIfAborted();
      // Nothing planned is nothing to put in the film: no audio, as the render reports it (review Minor 10).
      const tracks = await audioTracks(steps, film, drawn, specDir, io.signal);
      const extra = tracks.length > 0 ? { tracks: tracks.length } : {}; // the extra audio files, only when the film has some
      if (cues.length > 0 || music !== null || tracks.length > 0) state.audio = { lufs: null, truePeakDb: null, note: NOT_RENDERED_NOTE, cues: cues.length, music: music?.summary ?? null, ...extra };
      return { timeline: drawn, sound: work === null ? null : await soundFiles(steps, { film, timeline: drawn, cues, music, tracks, work }) };
    });
  } catch (err) {
    const findings = io.signal?.aborted ? null : soundFindings(err);
    if (findings === null) throw err;
    state.findings = findings;
    return null;
  }
}

// ---- the poster ----------------------------------------------------------------------------------------------------------

// --poster: one still of the film's frame (poster.mjs) on its timeline (measured for a voiced film), no review, no
// sound, no ffmpeg. A time past the end is the machine-trouble exit (2) with the film's length.
async function makePoster(options, loaded, state, io) {
  const frame = posterFrame(options.poster, loaded.timeline);
  const file = posterPath(options.posterOut ?? null, outputPaths(options).out);
  const session = await openSession(loaded, { browser: io.browser });
  try {
    state.poster = await stage(state, io.log, 'poster', () => writePoster({ session, frame, file }));
  } finally {
    state.findings = [...state.findings, ...sessionFindings(session)];
    await session.close();
  }
}

// ---- the outline ---------------------------------------------------------------------------------------------------------

const ESTIMATE_NOTE = 'times are estimated from the word count (design 6.1): --outline makes no voice; the render measures them';
const UNSNAPPED_NOTE = 'the cuts are shown before music.snap moves them: snapping needs the music\'s beats, so give music.beats (scripts/beats.mjs writes it)';

// The timeline an outline shows: with music.snap and a beats file (read with Node alone), the cuts after the snap.
function outlineTimeline({ film, specDir }, timeline) {
  if (film.music?.snap !== true || typeof film.music.beats !== 'string') return { timeline, snapped: false };
  return { timeline: snapFilm(film, timeline, readBeatsFile(film.music.beats, specDir).beats).timeline, snapped: true };
}

// What the outline says about its times, or null: estimated for a voiced film, unsnapped for a snap with no beats file.
function outlineNote(film, options, snapped) {
  const notes = [
    film.voice !== undefined && options.outline === true ? ESTIMATE_NOTE : null,
    film.music?.snap === true && !snapped ? UNSNAPPED_NOTE : null,
  ].filter(Boolean);
  return notes.length === 0 ? null : notes.join('; ');
}

async function execute(options, state, io) {
  const loaded = await validate(options, state, io.log);
  if (!loaded) return;
  state.validated = true;
  io.signal?.throwIfAborted(); // validation is synchronous (an own recording's word alignment included): a stop sent during it lands here
  if (options.phonemes) {
    // --phonemes: how the narration will be read, from the voice package's phonemizer; no voice, timeline or browser.
    state.reading = await stage(state, io.log, 'phonemes', async () => (await import('./voice/reading.mjs')).readingOf(loaded.film, { phonemize: await io.loadPhonemizer() }));
    return;
  }
  const { film, specDir } = loaded;
  // a parked look renders as any other; the run says so once, and the report carries it (never a finding)
  const parked = experimentalLook(film);
  if (parked) {
    state.look = parked;
    io.log(`make: look "${parked.name}" is experimental: it renders, but it is not one of the listed looks and may change`);
  }
  // so does a parked kind (or chart type) in the film's look: one line each, and the report's `kinds`
  state.kinds = experimentalKinds(film);
  for (const entry of state.kinds) io.log(experimentalKindLine(entry));
  // --outline makes no voice (it needs only Node): its times are the word-count estimate, and it says so.
  const voiced = film.voice !== undefined && options.outline !== true;
  const made = !voiced ? null
    : film.voice.name === undefined ? await recordVoice(film, specDir, state, io) : await makeVoice(film, options, state, io);
  if (voiced && made === null) return;
  io.signal?.throwIfAborted(); // the voice can take minutes, and a cache hit returns whatever the signal
  const timeline = await timelineFor(film, made, state, io.log);
  if (!timeline) return;
  if (options.outline || options.outlineMeasured) {
    const drawn = outlineTimeline(loaded, timeline);
    Object.assign(state, { outline: outlineOf(film, drawn.timeline), outlineNote: outlineNote(film, options, drawn.snapped) });
    return;
  }
  if (typeof options.poster === 'number') {
    await makePoster(options, { film, timeline, specDir, prepared: loaded.prepared }, state, io);
    return;
  }
  // The cue and bed WAVs live in a work folder of this run only, removed on every way out of it.
  const work = wantsSound(film) && !options.noRender ? mkdtempSync(path.join(tmpdir(), 'mm-sound-')) : null;
  try {
    const planned = wantsSound(film) ? await makeSound(loaded, timeline, state, io, work) : { sound: null };
    if (planned === null) return;
    // --subtitles: the caption file from the timeline the film is drawn with (after music.snap), before the browser starts
    if (options.subtitles) state.subtitles = writeSubtitles({ timeline: planned.timeline ?? timeline, format: options.subtitles, videoOut: outputPaths(options).out });
    if (!options.noRender) await findFfmpeg(); // fail before the browser starts, naming how to fix it
    io.signal?.throwIfAborted();
    await reviewAndRender({ options, loaded: { film, timeline: planned.timeline ?? timeline, specDir, prepared: loaded.prepared }, made, sound: planned.sound, state, io });
  } finally {
    if (work !== null) rmSync(work, { recursive: true, force: true });
  }
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
 * @param {{ specPath: string, out: string | null, exact: boolean, noRender: boolean, outline: boolean, provenance?: object }} options
 *   provenance: the stamp flags (cli.mjs parseMakeArgs: model, effort, agent, noProvenance); the film's own fields apply without them.
 *   outline: --outline, estimated times and no voice (`outlineNote` says so). outlineMeasured (not a flag: tests and
 *   callers that want the measured times without a browser): the voice is made and the outline follows it.
 * @param {{ signal?: AbortSignal, log?: (line: string) => void, synthesise?: Function }} [io] log gets progress lines
 *   (the caller sends them to stderr); synthesise makes a voiced film's narration (default: voice/synth.mjs
 *   synthesiseFilm, which tests replace with a fake that returns a sidecar)
 * @returns {Promise<{ report: object, exitCode: number, sheetsDir: string | null, outline: object[] | null }>}
 */
const defaultPhonemizer = async () => (await import('./voice/reading.mjs')).loadPhonemizer();

export async function runMake(options, { signal, log = () => {}, synthesise = synthesiseFilm, loadPhonemizer = defaultPhonemizer, browser } = {}) {
  const state = newState();
  let exitCode = null;
  try {
    await execute(options, state, { signal, log, synthesise, loadPhonemizer, browser });
  } catch (err) {
    exitCode = settle(state, err, signal);
  }
  state.findings = reportFindings(state.findings, exitCode);
  const report = reportOf(state);
  return { report, exitCode: exitCode ?? (report.ok ? EXIT_OK : EXIT_NOT_OK), sheetsDir: state.sheetsDir, outline: state.outline, outlineNote: state.outlineNote ?? null, reading: state.reading ?? null };
}
