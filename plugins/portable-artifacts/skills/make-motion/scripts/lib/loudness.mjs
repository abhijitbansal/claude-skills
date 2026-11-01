// render --loudness: a two-pass EBU R128 loudnorm between the encode and the final rename. Pass 1 measures the encoded
// MP4's audio (`loudnorm ... print_format=json`, read from stderr); pass 2 copies the video stream and re-encodes the audio
// through a linear-mode loudnorm that applies the measured values, so the gain is one constant, not a moving compressor.
// ffmpeg is run with an argument array and no shell, asynchronously, so an interrupt can kill it and clean up.
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { UsageError } from './spec.mjs';
import { AUDIO_CODEC, fileInput, sec, parseLoudness } from './ffmpeg.mjs';

export const LOUDNESS_MIN = -30; // LUFS, the same range the spec's root `loudness.integrated` accepts
export const LOUDNESS_MAX = -5;
export const TRUE_PEAK_MIN = -3; // dBTP, as `loudness.truePeak`
export const TRUE_PEAK_MAX = 0;
export const DEFAULT_TRUE_PEAK = -1.5; // a flag or spec that names a LUFS target but no peak
const LOUDNESS_RANGE_LU = 11; // loudnorm LRA: the loudness range it keeps; a mix inside it takes the one-gain linear mode
const AAC_OVERSHOOT_DB = 0.5; // loudnorm holds the peak at its TP before the AAC encode, which can add about 0.2 dB: aim this far under
const LIMITED_RANGE_LU = 50; // loudnorm's largest LRA: once a limiter holds the peaks, the range is not what decides linear mode
const STDERR_KEEP = 200000; // loudnorm's JSON comes last; a long log keeps its tail
const MEASURE_KEYS = ['input_i', 'input_tp', 'input_lra', 'input_thresh', 'target_offset'];
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

// ---- the flags and the target ------------------------------------------------------------------------------------------

/** `--loudness` text -> `'off'` or a number from -30 to -5; anything else is a usage error that names the range. */
export function parseLoudnessFlag(text) {
  if (text === 'off') return 'off';
  const n = PLAIN_NUMBER.test(text) ? Number(text) : NaN;
  if (!(n >= LOUDNESS_MIN && n <= LOUDNESS_MAX)) {
    throw new UsageError(`--loudness must be a number from ${LOUDNESS_MIN} to ${LOUDNESS_MAX} (LUFS) or "off" (got ${JSON.stringify(text)})`);
  }
  return n;
}

/** `--true-peak` text -> a number from -3 to 0, else a usage error that names the range. */
export function parseTruePeakFlag(text) {
  const n = PLAIN_NUMBER.test(text) ? Number(text) : NaN;
  if (!(n >= TRUE_PEAK_MIN && n <= TRUE_PEAK_MAX)) {
    throw new UsageError(`--true-peak must be a number from ${TRUE_PEAK_MIN} to ${TRUE_PEAK_MAX} (dBTP) (got ${JSON.stringify(text)})`);
  }
  return n;
}

/**
 * The `{ integrated, truePeak }` a render normalises to, or null for none. `flags`: the parsed `loudness` (a number or
 * 'off') and `truePeak`; `specTarget`: the spec's root `loudness` after withDefaults (viral mode sets one). A flag wins
 * field by field over the spec; with no LUFS from either, there is no target. `--loudness off` disables it even when the
 * spec sets the field. A `--true-peak` with nothing to apply to is a usage error, never silently dropped.
 */
export function resolveTarget({ loudness, truePeak }, specTarget) {
  if (loudness === 'off') {
    if (truePeak !== undefined) throw new UsageError('--true-peak has nothing to apply to with --loudness off; leave one out');
    return null;
  }
  const integrated = loudness ?? specTarget?.integrated;
  if (integrated === undefined) {
    if (truePeak !== undefined) throw new UsageError('--true-peak needs a loudness target: add --loudness <lufs>, or a loudness field in the spec (mode viral sets one)');
    return null;
  }
  return { integrated, truePeak: truePeak ?? specTarget?.truePeak ?? DEFAULT_TRUE_PEAK };
}

/** The true peak loudnorm is told to hold (`truePeak` less the AAC encode's overshoot), so the finished file stays at or under `truePeak`. */
export const ceilingFor = (truePeak) => Math.round((truePeak - AAC_OVERSHOOT_DB) * 100) / 100;

/** The infix of the normalised copy's temp name (`o.partial.loudnorm.mp4`), nine bytes longer than the encode's. */
export const NORMALIZED_INFIX = '.loudnorm';
export const NAME_MAX_BYTES = 255; // the longest file name (UTF-8 bytes) common file systems take

/** Where the normalised copy of the encode at `partial` is written: beside it, a name no output or other temp takes. */
export function normalizedPath(partial) {
  const p = path.parse(partial);
  return path.join(p.dir, `${p.name}${NORMALIZED_INFIX}${p.ext}`);
}

// ---- the two passes ----------------------------------------------------------------------------------------------------

const targetFilter = (target, truePeak, range = LOUDNESS_RANGE_LU) => `loudnorm=I=${target}:TP=${truePeak}:LRA=${range}`;

/**
 * The measurement `loudnorm print_format=json` writes to stderr, as `{ input_i, input_tp, input_lra, input_thresh,
 * target_offset }` (strings, as ffmpeg prints them, so they go back into pass 2 unchanged); null when there is none. The
 * block follows other log lines, so every flat `{…}` is tried, last first, and only one holding all five keys counts.
 */
export function parseLoudnormJson(stderr) {
  const blocks = (stderr.match(/\{[^{}]*\}/g) ?? []).reverse();
  for (const block of blocks) {
    let parsed;
    try { parsed = JSON.parse(block); } catch { continue; }
    if (MEASURE_KEYS.every((key) => key in parsed)) return Object.fromEntries(MEASURE_KEYS.map((key) => [key, String(parsed[key])]));
  }
  return null;
}

/**
 * Pass 2: copy the video, run the audio through linear loudnorm with the pass-1 `measured` values, AAC as the encode does.
 * `duration` caps the file at the clip length as the first encode does (without it the last AAC packet is a full frame
 * long, 5 ms past the video); `pre` is a filter chain that runs ahead of loudnorm (the limiter stage, limiterChain).
 */
export function normalizeArgs({ input, out, target, truePeak = DEFAULT_TRUE_PEAK, measured, duration, pre, post }) {
  const length = Number.isFinite(duration) ? ['-t', sec(duration)] : [];
  return ['-y', ...fileInput(input), '-c:v', 'copy', '-af', passTwoFilter({ target, truePeak, measured, pre, post }), ...AUDIO_CODEC, ...length, '-movflags', '+faststart', out];
}

// The audio filter of pass 2: [pre,] linear loudnorm [, post]. `post` is the residual-gain correction of the limiter branch.
function passTwoFilter({ target, truePeak, measured, pre, post }) {
  const loudnorm = `${targetFilter(target, truePeak, pre ? LIMITED_RANGE_LU : LOUDNESS_RANGE_LU)}:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}`
    + `:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}:linear=true`;
  return [pre, loudnorm, post].filter(Boolean).join(',');
}

/** The fallback pass for an ffmpeg without the limiter stage: copy the video, apply `gain` dB (`volume`, no loudnorm), AAC as the encode does. */
export function gainArgs({ input, out, gain, duration }) {
  const length = Number.isFinite(duration) ? ['-t', sec(duration)] : [];
  return ['-y', ...fileInput(input), '-c:v', 'copy', '-af', `volume=${gain.toFixed(2)}dB`, ...AUDIO_CODEC, ...length, '-movflags', '+faststart', out];
}

function measureArgs(file, target, truePeak, pre) {
  const filter = `${targetFilter(target, truePeak, pre ? LIMITED_RANGE_LU : LOUDNESS_RANGE_LU)}:print_format=json`;
  return ['-hide_banner', '-nostats', ...fileInput(file), '-map', '0:a:0', '-af', pre ? `${pre},${filter}` : filter, '-f', 'null', '-'];
}

// ---- the limiter stage -------------------------------------------------------------------------------------------------

// loudnorm's linear mode only applies one gain. A mix that is mostly silence with short loud peaks (a viral clip's cues
// alone) cannot take it: the gain to the target would put the peaks over the true-peak ceiling (loudnorm then caps the gain
// and lands several LU under the target), or its loudness range is over 11 LU (loudnorm falls back to dynamic mode). So
// for those mixes the gain is applied first and a lookahead limiter holds the peaks at the ceiling minus LIMITER_HEADROOM_DB
// (room for AAC overshoot; 2 dB leaves some mixes just over loudnorm's 11 LU range); loudnorm then measures the limited
// signal, with its range check lifted, and its linear pass lands on the target. A mix that linear mode can reach (a tone,
// music, a voice) never takes this branch, and its bytes are those of the plain two passes.
const LIMITER_HEADROOM_DB = 3;
/** The limiter reduces the peaks by more than this many dB: render says so on stderr (a quiet or peaky mix for the target). */
export const LIMITER_NOTE_DB = 6;
const RESIDUAL_MIN_DB = 0.1; // a smaller miss than this after the dry run is left alone
// Measuring a chain the way the finished file is measured: at 48 kHz, which is what the encode's `-ar 48000` leaves.
const VERIFY_FILTER = 'aresample=48000,ebur128=peak=true';

// alimiter's `latency` option (its lookahead delay made up) and loudnorm's LRA up to 50 first appear in ffmpeg 5.1; 4.4 and
// 5.0 reject both, so the limiter stage cannot run there. The repo still accepts 4.4 for audio, so a render on an older
// ffmpeg skips the stage and says so, rather than capture every frame and fail afterwards. Whether the stage can run is
// asked of the ffmpeg itself (limiterSupported), not read off its version string, which a git build or a wrapper hides.
export const LIMITER_MIN_VERSION = Object.freeze({ major: 5, minor: 1 });

/** `{ major, minor }` from the text of `ffmpeg -version` (`ffmpeg version 4.4.2-0ubuntu0.22.04.1`, `n5.1.2`, `8.1.1`); null for a git build or anything else. For messages only. */
export function parseFfmpegVersion(text) {
  const m = /\bffmpeg version n?(\d+)\.(\d+)/.exec(String(text));
  return m ? { major: Number(m[1]), minor: Number(m[2]) } : null;
}

const probed = new Map(); // ffmpeg path -> promise of whether it runs the limiter stage, asked once per process

/**
 * Resolves true when `ffmpeg` runs the limiter stage: one dry run of the very filters the stage uses (alimiter with
 * `latency`, then loudnorm with `LRA=50`) on 0.1 s of silence, exit status 0. Cached per ffmpeg for the life of the process,
 * so a batch asks once. Needs no version parsing, so it holds for git builds and wrappers. Asynchronous, so an interrupt
 * during it is handled (`track`: see runFfmpeg).
 */
export function limiterSupported(ffmpeg, track) {
  if (!probed.has(ffmpeg)) {
    const filter = `${limiterChain({ gain: 0, truePeak: -1 })},${targetFilter(-14, -1.5, LIMITED_RANGE_LU)}`;
    const args = ['-hide_banner', '-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', '0.1', '-af', filter, '-f', 'null', '-'];
    probed.set(ffmpeg, runFfmpeg(ffmpeg, args, track).then(({ code }) => code === 0));
  }
  return probed.get(ffmpeg);
}

/** The first line of `ffmpeg -version`, or '' when it cannot be run. */
export function ffmpegVersionLine(ffmpeg) {
  const r = spawnSync(ffmpeg, ['-version'], { encoding: 'utf8' });
  return r.status === 0 ? (r.stdout ?? '').split('\n')[0] : '';
}
const dbToLinear = (db) => 10 ** (db / 20);

/** True when pass-1 `measured` shows linear loudnorm cannot reach `target` under `truePeak`: the peak plus the gain is over it, or the range is over 11 LU. */
export function needsLimiter(measured, target, truePeak) {
  const loudness = Number(measured.input_i);
  const peak = Number(measured.input_tp);
  if (!Number.isFinite(loudness) || !Number.isFinite(peak)) return false;
  return peak + (target - loudness) > truePeak || Number(measured.input_lra) > LOUDNESS_RANGE_LU;
}

/**
 * The filter chain that applies `gain` dB and then limits the peaks to `truePeak` - 3 dB: `level=false` stops alimiter's own
 * make-up gain, `latency=true` removes its lookahead delay so the audio stays in step with the video.
 */
export function limiterChain({ gain, truePeak }) {
  const limit = dbToLinear(truePeak - LIMITER_HEADROOM_DB).toFixed(4);
  return `volume=${gain.toFixed(2)}dB,alimiter=limit=${limit}:level=false:latency=true`;
}

// Runs ffmpeg (no shell, no stdin) and resolves `{ code, stderr }` when it ends. `track({ kill })` hands the caller a way to
// stop it (render's cleanup on an interrupt); kill resolves once the process has gone.
function runFfmpeg(ffmpeg, args, track) {
  const proc = spawn(ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  proc.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-STDERR_KEEP); });
  const ended = new Promise((resolve) => {
    proc.on('error', (error) => resolve({ code: -1, stderr: stderr || error.message }));
    proc.on('close', (code) => resolve({ code, stderr }));
  });
  track?.({ kill: () => { proc.kill('SIGKILL'); return ended; } });
  return ended;
}

const lastLine = (text) => text.trim().split('\n').filter((l) => l.trim()).at(-1) ?? 'no output';

/**
 * Pass 1: the loudnorm measurement of `file`'s first audio stream against `target` LUFS / `truePeak` dBTP, after the
 * optional `pre` chain. Rejects with a one-line error when ffmpeg fails or prints no measurement. `track`: see runFfmpeg.
 */
export async function measureLoudnorm(ffmpeg, file, target, truePeak = DEFAULT_TRUE_PEAK, track, pre) {
  const { code, stderr } = await runFfmpeg(ffmpeg, measureArgs(file, target, truePeak, pre), track);
  if (code !== 0) throw new Error(`loudnorm: ffmpeg failed (exit ${code}): ${lastLine(stderr)}`);
  const measured = parseLoudnormJson(stderr);
  if (!measured) throw new Error(`loudnorm: ffmpeg printed no measurement JSON (its last line: ${lastLine(stderr)})`);
  return measured;
}

/**
 * The passes: `input` (an MP4 with video and audio) -> `out`, normalised to `target` / `truePeak`, `duration` long. Pass 1
 * measures; a mix whose gain would push its peaks past the limiter ceiling gets the limiter stage (a pass 1b measures the
 * limited signal); pass 2 is the linear loudnorm. A silent mix has nothing to scale (loudnorm measures -inf): nothing is
 * written and `{ silent: true }` comes back. Rejects with a one-line error when a pass fails; the caller removes `out`.
 * `limited` says whether the limiter stage ran. `limiter`: whether it may (default true), or a function that answers (render's
 * capability probe).
 * `unavailable` says it was wanted but not possible: the mix then gets a plain gain, capped by the peak (`gain`).
 */
export async function normalizeFile(ffmpeg, { input, out, target, truePeak = DEFAULT_TRUE_PEAK, duration, track, limiter = true }) {
  const ceiling = ceilingFor(truePeak);
  let measured = await measureLoudnorm(ffmpeg, input, target, ceiling, track);
  if (!Number.isFinite(Number(measured.input_i))) return { measured, silent: true };
  const wanted = needsLimiter(measured, target, ceiling);
  const canLimit = wanted && (typeof limiter === 'function' ? await limiter() : limiter); // a function is asked only when the stage is wanted
  let pre;
  let post;
  let reduction = 0;
  if (canLimit) {
    const gain = target - Number(measured.input_i);
    reduction = Math.max(0, Math.round((Number(measured.input_tp) + gain - (truePeak - LIMITER_HEADROOM_DB)) * 10) / 10);
    pre = limiterChain({ gain, truePeak });
    measured = await measureLoudnorm(ffmpeg, input, target, ceiling, track, pre);
    post = await residualGain(ffmpeg, { input, target, ceiling, measured, pre, track });
  }
  // Without the stage (an ffmpeg before 5.1) loudnorm is not used at all: from 4.4 to 5.0 its cap on an input under 3 s is a
  // difference of two amplitudes (a ratio only from 6.0), which makes a short quiet clip quieter. A plain gain from the
  // pass-1 numbers is the same on every version and cannot push the peak over the ceiling.
  const unavailable = wanted && !canLimit;
  const gain = unavailable ? Math.min(target - Number(measured.input_i), ceiling - Number(measured.input_tp)) : undefined;
  const args = unavailable
    ? gainArgs({ input, out, gain, duration })
    : normalizeArgs({ input, out, target, truePeak: ceiling, measured, duration, pre, post });
  const { code, stderr } = await runFfmpeg(ffmpeg, args, track);
  if (code !== 0) throw new Error(`loudnorm: ffmpeg failed (exit ${code}): ${lastLine(stderr)}`);
  return { measured, silent: false, limited: pre !== undefined, unavailable, gain, reduction };
}

// loudnorm's measure-only passes resample to 192 kHz and its pass 2 runs at 48 kHz, and on wide-range signals the two
// integrated values differ by up to 1.4 LU, so the gain computed from the measurement lands short of the target. So the
// finished chain (limiter and linear loudnorm) is run once to nowhere and measured at 48 kHz (ebur128, which is also how the
// result is judged); a miss of 0.1 dB or more comes back as a `volume` filter to go after loudnorm. The correction never
// pushes the peak past the ceiling, and a branch that is already on target adds nothing.
async function residualGain(ffmpeg, { input, target, ceiling, measured, pre, track }) {
  const filter = passTwoFilter({ target, truePeak: ceiling, measured, pre });
  const args = ['-hide_banner', '-nostats', ...fileInput(input), '-map', '0:a:0', '-af', `${filter},${VERIFY_FILTER}`, '-f', 'null', '-'];
  const { code, stderr } = await runFfmpeg(ffmpeg, args, track);
  if (code !== 0) throw new Error(`loudnorm: ffmpeg failed (exit ${code}): ${lastLine(stderr)}`);
  const level = parseLoudness(stderr);
  if (!level || !Number.isFinite(level.lufs) || !Number.isFinite(level.truePeak)) return undefined;
  const residual = Math.min(target - level.lufs, ceiling - level.truePeak);
  return Math.abs(residual) >= RESIDUAL_MIN_DB ? `volume=${residual.toFixed(2)}dB` : undefined;
}
