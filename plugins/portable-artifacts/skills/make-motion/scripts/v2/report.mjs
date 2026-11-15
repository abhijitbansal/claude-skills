// What make.mjs says: the report object (printed as one JSON object with --json), the plain-text form of it, the
// outline of a film, and the shape of a finding. Pure: it builds strings and objects.
//
// The report has the same keys on every path, so a reader never has to guess which exist:
//   ok, output, sheets, timed, voice, post, capture, stages, frames, captured, seconds, msPerFrame, bytes, mbps, findings
// and `error: { message, hint }` when a problem with the machine stopped the run (a missing film file, no browser, no
// ffmpeg, ffmpeg failing, a crashed or closed browser, a lost WebGL context, a voice that cannot be made, an interrupt).
// `timed` is 'estimated' or 'measured' (the timeline used), null before one was built. `voice` is
// { cached, seconds, model } for a film whose voice was made (seconds: the narration's total length, the sum of its
// shot WAVs; model: the sidecar's model record), else null. What had been done by then
// stays in it: the stages that ran, the findings already found. A film's own fault (it does not validate, the page
// raises an error about it) is a finding, not an error.
import { parseSay } from '../../engine/script/say.mjs';

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
  [/^the voice worker did not finish/, 'the voice took too long to synthesise; run again, and check that the machine is not overloaded'],
  [/^the voice in .* does not match the film/, 'delete that folder to synthesise the voice again'],
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

/** The report of a run in its state `state` (see run.mjs), with every key present. */
export function reportOf(state) {
  const mechanical = state.findings.some((f) => f.kind === 'mechanical');
  return {
    ok: state.validated && state.error === null && !mechanical,
    output: state.output,
    sheets: state.sheets,
    timed: state.timed,
    voice: state.voice,
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
    ...(state.error === null ? {} : { error: state.error }),
  };
}

/** The report of a run that never began (a usage error): empty, with the error. */
export const errorReport = (error) => reportOf({
  validated: false, error, stages: [], findings: [], sheets: [], output: null, timed: null, voice: null, post: null, capture: null,
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

// A film is invalid when it does not validate, or when its anchors fail on the timeline built for it (a voiced film's
// measured one: the timeline stage then fails with the anchor errors as findings).
const isValid = (stages) => Boolean(stages.find((s) => s.name === 'validate')?.ok) && !stages.some((s) => s.name === 'timeline' && !s.ok);

/** The text form of a report: `valid` or `invalid`, a line per finding, then where things went and the frame counts. */
export function formatText(report, { sheetsDir }) {
  const lines = [isValid(report.stages) ? 'valid' : 'invalid'];
  for (const f of report.findings) lines.push(`${f.kind}: ${f.path}: ${f.message}`);
  if (report.timed === null) return lines.join('\n');
  lines.push(`sheets: ${sheetsDir} (${report.sheets.length} ${report.sheets.length === 1 ? 'file' : 'files'})`);
  lines.push(`output: ${report.output ?? 'none (not rendered)'}`);
  const counts = report.output === null ? `${report.frames}` : `${report.frames}, captured: ${report.captured} (capture ${report.capture}, post ${report.post}, ${report.msPerFrame.toFixed(1)} ms per frame); size: ${(report.bytes / 1e6).toFixed(1)} MB, ${report.mbps.toFixed(1)} Mbit/s`;
  lines.push(`frames: ${counts}`);
  return lines.join('\n');
}
