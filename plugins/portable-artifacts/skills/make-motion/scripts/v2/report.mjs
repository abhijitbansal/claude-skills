// What make.mjs says: the report object (printed as one JSON object with --json), the plain-text form of it, the
// outline of a film, and the shape of a finding. Pure: it builds strings and objects.
import { parseSay } from '../../engine/script/say.mjs';

const SECOND_DECIMALS = 2;
const EN_DASH = '–';
const secondsText = (n) => n.toFixed(SECOND_DECIMALS);

/** A validation error { path, message } as a finding. Validation errors are always mechanical: the film cannot be built. */
export const validationFinding = ({ path, message }) => ({ kind: 'mechanical', shot: null, path, message });

/** A review finding as the report carries it: its rule and node are for deduplication only. */
export const reviewFinding = ({ kind, shot, path, message, t }) => ({ kind, shot, path, message, t });

/** The report of a run that stopped at validation. */
export const invalidReport = ({ stages, findings }) => ({
  ok: false, output: null, sheets: [], timed: null, post: null, capture: null, stages, frames: 0, captured: 0, msPerFrame: null, findings,
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

/** The text form of a report: `valid` or `invalid`, a line per finding, then where things went and the frame counts. */
export function formatText(report, { sheetsDir }) {
  const lines = [report.stages.find((s) => s.name === 'validate')?.ok ? 'valid' : 'invalid'];
  for (const f of report.findings) lines.push(`${f.kind}: ${f.path}: ${f.message}`);
  if (report.timed === null) return lines.join('\n');
  lines.push(`sheets: ${sheetsDir} (${report.sheets.length} ${report.sheets.length === 1 ? 'file' : 'files'})`);
  lines.push(`output: ${report.output ?? 'none (not rendered)'}`);
  const counts = report.output === null ? `${report.frames}` : `${report.frames}, captured: ${report.captured} (capture ${report.capture}, post ${report.post}, ${report.msPerFrame.toFixed(1)} ms per frame)`;
  lines.push(`frames: ${counts}`);
  return lines.join('\n');
}
