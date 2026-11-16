// What make.mjs says: the report object (printed as one JSON object with --json), the plain-text form of it, the
// outline of a film, and the shape of a finding. Pure: it builds strings and objects.
//
// The report has the same keys on every path, so a reader never has to guess which exist:
//   ok, output, sheets, timed, voice, audio, post, capture, stages, frames, captured, seconds, msPerFrame, bytes, mbps, findings
// and `error: { message, hint }` when a problem with the machine stopped the run (a missing film file, no browser, no
// ffmpeg, ffmpeg failing, a crashed or closed browser, a lost WebGL context, a voice that cannot be made, an interrupt).
// `timed` is 'estimated' or 'measured' (the timeline used), null before one was built. `voice` is
// { cached, seconds, model } for a film whose voice was made (seconds: the narration's total length, the sum of its
// shot WAVs; model: the sidecar's model record), or for an author's own recording { cached: false, seconds: the last
// word's end in the file, model: null }; else null. `audio` is { lufs, truePeakDb, note, cues, music } of the sound in
// the rendered MP4, as measured in that file (ebur128), for a film whose voice or sound was muxed into it; for a film
// with sound that was not rendered, the plan alone (lufs and truePeakDb null, note NOT_RENDERED_NOTE); else null.
// `cues` is the number of cues planned, `music` { kind: 'bed' | 'file', bed, bpm, landed, cuts, short } or null (bpm
// and landed null for a file with no steady beat; short when a file ends before the film). What had been
// done by then
// stays in it: the stages that ran, the findings already found. A film's own fault (it does not validate, the page
// raises an error about it) is a finding, not an error.
import { parseSay } from '../../engine/script/say.mjs';
import { resolveLook } from '../../engine/graph/film.mjs';

/** The audio note of a film whose sound was planned (the sound stage) but not rendered: it is measured in the film only. */
export const NOT_RENDERED_NOTE = 'not rendered: the sound is measured in the finished film';
const SECOND_DECIMALS = 2;
const EN_DASH = '–';
const secondsText = (n) => n.toFixed(SECOND_DECIMALS);

// A hint for a message that carries none of its own.
const HINTS = Object.freeze([
  [/^cannot read /, 'give the path of an existing film .json file; a relative path is read from the current directory'],
  [/^.* is not a regular file/, 'give the path of a film .json file, not a folder or a device'],
  [/^ffmpeg failed/, 'ffmpeg refused the frames; the lines above are its own words. Retry with --exact, or check the disk space'],
  [/^post pass:/, 'the browser lost or broke its WebGL context; run again, and use --exact if it keeps happening'],
  [/^Target crashed/, 'the browser page crashed while drawing the film (it may have run out of memory); run again, and close other heavy programs if it keeps happening'],
  [/has been closed/, 'the browser closed while drawing the film; run again'],
  [/^Timeout \d+ms exceeded/, 'the browser did not answer in time; run again, and check that the machine is not overloaded'],
  [/^image ".*" could not be loaded/, 'the file is not a picture the browser can decode; replace it with a PNG, JPEG or WebP image'],
]);

/** { message, hint } for an error's first line: whole with its hint when HINTS knows it (a path in it may hold ". "),
 *  else split at the first ". " (the version 1 helpers write "what. how to fix"). */
export function describeError(err) {
  const first = String(err?.message ?? err).split('\n')[0];
  const known = HINTS.find(([pattern]) => pattern.test(first));
  if (known) return { message: first, hint: known[1] };
  const cut = first.indexOf('. ');
  if (cut > 0) return { message: first.slice(0, cut), hint: first.slice(cut + 2) };
  return { message: first, hint: '' };
}

/** A validation error { path, message } as a finding. Validation errors are always mechanical: the film cannot be built. */
export const validationFinding = ({ path, message }) => ({ kind: 'mechanical', shot: null, path, message });

/** A review finding as the report carries it: its rule, role and node are for deduplication and the path only. */
export const reviewFinding = ({ kind, shot, path, message, t }) => ({ kind, shot, path, message, t });

/** A finding about the page or the post pass rather than about a shot. */
export const pageFinding = (kind, message) => ({ kind, shot: null, path: '', message });

/**
 * A film's look when it is experimental (parked: registered, rendered, left out of every listing): { name,
 * experimental: true } for the report's `look` field, else null (a listed look adds nothing to the report).
 */
export function experimentalLook(film) {
  const look = resolveLook(film);
  return look.experimental === true ? { name: look.name, experimental: true } : null;
}

/** The report of a run in its state `state` (see run.mjs), with every key present (`look` only for an experimental look). */
export function reportOf(state) {
  const mechanical = state.findings.some((f) => f.kind === 'mechanical');
  return {
    ok: state.validated && state.error === null && !mechanical,
    output: state.output,
    sheets: state.sheets,
    timed: state.timed,
    voice: state.voice,
    audio: state.audio,
    post: state.post,
    capture: state.capture,
    stages: state.stages,
    frames: state.frames,
    captured: state.captured,
    seconds: state.seconds,
    msPerFrame: state.msPerFrame,
    bytes: state.bytes,
    mbps: state.mbps,
    findings: state.findings,
    ...(state.look ? { look: state.look } : {}),
    ...(state.error === null ? {} : { error: state.error }),
  };
}

/** The report of a run that never began (a usage error): empty, with the error. */
export const errorReport = (error) => reportOf({
  validated: false, error, stages: [], findings: [], sheets: [], output: null, timed: null, voice: null, audio: null, post: null, capture: null,
  frames: 0, captured: 0, seconds: null, msPerFrame: null, bytes: null, mbps: null,
});

const plainNarration = (shot) => (typeof shot.say === 'string' ? parseSay(shot.say).plain : '');

/** One entry per shot: { id, show, start, end, narration }. */
export function outlineOf(film, timeline) {
  return film.shots.map((shot, i) => ({
    id: shot.id, show: shot.show, start: timeline.shots[i].start, end: timeline.shots[i].end, narration: plainNarration(shot),
  }));
}

/** `<id>  <show>  <start>-<end>s  "<plain narration>"`, one line per shot (the range joined by an en dash). */
export const outlineLines = (outline) => outline.map((s) => `${s.id}  ${s.show}  ${secondsText(s.start)}${EN_DASH}${secondsText(s.end)}s  "${s.narration}"`);

const INTERRUPTED = 'interrupted'; // the error message of a run stopped through its signal (run.mjs failureOutcome)
const timelineFailed = (stages) => stages.some((s) => (s.name === 'timeline' || s.name === 'sound') && !s.ok);

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// The music part of the sound line: the bed and its tempo, or the file's, then how many cuts land on a beat.
function musicText(music) {
  const source = music.kind === 'bed' ? `bed ${music.bed}` : 'music file';
  const tempo = music.bpm === null ? `${source} with no steady beat` : `${source} at ${music.bpm} bpm`;
  const landed = music.landed === null || music.cuts === 0 ? '' : `, ${music.landed} of ${plural(music.cuts, 'cut')} on a beat`; // no cuts, no count
  return `${tempo}${landed}${music.short ? ', shorter than the film: it ends early with a 1 s fade' : ''}`;
}

/** The text form's line for sound: the cue count, the bed or file and its tempo, the cuts on a beat; null for none. */
export function soundLine(audio) {
  if (audio === null || typeof audio?.cues !== 'number' || (audio.cues === 0 && !audio.music)) return null;
  const cues = audio.cues === 0 ? 'no cues' : plural(audio.cues, 'cue');
  return `sound: ${audio.music ? `${cues}, ${musicText(audio.music)}` : cues}`;
}

/**
 * The first line of the text form. `interrupted` or `failed` when the user or the machine stopped the run (its `error`);
 * otherwise `invalid` when the film was rejected: it did not validate, its voice could not be spoken from it (a film
 * error), or its anchors failed on the measured timeline (each a failed stage with no error); else `valid`.
 */
function verdict(report) {
  if (report.error) return report.error.message === INTERRUPTED ? INTERRUPTED : 'failed';
  const validated = Boolean(report.stages.find((s) => s.name === 'validate')?.ok);
  return validated && report.stages.every((s) => s.ok) ? 'valid' : 'invalid';
}

/**
 * The text form of a report: `valid`, `invalid`, `failed` or `interrupted` (verdict), a line per finding, then where
 * things went and the frame counts.
 */
export function formatText(report, { sheetsDir }) {
  const lines = [verdict(report)];
  for (const f of report.findings) lines.push(`${f.kind}: ${f.path}: ${f.message}`);
  if (report.timed === null || timelineFailed(report.stages)) return lines.join('\n');
  lines.push(`sheets: ${sheetsDir} (${report.sheets.length} ${report.sheets.length === 1 ? 'file' : 'files'})`);
  lines.push(`output: ${report.output ?? 'none (not rendered)'}`);
  const counts = report.output === null ? `${report.frames}` : `${report.frames}, captured: ${report.captured} (capture ${report.capture}, post ${report.post}, ${report.msPerFrame.toFixed(1)} ms per frame); size: ${(report.bytes / 1e6).toFixed(1)} MB, ${report.mbps.toFixed(1)} Mbit/s`;
  lines.push(`frames: ${counts}`);
  const sound = soundLine(report.audio);
  if (sound !== null) lines.push(sound);
  return lines.join('\n');
}
