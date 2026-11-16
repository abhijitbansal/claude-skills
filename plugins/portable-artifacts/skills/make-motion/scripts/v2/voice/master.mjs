// The narration put into the film: each narrated shot's WAV placed at its shot's narration start on the timeline (the
// timeline owns time: nothing else decides where a sound falls), emphasis and asides shaped in film time, the track
// mastered to the mode's loudness, and muxed into the finished MP4 without touching its video.
//
// The argument builders are pure and take numbers only: no film string (a word's text, a shot id) reaches an ffmpeg
// argument, and ffmpeg is always run with an argument array and no shell. Every number in an argument goes through a
// formatter that refuses a value that is not finite; times are formatted to 1e-4 s, decibels to 0.01.
//
// The track is built at 48 kHz (each shot's WAV resampled once), so a recording at a higher rate than Kokoro's 24 kHz
// keeps its top octave. The master chain: high-pass, compressor, de-esser, the limiter when one is needed, the shaping,
// stereo, then one static gain. The gain is computed from an ebur128 measurement of the chain (the meter the finished film
// is judged with): the target minus the measured loudness, capped so the true peak stays at the ceiling. No loudnorm:
// its second pass refuses linear mode on ordinary films (a short line in a longer film measures a loudness range of 0),
// and a static gain keeps the shaping's lift and cut exact on every path.
//
// Shaping: one `volume` filter per stage, its gain an expression of `t` evaluated once per audio frame, after
// `asetnsamples` cuts the audio into 1 ms frames. Each stage is a trapezoid in decibels: 0 dB until RAMP_SECONDS
// before the word, a straight ramp up to its level at the word's start, held to its end, and a ramp back down over the
// next RAMP_SECONDS. `enable='between(t,a,b)'` was not used: it switches the gain on in one step, with no ramp.
import { execFile, spawn } from 'node:child_process';
import { lstatSync } from 'node:fs';
import path from 'node:path';
import { narrationStart } from '../../../engine/script/timing.mjs';
import { parseLoudness } from '../../lib/ffmpeg.mjs';
import { ceilingFor } from '../../lib/loudness.mjs';
import { SAMPLE_RATE } from './words.mjs';

export const LEVELS = Object.freeze({ emphasisDb: 2, asideDb: -3 });
export const RAMP_SECONDS = 0.02;
export const VOICE_RATE = SAMPLE_RATE; // Kokoro's WAVs, as the sidecar names them
export const MASTER_RATE = 48000;
export const TRACK_RATE = MASTER_RATE; // the voice track, from the first mix to the master
// The voice in the MP4: AAC at 48 kHz, 160 kbit/s, two channels. Stereo (the mono voice on both) because players and
// platforms expect it and a later music bed is stereo; the master is made stereo before it is measured, so the
// loudness it reaches is the loudness of the file (a mono master copied to two channels would measure 3 LU louder).
export const AAC_AUDIO = Object.freeze(['-c:a', 'aac', '-b:a', '160k', '-ar', String(MASTER_RATE), '-ac', '2']);
/** The voice's integrated loudness may miss the mode's target by this many LU; more refuses the film. */
export const LOUDNESS_TOLERANCE_LU = 1;
/**
 * The master aims within this many LU of the target (the limiter runs when the ceiling would leave it further short),
 * and the mastered WAV is judged against it before any frame is captured: the finished file keeps
 * LOUDNESS_TOLERANCE_LU, so the AAC encode has room to move it without a late refusal.
 */
export const MASTER_AIM_LU = 0.5;
export const UNMEASURED_NOTE = 'the sound is too short or too quiet for its loudness to be measured, so it was not normalised';
/**
 * How far under the mode's loudness target the music sits before the duck, in LU: its own integrated loudness is measured
 * as it enters the mix (masterMix), so a bed or a file of any level lands there against a voice at its target.
 */
export const BED_UNDER_VOICE_LU = 18;
/** Seconds a user's music fades over at its end (sound/bed.mjs musicEnd says where). */
export const MUSIC_FADE_SECONDS = 1;
/** The note of a film without a voice whose cues and music peak at the ceiling before they reach the mode's target. */
export const NO_VOICE_NOTE = 'the film has no narration, and its cues and music cannot reach the mode\'s loudness target under its peak ceiling: they were raised as far as the ceiling (and, for music, its limiter) allows';

const SHAPING_FRAME_SAMPLES = 48; // 1 ms at 48 kHz: the gain expression steps once a frame
const HIGHPASS_HZ = 80;
// A gentle compressor: 2:1 above -18 dBFS, slow enough to leave the consonants alone.
const COMPRESSOR = Object.freeze({ thresholdDb: -18, ratio: 2, attackMs: 20, releaseMs: 250 });
// The de-esser: moderate intensity, its default reduction limit and split frequency.
const DEESSER = Object.freeze({ intensity: 0.3, maxReduction: 0.5, frequency: 0.5 });
const LIMITER_ROUNDS = 3; // at most this many limiter measurements (a very peaky track needs more than one)
const LIMITER_HEADROOM_DB = 3; // the limiter holds the peaks this far under the ceiling (as version 1's limiter stage)
const GATE_FLOOR_LUFS = -70; // ebur128's absolute gate: an integrated value at or under it measured nothing
const GAIN_STEPS = 100; // gains in dB are kept to 0.01, as they are written
const METER = 'ebur128=peak=true';
const TIME_DECIMALS = 4;
const DB_DECIMALS = 2;
const LINEAR_DECIMALS = 6;
const STDERR_KEEP = 200000; // ebur128's summary comes last; a long log keeps its tail
const QUIET = Object.freeze(['-hide_banner', '-loglevel', 'error']);
const MEASURE = Object.freeze(['-hide_banner', '-nostats']); // ebur128 prints its summary at info level
const NO_METADATA = Object.freeze(['-map_metadata', '-1']); // an input's tags never reach the log a measurement is read from
export const AUDIO_HINT = 'ffmpeg could not mix, master or mux the narration; the words after "ffmpeg failed" are its own. '
  + 'Check the disk space and that this ffmpeg has the highpass, acompressor, deesser, alimiter and ebur128 filters, then run again';
const SILENT_MESSAGE = 'voice master: the narration is silent (nothing in it reaches the -70 dB measurement gate), so there is nothing to put in the film';
const SILENT_HINT = 'for a synthesised voice, delete the .voice folder beside the video so the narration is made again; '
  + 'for your own recording, check that the file has sound in it';
const LEVEL_SHORT_HINT = 'the narration\'s loudest moments are too loud for its average level: soften them (for your own recording, '
  + 'record further from the microphone or remove pops and clicks), or use a mode with a lower target. A rerun gives the same result';
const LEVEL_OVER_HINT = 'the voice came out louder than the mode allows, which the mastering should never do; '
  + 'please report it with the film. A rerun gives the same result';

const fixed = (decimals) => (n) => {
  if (!Number.isFinite(n)) throw new RangeError(`master: ${n} is not a finite number`);
  return n.toFixed(decimals);
};
const time = fixed(TIME_DECIMALS);
const decibels = fixed(DB_DECIMALS);
const linear = (db) => fixed(LINEAR_DECIMALS)(10 ** (db / 20));
// Whole samples at the track rate, refusing a time that is not finite.
const samplesOf = (seconds) => Number(fixed(0)(seconds * TRACK_RATE));

class AudioError extends Error {
  constructor(message, { hint = AUDIO_HINT, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'AudioError';
    this.hint = hint;
  }
}

// Any failure inside the voice steps as an AudioError, so it carries a hint; a stop passes through as it is.
const asAudioError = (err) => (err instanceof AudioError || err?.name === 'AbortError' ? err : new AudioError(`voice: ${err?.message ?? err}`, { cause: err }));

// ---- shaping -----------------------------------------------------------------------------------------------------------

const wordsOf = (shot) => (Array.isArray(shot?.sentences) ? shot.sentences.flatMap((s) => s.words) : []);

// The emphasised words of one shot and its runs of contiguous aside words, as { db, start, end } in film seconds. A word
// of no length gets no stage.
function shotStages(shot, offset) {
  const stages = [];
  let run = null;
  for (const w of wordsOf(shot)) {
    if (w.emphasis && w.end > w.start) stages.push({ db: LEVELS.emphasisDb, start: offset + w.start, end: offset + w.end });
    if (w.aside) run = run === null ? { first: w, last: w } : { ...run, last: w };
    if (!w.aside && run !== null) { stages.push(asideStage(run, offset)); run = null; }
  }
  if (run !== null) stages.push(asideStage(run, offset));
  return stages.filter((s) => s.end > s.start);
}
const asideStage = ({ first, last }, offset) => ({ db: LEVELS.asideDb, start: offset + first.start, end: offset + last.end });

// Stages of one level whose ramps would meet (closer than two ramps) become one, so the gain never doubles in between.
function merged(stages) {
  const out = [];
  for (const s of [...stages].sort((a, b) => a.start - b.start)) {
    const prev = out.at(-1);
    if (prev && s.start - prev.end < 2 * RAMP_SECONDS) out[out.length - 1] = { ...prev, end: Math.max(prev.end, s.end) };
    else out.push(s);
  }
  return out;
}

/**
 * The gain stages of a sidecar on `timeline`, in film seconds: each emphasised word (LEVELS.emphasisDb) and each run of
 * contiguous aside words (LEVELS.asideDb), at the sidecar's word times plus narrationStart of the word's shot.
 */
export function gainStages(sidecar, timeline) {
  const all = sidecar.shots.flatMap((shot, i) => shotStages(shot, narrationStart(timeline.shots[i])));
  const of = (db) => merged(all.filter((s) => s.db === db));
  return [...of(LEVELS.emphasisDb), ...of(LEVELS.asideDb)].sort((a, b) => a.start - b.start);
}

// One stage as a volume filter: pow(10, dB * envelope / 20), the envelope 0 to 1 over the ramps (see the header).
function stageFilter({ db, start, end }) {
  const ramp = time(RAMP_SECONDS);
  const envelope = `clip(min((t-(${time(start - RAMP_SECONDS)}))/${ramp},(${time(end + RAMP_SECONDS)}-t)/${ramp}),0,1)`;
  return `volume='pow(10,${decibels(db)}*${envelope}/20)':eval=frame`;
}

/** The shaping filter chain of a sidecar on `timeline` (film times), or '' when nothing is emphasised or aside. */
export function shapingFilter(sidecar, timeline) {
  const stages = gainStages(sidecar, timeline);
  if (stages.length === 0) return '';
  return [`asetnsamples=n=${SHAPING_FRAME_SAMPLES}:p=0`, ...stages.map(stageFilter)].join(',');
}

// ---- an author's own recording: plain audio, and nothing else for ffmpeg to open ---------------------------------------

/**
 * The demuxers a recording may be opened with, as ffmpeg names them: WAV, MP3, FLAC, Ogg, M4A or MP4 (the mov demuxer,
 * whose external track references stay off by default) and AIFF. ffmpeg picks a demuxer from a file's content, not its
 * name, so every call that opens the recording passes this list as -format_whitelist: a playlist (hls, dash), a concat
 * script, an image sequence, or any other format that can open another file, fails to open.
 */
export const RECORDING_DEMUXERS = Object.freeze(['wav', 'mp3', 'flac', 'ogg', 'mov', 'mp4', 'm4a', 'aiff']);
// The format names ffprobe reports for those demuxers (the mov demuxer under its full name).
const RECORDING_FORMATS = new Set(['wav', 'mp3', 'flac', 'ogg', 'aiff', 'mov,mp4,m4a,3gp,3g2,mj2']);
const ACCEPTED_LABEL = 'WAV, MP3, FLAC, Ogg, M4A or MP4, or AIFF';
/** The recording as an ffmpeg or ffprobe input: read through the file protocol only, and by an accepted demuxer only. */
export const recordingInput = (file) => ['-protocol_whitelist', 'file', '-format_whitelist', RECORDING_DEMUXERS.join(','), '-i', file];
/**
 * One of our own WAVs as an ffmpeg input (a shot WAV, the voice track, the cue track, the bed): read through the file
 * protocol only and by the WAV demuxer only, forced, so a file that is anything else (an ffconcat script planted in a
 * cache folder, which would open another file) fails to open instead of being followed.
 */
export const ownWavInput = (file) => ['-protocol_whitelist', 'file', '-format_whitelist', 'wav', '-f', 'wav', '-i', file];
export const PROBE_TIMEOUT_MS = 10000;
const PROBE_MAX_BUFFER = 1024 * 1024;
/** A recording may end this many seconds before its last word's end (Whisper's times step 0.02 s; encoders pad). */
export const RECORDING_END_TOLERANCE = 0.05;
// ffmpeg's log line when the whitelist refuses the demuxer it detected: the demuxer's own name is the log context.
const REFUSED_FORMAT_RE = /^\[([a-z0-9_,]+) @ 0x[0-9a-f]+\] Format not on whitelist/m;
const PROBE_HINT = 'check that ffprobe (it comes with ffmpeg) runs on this machine, then run again';
const SECONDS_STEPS = 100;

/** The ffprobe arguments that read a recording's format, duration and streams (JSON on stdout). */
export const probeRecordingArgs = (file) => ['-v', 'error', '-show_entries',
  'format=format_name,duration:stream=index,codec_type:stream_disposition=attached_pic', '-of', 'json', ...recordingInput(file)];

function openedProbe(stdout) {
  const parsed = JSON.parse(stdout);
  const streams = (Array.isArray(parsed?.streams) ? parsed.streams : []).map((s) => ({ type: s?.codec_type, attachedPic: s?.disposition?.attached_pic === 1 }));
  return { format: parsed?.format?.format_name ?? null, duration: Number(parsed?.format?.duration), streams };
}

function refusedProbe(stderr, file) {
  const refused = REFUSED_FORMAT_RE.exec(stderr);
  if (refused) return { format: refused[1], error: 'its format is not on the whitelist' };
  const last = lastLine(stderr);
  return { format: null, error: last.startsWith(`${file}: `) ? last.slice(file.length + 2) : last };
}

/**
 * What ffprobe reads of the recording `file` (its real path) through recordingInput: `{ format, duration, streams: [{
 * type, attachedPic }] }` when it opens, or `{ format, error }` when it does not (`format` the demuxer ffmpeg detected and
 * the whitelist refused, or null). ffprobe failing to run, or not finishing within PROBE_TIMEOUT_MS, is an AudioError
 * (machine trouble), never a skipped check; an abort through `signal` rejects with the abort.
 */
export function probeRecording({ ffprobe, file, signal }) {
  const options = { encoding: 'utf8', timeout: PROBE_TIMEOUT_MS, killSignal: 'SIGKILL', maxBuffer: PROBE_MAX_BUFFER, signal };
  return new Promise((resolve, reject) => {
    execFile(ffprobe, probeRecordingArgs(file), options, (err, stdout, stderr) => {
      if (err?.name === 'AbortError') return reject(err);
      if (err && (err.killed || typeof err.code !== 'number')) {
        const why = err.killed ? `it did not finish within ${PROBE_TIMEOUT_MS / 1000} s` : err.message;
        return reject(new AudioError(`voice: ffprobe could not read the recording: ${why}`, { hint: PROBE_HINT }));
      }
      try {
        return resolve(err ? refusedProbe(stderr, file) : openedProbe(stdout));
      } catch (parseErr) {
        return reject(new AudioError(`voice: ffprobe printed no readable report for the recording: ${parseErr.message}`, { hint: PROBE_HINT }));
      }
    });
  });
}

/**
 * Why a probed recording (probeRecording) cannot narrate a film whose last word ends at `lastWordEnd` seconds in it, or
 * null: a format that is not plain audio (named), a file ffmpeg cannot read, no audio stream or more than one, any other
 * stream but a cover picture, no readable length, or a length short of the last word (by more than
 * RECORDING_END_TOLERANCE). The message follows the file's name and calls the file `what` (default "recording"; sound/bed.mjs
 * passes "music file").
 */
export function recordingProblem(probe, lastWordEnd, { what = 'recording' } = {}) {
  if (probe.format !== null && !RECORDING_FORMATS.has(probe.format)) {
    return `is in the "${probe.format}" format, not plain audio: a ${what} must be ${ACCEPTED_LABEL}, which open no other file; export it as WAV`;
  }
  if (probe.error !== undefined) return `cannot be read as audio (${probe.error}); a ${what} must be ${ACCEPTED_LABEL}`;
  const audio = probe.streams.filter((s) => s.type === 'audio');
  if (audio.length === 0) return `has no audio stream; name the ${what} itself`;
  if (audio.length > 1) return `has ${audio.length} audio streams; a ${what} must have exactly one`;
  const other = probe.streams.find((s) => s.type !== 'audio' && !s.attachedPic);
  if (other !== undefined) return `has a ${other.type ?? 'non-audio'} stream besides its audio; a ${what} must hold its audio alone: export it as WAV`;
  if (!Number.isFinite(probe.duration)) return 'has no length ffmpeg can read; export it as WAV';
  if (probe.duration + RECORDING_END_TOLERANCE < lastWordEnd) {
    return `lasts ${Math.round(probe.duration * SECONDS_STEPS) / SECONDS_STEPS} s, but the words file's last word ends at ${lastWordEnd} s; the words are not this recording's`;
  }
  return null;
}

// ---- the voice track ---------------------------------------------------------------------------------------------------

/**
 * The ffmpeg arguments that build the film's voice track at 48 kHz mono: each shot of `shots` (one per timeline shot,
 * `{ wav }` an absolute path or null) with a WAV is resampled once to 48 kHz and delayed to its shot's narration start in
 * whole samples, the inputs are mixed without normalisation, and the track is padded and cut to the film's length.
 * `recording` (an absolute path) is an author's own recording of the whole film instead: one input at film time 0
 * through recordingInput (the file protocol and the accepted audio demuxers only), its words already where the timeline
 * put them (engine/script/timing.mjs recordedTimeline), resampled the same way.
 */
export function voiceTrackArgs({ shots, timeline, out, recording }) {
  const placed = recording === undefined
    ? shots.map((s, i) => ({ wav: s.wav, delay: samplesOf(narrationStart(timeline.shots[i])) })).filter((s) => s.wav !== null)
    : [{ wav: recording, delay: 0 }];
  if (placed.length === 0) throw new RangeError('voiceTrackArgs: no shot has a narration WAV');
  const length = samplesOf(timeline.duration);
  const chains = placed.map((s, k) => `[${k}:a]aformat=sample_rates=${TRACK_RATE}:channel_layouts=mono,adelay=delays=${s.delay}S:all=1[v${k}]`);
  const labels = placed.map((_, k) => `[v${k}]`).join('');
  const graph = `${chains.join(';')};${labels}amix=inputs=${placed.length}:duration=longest:normalize=0,apad=whole_len=${length},atrim=end_sample=${length}[voice]`;
  const inputs = recording === undefined ? placed.flatMap((s) => ownWavInput(s.wav)) : recordingInput(recording);
  return [...QUIET, '-y', ...inputs, '-filter_complex', graph, '-map', '[voice]', ...NO_METADATA,
    '-ar', String(TRACK_RATE), '-ac', '1', '-c:a', 'pcm_s16le', out];
}

// ---- mastering ---------------------------------------------------------------------------------------------------------

// The limiter stage: `drive` dB of gain, then alimiter holding the peaks LIMITER_HEADROOM_DB under the ceiling (room for
// the static gain to finish the job). `level=false` stops alimiter's own make-up gain; `latency=true` removes its
// lookahead delay, so the voice stays where the timeline put it.
function limiterFilter(drive, loudness) {
  return `volume=${decibels(drive)}dB,alimiter=limit=${linear(ceilingFor(loudness.truePeakDb) - LIMITER_HEADROOM_DB)}:level=false:latency=true`;
}

// The chain every pass shares: high-pass, compressor, de-esser, the limiter when there is one (`drive`), the shaping,
// stereo at 48 kHz. The shaping comes after everything that changes level with level, so its lift and cut are exact.
function masterChain({ filter, drive, loudness }) {
  const compressor = `acompressor=threshold=${linear(COMPRESSOR.thresholdDb)}:ratio=${COMPRESSOR.ratio}:attack=${COMPRESSOR.attackMs}:release=${COMPRESSOR.releaseMs}`;
  const deesser = `deesser=i=${DEESSER.intensity}:m=${DEESSER.maxReduction}:f=${DEESSER.frequency}`;
  const limiter = drive === undefined ? '' : limiterFilter(drive, loudness);
  return [`highpass=f=${HIGHPASS_HZ}`, compressor, deesser, limiter, filter, `aresample=${MASTER_RATE},aformat=channel_layouts=stereo`]
    .filter(Boolean).join(',');
}

/**
 * The ffmpeg arguments of a mastering pass over the voice track `wav`. Without `gainDb`: a measuring pass (ebur128 on
 * stderr, the same meter the finished film is judged with). With `gainDb`: the master, the chain then one static gain,
 * written to `out` as a 48 kHz stereo WAV. `filter` is the shaping chain; `drive` the limiter's drive in dB or undefined
 * (with `loudness`, the mode's { lufs, truePeakDb }, for the limiter's ceiling).
 */
export function masterArgs({ wav, out, filter, drive, loudness, gainDb }) {
  const chain = masterChain({ filter, drive, loudness });
  if (gainDb === undefined) return [...MEASURE, ...ownWavInput(wav), ...NO_METADATA, '-af', `${chain},${METER}`, '-f', 'null', '-'];
  return [...QUIET, '-y', ...ownWavInput(wav), ...NO_METADATA, '-af', `${chain},volume=${decibels(gainDb)}dB`, '-ar', String(MASTER_RATE), '-c:a', 'pcm_s16le', out];
}

const lastLine = (text) => text.trim().split('\n').filter((l) => l.trim()).at(-1) ?? 'no output';

// Runs one ffmpeg step through `run` and fails with ffmpeg's last line and the audio hint when it does not exit 0.
async function step(run, args, what) {
  const { code, stderr } = await run(args);
  if (code !== 0) throw new AudioError(`${what}: ffmpeg failed (exit ${code}): ${lastLine(stderr)}`);
  return stderr;
}

// One measuring pass over `args` (a measuring masterArgs or mixArgs): { lufs, truePeak } as ebur128 reads it.
async function measureWith(run, args, what) {
  const stderr = await step(run, args, what);
  const level = parseLoudness(stderr);
  if (level === null) throw new AudioError(`${what}: ffmpeg printed no loudness measurement (its last line: ${lastLine(stderr)})`);
  return level;
}

// One measuring pass of the voice chain: { lufs, truePeak } as ebur128 reads the chain's output (-Infinity for nothing).
const measureChain = (run, base) => measureWith(run, masterArgs(base), 'voice master');

// Over the gate: the integrated loudness was measured; the true peak reached it (the track has sound at all).
const isMeasured = ({ lufs }) => Number.isFinite(lufs) && lufs > GATE_FLOOR_LUFS;
const isSilent = ({ truePeak }) => !(Number.isFinite(truePeak) && truePeak > GATE_FLOOR_LUFS);
const hundredths = (n) => Math.round(n * GAIN_STEPS) / GAIN_STEPS;

// The static gain to the target for a measured `level`, capped so the true peak stays at the ceiling, and by how much
// the cap leaves it short of the target (0 or less: not short).
function gainFor(level, loudness) {
  const wanted = loudness.lufs - level.lufs;
  const allowed = ceilingFor(loudness.truePeakDb) - level.truePeak;
  return { gainDb: hundredths(Math.min(wanted, allowed)), shortDb: wanted - allowed };
}

// Limiter rounds while the peak cap leaves the gain more than MASTER_AIM_LU short, measured again each time through
// `measure(base)` (default: the voice chain). The first drive is the whole gain the target wants (as version 1 limits:
// gain to the target, then limit), so the driven peaks surely reach the limiter's threshold; a drive of only the
// shortfall can leave them under it, where the limiter changes nothing (the voice review's I2). Each later round adds
// what is still short. Resolves the last measurement and the drive (undefined when no round ran).
async function limited(run, base, first, measure = (b) => measureChain(run, b)) {
  let level = first;
  let drive;
  for (let round = 0; round < LIMITER_ROUNDS && gainFor(level, base.loudness).shortDb > MASTER_AIM_LU; round++) {
    drive = hundredths(drive === undefined ? base.loudness.lufs - level.lufs : drive + gainFor(level, base.loudness).shortDb);
    level = await measure({ ...base, drive });
    if (!isMeasured(level)) throw new AudioError('voice master: the narration could not be measured through the limiter');
  }
  return { level, drive };
}

/**
 * Masters the voice track `wav` into `out` through `run(args) -> Promise<{ code, stderr }>` (ffmpegRunner): it measures
 * the chain, and writes it with one static gain to the mode's target, capped by the ceiling; the limiter runs first only
 * when that cap would leave the result more than MASTER_AIM_LU short (at most LIMITER_ROUNDS rounds; what is still short is
 * written, and the level judgement refuses it). A silent track (nothing over the gate) is refused; an audible track too
 * short to measure is written with no gain. Resolves `{ gainDb, limited, measured }`.
 */
export async function masterVoice({ run, wav, out, filter, loudness }) {
  const base = { wav, filter, loudness };
  const first = await measureChain(run, base);
  if (isSilent(first)) throw new AudioError(SILENT_MESSAGE, { hint: SILENT_HINT });
  if (!isMeasured(first)) {
    await step(run, masterArgs({ ...base, out, gainDb: 0 }), 'voice master');
    return { gainDb: 0, limited: false, measured: false };
  }
  const { level, drive } = await limited(run, base, first);
  const { gainDb } = gainFor(level, loudness);
  await step(run, masterArgs({ ...base, out, drive, gainDb }), 'voice master');
  return { gainDb, limited: drive !== undefined, measured: true };
}

// ---- one mix: the voice, the cues and the music bed -------------------------------------------------------------------
//
// A film with cues or music is mastered as one mix: the voice through its chain as above (without a limiter of its own),
// the cues and the bed set against the voice at its target level (each lowered by the voice's own gain to target, so
// the static gain that follows lifts the voice to the target and leaves them where they sit relative to it), the bed at
// BED_UNDER_VOICE_LU under the target (its own loudness measured first) under its duck, all summed, then the limiter on
// the sum when the ceiling would leave the mix more than MASTER_AIM_LU short, padded and cut to the film's length, measured and written with one static gain, as a voice alone
// is. With no voice the cues and bed are the mix and the static gain takes them toward the mode's target.

const SILENT_SOUND_MESSAGE = 'sound master: the cues and music are silent (nothing in them reaches the -70 dB measurement gate)';
const SILENT_SOUND_HINT = 'check that the music file has sound in it; the synthesised cues and beds always do, so report the film if it is not that';
const SLOPE_DECIMALS = 6;
const slope = fixed(SLOPE_DECIMALS);
// ffmpeg refuses an expression much over 4,000 characters ("Missing ')' or too many args"; measured: 60 segment terms,
// about 3,700 characters, pass, 150 fail), so the duck's terms are split across volume filters of at most this many.
const DUCK_TERMS_PER_FILTER = 32;

// Duck breakpoints (sound/duck.mjs) as gain terms of t in dB: one per segment that is not flat at 0 dB, each zero
// outside its own [start, end) window, so the windows never overlap.
function duckTerms(points) {
  points.forEach((p) => { time(p.t); decibels(p.gainDb); }); // every number formats, or the call refuses it
  const terms = [];
  for (let k = 1; k < points.length; k++) {
    const [p, n] = [points[k - 1], points[k]];
    if (n.t <= p.t || (p.gainDb === 0 && n.gainDb === 0)) continue;
    const rise = (n.gainDb - p.gainDb) / (n.t - p.t);
    terms.push(`gte(t,${time(p.t)})*lt(t,${time(n.t)})*(${decibels(p.gainDb)}+(${slope(rise)})*(t-${time(p.t)}))`);
  }
  return terms;
}

// The duck as volume filters in series, each the sum of up to DUCK_TERMS_PER_FILTER terms: the terms' windows are
// disjoint, so at any t at most one filter is not 0 dB and the product is exactly the breakpoints' curve.
function duckFilters(points) {
  const terms = duckTerms(points);
  const filters = [];
  for (let k = 0; k < terms.length; k += DUCK_TERMS_PER_FILTER) {
    filters.push(`volume='pow(10,(${terms.slice(k, k + DUCK_TERMS_PER_FILTER).join('+')})/20)':eval=frame`);
  }
  return filters;
}

// The music's gain in the mix: from its measured loudness (`music.lufs`) to BED_UNDER_VOICE_LU under the target, lowered
// by `offsetDb` as the cues are; 0 dB for a measuring pass (no `lufs` yet).
const musicGainDb = (music, loudness, offsetDb) => (music.lufs === undefined ? 0 : loudness.lufs - BED_UNDER_VOICE_LU - music.lufs + offsetDb);

// The music's chain from input `index`: 48 kHz stereo, cut to the film, a fade from `fadeFrom` (a user's file), its gain
// (musicGainDb), then the duck (1 ms frames, as the shaping steps).
function musicChain(music, index, { duration, offsetDb, loudness }) {
  // asetpts: from the file's first sample, whatever its stream timestamps say (an MP3's delay, an MP4 edit list), so the
  // cut, the fade and the duck's t are film time
  const parts = [`[${index}:a]asetpts=PTS-STARTPTS`, `aresample=${MASTER_RATE}`, `aformat=sample_rates=${MASTER_RATE}:channel_layouts=stereo`, `atrim=end=${time(duration)}`];
  if (music.fadeFrom !== null && music.fadeFrom !== undefined) parts.push(`afade=t=out:st=${time(music.fadeFrom)}:d=${time(MUSIC_FADE_SECONDS)}`);
  parts.push(`volume=${decibels(musicGainDb(music, loudness, offsetDb))}dB`);
  const duck = duckFilters(music.duck ?? []);
  if (duck.length > 0) parts.push(`asetnsamples=n=${SHAPING_FRAME_SAMPLES}:p=0`, ...duck);
  return `${parts.join(',')}[m]`;
}

// The inputs and the filter graph of a mix, ending in `tail` (the meter, or the static gain) at the label [out].
function mixGraph({ voice, cues, music, duration, loudness, drive, offsetDb = 0 }, tail) {
  const inputs = [];
  const chains = [];
  const labels = [];
  if (voice) {
    chains.push(`[${labels.length}:a]${masterChain({ filter: voice.filter, drive: undefined, loudness })}[v]`);
    inputs.push(...ownWavInput(voice.wav));
    labels.push('[v]');
  }
  if (cues) {
    chains.push(`[${labels.length}:a]aformat=sample_rates=${MASTER_RATE}:channel_layouts=stereo,volume=${decibels(offsetDb)}dB[c]`);
    inputs.push(...ownWavInput(cues.file));
    labels.push('[c]');
  }
  if (music) {
    chains.push(musicChain(music, labels.length, { duration, offsetDb, loudness }));
    inputs.push(...(music.recording ? recordingInput(music.file) : ownWavInput(music.file)));
    labels.push('[m]');
  }
  if (labels.length === 0) throw new RangeError('mixArgs: a mix needs a voice, cues or music');
  const length = samplesOf(duration);
  const sum = labels.length === 1 ? `${labels[0]}anull` : `${labels.join('')}amix=inputs=${labels.length}:normalize=0:duration=longest`;
  const busLimiter = drive === undefined ? '' : `,${limiterFilter(drive, loudness)}`; // in a mix the limiter is on the sum
  return { inputs, graph: `${chains.join(';')};${sum}${busLimiter},apad=whole_len=${length},atrim=end_sample=${length},${tail}[out]` };
}

/**
 * The ffmpeg arguments of a mix pass. `voice` { wav, filter } (the voice track and its shaping) or none, `cues` { file }
 * (the cue track, sound/synth.mjs renderCues: its cues at their own gains) or none, `music` { file, recording, fadeFrom,
 * duck, lufs } or none (a bed WAV, or with `recording` a user's file opened through recordingInput; `duck` the breakpoints
 * of sound/duck.mjs; `lufs` its loudness as it enters the mix, which sets its gain: musicGainDb), `duration` the film's seconds, `offsetDb` the voice's gain to target lowered from the cues and bed
 * (0 without a voice), `drive` the limiter (always on the sum). Without `gainDb` a measuring pass
 * (ebur128 on stderr); with it the master, written to `out` as a 48 kHz stereo WAV.
 */
export function mixArgs({ gainDb, out, ...mix }) {
  const { inputs, graph } = mixGraph(mix, gainDb === undefined ? METER : `volume=${decibels(gainDb)}dB`);
  if (gainDb === undefined) return [...MEASURE, ...inputs, '-filter_complex', graph, '-map', '[out]', ...NO_METADATA, '-f', 'null', '-'];
  return [...QUIET, '-y', ...inputs, '-filter_complex', graph, '-map', '[out]', ...NO_METADATA, '-ar', String(MASTER_RATE), '-c:a', 'pcm_s16le', out];
}

// How far the cues and bed are lowered: the voice's own gain to its target (the target minus its measured loudness
// through the chain), so they sit against the voice at its target level; 0 without a voice, or for a voice too quiet to
// measure. A silent voice is refused.
async function voiceOffset(run, voice, loudness) {
  if (!voice) return 0;
  const first = await measureChain(run, { wav: voice.wav, filter: voice.filter, loudness });
  if (isSilent(first)) throw new AudioError(SILENT_MESSAGE, { hint: SILENT_HINT });
  return isMeasured(first) ? -hundredths(loudness.lufs - first.lufs) : 0;
}

const SILENT_MUSIC_MESSAGE = 'sound master: the music is silent for the length of the film (nothing in it reaches the -70 dB measurement gate)';

// The music's integrated loudness as it enters the mix (cut to the film, faded, no duck and no gain): what its gain is set
// from (final review I4). A user's silent file is refused before this (sound/bed.mjs musicInput); one that is not
// measured here anyway is refused too, never mixed at a guessed level.
async function musicLevel(run, music, duration, loudness) {
  const level = await measureWith(run, mixArgs({ music: { ...music, duck: [], lufs: undefined }, duration, loudness }), 'music level');
  if (!isMeasured(level)) throw new AudioError(SILENT_MUSIC_MESSAGE, { hint: SILENT_SOUND_HINT });
  return level.lufs;
}

/**
 * Masters one mix (mixArgs: `voice`, `cues`, `music`, `duration`) into `out` to `loudness`: measures it, then writes it
 * with one static gain to the target, capped by the ceiling. The limiter, when the cap would leave the mix more than
 * MASTER_AIM_LU short, is on the sum (limited's rounds, driven as for a voice alone), except for cues alone, which get
 * none (judgeLevel's noVoice says so). A silent mix is refused; one too quiet to measure is written with no gain.
 * Resolves `{ gainDb, measured }`.
 */
export async function masterMix({ run, out, loudness, ...parts }) {
  const music = parts.music ? { ...parts.music, lufs: await musicLevel(run, parts.music, parts.duration, loudness) } : undefined;
  const mix = { ...parts, music, loudness, offsetDb: await voiceOffset(run, parts.voice, loudness), drive: undefined };
  const measure = (m) => measureWith(run, mixArgs(m), 'sound master');
  const first = await measure(mix);
  if (isSilent(first)) throw new AudioError(parts.voice ? SILENT_MESSAGE : SILENT_SOUND_MESSAGE, { hint: parts.voice ? SILENT_HINT : SILENT_SOUND_HINT });
  if (!isMeasured(first)) {
    await step(run, mixArgs({ ...mix, out, gainDb: 0 }), 'sound master');
    return { gainDb: 0, measured: false };
  }
  // Cues alone: raised to the ceiling and no further, since a limiter would have to crush sparse transients to lift
  // their integrated loudness.
  const cuesAlone = !parts.voice && !parts.music;
  const { level, drive } = cuesAlone ? { level: first, drive: undefined } : await limited(run, mix, first, measure);
  const { gainDb } = gainFor(level, loudness);
  await step(run, mixArgs({ ...mix, drive, out, gainDb }), 'sound master');
  return { gainDb, measured: true };
}

// ---- the film's voice, end to end --------------------------------------------------------------------------------------

const isBareName = (name) => typeof name === 'string' && name !== '' && name !== '.' && name !== '..' && path.basename(name) === name;

// Throws when the shot WAV at `file` exists but is not a regular file: a symlink (which could reach outside the folder)
// or anything special. A missing file is left for ffmpeg, whose failure names it.
function checkRegular(file, name) {
  let stat;
  try {
    stat = lstatSync(file);
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
  if (!stat.isFile()) throw new AudioError(`voice: the shot WAV ${JSON.stringify(name)} is not a regular file (a symlink or a special file); it is not opened`);
}

// The shot WAVs of a sidecar as absolute paths beside it (null for a shot without narration). A sidecar names its WAVs
// by bare file names only (sidecar.mjs wavName); anything else (a path, ".", "..", empty) is refused, never opened, and
// so is a name that is a symlink or not a regular file.
function shotWavs({ dir, sidecar }) {
  return sidecar.shots.map((shot) => {
    if (shot.wav === null) return { wav: null };
    if (!isBareName(shot.wav)) throw new AudioError(`voice: the sidecar names the WAV ${JSON.stringify(shot.wav)}, not a file beside it`);
    const wav = path.join(dir, shot.wav);
    checkRegular(wav, shot.wav);
    return { wav };
  });
}

// A recording's words (`sidecar`, seconds from the start of the one file, which is film time) as the shaping reads them:
// each shot's words from its narration start, since gainStages adds that start. The sound's own times, not the
// timeline's (which shows each shot's first word from the shot's first frame).
function placedSidecar(sidecar, timeline) {
  return {
    shots: sidecar.shots.map((shot, i) => {
      const from = narrationStart(timeline.shots[i]);
      return { sentences: [{ words: wordsOf(shot).map((w) => ({ ...w, start: w.start - from, end: w.end - from })) }] };
    }),
  };
}

/**
 * Whether `voice` (the voice stage's result, or undefined) puts any narration in the film: an author's recording, or a
 * WAV for at least one shot. A voiced film whose shots have no say has none, and is mixed and judged as a film without a
 * voice (judgeLevel noVoice).
 */
export const hasNarration = (voice) => voice !== undefined && (voice.recording !== undefined || voice.sidecar.shots.some((s) => s.wav !== null));

// The film's voice track built in `workDir` and its shaping: { wav, filter }, or null when no shot has narration.
async function builtVoice({ run, voice, timeline, workDir }) {
  if (!hasNarration(voice)) return null;
  const recording = voice.recording;
  const shots = recording === undefined ? shotWavs(voice) : [];
  const track = path.join(workDir, 'voice-track.wav');
  await step(run, voiceTrackArgs({ shots, timeline, out: track, recording }), 'voice mix');
  const sidecar = recording === undefined ? voice.sidecar : placedSidecar(voice.sidecar, timeline);
  return { wav: track, filter: shapingFilter(sidecar, timeline) };
}

/**
 * Builds the film's voice track from `voice` on `timeline`, shapes and masters it to `loudness` in `workDir`, and
 * resolves the mastered WAV's path, or null when there is nothing to put in the film. `voice` is what the voice stage
 * made: { dir, sidecar } (a WAV per narrated shot), or { recording, sidecar } (the absolute path of an author's own
 * recording of the whole film, and its words in seconds from the file's start), or undefined for a film without one.
 * `cues` ({ file }) and `music` ({ file, recording, fadeFrom, duck }) make it one mix (masterMix); without them the voice
 * alone is mastered as it always was (masterVoice). Every failure is an AudioError with the audio hint.
 */
export async function masterTrack({ run, voice, timeline, loudness, workDir, cues, music }) {
  try {
    const built = voice === undefined ? null : await builtVoice({ run, voice, timeline, workDir });
    if (!cues && !music) {
      if (built === null) return null;
      const master = path.join(workDir, 'voice-master.wav');
      await masterVoice({ run, wav: built.wav, out: master, filter: built.filter, loudness });
      return master;
    }
    const master = path.join(workDir, 'sound-master.wav');
    await masterMix({ run, out: master, loudness, voice: built ?? undefined, cues, music, duration: timeline.duration });
    return master;
  } catch (err) {
    throw asAudioError(err);
  }
}

// Our own MP4s (the encoded master, the video partial, the finished film): the file protocol and the MP4 demuxer only.
const OWN_MP4_DEMUXERS = 'mov,mp4,m4a';
export const ownMp4Input = (file) => ['-protocol_whitelist', 'file', '-format_whitelist', OWN_MP4_DEMUXERS, '-f', 'mov', '-i', file];
// At most this many encodes after the first, each raised by what the last one fell short of the target.
const ENCODE_ROUNDS = 2;

/**
 * The ffmpeg arguments of the master's encode: the mastered WAV `master` (with `gainDb`, 0 by default) as AAC_AUDIO,
 * audio only, `duration` seconds long, into the MP4 `out`. The mux copies this stream as it is (muxArgs).
 */
export function encodeArgs({ master, out, duration, gainDb = 0 }) {
  const gain = gainDb === 0 ? [] : ['-af', `volume=${decibels(gainDb)}dB`];
  return [...QUIET, '-y', ...ownWavInput(master), '-map', '0:a:0', ...NO_METADATA, ...gain, ...AAC_AUDIO, '-t', time(duration), '-f', 'mp4', out];
}

/** The ffmpeg arguments of the mux: the video and the encoded master (encodeArgs) both copied as they are. */
export function muxArgs({ video, audio, out, duration }) {
  return [...QUIET, '-y', ...ownMp4Input(video), ...ownMp4Input(audio), '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'copy',
    '-t', time(duration), '-movflags', '+faststart', out];
}

// A WAV of our own (a master) is opened as WAV, anything else we wrote as MP4.
const ownInput = (file) => (path.extname(file).toLowerCase() === '.wav' ? ownWavInput(file) : ownMp4Input(file));
const loudnessArgs = (file) => [...MEASURE, ...ownInput(file), '-map', '0:a:0', '-af', METER, '-f', 'null', '-'];

// ebur128's reading as the report's audio: an integrated value at the gate floor (or none) measured nothing.
function levelOf({ lufs, truePeak }) {
  const measured = Number.isFinite(lufs) && lufs > GATE_FLOOR_LUFS ? lufs : null;
  return { lufs: measured, truePeakDb: Number.isFinite(truePeak) ? truePeak : null, note: measured === null ? UNMEASURED_NOTE : null };
}

/**
 * The voice level of `file` (the master WAV, or the finished film's first audio stream) as ebur128 reads it:
 * `{ lufs, truePeakDb, note }` (lufs null, with a note, for a narration too short to measure).
 */
export async function measureFile({ run, file }) {
  try {
    const level = parseLoudness(await step(run, loudnessArgs(file), 'voice loudness'));
    if (level === null) throw new AudioError(`voice loudness: ffmpeg printed no ebur128 summary for ${path.basename(file)}`);
    return levelOf(level);
  } catch (err) {
    throw asAudioError(err);
  }
}

// How far to raise an encode that fell more than MASTER_AIM_LU short of the target: the shortfall, as far as the true
// peak allows (ceilingFor: the ceiling less the room a later encode may still move it). 0: leave it.
function encodeRaise(level, loudness) {
  if (level.lufs === null || level.truePeakDb === null || loudness.lufs - level.lufs <= MASTER_AIM_LU) return 0;
  return Math.max(0, hundredths(Math.min(loudness.lufs - level.lufs, ceilingFor(loudness.truePeakDb) - level.truePeakDb)));
}

/**
 * Encodes the mastered WAV `master` to `out` (encodeArgs) before any frame is captured and measures the encode: AAC
 * can take more than a decibel from noise-like sound (final review I3). An encode more than MASTER_AIM_LU short of
 * `loudness` is made again with the shortfall added as gain, as far as the true peak allows, at most ENCODE_ROUNDS
 * times. Resolves `{ file: out, level, gainDb }`: the level of the stream the mux will copy (measureFile's shape) and
 * the gain added. The caller judges `level` with the finished file's rule.
 */
export async function encodeMaster({ run, master, out, duration, loudness }) {
  try {
    let gainDb = 0;
    await step(run, encodeArgs({ master, out, duration, gainDb }), 'sound encode');
    let level = await measureFile({ run, file: out });
    for (let round = 0; round < ENCODE_ROUNDS && encodeRaise(level, loudness) > 0; round++) {
      gainDb = hundredths(gainDb + encodeRaise(level, loudness));
      await step(run, encodeArgs({ master, out, duration, gainDb }), 'sound encode');
      level = await measureFile({ run, file: out });
    }
    return { file: out, level, gainDb };
  } catch (err) {
    throw asAudioError(err);
  }
}

/**
 * Muxes the encoded master `audio` (encodeMaster) into `video` as `out`, then measures the finished file: resolves
 * `{ lufs, truePeakDb, note }` as ebur128 reads them from `out` (measureFile), never the targets echoed back.
 */
export async function muxVoice({ run, video, audio, out, duration }) {
  try {
    await step(run, muxArgs({ video, audio, out, duration }), 'voice mux');
  } catch (err) {
    throw asAudioError(err);
  }
  return measureFile({ run, file: out });
}

/**
 * A voice level (measureFile) against the mode's `loudness`: more than LOUDNESS_TOLERANCE_LU from the integrated
 * target, or a true peak over the ceiling, refuses the film (an AudioError whose hint says what the author can change,
 * since a rerun gives the same result); an unmeasured loudness (lufs null) is not judged. `subject` names what was
 * measured in the message. Returns `audio`. `noVoice`: the film has no voice, only cues and music, which masterMix
 * raises as far as the ceiling allows (sparse cues and a peaky bed can stop short of the target there), so a level short
 * of the target is not refused: `audio` comes back with NO_VOICE_NOTE as its note. Over the target or over the ceiling
 * is refused either way. `tolerance` (LU, default LOUDNESS_TOLERANCE_LU): render.mjs judges both the AAC encode of
 * the master before capture (encodeMaster) and the finished file with the default; the encode is the stream the mux
 * copies, so a film that would fail late fails early.
 */
export function judgeLevel(audio, loudness, subject = 'the finished film', { noVoice = false, tolerance = LOUDNESS_TOLERANCE_LU } = {}) {
  const short = audio.lufs !== null && audio.lufs < loudness.lufs - tolerance;
  if (short && noVoice) {
    if (audio.truePeakDb !== null && audio.truePeakDb > loudness.truePeakDb) judgeLevel({ ...audio, lufs: null }, loudness, subject);
    return { ...audio, note: NO_VOICE_NOTE };
  }
  if (short) {
    throw new AudioError(`voice loudness: ${subject} measures ${audio.lufs} LUFS, more than ${tolerance} LU under the mode's target of ${loudness.lufs} LUFS`, { hint: LEVEL_SHORT_HINT });
  }
  if (audio.lufs !== null && audio.lufs > loudness.lufs + tolerance) {
    throw new AudioError(`voice loudness: ${subject} measures ${audio.lufs} LUFS, more than ${tolerance} LU over the mode's target of ${loudness.lufs} LUFS`, { hint: LEVEL_OVER_HINT });
  }
  if (audio.truePeakDb !== null && audio.truePeakDb > loudness.truePeakDb) {
    throw new AudioError(`voice loudness: ${subject} has a true peak of ${audio.truePeakDb} dBTP, over the mode's ceiling of ${loudness.truePeakDb} dBTP`, { hint: LEVEL_OVER_HINT });
  }
  return audio;
}

/**
 * A runner for the steps above: `ffmpeg` with an argument array and no shell, resolving `{ code, stderr }` when it ends.
 * When `signal` aborts, the process is killed and the run rejects with the signal's reason.
 */
export function ffmpegRunner(ffmpeg, signal) {
  return (args) => new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const child = spawn(ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    const kill = () => child.kill('SIGKILL');
    signal?.addEventListener('abort', kill, { once: true });
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-STDERR_KEEP); });
    const settle = (code) => {
      signal?.removeEventListener('abort', kill);
      if (signal?.aborted) reject(signal.reason);
      else resolve({ code, stderr });
    };
    child.on('error', (err) => { stderr ||= err.message; settle(-1); });
    child.on('close', settle);
  });
}
